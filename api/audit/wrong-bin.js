// api/audit/wrong-bin.js  (shared audits for Investigator)
// GET: list audits (optional filters: status, imei, bin)
// POST: open a new audit (idempotence handled by Store.appendAudit on same IMEI)
// PATCH: update status / movedTo / movedBy (append a status snapshot to Sheets)
// DELETE: soft-close (mark closed)
//
// Writes-through to Google Sheets (WrongBinAudits tab) in fire-and-forget mode.

/* eslint-disable no-console */
const { withCORS } = require("../_lib/respond");
const { ok, bad, method } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

function norm(s){ return String(s ?? "").trim(); }
function now(){ return new Date().toISOString(); }

module.exports = async function handler(req, res){
  if (req.method === "OPTIONS"){ withCORS(res); res.statusCode=204; return res.end(); }
  withCORS(res);

  // GET
  if (req.method === "GET"){
    try {
      const status = norm(req.query?.status || "");    // e.g. open|moved|closed
      const imei   = norm(req.query?.imei || "");
      const bin    = norm(req.query?.bin || "");       // scannedBin filter

      const audits = await Store.listAudits();
      const out = audits.filter(a => {
        if (status && String(a.status||"").toLowerCase() !== status.toLowerCase()) return false;
        if (imei && String(a.imei||"").trim() !== imei) return false;
        if (bin && String(a.scannedBin||"").trim().toLowerCase() !== bin.toLowerCase()) return false;
        return true;
      });

      return ok(res, { ok:true, audits: out });
    } catch (e) {
      console.error("[wrong-bin GET] error:", e);
      return bad(res, String(e.message || e), 500);
    }
  }

  // POST: open an audit
  if (req.method === "POST"){
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body||"{}") : (req.body || {});
      const imei        = norm(body.imei);
      const scannedBin  = norm(body.scannedBin);
      const trueLocation= norm(body.trueLocation);
      const scannedBy   = norm(body.scannedBy || "—");
      if (!imei || !scannedBin || !trueLocation){
        return bad(res, "missing_required_fields: imei, scannedBin, trueLocation", 400);
      }

      const audit = await Store.appendAudit({
        imei, scannedBin, trueLocation, scannedBy, status: "open"
      });

      // Fire-and-forget Sheets append
      (async () => {
        try {
          const ts = now();
          await appendRow("WrongBinAudits", [
            imei, scannedBin, trueLocation, scannedBy, "open", ts, ts
          ]);
        } catch (e) {
          console.error("[wrong-bin POST] sheets append failed:", e?.message || e);
        }
      })();

      return ok(res, { ok:true, audit });
    } catch (e) {
      console.error("[wrong-bin POST] error:", e);
      return bad(res, String(e.message || e), 500);
    }
  }

  // PATCH: update status/move info
  if (req.method === "PATCH"){
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body||"{}") : (req.body || {});
      const id = norm(body.id);
      if (!id) return bad(res, "missing_id", 400);

      const patch = {};
      if (body.status != null) patch.status = norm(body.status).toLowerCase(); // open|moved|closed
      if (body.movedTo != null) patch.movedTo = norm(body.movedTo);
      if (body.movedBy != null) patch.movedBy = norm(body.movedBy);
      if (patch.status === "moved" && !patch.movedTo && body.trueLocation) patch.movedTo = norm(body.trueLocation);
      patch.updatedAt = now();

      const updated = await Store.patchAudit(id, patch);
      if (!updated) return bad(res, "not_found", 404);

      // Fire-and-forget: append a status snapshot row
      (async () => {
        try {
          await appendRow("WrongBinAudits", [
            String(updated?.imei || ""),
            String(updated?.scannedBin || ""),
            String(updated?.trueLocation || updated?.movedTo || ""),
            String(updated?.movedBy || updated?.scannedBy || "—"),
            String(updated?.status || "updated"),
            String(updated?.createdAt || now()),
            now(),
          ]);
        } catch (e) {
          console.error("[wrong-bin PATCH] sheets append failed:", e?.message || e);
        }
      })();

      return ok(res, { ok:true, audit: updated });
    } catch (e) {
      console.error("[wrong-bin PATCH] error:", e);
      return bad(res, String(e.message || e), 500);
    }
  }

  // DELETE: soft-close (mark closed)
  if (req.method === "DELETE"){
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body||"{}") : (req.body || {});
      const id = norm(req.query?.id || body.id || "");
      if (!id) return bad(res, "missing_id", 400);

      const updated = await Store.patchAudit(id, { status: "closed", updatedAt: now() });
      if (!updated) return bad(res, "not_found", 404);

      // Fire-and-forget: append closure snapshot
      (async () => {
        try {
          await appendRow("WrongBinAudits", [
            String(updated?.imei || ""),
            String(updated?.scannedBin || ""),
            String(updated?.trueLocation
