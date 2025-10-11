// api/inventory/imei.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);
  withCORS(res);

  const imei = String(req.query.imei || "").trim();
  const scannedBin = String(req.query.scannedBin || "").trim(); // optional but useful
  const scannedBy = String(req.query.scannedBy || "").trim();   // optional

  if (!imei) return bad(res, "imei is required", 400);

  const rec = await Store.findByIMEI(imei);
  if (!rec) {
    // not in snapshot at all
    return ok(res, { found: false, reason: "not_in_snapshot" });
  }

  const trueLocation = String(rec.location || "").trim();
  const out = {
    found: true,
    imei,
    location: trueLocation,
    sku: rec.sku || "",
    description: rec.description || "",
  };

  // If the user provided a scannedBin and it doesn't match, record an audit
  if (scannedBin && trueLocation && trueLocation.toLowerCase() !== scannedBin.toLowerCase()) {
    try {
      await Store.appendAudit({
        imei,
        scannedBin,
        trueLocation,
        scannedBy: scannedBy || "—",
        status: "open",
      });
      out.auditLogged = true;
    } catch {
      out.auditLogged = false;
    }
    out.mismatch = { scannedBin, trueLocation };
  }

  return ok(res, out);
};
