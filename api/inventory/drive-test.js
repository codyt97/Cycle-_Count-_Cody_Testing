/* eslint-disable no-console */
const { google } = require("googleapis");
const XLSX = require("xlsx");
const { ok, bad, method, withCORS } = require("../_lib/respond");

function client() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing Google SA envs");
  const auth = new google.auth.JWT(email, null, key, ["https://www.googleapis.com/auth/drive.readonly"]);
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
      location:    pick("bin","location","locationbin","locationbinref.name").trim(),
      sku:         pick("sku","item","item ","itemcode","itemref.code").trim(),
      description: pick("description","itemname","itemref.name","desc").trim(),
      systemImei:  pick("systemimei","imei","serial","lotorserialno","serialno").trim(),
      __raw: r
    };
  }).filter(x => x.location || x.sku || x.systemImei);
  return { sheetName, rawCount: json.length, normCount: rows.length, sample: rows.slice(0, 5) };
}

async function fetch(fileId) {
  const drive = client();
  const meta = await drive.files.get({ fileId, fields: "id,name,mimeType" });
  const name = meta.data.name || "inventory";
  const mime = meta.data.mimeType || "";

  if (mime === "application/vnd.google-apps.spreadsheet") {
    const csv = await drive.files.export({ fileId, mimeType: "text/csv" }, { responseType: "arraybuffer" });
    const wb = XLSX.read(Buffer.from(csv.data), { type: "buffer" });
    const info = normalizeSheet(wb);
    return { name, mime, ...info };
  }
  const bin = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  const buf = Buffer.from(bin.data);
  const isText = name.toLowerCase().endsWith(".csv")
