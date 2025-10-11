/* eslint-disable no-console */
// api/inventory/drive-sync.js
const { google } = require("googleapis");
const XLSX = require("xlsx");
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

function driveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const keyEsc = process.env.GOOGLE_PRIVATE_KEY || "";
  if (!email || !keyEsc) throw new Error("Missing Google SA envs");
  const key = keyEsc.replace(/\\n/g, "\n"); // convert \n to real newlines
  const auth = new google.auth.JWT(email, null, key, ["https://www.googleapis.com/auth/drive.readonly"]);
  return google.drive({ version: "v3", auth });
}

function normalizeWorkbook(wb) {
  const name = wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const pick = (row, ...keys) => {
    for (const k of keys) {
      const hit = Object.keys(row).find(x => x.toLowerCase().trim() === k.toLowerCase());
      if (hit) return String(row[hit] ?? "").trim();
    }
    return "";
  };

  return json.map(r => ({
    // 👇 Use the Bin column as the searchable "location"
    location:    pick(r, "bin","location","locationbin","locationbinref.name"),
    sku:         pick(r, "sku","item","item ","itemcode","itemref.code"),
    description: pick(r, "description","itemname","itemref.name","desc"),
    systemImei:  pick(r, "systemimei","imei","serial","lotorserialno","serialno"),
  })).filter(x => x.location || x.sku || x.systemImei);
}

async function fetchFromDrive(fileId) {
  const drive = driveClient();
  const meta = await drive.files.get({ fileId, fields: "id,name,mimeType" });
  const name = meta.data.name || "inventory";
  const mime = meta.data.mimeType || "";

  // Google Sheet → export CSV
  if (mime === "application/vnd.google-apps.spreadsheet") {
    const csv = await drive.files.export({ fileId, mimeType: "text/csv" }, { responseType: "arraybuffer" });
    const wb = XLSX.read(Buffer.from(csv.data), { type: "buffer" });
    return { wb, filename: name + ".csv", mimetype: "text/csv" };
  }

  // Drive file (XLSX/CSV)
  const bin = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const buf = Buffer.from(bin.data);
  const looksText = name.toLowerCase().endsWith(".csv") || /^text\//.test(mime);
  const wb = looksText ? XLSX.read(buf.toString("utf8"), { type: "string" }) : XLSX.read(buf, { type: "buffer" });
  return { wb, filename: name, mimetype: mime || "application/octet-stream" };
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "POST") return method(res, ["POST","OPTIONS"]);
  withCORS(res);

  const token = String(req.headers["x-sync-token"] || "");
  if (!token || token !== (process.env.DRIVE_SYNC_TOKEN || "")) return bad(res, "Unauthorized", 401);

  const fileId = process.env.DRIVE_FILE_ID || "";
  if (!fileId) return bad(res, "Missing DRIVE_FILE_ID", 500);

  try {
    const t0 = Date.now();
    const { wb, filename, mimetype } = await fetchFromDrive(fileId);
    const rows = normalizeWorkbook(wb);

    await Store.setInventory(rows);
    const meta = await Store.setInventoryMeta({
      source: "drive",
      filename,
      mimetype,
      count: rows.length,
      updatedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });

    return ok(res, { ok: true, meta });
  } catch (e) {
    console.error("[drive-sync] fail:", e);
    return bad(res, "Drive fetch failed: " + (e?.message || String(e)), 500);
  }
};
