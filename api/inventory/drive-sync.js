/* eslint-disable no-console */
// api/inventory/drive-sync.js
const { google } = require("googleapis");
const XLSX = require("xlsx");
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

function driveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing Google SA envs");
  const auth = new google.auth.JWT(
    email,
    null,
    key,
    ["https://www.googleapis.com/auth/drive.readonly"]
  );
  return google.drive({ version: "v3", auth });
}

function normalizeSheet(workbook) {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const rows = json.map(r => {
    const pick = (...keys) => {
      for (const k of keys) {
        const hit = Object.keys(r).find(x => x.toLowerCase().trim() === k.toLowerCase());
        if (hit) return String(r[hit] ?? "").trim();
      }
      return "";
    };
    return {
      location:    pick("location","bin","locationbin","locationbinref.name"),
      sku:         pick("sku","item","itemcode","itemref.code"),
      description: pick("description","itemname","itemref.name","desc"),
      systemImei:  pick("systemimei","imei","serial","lotorserialno","serialno"),
    };
  }).filter(x => x.location || x.sku || x.systemImei);
  return rows;
}

async function fetchFromDrive(fileId) {
  const drive = driveClient();
  const meta = await drive.files.get({ fileId, fields: "id,name,mimeType" });
  const name = meta.data.name || "inventory";
  const mime = meta.data.mimeType || "";

  if (mime === "application/vnd.google-apps.spreadsheet") {
    // Export native Google Sheet as CSV
    const csv = await drive.files.export(
      { fileId, mimeType: "text/csv" },
      { responseType: "arraybuffer" }
    );
    const wb = XLSX.read(Buffer.from(csv.data), { type: "buffer" });
    return { rows: normalizeSheet(wb), filename: name + ".csv", mimetype: "text/csv" };
  }

  // Regular file (XLSX/CSV) stored in Drive
  const bin = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const buf = Buffer.from(bin.data);
  const isText = name.toLowerCase().endsWith(".csv") || /^text\//.test(mime);
  const wb = isText
    ? XLSX.read(buf.toString("utf8"), { type: "string" })
    : XLSX.read(buf, { type: "buffer" });

  return { rows: normalizeSheet(wb), filename: name, mimetype: mime || "application/octet-stream" };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "POST") return method(res, ["POST", "OPTIONS"]);
  withCORS(res);

  const token = String(req.headers["x-sync-token"] || "");
  if (!token || token !== (process.env.DRIVE_SYNC_TOKEN || "")) return bad(res, "Unauthorized", 401);

  const fileId = process.env.DRIVE_FILE_ID || "";
  if (!fileId) return bad(res, "Missing DRIVE_FILE_ID", 500);

  try {
    const { rows, filename, mimetype } = await fetchFromDrive(fileId);
    await Store.setInventory(rows);
    const meta = await Store.setInventoryMeta({ source: "drive", filename, mimetype, count: rows.length });
    return ok(res, { ok: true, meta });
  } catch (e) {
    console.error("[drive-sync] fail", e);
    return bad(res, String(e.message || e), 500);
  }
};
