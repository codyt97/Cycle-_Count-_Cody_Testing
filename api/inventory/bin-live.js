// api/inventory/bin.js  (self-healing snapshot fallback to Drive)
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { google } = require("googleapis");
const XLSX = require("xlsx");
 
function clean(s){ return String(s ?? "").trim(); }
function normBin(s){
  return String(s || "")
    .replace(/\u2013|\u2014/g,"-")
    .replace(/\s+/g," ").trim().toUpperCase();
} 

function getJwt(){
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY");
  return new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
}
const drive = () => google.drive({ version: "v3", auth: getJwt() });

function numLoose(s){
  if (s == null) return undefined;
  const m = String(s).match(/-?\d[\d,]*/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g,""));
  return Number.isFinite(n) ? n : undefined;
}

function normalizeFromSheetValues(values){
  if (!Array.isArray(values) || !values.length) return [];
  const headers = values[0].map(h => clean(h));
  const rowsRaw = values.slice(1);

  const idx = (names) => {
    const H = headers.map(h => h.toLowerCase());
    for (const n of names) {
      const i = H.indexOf(String(n).toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  };

  const iLoc  = idx(["bin","location","locationbin","locationbinref.name","bin code","location code"]);
  const iSku  = idx(["sku","item","item ","itemcode","itemref.code","part","part number"]);
  const iDesc = idx(["description","itemname","itemref.name","desc","name","product description"]);
  const iImei = idx(["systemimei","imei","serial","serialno","lot or serial","lot/serial","lotorserialno"]);
  const qtyCandidates = [
    "systemqty","system qty","qty","quantity","qty system","quantity system","qty_system",
    "on hand","onhand","on_hand","qtyonhand","qty on hand","qoh","soh",
    "available","available qty","availableqty","avail qty","availqty",
    "stock","inventory","bin qty","binqty","location qty","locationqty"
  ];
  const iQty = headers.findIndex(h => qtyCandidates.includes(h.toLowerCase()));

  const val = (r,i) => (i>=0 && i<r.length ? clean(r[i]) : "");
  return rowsRaw.map(r => {
    const rawImei = val(r,iImei);
    const systemImei = String(rawImei || "").replace(/\D+/g,""); // preserve long numbers
    const hasSerial = systemImei.length >= 11;
    let qty = 0;
    if (!hasSerial) {
      const n = numLoose(val(r,iQty));
      qty = Number.isFinite(n) ? n : 0;
    }
    return {
      location:    val(r,iLoc),
      sku:         val(r,iSku),
      description: val(r,iDesc),
      systemImei,
      hasSerial,
      systemQty: hasSerial ? 1 : qty,
    };
  }).filter(x => x.location || x.sku || x.systemImei);
}

async function loadFromDriveUnified(fileId){
  const d = drive();
  const meta = await d.files.get({ fileId, fields: "id,name,mimeType" });
  const mime = meta.data.mimeType || "";
  const name = meta.data.name || "";

  // Google Sheet → export CSV
  if (mime === "application/vnd.google-apps.spreadsheet") {
    const csv = await d.files.export({ fileId, mimeType: "text/csv" }, { responseType: "arraybuffer" });
    const wb = XLSX.read(Buffer.from(csv.data), { type: "buffer" });
    const tab = process.env.DRIVE_SHEET_TAB && wb.Sheets[process.env.DRIVE_SHEET_TAB]
      ? process.env.DRIVE_SHEET_TAB
      : wb.SheetNames[0];
    const values = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: "", raw: false });
    return normalizeFromSheetValues(values);
  }

  // XLSX/CSV on Drive
  const bin = await d.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const buf = Buffer.from(bin.data);
  const looksText = name.toLowerCase().endsWith(".csv") || /^text\//.test(mime);
  const wb = looksText ? XLSX.read(buf.toString("utf8"), { type: "string" }) : XLSX.read(buf, { type: "buffer" });
  const tab = process.env.DRIVE_SHEET_TAB && wb.Sheets[process.env.DRIVE_SHEET_TAB]
    ? process.env.DRIVE_SHEET_TAB
    : wb.SheetNames[0];
  const values = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: "", raw: false });
  return normalizeFromSheetValues(values);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET") return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  const match = clean(req.query.bin || "").toLowerCase();
  if (!match) return bad(res, "bin is required", 400);

  // 1) try snapshot first (Store — was Redis, now memory)
  let all = await Store.getInventory(); // empty after Redis removal:contentReference[oaicite:1]{index=1}
  // 2) self-heal: if empty, pull from Drive now, seed Store, then proceed
  if (!all || all.length === 0) {
    try {
      const fileId = process.env.DRIVE_FILE_ID || "";
      if (!fileId) return bad(res, "Missing DRIVE_FILE_ID", 500);
      const rows = await loadFromDriveUnified(fileId);
      if (rows.length) {
        await Store.setInventory(rows);                            // seed snapshot
        await Store.setInventoryMeta({ source:"drive", count:rows.length }); // keep status
        all = rows;
      }
    } catch (e) {
      console.error("[bin][self-heal] drive load failed:", e?.message || e);
    }
  }

  const records = (all || [])
    .filter(r => (String(r.location || "").trim().toLowerCase() === match))
    .map(r => ({
      location:    r.location || "",
      sku:         r.sku || "",
      description: r.description || "",
      systemImei:  String(r.systemImei || ""),
      hasSerial:   !!r.hasSerial,
      systemQty:   Number.isFinite(r.systemQty) ? r.systemQty : (r.systemImei ? 1 : 0),
    }));

  return ok(res, { records });
};
