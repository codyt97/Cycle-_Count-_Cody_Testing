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
    for (let i = 0; i < headers.length; i++) obj[headers[i] || `col${i}`] = r[i] ?? "";
    return obj;
  });
}

function norm(s){ return String(s ?? "").trim(); }

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")     return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try {
    const sheetId = process.env.LOGS_SHEET_ID || "";
    if (!sheetId) return bad(res, "Missing LOGS_SHEET_ID", 500);

    // Expected headers in NotScanned:
    // Bin, Counter, SKU, Description, Type, QtySystem, QtyEntered
    let all = await readTabObjects(sheetId, "NotScanned");
    // If sheet is empty, fallback to Store snapshot (latest per bin)
if (!all.length) {
  try {
    const Store = require("../_lib/store");
    const bins = await Store.listBins();

    // keep only the latest record per bin
    const latest = new Map();
    for (const b of bins) {
      const k = String(b.bin || "").trim().toUpperCase();
      const t = Date.parse(b.submittedAt || b.updatedAt || b.started || 0) || 0;
      const prev = latest.get(k);
      const prevT = prev ? (Date.parse(prev.submittedAt || prev.updatedAt || prev.started || 0) || 0) : -1;
      if (!prev || t > prevT) latest.set(k, b);
    }

    // synthesize NotScanned rows from nonSerialShortages
    all = [];
    for (const b of latest.values()) {
      const nss = Array.isArray(b.nonSerialShortages) ? b.nonSerialShortages : [];
      for (const s of nss) {
        if (Number(s.qtyEntered || 0) < Number(s.systemQty || 0)) {
          all.push({
            Bin: b.bin,
            Counter: b.counter || "—",
            SKU: s.sku || "—",
            Description: s.description || "—",
            Type: "nonserial",
            QtySystem: Number(s.systemQty || 0),
            QtyEntered: Number(s.qtyEntered || 0),
          });
        }
      }
    }
  } catch (_) {}
}


    // Optional filters
    const wantUser = norm(req.query.user || "").toLowerCase();
    const wantBin  = norm(req.query.bin || "").toUpperCase();

    if (wantUser) {
      all = all.filter(r => norm(r.Counter || r.counter).toLowerCase() === wantUser);
    }
    if (wantBin) {
      all = all.filter(r => norm(r.Bin || r.bin).toUpperCase() === wantBin);
    }

    // Normalize + dedupe by Bin+SKU+Description, keep latest row (last write wins)
    const keyOf = (r) => [norm(r.Bin || r.bin), norm(r.SKU || r.sku), norm(r.Description || r.description)].join("|");
    const map = new Map();
    for (const r of all) map.set(keyOf(r), r);
    const rows = Array.from(map.values());

    const records = rows.map(r => ({
      bin: norm(r.Bin ?? r.bin),
      counter: norm(r.Counter ?? r.counter) || "—",
      sku: norm(r.SKU ?? r.sku) || "—",
      description: norm(r.Description ?? r.description) || "—",
      systemImei: "", // non-serial view
      systemQty: Number(r.QtySystem ?? r.systemQty ?? 0),
      qtyEntered: Number(r.QtyEntered ?? r.qtyEntered ?? 0),
      type: norm(r.Type ?? r.type) || "nonserial",
    }));

    return ok(res, { records });
  } catch (e) {
    console.error("[not-scanned] sheets read fail:", e);
    res.statusCode = 500;
    res.setHeader("content-type","application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok:false, error:String(e.message || e) }));
  }
};
