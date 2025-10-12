// api/inventory/imei.js
// Lookup IMEI in the inventory snapshot. On bin mismatch, create an audit (Store)
// and append a row to WrongBinAudits sheet.

/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET")     return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  const imei = String(req.query.imei || "").trim();
  const scannedBin = String(req.query.scannedBin || "").trim(); // optional but recommended
  const scannedBy  = String(req.query.scannedBy  || "").trim();

  if (!imei) return bad(res, "imei is required", 400);

  try {
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

    // If the scanned bin mismatches the truth, log an audit and append to Sheets
    if (scannedBin && trueLocation && trueLocation.toLowerCase() !== scannedBin.toLowerCase()) {
      await Store.appendAudit({
        imei,
        scannedBin,
        trueLocation,
        scannedBy: scannedBy || "—",
        status: "open",
      });

      // Fire-and-forget Sheets append
      (async () => {
        try {
          const ts = new Date().toISOString();
          await appendRow("WrongBinAudits", [
            imei,
            scannedBin,
            trueLocation,
            scannedBy || "—",
            "open",
            ts, ts,
          ]);
        } catch (e) {
          console.error("[inventory/imei] sheets append failed:", e?.message || e);
        }
      })();

      resp.auditLogged = true;
      resp.mismatch = { scannedBin, trueLocation };
    }

    return ok(res, resp);
  } catch (e) {
    console.error("[inventory/imei] error:", e);
    return bad(res, String(e.message || e), 500);
  }
};
