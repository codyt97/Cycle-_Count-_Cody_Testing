const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

const RT_INV_BY_BIN = 1141;
const RT_LOT_SERIAL = 1100;

async function findIn1141(imei) {
  const rows = await otList({
    Type: RT_INV_BY_BIN,
    Filters: [{ PropertyName: "LotOrSerialNo", Operator: 1, FilterValueArray: [imei] }],
    PageNumber: 1, NumberOfRecords: 1,
  });
  const r = rows?.[0]; if (!r) return null;
  return {
    imei,
    location:    r?.BinRef?.Name || r?.LocationBinRef?.Name || r?.LocationRef?.Name || "",
    sku:         r?.ItemRef?.Code || r?.ItemCode || "",
    description: r?.ItemRef?.Name || r?.Description || "",
  };
}

async function findIn1100(imei) {
  const rows = await otList({
    Type: RT_LOT_SERIAL,
    Filters: [{ PropertyName: "LotOrSerialNo", Operator: 1, FilterValueArray: [imei] }],
    PageNumber: 1, NumberOfRecords: 1,
  });
  const r = rows?.[0]; if (!r) return null;
  return {
    imei,
    location:    r?.LocationBinRef?.Name || r?.LocationRef?.Name || "",
    sku:         r?.ItemRef?.Code || r?.ItemCode || "",
    description: r?.ItemRef?.Name || r?.ItemName || "",
  };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")      return method(res, ["GET", "OPTIONS"]);

  const imei = String(req.query.imei || "").trim();
  if (!imei) return bad(res, "imei is required", 400);

  try {
    let hit = await findIn1141(imei);
    if (!hit) hit = await findIn1100(imei);
    return ok(res, hit || {}); // {} => not found (UI shows warning)
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
