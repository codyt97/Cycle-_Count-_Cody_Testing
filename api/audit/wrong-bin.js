// /api/audit/wrong-bin.js (CommonJS)
const { kv } = require("@vercel/kv");

const LIST_KEY = "wrongbin:list";
const HASH_PREFIX = "wrongbin:event:";

module.exports = async (req, res) => {
  try {
    if (req.method === "POST") {
      const { imei, scannedBin, trueLocation } = req.body || {};
      if (!imei || !scannedBin || !trueLocation) {
        return res.status(400).json({ error: "imei, scannedBin, trueLocation are required" });
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const event = {
        id,
        imei: String(imei),
        scannedBin: String(scannedBin),
        trueLocation: String(trueLocation),
        status: "open",
        ts: new Date().toISOString(),
      };
      await kv.hset(HASH_PREFIX + id, { data: JSON.stringify(event) });
      await kv.lpush(LIST_KEY, id);
      return res.status(201).json(event);
    }

    if (req.method === "GET") {
      const count = Number((req.query && req.query.count) || 100);
      const ids = await kv.lrange(LIST_KEY, 0, count - 1);
      const items = [];
      for (const id of ids || []) {
        const raw = await kv.hget(HASH_PREFIX + id, "data");
        if (raw) items.push(JSON.parse(raw));
      }
      return res.status(200).json({ records: items });
    }

    if (req.method === "PATCH") {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: "id is required" });
      const raw = await kv.hget(HASH_PREFIX + id, "data");
      if (!raw) return res.status(404).json({ error: "not found" });
      const ev = JSON.parse(raw);
      ev.status = "resolved";
      ev.resolvedAt = new Date().toISOString();
      await kv.hset(HASH_PREFIX + id, { data: JSON.stringify(ev) });
      return res.status(200).json(ev);
    }

    res.setHeader("Allow", "GET,POST,PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("wrong-bin error:", e);
    return res.status(500).json({ error: "Audit service failed" });
  }
};
