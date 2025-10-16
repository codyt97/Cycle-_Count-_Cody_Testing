// api/inventory/diag.js
//
// Fast diagnostics: echo active sheetId, tab, header map guess, and 3 sample rows.
// Reads live from Drive (does NOT persist).
//
// GET /api/inventory/diag

const { google } = require("googleapis");
const XLSX = require("xlsx");
const { ok, bad, method, withCORS } = require("../_lib/respond");

function clean(s){ return String(s ?? "").trim(); }
function norm(s){ return clean(s).replace(/\s+/g," ").trim(); }
function normUpper(s){ return norm(s).toUpperCase(); }

function canonicalHeader(h) {
  const x = normUpper(h);
  if (/(^|\s)(BIN|LOCATION|LOC)\b/.test(x)) return "location";
  if (/^(SKU|ITEM|ITEM SKU|ITEMSKU)$/.test(x)) return "sku";
  if (/^(DESCRIPTION|DESC|ITEM DESC|ITEM DESCRIPTION)$/.test(x)) return "description";
  if (/^(IMEI|SERIAL|SYSTEM IMEI|SYSTEMIMEI|SERIALNUMBER|SERIAL NUMBER)$/.test(x)) return "systemImei";
  if (/^(HASSERIAL|HAS SERIAL|SERIAL FLAG)$/.test(x)) return "hasSerial";
  if (/^(QTY|QTY ON HAND|ONHAND|SYSTEM QTY|SYSTEMQTY)$/.test(x)) return "systemQty";
  return norm(h).toLowerCase();
}

async function fetchSheetBinary(sheetId) {
  const credsRaw = process.env.GOOGLE_CREDENTIALS_JSON || "";
  if (!credsRaw) throw new Error("Missing GOOGLE_CREDENTIALS_JSON");
  const creds = JSON.parse(credsRaw.replace(/\r\n/g,"\n"));
  const auth = new google.auth.JWT(
    creds.client_email, null, creds.private_key,
    ["https://www.googleapis.com/auth/drive.readonly","https://www.googleapis.com/auth/spreadsheets.readonly"]
  );
  const drive = google.drive({ version: "v3", auth });
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
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  return { rows, tab: pick, sheetNames: names };
}

async function handler(req, res) {
  if (req.method !== "GET") return method(res, "GET");

  try {
    const SHEET_ID = process.env.INVENTORY_SHEET_ID || "";
    const TAB = process.env.DRIVE_SHEET_TAB || "";
    if (!SHEET_ID) return bad(res, 400, "Missing INVENTORY_SHEET_ID");

    const buf = await fetchSheetBinary(SHEET_ID);
    const { rows, tab, sheetNames } = readTabFromWorkbook(buf, TAB);

    const rawHeaders = rows.length ? Object.keys(rows[0]) : [];
    const headerMap = {};
    for (const h of rawHeaders) headerMap[h] = canonicalHeader(h);

    const sample = rows.slice(0, 3).map(obj => {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        const key = headerMap[k] || canonicalHeader(k);
        out[key] = v;
      }
      return out;
    });

    return ok(res, {
      ok: true,
      sheetId: SHEET_ID,
      tab,
      requestedTab: TAB || null,
      sheetNames,
      rawHeaders,
      headerMap,
      sample,
      env: {
        has_GOOGLE_CREDENTIALS_JSON: !!process.env.GOOGLE_CREDENTIALS_JSON,
        has_REDIS_URL: !!process.env.REDIS_URL,
      }
    });
  } catch (e) {
    return bad(res, 500, String(e && e.message || e));
  }
}

module.exports = withCORS(handler);
