// api/audit/wrong-bin.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

// ---------------------------- utils ----------------------------
const norm   = (s) => String(s ?? "").trim();
const nowISO = () => new Date().toISOString();

/**
 * Try to list wrong-bin audits from Store with several possible helper names,
 * then filter by optional bin/user/status.
 */
async function listWrongBinAudits({ bin = "", user = "", status = "" } = {}) {
  let rows = [];

  if (typeof Store.listWrongBins === "function") {
    rows = await Store.listWrongBins(bin);
  } else if (typeof Store.listAudits === "function") {
    rows = await Store.listAudits();
  } else if (typeof Store.list === "function") {
    rows = await Store.list("audits"); // very generic fallback
  } else {
    rows = [];
  }

  // Normalize a bit and filter
  const BIN   = norm(bin).toUpperCase();
  const USER  = norm(user).toLowerCase();
  const STATE = norm(status).toLowerCase();

  return (rows || [])
    .map(a => ({
      id:         a.id || a._id || "",
      imei:       norm(a.imei || a.systemImei || ""),
      scannedBin: norm(a.scannedBin || a.scanned_from || a.sourceBin || a.bin || ""),
      trueBin:    norm(a.trueLocation || a.decidedBin || a.targetBin || ""),
      status:     (a.status || a.state || "open").toLowerCase(),
      decidedBy:  norm(a.decidedBy || a.resolvedBy || a.closedBy || ""),
      updatedAt:  a.updatedAt || a.decidedAt || a.closedAt || a.timestamp || "",
      createdAt:  a.createdAt || a.insertedAt || "",
      raw:        a, // keep original for PATCH/DELETE
    }))
    .filter(r => (BIN   ? r.scannedBin.toUpperCase() === BIN : true))
    .filter(r => (USER  ? r.decidedBy.toLowerCase() === USER : true))
    .filter(r => (STATE ? r.status === STATE                  : true));
}

/**
 * Load a single audit by id (tries several Store shapes).
 */
async function getAuditById(id) {
  if (typeof Store.getAudit === "function") {
    return Store.getAudit(id);
  }
  if (typeof Store.get === "function") {
    return Store.get("audits", id);
  }
  // Fallback: list & find
  const all = await listWrongBinAudits({});
  return all.find(a => a.id === id)?.raw || null;
}

/**
 * Patch an audit by id with given fields.
 */
async function patchAudit(id, patch) {
  if (typeof Store.patchAudit === "function") {
    return Store.patchAudit(id, patch);
  }
  if (typeof Store.update === "function") {
    return Store.update("audits", id, patch);
  }
  // As a last resort, try a save with id
  if (typeof Store.saveWrongBin === "function") {
    const current = await getAuditById(id);
    return Store.saveWrongBin({ ...(current || {}), ...patch, id });
  }
  if (typeof Store.save === "function") {
    const current = await getAuditById(id);
    return Store.save("audits", { ...(current || {}), ...patch, id });
  }
  throw new Error("Store does not support patching audits");
}

// ---------------------------- handler ----------------------------
module.exports = async (req, res) => {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      withCORS(res);
      return res.status(204).end();
    }

    // Uniform CORS for others
    withCORS(res);

    // Parse body/query safely
    const q    = req.query || {};
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const id   = norm(q.id   || body.id   || "");
    const bin  = norm(q.bin  || body.bin  || "");
    const user = norm(q.user || body.user || "");
    const imei = norm(q.imei || body.imei || "");

    // ---------------------- GET ----------------------
    if (req.method === "GET") {
      // Optional filters: ?bin=, ?user=, ?status=
      const status = norm(q.status || "");
      const records = await listWrongBinAudits({ bin, user, status });
      return ok(res, { records });
    }

    // --------------------- PATCH ---------------------
    // Update decision fields (e.g., decidedBin / decidedBy / status / note)
    if (req.method === "PATCH") {
      if (!id) return bad(res, "missing_id", 400);

      const decidedBin = norm(body.decidedBin || body.trueBin || "");
      const decidedBy  = norm(body.decidedBy || user);
      const note       = norm(body.note || "");
      const status     = norm(body.status || "");

      const patch = {
        ...(decidedBin && { decidedBin }),
        ...(decidedBy  && { decidedBy }),
        ...(note       && { note }),
        ...(status     && { status }),
        updatedAt: nowISO(),
      };

      // If caller supplies imei/bin, keep them too (handy for normalization)
      if (imei) patch.imei = imei;
      if (bin)  patch.scannedBin = bin;

      const updated = await patchAudit(id, patch);

      // best-effort append to Sheet
      try {
        await appendRow("ConnectUs – Cycle Count Logs", "WrongBinDecisions", [
          nowISO(), decidedBy || "—", (updated.scannedBin || bin || "—"),
          (updated.decidedBin || decidedBin || "—"), (updated.imei || imei || "—"),
          (status || updated.status || "patched")
        ]);
      } catch (e) {
        console.warn("[wrong-bin][PATCH] sheet append failed:", e.message || e);
      }

      return ok(res, { ok: true, record: updated });
    }

    // -------------------- DELETE --------------------
    // Soft-close the audit (resolved) and capture who resolved it
    if (req.method === "DELETE") {
      if (!id) return bad(res, "missing_id", 400);

      const decidedBy = user || norm(body.decidedBy || "");
      const patch = {
        status: "closed",
        decidedBy: decidedBy || undefined,
        resolvedBy: decidedBy || undefined,
        resolvedAt: nowISO(),
        updatedAt: nowISO(),
      };

      const updated = await patchAudit(id, patch);

      // best-effort append to Sheet
      try {
        await appendRow("ConnectUs – Cycle Count Logs", "WrongBinDecisions", [
          nowISO(), decidedBy || "—", (updated.scannedBin || "—"),
          (updated.decidedBin || "—"), (updated.imei || "—"), "closed"
        ]);
      } catch (e) {
        console.warn("[wrong-bin][DELETE] sheet append failed:", e.message || e);
      }

      return ok(res, { ok: true });
    }

    // -------------------- Fallback --------------------
    return method(res, ["GET", "PATCH", "DELETE", "OPTIONS"]);
  } catch (e) {
    console.error("[wrong-bin] handler error:", e);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
};
