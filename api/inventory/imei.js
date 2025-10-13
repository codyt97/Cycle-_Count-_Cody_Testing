// api/inventory/imei.js
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

  // Mismatch: log to Store and append to Sheets (fire-and-forget)
  if (scannedBin && trueLocation && trueLocation.toLowerCase() !== scannedBin.toLowerCase()) {
    try {
      await Store.appendAudit({
        imei,
        scannedBin,
        trueLocation,
        scannedBy: scannedBy || "—",
        status: "open",
      });
      resp.auditLogged = true;
      resp.mismatch = { scannedBin, trueLocation };
    } catch (e) {
      console.error("[inventory/imei] store audit fail:", e?.message || e);
    }

    (async () => {
      try {
        const ts = new Date().toISOString();
        await appendRow("WrongBinAudits", [
          imei,
          scannedBin,
          trueLocation,
          scannedBy || "—",
          "open",
          ts,
          ts,
        ]);
      } catch (e) {
        console.error("[Sheets][Audits] append fail:", e?.message || e);
      }
    })();
  }

  return ok(res, resp);
};
