// api/inventory/imei.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

// Logs → Google Sheets (append-only)
const { logWrongBin, logFoundImei } = require("../_lib/logs");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET")     return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  const imei = String(req.query.imei || "").trim();
  const scannedBin = String(req.query.scannedBin || "").trim(); // optional but recommended
  const scannedBy  = String(req.query.scannedBy  || "").trim();

  if (!imei) return bad(res, "imei is required", 400);

  const rec = await Store.findByIMEI(imei);
  if (!rec) return ok(res, { found: false, reason: "not_in_snapshot" });

  const trueLocation = String(rec.location || "").trim();

  const resp = {
    found: true,
    imei,
    location: trueLocation,
    sku: rec.sku || "",
    description: rec.description || "",
  };

  if (scannedBin && trueLocation && trueLocation.toLowerCase() !== scannedBin.toLowerCase()) {
    // Persist audit to shared store
    await Store.appendAudit({
      imei,
      scannedBin,
      trueLocation,
      scannedBy: scannedBy || "—",
      status: "open",
    });
    // Log to WrongBinAudits sheet
    try {
      await logWrongBin({
        imei,
        scannedBin,
        trueLocation,
        scannedBy: scannedBy || "—",
        status: "open",
        moved: false
      });
    } catch (e) {
      console.warn("[logs] WrongBin detect failed:", e?.message || e);
    }

    resp.auditLogged = true;
    resp.mismatch = { scannedBin, trueLocation };
  } else if (scannedBin && trueLocation && trueLocation.toLowerCase() === scannedBin.toLowerCase()) {
    // Positive scan (found in the scanned bin) → FoundImeis log
    try {
      await logFoundImei({
        imei,
        foundInBin: scannedBin,
        scannedBin,
        foundBy: scannedBy || "—"
      });
    } catch (e) {
      console.warn("[logs] FoundImeis (positive scan) failed:", e?.message || e);
    }
  }

  return ok(res, resp);
};
