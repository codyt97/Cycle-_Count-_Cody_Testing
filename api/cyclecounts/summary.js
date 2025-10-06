// api/cyclecounts/summary.js
const { ok, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);

  const bins = await Store.listBins();
  // Normalize fields to what the UI expects
  const records = bins.map(b => ({
    bin: b.bin,
    counter: b.counter || "—",
    started: b.started || b.createdAt || "—",
    updated: b.updatedAt || b.updated || "—",
    total: typeof b.total === "number" ? b.total : (Array.isArray(b.items) ? b.items.length : null),
    scanned: typeof b.scanned === "number" ? b.scanned : null,
    missing: typeof b.missing === "number" ? b.missing : null,
    state: b.state || "investigation",
  }));

  return ok(res, { records });
};
