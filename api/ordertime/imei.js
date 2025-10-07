// api/ordertime/imei.js
// Looks up a single IMEI/Serial and returns its current location/SKU/description

const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

// RecordTypeEnum
const RT_LOT_SERIAL = 1100; // Lot or Serial Number

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")      return method(res, ["GET", "OPTIONS"]);

  const imei = String(req.query.imei || "").trim();
  if (!imei) return bad(res, "imei is required", 400);

  try {
    const rows = await otList({
      Type: RT_LOT_SERIAL,
      Filters: [{ PropertyName: "LotOrSerialNo", Operator: 1, FilterValueArray: imei }], // EqualTo
      PageNumber: 1,
      NumberOfRecords: 1,
    });

    const r = rows?.[0];
    if (!r) return ok(res, {}); // UI treats missing as "not found in ERP"

    return ok(res, {
      imei,
      location:    r?.LocationBinRef?.Name || r?.LocationRef?.Name || "",
      sku:         r?.ItemRef?.Code || r?.ItemCode || "",
      description: r?.ItemRef?.Name || r?.ItemName || "",
    });
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
