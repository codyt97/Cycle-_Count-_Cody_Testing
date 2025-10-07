// api/ordertime/imei.js
const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

// IMEI/Serial lookup across likely Types/Props
const TYPE_PROP_PAIRS = [
  { Type: "LotOrSerialNo", Prop: "LotOrSerialNo" },   // common
  { Type: "InventoryLotSerial", Prop: "LotOrSerialNo" },
  { Type: "ItemLocationSerial", Prop: "SerialNo" },   // alt field name
];

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);

  const imei = String(req.query.imei || "").trim();
  if (!imei) return bad(res, "imei is required", 400);

  try {
    let rec = null;
    for (const { Type, Prop } of TYPE_PROP_PAIRS) {
      const list = await otList({
        Type,
        Filters: [{ Prop, Op: "=", Value: imei }],
        PageNumber: 1,
        NumberOfRecords: 1,
      });
      if (list && list[0]) { rec = list[0]; break; }
    }

    if (!rec) return ok(res, {}); // UI handles "not found in ERP"

    return ok(res, {
      imei,
      location: rec?.LocationBinRef?.Name || rec?.LocationRef?.Name || "",
      sku: rec?.ItemRef?.Code || rec?.ItemCode || "",
      description: rec?.ItemRef?.Name || rec?.ItemName || "",
    });
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
