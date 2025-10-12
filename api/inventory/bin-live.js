// api/inventory/bin-live.js
/* eslint-disable no-console */
const { google } = require("googleapis");
const XLSX = require("xlsx");
const { ok, bad, method, withCORS } = require("../_lib/respond");

// --- Auth client for Drive export (read-only) ---
function driveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY");
  const auth = new google.auth.JWT(email, null, key, ["https://www.googleapis.com/auth/drive.readonly"]);
  return google.drive({ version: "v3", auth });
}

// --- Helpers ---
function pick(obj, ...names) {
  const keys = Object.keys(obj || {});
  for (const n of names) {
    const k = keys.find((x) => String(x).trim().toLowerCase() === String(n).trim().toLowerCase());
    if (k) return obj[k];
  }
  return "";
}
function pickNum(obj, ...names) {
  const v = pick(obj, ...names);
  const n = Number(String(v || "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
function clean(s) { return String(s ?? "").trim(); }

// Normalize a worksheet into rows we can use
function normalizeSheet(workbook) {
  // Pick a sheet by name if provided; else, first
  const WANT_TAB = clean(process.env.DRIVE_SHEET_TAB || "");
  let sheetName = workbook.SheetNames[0];
  if (WANT_TAB) {
    const idx = workbook.SheetNames.findIndex((n) => clean(n).toLowerCase() === WANT_TAB.toLowerCase());
    if (idx >= 0) sheetName = workbook.SheetNames[idx];
  }
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const rows = json.map((r) => {
    // Header alias sets (very forgiving)
    const location = clean(
      pick(
        r,
        "bin", "location", "locationbin", "locationbinref.name",
        "bin location", "bin_location", "binname", "bin name",
        "loc", "loc bin", "location code", "location_code", "bin code", "bin_code"
      )
    );

    const sku = clean(
      pick(
        r,
        "sku", "item", "item ", "itemcode", "item_ref.code", "itemref.code",
        "product code", "product_code", "part", "part number", "partnumber", "item code", "item_code"
      )
    );

    const description = clean(
      pick(
        r,
        "description", "itemname", "item_ref.name", "itemref.name",
        "desc", "product description", "name", "item name", "item_name"
      )
    );

    // Serial / IMEI field
    const systemImei = clean(
      pick(
        r,
        "systemimei", "imei", "serial", "lotorserialno", "serialno", "lot or serial", "lot/serial", "lotserial"
      )
    );
    const hasSerial = !!systemImei;

    // Quantity for non-serial rows
    const qtyFromSheet =
      pickNum(
        r,
        "systemqty", "qty", "quantity", "on hand", "onhand", "qoh", "available",
        "stock", "inventory", "bin qty", "location qty", "qty system", "quantity system",
        "qty_system", "quantity counted", "qty counted", "count", "system quantity"
      ) ?? 0;

    return {
      location,
      sku,
      description,
      systemImei,
      hasSerial,
      systemQty: hasSerial ? 1 : qtyFromSheet,
      __raw: r,
    };
  }).filter((x) => x.location || x.sku || x.systemImei);

  return { sheetName, rawCount: json.length, normCount: rows.length, rows };
}

async function loadInventoryFromDrive() {
  const fileId = clean(process.env.DRIVE_FILE_ID);
  if (!fileId) throw new Error("Missing DRIVE_FILE_ID");

  const drive = driveClient();

  // If it's a native Google Sheet, export CSV; else download file bytes
  const meta = await drive.files.get({ fileId, fields: "id,name,mimeType" });
  const mime = meta.data.mimeType || "";

  if (mime === "application/vnd.google-apps.spreadsheet") {
    const csv = await drive.files.export({ fileId, mimeType: "text/csv" }, { responseType: "arraybuffer" });
    const wb = XLSX.read(Buffer.from(csv.data), { type: "buffer" });
    return normalizeSheet(wb);
  }

  const bin = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const wb = XLSX.read(Buffer.from(bin.data), { type: "buffer" });
  return normalizeSheet(wb);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")     return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try {
    const match = clean(req.query.bin || "");
    if (!match) return bad(res, "bin is required", 400);

    const { rows, sheetName, normCount } = await loadInventoryFromDrive();

    // Match by bin/location (case-insensitive)
    const m = match.toLowerCase();
    const records = rows
      .filter((r) => clean(r.location).toLowerCase() === m)
      .map((r) => ({
        location: r.location,
        sku: r.sku,
        description: r.description,
        systemImei: r.systemImei,
        hasSerial: r.hasSerial,
        systemQty: Number(r.systemQty || 0),
      }));

    return ok(res, {
      from: "sheet",
      sheetTab: sheetName,
      matchedBin: match,
      totalParsedRows: normCount,
      records,
    });
  } catch (e) {
    console.error("[bin-live] error:", e);
    return bad(res, String(e.message || e), 500);
  }
};
