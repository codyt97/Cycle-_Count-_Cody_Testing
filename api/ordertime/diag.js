const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")      return method(res, ["GET", "OPTIONS"]);

  try {
    const result = await otList({ Type: 1100, Filters: [], PageNumber: 1, NumberOfRecords: 1 });
    return ok(res, { ok: true, count: Array.isArray(result) ? result.length : 0 });
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
