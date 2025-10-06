// api/cyclecounts/submit.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "POST") return method(res, ["POST", "OPTIONS"]);

  try {
    const {
      bin,
      counter,
      total,
      scanned,
      missing,
      items,          // optional: [{sku, description, systemImei, scannedImei?}]
      missingImeis,   // optional: [{sku?, description?, systemImei}]
      started,        // optional iso
      updated,        // optional iso
    } = req.body || {};

    if (!bin) return bad(res, "bin is required");
    const payload = {
      bin: String(bin),
      counter: counter || "—",
      total: typeof total === "number" ? total : (Array.isArray(items) ? items.length : undefined),
      scanned: typeof scanned === "number" ? scanned : undefined,
      missing: typeof missing === "number" ? missing : undefined,
      items: Array.isArray(items) ? items : undefined,
      missingImeis: Array.isArray(missingImeis) ? missingImeis : undefined,
      state: "investigation",
      started: started || undefined,
      updated: updated || undefined,
      submittedAt: new Date().toISOString(),
    };

    await Store.upsertBin(payload);
    return ok(res, { ok: true });
  } catch (e) {
    return bad(res, String(e.message || e));
  }
};
