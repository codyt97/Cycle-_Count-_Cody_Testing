// api/cyclecounts/not-scanned.js
const { ok, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);

  const bins = await Store.listBins();
  const records = [];

  for (const b of bins) {
    // Serial shortages (preferred explicit list)
    if (Array.isArray(b.missingImeis) && b.missingImeis.length) {
      for (const m of b.missingImeis) {
        records.push({
          bin: b.bin,
          sku: (m.sku || "—"),
          description: (m.description || "—"),
          systemImei: String(m.systemImei || m.imei || ""),
        });
      }
    } else if (Array.isArray(b.items) && b.items.length) {
      // Fallback serial derivation from items list
      for (const it of b.items) {
        const matched = it.scannedImei && String(it.scannedImei) === String(it.systemImei);
        if (!matched && it.systemImei) {
          records.push({
            bin: b.bin,
            sku: it.sku || "—",
            description: it.description || "—",
            systemImei: String(it.systemImei || ""),
          });
        }
      }
    }

    // Non-serial shortages (new)
    if (Array.isArray(b.nonSerialShortages) && b.nonSerialShortages.length) {
      for (const s of b.nonSerialShortages) {
        records.push({
          bin: b.bin,
          sku: s.sku || "—",
          description: s.description || "—",
          systemImei: "", // none
          systemQty: s.systemQty,
          qtyEntered: s.qtyEntered
        });
      }
    }
  }

  return ok(res, { records });
};
