// api/_lib/store.js
// Central data access layer.
// - Uses Redis when REDIS_URL is set
// - Falls back to in-memory store for local/dev

const { randomUUID } = require("crypto");

let redis = null;

// ---------- Redis wiring ----------
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
  console.error("[redis] init failed:", e?.message || e);
}

// ---------- In-memory fallback ----------
const mem = Object.create(null);

// ---------- Low-level JSON helpers ----------
async function getJSON(key, fallback) {
  if (redis) {
    try {
      if (!redis.status || redis.status === "end") await redis.connect();
      const raw = await redis.get(key);
      if (raw == null) return fallback;
      try { return JSON.parse(raw); } catch { return fallback; }
    } catch (e) {
      console.error(`[store] getJSON ${key} failed:`, e?.message || e);
      return fallback;
    }
  }
  return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : fallback;
}

async function setJSON(key, value) {
  if (redis) {
    try {
      if (!redis.status || redis.status === "end") await redis.connect();
      await redis.set(key, JSON.stringify(value));
      return;
    } catch (e) {
      console.error(`[store] setJSON ${key} failed:`, e?.message || e);
    }
  }
  mem[key] = value;
}

const nowISO = () => new Date().toISOString();

// =====================================================================================
// Inventory snapshot (Google Sheet → snapshot written elsewhere)
// =====================================================================================

const K_INV_DATA = "inv:snapshot";
const K_INV_META = "inv:meta";

async function getInventory() {
  return getJSON(K_INV_DATA, []);
}

async function setInventory(rows) {
  const out = Array.isArray(rows) ? rows : [];
  await setJSON(K_INV_DATA, out);
  return out.length;
}

async function getInventoryMeta() {
  return getJSON(K_INV_META, null);
}

async function setInventoryMeta(meta) {
  const m = { ...(meta || {}), updatedAt: nowISO() };
  await setJSON(K_INV_META, m);
  return m;
}

/** Find by exact IMEI / Serial in the snapshot */
async function findByIMEI(imei) {
  const t = String(imei || "").trim();
  if (!t) return null;
  const all = await getInventory();
  // common field names we support
  const keys = ["systemImei", "System IMEI", "IMEI", "Serial", "SN", "serial"];
  for (const row of all) {
    for (const k of keys) {
      if (row && String(row[k] || "").trim() === t) return row;
    }
  }
  return null;
}

// =====================================================================================
// Cycle Count Bins (built by the app while scanning)
// =====================================================================================

const K_CC_BINS = "cc:bins";

/**
 * Array of bins like:
 * {
 *   id, bin, user/counter, started, submittedAt,
 *   items: [ { sku, description, systemImei, systemQty, qtyEntered, ... } ],
 *   missingImeis: [ { systemImei } ],
 *   nonSerialShortages: [ { sku, description, systemQty, qtyEntered } ]
 * }
 */
async function listBins() {
  return getJSON(K_CC_BINS, []);
}

async function upsertBin(binObj) {
  const rows = await listBins();
  const id = String(binObj.id || `${binObj.bin || ""}:${binObj.user || binObj.counter || ""}` || randomUUID());
  let idx = rows.findIndex((r) => String(r.id || "") === id);
    const rec = {
    id,
    bin: String(binObj.bin || "").trim(),
    user: String(binObj.user || binObj.counter || "").trim(),
    counter: String(binObj.counter || binObj.user || "").trim(),

    // timestamps
    started: binObj.started || binObj.startedAt || nowISO(),
    submittedAt: binObj.submittedAt || binObj.submitted || binObj.updatedAt || null,

    // IMPORTANT: persist these so Investigator table is correct
    total: typeof binObj.total === "number" ? binObj.total : (binObj.total ? Number(binObj.total) : undefined),
    scanned: typeof binObj.scanned === "number" ? binObj.scanned : (binObj.scanned ? Number(binObj.scanned) : undefined),
    missing: typeof binObj.missing === "number" ? binObj.missing : (binObj.missing ? Number(binObj.missing) : undefined),
    state: binObj.state ? String(binObj.state) : undefined,

    // details
    items: Array.isArray(binObj.items) ? binObj.items : [],
    missingImeis: Array.isArray(binObj.missingImeis) ? binObj.missingImeis : [],
    nonSerialShortages: Array.isArray(binObj.nonSerialShortages) ? binObj.nonSerialShortages : [],
    meta: { ...(binObj.meta || {}) },
  };


  if (idx === -1) rows.push(rec);
  else rows[idx] = { ...rows[idx], ...rec, id };

  await setJSON(K_CC_BINS, rows);
  return rec;
}

/** Optional, if you escalate a bin to supervisor workflow */
async function escalateBin(id, patch = {}) {
  const rows = await listBins();
  const idx = rows.findIndex((r) => String(r.id || "") === String(id || ""));
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], escalatedAt: nowISO(), ...patch };
  await setJSON(K_CC_BINS, rows);
  return rows[idx];
}

// =====================================================================================
// Audit (wrong-bin events + decisions)
// =====================================================================================

const K_CC_AUDIT = "cc:audits";

/**
 * Each audit row can look like:
 * {
 *   id, imei, sku, description,
 *   scannedBin, trueLocation, status: 'open'|'moved'|'resolved',
 *   movedTo, movedBy, decision, decidedBy, createdAt, updatedAt
 * }
 */
async function listAudits() {
  return getJSON(K_CC_AUDIT, []);
}

async function appendAudit(entry) {
  const all = await listAudits();
  const rec = {
    id: randomUUID(),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    status: "open",
    ...entry,
  };
  all.unshift(rec);
  await setJSON(K_CC_AUDIT, all);
  return rec;
}

async function patchAudit(id, patch) {
  const all = await listAudits();
  const idx = all.findIndex((r) => String(r.id || "") === String(id || ""));
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch, updatedAt: nowISO() };
  await setJSON(K_CC_AUDIT, all);
  return all[idx];
}
async function saveAudits(list) {
  const next = Array.isArray(list) ? list : [];
  await setJSON(K_CC_AUDIT, next);
  return next;
}


// =====================================================================================
// Not-Scanned (needed by Supervisor delete button)
// =====================================================================================

const K_CC_NOT_SCANNED = "cc:notscanned";
// Ignore list for Not-Scanned serials the supervisor deleted (so we hide them in computed views)
const K_CC_NOT_SCANNED_IGNORE = "cc:notscanned:ignore";

async function listNotScanned() {
  return getJSON(K_CC_NOT_SCANNED, []);
}

async function appendNotScanned(entry) {
  const rows = await listNotScanned();
  const rec = {
    id: randomUUID(),
    systemImei: String(entry.systemImei || entry.imei || "").trim(),
    bin: String(entry.bin || "").trim(),
    sku: String(entry.sku || ""),
    description: String(entry.description || ""),
    counter: String(entry.counter || ""),
    started: entry.started || entry.startedAt || "",
    updatedAt: nowISO(),
    type: entry.type || (entry.systemImei ? "serial" : "nonserial"),
    systemQty: Number.isFinite(+entry.systemQty) ? +entry.systemQty : undefined,
    qtyEntered: Number.isFinite(+entry.qtyEntered) ? +entry.qtyEntered : undefined,
    missing: Number.isFinite(+entry.missing) ? +entry.missing : undefined,
  };
  rows.push(rec);
  await setJSON(K_CC_NOT_SCANNED, rows);
  return rec;
}

/** Delete one not-scanned record by IMEI (primary) */
async function deleteNotScanned(imei) {
  const t = String(imei || "").trim();
  if (!t) return 0;
  const rows = await listNotScanned();
  const next = rows.filter((r) => String(r.systemImei || r.imei || "") !== t);
  await setJSON(K_CC_NOT_SCANNED, next);
  return rows.length - next.length; // count removed
}

/** Overwrite the whole not-scanned list (fallback used by API if direct delete isn't available) */
async function saveNotScanned(rows) {
  const out = Array.isArray(rows) ? rows : [];
  await setJSON(K_CC_NOT_SCANNED, out);
  return out.length;
}

// --- Not-Scanned ignore list (used by GET to hide deleted serials) ---
async function listNotScannedIgnores() {
  return getJSON(K_CC_NOT_SCANNED_IGNORE, []);
}

async function addNotScannedIgnore(imei) {
  const t = String(imei || "").trim();
  if (!t) return 0;
  const list = await listNotScannedIgnores();
  if (!list.includes(t)) {
    list.push(t);
    await setJSON(K_CC_NOT_SCANNED_IGNORE, list);
  }
  return list.length;
}

// =====================================================================================
// Exports
// =====================================================================================

module.exports = {
  // utils
  nowISO,

  // inventory
  getInventory,
  setInventory,
  getInventoryMeta,
  setInventoryMeta,
  findByIMEI,

  // cycle counts
  listBins,
  upsertBin,
  escalateBin,

  // audits
  listAudits,
  appendAudit,
  patchAudit,
  saveAudits,

  // not-scanned
  listNotScanned,
  appendNotScanned,
  deleteNotScanned,
  saveNotScanned,

  // not-scanned ignore list
  listNotScannedIgnores,
  addNotScannedIgnore,
};

// ESM default bridge (lets "import * as Store" work)
module.exports = module.exports || {};
module.exports.default = module.exports;

