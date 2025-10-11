// api/cyclecounts/submit.js
// Accepts a bin submission from the counter and persists:
// - the cycle count summary (user-scoped)
// - wrong-bin audits (buffered client-side) into the per-user audit set
//
// POST /api/cyclecounts/submit?user=<id>
// Body:
//  {
//    bin, counter, total, scanned, missing,
//    items: [{ location, sku, description, systemImei, scannedImei, qtyEntered?, systemQty? }, ...],
//    missingImeis: [ ... ],
//    nonSerialShortages?: [ ... ],
//    wrongBin?: [{ imei, scannedBin, trueLocation, status:"open", scannedBy, ts }]
//  }

let Store = null;
try { Store = require("../store"); } catch { /* fall back to in-memory */ }

// in-memory fallback (dev only)
const MEM = new Map();

function norm(s){ return String(s ?? "").trim(); }
function now(){ return new Date().toISOString(); }
function userFrom(req, body={}) {
  return String(req.query?.user || body.user || req.headers["x-user"] || "anon").toLowerCase();
}

async function readJSON(req){
  // handle vercel/node body variations safely
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch {}
  }
  return new Promise(resolve => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

function json(res, code, obj){
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User");
  res.end(JSON.stringify(obj));
}

async function kvGet(key){
  if (Store?.get) return await Store.get(key);
  if (Store?.read) return await Store.read(key);
  return MEM.get(key);
}
async function kvSet(key, value){
  if (Store?.set) return await Store.set(key, value);
  if (Store?.write) return await Store.write(key, value);
  MEM.set(key, value);
}

module.exports = async function handler(req, res){
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST")    { res.setHeader("Allow","POST,OPTIONS"); return json(res,405,{ ok:false, error:"method_not_allowed" }); }

  try {
    const body = await readJSON(req);
    const user = userFrom(req, body);

    // ------ basic payload normalization ------
    const bin      = norm(body.bin);
    const counter  = norm(body.counter || "");
    const total    = Number.isFinite(+body.total)   ? +body.total   : 0;
    const scanned  = Number.isFinite(+body.scanned) ? +body.scanned : 0;
    const missing  = Number.isFinite(+body.missing) ? +body.missing : Math.max(0, total - scanned);

    const items = Array.isArray(body.items) ? body.items : [];
    const missingImeis       = Array.isArray(body.missingImeis)       ? body.missingImeis       : [];
    const nonSerialShortages = Array.isArray(body.nonSerialShortages) ? body.nonSerialShortages : [];

    // client-buffered wrong-bin list (to be persisted now)
    const wrongBin = Array.isArray(body.wrongBin) ? body.wrongBin : [];

    if (!bin) return json(res, 400, { ok:false, error:"missing_bin" });

    // ------ persist wrong-bin audits into per-user set ------
    // audits live under key: wrong_bin_audits:<user>
    const auditKey = `wrong_bin_audits:${user}`;
    const existingAudits = (await kvGet(auditKey)) || [];
    const openByImei = new Map(existingAudits.filter(a => (a.status||"").toLowerCase()==="open")
                                                .map(a => [String(a.imei||"").trim(), a]));
    let mutate = false;

    for (const wb of wrongBin) {
      const imei = norm(wb.imei);
      if (!imei) continue;

      const scannedBin = norm(wb.scannedBin);
      const trueLoc    = norm(wb.trueLocation);
      const scannedBy  = norm(wb.scannedBy || counter || "—");

      if (openByImei.has(imei)) {
        // merge light updates
        const row = openByImei.get(imei);
        row.scannedBin   ||= scannedBin;
        row.trueLocation ||= trueLoc;
        row.scannedBy    ||= scannedBy;
        row.updatedAt = now();
        mutate = true;
      } else {
        existingAudits.unshift({
          id: (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
               : String(Date.now()) + Math.random().toString(16).slice(2),
          user,
          imei,
          scannedBin,
          trueLocation: trueLoc,
          scannedBy,
          status: "open",
          movedTo: "",
          movedBy: "",
          createdAt: now(),
          updatedAt: now()
        });
        mutate = true;
      }
    }
    if (mutate) await kvSet(auditKey, existingAudits);

    // ------ persist the cycle count summary (user + bin scoped) ------
    const recordKey = `cyclecount:${user}:${bin}`;
    const payload = {
      user, bin, counter,
      total, scanned, missing,
      items,
      missingImeis,
      nonSerialShortages,
      state: missing > 0 ? "investigation" : "complete",
      submittedAt: now()
    };
    await kvSet(recordKey, payload);

    return json(res, 200, { ok:true, bin, state: payload.state, submittedAt: payload.submittedAt });
  } catch (err) {
    // never throw raw; return a stable error object
    return json(res, 500, { ok:false, error:"submit_failed", detail: String(err && err.message || err) });
  }
};
