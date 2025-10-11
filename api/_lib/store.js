// api/_lib/store.js
const Redis = require("ioredis");

const KEY_DATA = "inventory:data";
const KEY_META = "inventory:meta";

// Wire Redis from REDIS_URL; fallback to in-memory (per-instance)
let redis = null;
if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
  });
  redis.on("error", (e) => console.error("[redis] error:", e?.message || e));
}

// In-memory fallback (not shared across instances)
let mem = { data: [], meta: null };

async function readJSON(key, fallback) {
  if (redis) {
    try {
      const v = await redis.get(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      console.error("[redis] get fail", key, e?.message || e);
    }
  }
  return mem[key === KEY_DATA ? "data" : "meta"] ?? fallback;
}

async function writeJSON(key, value) {
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(value));
      return;
    } catch (e) {
      console.error("[redis] set fail", key, e?.message || e);
    }
  }
  if (key === KEY_DATA) mem.data = value; else mem.meta = value;
}

module.exports = {
  async getInventory() { return readJSON(KEY_DATA, []); },
  async setInventory(rows) {
    if (!Array.isArray(rows)) rows = [];
    await writeJSON(KEY_DATA, rows);
    return rows.length;
  },
  async getInventoryMeta() { return readJSON(KEY_META, null); },
  async setInventoryMeta(meta) { await writeJSON(KEY_META, meta); return meta; },
};
