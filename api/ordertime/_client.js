// /api/ordertime/_client.js

// ======= env helpers =======
const env = (k, d = undefined) => {
  const v = process.env[k];
  return v === undefined || v === "" ? d : v;
};

const bool = (k) => {
  const v = env(k, "");
  return v === "1" || v?.toLowerCase?.() === "true";
};

const dbgOn = bool("OT_DEBUG");

// pretty logger
const dbg = (...args) => {
  if (!dbgOn) return;
  try {
    console.log("[OT]", ...args);
  } catch (_) {}
};

// timeout helper
const withTimeout = (ms = Number(env("OT_TIMEOUT_MS", 12000))) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), ms);
  return {
    signal: ctrl.signal,
    cancel: () => clearTimeout(t),
  };
};

// ======= base URL and paths =======
const baseUrl = () => {
  let b = env("OT_BASE_URL", "").trim();
  if (!b) throw new Error("Missing env OT_BASE_URL");
  if (!/^https?:\/\//i.test(b)) b = "https://" + b;
  // no trailing slash
  return b.replace(/\/+$/, "");
};

const listPaths = () => {
  // Try explicit list first; otherwise common defaults
  const raw = env("OT_LIST_PATHS", "");
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (_) {}
  }
  const p = env("OT_LIST_PATH", "").trim();
  const unique = (xs) => [...new Set(xs)];
  return unique([
    p || "/api/List",
    "/List",
  ]);
};

// ======= headers =======
const buildHeaders = () => {
  const email = env("OT_EMAIL");
  const apiKey = env("OT_API_KEY");
  const devKey = env("OT_DEVKEY");
  const password = env("OT_PASSWORD"); // some tenants use Password

  if (!email) throw new Error("Missing env OT_EMAIL");
  if (!apiKey) throw new Error("Missing env OT_API_KEY");
  if (!devKey && !password)
    throw new Error("Missing one of OT_DEVKEY or OT_PASSWORD");

  // OrderTime is case-insensitive for header keys, but we'll keep it simple.
  const h = {
    "Content-Type": "application/json",
    Accept: "application/json",
    email,
    apikey: apiKey,
  };
  if (devKey) h.devkey = devKey;
  if (password) h.password = password;
  return h;
};

// ======= payload normalizers =======

// Normalize {PageNumber, NumberOfRecords} to also provide {PageNo, PageSize}
const addPagingAliases = (b) => {
  const out = { ...b };
  if (out.PageNumber != null && out.PageSize == null && out.NumberOfRecords != null) {
    out.PageNo = out.PageNumber;
    out.PageSize = out.NumberOfRecords;
  }
  return out;
};

// PropertyName -> FieldName
const toFieldName = (f) => {
  if (!f) return f;
  const o = { ...f };
  if (o.PropertyName && !o.FieldName) {
    o.FieldName = o.PropertyName;
    delete o.PropertyName;
  }
  return o;
};

// FilterValueArray -> FilterValues / FilterValue
const toValuesKeys = (f) => {
  if (!f) return f;
  const o = { ...f };
  if (Array.isArray(o.FilterValueArray)) {
    // Prefer plural FilterValues; some tenants accept only this
    o.FilterValues = o.FilterValueArray.slice();
    delete o.FilterValueArray;
    delete o.FilterValue;
  } else if (o.FilterValueArray != null) {
    // If it's not an array, still map to FilterValues (wrapping)
    o.FilterValues = [o.FilterValueArray];
    delete o.FilterValueArray;
    delete o.FilterValue;
  } else if (o.FilterValue != null) {
    o.FilterValues = [o.FilterValue];
    delete o.FilterValue;
  }
  return o;
};

// Ensure we have an Operator string (default "Equals")
const ensureOperatorEquals = (f) => {
  if (!f) return f;
  if (!f.Operator) return { ...f, Operator: "Equals" };
  return f;
};

// Build many filter dialects that different OT tenants require
const buildFilterVariants = (f) => ([
  // Baseline
  f,
  ensureOperatorEquals(f),

  // EqualTo dialects
  { ...f, Operator: "EqualTo" },
  toValuesKeys({ ...f, Operator: "EqualTo" }),
  toFieldName({ ...f, Operator: "EqualTo" }),
  toValuesKeys(toFieldName({ ...f, Operator: "EqualTo" })),

  // Contains dialects (some tenants require Contains)
  { ...f, Operator: "Contains" },
  toValuesKeys({ ...f, Operator: "Contains" }),
  toFieldName({ ...f, Operator: "Contains" }),
  toValuesKeys(toFieldName({ ...f, Operator: "Contains" })),

  // Existing normalizations
  toValuesKeys(f),
  toValuesKeys(ensureOperatorEquals(f)),
  toFieldName(f),
  toFieldName(ensureOperatorEquals(f)),
  toValuesKeys(toFieldName(f)),
  toValuesKeys(toFieldName(ensureOperatorEquals(f))),
]);

// Wrap in { ListRequest: ... }
const wrapListRequest = (b) => ({ ListRequest: b });

// ======= type helpers =======

const typeCandidates = (seedType) => {
  const out = [];
  const tName = env("OT_LIST_TYPENAME", "").trim(); // e.g., "InventoryLotSerial"
  const tNums = env("OT_SERIAL_TYPES", "").trim();  // e.g., "[1100,1200]"

  // honor explicit seed
  if (seedType != null) out.push(seedType);

  // accept explicit typename
  if (tName) out.push({ TypeName: tName });

  // explicit numeric list
  if (tNums) {
    try {
      const arr = JSON.parse(tNums);
      if (Array.isArray(arr) && arr.length) out.push(...arr);
    } catch (_) {}
  }

  // expand common defaults
  out.push(
    1100, 1101, 1200, 1201,
    { TypeName: "LotOrSerialNo" },
    { TypeName: "InventoryLotSerial" },
    { TypeName: "ItemLocationSerial" },
    { TypeName: "InventoryTransactionSerial" }
  );

  // dedupe by JSON stringify
  const seen = new Set();
  return out.filter((t) => {
    const k = typeof t === "object" ? JSON.stringify(t) : String(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

// ======= main poster =======

async function otPostList(params) {
  // params expected: { Type? | TypeName?/RecordType?, Filters?, PageNumber?, NumberOfRecords? }
  const headers = buildHeaders();
  const paths = listPaths();

  // Build the initial "filter atom" we will fan out
  // Support both PropertyName and FieldName; value in FilterValueArray/FilterValues/FilterValue
  const rawFilters = Array.isArray(params?.Filters) ? params.Filters : [];
  const page = Number(params?.PageNumber || 1);
  const pageSize = Math.min(Number(params?.NumberOfRecords || env("OT_LIST_PAGE_SIZE", 500)), 1000);

  // We try type forms (Type / TypeName / RecordType) using a seed
  const seedType = params?.Type ?? (params?.TypeName ? { TypeName: params.TypeName } :
                   (params?.RecordType ? { RecordType: params.RecordType } : null));
  const typeForms = typeCandidates(seedType);

  // Build a matrix of ({Type|TypeName|RecordType}, filtersVariant) -> payload variants
  const variants = [];

  const ensurePaging = (b) => addPagingAliases({
    PageNumber: page,
    NumberOfRecords: pageSize,
    ...b,
  });

  // for each type form, build many filter dialects
  for (const t of typeForms) {
    const typeKv = typeof t === "object" ? t : { Type: t };

    // If no filters were provided, still attempt a no-filter list (some tenants allow it)
    const filtersSet = rawFilters.length ? rawFilters : [{}];
    for (const f0 of filtersSet) {
      const fSeeds = buildFilterVariants(f0);
      for (const f of fSeeds) {
        // canonical: Filters: [ f ]
        const base = ensurePaging({
          ...typeKv,
          Filters: [f],
        });

        // try multiple structural shapes
        variants.push({ label: "canonical", body: base });

        // numeric name list (frequently accepted)
        variants.push({
          label: 'numType:["Type","Filters","PageNumber","NumberOfRecords"]',
          body: base, // names already match; the label is for log parity
        });

        // also try PageNo/PageSize alias in case tenant routes via older model binders
        variants.push({
          label: 'numType:["Type","Filters","PageNumber","NumberOfRecords","PageNo","PageSize"]',
          body: addPagingAliases(base),
        });

        // wrap in { ListRequest: ... }
        variants.push({
          label: 'ListRequest',
          body: wrapListRequest(base),
        });
      }
    }
  }

  // === Execute attempts ===
  const errs = [];

  for (const path of paths) {
    const url = `${baseUrl()}${path}`;
    dbg("Using path:", url);
    for (const v of variants) {
      const payload = JSON.stringify(v.body || {});
      const to = withTimeout();
      try {
        dbg("POST", url, v.label, "len:", payload.length);
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: payload,
          cache: "no-store",
          signal: to.signal,
        });
        const text = await res.text();
        dbg("RES", res.status, v.label, "::", text.slice(0, 200));
        if (!res.ok) {
          errs.push(`OT ${res.status} [${path} ${v.label}] ${text.slice(0, 500)}`);
          to.cancel();
          continue;
        }
        // must be JSON
        try {
          const json = JSON.parse(text);
          to.cancel();
          return json;
        } catch (e) {
          errs.push(`Non-JSON [${path} ${v.label}] ${text.slice(0, 300)}`);
          to.cancel();
          continue;
        }
      } catch (e) {
        errs.push(`Fetch error [${path} ${v.label}] ${e && e.name === "AbortError" ? "timeout" : String(e.message || e)}`);
        to.cancel();
      }
    }
    // continue to next path
  }

  throw new Error(`All List shapes failed:\n- ${errs.join("\n- ")}`);
}

// ======= exports =======
module.exports = {
  otPostList,
};
