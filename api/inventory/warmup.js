// api/inventory/warmup.js
//
// POST /api/inventory/warmup
// Forces a rebuild from Google Sheet → seeds Store and Redis (if configured).
//
// Returns: { rebuilt: true, count }

const { ok, bad, method, withCORS } = require("../_lib/respond");
const { rebuildInventorySnapshot } = require("./bin-live");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "POST") return method(res, ["POST", "OPTIONS"]);
  withCORS(res);

  try {
    const rep = await rebuildInventorySnapshot();
    return ok(res, { rebuilt: true, count: rep.count });
  } catch (e) {
    const msg = e?.message || String(e);
    return bad(res, msg, 502);
  }
};