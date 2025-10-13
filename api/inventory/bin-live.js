// api/inventory/bin-live.js  — live read from Google Sheets (no snapshot)
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const { google } = require("googleapis");

function clean(s) {
  return String(s ?? "").trim();
}
function normBin(s) {
  return String(s || "")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Build a Sheets client from GOOGLE_CREDENTIALS_JSON */
function getSheets() {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON || "";
  if (!raw) throw new Error("Missing GOOGLE_CREDENTIALS_JSON");
  let creds;
  try { creds = JSON.parse(raw); } catch { throw new Error("GOOGLE_CREDENTIALS_JSON is not valid JSON"); }
  const key = String(creds.private_key || "").replace(/\r?\n/g, "\n");
  if (!creds.client_email || !key) throw new Error("Bad GOOGLE_CREDENTIALS_JSON: missing client_email/private_key");
  const auth = new google.auth.JWT(creds.client_email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ]);
  return google.sheets({ version: "v4", auth });
}

/** Normalize headers -> lowerCamelCase (location, sku, description, systemImei, hasSerial, systemQty) */
function normalizeHeader(h) {
  const s = String(h || "").trim().toLowerCase();
  if (s === "location" || s === "bin") return "location";
  if (s === "sku" || s === "item" || s === "item sku") return "sku";
  if (s.startsWith("desc")) return "description";
  if (s.includes("imei")) return "systemImei";
  if (s.includes("serial")) return "hasSerial";
  if (s.includes("qty")) return "systemQty";
  return s.replace(/[^a-z0-9]+([a-z0-9])/g, (_, c) => c.toUpperCase());
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET") return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try {
    const binRaw = String(req.query.bin || "").trim();
    if (!binRaw) return bad(res, "bin is required", 400);
    const BIN = normBin(binRaw);
    const match = BIN.toLowerCase();

    const spreadsheetId = process.env.INVENTORY_SHEET_ID || "";
    const tabName = process.env.DRIVE_SHEET_TAB || "Inventory";
    if (!spreadsheetId) return bad(res, "Missing INVENTORY_SHEET_ID", 500);

    const sheets = getSheets();
    const range = `${tabName}!A1:Z`;
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = resp.data.values || [];
    if (!rows.length) return ok(res, { records: [] });

    const header = rows[0].map(normalizeHeader);
    const idx = Object.fromEntries(header.map((k, i) => [k, i]));

    // Helper to read a column safely
    const col = (r, key) => clean(r[idx[key]]);

    // Build records
    const data = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const loc = normBin(col(r, "location"));
      if (!loc) continue;
      if (loc.toLowerCase() !== match) continue;

      const sku  = col(r, "sku");
      const desc = col(r, "description");
      const imei = col(r, "systemImei");

      // hasSerial: true if IMEI present OR explicit column says true/Y/1
      let hasSerial = false;
      const hasSerialRaw = col(r, "hasSerial").toLowerCase();
      if (imei) hasSerial = true;
      else if (["y", "yes", "true", "1"].includes(hasSerialRaw)) hasSerial = true;

      // systemQty: prefer numeric column; else default to 1 for serial, 0 for non-serial
      let qty = 0;
      const qtyRaw = col(r, "systemQty");
      if (qtyRaw && !Number.isNaN(Number(qtyRaw))) qty = Number(qtyRaw);
      else qty = hasSerial ? (imei ? 1 : 0) : 0;

      data.push({
        location: loc,
        sku: sku,
        description: desc,
        systemImei: String(imei || ""),
        hasSerial: !!hasSerial,
        systemQty: Number.isFinite(qty) ? qty : (imei ? 1 : 0),
      });
    }

    return ok(res, { records: data });
  } catch (e) {
    console.error("[bin-live] fail:", e);
    return bad(res, e?.message || String(e), 500);
  }
};
