// api/cyclecounts/escalate.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "POST") return method(res, ["POST", "OPTIONS"]);
  withCORS(res);

  try {
    const { bin, actor } = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) || {};
    if (!bin) return bad(res, "bin is required");
    const out = await Store.escalateBin(bin, actor);
    if (!out) return bad(res, "bin not found", 404);
    return ok(res, { ok: true, record: out });
  } catch (e) {
    return bad(res, String(e.message || e));
  }
};
