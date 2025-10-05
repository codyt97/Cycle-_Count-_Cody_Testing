// /api/ordertime/bin.js  — CommonJS, Vercel
const BASE = (process.env.OT_BASE_URL || "https://services.ordertime.com").replace(/\/+$/,"");
const LIST_PATH = "/api/List";

const toArray = (raw, fallback = []) => {
  if (!raw) return fallback.slice();
  if (Array.isArray(raw)) return raw.slice();
  const s = String(raw).trim();
  try { const j = JSON.parse(s); if (Array.isArray(j)) return j; } catch {}
  return s.split(",").map(x => x.trim()).filter(Boolean);
};

const EMAIL    = (process.env.OT_EMAIL || "").trim();
const APIKEY   = (process.env.OT_API_KEY || "").trim();
const DEVKEY   = (process.env.OT_DEVKEY || "").trim();
const PASSWORD = (process.env.OT_PASSWORD || "").trim();

const LOCATION_FIELD  = (process.env.OT_LOCATION_FIELD || "LocationRef.Name").trim();
const LOCATION_VALUES = toArray(process.env.OT_LOCATION_VALUES, []); // e.g. ["KOP","3PL"]
const PAGE_SIZE       = Math.min(parseInt(process.env.OT_LIST_PAGE_SIZE || "500", 10) || 500, 1000);

// Prioritize InventoryLotSerial; numeric types kept for completeness but are rarely needed here
const TYPES = [
  { TypeName: (process.env.OT_LIST_TYPENAME || "InventoryLotSerial").trim() },
  { Type: 1100 }, { Type: 1101 }, { Type: 1200 }, { Type: 1201 },
];

// Bin field candidates — put BinRef.Name first (matches your OT UI)
const BIN_CANDIDATES = Array.from(new Set([
  (process.env.OT_BIN_PROP || "BinRef.Name").trim(),
  "LocationBinRef.Name",
  "Location.Name",
  "LocationBin.Name",
]));

const headers = () => {
  if (!EMAIL)    throw new Error("Missing OT_EMAIL");
  if (!APIKEY)   throw new Error("Missing OT_API_KEY");
  if (!DEVKEY && !PASSWORD) throw new Error("Missing OT_DEVKEY or OT_PASSWORD");
  const h = { "Content-Type":"application/json", Accept:"application/json", email:EMAIL, apikey:APIKEY };
  if (DEVKEY)   h.devkey = DEVKEY;
  if (PASSWORD) h.password = PASSWORD;
  return h;
};

const join = (a,b)=> (a.endsWith("/")?a.slice(0,-1):a) + (b.startsWith("/")?b:"/"+b);

// Build all payload shapes OT might accept
function buildBodies(typeKv, filters, pageNo, pageSize) {
  const list = [];
  const canon = { ...typeKv, Filters: filters, PageNumber: pageNo, NumberOfRecords: pageSize };
  const alias = { ...typeKv, Filters: filters, PageNo: pageNo, PageSize: pageSize };
  list.push(canon, alias, { ListRequest: canon }, { ListRequest: alias });

  // Alt keys some tenants require
  const fl1 = { ...typeKv, FilterList: filters, PageNumber: pageNo, NumberOfRecords: pageSize };
  const fl2 = { ...typeKv, FilterList: filters, PageNo: pageNo, PageSize: pageSize };
  const lf1 = { ...typeKv, ListFilters: filters, PageNumber: pageNo, NumberOfRecords: pageSize };
  const lf2 = { ...typeKv, ListFilters: filters, PageNo: pageNo, PageSize: pageSize };
  list.push(fl1, fl2, { ListRequest: fl1 }, { ListRequest: fl2 }, lf1, lf2, { ListRequest: lf1 }, { ListRequest: lf2 });

  // Some “In” implementations want FilterValueArray
  const upgraded = filters.map(f => {
    if (Array.isArray(f.Values))        return { ...f, FilterValueArray: f.Values };
    if (Array.isArray(f.FilterValues))  return { ...f, FilterValueArray: f.FilterValues };
    return f;
  });
  const up1 = { ...typeKv, Filters: upgraded, PageNumber: pageNo, NumberOfRecords: pageSize };
  const up2 = { ...typeKv, Filters: upgraded, PageNo: pageNo, PageSize: pageSize };
  list.push(up1, up2, { ListRequest: up1 }, { ListRequest: up2 });
  return list;
}

function makeFilterSets(bin, binProp, useLocation) {
  const propBin = { PropertyName: binProp, FilterOperation: "Equals", Value: bin };
  const fldBin  = { FieldName:    binProp, Operator:        "Equals", FilterValue: bin };

  const sets = [];
  if (useLocation && LOCATION_VALUES.length) {
    const propLoc = { PropertyName: LOCATION_FIELD, FilterOperation: "In",  Values: LOCATION_VALUES };
    const fldLoc  = { FieldName:    LOCATION_FIELD, Operator:        "In",  FilterValues: LOCATION_VALUES };
    sets.push([propBin, propLoc], [fldBin, fldLoc]);
  } else {
    sets.push([propBin], [fldBin]);
  }
  return sets;
}

function toRow(r, fallbackBin) {
  const loc = r?.LocationRef?.Name ?? r?.Location?.Name ?? r?.LocationBinRef?.Name ?? r?.BinRef?.Name ?? fallbackBin;
  const sku = r?.ItemRef?.Name ?? r?.ItemCode ?? r?.Code ?? "";
  const desc= r?.ItemName ?? r?.Description ?? "";
  const sn  = r?.SerialNo ?? r?.SerialNumber ?? r?.LotNo ?? r?.LotNumber ?? r?.LotOrSerialNo ?? "";
  return { location: String(loc||""), sku: String(sku||""), description: String(desc||""), systemImei: String(sn||"") };
}

module.exports = async function handler(req, res) {
  try {
    const bin = String(req.query?.bin || "").trim();
    if (!bin) return res.status(400).json({ error: "bin is required" });

    const url = join(BASE, LIST_PATH);
    const hdr = headers();
    const rows = [];
    let first400 = null;

    // try with location first, then without
    for (const useLocation of [true, false]) {
      for (const typeKv of TYPES) {
        for (const binProp of BIN_CANDIDATES) {
          let page = 1;
          while (true) {
            let didWork = false;
            for (const fset of makeFilterSets(bin, binProp, useLocation)) {
              for (const body of buildBodies(typeKv, fset, page, PAGE_SIZE)) {
                const resp = await fetch(url, { method: "POST", headers: hdr, body: JSON.stringify(body), cache: "no-store" });
                const text = await resp.text();

                if (resp.status === 400) { if (!first400) first400 = text; continue; }
                if (resp.status === 404) { break; } // wrong path (shouldn’t happen with /api/List)
                if (resp.status === 401 || resp.status === 403) {
                  return res.status(502).json({ error: "BIN API 502", message: "Unauthorized to OrderTime. Check OT_EMAIL/OT_API_KEY/OT_DEVKEY|OT_PASSWORD." });
                }
                if (!resp.ok) continue;

                let json; try { json = JSON.parse(text); } catch { continue; }
                const recs = Array.isArray(json?.Records) ? json.Records : Array.isArray(json?.records) ? json.records : [];
                didWork = true;

                for (const r of recs) rows.push(toRow(r, bin));
                if (recs.length < PAGE_SIZE) {
                  return res.status(200).json({
                    bin, count: rows.length, rows,
                    records: rows, // alias for old UI
                    _match: { type: typeKv.Type ?? typeKv.TypeName, binProp, usedLocation: useLocation }
                  });
                }
                page += 1; // next page
              }
            }
            if (!didWork) break;
          }
        }
      }
    }

    if (first400) {
      return res.status(502).json({ error: "BIN API 502", message: first400.slice(0, 800) });
    }
    return res.status(200).json({ bin, count: 0, rows: [], records: [], _match: null });
  } catch (e) {
    return res.status(500).json({ error: "BIN API 500", message: e.message || String(e) });
  }
};
