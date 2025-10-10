// api/inventory/bin.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);
  withCORS(res);

  const bin = String(req.query.bin || "").trim();
  if (!bin) return bad(res, "bin is required", 400);

  const all = await Store.getInventory();
  const match = bin.toLowerCase();

  const records = all
    .filter(r => ((r.location || "").trim().toLowerCase() === match))
    .map(r => ({
      location: r.location || "",
      sku: r.sku || "",
      description: r.description || "",
      systemImei: String(r.systemImei || "")
    }));

  return ok(res, { records });
};
