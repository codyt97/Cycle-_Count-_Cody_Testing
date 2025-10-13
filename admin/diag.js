// api/admin/diag.js
const { withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

function normBin(s) {
  return String(s||"")
    .replace(/\u2013|\u2014/g,"-")
    .replace(/[ _]+/g,"-")
    .replace(/\b(\d)\b/g,"0$1") // zero-pad single digits between dashes
    .toUpperCase().trim();
}

const BIN_KEYS = ["bin","bin location","bin code","location","loc","warehouse bin","bin#","bin id","rack/bin","shelf/bin","aisle/bin","bin-location"]
  .map(s=>s.toLowerCase());
const IMEI_KEYS = ["system imei","imei","imei 1","imei1","esn","meid","serial","serial no","serial number","lotserial","lot or serial","lotorserialno","lot/serial","imei/esn"]
  .map(s=>s.toLowerCase());

function normKeys(row) {
  const out={};
  for (const [k,v] of Object.entries(row||{})) {
    const nk = String(k||"").toLowerCase().replace(/\s+/g," ").trim();
    out[nk]=v;
  }
  return out;
}

module.exports = withCORS(async (req,res)=>{
  try {
    const inv = await Store.getInventory();
    const meta = await Store.getInventoryMeta();
    const total = Array.isArray(inv)?inv.length:0;

    // sample first 5 rows with discovered bin + imei fields
    const samples = (Array.isArray(inv)?inv:[]).slice(0,5).map(r=>{
      const n = normKeys(r);
      const binKey = BIN_KEYS.find(k=>n[k]!=null);
      const imeiKeys = IMEI_KEYS.filter(k=>n[k]!=null);
      return {
        rawKeys: Object.keys(r),
        detectedBinKey: binKey || null,
        detectedImeiKeys: imeiKeys,
        binRaw: binKey? n[binKey] : "",
        binNorm: binKey? normBin(n[binKey]) : "",
        imeiRawSample: imeiKeys.length? String(n[imeiKeys[0]]).slice(0,50) : "",
      };
    });

    // collect top 40 bins we see
    const counts = new Map();
    for (const r of (Array.isArray(inv)?inv:[])) {
      const n = normKeys(r);
      const k = BIN_KEYS.find(k=>n[k]!=null);
      const b = k? normBin(n[k]) : "";
      if (!b) continue;
      counts.set(b, (counts.get(b)||0)+1);
    }
    const topBins = Array.from(counts.entries())
      .sort((a,b)=>b[1]-a[1])
      .slice(0,40)
      .map(([bin,rows])=>({bin,rows}));

    res.statusCode=200;
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({ ok:true, meta, totalRows: total, topBins, samples }, null, 2));
  } catch (e) {
    res.statusCode=500;
    res.end(JSON.stringify({ ok:false, error: String(e?.message||e) }));
  }
});