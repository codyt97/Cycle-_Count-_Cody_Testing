// api/cyclecounts/not-scanned.js
//
// Returns a flattened list of "not-scanned" items for Investigator.
// - By default returns ALL users' bins.
// - Filters:
//     ?onlyUser=1&user=<id>   → show only that user's bins
//     ?bin=<BIN>              → show only one bin
//
// Output shape:
// { ok: true, rows: [
//   {
//     bin, type: "serial"|"nonserial",
//     systemImei, sku, description,
//     systemQty, qtyEntered, missing,
//     counter, started, updated
//   }, ...
// ]}
//
// Notes:
// - "serial" rows are one-per-IMEI (systemQty=1, qtyEntered=0, missing=1)
// - "nonserial" rows appear when systemQty > qtyEntered (aggregated per SKU row)

const { withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User");
  res.end(JSON.stringify(obj));
}

function norm(s) { return String(s ?? "").trim(); }
function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") { withCORS(res); res.statusCode = 204; return res.end(); }
  if (req.method !== "GET")      { withCORS(res); res.setHeader("Allow","GET,OPTIONS"); return json(res,405,{ ok:false, error:"method_not_allowed" }); }
  withCORS(res);

  try {
    const wantUser  = norm(req.query?.user || "").toLowerCase();
    const onlyUser  = String(req.query?.onlyUser || "").toLowerCase() === "1";
    const wantBin   = norm(req.query?.bin || "");

    const all = await Store.listBins(); // array of { user, bin, counter, items[], missingImeis[], nonSerialShortages[], started, submittedAt, ... }
    let bins = Array.isArray(all) ? all : [];

    // Filter to one bin if requested
    if (wantBin) {
      bins = bins.filter(b => norm(b.bin).toLowerCase() === wantBin.toLowerCase());
    }

    // Filter by user only if explicitly requested
    if (onlyUser && wantUser) {
      bins = bins.filter(b => String(b.user || "").toLowerCase() === wantUser);
    }

    // Build rows
    const out = [];

    for (const b of bins) {
      const bin       = norm(b.bin);
      const counter   = norm(b.counter || b.user || "");
      const started   = b.started || b.startedAt || "";
      const updated   = b.submittedAt || b.updatedAt || "";

      const items = Array.isArray(b.items) ? b.items : [];
      const missingImeis = Array.isArray(b.missingImeis) ? b.missingImeis : [];

      // ---- SERIAL: each missing IMEI becomes a row ----
      for (const m of missingImeis) {
        const systemImei = norm(m.systemImei || m.imei || m.serial || "");
        if (!systemImei) continue;

        // best-effort SKU/desc from any item line containing this IMEI, else blank
        let sku = "", description = "";
        const hit = items.find(x => norm(x.systemImei || "") === systemImei);
        if (hit) {
          sku = norm(hit.sku || "");
          description = norm(hit.description || "");
        }

        out.push({
          bin,
          type: "serial",
          systemImei,
          sku,
          description,
          systemQty: 1,
          qtyEntered: 0,
          missing: 1,
          counter,
          started,
          updated
        });
      }

      // ---- NON-SERIAL: any row with systemQty > qtyEntered ----
      // Prefer precomputed shortages if present; otherwise recompute from items[].
      const pre = Array.isArray(b.nonSerialShortages) ? b.nonSerialShortages : null;

      const shortages = pre && pre.length
        ? pre.map(s => ({
            sku: norm(s.sku || ""),
            description: norm(s.description || ""),
            systemQty: toNum(s.systemQty, 0),
            qtyEntered: toNum(s.qtyEntered, 0)
          }))
        : items
            .filter(x => !norm(x.systemImei || "")) // non-serial rows only
            .map(x => ({
              sku: norm(x.sku || ""),
              description: norm(x.description || ""),
              systemQty: toNum(x.systemQty, 0),
              qtyEntered: toNum(x.qtyEntered, 0)
            }))
            .filter(s => s.qtyEntered < s.systemQty);

      for (const s of shortages) {
        const missing = Math.max(0, toNum(s.systemQty,0) - toNum(s.qtyEntered,0));
        if (missing <= 0) continue;

        out.push({
          bin,
          type: "nonserial",
          systemImei: "", // N/A
          sku: s.sku,
          description: s.description,
          systemQty: toNum(s.systemQty, 0),
          qtyEntered: toNum(s.qtyEntered, 0),
          missing,
          counter,
          started,
          updated
        });
      }
    }

    // Sort for nice UX: by bin, then type (serial first), then SKU/IMEI
    out.sort((a, b) => {
      const ab = a.bin.localeCompare(b.bin);
      if (ab) return ab;
      if (a.type !== b.type) return a.type === "serial" ? -1 : 1;
      // serial: sort by IMEI; nonserial: by SKU
      const ak = a.type === "serial" ? a.systemImei : a.sku;
      const bk = b.type === "serial" ? b.systemImei : b.sku;
      return String(ak).localeCompare(String(bk));
    });

    return json(res, 200, { ok: true, rows: out });
  } catch (e) {
    return json(res, 500, { ok:false, error: String(e && e.message || e) });
  }
};
