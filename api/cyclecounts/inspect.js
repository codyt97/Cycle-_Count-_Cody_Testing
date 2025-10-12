/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET") return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  const bin = String(req.query.bin || "").trim();
  if (!bin) return bad(res, "bin is required", 400);

  const all = await Store.listBins();                                        // :contentReference[oaicite:0]{index=0}
  // pick latest by submitted/updated
  let latest = null, bestT = -1;
  for (const b of all) {
    if (String(b.bin||"").toLowerCase() !== bin.toLowerCase()) continue;
    const t = Date.parse(b.submittedAt || b.updatedAt || b.started || 0) || 0;
    if (t > bestT) { bestT = t; latest = b; }
  }
  if (!latest) return ok(res, { found:false });

  return ok(res, {
    found: true,
    bin: latest.bin,
    counter: latest.counter,
    total: latest.total,
    scanned: latest.scanned,
    missing: latest.missing,
    missingImeisCount: Array.isArray(latest.missingImeis) ? latest.missingImeis.length : 0,
    nonSerialShortages: latest.nonSerialShortages || [],
    itemsCount: Array.isArray(latest.items) ? latest.items.length : 0,
  });
};
