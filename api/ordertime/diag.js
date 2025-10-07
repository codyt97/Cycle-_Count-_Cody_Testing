// api/ordertime/diag.js
const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")      return method(res, ["GET", "OPTIONS"]);

  try {
    const t0 = Date.now();
    const rows = await otList({ Type: 1141, Filters: [], PageNumber: 1, NumberOfRecords: 1 });
    const dt = Date.now() - t0;
    return ok(res, { ok: true, tookMs: dt, rows: Array.isArray(rows) ? rows.length : 0 });
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
