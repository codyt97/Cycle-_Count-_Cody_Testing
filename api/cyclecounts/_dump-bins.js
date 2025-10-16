// api/cyclecounts/_dump-bins.js
const { withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

function json(res, code, obj){
  res.statusCode = code;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin","*");
  res.end(JSON.stringify(obj, null, 2));
}
function norm(s){ return String(s ?? "").trim(); }

module.exports = async (req, res) => {
  if (req.method === "OPTIONS"){ withCORS(res); res.statusCode = 204; return res.end(); }
  if (req.method !== "GET") { withCORS(res); res.setHeader("Allow","GET,OPTIONS"); return json(res,405,{ ok:false, error:"method_not_allowed" }); }
  withCORS(res);

  try {
    const wantBin = norm(req.query?.bin || "");
    const bins = await Store.listBins();
    const rows = (Array.isArray(bins) ? bins : [])
      .filter(b => !wantBin || norm(b.bin).toLowerCase() === wantBin.toLowerCase())
      .map(b => ({
        bin: b.bin,
        user: b.user,
        counter: b.counter,
        started: b.started || b.startedAt,
        submittedAt: b.submittedAt || b.updatedAt,
        state: b.state,
        // tell us what fields actually exist:
        items_len: Array.isArray(b.items) ? b.items.length : 0,
        missingImeis_len: Array.isArray(b.missingImeis) ? b.missingImeis.length : 0,
        nonSerialShortages_len: Array.isArray(b.nonSerialShortages) ? b.nonSerialShortages.length : 0,
        // OPTIONAL peek at first few items:
        items_sample: Array.isArray(b.items) ? b.items.slice(0,3) : [],
        nonSerialShortages_sample: Array.isArray(b.nonSerialShortages) ? b.nonSerialShortages.slice(0,3) : [],
        missingImeis_sample: Array.isArray(b.missingImeis) ? b.missingImeis.slice(0,3) : []
      }));

    return json(res, 200, { ok:true, bins: rows });
  } catch (e) {
    return json(res, 500, { ok:false, error: String(e?.message || e) });
  }
};
