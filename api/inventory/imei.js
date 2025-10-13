// api/inventory/imei.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");

// === Route 1 (Sheets-only) endpoints ===
// Inventory tab published as CSV:
const CSV_URL  = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRtp3DjbdH7HtN5jAZtK4tNpEiDnweKaiu_LsE_YT1VZ4oLDuBPlHwwetgRrspzETcrn1xdQXPO3YCl/pub?gid=0&single=true&output=csv";
// Apps Script Web App (logs):
const LOGS_URL = "https://script.google.com/a/macros/connectuscorp.com/s/AKfycbzuY99ioTUZYYDtDJZY-fhj1eoRer0OUTMJ8JF13iJ5AAOqhmY-p90g3-e9xWw3epAM/exec";

// Minimal CSV parser (server-side)
function parseCSV(text){
  const rows = [];
  let row = [], cur = "", i = 0, q = false;
  while (i < text.length){
    const c = text[i], n = text[i+1];
    if (q){
      if (c === '"' && n === '"'){ cur+='"'; i+=2; continue; }
      if (c === '"'){ q = false; i++; continue; }
      cur += c; i++; continue;
    }
    if (c === '"'){ q = true; i++; continue; }
    if (c === ','){ row.push(cur); cur = ""; i++; continue; }
    if (c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ""; i++; continue; }
    cur += c; i++;
  }
  row.push(cur); rows.push(row);
  return rows;
}
const norm = s => String(s||"").trim();
const normBin = s => norm(s).replace(/\u2013|\u2014/g,"-").replace(/\s+/g," ").toUpperCase();

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET")     return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try{
    const imei = norm(req.query.imei || "");
    const scannedBin = norm(req.query.scannedBin || ""); // optional but recommended
    const scannedBy  = norm(req.query.scannedBy  || "");
    if (!imei) return bad(res, "imei is required", 400);

    // 1) Load CSV
    const r = await fetch(CSV_URL, { cache: "no-store" });
    if (!r.ok) return bad(res, `CSV fetch failed: ${r.status}`, 502);
    const text = await r.text();
    const rows = parseCSV(text);
    if (!rows.length) return ok(res, { found:false, reason:"empty_sheet" });

    // 2) Map headers
    const H = rows[0].map(h => norm(h).toLowerCase());
    const iBin  = H.findIndex(x => ["bin","location","location code","locationbin","locationbinref.name"].includes(x));
    const iImei = H.findIndex(x => ["systemimei","imei","serial","serialno","lot or serial","lot/serial","lotorserialno"].includes(x));
    const iSku  = H.findIndex(x => ["sku","item","item code","itemref.code","part","part number"].includes(x));
    const iDesc = H.findIndex(x => ["description","item description"].includes(x));
    if (iImei < 0 || iBin < 0) return ok(res, { found:false, reason:"missing_headers" });

    // 3) Find the IMEI
    let hit = null;
    for (let r = 1; r < rows.length; r++){
      const row = rows[r]; if (!row || !row.length) continue;
      const val = norm(row[iImei]);
      if (val === imei){
        hit = {
          imei: val,
          location: norm(row[iBin]),
          sku: norm(row[iSku]),
          description: norm(row[iDesc])
        };
        break;
      }
    }

    if (!hit) return ok(res, { found:false, reason:"not_in_snapshot" });

    const resp = {
      found: true,
      imei,
      location: hit.location,
      sku: hit.sku || "",
      description: hit.description || "",
    };

    // 4) If mismatch, log to Apps Script (fire-and-forget)
    if (scannedBin && hit.location && normBin(hit.location) !== normBin(scannedBin)) {
      resp.mismatch = { scannedBin, trueLocation: hit.location };
      (async () => {
        try {
          await fetch(LOGS_URL, {
            method: "POST",
            headers: { "Content-Type":"application/json" },
            body: JSON.stringify({
              ts: new Date().toISOString(),
              user: scannedBy || "—",
              action: "wrong-bin",
              bin: scannedBin,
              sku: hit.sku || "",
              systemImei: imei,
              moved: "",
              movedTo: hit.location,
              notes: "auto: /api/inventory/imei mismatch",
              sessionId: "api"
            })
          });
          resp.auditLogged = true;
        } catch (e) {
          console.error("[AppsScript log] fail:", e?.message || e);
        }
      })();
    }

    return ok(res, resp);
  }catch(e){
    console.error("[inventory/imei]", e?.stack || e?.message || e);
    return bad(res, "internal_error", 500);
  }
};
