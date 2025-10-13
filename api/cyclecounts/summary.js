// api/cyclecounts/summary.js
/* eslint-disable no-console */
const { ok, bad, cors, norm, normBin, parseCSV, mapHeaders } = require("../_lib/sheets-utils");

// === CONFIG ===
const LOGS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQtq-bzPUtmovNvY1WSfjdC6DN5n-pHbT_fEkRF9nFCjazo8kqJ1MkQZmqHPTQRdBODA1bVg4ze5Nz_/pub?output=csv";

module.exports = async (req, res) => {
  cors(res, "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return bad(res, "Method Not Allowed", 405);

  try {
    const r = await fetch(LOGS_CSV_URL, { cache:"no-store" });
    if (!r.ok) return bad(res, `logs CSV fetch failed: ${r.status}`, 502);
    const rows = parseCSV(await r.text());
    if (rows.length < 2) return ok(res, { bins: [] });

    const idx = mapHeaders(rows[0]);
    const bins = new Map();

    for (let i=1;i<rows.length;i++){
      const row = rows[i]; if (!row || !row.length) continue;
      const action = norm(row[idx.iAction]);
      const bin = normBin(idx.iBin>=0 ? row[idx.iBin] : "");
      const ts  = norm(idx.iTs>=0 ? row[idx.iTs] : "");
      if (!bin) continue;

      let s = bins.get(bin);
      if (!s) { s = { bin, scanned:0, wrongBin:0, moved:0, lastTs:"" }; bins.set(bin, s); }
      if (action === "mark-scanned") s.scanned++;
      if (action === "wrong-bin")    s.wrongBin++;
      if (action === "moved")        s.moved++;
      if (ts && (!s.lastTs || ts > s.lastTs)) s.lastTs = ts;
    }

    return ok(res, { bins: Array.from(bins.values()) });
  } catch (e) {
    console.error("[summary]", e?.stack || e);
    return bad(res, "internal_error", 500);
  }
};
