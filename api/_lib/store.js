// api/_lib/store.js
const { randomUUID } = require("crypto");

let hasKV = false;
let kv = null;
try {
  const mod = require("@vercel/kv"); // optional
  kv = mod.kv || mod.default || null;
  hasKV = !!kv && !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
} catch { /* no kv */ }

// In-memory (dev fallback – NOT persistent in production)
const mem = {
  "cc:audits": [], // wrong-bin items
  "cc:bins": [],   // submitted bins & states
};

async function getArray(key) {
  if (hasKV) {
    const val = await kv.get(key);
    return Array.isArray(val) ? val : [];
  }
  return Array.isArray(mem[key]) ? mem[key] : [];
}

async function setArray(key, arr) {
  if (hasKV) {
    // Upstash KV can store JSON directly
    await kv.set(key, arr);
  } else {
    mem[key] = arr;
  }
}

function nowISO() {
  return new Date().toISOString();
}

module.exports = {
  randomUUID,
  nowISO,
  async listAudits() {
    return getArray("cc:audits");
  },
  async appendAudit(audit) {
    const list = await getArray("cc:audits");
    const rec = { id: randomUUID(), createdAt: nowISO(), status: "open", ...audit };
    list.unshift(rec);
    await setArray("cc:audits", list);
    return rec;
  },
  async patchAudit(id, patch) {
    const list = await getArray("cc:audits");
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch, updatedAt: nowISO() };
    await setArray("cc:audits", list);
    return list[idx];
  },

  async listBins() {
    return getArray("cc:bins");
  },
  async upsertBin(binPayload) {
    const bins = await getArray("cc:bins");
    const idx = bins.findIndex(b => (b.bin || "").toLowerCase() === (binPayload.bin || "").toLowerCase());
    if (idx === -1) {
      const rec = { id: randomUUID(), createdAt: nowISO(), state: "investigation", ...binPayload };
      bins.unshift(rec);
    } else {
      bins[idx] = { ...bins[idx], ...binPayload, updatedAt: nowISO() };
    }
    await setArray("cc:bins", bins);
  },
  async escalateBin(bin, actor) {
    const bins = await getArray("cc:bins");
    const idx = bins.findIndex(b => (b.bin || "").toLowerCase() === (bin || "").toLowerCase());
    if (idx === -1) return null;
    bins[idx] = {
      ...bins[idx],
      state: "supervisor",
      escalatedBy: actor || "—",
      escalatedAt: nowISO(),
      updatedAt: nowISO(),
    };
    await setArray("cc:bins", bins);
    return bins[idx];
  },
};
