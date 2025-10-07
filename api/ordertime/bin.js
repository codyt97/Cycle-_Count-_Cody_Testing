// api/ordertime/bin.js
const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

const RT_INV_BY_BIN = 1141;  // inventory-by-bin (tenant-specific)
const RT_INV_SUMMARY = 151;  // inventory summary fallback

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")      return method(res, ["GET", "OPTIONS"]);

  // Use req.query instead of new URL(req.url) to avoid ERR_INVALID_URL on Vercel
  const bin = String(req.query.bin || "").trim();
  if (!bin) return bad(res, "bin is required", 400);

  try {
    console.log(`[BIN] Querying ${RT_INV_BY_BIN} by BinRef.Name="${bin}"`);
    const pageSize = 50;

    let rows = await otList({
      Type: RT_INV_BY_BIN,
      Filters: [{ PropertyName: "BinRef.Name", Operator: 1, FilterValueArray: [bin] }],
      PageNumber: 1,
      NumberOfRecords: pageSize
    });

    // Optional fallback if your tenant doesn’t populate 1141 as expected
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`[BIN] 1141 returned 0; trying ${RT_INV_SUMMARY}`);
      rows = await otList({
        Type: RT_INV_SUMMARY,
        Filters: [{ PropertyName: "BinRef.Name", Operator: 1, FilterValueArray: [bin] }],
        PageNumber: 1,
        NumberOfRecords: pageSize
      });
    }

    // Map to fields your table can show (SKU, description, IMEI if present)
    const mapped = (rows || []).map(r => ({
      sku:         r?.ItemRef?.Code || r?.ItemRef?.Name || r?.ItemCode || "",
      description: r?.Description || r?.ItemRef?.Name || r?.ItemName || "",
      imei:        r?.LotOrSerialNo || r?.LotOrSerialRef?.Name || "",
      bin:         r?.BinRef?.Name || r?.LocationBinRef?.Name || "",
      location:    r?.LocationRef?.Name || "",
      available:   r?.Available ?? r?.Quantity ?? 0
    }));

    console.log(`[BIN] page 1 → ${mapped.length} rows`);
    return ok(res, { bin, rows: mapped });
  } catch (e) {
    console.error("[BIN] error", e);
    return bad(res, String(e.message || e), 502);
  }
};
