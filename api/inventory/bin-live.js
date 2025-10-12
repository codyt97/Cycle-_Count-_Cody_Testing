// api/inventory/bin-live.js
/* eslint-disable no-console */
const { google } = require("googleapis");
const { ok, bad, method, withCORS } = require("../_lib/respond");

// 30s in-memory cache
let cache = { at: 0, tab: "", headers: [], rows: [] };
const TTL_MS = 30_000;

function getSheets() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");
  const auth = new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
  return google.sheets({ version: "v4", auth });
}

function clean(s){ return String(s ?? "").trim(); }
function normBin(s){
  return String(s || "")
    .replace(/\u2013|\u2014/g,"-") // en/em dash → hyphen
    .replace(/\s+/g," ").trim().toUpperCase();
}

// header helpers
function idx(headers, ...names){
  const H = headers.map(h => String(h||"").trim().toLowerCase());
  for (const n of names){
    const k = String(n).trim().toLowerCase();
    const i = H.indexOf(k);
    if (i !== -1) return i;
  }
  return -1;
}
function val(row, i){ return i >=0 && i < row.length ? clean(row[i]) : ""; }
function numLoose(s){
  if (s == null) return undefined;
  const m = String(s).match(/-?\d[\d,]*/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g,""));
  return Number.isFinite(n) ? n : undefined;
}

async function loadSheet(spreadsheetId){
  if (Date.now() - cache.at < TTL_MS && cache.rows.length) return cache;

  const sheets = getSheets();
  // choose tab
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tabEnv = clean(process.env.DRIVE_SHEET_TAB || "");
  let tab = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
  if (tabEnv){
    const hit = meta.data.sheets?.find(s => clean(s.properties?.title).toLowerCase() === tabEnv.toLowerCase());
    if (hit) tab = hit.properties.title;
  }

  // read values
  const range = `${tab}!A1:Z100000`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = resp.data.values || [];
  if (!values.length) {
    cache = { at: Date.now(), tab, headers: [], rows: [] };
    return cache;
  }

  const headers = values[0].map(h => clean(h));
  const rowsRaw = values.slice(1);

  // find columns (very forgiving)
  const iLoc = idx(headers, "bin", "location", "locationbin", "locationbinref.name", "bin code", "bin_code", "location code", "location_code");
  const iSku = idx(headers, "sku", "item", "item ", "itemcode", "item code", "item_code", "itemref.code", "product code", "part", "part number", "partnumber");
  const iDesc = idx(headers, "description", "itemname", "item name", "item_name", "itemref.name", "product description", "desc", "name");
  const iImei = idx(headers, "systemimei", "imei", "serial", "serialno", "lot or serial", "lot/serial", "lotorserialno");
  // qty columns: handle both pure numeric and values with units (e.g., "4 EA")
  const qtyCandidates = [
    "systemqty","system qty","qty","quantity","qty system","quantity system","qty_system",
    "on hand","onhand","on_hand","qtyonhand","qty on hand","qoh","soh",
    "available","available qty","availableqty","avail qty","availqty",
    "stock","inventory","bin qty","binqty","location qty","locationqty"
  ].map(s => s.toLowerCase());
  const iQty = headers.findIndex(h => qtyCandidates.includes(h.toLowerCase()));

  const rows = rowsRaw.map(r => {
    const systemImei = val(r, iImei);
    const hasSerial = !!systemImei;
    let qty = 0;
    if (!hasSerial) {
      const qv = val(r, iQty);
      const n = numLoose(qv);
      qty = Number.isFinite(n) ? n : 0;
    }
    return {
      location:    val(r, iLoc),
      sku:         val(r, iSku),
      description: val(r, iDesc),
      systemImei,
      hasSerial,
      systemQty: hasSerial ? 1 : qty
    };
  }).filter(x => x.location || x.sku || x.systemImei);

  cache = { at: Date.now(), tab, headers, rows };
  return cache;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS"){ withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")     return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  const fileId = clean(process.env.DRIVE_FILE_ID);
  if (!fileId) return bad(res, "Missing DRIVE_FILE_ID", 500);

  const binRaw = clean(req.query.bin || "");
  if (!binRaw) return bad(res, "bin is required", 400);

  try {
    const { rows, tab } = await loadSheet(fileId);

    const want = normBin(binRaw);
    let hits = rows.filter(r => normBin(r.location) === want);
    if (hits.length === 0) hits = rows.filter(r => normBin(r.location).includes(want));

    const records = hits.map(r => ({
      location: r.location,
      sku: r.sku,
      description: r.description,
      systemImei: r.systemImei,
      hasSerial: r.hasSerial,
      systemQty: Number(r.systemQty || 0),
    }));

    if (req.query.debug === "1") {
      const sampleBins = Array.from(new Set(rows.map(r => r.location))).slice(0, 100);
      return ok(res, { records, meta: { tab, totalRows: rows.length, sampleBins } });
    }

    return ok(res, { records, meta: { tab, totalRows: rows.length, cachedMs: Math.max(0, TTL_MS - (Date.now() - cache.at)) } });
  } catch (e) {
    console.error("[bin-live] sheets read error:", e);
    return bad(res, String(e.message || e), 500);
  }
};
