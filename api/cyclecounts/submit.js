// api/cyclecounts/submit.js
/* eslint-disable no-console */
const { withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

function norm(s){ return String(s ?? "").trim(); }
function now(){ return new Date().toISOString(); }

async function readJSON(req){
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) { try { return JSON.parse(req.body); } catch {} }
  return new Promise(resolve => {
    let data = ""; req.on("data", c => (data += c));
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

function deriveNonSerialShortages(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(it => !String(it.systemImei || "").trim())
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

    const items        = Array.isArray(body.items) ? body.items : [];
    const missingImeis = Array.isArray(body.missingImeis) ? body.missingImeis : [];
    const wrongBin     = Array.isArray(body.wrongBin) ? body.wrongBin : [];
    const startedAt    = norm(body.startedAt || body.started || "");
    const submittedAt  = now();

    if (!bin) { res.statusCode = 400; return res.end(JSON.stringify({ ok:false, error:"missing_bin" })); }

    const nonSerialShortages =
      Array.isArray(body.nonSerialShortages) && body.nonSerialShortages.length
        ? body.nonSerialShortages
        : deriveNonSerialShortages(items);

    const finalMissing =
      typeof missing === "number"
        ? missing
        : (missingImeis.length + sumNonSerialMissing(nonSerialShortages));

    // Wrong-bin audits → Store
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

    // Upsert cycle count → Store
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
      started: startedAt || submittedAt,
      submittedAt,
    });

    // ---- Sheets logging (await + report) ----
    const sheetsResult = { bins:false, notScanned:0, audits:0, errors:[] };

    // Bins
    try {
      await appendRow("Bins", [
        bin, counter || "—",
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

    // NotScanned: NON-SERIAL
    if (nonSerialShortages.length) {
      for (const s of nonSerialShortages) {
        try {
          await appendRow("NotScanned", [
            bin, counter || "—",
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

    // NotScanned: SERIAL (from missingImeis)
    if (missingImeis.length) {
      for (const raw of missingImeis) {
        const mi = norm(raw);
        if (!mi) continue;
        let sku = "—", description = "—";
        try {
          const ref = await Store.findByIMEI(mi);
          if (ref) { sku = norm(ref.sku); description = norm(ref.description); }
        } catch {}
        try {
          await appendRow("NotScanned", [
            bin, counter || "—",
            sku, description,
            "serial",
            1,  // QtySystem
            0,  // QtyEntered
          ]);
          sheetsResult.notScanned++;
        } catch (e) {
          sheetsResult.errors.push({ tab:"NotScanned", error: String(e?.message || e) });
        }
      }
    }

    // WrongBinAudits
    if (wrongBin.length) {
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
  } catch (e) {
    console.error("[cyclecounts/submit] fail:", e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok:false, error:String(e.message || e) }));
  }
};
