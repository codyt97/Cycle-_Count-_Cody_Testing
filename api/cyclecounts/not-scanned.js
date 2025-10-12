// api/cyclecounts/not-scanned.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const { google } = require("googleapis");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

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

async function handleDelete(req, res){
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    let bin       = norm(body.bin || req.query?.bin || "");
    const imei    = norm(body.systemImei || body.imei || req.query?.imei || "");
    const sku     = norm(body.sku || req.query?.sku || "");
    const entered = Number(body.qtyEntered != null ? body.qtyEntered : req.query?.qtyEntered) || 0;
    const user    = norm(body.user || body.counter || req.query?.user || "");

    if (!imei && !sku) return bad(res, "systemImei or sku is required", 400);

    // Derive bin if missing (by IMEI or by SKU with deficit)
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

    // Load latest record for bin
    const all = await Store.listBins();
    let rec = null, recTime = -1;
    for (const r of all) {
      if (norm(r.bin).toUpperCase() !== bin.toUpperCase()) continue;
      const t = Date.parse(r.submittedAt || r.updatedAt || r.started || 0) || 0;
      if (t > recTime) { rec = r; recTime = t; }
    }
    if (!rec) return bad(res, "bin not found", 404);

    rec.items = Array.isArray(rec.items) ? [...rec.items] : [];
    rec.missingImeis = Array.isArray(rec.missingImeis) ? [...rec.missingImeis] : [];

    let changed = false;

    if (imei) {
      // SERIAL clear
      for (const it of rec.items) {
        if (norm(it.systemImei) === imei) {
          const target = Math.max(1, Number(it.systemQty || 1));
          if (Number(it.qtyEntered || 0) < target) { it.qtyEntered = target; changed = true; }
        }
      }
      const before = rec.missingImeis.length;
      rec.missingImeis = rec.missingImeis.filter(x => norm(x) !== imei);
      if (rec.missingImeis.length !== before) changed = true;
    } else {
      // NON-SERIAL update by SKU
      const it = rec.items.find(x => !norm(x.systemImei) && norm(x.sku) === sku);
      if (!it) return bad(res, "sku not found in bin", 404);
      const sys = Number(it.systemQty || 0);
      const newEntered = Math.min(sys, Math.max(0, Number(entered || 0)));
      if (Number(it.qtyEntered || 0) !== newEntered) { it.qtyEntered = newEntered; changed = true; }
    }

    if (changed) {
      const items = rec.items;
      const total = items.reduce((a, it) => a + (norm(it.systemImei) ? 1 : Number(it.systemQty || 0)), 0);
      const serialMissing = rec.missingImeis.length;
      const nonSerialMissing = items
        .filter(it => !norm(it.systemImei))
        .reduce((a, it) => a + Math.max(Number(it.systemQty||0) - Number(it.qtyEntered||0), 0), 0);
      const missing = Math.max(0, serialMissing + nonSerialMissing);
      const scanned = Math.max(0, total - missing);

      rec = await Store.upsertBin({ ...rec, scanned, missing, updatedAt: nowISO() });

      // optional audit for serial clears
      try { if (imei) await appendRow("FoundImeis", [bin, imei, user || "—", rec.counter || "—", nowISO()]); } catch {}
    }

    // remaining (for non-serial UX)
    let remaining = 0;
    if (!imei) {
      const it2 = rec.items.find(x => !norm(x.systemImei) && norm(x.sku) === sku);
      if (it2) remaining = Math.max(0, Number(it2.systemQty||0) - Number(it2.qtyEntered||0));
    }

    return ok(res, { ok:true, bin, imei, sku, updated: changed, remaining, record: rec });
  } catch (e) {
    console.error("[not-scanned][DELETE] fail:", e);
    return bad(res, String(e.message || e), 500);
  }
}



// -------- GET: list not-scanned (existing behavior, unchanged except small helpers) --------
function looseUserMatch(counter, want) {
  const c = norm(counter).toLowerCase();
  const w = norm(want).toLowerCase();
  if (!c || !w) return false;
  if (c === w) return true;
  if (c.includes(w)) return true;
  const [first, ...rest] = c.split(/\s+/);
  const last = rest.length ? rest[rest.length-1] : "";
  return first === w || last === w;
}

async function handleGet(req, res){
  const sheetId = process.env.LOGS_SHEET_ID || "";
  if (!sheetId) return bad(res, "Missing LOGS_SHEET_ID", 500);

  // read sheet rows
  let all = await readTabObjects(sheetId, "NotScanned");

  // synthesize from latest Store records
  const latestByBin = new Map();
  for (const b of await Store.listBins()) {
    const k = norm(b.bin).toUpperCase();
    const t = Date.parse(b.submittedAt || b.updatedAt || b.started || 0) || 0;
    const cur = latestByBin.get(k);
    const ct  = cur ? (Date.parse(cur.submittedAt || cur.updatedAt || cur.started || 0) || 0) : -1;
    if (!cur || t > ct) latestByBin.set(k, b);
  }

  const fromStore = [];
  for (const b of latestByBin.values()) {
    const counter = norm(b.counter || "—");
    const items = Array.isArray(b.items) ? b.items : [];
    for (const it of items) {
      const sku         = norm(it.sku || "—");
      const description = norm(it.description || "—");
      const systemImei  = norm(it.systemImei || "");
      const hasSerial   = !!systemImei;
      const systemQty   = Number(it.systemQty != null ? it.systemQty : (hasSerial ? 1 : 0)) || 0;
      const qtyEntered  = Number(it.qtyEntered || 0);
      // skip fully satisfied or blank non-serials
if (qtyEntered >= systemQty) {
  // already matched; do not show
} else if (!hasSerial && (!sku || sku === "—") && (!description || description === "—")) {
  // blank non-serial meta; hide
} else {
  fromStore.push({
    Bin: b.bin, Counter: counter, SKU: sku, Description: description,
    Type: hasSerial ? "serial" : "nonserial",
    QtySystem: systemQty, QtyEntered: qtyEntered, SystemImei: systemImei,
  });
}

    }

    // also include b.missingImeis that didn't have an item row
    const known = new Set(items.map(x => norm(x.systemImei)).filter(Boolean));
    if (Array.isArray(b.missingImeis)) {
      for (const raw of b.missingImeis) {
        const mi = norm(raw);
        if (!mi || known.has(mi)) continue;
        let sku = "—", description = "—";
        try {
          const ref = await Store.findByIMEI(mi);
          if (ref) { sku = norm(ref.sku); description = norm(ref.description); }
        } catch {}
        fromStore.push({
          Bin: b.bin, Counter: counter, SKU: sku, Description: description,
          Type: "serial", QtySystem: 1, QtyEntered: 0, SystemImei: mi,
        });
      }
    }
  }
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

  const records = rows.map(r => ({
    bin:        norm(r.Bin ?? r.bin),
    counter:    norm(r.Counter ?? r.counter) || "—",
    sku:        norm(r.SKU ?? r.sku) || "—",
    description:norm(r.Description ?? r.description) || "—",
    systemImei: norm(r.SystemImei ?? r.systemImei),
    systemQty:  Number(r.QtySystem ?? r.systemQty ?? 0),
    qtyEntered: Number(r.QtyEntered ?? r.qtyEntered ?? 0),
    type:       norm(r.Type ?? r.type) || (norm(r.SystemImei ?? r.systemImei) ? "serial" : "nonserial"),
  }));

  return ok(res, { records });
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method === "DELETE")  { withCORS(res); return handleDelete(req, res); }
  if (req.method === "GET")     { withCORS(res); return handleGet(req, res); }
  return method(res, ["GET","DELETE","OPTIONS"]);
};
