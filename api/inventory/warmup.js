// /api/inventory/warmup.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const { loadInventoryToRedis } = require("./bin-live");

module.exports = withCORS(async (req, res) => {
  if (req.method !== "POST") return method(res, ["POST"]);
  try {
    const meta = await loadInventoryToRedis();
    return ok(res, { rebuilt: true, meta });
  } catch (err) {
    return bad(res, err?.message || String(err));
  }
});