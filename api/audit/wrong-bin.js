// api/audit/wrong-bin.js
/* eslint-disable no-console */
const { ok, bad, cors, norm, parseCSV, mapHeaders } = require("../_lib/sheets-utils");

// === CONFIG ===
const LOGS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQtq-bzPUtmovNvY1WSfjdC6DN5n-pHbT_fEkRF9nFCjazo8kqJ1MkQZmqHPTQRdBODA1bVg4ze5Nz_/pub?output=csv";

module.exports = async (req, res) => {
  cors(res, "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return bad(res, "Method Not Allowed", 405);

  try {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 200)));

    const r = await fetch(LOGS_CSV_URL, { cache:"no-store" });
    if (!r.ok) return bad(res, `logs CSV fetch failed: ${r.status}`, 502);

    const rows = parseCSV(await r.text());
    if (rows.length < 2) return ok(res, { audits: [] });

    const idx = mapHeaders(rows[0]);
    const audits = [];
    for (let i=1;i<rows.length;i++){
      const row = rows[i]; if (!row || !row.length) continue;
      const action = norm(row[idx.iAction]);
      if (action !== "wrong-bin") continue;

      audits.push({
        ts:   norm(idx.iTs>=0   ? row[idx.iTs]   : ""),
        user: norm(idx.iUser>=0 ? row[idx.iUser] : ""),
        bin:  norm(idx.iBin>=0  ? row[idx.iBin]  : ""),
        sku:  norm(idx.iSku>=0  ? row[idx.iSku]  : ""),
        systemImei: norm(idx.iImei>=0 ? row[idx.iImei] : ""),
        movedTo: norm(idx.iMovedTo>=0 ? row[idx.iMovedTo] : ""),
        notes: norm(idx.iNotes>=0 ? row[idx.iNotes] : "")
      });
    }

    audits.sort((a,b) => (a.ts < b.ts ? 1 : -1));
    return ok(res, { audits: audits.slice(0, limit) });
  } catch (e) {
    console.error("[audit/wrong-bin]", e?.stack || e);
    return bad(res, "internal_error", 500);
  }
};
