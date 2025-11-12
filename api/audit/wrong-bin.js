// api/audit/wrong-bin.js
// Node (serverless) endpoint — NOT Edge.
// Adds SKU/Description hydration safely without OOMs.

const Store = require("../_lib/store");

// ---------- tiny helpers ----------
function norm(v) {
  return (v == null ? "" : String(v)).trim();
}
function nowISO() {
  return new Date().toISOString();
}
function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // simple CORS (same as other api files in this app)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.end(JSON.stringify(obj));
}
function bad(res, code, msg) {
  return json(res, code, { ok: false, error: String(msg || "error") });
}

// Sequentialize small batches to keep memory usage low.
async function hydrateWithInventory(audits) {
  const cache = new Map();
  async function getInv(imeiVal) {
    if (!imeiVal) return null;
    if (cache.has(imeiVal)) return cache.get(imeiVal);
    try {
      const inv = await Store.findByIMEI(imeiVal);
      cache.set(imeiVal, inv || null);
      return inv || null;
    } catch {
      cache.set(imeiVal, null);
      return null;
    }
  }

  const CHUNK = 10; // keep concurrency bounded
  const enriched = [];
  for (let i = 0; i < audits.length; i += CHUNK) {
    const slice = audits.slice(i, i + CHUNK);
    // do these chunk items one by one to minimize spikes
    for (const a of slice) {
      const inv = await getInv(a.imei);
      enriched.push({
        ...a,
        sku: inv?.sku || a.sku || "—",
        description: inv?.description || a.description || "—",
      });
    }
  }
  return enriched;
}

module.exports = async function handler(req, res) {
  // Preflight
  if (req.method === "OPTIONS") {
    return json(res, 204, { ok: true });
  }

  try {
    // ---------- GET /api/audit/wrong-bin ----------
    // Default behavior: only return actionable audits (open/moved), newest first,
    // hard-capped by ?limit= (default 300, max 2000). Hydrate in a safe way.
    if (req.method === "GET") {
      const qStatus = norm(req.query?.status || "");
      const imei = norm(req.query?.imei || "");
      const bin = norm(req.query?.bin || "");
      const include = norm(req.query?.include || ""); // include=all to bypass default filter
      const limit = Math.max(1, Math.min(Number(req.query?.limit || 300), 2000));

      const audits = await Store.listAudits();

      // filter base on imei / bin first
      let filtered = audits.filter((a) => {
        if (imei && norm(a.imei) !== imei) return false;
        if (bin && norm(a.scannedBin).toLowerCase() !== bin.toLowerCase())
          return false;
        return true;
      });

      if (qStatus) {
        filtered = filtered.filter(
          (a) => norm(a.status).toLowerCase() === qStatus.toLowerCase()
        );
      } else if (include !== "all") {
        // sensible default: only items that still need action
        filtered = filtered.filter((a) => {
          const s = norm(a.status).toLowerCase();
          return s === "open" || s === "moved";
        });
      }

      // newest first by updated/created
      filtered.sort((a, b) => {
        const ta = Date.parse(a.updated || a.createdAt || a.created || 0) || 0;
        const tb = Date.parse(b.updated || b.createdAt || b.created || 0) || 0;
        return tb - ta;
      });

      // cap
      filtered = filtered.slice(0, limit);

      // hydrate safely
      const enriched = await hydrateWithInventory(filtered);

      return json(res, 200, { ok: true, audits: enriched });
    }

    // ---------- POST /api/audit/wrong-bin ----------
    // Create a wrong-bin audit entry (kept minimal; pass-through to Store if available)
    if (req.method === "POST") {
      let body = {};
      try {
        body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
      } catch {}
      const entry = {
        imei: norm(body.imei),
        scannedBin: norm(body.scannedBin),
        trueLocation: norm(body.trueLocation),
        status: norm(body.status) || "open",
        note: norm(body.note),
        createdAt: nowISO(),
        updated: nowISO(),
        movedTo: norm(body.movedTo),
        movedBy: norm(body.movedBy),
        decidedBy: norm(body.decidedBy),
        decision: norm(body.decision),
      };

      if (typeof Store.appendAudit === "function") {
        const saved = await Store.appendAudit(entry);
        return json(res, 200, { ok: true, audit: saved || entry });
      }
      return bad(res, 501, "appendAudit not implemented in Store");
    }

    // ---------- PATCH /api/audit/wrong-bin ----------
    // Update an audit (e.g., resolve/move/decision). Minimal pass-through.
    if (req.method === "PATCH") {
      let body = {};
      try {
        body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
      } catch {}
      const id = norm(body.id);
      if (!id) return bad(res, 400, "missing id");

      const changes = {
        status: body.status != null ? norm(body.status) : undefined,
        movedTo: body.movedTo != null ? norm(body.movedTo) : undefined,
        movedBy: body.movedBy != null ? norm(body.movedBy) : undefined,
        decision: body.decision != null ? norm(body.decision) : undefined,
        decidedBy: body.decidedBy != null ? norm(body.decidedBy) : undefined,
        updated: nowISO(),
      };

      // fall back to list+rewrite if Store doesn't expose an updater
      if (typeof Store.updateAudit === "function") {
        const updated = await Store.updateAudit(id, changes);
        return json(res, 200, { ok: true, audit: updated });
      }

      // fallback path: naive in-place update
      const audits = await Store.listAudits();
      const idx = audits.findIndex((a) => String(a.id || a._id || "") === id);
      if (idx < 0) return bad(res, 404, "not found");
      const merged = { ...audits[idx], ...Object.fromEntries(Object.entries(changes).filter(([,v]) => v !== undefined)) };
      audits[idx] = merged;
      if (typeof Store.saveAudits === "function") {
        await Store.saveAudits(audits);
        return json(res, 200, { ok: true, audit: merged });
      }
      return bad(res, 501, "update not supported (saveAudits missing)");
    }

    // ---------- DELETE /api/audit/wrong-bin ----------
    if (req.method === "DELETE") {
      let body = {};
      try {
        body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
      } catch {}
      const id = norm(body.id);
      if (!id) return bad(res, 400, "missing id");

      if (typeof Store.deleteAudit === "function") {
        await Store.deleteAudit(id);
        return json(res, 200, { ok: true, deleted: id });
      }

      // fallback path: list+rewrite
      const audits = await Store.listAudits();
      const next = audits.filter((a) => String(a.id || a._id || "") !== id);
      if (next.length === audits.length) return bad(res, 404, "not found");
      if (typeof Store.saveAudits === "function") {
        await Store.saveAudits(next);
        return json(res, 200, { ok: true, deleted: id });
      }
      return bad(res, 501, "delete not supported (saveAudits missing)");
    }

    // Method not allowed
    res.setHeader("Allow", "GET,POST,PATCH,DELETE,OPTIONS");
    return bad(res, 405, "method not allowed");
  } catch (err) {
    return bad(res, 500, err && err.message ? err.message : err);
  }
};
