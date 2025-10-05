// /api/ordertime/bin.js  (CommonJS, Vercel serverless)

const env = (k, d = undefined) => {
  const v = process.env[k];
  return v === undefined || v === "" ? d : v;
};
const bool = (k) => {
  const v = env(k, "");
  return v === "1" || v?.toLowerCase?.() === "true";
};
const dbgOn = bool("OT_DEBUG");
const dbg = (...args) => { if (dbgOn) try { console.log("[bin]", ...args); } catch (_) {} };

// ---------- ENV PARSERS ----------
const parseArray = (raw, fallback = []) => {
  if (!raw) return fallback.slice();
  if (Array.isArray(raw)) return raw.slice();
  const s = String(raw).trim();
  if (!s) return fallback.slice();
  // Try JSON first
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr;
  } catch (_) {}
  // Then CSV (strip spaces)
  return s.split(",").map(x => x.trim()).filter(Boolean);
};

// ---------- CONFIG ----------
const OT_BASE_URL = (env("OT_BASE_URL", "https://services.ordertime.com")).replace(/\/+$/, "");
const OT_LIST_PATHS = parseArray(env("OT_LIST_PATHS", '["/api/List","/List"]'), ["/api/List","/List"]);
const OT_LIST_PAGE_SIZE = Number(env("OT_LIST_PAGE_SIZE", 500)) || 500;

const OT_EMAIL = env("OT_EMAIL", "").trim();
const OT_API_KEY = env("OT_API_KEY", "").trim();
const OT_DEVKEY = env("OT_DEVKEY", "").trim();
const OT_PASSWORD = env("OT_PASSWORD", "").trim();

const OT_LIST_TYPENAME = env("OT_LIST_TYPENAME", "").trim(); // e.g. InventoryLotSerial
const OT_SERIAL_TYPES = (() => {
  const arr = parseArray(env("OT_SERIAL_TYPES", "[1100,1101,1200,1201]"), [1100,1101,1200,1201]);
  // normalize to numbers where possible
  return arr.map(x => (typeof x === "string" && /^\d+$/.test(x)) ? Number(x) : x);
})();

// bin + location filters
const OT_BIN_PROP = env("OT_BIN_PROP", "LocationBinRef.Name").trim();
const OT_LOCATION_FIELD = env("OT_LOCATION_FIELD", "LocationRef.Name").trim();
const OT_LOCATION_VALUES = parseArray(env("OT_LOCATION_VALUES", "[]"), []);

// ---------- HELPERS ----------
const withTimeout = (ms = Number(env("OT_TIMEOUT_MS", 12000))) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
};

const makeHeaders = () => {
  if (!OT_EMAIL) throw new Error("Missing env OT_EMAIL");
  if (!OT_API_KEY) throw new Error("Missing env OT_API_KEY");
  if (!OT_DEVKEY && !OT_PASSWORD) throw new Error("Missing one of OT_DEVKEY or OT_PASSWORD");

  const h = {
    "Content-Type": "application/json",
    Accept: "application/json",
    email: OT_EMAIL,
    apikey: OT_API_KEY,
  };
  if (OT_DEVKEY) h.devkey = OT_DEVKEY;
  if (OT_PASSWORD) h.password = OT_PASSWORD;
  return h;
};

const joinUrl = (base, path) => {
  if (!path) return base;
  if (base.endsWith("/") && path.startsWith("/")) return base + path.slice(1);
  if (!base.endsWith("/") && !path.startsWith("/")) return base + "/" + path;
  return base + path;
};

const typeForms = () => {
  const out = [];
  if (OT_LIST_TYPENAME) out.push({ TypeName: OT_LIST_TYPENAME });
  // numeric types (allow both numeric and already-typed objects)
  for (const t of OT_SERIAL_TYPES) {
    if (typeof t === "object") out.push(t);
    else out.push({ Type: t });
  }
  // common typenames (fallbacks)
  out.push({ TypeName: "InventoryLotSerial" });
  out.push({ TypeName: "ItemLocationSerial" });
  out.push({ TypeName: "LotOrSerialNo" });
  return dedupeObjects(out);
};

const dedupeObjects = (arr) => {
  const seen = new Set();
  const out = [];
  for (const o of arr) {
    const k = JSON.stringify(o);
    if (!seen.has(k)) { seen.add(k); out.push(o); }
  }
  return out;
};

// Build filters (two dialects) for the given bin/location
const makeFilterDialects = (bin) => {
  // PropertyName/FilterOperation + Values
  const propBinEq = { PropertyName: OT_BIN_PROP,       FilterOperation: "Equals", Value: bin };
  const propLocIn = { PropertyName: OT_LOCATION_FIELD, FilterOperation: "In",     Values: OT_LOCATION_VALUES };

  // FieldName/Operator + FilterValues
  const fldBinEq =  { FieldName: OT_BIN_PROP,       Operator: "Equals",      FilterValue: bin };
  const fldLocIn =  { FieldName: OT_LOCATION_FIELD, Operator: "In",          FilterValues: OT_LOCATION_VALUES };

  const sets = [];
  // If you don’t have location filters configured, don’t include them
  if (OT_LOCATION_VALUES.length) {
    sets.push([propBinEq, propLocIn]);
    sets.push([fldBinEq,  fldLocIn ]);
  } else {
    sets.push([propBinEq]);
    sets.push([fldBinEq ]);
  }
  return sets;
};

// Build payload shapes for a type + one filter set
const buildBodiesFor = (typeKv, filters, pageNo, pageSize) => {
  const b = [];

  // canonical paging
  const canon = {
    ...typeKv,
    Filters: filters,
    PageNumber: pageNo,
    NumberOfRecords: pageSize,
  };
  // alias paging
  const alias = {
    ...typeKv,
    Filters: filters,
    PageNo: pageNo,
    PageSize: pageSize,
  };

  // raw bodies
  b.push(canon);
  b.push(alias);
  // wrapped
  b.push({ ListRequest: canon });
  b.push({ ListRequest: alias });

  return b;
};

// Extract normalized row from an OT record
const toRow = (rec, fallbackBin) => {
  const loc =
    rec?.LocationBinRef?.Name ??
    rec?.BinRef?.Name ??
    rec?.LocationBin?.Name ??
    rec?.Bin?.Name ??
    rec?.Location?.Name ??
    fallbackBin;

  const sku =
    rec?.ItemRef?.Name ??
    rec?.ItemCode ??
    rec?.Item?.Code ??
    rec?.Code ??
    "—";

  const description =
    rec?.ItemName ??
    rec?.Description ??
    rec?.Item?.Name ??
    "—";

  const serial =
    rec?.SerialNo ??
    rec?.LotNo ??
    rec?.Serial ??
    rec?.LotOrSerialNo ??
    rec?.imei ??
    rec?.IMEI ??
    rec?.SerialNumber ??
    "";

  return {
    location: String(loc || fallbackBin || ""),
    sku: String(sku || "—"),
    description: String(description || "—"),
    systemImei: String(serial || ""),
    raw: undefined, // keep slim; comment this line to return full raw
  };
};

// ---------- MAIN HANDLER ----------
module.exports = async function handler(req, res) {
  const bin = (req.query && req.query.bin || "").trim();
  if (!bin) return res.status(400).json({ error: "bin is required" });

  const pageSize = Math.min(OT_LIST_PAGE_SIZE, 1000);
  const headers = makeHeaders();
  const types = typeForms();
  const listPaths = OT_LIST_PATHS && OT_LIST_PATHS.length ? OT_LIST_PATHS : ["/api/List","/List"];

  const filterSets = makeFilterDialects(bin);
  dbg("params", {
    bin,
    pageSize,
    forcedProp: OT_BIN_PROP,
    locationField: OT_LOCATION_FIELD,
    locationValues: OT_LOCATION_VALUES,
    types: types.map(t => t.Type ?? t.TypeName ?? t.RecordType ?? "?"),
    listPaths,
  });

  const rows = [];
  const errors = [];

  try {
    // Iterate paths first so we prefer /api/List then /List
    for (const path of listPaths) {
      const url = joinUrl(OT_BASE_URL, path);

      // Iterate type forms (Type / TypeName / RecordType)
      for (const typeKv of types) {
        // paging loop
        let pageNo = 1;
        while (true) {
          let pageWorked = false;

          // try each filter dialect & body shape
          for (const filters of filterSets) {
            const bodies = buildBodiesFor(typeKv, filters, pageNo, pageSize);

            for (const body of bodies) {
              const payload = JSON.stringify(body);
              const to = withTimeout();
              let status = 0, text = "";
              try {
                const resp = await fetch(url, {
                  method: "POST",
                  headers,
                  body: payload,
                  cache: "no-store",
                  signal: to.signal,
                });
                status = resp.status;
                text = await resp.text();
                dbg("[OT] POST", url, "type:", (typeKv.Type ?? typeKv.TypeName ?? "?"), "page:", pageNo, "->", status);

                if (status === 401 || status === 403) {
                  to.cancel();
                  return res.status(502).json({ error: "BIN API 502", message: "Unauthorized to OrderTime. Check OT_EMAIL/OT_API_KEY/OT_DEVKEY|OT_PASSWORD." });
                }
                if (status === 400) {
                  // capture one representative 400 (but keep iterating)
                  errors.push(`400 ${url} :: ${text.slice(0, 300)}`);
                  to.cancel();
                  continue;
                }
                if (status === 404) {
                  errors.push(`404 ${url} (path not found)`);
                  to.cancel();
                  continue;
                }
                if (!resp.ok) {
                  errors.push(`${status} ${url} :: ${text.slice(0, 300)}`);
                  to.cancel();
                  continue;
                }

                // must be JSON
                let json;
                try {
                  json = JSON.parse(text);
                } catch (e) {
                  errors.push(`Non-JSON ${url} :: ${text.slice(0, 200)}`);
                  to.cancel();
                  continue;
                }
                to.cancel();

                const recs = Array.isArray(json?.Records) ? json.Records :
                             Array.isArray(json?.records) ? json.records : [];

                // if this request worked, mark it
                pageWorked = true;

                // collect
                for (const r of recs) rows.push(toRow(r, bin));

                // stop when last page (short page or empty)
                if (recs.length < pageSize) {
                  // we successfully completed all pages for this type/path
                  // return immediately with results
                  return res.status(200).json({
                    bin,
                    count: rows.length,
                    rows,
                    // Back-compat alias so older UI code that expects "records" still works
                    records: rows,
                  });
                }

                // else continue paging
                pageNo += 1;
              } catch (e) {
                to.cancel();
                const msg = e && e.name === "AbortError" ? "timeout" : String(e.message || e);
                errors.push(`Fetch error ${url} :: ${msg}`);
                continue; // try next body/dialect
              }
            } // bodies
          } // filter sets

          // if none of the bodies worked on this page, break paging loop for this type
          if (!pageWorked) break;
        } // while page
      } // types
    } // paths
  } catch (fatal) {
    return res.status(502).json({ error: "BIN API 502", message: String(fatal && fatal.message || fatal) });
  }

  // If we got here, nothing succeeded
  // Try to surface the most useful message
  const authErr = errors.find(e => /Incorrect api key|deactivated|Unauthorized|401|403/i.test(e));
  if (authErr) {
    return res.status(502).json({ error: "BIN API 502", message: "Incorrect api key or invalid credentials." });
  }
  // path 404s?
  const pathErr = errors.find(e => /404 .*\/List/i);
  if (pathErr) {
    return res.status(502).json({ error: "BIN API 502", message: "OrderTime /List endpoint not found. Ensure OT_BASE_URL and OT_LIST_PATHS are set correctly." });
  }
  return res.status(502).json({ error: "BIN API 502", message: errors.slice(0, 5).join(" | ") || "All attempts failed." });
};
