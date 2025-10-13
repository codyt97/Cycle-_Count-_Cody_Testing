// api/admin/rebuild-store.js
//
// Force-refresh inventory snapshot from **Google Sheets** into Store (KV).
// If INVENTORY_SHEET_ID is set, uses Sheets API (recommended).
// If not, falls back to Drive file download (XLSX/CSV) IF INVENTORY_DRIVE_FILE_ID is set.
//
// Auth (optional): ?token=... or header X-Admin-Token when ADMIN_TOKEN env is set.

const { ok, bad, method, withCORS } = require("../_lib/respond");
const { google } = require("googleapis");
const XLSX = require("xlsx");
const Store = require("../_lib/store");

function wantAuth(req) {
  return (
    req?.query?.token ||
    req?.headers?.["x-admin-token"] ||
    req?.headers?.["x-adminsecret"] ||
    ""
  );
}
function need(name) {
  const v = process.env[name] || "";
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
function jwt() {
  const email = need("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const key = need("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  return new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ]);
}

function normalizeHeader(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\u2013|\u2014/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function postProcessRow(row) {
  const out = { ...row };
  const aliases = {
    bin: ["bin", "location", "bin location", "bin code"],
    systemImei: [
      "system imei","imei","imei 1","imei1","esn","meid",
      "serial","serial no","serial number","lotserial","lot or serial","lotorserialno","lot/serial"
    ],
    sku: ["sku","item","item no","item number","part number"],
    qty: ["qty","quantity","on hand","qty on hand"],
    description: ["description","item description","product description"],
  };
  for (const [canon, keys] of Object.entries(aliases)) {
    if (out[canon] != null) continue;
    const hit = keys.find(k => out[k] != null);
    if (hit) out[canon] = out[hit];
  }
  return out;
}

// ---- Sheets path ----
async function fetchFromSheet(auth) {
  const sheets = google.sheets({ version: "v4", auth });
  const sheetId = process.env.INVENTORY_SHEET_ID || "";
  if (!sheetId) return null; // signal to try Drive path

  const range = process.env.INVENTORY_SHEET_RANGE || ""; // e.g., "Inventory!A:Z"
  const req = range ? { spreadsheetId: sheetId, range } : { spreadsheetId: sheetId };
  const resp = await sheets.spreadsheets.values.get(req).catch(async (e) => {
    // If no explicit range, get first sheet’s A:Z
    if (range) throw e;
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const first = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
    return sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${first}!A:Z` });
  });

  const rows = resp.data.values || [];
  if (!rows.length) return { rows: [], meta: { sourceType: "sheets", sheetId } };

  const [header, ...body] = rows;
  const keys = header.map(normalizeHeader);

  const list = body.map(r => {
    const obj = {};
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!k) continue;
      obj[k] = r[i] ?? "";
    }
    return postProcessRow(obj);
  });

  return {
    rows: list,
    meta: {
      sourceType: "sheets",
      sheetId,
      range: range || "(firstSheet!A:Z)",
      rows: list.length,
      updatedAt: new Date().toISOString(),
    },
  };
}

// ---- Drive file fallback (XLSX/CSV) ----
async function fetchFromDrive(auth) {
  const driveFileId =
    process.env.INVENTORY_DRIVE_FILE_ID ||
    process.env.GOOGLE_DRIVE_FILE_ID ||
    process.env.DRIVE_FILE_ID ||
    "";
  if (!driveFileId) return null;

  const drive = google.drive({ version: "v3", auth });
  const meta = await drive.files.get({ fileId: driveFileId, fields: "id,name,mimeType,size" });
  // Prefer export for Google Sheets files
  let buffer;
  if (String(meta.data.mimeType || "").includes("spreadsheet")) {
    const exp = await drive.files.export(
      { fileId: driveFileId, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { responseType: "arraybuffer" }
    );
    buffer = Buffer.from(exp.data);
  } else {
    const res = await drive.files.get({ fileId: driveFileId, alt: "media" }, { responseType: "arraybuffer" });
    buffer = Buffer.from(res.data);
  }

  // Parse workbook/CSV
  let list = [];
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
    list = raw.map(row => {
      const out = {};
      for (const [k, v] of Object.entries(row)) out[normalizeHeader(k)] = v;
      return postProcessRow(out);
    });
  } catch {
    const txt = buffer.toString("utf8");
    const lines = txt.split(/\r?\n/).filter(Boolean);
    const hdr = lines.shift().split(",");
    const keys = hdr.map(normalizeHeader);
    list = lines.map(line => {
      const cells = line.split(",");
      const obj = {};
      keys.forEach((k, i) => (obj[k] = (cells[i] ?? "").trim()));
      return postProcessRow(obj);
    });
  }

  return {
    rows: list,
    meta: {
      sourceType: "drive",
      fileId: meta.data.id,
      fileName: meta.data.name,
      rows: list.length,
      updatedAt: new Date().toISOString(),
    },
  };
}

async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") return method(res, ["GET", "POST"]);

    // Optional simple token
    if (process.env.ADMIN_TOKEN) {
      const t = wantAuth(req);
      if (t !== process.env.ADMIN_TOKEN) return bad(res, 401, { ok: false, error: "Unauthorized" });
    }

    const auth = await jwt();

    // Prefer Sheets, then Drive
    let payload = await fetchFromSheet(auth);
    if (!payload) payload = await fetchFromDrive(auth);
    if (!payload) {
      return bad(res, 400, { ok: false, error: "Set INVENTORY_SHEET_ID (preferred) or INVENTORY_DRIVE_FILE_ID." });
    }

    await Store.setInventory(payload.rows);
    const meta = await Store.setInventoryMeta(payload.meta);

    return ok(res, { ok: true, rows: payload.rows.length, meta });
  } catch (e) {
    console.error("[rebuild-store] error", e?.message || e);
    return bad(res, 500, { ok: false, error: String(e?.message || e) });
  }
}

module.exports = withCORS(handler);