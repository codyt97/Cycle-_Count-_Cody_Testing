// api/cyclecounts/not-scanned.js
// GET  -> computed Not-Scanned items (serial + non-serial), filtered by ignore list
// DELETE -> hide a serial IMEI from the list (adds to ignore list, and also prunes store if present)

const Store = require("../_lib/store"); // adjust path if your layout differs

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        resolve({});
      }
    });
  });
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

module.exports = async function handler(req, res) {
  const method = req.method || "GET";

  // -----------------------------------
  // GET — return computed list, filtered by ignore list
  // -----------------------------------
  if (method === "GET") {
    try {
      const computed = await computeNotScanned();

      // Ignore list (supervisor deletions)
      const ignores =
        typeof Store.listNotScannedIgnores === "function"
          ? await Store.listNotScannedIgnores()
          : [];
      const ig = new Set(ignores.map((x) => String(x)));

      // filter serials against ignore list
      const filtered = computed.filter((r) => {
        if (r.type === "serial") {
          const key = String(r.systemImei || "");
          return key && !ig.has(key);
        }
        return true; // keep non-serial for now
      });

      return json(res, 200, { ok: true, rows: filtered, items: filtered, records: filtered });
    } catch (e) {
      console.error("[not-scanned][GET] failed:", e?.message || e);
      return json(res, 500, { ok: false, error: "server_error" });
    }
  }

  // -----------------------------------
  // DELETE — hide one serial IMEI
  // -----------------------------------
  if (method === "DELETE") {
    try {
      const q = getQuery(req);
      const body = await parseBody(req);
      const imei = String(q.imei || body.imei || "").trim();

      if (!imei) return json(res, 400, { ok: false, error: "missing_imei" });

      // 1) Try to remove from the not-scanned store (if present)
      if (typeof Store.deleteNotScanned === "function") {
        try {
          await Store.deleteNotScanned(imei);
        } catch (e) {
          // non-fatal – we still add to ignore list
          console.warn("[not-scanned][DELETE] deleteNotScanned warn:", e?.message || e);
        }
      }

      // 2) Always add to ignore list so GET filters it out immediately
      if (typeof Store.addNotScannedIgnore === "function") {
        await Store.addNotScannedIgnore(imei);
      }

      return json(res, 200, { ok: true, deleted: imei });
    } catch (e) {
      console.error("[not-scanned][DELETE] failed:", e?.message || e);
      return json(res, 500, { ok: false, error: "server_error" });
    }
  }

  // Method not allowed
  res.setHeader("allow", "GET, DELETE");
  return json(res, 405, { ok: false, error: "method_not_allowed" });
};
