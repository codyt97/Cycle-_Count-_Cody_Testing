// /api/ordertime/_client.js
const DEFAULT_TIMEOUT_MS = 15000;

function dbg(...args){ if(process.env.OT_DEBUG) try{ console.log("[OT]", ...args); }catch(_){} }
function baseUrl(){
  const u=(process.env.OT_BASE_URL||"").trim().replace(/\/+$/,"");
  if(!u) throw new Error("OT_BASE_URL missing");
  if(!/^https?:\/\//i.test(u)) throw new Error(`OT_BASE_URL must include http(s): ${u}`);
  return u;
}
function authHeaders(){
  const { OT_API_KEY, OT_EMAIL, OT_DEVKEY, OT_PASSWORD } = process.env;
  if(!OT_API_KEY || !OT_EMAIL) throw new Error("Missing OT_API_KEY or OT_EMAIL");
  const h = { "Content-Type":"application/json", ApiKey:OT_API_KEY, Email:OT_EMAIL };
  if (OT_DEVKEY) h.DevKey = OT_DEVKEY; else if (OT_PASSWORD) h.Password = OT_PASSWORD;
  else dbg("WARN: neither OT_DEVKEY nor OT_PASSWORD set");
  return h;
}
function withTimeout(ms=DEFAULT_TIMEOUT_MS){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),ms);
  return { signal:ctrl.signal, cancel:()=>clearTimeout(t) };
}
const clone = o => JSON.parse(JSON.stringify(o||{}));

// ---------- dialect transforms ----------
function ensureOperatorEquals(f){ const g={...f}; if(!g.Operator) g.Operator="Equals"; return g; }
function toFieldName(f){
  const g = { ...f };
  if (g.PropertyName && !g.FieldName) { g.FieldName = g.PropertyName; delete g.PropertyName; }
  return g;
}
function toValuesKeys(f){
  const g = { ...f };
  if (g.FilterValueArray && !g.FilterValues && !g.Values) { g.FilterValues = g.FilterValueArray; delete g.FilterValueArray; }
  if (g.FilterValues && !g.Values) { g.Values = g.FilterValues; delete g.FilterValues; }
  if (g.Values && Array.isArray(g.Values) && g.Values.length===1 && !g.FilterValue) g.FilterValue = g.Values[0];
  return g;
}
function toPageKeys(b){
  const x = clone(b);
  if (x.PageNumber != null && x.PageNo == null) { x.PageNo = x.PageNumber; }
  if (x.NumberOfRecords != null && x.PageSize == null) { x.PageSize = x.NumberOfRecords; }
  return x;
}
function useTypeName(b, name){ const x=clone(b); delete x.Type; x.TypeName=name; return x; }
function useRecordTypeString(b, name){ const x=clone(b); delete x.Type; x.RecordType=name; return x; }
const wrapListRequest = b => ({ ListRequest: b });

function canonicalListBodies(original){
  // Accept either PropertyName or FieldName in the incoming body; normalize to FieldName+FilterValue
  const binFilter = Array.isArray(original.Filters) && original.Filters[0] ? original.Filters[0] : {};
  const fieldName = binFilter.FieldName || binFilter.PropertyName || "";
  const filterValue = (binFilter.FilterValue != null)
    ? binFilter.FilterValue
    : (Array.isArray(binFilter.FilterValueArray) ? binFilter.FilterValueArray[0] : undefined);

  const pageNo = original.PageNumber || original.PageNo || 1;
  const pageSize = original.NumberOfRecords || original.PageSize || 500;

  const typeName = (process.env.OT_LIST_TYPENAME || "LotOrSerialNo").trim(); // default to LotOrSerialNo
  const recType  = typeName; // for RecordType variant if needed later

  // Canonical 1: ListInfo + Type (string) + FieldName/FilterValue
  const canon1 = {
    ListInfo: {
      Type: typeName,
      Filters: fieldName ? [{ FieldName: fieldName, Operator: "Equals", FilterValue: filterValue }] : [],
      PageNumber: pageNo,
      NumberOfRecords: pageSize
    }
  };

  // Canonical 2: ListInfo + Type (number) if user insists on numeric (via env)
  let canon2 = null;
  if (process.env.OT_SERIAL_TYPES){
    try{
      const arr = JSON.parse(process.env.OT_SERIAL_TYPES);
      const n = Array.isArray(arr) && arr.length ? parseInt(arr[0],10) : NaN;
      if (!isNaN(n)) {
        canon2 = {
          ListInfo: {
            Type: n,
            Filters: fieldName ? [{ FieldName: fieldName, Operator: "Equals", FilterValue: filterValue }] : [],
            PageNumber: pageNo,
            NumberOfRecords: pageSize
          }
        };
      }
    }catch(_){}
  }

  // Canonical 3: Top-level (no ListInfo) but with FieldName/FilterValue keys
  const canon3 = {
    Type: typeName,
    Filters: fieldName ? [{ FieldName: fieldName, Operator: "Equals", FilterValue: filterValue }] : [],
    PageNumber: pageNo,
    NumberOfRecords: pageSize
  };

  return [canon1].concat(canon2 ? [canon2] : []).concat([canon3]);
}

// Generate retry variants
function payloadVariants(original){
  const tn = (process.env.OT_LIST_TYPENAME || "").trim();
  const typeNames = tn ? [tn] : [
    "InventoryLotSerial","ItemInstance","InventoryDetail","DetailedInventory",
    "SerialNumber","LotNumber","InventoryByBin","BinItemSerial"
  ];

  const buildFilterVariants = f => ([
  f,
  ensureOperatorEquals(f),
  // EqualTo versions
  { ...f, Operator: "EqualTo" },
  toValuesKeys({ ...f, Operator: "EqualTo" }),
  toFieldName({ ...f, Operator: "EqualTo" }),
  toValuesKeys(toFieldName({ ...f, Operator: "EqualTo" })),
  // Contains versions (some tenants only accept Contains)
  { ...f, Operator: "Contains" },
  toValuesKeys({ ...f, Operator: "Contains" }),
  toFieldName({ ...f, Operator: "Contains" }),
  toValuesKeys(toFieldName({ ...f, Operator: "Contains" })),
  // Existing FieldName/Values normalizations
  toValuesKeys(f),
  toValuesKeys(ensureOperatorEquals(f)),
  toFieldName(f),
  toFieldName(ensureOperatorEquals(f)),
  toValuesKeys(toFieldName(f)),
  toValuesKeys(toFieldName(ensureOperatorEquals(f))),
]);


  const baseFilters = Array.isArray(original.Filters) && original.Filters.length ? original.Filters : [];
  const expandedFilters = baseFilters.length
    ? buildFilterVariants(baseFilters[0]).map(one => [one]) // single-filter requests
    : [];

  const bases = [];
  // numeric Type bases (as-is)
  bases.push(clone(original));
  bases.push(toPageKeys(original));
  // ListRequest wrapper
  bases.push(wrapListRequest(original));
  bases.push(wrapListRequest(toPageKeys(original)));

  const variants = [];

  // 1) numeric Type attempts with filter dialects
  for (const base of bases){
    if (expandedFilters.length){
      for (const fl of expandedFilters){
        const v = clone(base);
        if (v.ListRequest) v.ListRequest.Filters = fl; else v.Filters = fl;
        variants.push({ label:`numType:${JSON.stringify(Object.keys(v))}`, body:v });
      }
    } else {
      variants.push({ label:`numType:${JSON.stringify(Object.keys(base))}`, body:base });
    }
  }

  // 2) TypeName + RecordType string attempts
  for (const name of typeNames){
    for (const base of bases){
      // TypeName
      {
        const b = base.ListRequest ? wrapListRequest(useTypeName(base.ListRequest||base, name))
                                   : useTypeName(base, name);
        if (expandedFilters.length){
          for (const fl of expandedFilters){
            const v = clone(b);
            if (v.ListRequest) v.ListRequest.Filters = fl; else v.Filters = fl;
            variants.push({ label:`TypeName(${name})`, body: v });
          }
        } else variants.push({ label:`TypeName(${name})`, body: b });
      }
      // RecordType (string)
      {
        const b = base.ListRequest ? wrapListRequest(useRecordTypeString(base.ListRequest||base, name))
                                   : useRecordTypeString(base, name);
        if (expandedFilters.length){
          for (const fl of expandedFilters){
            const v = clone(b);
            if (v.ListRequest) v.ListRequest.Filters = fl; else v.Filters = fl;
            variants.push({ label:`RecordType(${name})`, body: v });
          }
        } else variants.push({ label:`RecordType(${name})`, body: b });
      }
    }
  }

  return variants;
}

function listPaths() {
  // Allow a JSON array in OT_LIST_PATHS or a single OT_LIST_PATH; default to "/List"
  const raw = (process.env.OT_LIST_PATHS || "").trim();
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        return arr.map(p => String(p || "/List").trim());
      }
    } catch (_) { /* fall through */ }
  }
  const single = (process.env.OT_LIST_PATH || "/List").trim();
  return [single];
}



// ---------- core poster ----------
async function otPostList(body){
const paths = (function(){
  const raw = (process.env.OT_LIST_PATHS || "").trim();
  if (raw) { try{ const arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length) return arr.map(p=>String(p||"/List").trim()); }catch(_){} }
  const single = (process.env.OT_LIST_PATH || "/List").trim();
  return [single];
})();

const headers = authHeaders();
const canonicalBodies = canonicalListBodies(body);   // <— NEW
const variants = payloadVariants(body);              // existing retries
const errs = [];

for (const path of paths){
  const url = `${baseUrl()}${path}`;

  // 1) Canonical attempts FIRST
  for (const canon of canonicalBodies){
    const payload = JSON.stringify(canon);
    const to = withTimeout();
    try{
      dbg("POST", url, "canonical", "len:", payload.length);
      const res = await fetch(url, { method:"POST", headers, body:payload, cache:"no-store", signal:to.signal });
      const text = await res.text();
      dbg("RES", res.status, v.label, "::", text.slice(0,200));
      if (!res.ok){ errs.push(`OT ${res.status} [${path} ${v.label}] ${text.slice(0,500)}`); to.cancel(); continue; }
      else { try{ const json = JSON.parse(text); to.cancel(); return json; } catch(e){ errs.push(`Non-JSON [${path} canonical] ${text.slice(0,300)}`); to.cancel(); } }
    }catch(e){
      errs.push(`Fetch error [${path} canonical] ${(e && e.name==="AbortError") ? "timeout" : String(e.message||e)}`);
      to.cancel();
    }
  }

  // 2) Then your existing variant explosion
  for (const v of variants){
    const payload = JSON.stringify(v.body||{});
    const to = withTimeout();
    try{
      dbg("POST", url, v.label, "len:", payload.length);
      const res = await fetch(url, { method:"POST", headers, body:payload, cache:"no-store", signal:to.signal });
      const text = await res.text();
      dbg("RES", res.status, v.label, "::", text.slice(0,200));
      if (!res.ok){ errs.push(`OT ${res.status} [${path} ${v.label}] ${text.slice(0,500)}`); to.cancel(); continue; }
      try { const json = JSON.parse(text); to.cancel(); return json; }
      catch(e){ errs.push(`Non-JSON [${path} ${v.label}] ${text.slice(0,300)}`); to.cancel(); continue; }
    }catch(e){
      errs.push(`Fetch error [${path} ${v.label}] ${(e && e.name==="AbortError") ? "timeout" : String(e.message||e)}`);
      to.cancel();
    }
  }
}

throw new Error(`All List shapes failed:\n- ${errs.join("\n- ")}`);




  for (const v of variants){
    const payload = JSON.stringify(v.body||{});
    const to = withTimeout();
    try{
      dbg("POST", url, v.label, "len:", payload.length);
      const res = await fetch(url, { method:"POST", headers, body:payload, cache:"no-store", signal:to.signal });
      const text = await res.text();
      dbg("RES", res.status, v.label);
      if (!res.ok){ errs.push(`OT ${res.status} [${v.label}] ${text.slice(0,300)}`); to.cancel(); continue; }
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
