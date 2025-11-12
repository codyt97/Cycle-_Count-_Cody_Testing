// api/cyclecounts/not-scanned/index.js
// Works on Vercel (Node serverless). Supports GET + DELETE.
// GET returns computed Not-Scanned (with ignore filter).
// DELETE adds IMEI to ignore list (and prunes store if present).

import * as Store from "../../_lib/store.js"; // ESM import for Vercel
// ^ if your Store is CommonJS, this still works because Node will bridge.
//   If your Store file uses module.exports, add a default export line there (shown below).

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function getQuery(req) {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const out = Object.create(null);
    u.searchParams.forEach((v, k) => (out[k] = v));
    return out;
  } catch {
    return {};
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); }
    });
  });
}

// Build computed “not-scanned” list from bins
async function computeNotScanned() {
  const bins = await Store.listBins();
  const rows = [];

  for (const b of bins) {
    const bin = String(b.bin || "").trim();
    const counter = String(b.counter || b.user || "").trim();
    const started = b.started || b.startedAt || "";

    // Serial (missing IMEIs)
    if (Array.isArray(b.missingImeis)) {
      for (const m of b.missingImeis) {
        const systemImei = String(m.systemImei || m.imei || "").trim();
        if (!systemImei) continue;

        rows.push({
          id: m.id || systemImei,
          type: "serial",
          bin,
          counter,
          sku: String(m.sku || ""),
          description: String(m.description || ""),
          systemImei,
          detectedAt: m.detectedAt || m.createdAt || b.updatedAt || Store.nowISO(),
          started,
        });
      }
    }

    // Non-serial shortages
    if (Array.isArray(b.nonSerialShortages)) {
      for (const s of b.nonSerialShortages) {
        rows.push({
          id: s.id || `${bin}:${s.sku || ""}`,
          type: "nonserial",
          bin,
          counter,
          sku: String(s.sku || ""),
          description: String(s.description || ""),
          systemQty: Number.isFinite(+s.systemQty) ? +s.systemQty : undefined,
          qtyEntered: Number.isFinite(+s.qtyEntered) ? +s.qtyEntered : undefined,
          missing: Number.isFinite(+s.missing) ? +s.missing : undefined,
          detectedAt: s.detectedAt || s.createdAt || b.updatedAt || Store.nowISO(),
          started,
        });
      }
    }
  }

  return rows;
}

async function handler(req, res) {
  const method = (req.method || "GET").toUpperCase();
  const q = getQuery(req);

  if (method === "OPTIONS") {
    res.setHeader("allow", "GET,DELETE,OPTIONS");
    return res.status(204).end();
  }

  // GET — return computed list, filtered by ignore list
  if (method === "GET") {
    try {
      const computed = await computeNotScanned();

      const ignores = (typeof Store.listNotScannedIgnores === "function")
        ? await Store.listNotScannedIgnores()
        : [];
      const ig = new Set(ignores.map((x) => String(x)));

      const filtered = computed.filter(r => {
        if (r.type === "serial") {
          const key = String(r.systemImei || "");
          return key && !ig.has(key);
        }
        return true;
      });

      // optional debug view
      if (q.debug === "1") {
        return send(res, 200, {
          ok: true,
          ignored: ignores,
          total: computed.length,
          shown: filtered.length,
          rows: filtered,
        });
      }

      return send(res, 200, { ok: true, rows: filtered, items: filtered, records: filtered });
    } catch (e) {
      console.error("[not-scanned][GET] error:", e?.message || e);
      return send(res, 500, { ok: false, error: "server_error" });
    }
  }

  // DELETE — hide one serial IMEI
  if (method === "DELETE") {
    try {
      const body = await readBody(req);
      const imei = String(q.imei || body.imei || "").trim();
      if (!imei) return send(res, 400, { ok: false, error: "missing_imei" });

      // best effort: prune from store (if used)
      if (typeof Store.deleteNotScanned === "function") {
        try { await Store.deleteNotScanned(imei); } catch (_) {}
      }

      // always add to ignore list so GET hides it
      if (typeof Store.addNotScannedIgnore === "function") {
        await Store.addNotScannedIgnore(imei);
      }

      return send(res, 200, { ok: true, deleted: imei });
    } catch (e) {
      console.error("[not-scanned][DELETE] error:", e?.message || e);
      return send(res, 500, { ok: false, error: "server_error" });
    }
  }

  res.setHeader("allow", "GET,DELETE,OPTIONS");
  return send(res, 405, { ok: false, error: "method_not_allowed" });
}

export default handler;
// Also provide CommonJS fallback (in case your project is CJS):
module.exports = handler;
