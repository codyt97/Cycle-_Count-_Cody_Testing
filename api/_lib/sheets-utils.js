// api/_lib/sheets-utils.js
/* eslint-disable no-console */
const ok   = (res, data) => res.status(200).json(data);
const bad  = (res, msg, code = 400) => res.status(code).json({ ok:false, error:String(msg) });
const cors = (res, methods = "GET,POST,OPTIONS") => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
};

const norm = (s) => String(s ?? "").trim();
const normBin = (s) => norm(s).replace(/\u2013|\u2014/g,"-").replace(/\s+/g," ").toUpperCase();

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

function mapHeaders(headerRow){
  const H = headerRow.map(h => norm(h).toLowerCase());
  return {
    iBin  : H.findIndex(x => ["bin","location","location code","locationbin","locationbinref.name"].includes(x)),
    iImei : H.findIndex(x => ["systemimei","imei","serial","serialno","lot or serial","lot/serial","lotorserialno"].includes(x)),
    iSku  : H.findIndex(x => ["sku","item","item code","itemref.code","part","part number"].includes(x)),
    iDesc : H.findIndex(x => ["description","item description"].includes(x)),
    iQty  : H.findIndex(x => ["qty","quantity","on hand","qoh","available","bin qty"].includes(x)),
    // logs columns:
    iAction: H.findIndex(x => x === "action"),
    iUser  : H.findIndex(x => x === "user"),
    iMoved : H.findIndex(x => ["moved?","moved","moved ?"].includes(x)),
    iMovedTo: H.findIndex(x => ["movedto","moved to"].includes(x)),
    iTs    : H.findIndex(x => ["timestamp","ts"].includes(x)),
    iNotes : H.findIndex(x => x === "notes"),
  };
}

module.exports = { ok, bad, cors, norm, normBin, parseCSV, mapHeaders };
