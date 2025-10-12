// api/cyclecounts/submit.js
/* eslint-disable no-console */
// Accepts a bin submission from the counter and persists:
// - the cycle count summary (shared Store)
// - wrong-bin audits (shared Store)
// - non-serial shortages (derived)
// And now appends rows into Google Sheets tabs:
//   Bins, WrongBinAudits, NotScanned

const { withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

function norm(s){ return String(s ?? "").trim(); }
function now(){ return new Date().toISOString(); }

async function readJSON(req){
  // handle vercel/node body variations safely
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch {}
  }
  return new Promise(resolve => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

// Derive non-serial shortages from items if not provided
function deriveNonSerialShortages(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(it => !String(it.systemImei || "").trim()) // non-serial rows only
    .map(it => ({
      sku: it.sku || "—",
      description: it.description || "—",
      systemQty: Number(it.systemQty || 0),
      qtyEntered: Number(it.qtyEntered || 0),
    }))
    .filter(s => s.qtyEntered < s.systemQty);
}

function sumNonSerialMissing(nonSerialShortages = []) {
  return nonSerialShortages.reduce(
    (a, s) => a + Math.max(Number(s.systemQty || 0) - Number(s.qtyEntered || 0), 0),
    0
  );
}

module.exports = async function handler(req, res){
  if (req.method === "OPTIONS") { withCORS(res); res.statusCode = 204; return res.end(); }
  if (req.method !== "POST")    { withCORS(res); res.setHeader("Allow","POST,OPTIONS"); res.statusCode = 405; return res.end(JSON.stringify({ ok:false, error:"method_not_allowed" })); }
  withCORS(res);

  try {
    const body = await readJSON(req);

    const bin      = norm(body.bin);
    const counter  = norm(body.counter || "");
    const total    = Number.isFinite(+body.total)   ? +body.total   : 0;
    const scanned  = Number.isFinite(+body.scanned) ? +body.scanned : 0;
    let   missing  = Number.isFinite(+body.missing) ? +body.missing : undefined;

    const items           = Array.isArray(body.items) ? body.items : [];
    const missingImeis    = Array.isArray(body.missingImeis) ? body.missingImeis : [];
    const wrongBin        = Array.isArray(body.wrongBin) ? body.wrongBin : [];
    const startedAt       = norm(body.startedAt || body.started || "");
    const submittedAt     = now();

    if (!bin) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:"missing_bin" }));
    }

    // Non-serial shortages
    const nonSerialShortages = Array.isArray(body.nonSerialShortages) && body.nonSerialShortages.length
      ? body.nonSerialShortages
      : deriveNonSerialShortages(items);

    // Compute final missing if absent: serial deficits + non-serial deficits
    const serialMissing     = missingImeis.length;
    const nonSerialMissing  = sumNonSerialMissing(nonSerialShortages);
    const finalMissing      = (typeof missing === "number") ? missing : (serialMissing + nonSerialMissing);

    // ------ persist wrong-bin audits into shared Store ------
    if (wrongBin.length) {
      for (const wb of wrongBin) {
        const imei = norm(wb.imei);
        if (!imei) continue;
        await Store.appendAudit({
          imei,
          scannedBin:  norm(wb.scannedBin),
          trueLocation:norm(wb.trueLocation),
          scannedBy:   norm(wb.scannedBy || counter || "—"),
          status: "open",
        });
      }
    }

    // ------ upsert the cycle count into shared Store (for Investigator/Summary) ------
    const record = await Store.upsertBin({
      bin,
      user: norm(body.user || ""),
      counter,
      total,
      scanned,
      missing: finalMissing,
      items,
      missingImeis,
      nonSerialShortages,
      state: "investigation",
      started: startedAt || now(),
      submittedAt,
    });

    // ---------- Sheets logging (fire-and-forget) ----------
    // ---------- Sheets logging (await + report) ----------
const sheetsResult = { bins:false, notScanned:0, audits:0, errors:[] };

try {
  await appendRow("Bins", [
    bin,
    counter || "—",
    Number(total || 0),
    Number(scanned || 0),
    Number(finalMissing || 0),
    startedAt || record.started || submittedAt,
    submittedAt,
    "investigation",
  ]);
  sheetsResult.bins = true;
} catch (e) {
  sheetsResult.errors.push({ tab:"Bins", error: String(e?.message || e) });
}

if (Array.isArray(nonSerialShortages) && nonSerialShortages.length) {
  for (const s of nonSerialShortages) {
    try {
      await appendRow("NotScanned", [
        bin,
        counter || "—",
        s.sku || "—",
        s.description || "—",
        "nonserial",
        Number(s.systemQty || 0),
        Number(s.qtyEntered || 0),
      ]);
      sheetsResult.notScanned++;
    } catch (e) {
      sheetsResult.errors.push({ tab:"NotScanned", error: String(e?.message || e) });
    }
  }
}

if (Array.isArray(wrongBin) && wrongBin.length) {
  for (const wb of wrongBin) {
    try {
      await appendRow("WrongBinAudits", [
        String(wb.imei || ""),
        String(wb.scannedBin || ""),
        String(wb.trueLocation || ""),
        String(wb.scannedBy || counter || "—"),
        "open",
        submittedAt,
        submittedAt,
      ]);
      sheetsResult.audits++;
    } catch (e) {
      sheetsResult.errors.push({ tab:"WrongBinAudits", error: String(e?.message || e) });
    }
  }
}

return res.end(JSON.stringify({ ok:true, record, missing: finalMissing, sheetsResult }));


    return res.end(JSON.stringify({ ok:true, record, missing: finalMissing }));
  } catch (e) {
    console.error("[cyclecounts/submit] fail:", e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok:false, error:String(e.message || e) }));
  }
};
