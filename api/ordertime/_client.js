// /api/ordertime/_client.js  (CommonJS)
/**
 * Required env:
 *   OT_BASE_URL=https://services.ordertime.com/api
 *   OT_API_KEY=*****
 *   OT_EMAIL=you@company.com
 *   (one) OT_DEVKEY=*****  or  OT_PASSWORD=*****
 *   OT_LIST_PATH=/List
 * Optional steering:
 *   OT_LIST_TYPENAME=InventoryLotSerial   // string type for your tenant
 *   OT_DEBUG=1
 */
const DEFAULT_TIMEOUT_MS = 15000;

function dbg(...args){ if(process.env.OT_DEBUG) try{ console.log("[OT]", ...args); }catch(_){} }

function baseUrl(){
  const u = (process.env.OT_BASE_URL || "").trim().replace(/\/+$/,"");
  if(!u) throw new Error("OT_BASE_URL missing");
  if(!/^https?:\/\//i.test(u)) throw new Error(`OT_BASE_URL must include http(s): ${u}`);
  return u;
}

// PascalCase headers — many OT tenants require this case exactly.
function authHeaders(){
  const { OT_API_KEY, OT_EMAIL, OT_DEVKEY, OT_PASSWORD } = process.env;
  if(!OT_API_KEY || !OT_EMAIL) throw new Error("Missing OT_API_KEY or OT_EMAIL");
  const h = { "Content-Type": "application/json", ApiKey: OT_API_KEY, Email: OT_EMAIL };
  if (OT_DEVKEY) h.DevKey = OT_DEVKEY;
  else if (OT_PASSWORD) h.Password = OT_PASSWORD;
  else dbg("WARN: neither OT_DEVKEY nor OT_PASSWORD set; auth may fail");
  return h;
}

function withTimeout(ms=DEFAULT_TIMEOUT_MS){
  const ctrl = new AbortController(); const t = setTimeout(()=>ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: ()=>clearTimeout(t) };
}

// ---------- payload transformers ----------
const clone = o => JSON.parse(JSON.stringify(o||{}));

function toFilterValues(body){ // FilterValueArray -> FilterValues
  const b = clone(body);
  if (Array.isArray(b.Filters)) b.Filters = b.Filters.map(f => {
    const g = { ...f };
    if (g.FilterValueArray && !g.FilterValues) { g.FilterValues = g.FilterValueArray; delete g.FilterValueArray; }
    return g;
  });
  return b;
}
const wrapListRequest = body => ({ ListRequest: body });
function useRecordTypeEnumName(body, typeName){
  const b = clone(body);
  delete b.Type; // ensure we don't send both
  if (typeName) { b.TypeName = typeName; } // some tenants bind TypeName
  return b;
}
function useRecordTypeKeyString(body, typeName){
  const b = clone(body);
  delete b.Type;
  if (typeName) { b.RecordType = typeName; } // others bind RecordType (string)
  return b;
}

// Order of variants we’ll try
function payloadVariants(original){
  const tn = (process.env.OT_LIST_TYPENAME || "").trim(); // allow pinning via env
  const candidatesTypeNames = tn ? [tn] : [
    "InventoryLotSerial", "ItemInstance", "InventoryDetail", "DetailedInventory",
    "SerialNumber", "LotNumber", "InventoryByBin", "BinItemSerial"
  ];

  const variants = [];
  // 0. original (numeric Type)
  variants.push({ label: "original", body: original });
  variants.push({ label: "FilterValues", body: toFilterValues(original) });
  variants.push({ label: "ListRequest+original", body: wrapListRequest(original) });
  variants.push({ label: "ListRequest+FilterValues", body: wrapListRequest(toFilterValues(original)) });

  // 1.x TypeName attempts
  for (const name of candidatesTypeNames){
    variants.push({ label: `TypeName(${name})`, body: useRecordTypeEnumName(original, name) });
    variants.push({ label: `TypeName+FilterValues(${name})`, body: toFilterValues(useRecordTypeEnumName(original, name)) });
    variants.push({ label: `ListRequest+TypeName(${name})`, body: wrapListRequest(useRecordTypeEnumName(original, name)) });
    variants.push({ label: `ListRequest+TypeName+FilterValues(${name})`, body: wrapListRequest(toFilterValues(useRecordTypeEnumName(original, name))) });

    // 2.x RecordType string attempts
    variants.push({ label: `RecordType(${name})`, body: useRecordTypeKeyString(original, name) });
    variants.push({ label: `RecordType+FilterValues(${name})`, body: toFilterValues(useRecordTypeKeyString(original, name)) });
    variants.push({ label: `ListRequest+RecordType(${name})`, body: wrapListRequest(useRecordTypeKeyString(original, name)) });
    variants.push({ label: `ListRequest+RecordType+FilterValues(${name})`, body: wrapListRequest(toFilterValues(useRecordTypeKeyString(original, name))) });
  }

  return variants;
}

// ---------- core poster ----------
async function otPostList(body){
  const url = `${baseUrl()}${(process.env.OT_LIST_PATH||"/List").trim()}`;
  const headers = authHeaders();
  const variants = payloadVariants(body);
  const errs = [];

  for (const v of variants){
    const payload = JSON.stringify(v.body||{});
    const to = withTimeout();
    try{
      dbg("POST", url, v.label, "len:", payload.length);
      const res = await fetch(url, { method: "POST", headers, body: payload, cache: "no-store", signal: to.signal });
      const text = await res.text();
      dbg("RES", res.status, v.label);
      if (!res.ok) { errs.push(`OT ${res.status} [${v.label}] ${text.slice(0,300)}`); to.cancel(); continue; }
      try { const json = JSON.parse(text); to.cancel(); return json; }
      catch(e){ errs.push(`Non-JSON [${v.label}] ${text.slice(0,300)}`); to.cancel(); continue; }
    }catch(e){
      errs.push(`Fetch error [${v.label}] ${(e && e.name==="AbortError") ? "timeout" : String(e.message||e)}`);
      to.cancel();
    }
  }
  throw new Error(`All List shapes failed:\n- ${errs.join("\n- ")}`);
}

module.exports = { authHeaders, otPostList };
