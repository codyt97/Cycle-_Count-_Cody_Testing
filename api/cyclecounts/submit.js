// api/cyclecounts/submit.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "POST")    return method(res, ["POST","OPTIONS"]);
  withCORS(res);

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const bin = String(body.bin || "").trim();
    const counter = String(body.counter || "").trim() || "—";
    const scannedItems = Array.isArray(body.items) ? body.items : [];

    if (!bin) return bad(res, "bin is required", 400);

    // Determine "expected" items from the snapshot (Sheet)
    const inv = await Store.getInventory();
    const expected = inv.filter(r => (String(r.location||"").trim().toLowerCase() === bin.toLowerCase()));

    // Scanned IMEIs set
    const scannedSet = new Set(scannedItems
      .map(x => String(x.systemImei || x.imei || "").trim())
      .filter(Boolean));

    // Build missing as full objects for downstream UI/CSV
    const missingImeis = expected
      .filter(r => !scannedSet.has(String(r.systemImei||"").trim()))
      .map(r => ({
        sku: r.sku || "—",
        description: r.description || "—",
        systemImei: String(r.systemImei || ""),
      }));

    const payload = {
      bin,
      counter,
      total: expected.length,
      scanned: scannedSet.size,
      missing: missingImeis.length,
      items: scannedItems,
      missingImeis,
      state: missingImeis.length ? "investigation" : "complete",
      submittedAt: new Date().toISOString(),
    };

    const saved = await Store.upsertBin(payload);
    return ok(res, { ok: true, saved });
  } catch (e) {
    return bad(res, "Submit failed: " + (e?.message || String(e)), 500);
  }
};
