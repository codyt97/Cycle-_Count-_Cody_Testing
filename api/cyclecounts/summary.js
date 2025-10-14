// api/cyclecounts/summary.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const { google } = require("googleapis");
const Store = require("../_lib/store");

// tiny per-instance cache to smooth bursts (optional)
let cache = { at: 0, payload: null };
const TTL_MS = 300; // 30s

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

function sheetsClient() {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON || "";
  if (!raw) throw new Error("Missing GOOGLE_CREDENTIALS_JSON");
  let creds; try { creds = JSON.parse(raw); } catch { throw new Error("GOOGLE_CREDENTIALS_JSON is not valid JSON"); }
  const key = String(creds.private_key || "").replace(/\r?\n/g, "\n");
  if (!creds.client_email || !key) throw new Error("Bad GOOGLE_CREDENTIALS_JSON");
  const auth = new google.auth.JWT(creds.client_email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ]);
  return google.sheets({ version: "v4", auth });
}

async function readBinsFromSheets() {
  const spreadsheetId = process.env.INVENTORY_SHEET_ID || "";
  const tab = "Bins";
  if (!spreadsheetId) throw new Error("Missing INVENTORY_SHEET_ID");
  const sheets = sheetsClient();
  const range = `${tab}!A1:Z100000`;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = data.values || [];
  if (!rows.length) return [];
  const hdr = rows[0].map(x => String(x||"").trim().toLowerCase());
  const idx = Object.fromEntries(hdr.map((k,i)=>[k,i]));
  const pick = (r,k)=> String(r[idx[k]] ?? "").trim();

  const out = [];
  for (let i=1;i<rows.length;i++){
    const r = rows[i] || [];
    out.push({
      bin:      pick(r,"bin") || pick(r,"location") || "",
      counter:  pick(r,"counter") || "",
      started:  pick(r,"started") || "",
      updated:  pick(r,"updated") || "",
      total:    Number(pick(r,"total") || 0),
      scanned:  Number(pick(r,"scanned") || 0),
      missing:  Number(pick(r,"missing") || 0),
    });
  }
  return out;
}

function summarizeFromStoreBins(storeBins){
  // storeBins: [{ bin, counter, startedAt?, updatedAt?, items:[{systemImei, systemQty, qtyEntered}] }]
  const out = [];
  for (const b of (storeBins || [])) {
    const items = Array.isArray(b.items) ? b.items : [];
    let total=0, scanned=0, missing=0;
    for (const it of items){
      const isSerial = !!(it.systemImei);
      const sys = Number.isFinite(it.systemQty) ? it.systemQty : (isSerial ? 1 : 0);
      const ent = Number(it.qtyEntered || 0);
      if (isSerial){
        total += 1;
        scanned += ent >= 1 ? 1 : 0;
        missing += ent >= 1 ? 0 : 1;
      } else {
        total   += sys;
        scanned += Math.min(sys, ent);
        missing += Math.max(0, sys - ent);
      }
    }
    const startedRaw = b.startedAt || b.started || b.submittedAt || b.updatedAt;
    const updatedRaw = b.updatedAt || b.submittedAt || b.startedAt || b.started;
    out.push({
      bin: String(b.bin||""),
      counter: String(b.counter||"—"),
      started: toEST(startedRaw),
      updated: toEST(updatedRaw),
      total, scanned, missing,
      state: missing > 0 ? "INCOMPLETE" : "DONE",
    });
  }
  // latest first
  out.sort((a,b)=> (Date.parse(b.updated)||0) - (Date.parse(a.updated)||0));
  return out;
}

module.exports = async (req,res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET") return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try {
    // 1) serve from short cache to absorb bursts
    const noCache = String(req.headers["x-no-cache"] || "").toLowerCase() === "1";
const noCache = String(req.headers["x-no-cache"] || "").toLowerCase() === "1";
if (!noCache && cache.payload && (Date.now() - cache.at) < TTL_MS) {
  return ok(res, { records: cache.payload });
}



    // 2) try Store first (no Sheets quota)
    const storeBins = await Store.listBins(); // returns [] if empty
    let records = [];
    if (Array.isArray(storeBins) && storeBins.length) {
      records = summarizeFromStoreBins(storeBins);
    } else {
      // 3) fallback to Sheets ONLY when Store is empty
      const sheetBins = await readBinsFromSheets();
      records = sheetBins.map(b => ({
        bin: b.bin, counter: b.counter,
        started: toEST(b.started), updated: toEST(b.updated),
        total: Number(b.total||0), scanned: Number(b.scanned||0), missing: Number(b.missing||0),
        state: (Number(b.missing||0) > 0 ? "INCOMPLETE" : "DONE"),
      }));
    }

    cache = { at: Date.now(), payload: records };
    return ok(res, { records });
  } catch (e) {
    console.error("[summary] fail:", e);
    return bad(res, e?.message || String(e), 500);
  }
};
