// api/inventory/rebuild-store.js
//
// Rebuild snapshot from the Inventory Google Sheet and persist to Store.
// Writes both inventory:data (rows) and inventory:meta (diagnostics).
//
// Requires:
//   - GOOGLE_CREDENTIALS_JSON  (full SA JSON, raw)
//   - INVENTORY_SHEET_ID       (Google Sheet file ID)
//   - DRIVE_SHEET_TAB          (tab name, e.g., "Inventory")
// Optional:
//   - REDIS_URL                (if set, Store persists to Redis; else in-memory)
//
// Usage: GET/POST /api/inventory/rebuild-store
 
const { google } = require("googleapis");
const XLSX = require("xlsx");
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

function clean(s) { return String(s ?? "").trim(); }
function norm(s) { return clean(s).replace(/\s+/g, " ").trim(); }
function normUpper(s) { return norm(s).toUpperCase(); }

// Map arbitrary column names to canonical fields we use everywhere.
function canonicalHeader(h) {
  const x = normUpper(h);
  if (/(^|\s)(BIN|LOCATION|LOC)\b/.test(x)) return "location";
  if (/^(SKU|ITEM|ITEM SKU|ITEMSKU)$/.test(x)) return "sku";
  if (/^(DESCRIPTION|DESC|ITEM DESC|ITEM DESCRIPTION)$/.test(x)) return "description";
  if (/^(IMEI|SERIAL|SYSTEM IMEI|SYSTEMIMEI|SERIALNUMBER|SERIAL NUMBER)$/.test(x)) return "systemImei";
  if (/^(HASSERIAL|HAS SERIAL|SERIAL FLAG)$/.test(x)) return "hasSerial";
  if (/^(QTY|QTY ON HAND|ONHAND|SYSTEM QTY|SYSTEMQTY)$/.test(x)) return "systemQty";
  // keep unknown headers as-is (lowercased) so diag can show them
  return norm(h).toLowerCase();
}

function normalizeRow(row, headerMap) {
  const out = {};
  for (const [orig, value] of Object.entries(row)) {
    const key = headerMap[orig] || canonicalHeader(orig);
    out[key] = value;
  }
  // Canonicals
  out.location   = normUpper(out.location || "");
  out.sku        = norm(out.sku || "");
  out.description= norm(out.description || "");
  out.systemImei = norm(out.systemImei || "");
  out.hasSerial  = String(out.hasSerial ?? "").toLowerCase().includes("t") || String(out.hasSerial ?? "").toLowerCase()==="true" ? true : false;
  // Prefer numeric; allow empty -> 0
  const qty = Number(String(out.systemQty ?? "").replace(/[, ]/g,""));
  out.systemQty  = Number.isFinite(qty) ? qty : 0;
  return out;
}

async function fetchSheetBinary(sheetId) {
  const credsRaw = process.env.GOOGLE_CREDENTIALS_JSON || "";
  if (!credsRaw) throw new Error("Missing GOOGLE_CREDENTIALS_JSON");
  const creds = JSON.parse(credsRaw.replace(/\r\n/g, "\n"));

  const auth = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ]
  );
  const drive = google.drive({ version: "v3", auth });
  // Export as XLSX to preserve header row and types
  const res = await drive.files.export(
    { fileId: sheetId, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data);
}

function readTabFromWorkbook(buf, tabName) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const names = wb.SheetNames || [];
  if (!names.length) throw new Error("Workbook has no sheets");
  const pick = tabName && names.includes(tabName) ? tabName : (tabName || names[0]);
  const ws = wb.Sheets[pick];
  if (!ws) throw new Error(`Tab "${tabName}" not found. Available: ${names.join(", ")}`);
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" }); // objects by header
  return { rows, tab: pick, sheetNames: names };
}

async function handler(req, res) {
  if (!["GET","POST","OPTIONS"].includes(req.method)) return method(res, "GET, POST");

  try {
    const SHEET_ID = process.env.INVENTORY_SHEET_ID || "";
    const TAB = process.env.DRIVE_SHEET_TAB || "";
    if (!SHEET_ID) return bad(res, 400, "Missing INVENTORY_SHEET_ID");

    const buf = await fetchSheetBinary(SHEET_ID);
    const { rows: rawRows, tab, sheetNames } = readTabFromWorkbook(buf, TAB);

    if (!rawRows.length) {
      await Store.setInventory([]); // clear to be explicit
      await Store.setInventoryMeta({
        at: new Date().toISOString(),
        rows: 0,
        tab,
        sheetId: SHEET_ID,
        sheetNames,
        headerMap: {},
        source: "rebuild-store",
      });
      return ok(res, { ok: true, rows: 0, tab, cleared: true, note: "Sheet had no rows" });
    }

    // Build header map for diagnostics
    const sample = rawRows[0] || {};
    const headerMap = {};
    for (const k of Object.keys(sample)) {
      headerMap[k] = canonicalHeader(k);
    }

    const normalized = rawRows.map(r => normalizeRow(r, headerMap));

    // Persist to Store
    await Store.setInventory(normalized);
    await Store.setInventoryMeta({
      at: new Date().toISOString(),
      rows: normalized.length,
      tab,
      sheetId: SHEET_ID,
      sheetNames,
      headerMap,
      source: "rebuild-store",
    });

    return ok(res, {
      ok: true,
      rows: normalized.length,
      tab,
      sheetId: SHEET_ID,
      sample: normalized.slice(0, 3),
      headerMap,
      sheetNames,
    });
  } catch (e) {
    return bad(res, 500, String(e && e.message || e));
  }
}

module.exports = withCORS(handler);
