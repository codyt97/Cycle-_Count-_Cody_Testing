// api/inventory/bin-live.js
//
// GET /api/inventory/bin-live?bin=<BIN>
// Snapshot read order: Store (in-memory) → Redis → Google Sheet (self-heal), then seeds Store+Redis.
// Redis is a cache (TTL), Google Sheet is the source of truth.
//
// Env required:
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY                  (with \n escaped; code unescapes)
// - DRIVE_FILE_ID  OR  GDRIVE_INVENTORY_FILE_ID   (Google Spreadsheet ID)
// - DRIVE_SHEET_TAB OR GDRIVE_INVENTORY_SHEET_NAME (default: "Inventory")
// - (optional) UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN  (enable Redis cache)
// - (optional) INVENTORY_CACHE_TTL_SEC  (default: 3600 = 1 hour)

const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { google } = require("googleapis");
const XLSX = require("xlsx");

// ---------- utils ----------
function clean(s) { return String(s ?? "").trim(); }
function normBin(s) {
  return String(s || "")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
function numLoose(s) {
  if (s == null) return undefined;
  const m = String(s).match(/-?\d[\d,]*/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

// ---------- Google auth/clients ----------
function getJwt() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY");
  return new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
}
const drive = () => google.drive({ version: "v3", auth: getJwt() });
const sheets = () => google.sheets({ version: "v4", auth: getJwt() });

// ---------- Redis (optional cache) ----------
const INVENTORY_ROWS_KEY = "inventory:rows";
const INVENTORY_META_KEY = "inventory:meta";
const DATA_TTL_SEC = Number(process.env.INVENTORY_CACHE_TTL_SEC || 3600);

let _Redis = null;
function getRedis() {
  if (_Redis === null) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      _Redis = false; // explicitly disabled
    } else {
      const { Redis } = require("@upstash/redis");
      _Redis = new Redis({ url, token });
    }
  }
  return _Redis || null;
}
async function redisGetJSON(key) {
  const r = getRedis();
  if (!r) return null;
  const raw = await r.get(key);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
async function redisSetJSON(key, val, ttl = DATA_TTL_SEC) {
  const r = getRedis();
  if (!r) return false;
  await r.set(key, JSON.stringify(val), { ex: ttl });
  return true;
}

// ---------- normalizer ----------
function normalizeFromSheetValues(values) {
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
    "on hand","onhand","on_onhand","on_hand","qtyonhand","qty on hand","qoh","soh",
    "available","available qty","availableqty","avail qty","availqty",
    "stock","inventory","bin qty","binqty","location qty","locationqty"
  ];
  const iQty = headers.findIndex(h => qtyCandidates.includes(h.toLowerCase()));
  const val = (r, i) => (i >= 0 && i < r.length ? clean(r[i]) : "");

  return rowsRaw.map(r => {
    const rawImei = val(r, iImei);
    const systemImei = String(rawImei || "").replace(/\D+/g, "");
    const hasSerial = systemImei.length >= 11;

    let qty = 0;
    if (!hasSerial) {
      const n = numLoose(val(r, iQty));
      qty = Number.isFinite(n) ? n : 0;
    }

    const rawLoc = val(r, iLoc);

    return {
      location:    normBin(rawLoc),
      sku:         val(r, iSku),
      description: val(r, iDesc),
      systemImei,
      hasSerial,
      systemQty: hasSerial ? 1 : qty,
    };
  }).filter(x => x.location || x.sku || x.systemImei);
}

// ---------- Google loader (Sheets tab or Drive file) ----------
async function loadFromDriveUnified(fileId) {
  const d = drive();
  const meta = await d.files.get({ fileId, fields: "id,name,mimeType" });
  const mime = meta.data.mimeType || "";

  // Google Sheet → read exact tab via Sheets API
  if (mime === "application/vnd.google-apps.spreadsheet") {
    const tab =
      process.env.DRIVE_SHEET_TAB ||
      process.env.GDRIVE_INVENTORY_SHEET_NAME ||
      "Inventory";

    const svc = sheets();
    const resp = await svc.spreadsheets.values.get({
      spreadsheetId: fileId,
      range: `${tab}!A:Z`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const values = resp?.data?.values || [];
    return normalizeFromSheetValues(values);
  }

  // XLSX/CSV fallback on Drive
  const bin = await d.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const buf = Buffer.from(bin.data);
  const name = (meta.data.name || "").toLowerCase();
  const looksText = name.endsWith(".csv") || /^text\//.test(mime);
  const wb = looksText ? XLSX.read(buf.toString("utf8"), { type: "string" }) : XLSX.read(buf, { type: "buffer" });
  const tab =
    (process.env.DRIVE_SHEET_TAB && wb.Sheets[process.env.DRIVE_SHEET_TAB])
      ? process.env.DRIVE_SHEET_TAB
      : wb.SheetNames[0];
  const values = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: "", raw: false });
  return normalizeFromSheetValues(values);
}

// ---------- Rebuild snapshot from Google → seed Store + Redis ----------
async function rebuildInventorySnapshot() {
  const fileId = process.env.DRIVE_FILE_ID || process.env.GDRIVE_INVENTORY_FILE_ID || "";
  if (!fileId) throw new Error("Missing DRIVE_FILE_ID (or GDRIVE_INVENTORY_FILE_ID)");

  const rows = await loadFromDriveUnified(fileId);
  if (!rows.length) throw new Error("Inventory sheet returned 0 rows");

  // seed Store
  await Store.setInventory(rows);
  await Store.setInventoryMeta({
    source: "drive",
    tab: process.env.DRIVE_SHEET_TAB || process.env.GDRIVE_INVENTORY_SHEET_NAME || "Inventory",
    count: rows.length,
    updatedAt: new Date().toISOString(),
  });

  // seed Redis (optional)
  await redisSetJSON(INVENTORY_ROWS_KEY, rows);
  await redisSetJSON(INVENTORY_META_KEY, {
    count: rows.length,
    updatedAt: new Date().toISOString(),
  });

  return { count: rows.length };
}

// ---------- handler: Store → Redis → Google (self-heal) ----------
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);
  withCORS(res);

  const match = normBin(req.query.bin || "");
  if (!match) return bad(res, "bin is required", 400);

  // 1) Store (fastest)
  let rows = await Store.getInventory();

  // 2) If empty → try Redis cache
  if (!rows || rows.length === 0) {
    const cached = await redisGetJSON(INVENTORY_ROWS_KEY);
    if (Array.isArray(cached) && cached.length) {
      rows = cached;
      // also hydrate Store for subsequent calls in this runtime
      await Store.setInventory(rows);
    }
  }

  // 3) If still empty → self-heal from Google & repopulate Store+Redis
  if (!rows || rows.length === 0) {
    try {
      const rep = await rebuildInventorySnapshot();
      rows = await Store.getInventory(); // should now be populated
      if (!rows || !rows.length) {
        return bad(res, `Rebuild finished but Store is empty (rows=${rep.count})`, 502);
      }
    } catch (e) {
      const msg = e?.message || String(e);
      console.error("[bin-live] self-heal failed:", msg);
      return bad(res, `Drive/Sheets load failed: ${msg}`, 502);
    }
  }

  const records = rows
    .filter(r => normBin(r.location || "") === match)
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

// Export for warmup endpoint
module.exports.rebuildInventorySnapshot = rebuildInventorySnapshot;