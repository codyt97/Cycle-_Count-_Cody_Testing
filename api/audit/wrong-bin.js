// api/audit/wrong-bin.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();

  if (req.method === "GET") {
    const records = await Store.listAudits();
    return ok(res, { records });
  }

  if (req.method === "POST") {
    try {
      const { imei, scannedBin, trueLocation, scannedBy } = req.body || {};
      if (!imei || !scannedBin) return bad(res, "imei and scannedBin are required");
      const rec = await Store.appendAudit({
        imei: String(imei),
        scannedBin: String(scannedBin),
        trueLocation: trueLocation ? String(trueLocation) : "",
        scannedBy: scannedBy || "—",
        status: "open",
      });
      return ok(res, { ok: true, record: rec }, 201);
    } catch (e) {
      return bad(res, String(e.message || e));
    }
  }

  if (req.method === "PATCH") {
    try {
      const { id, status, movedTo, movedBy, decision, decidedBy } = req.body || {};
      if (!id) return bad(res, "id is required");
      const patch = {};
      if (status) patch.status = status;
      if (movedTo) patch.movedTo = String(movedTo);
      if (movedBy) patch.movedBy = String(movedBy);
      if (decision) patch.decision = String(decision);
      if (decidedBy) patch.decidedBy = String(decidedBy);

      const out = await Store.patchAudit(id, patch);
      if (!out) return bad(res, "audit item not found", 404);
      return ok(res, { ok: true, record: out });
    } catch (e) {
      return bad(res, String(e.message || e));
    }
  }

  return method(res, ["GET", "POST", "PATCH", "OPTIONS"]);
};
