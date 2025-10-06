// api/cyclecounts/not-scanned.js
const { ok, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);

  const bins = await Store.listBins();

  const records = [];
  for (const b of bins) {
    // preferred: explicit missing list
    if (Array.isArray(b.missingImeis) && b.missingImeis.length) {
      for (const m of b.missingImeis) {
        records.push({
          bin: b.bin,
          sku: m.sku || "—",
          description: m.description || "—",
          systemImei: String(m.systemImei || m.imei || ""),
        });
      }
      continue;
    }
    // fallback: derive from items
    if (Array.isArray(b.items) && b.items.length) {
      for (const it of b.items) {
        const matched = it.scannedImei && String(it.scannedImei) === String(it.systemImei);
        if (!matched) {
          records.push({
            bin: b.bin,
            sku: it.sku || "—",
            description: it.description || "—",
            systemImei: String(it.systemImei || ""),
          });
        }
      }
    }
  }

  return ok(res, { records });
};
