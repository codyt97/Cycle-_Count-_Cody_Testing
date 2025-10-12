// api/cyclecounts/start.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

function norm(s){ return String(s ?? "").trim(); }
const nowISO = () => new Date().toISOString();

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "POST")     return method(res, ["POST","OPTIONS"]);
  withCORS(res);

  try {
    const { bin, counter } = (typeof req.body === "string" ? JSON.parse(req.body||"{}") : (req.body || {}));
    const code = norm(bin);
    const who  = norm(counter) || "—";
    if (!code) return bad(res, "bin is required", 400);

    // Upsert with *preserve-first-started* semantics (Store.upsertBin already preserves existing started) :contentReference[oaicite:0]{index=0}
    const rec = await Store.upsertBin({ bin: code, counter: who, started: nowISO() });  // started used only if none exists
    return ok(res, { ok:true, record: rec });
  } catch (e) {
    return bad(res, String(e.message || e), 500);
  }
};
