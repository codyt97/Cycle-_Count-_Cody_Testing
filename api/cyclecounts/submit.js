// api/cyclecounts/submit.js
// Accept a bin submission, persist to shared Store, and append logs to Google Sheets.
// - Bins tab: Bin, Counter, Total, Scanned, Missing, StartedAt, SubmittedAt, State
// - NotScanned tab: Bin, Counter, SKU, Description, Type, QtySystem, QtyEntered
// - WrongBinAudits tab: IMEI, ScannedBin, TrueLocation, ScannedBy, Status, CreatedAt, UpdatedAt

/* eslint-disable no-console */
const { withCORS } = require("../_lib/respond");
const { ok, bad, method } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

function norm(s){ return String(s ?? "").trim(); }
function nowISO(){ return new Date().toISOString(); }
function userFrom(req, body = {}) {
  return String(req.query?.user || body.user || req.headers["x-user"] || "anon").toLowerCase();
}

async function readJSON(req){
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch {}
  }
  return new Promise(resolve => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

module.exports = async function handler(req, res){
  if (req.method === "OPTIONS") { withCORS(res); res.statusCode = 204; return res.end(); }
  if (req.method !== "POST")    { return method(res, ["POST","OPTIONS"]); }
  withCORS(res);

  try {
    const body = await readJSON(req);
    const user = userFrom(req, body);

    // ------ normalize core fields ------
    const bin     = norm(body.bin);
    const counter = norm(body.counter || "");
    const total   = Number.isFinite(+body.total)   ? +body.total   : 0;
    const scanned = Number.isFinite(+body.scanned) ? +body.scanned : 0;

    if (!bin) return bad(res, "missing_bin", 400);

    const items        = Array.isArray(body.items) ? body.items : [];
    const missingImeis = Array.isArray(body.missingImeis) ? body.missingImeis : [];

    // Derive non-serial shortages if client didn't send them
    const nonSerialShortages = Array.isArray(body.nonSerialShortages) ? body.nonSerialShortages :
      items
        .filter(it => !String(it.systemImei || "").trim()) // non-serial only
        .map(it => ({
          sku: it.sku || "—",
          description: it.description || "—",
          systemQty: Number(it.systemQty || 0),
          qtyEntered: Number(it.qtyEntered || 0)
        }))
        .filter(s => s.qtyEntered < s.systemQty);

    // client-buffered wrong-bin list (to be persisted and logged)
    const wrongBin = Array.isArray(body.wrongBin) ? body.wrongBin : [];

    // ------ serial + non-serial missing math ------
    const serialMissing     = missingImeis.length;
    const nonSerialMissing  = nonSerialShortages.reduce((a, s) => a + Math.max(Number(s.systemQty || 0) - Number(s.qtyEntered || 0), 0), 0);
    const finalMissing      = Number.isFinite(+body.missing) ? +body.missing : (serialMissing + nonSerialMissing);

    // ------ persist wrong-bin audits (shared Store) ------
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

    // ------ persist the cycle count (shared Store, read by Investigator/Summary) ------
    const submittedAt = nowISO();
    const startedAt   = body.startedAt ? String(body.startedAt) : submittedAt;

    const record = await Store.upsertBin({
      bin,
      user,
      counter: counter || "—",
      total,
      scanned,
      missing: finalMissing,
      items,
      missingImeis,
      nonSerialShortages,
      state: "investigation",
      submittedAt,
      started: startedAt,
    });

    // ------ fire-and-forget logging to Google Sheets ------
    (async () => {
      try {
        // Bins row
        await appendRow("Bins", [
          bin, counter || "—",
          Number(total || 0), Number(scanned || 0), Number(finalMissing || 0),
          startedAt, submittedAt, "investigation"
        ]);

        // NotScanned rows
        if (Array.isArray(nonSerialShortages) && nonSerialShortages.length) {
          for (const s of nonSerialShortages) {
            await appendRow("NotScanned", [
              bin, counter || "—",
              s.sku || "—", s.description || "—",
              "nonserial",
              Number(s.systemQty || 0), Number(s.qtyEntered || 0)
            ]);
          }
        }

        // WrongBinAudits rows (opened)
        if (Array.isArray(wrongBin) && wrongBin.length) {
          const ts = nowISO();
          for (const wb of wrongBin) {
            if (!wb || !wb.imei) continue;
            await appendRow("WrongBinAudits", [
              String(wb.imei || ""),
              String(wb.scannedBin || ""),
              String(wb.trueLocation || ""),
              String(wb.scannedBy || counter || "—"),
              "open",
              ts, ts
            ]);
          }
        }
      } catch (e) {
        console.error("[submit] sheets append failed:", e?.message || e);
      }
    })();

    return ok(res, {
      ok: true,
      bin: record?.bin || bin,
      missing: finalMissing,
      serialMissing,
      nonSerialMissing,
      submittedAt,
    });
  } catch (e) {
    console.error("[submit] error:", e);
    return bad(res, String(e.message || e), 500);
  }
};
