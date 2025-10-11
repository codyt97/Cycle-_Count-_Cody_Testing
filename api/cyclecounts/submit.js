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

// Use the shared Store that Investigator pages read from
const Store = require("../_lib/store");


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

// No per-user KV; all persistence goes through the shared Store


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
    const missingImeis = Array.isArray(body.missingImeis) ? body.missingImeis : [];

    // Derive non-serial shortages if client didn't send them
    const nonSerialShortages = Array.isArray(body.nonSerialShortages) ? body.nonSerialShortages :
      items
        .filter(it => !String(it.systemImei || "").trim()) // non-serial rows only
        .map(it => ({
          sku: it.sku || "—",
          description: it.description || "—",
          systemQty: Number(it.systemQty || 0),
          qtyEntered: Number(it.qtyEntered || 0)
        }))
        .filter(s => s.qtyEntered < s.systemQty);


    // client-buffered wrong-bin list (to be persisted now)
    const wrongBin = Array.isArray(body.wrongBin) ? body.wrongBin : [];

    if (!bin) return json(res, 400, { ok:false, error:"missing_bin" });

    // ------ persist wrong-bin audits into the shared audit log ------
    if (Array.isArray(wrongBin) && wrongBin.length) {
      for (const wb of wrongBin) {
        const imei = norm(wb.imei);
        if (!imei) continue;
        await Store.appendAudit({
          imei,
          scannedBin:  norm(wb.scannedBin),
          trueLocation:norm(wb.trueLocation),
          scannedBy:   norm(wb.scannedBy || counter || "—"),
          status: "open",
        });
      }
    }


    // ------ persist the cycle count into the shared Store (read by Investigator/Summary) ------
        // Recompute final missing: serial deficits + non-serial deficits
    const serialMissing = missingImeis.length;
    const nonSerialMissing = nonSerialShortages.reduce(
      (a, s) => a + Math.max(Number(s.systemQty || 0) - Number(s.qtyEntered || 0), 0), 0);
    const finalMissing = Number.isFinite(+body.missing) ? +body.missing : (serialMissing + nonSerialMissing);

    const payload = {
      user, bin, counter,
      total, scanned, missing: finalMissing,
      items,
      missingImeis,
      nonSerialShortages,
      state: finalMissing > 0 ? "investigation" : "complete",
      started: body.started || undefined,
      submittedAt: now(),
    };

    await Store.upsertBin(payload);

    return json(res, 200, { ok:true, bin, state: payload.state, submittedAt: payload.submittedAt });

  } catch (err) {
    // never throw raw; return a stable error object
    return json(res, 500, { ok:false, error:"submit_failed", detail: String(err && err.message || err) });
  }
};
