// api/_lib/store.js
const { randomUUID } = require("crypto");
let redis = null;

// --- Redis wiring ---
try {
  if (process.env.REDIS_URL) {
    const Redis = require("ioredis");
    redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableAutoPipelining: true,
    });
    redis.on("error", (e) => console.error("[redis] error:", e?.message || e));
  }
} catch (e) {
  console.error("[redis] client load failed:", e?.message || e);
}

// --- Keys ---
const K_INV_DATA = "inventory:data";
const K_INV_META = "inventory:meta";
const K_CC_BINS  = "cc:bins";
const K_CC_AUDIT = "cc:audits";

// --- In-memory fallback (per instance) ---
const mem = {
  [K_INV_DATA]: [],
  [K_INV_META]: null,
  [K_CC_BINS]:  [],
  [K_CC_AUDIT]: [],
};

// --- helpers ---
async function getJSON(key, fallback) {
  if (redis) {
    try {
      const v = await redis.get(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      console.error("[redis] get fail", key, e?.message || e);
    }
  }
  return mem[key] ?? fallback;
}
async function setJSON(key, value) {
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(value));
      return;
    } catch (e) {
      console.error("[redis] set fail", key, e?.message || e);
    }
  }
  mem[key] = value;
}
const nowISO = () => new Date().toISOString();

// --- Inventory snapshot (from Google Sheet) ---
async function getInventory()         { return getJSON(K_INV_DATA, []); }
async function setInventory(rows)     { await setJSON(K_INV_DATA, Array.isArray(rows)?rows:[]); return (rows||[]).length; }
async function getInventoryMeta()     { return getJSON(K_INV_META, null); }
async function setInventoryMeta(meta) { const m={...(meta||{}),updatedAt:meta?.updatedAt||nowISO()}; await setJSON(K_INV_META,m); return m; }
/** Find by exact IMEI / Serial in the snapshot */
async function findByIMEI(imei) {
  const t = String(imei||"").trim();
  if (!t) return null;
  const all = await getInventory();
  return all.find(r => String(r.systemImei||"").trim() === t) || null;
}

// --- Cycle count bins (submit) ---
async function listBins() { return getJSON(K_CC_BINS, []); }
/** Upsert a bin record by code (case-insensitive). */
async function upsertBin(payload) {
  const bin = String(payload?.bin || "").trim();
  if (!bin) throw new Error("bin is required");

  const bins = await listBins();
  const idx = bins.findIndex(b => String(b.bin || "").toLowerCase() === bin.toLowerCase());

const merged = {
  id: (idx !== -1 ? bins[idx].id : (payload.id || randomUUID())),
  bin,
  user: payload.user ?? bins[idx]?.user,
  counter: payload.counter ?? bins[idx]?.counter ?? "—",
  total: payload.total ?? bins[idx]?.total,
  scanned: payload.scanned ?? bins[idx]?.scanned,
  missing: payload.missing ?? bins[idx]?.missing,
  items: Array.isArray(payload.items) ? payload.items : bins[idx]?.items,
  missingImeis: Array.isArray(payload.missingImeis) ? payload.missingImeis : bins[idx]?.missingImeis,
  nonSerialShortages: Array.isArray(payload.nonSerialShortages) ? payload.nonSerialShortages : bins[idx]?.nonSerialShortages,
  state: payload.state || bins[idx]?.state || "investigation",
  started: bins[idx]?.started || payload.started || nowISO(), // preserve original
  updatedAt: nowISO(),
  submittedAt: payload.submittedAt || nowISO(),
};



  if (idx === -1) bins.push(merged);
  else            bins[idx] = { ...bins[idx], ...merged, bin, updatedAt: nowISO() };

  await setJSON(K_CC_BINS, bins);
  return idx === -1 ? bins[bins.length-1] : bins[idx];
}
async function escalateBin(bin, actor) {
  const code = String(bin || "").trim();
  const bins = await listBins();
  const idx = bins.findIndex(b => String(b.bin || "").toLowerCase() === code.toLowerCase());
  if (idx === -1) return null;
  bins[idx] = { ...bins[idx], state: "supervisor", escalatedBy: actor||"—", escalatedAt: nowISO(), updatedAt: nowISO() };
  await setJSON(K_CC_BINS, bins);
  return bins[idx];
}

// --- Wrong-bin audits ---
async function listAudits() { return getJSON(K_CC_AUDIT, []); }
/** Append wrong-bin audit */
async function appendAudit(audit) {
  const now = nowISO();
  const a = {
    id: randomUUID(),
    imei: String(audit?.imei || ""),
    scannedBin: String(audit?.scannedBin || ""),
    trueLocation: String(audit?.trueLocation || ""),
    scannedBy: audit?.scannedBy || "—",
    status: (audit?.status || "open").toLowerCase(), // open|moved|closed|invalid
    createdAt: now,
    updatedAt: now,
    movedTo: audit?.movedTo,
    movedBy: audit?.movedBy,
    decision: audit?.decision,
    decidedBy: audit?.decidedBy,
  };
  if (!a.imei || !a.scannedBin) throw new Error("imei and scannedBin are required");

  const all = await listAudits();
  // IDEMPOTENT: if an OPEN record for the same IMEI exists, update it instead of duplicating
  const idx = all.findIndex(x => String(x.imei).trim() === a.imei && String(x.status||"open") === "open");
  if (idx !== -1) {
    all[idx] = { ...all[idx],
      scannedBin: all[idx].scannedBin || a.scannedBin,
      trueLocation: all[idx].trueLocation || a.trueLocation,
      scannedBy: all[idx].scannedBy || a.scannedBy,
      updatedAt: nowISO()
    };
    await setJSON(K_CC_AUDIT, all);
    return all[idx];
  }

  all.push(a);
  await setJSON(K_CC_AUDIT, all);
  return a;
}

async function patchAudit(id, patch) {
  const all = await listAudits();
  const idx = all.findIndex(x => x.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch, updatedAt: nowISO() };
  await setJSON(K_CC_AUDIT, all);
  return all[idx];
}

module.exports = {
  // utils
  nowISO,
  // inventory
  getInventory, setInventory, getInventoryMeta, setInventoryMeta, findByIMEI,
  // cycle counts
  listBins, upsertBin, escalateBin,
  // audits
  listAudits, appendAudit, patchAudit,
};
