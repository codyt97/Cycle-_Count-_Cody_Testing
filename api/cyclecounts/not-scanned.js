// api/cyclecounts/not-scanned.js
// Lists, appends, and deletes Not-Scanned records.

const { withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User");
  res.end(JSON.stringify(obj));
}
function norm(s) { return String(s ?? "").trim(); }
function toNum(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") { withCORS(res); res.statusCode = 204; return res.end(); }

  // ---------- GET ----------
  if (req.method === "GET") {
    try {
      const wantUser  = norm(req.query?.user || "").toLowerCase();
      const onlyUser  = String(req.query?.onlyUser || "").toLowerCase() === "1";
      const wantBin   = norm(req.query?.bin || "");
      const debug     = String(req.query?.debug || "").toLowerCase() === "1";

      const all = await Store.listBins();
      let bins = Array.isArray(all) ? all : [];
      if (wantBin) bins = bins.filter(b => norm(b.bin).toLowerCase() === wantBin.toLowerCase());
      if (onlyUser && wantUser) bins = bins.filter(b => String(b.user || "").toLowerCase() === wantUser);

      const out = [];
      const why = [];

      for (const b of bins) {
        const bin       = norm(b.bin);
        const counter   = norm(b.counter || b.user || "");
        const started   = b.started || b.startedAt || "";
        const updated   = b.submittedAt || b.updatedAt || "";

        const items = Array.isArray(b.items) ? b.items : [];
        const missingImeis = Array.isArray(b.missingImeis) ? b.missingImeis : [];
        const preNS = Array.isArray(b.nonSerialShortages) ? b.nonSerialShortages : null;

        // SERIAL
        for (const m of missingImeis) {
          const systemImei = norm(m.systemImei || m.imei || m.serial || "");
          if (!systemImei) continue;
          let sku = "", description = "";
          const hit = items.find(x => norm(x.systemImei || "") === systemImei);
          if (hit) { sku = norm(hit.sku || ""); description = norm(hit.description || ""); }
          out.push({ bin, type:"serial", systemImei, sku, description,
                     systemQty:1, qtyEntered:0, missing:1, counter, started, updated });
        }

        // NON-SERIAL
        let shortages = [];
        if (preNS && preNS.length) {
          shortages = preNS.map(s => ({
            sku:norm(s.sku||""), description:norm(s.description||""),
            systemQty:toNum(s.systemQty,0), qtyEntered:toNum(s.qtyEntered,0)
          })).filter(s => s.qtyEntered < s.systemQty);
        } else if (items.length) {
          shortages = items
            .filter(x => !norm(x.systemImei || "")) // non-serial only
            .map(x => ({
              sku:norm(x.sku||""), description:norm(x.description||""),
              systemQty:toNum(x.systemQty,0), qtyEntered:toNum(x.qtyEntered,0)
            }))
            .filter(s => s.qtyEntered < s.systemQty);
        }

        for (const s of shortages) {
          const missing = Math.max(0, toNum(s.systemQty,0) - toNum(s.qtyEntered,0));
          if (missing <= 0) continue;
          out.push({
            bin, type:"nonserial", systemImei:"",
            sku:s.sku, description:s.description,
            systemQty:toNum(s.systemQty,0), qtyEntered:toNum(s.qtyEntered,0),
            missing, counter, started, updated
          });
        }
      }

      out.sort((a,b)=>{
        const ab=a.bin.localeCompare(b.bin); if(ab) return ab;
        if(a.type!==b.type) return a.type==="serial"?-1:1;
        const ak=a.type==="serial"?a.systemImei:a.sku;
        const bk=b.type==="serial"?b.systemImei:b.sku;
        return String(ak).localeCompare(String(bk));
      });

      const resp={ ok:true, rows:out, items:out, records:out };
      if (debug) resp.meta={ binsExamined:bins.length, reasons:why };
      return json(res,200,resp);
    } catch(e){ return json(res,500,{ ok:false, error:String(e?.message||e) }); }
  }

  // ---------- POST ----------
  if (req.method === "POST") {
    let body={};
    try { body = typeof req.body==="object"?req.body:JSON.parse(req.body||"{}"); } catch {}
    if (!Store.appendNotScanned)
      return json(res,501,{ ok:false, error:"appendNotScanned_not_implemented" });
    const saved = await Store.appendNotScanned(body);
    return json(res,200,{ ok:true, item:saved });
  }

  // ---------- DELETE ----------
  if (req.method === "DELETE") {
    let body={};
    try { body = typeof req.body==="object"?req.body:JSON.parse(req.body||"{}"); } catch {}
    const imei = norm(body.imei || body.systemImei || body.id);
    if (!imei) return json(res,400,{ ok:false, error:"missing_imei" });

    if (typeof Store.deleteNotScanned === "function") {
      await Store.deleteNotScanned(imei);
      return json(res,200,{ ok:true, deleted:imei });
    }

    // fallback: list+rewrite
    if (typeof Store.listNotScanned !== "function" || typeof Store.saveNotScanned !== "function")
      return json(res,501,{ ok:false, error:"delete_not_supported" });

    const rows = await Store.listNotScanned();
    const next = rows.filter(r => String(r.systemImei||r.imei||"") !== imei);
    if (next.length === rows.length)
      return json(res,404,{ ok:false, error:"not_found" });
    await Store.saveNotScanned(next);
    return json(res,200,{ ok:true, deleted:imei });
  }

  // ---------- anything else ----------
  res.setHeader("Allow","GET,POST,DELETE,OPTIONS");
  return json(res,405,{ ok:false, error:"method_not_allowed" });
};
