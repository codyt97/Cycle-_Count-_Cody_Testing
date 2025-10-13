// api/audit/wrong-bin.js  (shared audits for Investigator)
/* eslint-disable no-console */
const { withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

function json(res, code, obj){
  res.statusCode = code;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization, X-User");
  res.end(JSON.stringify(obj));
}
function norm(s){ return String(s ?? "").trim(); }
function now(){ return new Date().toISOString(); }

module.exports = async function handler(req, res){
  if (req.method === "OPTIONS"){ withCORS(res); res.statusCode=204; return res.end(); }
  withCORS(res);

  // GET: list all audits (optionally filter by status, imei, bin)
  if (req.method === "GET"){
    try {
      const status = norm(req.query?.status || "");    // e.g. "open", "moved", "closed"
      const imei   = norm(req.query?.imei || "");
      const bin    = norm(req.query?.bin || "");       // scannedBin filter
      const audits = await Store.listAudits();
      const out = audits.filter(a => {
        if (status && String(a.status||"").toLowerCase() !== status.toLowerCase()) return false;
        if (imei && String(a.imei||"").trim() !== imei) return false;
        if (bin && String(a.scannedBin||"").trim().toLowerCase() !== bin.toLowerCase()) return false;
        return true;
      });
      return json(res,200,{ ok:true, audits: out });
    } catch (e) {
      return json(res,500,{ ok:false, error:String(e.message||e) });
    }
  }

  // POST: create/open an audit
  if (req.method === "POST"){
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body||"{}") : (req.body || {});
      const imei        = norm(body.imei);
      const scannedBin  = norm(body.scannedBin);
      const trueLocation= norm(body.trueLocation);
      const scannedBy   = norm(body.scannedBy || "—");
      if (!imei || !scannedBin || !trueLocation){
        return json(res,400,{ ok:false, error:"missing_required_fields", need:["imei","scannedBin","trueLocation"]});
      }
      const ts = now();
      const audit = await Store.appendAudit({
        imei, scannedBin, trueLocation, scannedBy, status: "open"
      });

      // Sheets append (fire-and-forget)
      (async () => {
        try {
          await appendRow("WrongBinAudits", [
            imei, scannedBin, trueLocation, scannedBy, "open", ts, ts
          ]);
        } catch (e) { console.error("[Sheets][Audits][POST] append fail:", e?.message || e); }
      })();

      return json(res,200,{ ok:true, audit });
    } catch (e) {
      return json(res,500,{ ok:false, error:String(e.message||e) });
    }
  }
  
  // PATCH: update (mark moved/closed, etc.)
// PATCH: update an audit (moved/closed etc.)
if (req.method === "PATCH") {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body||"{}") : (req.body || {});
    const id      = String(body.id || "").trim();         // preferred selector
    const imei    = String(body.imei || "").trim();       // fallback selector
    const movedTo = String(body.movedTo || "").trim();
    const movedBy = String(body.movedBy || "").trim();
    const status  = String(body.status  || "moved").toLowerCase();

    // Locate the audit by id or by open IMEI
    const audits = await Store.listAudits();
    let target = null;
    if (id) {
      target = audits.find(a => a.id === id);
    } else if (imei) {
      target = audits.find(a => String(a.imei).trim() === imei && String(a.status||"") === "open");
    }
    if (!target) return res.status(404).json({ ok:false, error:"audit_not_found" });

    const updated = await Store.patchAudit(target.id, {
      status,
      movedTo: movedTo || target.movedTo,
      movedBy: movedBy || target.movedBy
    });

    // Optional: append a log row to the "WrongBinAudits" sheet
    (async () => {
      try {
        const { appendRow } = require("../_lib/sheets");
        const ts = new Date().toISOString();
        await appendRow("WrongBinAudits", [
          updated.imei, updated.scannedBin, updated.trueLocation,
          updated.movedBy || updated.scannedBy || "—",
          updated.status, updated.createdAt, ts
        ]);
      } catch (e) { console.error("[Sheets][Audits][PATCH] append fail:", e?.message || e); }
    })();

    return res.status(200).json({ ok:true, audit: updated });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e.message||e) });
  }
}


  // DELETE: soft-close (no hard delete in Store; mark closed)
  if (req.method === "DELETE"){
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body||"{}") : (req.body || {});
      const id = norm(req.query?.id || body.id || "");
      if (!id) return json(res,400,{ ok:false, error:"missing_id" });

      const user = norm(req.query?.user || body.user || "");
const patch = { status: "closed", updatedAt: now() };
if (user) patch.decidedBy = user;

const updated = await Store.patchAudit(id, patch);

      if (!updated) return json(res,404,{ ok:false, error:"not_found" });

      (async () => {
        try {
          await appendRow("WrongBinAudits", [
            String(updated?.imei || ""),
            String(updated?.scannedBin || ""),
            String(updated?.trueLocation || ""),
            String(updated?.decidedBy || updated?.movedBy || "—"),
            "closed",
            String(updated?.createdAt || now()),
            String(updated?.updatedAt || now()),
          ]);
        } catch (e) { console.error("[Sheets][Audits][DELETE] append fail:", e?.message || e); }
      })();

      return json(res,200,{ ok:true, audit: updated });
    } catch (e) {
      return json(res,500,{ ok:false, error:String(e.message||e) });
    }
  }

  // Fallback
  return json(res,405,{ ok:false, error:"method_not_allowed" });
};
