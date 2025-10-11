// api/_lib/store.js
const { randomUUID } = require("crypto");
let redis = null;

// --- Redis wiring (Redis Cloud or compatible) ---
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
const K_INV_DATA = "inventory:data"; // array of rows
const K_INV_META = "inventory:meta"; // { source, filename, count, updatedAt, ... }
const K_CC_BINS  = "cc:bins";        // array of submitted bin objects
const K_CC_AUDIT = "cc:audits";      // array of wrong-bin audit items

// --- In-memory fallback (per-instance; not persistent) ---
const mem = {
  [K_INV_DATA]: [],
  [K_INV_META]: null,
  [K_CC_BINS]:  [],
  [K_CC_AUDIT]: [],
};

// --- Helpers ---
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

function nowISO() { return new Date().toISOString(); }

// --- Inventory (Google Sheet snapshot) ---
async function getInventory() {
  return getJSON(K_INV_DATA, []);
}
async function setInventory(rows) {
  if (!Array.isArray(rows)) rows = [];
  await setJSON(K_INV_DATA, rows);
  return rows.length;
}
async function getInventoryMeta() {
  return getJSON(K_INV_META, null);
}
async function setInventoryMeta(meta) {
  const m = { ...(meta || {}), updatedAt: meta?.updatedAt || nowISO() };
  await setJSON(K_INV_META, m);
  return m;
}
/** Find by exact IMEI/serial (string compare). Returns the first match or null */
async function findByIMEI(imei) {
  const target = String(imei || "").trim();
  if (!target) return null;
  const all = await getInventory();
  return all.find(r => String(r.systemImei || "").trim() === target) || null;
}

// --- Cycle Count (bins) ---
async function listBins() {
  return getJSON(K_CC_BINS, []);
}
/**
 * Upsert a bin record by bin code (case-insensitive)
 * payload: { bin, counter, total, scanned, missing, items[], missingImeis[], state, started, updated }
 */
async function upsertBin(payload) {
  const bin = String(payload?.bin || "").trim();
  if (!bin) throw new Error("bin is required");

  const bins = await listBins();
  const idx = bins.findIndex(b => String(b.bin || "").toLowerCase() === bin.toLowerCase());

  const base = {
    id: payload.id || randomUUID(),
    bin,
    counter: payload.counter || "—",
    total: typeof payload.total === "number" ? payload.total : undefined,
    scanned: typeof payload.scanned === "number" ? payload.scanned : undefined,
    missing: typeof payload.missing === "number" ? payload.missing : undefined,
    items: Array.isArray(payload.items) ? payload.items : undefined,
    missingImeis: Array.isArray(payload.missingImeis) ? payload.missingImeis : undefined,
    state: payload.state || "investigation",
    started: payload.started || nowISO(),
    updatedAt: nowISO(),
    submittedAt: payload.submittedAt || nowISO(),
  };

  if (idx === -1) {
    bins.push(base);
  } else {
    bins[idx] = { ...bins[idx], ...base, bin, updatedAt: nowISO() };
  }

  await setJSON(K_CC_BINS, bins);
  return idx === -1 ? bins[bins.length - 1] : bins[idx];
}

async function escalateBin(bin, actor) {
  const code = String(bin || "").trim();
  const bins = await listBins();
  const idx = bins.findIndex(b => String(b.bin || "").toLowerCase() === code.toLowerCase());
  if (idx === -1) return null;
  bins[idx] = {
    ...bins[idx],
    state: "supervisor",
    escalatedBy: actor || "—",
    escalatedAt: nowISO(),
    updatedAt: nowISO(),
  };
  await setJSON(K_CC_BINS, bins);
  return bins[idx];
}

// --- Audits (wrong-bin) ---
async function listAudits() {
  return getJSON(K_CC_AUDIT, []);
}
/**
 * Append a wrong-bin audit item.
 * audit: { imei, scannedBin, trueLocation?, scannedBy?, status? }
 */
async function appendAudit(audit) {
  const a = {
    id: randomUUID(),
    imei: String(audit?.imei || ""),
    scannedBin: String(audit?.scannedBin || ""),
    trueLocation: audit?.trueLocation ? String(audit.trueLocation) : "",
    scannedBy: audit?.scannedBy || "—",
    status: audit?.status || "open", // open|moved|closed|invalid
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  if (!a.imei || !a.scannedBin) throw new Error("imei and scannedBin are required");
  const list = await listAudits();
  list.push(a);
  await setJSON(K_CC_AUDIT, list);
  return a;
}

/** Patch an audit item by id */
async function patchAudit(id, patch) {
  const list = await listAudits();
  const idx = list.findIndex(x => x.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: nowISO() };
  await setJSON(K_CC_AUDIT, list);
  return list[idx];
}

module.exports = {
  randomUUID,
  nowISO,

  // Inventory
  getInventory,
  setInventory,
  getInventoryMeta,
  setInventoryMeta,
  findByIMEI,

  // Cycle counts
  listBins,
  upsertBin,
  escalateBin,

  // Audits
  listAudits,
  appendAudit,
  patchAudit,
};
