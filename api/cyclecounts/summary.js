const { ok, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

function toEST(s){
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false
    });
  } catch { return s; }
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);

  const bins = await Store.listBins();
  const records = bins.map(b => ({
    bin: b.bin,
    counter: b.counter || "—",
    started: toEST(b.started || b.createdAt || "—"),
    updated: toEST(b.updatedAt || b.updated || "—"),
    total: typeof b.total === "number" ? b.total : (Array.isArray(b.items) ? b.items.length : null),
    scanned: typeof b.scanned === "number" ? b.scanned : null,
    missing: typeof b.missing === "number" ? b.missing : null,
    state: b.state || "investigation",
  }));

  return ok(res, { records });
};

