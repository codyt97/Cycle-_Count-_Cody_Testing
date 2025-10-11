// api/audit/wrong-bin.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  withCORS(res);

  if (req.method === "GET") {
    const list = await Store.listAudits();
    return ok(res, { audits: list });
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const a = await Store.appendAudit(body);
      return ok(res, { ok: true, audit: a });
    } catch (e) {
      return bad(res, "append failed: " + (e?.message || String(e)), 400);
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const { id, ...patch } = body || {};
      if (!id) return bad(res, "id required", 400);
      const a = await Store.patchAudit(id, patch);
      if (!a) return bad(res, "not found", 404);
      return ok(res, { ok: true, audit: a });
    } catch (e) {
      return bad(res, "patch failed: " + (e?.message || String(e)), 400);
    }
  }

  if (req.method === "DELETE") {
    try {
      const id = String((req.query?.id || req.body?.id || "")).trim();
      if (!id) return bad(res, "id required", 400);
      const okDel = await Store.deleteAudit(id);
      if (!okDel) return bad(res, "not found", 404);
      return ok(res, { ok: true, deleted: id });
    } catch (e) {
      return bad(res, "delete failed: " + (e?.message || String(e)), 400);
    }
  }

  return method(res, ["GET","POST","PATCH","DELETE","OPTIONS"]);
};
