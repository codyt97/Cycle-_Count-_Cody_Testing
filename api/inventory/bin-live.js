/* eslint-disable no-console */
// api/inventory/bin-live.js  (unified: Google Sheet OR Excel/CSV on Drive)
const { google } = require("googleapis");
const XLSX = require("xlsx");
const { ok, bad, method, withCORS } = require("../_lib/respond");

// 30s in-memory cache
let cache = { at: 0, tab: "", headers: [], rows: [] };
const TTL_MS = 30_000;

function clean(s){ return String(s ?? "").trim(); }
function normBin(s){
  return String(s || "")
    .replace(/\u2013|\u2014/g,"-") // en/em dash → hyphen
    .replace(/\s+/g," ").trim().toUpperCase();
}

function getJwt() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");
  return new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
}

function sheetsClient() {
  return google.sheets({ version: "v4", auth: getJwt() });
}
function driveClient() {
  return google.drive({ version: "v3", auth: getJwt() });
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
function numLoose(s){
  if (s == null) return undefined;
  const m = String(s).match(/-?\d[\d,]*/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g,""));
  return Number.isFinite(n) ? n : undefined;
}

function normalizeRowsFromArray(values) {
  if (!Array.isArray(values) || !values.length) return { headers: [], rows: [] };

  const headers = values[0].map(h => clean(h));
  const rowsRaw = values.slice(1);

  // locate columns (forgiving)
  const iLoc  = idx(headers, "bin","location","locationbin","locationbinref.name","bin code","bin_code","location code","location_code");
  const iSku  = idx(headers, "sku","item","item ","itemcode","item code","item_code","itemref.code","product code","part","part number","partnumber");
  const iDesc = idx(headers, "description","itemname","item name","item_name","itemref.name","product description","desc","name");
  const iImei = idx(headers, "systemimei","imei","serial","serialno","lot or serial","lot/serial","lotorserialno","lot or serial no","lot or serial number","lot/serial no");

  // qty columns: handle pure numeric and values with units (e.g., "4 EA")
  const qtyCandidates = [
    "systemqty","system qty","qty","quantity","qty system","quantity system","qty_system",
    "on hand","onhand","on_hand","qtyonhand","qty on hand","qoh","soh",
    "available","available qty","availableqty","avail qty","availqty",
    "stock","inventory","bin qty","binqty","location qty","locationqty"
  ].map(s => s.toLowerCase());
  const iQty = headers.findIndex(h => qtyCandidates.includes(h.toLowerCase()));

  const pick = (row, i) => (i >= 0 && i < row.length ? clean(row[i]) : "");

  const rows = rowsRaw.map(r => {
    const rawImei = pick(r, iImei);
    const systemImei = String(rawImei || "").replace(/\D+/g, ""); // keep digits only
    const hasSerial = systemImei.length >= 11; // tolerate ESN/IMEI variants; tighten if you want 14-15

    let qty = 0;
    if (!hasSerial) {
      const qv = pick(r, iQty);
      const n = numLoose(qv);
      qty = Number.isFinite(n) ? n : 0;
    }
    return {
      location:    pick(r, iLoc),
      sku:         pick(r, iSku),
      description: pick(r, iDesc),
      systemImei,
      hasSerial,
      systemQty: hasSerial ? 1 : qty,
    };
  }).filter(x => x.location || x.sku || x.systemImei);

  return { headers, rows };
}

async function loadFromGoogleSheet(spreadsheetId) {
  const sheets = sheetsClient();

  // choose tab
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tabEnv = clean(process.env.DRIVE_SHEET_TAB || "");
  let tab = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
  if (tabEnv){
    const hit = meta.data.sheets?.find(s => clean(s.properties?.title).toLowerCase() === tabEnv.toLowerCase());
    if (hit) tab = hit.properties.title;
  }

  const range = `${tab}!A1:Z100000`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = resp.data.values || [];
  const { headers, rows } = normalizeRowsFromArray(values);
  return { tab, headers, rows };
}

async function loadFromDriveFile(fileId) {
  const drive = driveClient();
  const meta = await drive.files.get({ fileId, fields: "id,name,mimeType" });
  const mime = meta.data.mimeType || "";
  const name = meta.data.name || "";

  // Google Sheet → export CSV
  if (mime === "application/vnd.google-apps.spreadsheet") {
    const csv = await drive.files.export({ fileId, mimeType: "text/csv" }, { responseType: "arraybuffer" });
    const wb  = XLSX.read(Buffer.from(csv.data), { type: "buffer" });
    const sheet = wb.Sheets[process.env.DRIVE_SHEET_TAB || wb.SheetNames[0]];
    const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    const { headers, rows } = normalizeRowsFromArray(values);
    return { tab: process.env.DRIVE_SHEET_TAB || wb.SheetNames[0], headers, rows, name, mime };
  }

  // XLSX/CSV on Drive
  const bin = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const buf = Buffer.from(bin.data);
  const looksText = name.toLowerCase().endsWith(".csv") || /^text\//.test(mime);
  const wb = looksText ? XLSX.read(buf.toString("utf8"), { type: "string" }) : XLSX.read(buf, { type: "buffer" });
  const tab = process.env.DRIVE_SHEET_TAB && wb.Sheets[process.env.DRIVE_SHEET_TAB]
    ? process.env.DRIVE_SHEET_TAB
    : wb.SheetNames[0];

  const sheet = wb.Sheets[tab];
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const { headers, rows } = normalizeRowsFromArray(values);
  return { tab, headers, rows, name, mime };
}

async function loadUnified(fileId){
  if (Date.now() - cache.at < TTL_MS && cache.rows.length) return cache;

  // Try Sheets API first; if it fails, fall back to Drive+XLSX
  try {
    const hit = await loadFromGoogleSheet(fileId);
    cache = { at: Date.now(), ...hit };
    return cache;
  } catch (e) {
    // Fall through to Drive (XLSX/CSV or export Google Sheet)
  }
  const hit = await loadFromDriveFile(fileId);
  cache = { at: Date.now(), ...hit };
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
    const { rows, tab } = await loadUnified(fileId);

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
  const sampleBins = Array.from(new Set(rows.map(r => r.location))).slice(0, 50);
  return ok(res, {
    records,
    meta: {
      tab,
      totalRows: rows.length,
      headers,
      firstRowSample: rows.slice(0, 3),
      want: normBin(binRaw),
      sampleBins
    }
  });
}


    return ok(res, { records, meta: { tab, totalRows: rows.length, cachedMs: Math.max(0, TTL_MS - (Date.now() - cache.at)) } });
  } catch (e) {
    console.error("[bin-live] read error:", e);
    return bad(res, String(e.message || e), 500);
  }
};
