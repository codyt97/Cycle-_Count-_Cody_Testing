// api/inventory/status.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { google } = require("googleapis");

const norm = s => String(s ?? "").trim();
const toEST = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York" });
  } catch { return String(iso); }
};

function getSheets() {
  const raw = process.env.GOOGLE_CREDENTIALS_JSON || "";
  if (!raw) throw new Error("Missing GOOGLE_CREDENTIALS_JSON");
  const creds = JSON.parse(raw);
  const key = String(creds.private_key || "").replace(/\r?\n/g, "\n");
  if (!creds.client_email || !key) throw new Error("Bad GOOGLE_CREDENTIALS_JSON");
  const auth = new google.auth.JWT(creds.client_email, null, key, [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
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

function looseUserMatch(counter, want) {
  const c = norm(counter).toLowerCase();
  const w = norm(want).toLowerCase();
  if (!c || !w) return false;
  if (c === w) return true;
  if (c.includes(w)) return true;
  const [first, ...rest] = c.split(/\s+/);
  const last = rest.length ? rest[rest.length - 1] : "";
  return first === w || last === w;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")     return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try {
    const wantBin  = norm(req.query.bin || "");
    const wantUser = norm(req.query.user || "");

    // 1) Seed from Sheets (fallback metadata)
    const seeded = new Map();
    const sheetId = process.env.LOGS_SHEET_ID || "";
    if (sheetId) {
      const rows = await readTabObjects(sheetId, "Bins"); // Bin, Counter, Total, Scanned, Missing, StartedAt, SubmittedAt, State
      for (const r of rows) {
        const k = norm(r.Bin || r.bin).toUpperCase();
        if (!k) continue;
        const rec = {
          bin: norm(r.Bin || r.bin),
          counter: norm(r.Counter || r.counter) || "—",
          started: toEST(r.StartedAt || r.startedAt || r.started || ""),
          updated: toEST(r.SubmittedAt || r.submittedAt || r.updatedAt || r.updated || ""),
          total: Number(r.Total || r.total || 0) || 0,
          scanned: Number(r.Scanned || r.scanned || 0) || 0,
          missing: Number(r.Missing || r.missing || 0) || 0,
          state: norm(r.State || r.state) || "investigation",
        };
        const prev = seeded.get(k);
        const prevT = prev ? (Date.parse(prev.updated) || 0) : -1;
        const curT  = Date.parse(rec.updated) || 0;
        if (!prev || curT > prevT) seeded.set(k, rec);
      }
    }

    // 2) Overwrite with LIVE Store snapshot (truth)
    const latestByBin = new Map();
    for (const b of await Store.listBins()) {
      const k = norm(b.bin).toUpperCase();
      const t = Date.parse(b.submittedAt || b.updatedAt || b.started || 0) || 0;
      const cur = latestByBin.get(k);
      const ct  = cur ? (Date.parse(cur.submittedAt || cur.updatedAt || cur.started || 0) || 0) : -1;
      if (!cur || t > ct) latestByBin.set(k, b);
    }

    for (const [k, b] of latestByBin.entries()) {
      const items = Array.isArray(b.items) ? b.items : [];
      const total = items.reduce((a, it) => a + (norm(it.systemImei) ? 1 : Number(it.systemQty || 0)), 0);
      const serialMissing = Array.isArray(b.missingImeis) ? b.missingImeis.length : 0;
      const nonSerialMissing = items
        .filter(it => !norm(it.systemImei))
        .reduce((a, it) => a + Math.max(Number(it.systemQty || 0) - Number(it.qtyEntered || 0), 0), 0);
      const missing = Math.max(0, serialMissing + nonSerialMissing);
      const scanned = Math.max(0, total - missing);

      const rec = {
        bin: b.bin,
        counter: norm(b.counter || "—"),
        started: toEST(b.started || b.submittedAt || b.updatedAt),
        updated: toEST(b.submittedAt || b.updatedAt || b.started),
        total, scanned, missing,
        state: norm(b.state || "investigation"),
      };
      seeded.set(k, rec); // overwrite sheet values with live store values
    }

    // 3) Filter (prefer bin; else user)
    let out = Array.from(seeded.values());
    if (wantBin) {
      const BIN = wantBin.toUpperCase();
      out = out.filter(r => norm(r.bin).toUpperCase() === BIN);
    } else if (wantUser) {
      const byUser = out.filter(r => looseUserMatch(r.counter, wantUser));
      out = byUser.length ? byUser : out;
    }

    // 4) Sort latest first
    out.sort((a,b) => (Date.parse(b.updated)||0) - (Date.parse(a.updated)||0));
    return ok(res, { records: out });
  } catch (e) {
    console.error("[inventory/status] fail:", e);
    return bad(res, String(e.message || e), 500);
  }
};
