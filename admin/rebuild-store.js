// api/admin/rebuild-store.js
//
// Force-refresh the inventory snapshot from Google Drive into Store (KV).
// Auth: optional simple token via ?token=... or header X-Admin-Token (set ADMIN_TOKEN env if you want)
//
// Required ENVs:
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY   (use "\n" escapes in Vercel)
// - INVENTORY_DRIVE_FILE_ID  (the Drive file ID of your XLSX/CSV source)
//
// Optional ENVs (for KV are already set):
// - KV_REST_API_URL
// - KV_REST_API_TOKEN
//
// Returns: { ok: true, rows: <int>, meta: {sourceFileId, updatedAt} }

const { ok, bad, method, withCORS } = require("../_lib/respond");
const { google } = require("googleapis");
const XLSX = require("xlsx");
const Store = require("../_lib/store");

function reqToken(req) {
  return (
    req?.query?.token ||
    req?.headers?.["x-admin-token"] ||
    req?.headers?.["x-adminsecret"] ||
    ""
  );
}

function requireEnv(name) {
  const v = process.env[name] || "";
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

async function driveClient() {
  const email = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const key = requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const auth = new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/drive.readonly",
  ]);
  return google.drive({ version: "v3", auth });
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
  // Normalize common fields used elsewhere in your app
  const out = { ...row };
  // Try to align a few canonical keys:
  const aliases = {
    bin: ["bin", "location", "bin location", "bin code"],
    systemImei: ["system imei", "imei", "serial", "serial number", "lotserial", "lot or serial", "lotorserialno"],
    sku: ["sku", "item", "item no", "item number", "part number"],
    qty: ["qty", "quantity", "on hand", "qty on hand"],
    description: ["description", "item description", "product description"],
  };
  for (const [canon, names] of Object.entries(aliases)) {
    if (out[canon] != null) continue;
    const hit = names.find(n => out[n] != null);
    if (hit) out[canon] = out[hit];
  }
  return out;
}

async function fetchDriveFile(drive, fileId) {
  // Get metadata to learn mime/type
  const meta = await drive.files.get({ fileId, fields: "id, name, mimeType, size" });
  // Download as binary buffer
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return { meta: meta.data, buffer: Buffer.from(res.data) };
}

function parseTable(buffer, nameHint = "") {
  // Supports XLSX or CSV
  // Try workbook; if fails, try CSV
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheetName =
      wb.SheetNames.find(n => /inv|stock|export|sheet|items?/i.test(n)) ||
      wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    let rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    // normalize header keys
    rows = rows.map(r => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        out[normalizeHeader(k)] = v;
      }
      return postProcessRow(out);
    });
    return rows;
  } catch (e) {
    // CSV fallback (rare)
    const txt = buffer.toString("utf8");
    const lines = txt.split(/\r?\n/);
    const [hdr, ...rest] = lines.filter(Boolean);
    const headers = hdr.split(",").map(h => normalizeHeader(h));
    const rows = rest.map(line => {
      const cells = line.split(",");
      const obj = {};
      headers.forEach((h, i) => (obj[h] = (cells[i] ?? "").trim()));
      return postProcessRow(obj);
    });
    return rows;
  }
}

async function handler(req, res) {
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      return method(res, ["GET", "POST"]);
    }

    // Optional simple protection
    const expected = process.env.ADMIN_TOKEN || "";
    if (expected) {
      const token = reqToken(req);
      if (token !== expected) {
        return bad(res, 401, { ok: false, error: "Unauthorized" });
      }
    }

    const fileId =
      process.env.INVENTORY_DRIVE_FILE_ID ||
      process.env.GOOGLE_DRIVE_FILE_ID ||
      process.env.DRIVE_FILE_ID ||
      "";

    if (!fileId) {
      return bad(res, 400, {
        ok: false,
        error:
          "Missing INVENTORY_DRIVE_FILE_ID (or GOOGLE_DRIVE_FILE_ID/DRIVE_FILE_ID) env.",
      });
    }

    const drive = await driveClient();
    const { meta, buffer } = await fetchDriveFile(drive, fileId);
    const rows = parseTable(buffer, meta?.name);
    const count = rows.length;

    await Store.setInventory(rows);
    const savedMeta = await Store.setInventoryMeta({
      sourceFileId: meta?.id || fileId,
      sourceName: meta?.name || "",
      sourceSize: meta?.size || 0,
    });

    return ok(res, { ok: true, rows: count, meta: savedMeta });
  } catch (e) {
    console.error("[rebuild-store] error", e?.message || e);
    return bad(res, 500, { ok: false, error: String(e?.message || e) });
  }
}

module.exports = withCORS(handler);
