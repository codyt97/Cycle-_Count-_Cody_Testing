// api/inventory/bin-live.js
/* eslint-disable no-console */
const { google } = require("googleapis");
const XLSX = require("xlsx");
const { ok, bad, method, withCORS } = require("../_lib/respond");

// tiny in-memory cache per instance (optional)
let cache = { at: 0, rows: [], tab: "" };
const TTL_MS = 30_000; // 30s

function drive() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing Google SA envs");
  const auth = new google.auth.JWT(email, null, key, ["https://www.googleapis.com/auth/drive.readonly"]);
  return google.drive({ version: "v3", auth });
}

function pick(row, ...keys) {
  for (const k of keys) {
    const hit = Object.keys(row).find(x => x.toLowerCase().trim() === k.toLowerCase());
    if (hit) return String(row[hit] ?? "").trim();
  }
  return "";
}
function pickNum(row, ...keys) {
  const v = pick(row, ...keys);
  if (v === "") return undefined;
  const n = Number(String(v).replace(/,/g,""));
  return Number.isFinite(n) ? n : undefined;
}
function numifyLoose(v) {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  const m = s.match(/-?\d[\d,]*/);
  if (!m) return undefined;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function normBin(s) {
  return String(s || "")
    .replace(/\u2013|\u2014/g, "-") // en/em dash → hyphen
    .replace(/\s+/g, " ")           // collapse spaces
    .trim()
    .toUpperCase();
}

async function loadRowsFromSheet(fileId) {
  if (Date.now() - cache.at < TTL_MS && cache.rows.length) return cache;

  const d = drive();
  const meta = await d.files.get({ fileId, fields: "id,mimeType,name" });
  const mime = meta.data.mimeType;

  let wb;
  if (mime === "application/vnd.google-apps.spreadsheet") {
    const csv = await d.files.export({ fileId, mimeType: "text/csv" }, { responseType: "arraybuffer" });
    wb = XLSX.read(Buffer.from(csv.data), { type: "buffer" });
  } else {
    const bin = await d.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    const buf = Buffer.from(bin.data);
    wb = XLSX.read(buf, { type: "buffer" });
  }

  // choose sheet: env override or first
  const WANT_TAB = String(process.env.DRIVE_SHEET_TAB || "").trim();
  let sheetName = wb.SheetNames[0];
  if (WANT_TAB) {
    const idx = wb.SheetNames.findIndex(n => String(n).trim().toLowerCase() === WANT_TAB.toLowerCase());
    if (idx >= 0) sheetName = wb.SheetNames[idx];
  }
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const rows = json.map(r => {
    const systemImei = pick(r, "systemimei","imei","serial","lotorserialno","serialno","lot or serial","lot/serial");
    const hasSerial = !!systemImei;

    // First try aliased numeric columns (plus a few extras)
    const aliased = pickNum(
      r,
      "systemqty","system qty","qty","quantity",
      "onhand","on hand","on_hand","qtyonhand","qty on hand","qoh","soh",
      "available","available qty","availableqty","avail qty","availqty",
      "stock","inventory","bin qty","binqty","location qty","locationqty"
    );

    // If "available" (or any qty-like header) has units like "4 EA", parse number loosely
    let loose = aliased;
    if (loose === undefined) {
      // favored specific header first
      if (Object.prototype.hasOwnProperty.call(r, "available")) {
        const n = numifyLoose(r["available"]);
        if (n !== undefined) loose = n;
      }
      // then scan all qty-like headers
      if (loose === undefined) {
        for (const [k, v] of Object.entries(r)) {
          const key = String(k).toLowerCase().trim();
          if (/(qty|quantity|on\s*hand|qoh|soh|available)/.test(key) && !/uom|unit/.test(key)) {
            const n = numifyLoose(v);
            if (n !== undefined) { loose = n; break; }
          }
        }
      }
    }

    return {
      location:    pick(r, "bin","location","locationbin","locationbinref.name"),
      sku:         pick(r, "sku","item","item ","itemcode","itemref.code","item code","item_code"),
      description: pick(r, "description","itemname","itemref.name","desc","item name","item_name"),
      systemImei,
      hasSerial,
      systemQty: hasSerial ? 1 : (loose ?? 0),
    };
  }).filter(x => x.location || x.sku || x.systemImei);

  cache = { at: Date.now(), rows, tab: sheetName };
  return cache;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET") return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  const fileId = process.env.DRIVE_FILE_ID || "";
  if (!fileId) return bad(res, "Missing DRIVE_FILE_ID", 500);

  const matchRaw = String(req.query.bin || "").trim();
  if (!matchRaw) return bad(res, "bin is required", 400);

  try {
    const { rows, tab } = await loadRowsFromSheet(fileId);

    const want = normBin(matchRaw);
    let hits = rows.filter(r => normBin(r.location) === want);
    if (hits.length === 0) {
      // fallback: contains, for partials or subtle whitespace/dash differences
      hits = rows.filter(r => normBin(r.location).includes(want));
    }

    const records = hits.map(r => ({
      location: r.location,
      sku: r.sku,
      description: r.description,
      systemImei: r.systemImei,
      hasSerial: r.hasSerial,
      systemQty: r.systemQty
    }));

    // optional debug
    if (req.query.debug === "1") {
      const distinctBins = Array.from(new Set(rows.map(r => r.location))).slice(0, 100);
      return ok(res, { records, meta: { totalRows: rows.length, tab, distinctBins } });
    }

    return ok(res, { records, meta: { totalRows: rows.length, tab, cachedMs: Math.max(0, TTL_MS - (Date.now() - cache.at)) }});
  } catch (e) {
    console.error("[bin-live] error:", e);
    return bad(res, "Live sheet fetch failed: " + (e?.message || String(e)), 500);
  }
};
