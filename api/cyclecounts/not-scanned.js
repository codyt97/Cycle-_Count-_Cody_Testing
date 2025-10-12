// api/cyclecounts/not-scanned.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const { google } = require("googleapis");

function getSheets() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
  const key = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY");
  const auth = new google.auth.JWT(email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ]);
  return google.sheets({ version: "v4", auth });
}

async function readTabObjects(spreadsheetId, tabName) {
  const sheets = getSheets();
  const range = `${tabName}!A1:Z100000`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = resp.data.values || [];
  if (!values.length) return [];

  const headers = values[0].map(h => String(h || "").trim());
  const rows = values.slice(1);

  return rows.map(r => {
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i] || `col${i}`] = r[i] ?? "";
    }
    return obj;
  });
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")     return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try {
    const sheetId = process.env.LOGS_SHEET_ID || "";
    if (!sheetId) return bad(res, "Missing LOGS_SHEET_ID", 500);

    // Expected headers in NotScanned tab:
    // Bin, Counter, SKU, Description, Type, QtySystem, QtyEntered
    const all = await readTabObjects(sheetId, "NotScanned");

    const wantUser = String(req.query?.user || "").trim().toLowerCase();
    const rows = wantUser
      ? all.filter(r => String(r.Counter || r.counter || "").trim().toLowerCase() === wantUser)
      : all;

    const records = rows.map(r => ({
      bin: String(r.Bin ?? r.bin ?? ""),
      counter: String(r.Counter ?? r.counter ?? "—"),
      sku: String(r.SKU ?? r.sku ?? "—"),
      description: String(r.Description ?? r.description ?? "—"),
      systemImei: "", // not applicable on NotScanned (non-serial)
      systemQty: Number(r.QtySystem ?? r.systemQty ?? 0),
      qtyEntered: Number(r.QtyEntered ?? r.qtyEntered ?? 0),
      type: String(r.Type ?? r.type ?? "nonserial"),
    }));

    return ok(res, { records });
  } catch (e) {
    console.error("[not-scanned] sheets read fail:", e);
    res.statusCode = 500;
    res.setHeader("content-type","application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok:false, error:String(e.message || e) }));
  }
};
