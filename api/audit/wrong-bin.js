// api/audit/wrong-bin.js
// Endpoints:
//   GET    /api/audit/wrong-bin
//   POST   /api/audit/wrong-bin          { imei, scannedBin, trueLocation, status?, scannedBy? }
//   PATCH  /api/audit/wrong-bin          { id, status?, movedTo?, movedBy? }
//   DELETE /api/audit/wrong-bin?id=...   (or body { id })
//
// Response shape is always: { ok: true|false, audits?: [...], audit?: {...}, error?: "msg" }

const { randomUUID } = require("crypto");

// --- Attempt to use your shared Store helper (recommended) ---
let Store = null;
try {
  Store = require("../store"); // adjust path if your store is elsewhere
} catch (_) {
  // no store module found; we'll use an in-memory fallback below
}

// -------- small persistence shim over Store or in-memory ----------
const MEM = { audits: [] };

async function loadAudits() {
  if (Store) {
    // Try a variety of method names that might exist in your store wrapper
    if (typeof Store.getAudits === "function") return (await Store.getAudits()) || [];
    if (typeof Store.listAudits === "function") return (await Store.listAudits()) || [];
    if (typeof Store.get === "function") return (await Store.get("wrong_bin_audits")) || [];
    if (typeof Store.read === "function") return (await Store.read("wrong_bin_audits")) || [];
  }
  return MEM.audits;
}

async function saveAudits(audits) {
  if (Store) {
    if (typeof Store.setAudits === "function") return Store.setAudits(audits);
    if (typeof Store.putAudits === "function") return Store.putAudits(audits);
    if (typeof Store.set === "function") return Store.set("wrong_bin_audits", audits);
    if (typeof Store.write === "function") return Store.write("wrong_bin_audits", audits);
  }
  MEM.audits = audits;
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.end(JSON.stringify(obj));
}

function nowISO() {
  return new Date().toISOString();
}

function norm(s) {
  return String(s || "").trim();
}

function safeImei(s) {
  return norm(s).replace(/[^\w\-]+/g, "");
}

function dedupeKey(a) {
  // Use IMEI + current open status as idempotency key
  return `${safeImei(a.imei)}::${norm(a.status || "open")}`;
}

function indexById(audits, id) {
  const needle = norm(id).toLowerCase();
  return audits.findIndex(a => norm(a.id).toLowerCase() === needle);
}

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.statusCode = 204;
    return res.end();
  }

  // Read body safely (Vercel/Node sometimes gives a string)
  async function readBody() {
    if (req.body && typeof req.body === "object") return req.body;
    if (typeof req.body === "string" && req.body.length) {
      try { return JSON.parse(req.body); } catch {}
    }
    return new Promise(resolve => {
      let data = "";
      req.on("data", chunk => (data += chunk));
      req.on("end", () => {
        try { resolve(data ? JSON.parse(data) : {}); }
        catch { resolve({}); }
      });
    });
  }

  // -------- GET: list audits -----------
  if (req.method === "GET") {
    try {
      const audits = await loadAudits();
      return json(res, 200, { ok: true, audits });
    } catch (err) {
      return json(res, 500, { ok: false, error: "failed_to_read_audits", detail: String(err && err.message || err) });
    }
  }

  // -------- POST: create audit (idempotent on open-by-IMEI) -----------
  if (req.method === "POST") {
    try {
      const body = await readBody();
      const imei = safeImei(body.imei);
      const scannedBin = norm(body.scannedBin);
      const trueLocation = norm(body.trueLocation);
      const status = norm(body.status || "open").toLowerCase();
      const scannedBy = norm(body.scannedBy || "");
      if (!imei || !scannedBin || !trueLocation) {
        return json(res, 400, { ok: false, error: "missing_required_fields", need: ["imei","scannedBin","trueLocation"] });
      }
      const audits = await loadAudits();

      // Idempotency: if an OPEN record already exists for this IMEI, return it
      const existing = audits.find(a => dedupeKey(a) === dedupeKey({ imei, status }));
      if (existing) {
        // If any supplied fields are newer, lightly merge
        if (scannedBy && !existing.scannedBy) existing.scannedBy = scannedBy;
        if (scannedBin && !existing.scannedBin) existing.scannedBin = scannedBin;
        if (trueLocation && !existing.trueLocation) existing.trueLocation = trueLocation;
        existing.updatedAt = nowISO();
        await saveAudits(audits);
        return json(res, 200, { ok: true, audit: existing, audits });
      }

      const audit = {
        id: randomUUID(),
        imei,
        scannedBin,
        trueLocation,
        status,            // "open" | "moved" | "closed"
        scannedBy,
        movedTo: "",
        movedBy: "",
        createdAt: nowISO(),
        updatedAt: nowISO()
      };
      audits.unshift(audit); // newest first
      await saveAudits(audits);
      return json(res, 200, { ok: true, audit, audits });
    } catch (err) {
      return json(res, 500, { ok: false, error: "failed_to_create_audit", detail: String(err && err.message || err) });
    }
  }

  // -------- PATCH: update audit (mark moved, etc) -----------
  if (req.method === "PATCH") {
    try {
      const body = await readBody();
      const id = norm(body.id);
      if (!id) return json(res, 400, { ok: false, error: "missing_id" });

      const audits = await loadAudits();
      const idx = indexById(audits, id);
      if (idx === -1) return json(res, 404, { ok: false, error: "not_found" });

      const patch = {};
      if (body.status != null) patch.status = norm(body.status).toLowerCase();
      if (body.movedTo != null) patch.movedTo = norm(body.movedTo);
      if (body.movedBy != null) patch.movedBy = norm(body.movedBy);

      // convenience: if status -> moved and no movedTo provided, default to trueLocation
      if (patch.status === "moved" && !patch.movedTo) {
        patch.movedTo = audits[idx].trueLocation || "";
      }

      audits[idx] = { ...audits[idx], ...patch, updatedAt: nowISO() };
      await saveAudits(audits);
      return json(res, 200, { ok: true, audit: audits[idx], audits });
    } catch (err) {
      return json(res, 500, { ok: false, error: "failed_to_patch_audit", detail: String(err && err.message || err) });
    }
  }

  // -------- DELETE: remove audit by id -----------
  if (req.method === "DELETE") {
    try {
      // id may arrive in query or body
      const qid = norm((req.query && req.query.id) || "");
      const body = await readBody();
      const bid = norm(body.id || "");
      const id = qid || bid;
      if (!id) return json(res, 400, { ok: false, error: "missing_id" });

      const audits = await loadAudits();
      const idx = indexById(audits, id);
      if (idx === -1) return json(res, 404, { ok: false, error: "not_found" });

      const [removed] = audits.splice(idx, 1);
      await saveAudits(audits);
      return json(res, 200, { ok: true, audit: removed, audits });
    } catch (err) {
      return json(res, 500, { ok: false, error: "failed_to_delete_audit", detail: String(err && err.message || err) });
    }
  }

  // Method not allowed
  res.setHeader("Allow", "GET,POST,PATCH,DELETE,OPTIONS");
  return json(res, 405, { ok: false, error: "method_not_allowed" });
};
