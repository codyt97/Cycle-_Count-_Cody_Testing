// api/cyclecounts/summary.js
/* eslint-disable no-console */
const { ok, method, withCORS } = require("../_lib/respond");
const { google } = require("googleapis");

function toEST(s){
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false
    });
  } catch { return String(s); }
}

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
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET")     return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try {
    const sheetId = process.env.LOGS_SHEET_ID || "";
    if (!sheetId) throw new Error("Missing LOGS_SHEET_ID");

// Expected headers in Bins tab:
// Bin, Counter, Total, Scanned, Missing, StartedAt, SubmittedAt, State
const rows = await readTabObjects(sheetId, "Bins");

// 1) Build records from the sheet (append-only audit)
const sheetRecords = rows.map(r => {
  const total   = Number(r.Total ?? r.total ?? 0);
  const scanned = Number(r.Scanned ?? r.scanned ?? 0);
  const missing = Number(r.Missing ?? r.missing ?? Math.max(0, total - scanned));
  return {
    bin: String(r.Bin ?? r.bin ?? ""),
    counter: String(r.Counter ?? r.counter ?? "—"),
    started: toEST(r.StartedAt ?? r.startedAt ?? r.started ?? ""),
    updated: toEST(r.SubmittedAt ?? r.submittedAt ?? r.updatedAt ?? r.updated ?? ""),
    total: Number.isFinite(total) ? total : null,
    scanned: Number.isFinite(scanned) ? scanned : null,
    missing: Number.isFinite(missing) ? missing : null,
    state: String(r.State ?? r.state ?? "investigation"),
  };
});

// 2) Pull the latest Store record per bin and OVERWRITE totals with live values
const Store = require("../_lib/store");
const latestByBin = new Map();
for (const b of await Store.listBins()) {
  const k = String(b.bin || "").trim().toUpperCase();
  const t = Date.parse(b.submittedAt || b.updatedAt || b.started || 0) || 0;
  const cur = latestByBin.get(k);
  const ct  = cur ? (Date.parse(cur.submittedAt || cur.updatedAt || cur.started || 0) || 0) : -1;
  if (!cur || t > ct) latestByBin.set(k, b);
}

const merged = new Map();
// seed from sheet
for (const rec of sheetRecords) {
  merged.set(String(rec.bin || "").trim().toUpperCase(), { ...rec });
}
// overwrite/insert from Store
// overwrite/insert from Store
for (const [k, b] of latestByBin.entries()) {
  const items = Array.isArray(b.items) ? b.items : [];
  const total =
    items.reduce((a, it) => a + (String(it.systemImei||"").trim() ? 1 : Number(it.systemQty||0)), 0);
  const serialMissing = Array.isArray(b.missingImeis) ? b.missingImeis.length : 0;
  const nonSerialMissing = items
    .filter(it => !String(it.systemImei||"").trim())
    .reduce((a,it)=> a + Math.max(Number(it.systemQty||0) - Number(it.qtyEntered||0), 0), 0);
  const missing = Math.max(0, serialMissing + nonSerialMissing);
  const scanned = Math.max(0, total - missing);

  const startedRaw = b.started || b.submittedAt || b.updatedAt;
const updatedRaw = b.submittedAt || b.updatedAt || b.started;
const started    = toEST(startedRaw);
const updated    = toEST(updatedRaw);
const updatedTs  = Date.parse(updatedRaw) || 0;

merged.set(k, {
  bin: b.bin,
  counter: String(b.counter || "—"),
  started,
  updated,
  updatedTs,                      // numeric sort key
  total,
  scanned,
  missing,
  state: String(b.state || "investigation"),
});

} 
// 3) Sort by updated desc (numeric) and return
const out = Array.from(merged.values())
  .sort((a,b) => (b.updatedTs||0) - (a.updatedTs||0))
  .map(({ updatedTs, ...r }) => r);

return ok(res, { records: out });


  } catch (e) {
    console.error("[summary] sheets read fail:", e);
    res.statusCode = 500;
    res.setHeader("content-type","application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok:false, error:String(e.message || e) }));
  }
};
