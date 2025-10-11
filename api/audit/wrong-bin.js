// api/audit/wrong-bin.js  (user-scoped)
const { randomUUID } = require("crypto");
let Store = null;
try { Store = require("../store"); } catch {}

const MEM = new Map(); // per-user fallback (dev)

const norm = s => String(s||"").trim();
const safeImei = s => norm(s).replace(/[^\w\-]+/g,"");
const now = () => new Date().toISOString();
const getUser = (req, body={}) =>
  String(req.query?.user || body.user || req.headers["x-user"] || "anon").toLowerCase();

const keyFor = user => `wrong_bin_audits:${user}`;

async function loadAudits(user){
  if (Store?.get)  return (await Store.get(keyFor(user)))  || [];
  if (Store?.read) return (await Store.read(keyFor(user))) || [];
  return MEM.get(user) || [];
}
async function saveAudits(user, audits){
  if (Store?.set)   return Store.set(keyFor(user), audits);
  if (Store?.write) return Store.write(keyFor(user), audits);
  MEM.set(user, audits);
}

function json(res, code, obj){
  res.statusCode = code;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, X-User");
  res.end(JSON.stringify(obj));
}

async function readBody(req){
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) { try { return JSON.parse(req.body); } catch {} }
  return new Promise(resolve=>{
    let data=""; req.on("data",c=>data+=c); req.on("end",()=>{ try{resolve(data?JSON.parse(data):{})}catch{resolve({})} });
  });
}

module.exports = async function handler(req,res){
  if (req.method === "OPTIONS"){ res.statusCode=204; return res.end(); }

  // GET: list audits for this user
  if (req.method === "GET"){
    const user = getUser(req);
    const audits = await loadAudits(user);
    return json(res,200,{ ok:true, audits });
  }

  // POST: create/open (idempotent on user+IMEI+'open')
  if (req.method === "POST"){
    const body = await readBody(req);
    const user = getUser(req, body);
    const imei = safeImei(body.imei);
    const scannedBin = norm(body.scannedBin);
    const trueLocation = norm(body.trueLocation);
    const status = (norm(body.status)||"open").toLowerCase();
    const scannedBy = norm(body.scannedBy);
    if (!imei || !scannedBin || !trueLocation){
      return json(res,400,{ ok:false, error:"missing_required_fields", need:["imei","scannedBin","trueLocation"]});
    }
    const audits = await loadAudits(user);
    const existing = audits.find(a => a.imei===imei && a.status==="open");
    if (existing){
      if (scannedBy && !existing.scannedBy) existing.scannedBy = scannedBy;
      if (scannedBin && !existing.scannedBin) existing.scannedBin = scannedBin;
      if (trueLocation && !existing.trueLocation) existing.trueLocation = trueLocation;
      existing.updatedAt = now();
      await saveAudits(user, audits);
      return json(res,200,{ ok:true, audit: existing, audits });
    }
    const audit = {
      id: randomUUID(),
      user, imei, scannedBin, trueLocation,
      status, scannedBy, movedTo:"", movedBy:"",
      createdAt: now(), updatedAt: now()
    };
    audits.unshift(audit);
    await saveAudits(user, audits);
    return json(res,200,{ ok:true, audit, audits });
  }

  // PATCH: update (e.g., mark moved)
  if (req.method === "PATCH"){
    const body = await readBody(req);
    const user = getUser(req, body);
    const id = norm(body.id);
    if (!id) return json(res,400,{ ok:false, error:"missing_id" });

    const audits = await loadAudits(user);
    const idx = audits.findIndex(a => norm(a.id)===id);
    if (idx === -1) return json(res,404,{ ok:false, error:"not_found" });

    const patch = {};
    if (body.status!=null) patch.status = norm(body.status).toLowerCase();
    if (body.movedTo!=null) patch.movedTo = norm(body.movedTo);
    if (body.movedBy!=null) patch.movedBy = norm(body.movedBy);
    if (patch.status==="moved" && !patch.movedTo) patch.movedTo = audits[idx].trueLocation || "";

    audits[idx] = { ...audits[idx], ...patch, updatedAt: now() };
    await saveAudits(user, audits);
    return json(res,200,{ ok:true, audit: audits[idx], audits });
  }

  // DELETE: remove by id
  if (req.method === "DELETE"){
    const body = await readBody(req);
    const user = getUser(req, body);
    const id = norm(req.query?.id || body.id || "");
    if (!id) return json(res,400,{ ok:false, error:"missing_id" });
    const audits = await loadAudits(user);
    const idx = audits.findIndex(a => norm(a.id)===id);
    if (idx === -1) return json(res,404,{ ok:false, error:"not_found" });
    const [removed] = audits.splice(idx,1);
    await saveAudits(user, audits);
    return json(res,200,{ ok:true, audit: removed, audits });
  }

  res.setHeader("Allow","GET,POST,PATCH,DELETE,OPTIONS");
  return json(res,405,{ ok:false, error:"method_not_allowed" });
};
