// /api/ordertime/bin.js  — CommonJS

const env = (k, d = undefined) => {
  const v = process.env[k];
  return v === undefined || v === "" ? d : v;
};
const parseArray = (raw, fallback = []) => {
  if (!raw) return fallback.slice();
  if (Array.isArray(raw)) return raw.slice();
  const s = String(raw).trim();
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr;
  } catch (_) {}
  return s.split(",").map(x => x.trim()).filter(Boolean);
};
const dbgOn = (env("OT_DEBUG", "0") === "1" || env("OT_DEBUG", "").toLowerCase() === "true");
const dbg = (...a) => { if (dbgOn) console.log("[bin]", ...a); };

const OT_BASE_URL       = (env("OT_BASE_URL", "https://services.ordertime.com")).replace(/\/+$/,"");
const OT_LIST_PATHS     = parseArray(env("OT_LIST_PATHS", '["/api/List"]'), ["/api/List"]); // keep only /api/List
const OT_LIST_PAGE_SIZE = Number(env("OT_LIST_PAGE_SIZE", 500)) || 500;

const OT_EMAIL   = env("OT_EMAIL","").trim();
const OT_API_KEY = env("OT_API_KEY","").trim();
const OT_DEVKEY  = env("OT_DEVKEY","").trim();
const OT_PASSWORD= env("OT_PASSWORD","").trim();

const OT_LIST_TYPENAME  = env("OT_LIST_TYPENAME","").trim();
const OT_SERIAL_TYPES   = (() => {
  const arr = parseArray(env("OT_SERIAL_TYPES","[1100,1101,1200,1201]"), [1100,1101,1200,1201]);
  return arr.map(x => (typeof x === "string" && /^\d+$/.test(x)) ? Number(x) : x);
})();
const OT_BIN_PROP       = env("OT_BIN_PROP","LocationBinRef.Name").trim();
const OT_LOCATION_FIELD = env("OT_LOCATION_FIELD","LocationRef.Name").trim();
const OT_LOCATION_VALUES= parseArray(env("OT_LOCATION_VALUES","[]"), []);

const joinUrl = (base, path) =>
  base.endsWith("/") ? (path.startsWith("/") ? base + path.slice(1) : base + path)
                     : (path.startsWith("/") ? base + path : base + "/" + path);

const makeHeaders = () => {
  if (!OT_EMAIL)   throw new Error("Missing env OT_EMAIL");
  if (!OT_API_KEY) throw new Error("Missing env OT_API_KEY");
  if (!OT_DEVKEY && !OT_PASSWORD) throw new Error("Missing one of OT_DEVKEY or OT_PASSWORD");
  const h = { "Content-Type":"application/json", Accept:"application/json", email:OT_EMAIL, apikey:OT_API_KEY };
  if (OT_DEVKEY)  h.devkey  = OT_DEVKEY;
  if (OT_PASSWORD)h.password= OT_PASSWORD;
  return h;
};

const dedupeObjects = (arr) => {
  const seen = new Set(), out=[];
  for (const o of arr) { const k = JSON.stringify(o); if (!seen.has(k)) { seen.add(k); out.push(o); } }
  return out;
};
const typeForms = () => {
  const out=[];
  if (OT_LIST_TYPENAME) out.push({ TypeName: OT_LIST_TYPENAME });
  for (const t of OT_SERIAL_TYPES) out.push(typeof t==="object" ? t : { Type: t });
  out.push({ TypeName:"InventoryLotSerial" }, { TypeName:"ItemLocationSerial" }, { TypeName:"LotOrSerialNo" });
  return dedupeObjects(out);
};

const makeFilterDialects = (bin) => {
  const propBinEq = { PropertyName: OT_BIN_PROP,       FilterOperation:"Equals", Value: bin };
  const propLocIn = { PropertyName: OT_LOCATION_FIELD, FilterOperation:"In",     Values: OT_LOCATION_VALUES };
  const fldBinEq  = { FieldName: OT_BIN_PROP,          Operator:"Equals",        FilterValue: bin };
  const fldLocIn  = { FieldName: OT_LOCATION_FIELD,    Operator:"In",            FilterValues: OT_LOCATION_VALUES };
  if (OT_LOCATION_VALUES.length) return [[propBinEq,propLocIn], [fldBinEq,fldLocIn]];
  return [[propBinEq], [fldBinEq]];
};

// ==== the important part: build EVERY payload variant OT accepts ====
const buildBodiesFor = (typeKv, filters, pageNo, pageSize) => {
  const list = [];

  // Canonical (Filters), two paging aliases
  const canon = { ...typeKv, Filters: filters, PageNumber: pageNo, NumberOfRecords: pageSize };
  const alias = { ...typeKv, Filters: filters, PageNo: pageNo,     PageSize: pageSize };
  list.push(canon, alias, { ListRequest: canon }, { ListRequest: alias });

  // FilterList (some tenants require this key)
  const fl1 = { ...typeKv, FilterList: filters, PageNumber: pageNo, NumberOfRecords: pageSize };
  const fl2 = { ...typeKv, FilterList: filters, PageNo: pageNo,     PageSize: pageSize };
  list.push(fl1, fl2, { ListRequest: fl1 }, { ListRequest: fl2 });

  // ListFilters (older key)
  const lf1 = { ...typeKv, ListFilters: filters, PageNumber: pageNo, NumberOfRecords: pageSize };
  const lf2 = { ...typeKv, ListFilters: filters, PageNo: pageNo,     PageSize: pageSize };
  list.push(lf1, lf2, { ListRequest: lf1 }, { ListRequest: lf2 });

  // In-case “In” requires FilterValueArray instead of FilterValues/Values
  const upgraded = filters.map(f => {
    if (Array.isArray(f.Values))      return { ...f, FilterValueArray: f.Values, Values: undefined };
    if (Array.isArray(f.FilterValues))return { ...f, FilterValueArray: f.FilterValues, FilterValues: undefined };
    return f;
  });
  const up1 = { ...typeKv, Filters: upgraded, PageNumber: pageNo, NumberOfRecords: pageSize };
  const up2 = { ...typeKv, Filters: upgraded, PageNo: pageNo,     PageSize: pageSize };
  list.push(up1, up2, { ListRequest: up1 }, { ListRequest: up2 });

  return list;
};

const toRow = (rec, fallbackBin) => {
  const loc = rec?.LocationBinRef?.Name ?? rec?.BinRef?.Name ?? rec?.LocationBin?.Name ?? rec?.Bin?.Name ?? rec?.Location?.Name ?? fallbackBin;
  const sku = rec?.ItemRef?.Name ?? rec?.ItemCode ?? rec?.Item?.Code ?? rec?.Code ?? "—";
  const description = rec?.ItemName ?? rec?.Description ?? rec?.Item?.Name ?? "—";
  const serial = rec?.SerialNo ?? rec?.LotNo ?? rec?.Serial ?? rec?.LotOrSerialNo ?? rec?.IMEI ?? rec?.SerialNumber ?? "";
  return { location: String(loc||fallbackBin||""), sku: String(sku||"—"), description: String(description||"—"), systemImei: String(serial||"") };
};

// keep the first 400 body we see so we can return it to the client
let first400Text = null;

module.exports = async function handler(req, res) {
  const bin = (req.query?.bin || "").trim();
  if (!bin) return res.status(400).json({ error: "bin is required" });

  const headers  = makeHeaders();
  const listPaths= OT_LIST_PATHS.length ? OT_LIST_PATHS : ["/api/List"];
  const types    = typeForms();
  const filters  = makeFilterDialects(bin);
  const pageSize = Math.min(OT_LIST_PAGE_SIZE, 1000);

  dbg("params", { bin, pageSize, forcedProp: OT_BIN_PROP, locationField: OT_LOCATION_FIELD, locationValues: OT_LOCATION_VALUES, types: types.map(t => t.Type ?? t.TypeName ?? "?"), listPaths });

  const rows = [];
  for (const path of listPaths) {
    const url = joinUrl(OT_BASE_URL, path);

    for (const typeKv of types) {
      let pageNo = 1;
      while (true) {
        let pageWorked = false;

        for (const fset of filters) {
          const bodies = buildBodiesFor(typeKv, fset, pageNo, pageSize);

          for (const body of bodies) {
            const payload = JSON.stringify(body);
            let resp, text;
            try {
              resp = await fetch(url, { method:"POST", headers, body: payload, cache:"no-store" });
              text = await resp.text();
              dbg("[OT] POST", url, "type:", (typeKv.Type ?? typeKv.TypeName ?? "?"), "page:", pageNo, "->", resp.status);

              if (resp.status === 401 || resp.status === 403) {
                return res.status(502).json({ error:"BIN API 502", message:"Unauthorized to OrderTime. Check OT_EMAIL/OT_API_KEY/OT_DEVKEY|OT_PASSWORD." });
              }
              if (resp.status === 404) {
                // try next path; don't stop yet
                continue;
              }
              if (resp.status === 400) {
                if (!first400Text) first400Text = text; // capture the first reason
                continue;
              }
              if (!resp.ok) {
                continue;
              }

              let json;
              try { json = JSON.parse(text); } catch { continue; }

              const recs = Array.isArray(json?.Records) ? json.Records :
                           Array.isArray(json?.records) ? json.records : [];
              pageWorked = true;

              for (const r of recs) rows.push(toRow(r, bin));

              if (recs.length < pageSize) {
                return res.status(200).json({ bin, count: rows.length, rows, records: rows });
              }
              pageNo += 1; // continue paging
            } catch (_) {
              // network/parse error → try next shape
              continue;
            }
          } // bodies
        } // filter sets

        if (!pageWorked) break;
      } // paging
    } // types
  } // paths

  // Nothing worked:
  if (first400Text) {
    // surface OT’s actual complaint
    return res.status(502).json({ error:"BIN API 502", message: first400Text.slice(0, 800) });
  }
  // If we saw 404s only (because you kept /List), hint path; else generic
  return res.status(502).json({ error:"BIN API 502", message:"No List shape accepted by OrderTime. Verify Type/TypeName and filter keys for your tenant." });
};
