// api/cyclecounts/not-scanned.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const { google } = require("googleapis");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

// ---------------------------- utils ----------------------------
const norm = (s) => String(s ?? "").trim();
const nowISO = () => new Date().toISOString();

function getSheets() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY");
  const auth = new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
  return google.sheets({ version: "v4", auth });
}

async function readTabObjects(spreadsheetId, tabName) {
  const sheets = getSheets();
  const range = `${tabName}!A1:Z100000`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = resp.data.values || [];
  if (!values.length) return [];
  const headers = values[0].map(h => String(h || "").trim());
  const rows = values.slice(1);
  return rows.map(r => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i] || `col${i}`] = r[i] ?? "";
    return obj;
  });
}

function looseUserMatch(counter, want) {
  const c = norm(counter).toLowerCase();
  const w = norm(want).toLowerCase();
  if (!c || !w) return false;
  if (c === w) return true;
  if (c.includes(w)) return true;
  const parts = c.split(/\s+/);
  const first = parts[0] || "";
  const last = parts[parts.length - 1] || "";
  return first === w || last === w;
}

// ---------------------------- DELETE ----------------------------
async function handleDelete(req, res) {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    let bin       = norm(body.bin || req.query?.bin || "");
    const imei    = norm(body.systemImei || body.imei || req.query?.imei || "");
    const sku     = norm(body.sku || req.query?.sku || "");
    const entered = Number(body.qtyEntered != null ? body.qtyEntered : req.query?.qtyEntered) || 0;
    const user    = norm(body.user || body.counter || req.query?.user || "");
    const type    = (body.type || (imei ? "serial" : "nonserial")).toLowerCase();

    if (!imei && !sku) return bad(res, "systemImei or sku is required", 400);

    // If bin is missing, try to infer it from latest Store records (by IMEI or SKU with deficit)
    if (!bin) {
      const all = await Store.listBins();
      let best = null, bestT = -1;
      for (const r of all) {
        const t = Date.parse(r.submittedAt || r.updatedAt || r.started || 0) || 0;
        const items = Array.isArray(r.items) ? r.items : [];
        const missingImeis = Array.isArray(r.missingImeis) ? r.missingImeis : [];

        const hitByImei = imei && (
          missingImeis.some(x => norm(x) === imei) ||
          items.some(it => norm(it.systemImei) === imei && Number(it.qtyEntered||0) < (Number(it.systemQty||0) || 1))
        );

        const hitBySku  = sku && items.some(it =>
          !norm(it.systemImei) && norm(it.sku) === sku && Number(it.qtyEntered||0) < Number(it.systemQty||0)
        );

        if (hitByImei || hitBySku) { if (t > bestT) { best = r; bestT = t; } }
      }
      if (!best) return bad(res, "bin not found for provided identifier", 404);
      bin = norm(best.bin);
    }

    // Pull latest bin record
    const all = await Store.listBins();
    let rec = null, recT = -1;
    for (const r of all) {
      if (norm(r.bin).toUpperCase() !== bin.toUpperCase()) continue;
      const t = Date.parse(r.submittedAt || r.updatedAt || r.started || 0) || 0;
      if (t > recT) { rec = r; recT = t; }
    }
    if (!rec) return bad(res, "bin not found", 404);

    // Normalize shapes
    rec.items = Array.isArray(rec.items) ? [...rec.items] : [];
    rec.missingImeis = Array.isArray(rec.missingImeis) ? [...rec.missingImeis] : [];

    let changed = false;

    if (type === "serial" || imei) {
      // ---- SERIAL CLEAR ----
      const targetImei = imei;
      // fill qtyEntered to 1 (or to systemQty if explicitly modeled)
      for (const it of rec.items) {
        if (norm(it.systemImei) === targetImei) {
          const target = Math.max(1, Number(it.systemQty || 1));
          if (Number(it.qtyEntered || 0) < target) { it.qtyEntered = target; changed = true; }
        }
      }
      // also pop from explicit missing list if present
      const before = rec.missingImeis.length;
      rec.missingImeis = rec.missingImeis.filter(x => norm(x) !== targetImei);
      if (rec.missingImeis.length !== before) changed = true;

    } else {
      // ---- NON-SERIAL: set / bump qtyEntered for this SKU ----
      const wantSku = sku;
      let found = false;
      for (const it of rec.items) {
        if (!norm(it.systemImei) && norm(it.sku) === wantSku) {
          const sys = Number(it.systemQty || 0);
          const cur = Number(it.qtyEntered || 0);
          const next = Math.max(cur, Math.min(sys, Number(entered || 0)));
          if (next !== cur) { it.qtyEntered = next; changed = true; }
          found = true;
        }
      }
      if (!found) return bad(res, "sku not found in this bin", 404);
    }

    // Recompute totals only if anything changed
    if (changed) {
      const serialMissing = Array.isArray(rec.missingImeis)
        ? rec.missingImeis.length
        : rec.items.filter(it => norm(it.systemImei) && Number(it.qtyEntered||0) < 1).length;

      const nonSerialMissing = rec.items
        .filter(it => !norm(it.systemImei))
        .reduce((a, it) => a + Math.max(Number(it.systemQty||0) - Number(it.qtyEntered||0), 0), 0);

      const missing = serialMissing + nonSerialMissing;
      const total = Number(rec.total || (
        rec.items.reduce((a,it)=>a + (norm(it.systemImei) ? 1 : Number(it.systemQty||0)), 0)
      ));
      const scanned = Math.max(0, total - missing);

      rec = await Store.upsertBin({
        ...rec,
        scanned,
        missing,
        updatedAt: nowISO(),
      });

      // Optional: write an audit row for traceability
      try {
        await appendRow("ConnectUs – Cycle Count Logs", "NotScannedActions", [
          nowISO(), user || "—", bin, (imei ? "serial" : "nonserial"),
          imei || sku, entered || "", scanned, missing
        ]);
      } catch (e) {
        console.warn("[not-scanned] append audit failed:", e.message || e);
      }
    }

    return ok(res, { ok: true, bin: rec.bin, scanned: rec.scanned, missing: rec.missing });
  } catch (e) {
    console.error("[not-scanned][DELETE] fail:", e);
    return bad(res, String(e.message || e), 500);
  }
}

// ---------------------------- GET ----------------------------
async function handleGet(req, res) {
  try {
    const sheetId = process.env.LOGS_SHEET_ID || "";
    if (!sheetId) return bad(res, "Missing LOGS_SHEET_ID", 500);

    // 1) Pull sheet rows (NotScanned tab)
    let all = await readTabObjects(sheetId, "NotScanned");

    // 2) Synthesize “not-scanned” rows from the latest Store bins
    const latestByBin = new Map();
    for (const b of await Store.listBins()) {
      const k = norm(b.bin).toUpperCase();
      const t = Date.parse(b.submittedAt || b.updatedAt || b.started || 0) || 0;
      const cur = latestByBin.get(k);
      if (!cur || t > cur._t) latestByBin.set(k, { ...b, _t: t });
    }

    const fromStore = [];
    for (const b of latestByBin.values()) {
      const BIN = norm(b.bin);
      const counter = norm(b.counter || "—");
      const items = Array.isArray(b.items) ? b.items : [];
      const missingImeis = Array.isArray(b.missingImeis) ? b.missingImeis : [];

      // serial deficits by explicit missingImeis (if present)
      for (const mi of missingImeis) {
        fromStore.push({
          Bin: BIN, Counter: counter, SKU: "", Description: "",
          Type: "serial", QtySystem: 1, QtyEntered: 0, SystemImei: norm(mi),
        });
      }

      // deficits derived from items (both serial and non-serial)
      for (const it of items) {
        const sku  = norm(it.sku);
        const desc = norm(it.description || it.desc || "");
        const imei = norm(it.systemImei);
        const sys  = Number(it.systemQty || (imei ? 1 : 0));
        const ent  = Number(it.qtyEntered || 0);

        if (imei) {
          // a serial still missing if ent < 1 and not already in missingImeis
          if (ent < 1 && !missingImeis.some(x => norm(x) === imei)) {
            fromStore.push({
              Bin: BIN, Counter: counter, SKU: "", Description: desc,
              Type: "serial", QtySystem: 1, QtyEntered: 0, SystemImei: imei,
            });
          }
        } else {
          const remaining = Math.max(0, sys - ent);
          if (remaining > 0 && sys > 0) {
            fromStore.push({
              Bin: BIN, Counter: counter, SKU: sku, Description: desc,
              Type: "nonserial", QtySystem: sys, QtyEntered: ent, SystemImei: "",
            });
          }
        }
      }
    }

    // 3) Merge sources and de-dup (prefer sheet row)
    all = (all || []).concat(fromStore);
    const wantUser = norm(req.query.user || "");
    const wantBin  = norm(req.query.bin  || "");

    let filtered = all;
    if (wantBin) {
      const BIN = wantBin.toUpperCase();
      filtered = filtered.filter(r => norm(r.Bin || r.bin).toUpperCase() === BIN);
    } else if (wantUser) {
      const byUser = filtered.filter(r => looseUserMatch(r.Counter || r.counter, wantUser));
      filtered = byUser.length ? byUser : filtered;
    }

    const keyOf = (r) => [
      norm(r.Bin || r.bin),
      norm(r.SKU || r.sku),
      norm(r.Description || r.description),
      norm(r.SystemImei || r.systemImei),
    ].join("|");

    const map = new Map();
    for (const r of filtered) map.set(keyOf(r), r);
    const rows = Array.from(map.values());

    // 4) Normalize and FINAL filter (single return path)
    let records = rows.map(r => ({
      bin:        norm(r.Bin ?? r.bin),
      counter:    norm(r.Counter ?? r.counter) || "—",
      sku:        norm(r.SKU ?? r.sku) || "—",
      description:norm(r.Description ?? r.description) || "—",
      systemImei: norm(r.SystemImei ?? r.systemImei),
      systemQty:  Number(r.QtySystem ?? r.systemQty ?? 0),
      qtyEntered: Number(r.QtyEntered ?? r.qtyEntered ?? 0),
      type:       norm(r.Type ?? r.type) || (norm(r.SystemImei ?? r.systemImei) ? "serial" : "nonserial"),
    }));

    // Hide blank non-serials & already satisfied non-serial shortages
    records = records.filter(r => {
      if (r.type === "nonserial") {
        const blank = (!r.sku || r.sku === "—") && (!r.description || r.description === "—");
        if (blank) return false;
        if ((r.qtyEntered || 0) >= (r.systemQty || 0)) return false;
      }
      return true;
    });

    return ok(res, { records });
  } catch (e) {
    console.error("[not-scanned][GET] fail:", e);
    return bad(res, String(e.message || e), 500);
  }
}

// ---------------------------- router ----------------------------
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method === "DELETE")  { withCORS(res); return handleDelete(req, res); }
  if (req.method === "GET")     { withCORS(res); return handleGet(req, res); }
  return method(res, ["GET","DELETE","OPTIONS"]);
};
