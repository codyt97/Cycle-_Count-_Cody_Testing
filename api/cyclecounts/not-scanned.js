// api/cyclecounts/not-scanned.js
/* eslint-disable no-console */
const { ok, bad, cors, norm, normBin, parseCSV, mapHeaders } = require("../_lib/sheets-utils");

// === CONFIG ===
const INVENTORY_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRtp3DjbdH7HtN5jAZtK4tNpEiDnweKaiu_LsE_YT1VZ4oLDuBPlHwwetgRrspzETcrn1xdQXPO3YCl/pub?gid=0&single=true&output=csv";
const LOGS_CSV_URL      = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQtq-bzPUtmovNvY1WSfjdC6DN5n-pHbT_fEkRF9nFCjazo8kqJ1MkQZmqHPTQRdBODA1bVg4ze5Nz_/pub?output=csv";

module.exports = async (req, res) => {
  cors(res, "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return bad(res, "Method Not Allowed", 405);

  try {
    const bin = norm(req.query.bin || "");
    if (!bin) return bad(res, "bin is required");

    const target = normBin(bin);

    // Inventory for the bin
    const rInv = await fetch(INVENTORY_CSV_URL, { cache:"no-store" });
    if (!rInv.ok) return bad(res, `inventory CSV fetch failed: ${rInv.status}`, 502);
    const invRows = parseCSV(await rInv.text());
    const invIdx  = mapHeaders(invRows[0]);

    const binImeis = [];
    for (let i=1;i<invRows.length;i++){
      const row = invRows[i]; if (!row || !row.length) continue;
      if (normBin(invIdx.iBin>=0 ? row[invIdx.iBin] : "") !== target) continue;
      const imei = norm(invIdx.iImei>=0 ? row[invIdx.iImei] : "");
      if (imei) binImeis.push(imei);
    }

    // Logs: mark-scanned for that bin
    const rLog = await fetch(LOGS_CSV_URL, { cache:"no-store" });
    if (!rLog.ok) return bad(res, `logs CSV fetch failed: ${rLog.status}`, 502);
    const logRows = parseCSV(await rLog.text());
    const logIdx  = mapHeaders(logRows[0]);

    const scannedSet = new Set();
    for (let i=1;i<logRows.length;i++){
      const row = logRows[i]; if (!row || !row.length) continue;
      if (norm(logIdx.iAction>=0 ? row[logIdx.iAction] : "") !== "mark-scanned") continue;
      if (normBin(logIdx.iBin>=0 ? row[logIdx.iBin] : "") !== target) continue;
      const imei = norm(logIdx.iImei>=0 ? row[logIdx.iImei] : "");
      if (imei) scannedSet.add(imei);
    }

    const notScanned = binImeis.filter(x => !scannedSet.has(x));
    return ok(res, { bin: target, notScanned });
  } catch (e) {
    console.error("[not-scanned]", e?.stack || e);
    return bad(res, "internal_error", 500);
  }
};
