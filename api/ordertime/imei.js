// api/ordertime/imei.js
const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

// Finds the current bin/location for a single IMEI/Serial.
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);

  const imei = String(req.query.imei || "").trim();
  if (!imei) return bad(res, "imei is required", 400);

  try {
    const Type = "LotOrSerialNo"; // or the entity that indexes IMEIs
    const Filters = [
      { Prop: "LotOrSerialNo", Op: "=", Value: imei }
    ];
    const recs = await otList({ Type, Filters, PageNumber: 1, NumberOfRecords: 1 });
    const r = recs[0];
    if (!r) return ok(res, {}); // UI treats missing as "not found in ERP"

    return ok(res, {
      imei,
      location: r?.LocationBinRef?.Name || r?.LocationRef?.Name || "",
      sku: r?.ItemRef?.Code || r?.ItemCode || "",
      description: r?.ItemRef?.Name || r?.ItemName || ""
    });
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
