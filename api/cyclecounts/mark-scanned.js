// api/cyclecounts/mark-scanned.js
/* eslint-disable no-console */
const { withCORS, ok, bad, method } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

function norm(s){ return String(s ?? "").trim(); }
function nowISO(){ return new Date().toISOString(); }

async function readJSON(req){
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch {}
  }
  return new Promise(resolve => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

module.exports = async (req, res) => {
  // CORS & method handling: allow GET (tolerant), POST (preferred), and OPTIONS
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (!["GET","POST"].includes(req.method)) return method(res, ["GET","POST","OPTIONS"]);
  withCORS(res);

  try {
    const body = req.method === "POST" ? await readJSON(req) : {};
    const bin  = norm(req.query.bin || body.bin);
    const imei = norm(req.query.imei || body.imei);
    const user = norm(req.query.user || body.user || body.scannedBy || "");

    if (!bin)  return bad(res, "bin is required", 400);
    if (!imei) return bad(res, "imei is required", 400);

    // Find the latest record for this bin
    const all = await Store.listBins();
    let rec = null, recTime = -1;
    for (const r of all) {
      if (norm(r.bin).toUpperCase() !== bin.toUpperCase()) continue;
      const t = Date.parse(r.submittedAt || r.updatedAt || r.started || 0) || 0;
      if (t > recTime) { rec = r; recTime = t; }
    }
    if (!rec) {
      // create a minimal record so we can still clear
      rec = { bin, counter: "—", total: 0, scanned: 0, missing: 0, items: [], missingImeis: [], state: "investigation", started: nowISO(), submittedAt: nowISO() };
    }

    // Ensure shapes
    rec.items = Array.isArray(rec.items) ? rec.items : [];
    rec.missingImeis = Array.isArray(rec.missingImeis) ? rec.missingImeis : [];

    // 1) Remove IMEI from missingImeis (if present)
    const beforeMissingLen = rec.missingImeis.length;
    rec.missingImeis = rec.missingImeis.filter(x => norm(x) !== imei);
    const missingRemoved = rec.missingImeis.length !== beforeMissingLen;

    // 2) If there's an item row with this IMEI, mark it entered
    let itemTouched = false;
    for (const it of rec.items) {
      const sys = norm(it.systemImei || "");
      if (sys && sys === imei) {
        const hasSerial = true;
        const systemQty = Number(it.systemQty != null ? it.systemQty : (hasSerial ? 1 : 0)) || 0;
        const prevEntered = Number(it.qtyEntered || 0);
        if (prevEntered < systemQty) { it.qtyEntered = systemQty; itemTouched = true; }
      }
    }

    // 3) Adjust scanned / missing heuristically if we actually cleared something
    if (missingRemoved || itemTouched) {
      rec.scanned = Math.max(0, Number(rec.scanned || 0) + 1);
      rec.missing = Math.max(0, Number(rec.missing || 0) - 1);
    }

    rec.updatedAt = nowISO();

    // Persist
    const saved = await Store.upsertBin(rec);

    // (Optional) Write an audit row so we can exclude later if needed
    try {
      await appendRow("FoundImeis", [
        bin, imei, user || "—", saved.counter || "—",
        nowISO()
      ]);
    } catch (e) { /* non-fatal */ }

    return ok(res, { ok:true, bin, imei, adjusted: !!(missingRemoved || itemTouched), record: saved });
  } catch (e) {
    console.error("[mark-scanned] fail:", e);
    return bad(res, String(e.message || e), 500);
  }
};
