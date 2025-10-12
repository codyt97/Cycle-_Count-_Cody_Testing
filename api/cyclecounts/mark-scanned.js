// api/cyclecounts/mark-scanned.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

function norm(s){ return String(s ?? "").trim(); }
const nowISO = () => new Date().toISOString();

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "POST")     return method(res, ["POST","OPTIONS"]);
  withCORS(res);

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body||"{}") : (req.body || {});
    const bin   = norm(body.bin);
    const user  = norm(body.user || body.counter || "");
    const imei  = norm(body.systemImei || body.imei); // optional
    const sku   = norm(body.sku);
    const desc  = norm(body.description);
    const qtyIn = Number(body.qty || 1);

    if (!bin) return bad(res, "bin is required", 400);

    // Get latest record for this bin
    const all = await Store.listBins();                                         // :contentReference[oaicite:2]{index=2}
    let idx = -1, bestT = -1;
    for (let i = 0; i < all.length; i++) {
      if (String(all[i].bin||"").toLowerCase() !== bin.toLowerCase()) continue;
      const t = Date.parse(all[i].submittedAt || all[i].updatedAt || all[i].started || 0) || 0;
      if (t > bestT) { bestT = t; idx = i; }
    }
    if (idx === -1) return bad(res, "bin not found", 404);
    const rec = all[idx];

    const items = Array.isArray(rec.items) ? [...rec.items] : [];
    let changed = false;

    if (imei) {
      // SERIAL: find item by IMEI; set qtyEntered = 1
      const j = items.findIndex(it => String(it.systemImei||"").trim() === imei);
      if (j !== -1) {
        const hasSerial = true;
        const systemQty = 1;
        const qtyEntered = 1; // scanned now
        items[j] = { ...items[j], systemImei: imei, systemQty, qtyEntered };
        changed = true;
      }
      // also drop from missingImeis if present
      if (Array.isArray(rec.missingImeis) && rec.missingImeis.includes(imei)) {
        rec.missingImeis = rec.missingImeis.filter(x => String(x).trim() !== imei);
        changed = true;
      }
    } else {
      // NON-SERIAL: bump qtyEntered (default to filling to systemQty)
      const j = items.findIndex(it =>
        (!String(it.systemImei||"")) &&
        (sku ? String(it.sku||"").trim().toUpperCase() === sku.toUpperCase() : true) &&
        (desc ? String(it.description||"").trim() === desc : true)
      );
      if (j !== -1) {
        const sys = Number(items[j].systemQty || 0);
        const cur = Number(items[j].qtyEntered || 0);
        const next = Math.min(sys, cur + (Number.isFinite(qtyIn) ? qtyIn : (sys - cur)));
        if (next !== cur) {
          items[j] = { ...items[j], qtyEntered: next };
          changed = true;
        }
      }
    }

    if (!changed) return ok(res, { ok:true, updated:false, record: rec });

    // Recompute scanned/missing from items
    const total = Number(rec.total || 0);
    const serialScanned = items.filter(it => String(it.systemImei||"") && Number(it.qtyEntered||0) >= 1).length;
    const nonSerialMissing = items
      .filter(it => !String(it.systemImei||""))
      .reduce((a, it) => a + Math.max(Number(it.systemQty||0) - Number(it.qtyEntered||0), 0), 0);
    const serialMissing = Math.max(0, (Array.isArray(rec.missingImeis) ? rec.missingImeis.length : 0));
    const scanned = serialScanned + (total - (serialMissing + nonSerialMissing)); // best-effort
    const missing = serialMissing + nonSerialMissing;

    const updated = await Store.upsertBin({
      bin,
      counter: rec.counter || user || "—",
      items,
      missingImeis: rec.missingImeis || [],
      scanned,
      missing,
      state: rec.state || "investigation",
      submittedAt: nowISO(),
    });                                                                            // :contentReference[oaicite:3]{index=3}

    return ok(res, { ok:true, updated:true, record: updated });
  } catch (e) {
    console.error("[mark-scanned] fail:", e);
    return bad(res, String(e.message || e), 500);
  }
};
