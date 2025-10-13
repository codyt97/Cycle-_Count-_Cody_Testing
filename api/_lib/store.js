// api/_lib/store.js
/* Unified storage adapter: prefers Vercel KV (Upstash KV REST), falls back to Redis (ioredis), then in-memory */

const { randomUUID } = require("crypto");

// ---- KV (Vercel/Upstash) wiring via REST ----
const KV_URL   = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";
const hasKV    = !!(KV_URL && KV_TOKEN);

async function kvFetch(path, init = {}) {
  const url = `${KV_URL.replace(/\/+$/,"")}/${path.replace(/^\/+/,"")}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`KV ${path} ${res.status}: ${txt}`);
  }
  return res.json();
}
async function kvGet(key)  { const out = await kvFetch(`get/${encodeURIComponent(key)}`); return out?.result ?? null; }
async function kvSet(key,v){ const s = typeof v==="string"?v:JSON.stringify(v); await kvFetch(`set/${encodeURIComponent(key)}`,{method:"POST",body:JSON.stringify({value:s})}); }

// ---- Redis wiring (legacy fallback) ----
let redis = null;
try {
  if (!hasKV && process.env.REDIS_URL) {
    const Redis = require("ioredis");
    redis = new Redis(process.env.REDIS_URL, { lazyConnect:true, maxRetriesPerRequest:3, enableAutoPipelining:true });
    redis.on("error", e => console.error("[redis] error:", e?.message || e));
  }
} catch (e) {
  console.error("[redis] init failed:", e?.message || e);
  redis = null;
}

// ---- Keys ----
const K_INV_DATA = "inventory:data";
const K_INV_META = "inventory:meta";
const K_CC_BINS  = "cc:bins";
const K_CC_AUDIT = "cc:audits";

// ---- In-memory fallback (per instance) ----
const mem = { [K_INV_DATA]:[], [K_INV_META]:null, [K_CC_BINS]:[], [K_CC_AUDIT]:[] };

async function getJSON(key, fallback) {
  if (hasKV) {
    try {
      const raw = await kvGet(key);
      if (raw == null) return fallback;
      try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return raw; }
    } catch (e) { console.error("[kv] get fail", key, e?.message || e); }
  }
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw == null) return fallback;
      try { return JSON.parse(raw); } catch { return raw; }
    } catch (e) { console.error("[redis] get fail", key, e?.message || e); }
  }
  return (key in mem) ? mem[key] : fallback;
}
async function setJSON(key, value) {
  if (hasKV) { try { await kvSet(key, value); return; } catch (e) { console.error("[kv] set fail", key, e?.message || e); } }
  if (redis) { try { await redis.set(key, JSON.stringify(value)); return; } catch (e) { console.error("[redis] set fail", key, e?.message || e); } }
  mem[key] = value;
}
const nowISO = () => new Date().toISOString();

// ---- Inventory snapshot ----
async function getInventory()         { return getJSON(K_INV_DATA, []); }
async function setInventory(rows)     { await setJSON(K_INV_DATA, Array.isArray(rows)?rows:[]); return (rows||[]).length; }
async function getInventoryMeta()     { return getJSON(K_INV_META, null); }
async function setInventoryMeta(meta) { const m={...(meta||{}),updatedAt:(meta&&meta.updatedAt)||nowISO()}; await setJSON(K_INV_META,m); return m; }
async function findByIMEI(imei) {
  const t = String(imei||"").trim(); if (!t) return null;
  const all = await getInventory();
  const cols = ["systemImei","imei","serial","serialNo","lotSerial","lot or serial","lotorserialno"];
  return all.find(r => cols.some(c => String(r?.[c]||"").trim() === t)) || null;
}

// ---- Cycle Count bins ----
async function listBins() { const bins = await getJSON(K_CC_BINS, []); return Array.isArray(bins)?bins:[]; }
async function upsertBin(binObj){
  const code = String(binObj?.bin || binObj?.location || "").trim(); if (!code) throw new Error("bin code required");
  const bins = await listBins();
  const idx = bins.findIndex(b => String(b.bin||"").toLowerCase() === code.toLowerCase());
  const base = { id: (binObj?.id) || randomUUID(), bin: code, state: binObj?.state || "open", startedAt: binObj?.startedAt || nowISO(), updatedAt: nowISO(), escalatedBy: binObj?.escalatedBy, escalatedAt: binObj?.escalatedAt };
  if (idx === -1) bins.push({ ...base, ...(binObj||{}) });
  else bins[idx] = { ...(bins[idx]||{}), ...(binObj||{}), updatedAt: nowISO() };
  await setJSON(K_CC_BINS, bins);
  return idx === -1 ? bins[bins.length-1] : bins[idx];
}
async function escalateBin(bin, actor){
  const code = String(bin||"").trim(); const bins = await listBins();
  const idx = bins.findIndex(b => String(b.bin||"").toLowerCase() === code.toLowerCase());
  if (idx === -1) return null;
  bins[idx] = { ...bins[idx], state:"supervisor", escalatedBy: actor || "—", escalatedAt: nowISO(), updatedAt: nowISO() };
  await setJSON(K_CC_BINS, bins); return bins[idx];
}

// ---- Wrong-bin audits ----
async function listAudits(){ return getJSON(K_CC_AUDIT, []); }
async function appendAudit(audit){
  const now = nowISO();
  const a = { id: randomUUID(), imei:String(audit?.imei||""), scannedBin:String(audit?.scannedBin||""), trueLocation:String(audit?.trueLocation||""), scannedBy:audit?.scannedBy||"—", status:(audit?.status||"open").toLowerCase(), createdAt:now, updatedAt:now, movedTo:audit?.movedTo, movedBy:audit?.movedBy };
  const all = await listAudits(); all.push(a); await setJSON(K_CC_AUDIT, all); return a;
}
async function patchAudit(id, patch){
  const all = await listAudits(); const idx = all.findIndex(x => String(x.id) === String(id));
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...(patch||{}), updatedAt: nowISO() }; await setJSON(K_CC_AUDIT, all); return all[idx];
}

module.exports = {
  nowISO,
  getInventory, setInventory, getInventoryMeta, setInventoryMeta, findByIMEI,
  listBins, upsertBin, escalateBin,
  listAudits, appendAudit, patchAudit,
};