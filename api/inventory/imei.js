// api/inventory/imei.js
/* eslint-disable no-console */

// ======= CONFIG: paste YOUR live URLs =======
const CSV_URL  = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRtp3DjbdH7HtN5jAZtK4tNpEiDnweKaiu_LsE_YT1VZ4oLDuBPlHwwetgRrspzETcrn1xdQXPO3YCl/pub?gid=0&single=true&output=csv";
const LOGS_URL = "https://script.google.com/a/macros/connectuscorp.com/s/AKfycbzuY99ioTUZYYDtDJZY-fhj1eoRer0OUTMJ8JF13iJ5AAOqhmY-p90g3-e9xWw3epAM/exec";

// ======= tiny utils (no external deps) =======
const ok   = (res, data) => res.status(200).json(data);
const bad  = (res, msg, code = 400) => res.status(code).json({ ok:false, error:String(msg) });
const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const norm = (s) => String(s ?? "").trim();
const normBin = (s) => norm(s).replace(/\u2013|\u2014/g, "-").replace(/\s+/g, " ").toUpperCase();

function parseCSV(text){
  const rows=[]; let row=[], cur="", i=0, q=false;
  while(i<text.length){
    const c=text[i], n=text[i+1];
    if(q){ if(c=='"'&&n=='"'){cur+='"';i+=2;continue;} if(c=='"'){q=false;i++;continue;} cur+=c;i++;continue; }
    if(c=='"'){ q=true; i++; continue; }
    if(c===","){ row.push(cur); cur=""; i++; continue; }
    if(c==="\n"){ row.push(cur); rows.push(row); row=[]; cur=""; i++; continue; }
    cur+=c; i++;
  }
  row.push(cur); rows.push(row);
  return rows;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return bad(res, "Method Not Allowed", 405);

  try {
    const imei = norm(req.query.imei || "");
    const scannedBin = norm(req.query.scannedBin || "");
    const scannedBy  = norm(req.query.scannedBy  || "");
    if (!imei) return bad(res, "imei is required");

    // 1) fetch CSV
    const r = await fetch(CSV_URL, { cache: "no-store" });
    if (!r.ok) return bad(res, `CSV fetch failed: ${r.status}`, 502);
    const text = await r.text();
    const rows = parseCSV(text);
    if (!rows.length) return ok(res, { found:false, reason:"empty_sheet" });

    // 2) header map
    const H = rows[0].map(h => norm(h).toLowerCase());
    const iBin  = H.findIndex(x => ["bin","location","location code","locationbin","locationbinref.name"].includes(x));
    const iImei = H.findIndex(x => ["systemimei","imei","serial","serialno","lot or serial","lot/serial","lotorserialno"].includes(x));
    const iSku  = H.findIndex(x => ["sku","item","item code","itemref.code","part","part number"].includes(x));
    const iDesc = H.findIndex(x => ["description","item description"].includes(x));
    if (iImei < 0 || iBin < 0) return ok(res, { found:false, reason:"missing_headers" });

    // 3) find the IMEI
    let hit = null;
    for (let rr=1; rr<rows.length; rr++){
      const row = rows[rr]; if (!row || !row.length) continue;
      if (norm(row[iImei]) === imei){
        hit = {
          imei,
          location: norm(row[iBin]),
          sku: norm(row[iSku]),
          description: norm(row[iDesc])
        };
        break;
      }
    }
    if (!hit) return ok(res, { found:false, reason:"not_in_sheet" });

    const resp = {
      found: true,
      imei,
      location: hit.location,
      sku: hit.sku || "",
      description: hit.description || ""
    };

    // 4) wrong-bin audit (fire-and-forget to Apps Script)
    if (scannedBin && hit.location && normBin(scannedBin) !== normBin(hit.location)) {
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
        } catch (e) {
          console.error("[AppsScript log] fail:", e?.message || e);
        }
      })();
    }

    return ok(res, resp);
  } catch (e) {
    console.error("[inventory/imei]", e?.stack || e);
    return bad(res, "internal_error", 500);
  }
};
