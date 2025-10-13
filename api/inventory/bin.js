// api/inventory/bin.js
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
    const bin = norm(req.query.bin || "");
    if (!bin) return bad(res, "bin is required");

    // 1) fetch CSV
    const r = await fetch(CSV_URL, { cache: "no-store" });
    if (!r.ok) return bad(res, `CSV fetch failed: ${r.status}`, 502);
    const text = await r.text();
    const rows = parseCSV(text);
    if (!rows.length) return ok(res, { records: [] });

    // 2) header map (flex names)
    const H = rows[0].map(h => norm(h).toLowerCase());
    const iBin  = H.findIndex(x => ["bin","location","location code","locationbin","locationbinref.name"].includes(x));
    const iImei = H.findIndex(x => ["systemimei","imei","serial","serialno","lot or serial","lot/serial","lotorserialno"].includes(x));
    const iSku  = H.findIndex(x => ["sku","item","item code","itemref.code","part","part number"].includes(x));
    const iDesc = H.findIndex(x => ["description","item description"].includes(x));
    const iQty  = H.findIndex(x => ["qty","quantity","on hand","qoh","available","bin qty"].includes(x));
    if (iBin < 0) return ok(res, { records: [] });

    // 3) filter + shape
    const target = normBin(bin);
    const records = [];
    for (let r = 1; r < rows.length; r++){
      const row = rows[r]; if (!row || !row.length) continue;
      const binVal = normBin(row[iBin] || "");
      if (binVal !== target) continue;

      const imei = norm(row[iImei]);
      const hasSerial = !!imei;
      const qty = iQty >= 0 ? Number(String(row[iQty]||"").replace(/,/g,"").trim() || 0) : 0;

      records.push({
        location: norm(row[iBin]) || bin,
        sku: norm(row[iSku]),
        description: norm(row[iDesc]),
        systemImei: imei,
        hasSerial,
        systemQty: hasSerial ? 1 : qty
      });
    }

    // (optional) fire-and-forget audit log of the search
    try {
      await fetch(LOGS_URL, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({
          ts: new Date().toISOString(),
          user: req.headers["x-user"] || "",
          action: "bin-search",
          bin, sku:"", systemImei:"",
          notes: `records:${records.length}`,
          sessionId: "api"
        })
      }).catch(()=>{});
    } catch {}

    return ok(res, { records });
  } catch (e) {
    console.error("[inventory/bin]", e?.stack || e);
    return bad(res, "internal_error", 500);
  }
};
