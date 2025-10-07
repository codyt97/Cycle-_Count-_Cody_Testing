// api/ordertime/diag.js
const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);

  try {
    // a harmless tiny request; "LotOrSerialNo" generally exists in all tenants
    const test = await otList({ Type: "LotOrSerialNo", Filters: [], PageNumber: 1, NumberOfRecords: 1 });
    return ok(res, { ok: true, sampleCount: Array.isArray(test) ? test.length : 0 });
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
