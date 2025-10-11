// api/cyclecounts/not-scanned.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  withCORS(res);

  // --------------------------
  // GET  -> list all not-scanned (serial + non-serial), include counter
  // DELETE -> remove a specific not-scanned entry from a bin
  // --------------------------
  if (req.method === "GET") {
    const wantUser = String(req.query?.user || "").toLowerCase();
    const binsAll = await Store.listBins();
    // Investigator default: show ALL bins unless explicitly filtered
    const bins = wantUser ? binsAll.filter(b => String(b.user||"").toLowerCase() === wantUser) : binsAll;
    const records = [];



    for (const b of bins) {
      // Serial shortages
      if (Array.isArray(b.missingImeis)) {
        for (const m of b.missingImeis) {
          records.push({
            bin: b.bin,
            counter: b.counter || "—",   // <-- include who did the cycle count
            sku: m.sku || "—",
            description: m.description || "—",
            systemImei: String(m.systemImei || m.imei || ""),
            type: "serial"
          });
        }
      }

      // Non-serial shortages
      if (Array.isArray(b.nonSerialShortages)) {
        for (const s of b.nonSerialShortages) {
          records.push({
            bin: b.bin,
            counter: b.counter || "—",   // <-- include who did the cycle count
            sku: s.sku || "—",
            description: s.description || "—",
            systemImei: "",
            systemQty: s.systemQty,
            qtyEntered: s.qtyEntered,
            type: "nonserial"
          });
        }
      }
    }

    return ok(res, { records });
  }

  if (req.method === "DELETE") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const binCode = String(body.bin || "").trim().toLowerCase();
      const type = String(body.type || "").trim().toLowerCase(); // "serial" | "nonserial"
      if (!binCode || !type) return bad(res, "bin and type are required", 400);

      const user = String((typeof req.body === "string" ? JSON.parse(req.body||"{}") : req.body || {}).user || req.query?.user || "").toLowerCase();
const binsAll = await Store.listBins();
const bins = user ? binsAll.filter(b => String(b.user||"").toLowerCase() === user) : binsAll;
const idx = bins.findIndex(x => String(x.bin || "").trim().toLowerCase() === binCode);

      if (idx === -1) return bad(res, "bin not found", 404);

      const bin = { ...bins[idx] };

      if (type === "serial") {
        const imei = String(body.systemImei || body.imei || "").trim();
        if (!imei) return bad(res, "systemImei is required for serial delete", 400);
        bin.missingImeis = (bin.missingImeis || []).filter(x =>
          String(x.systemImei || x.imei || "").trim() !== imei
        );
      } else if (type === "nonserial") {
        const sku = String(body.sku || "").trim();
        if (!sku) return bad(res, "sku is required for nonserial delete", 400);
        bin.nonSerialShortages = (bin.nonSerialShortages || []).filter(x =>
          String(x.sku || "").trim() !== sku
        );
      } else {
        return bad(res, "invalid type", 400);
      }

      // Recompute missing count for display (not strictly necessary)
      const serialMissing = (bin.missingImeis || []).length;
      const nonSerialMissing = (bin.nonSerialShortages || [])
        .reduce((a, s) => a + Math.max(Number(s.systemQty || 0) - Number(s.qtyEntered || 0), 0), 0);
      bin.missing = serialMissing + nonSerialMissing;

      // Persist
      await Store.upsertBin(bin);
      return ok(res, { ok: true });
    } catch (e) {
      return bad(res, "delete failed: " + (e?.message || String(e)), 500);
    }
  }

  return method(res, ["GET", "DELETE", "OPTIONS"]);
};
