// /api/ordertime/bin.js
// Loads a snapshot of system IMEIs in a given bin from OrderTime.

/* eslint-disable no-console */
const { otPostList } = require("./_client");

// ---------- small utils ----------
const env = (k, d = undefined) => {
  const v = process.env[k];
  return v === undefined || v === "" ? d : v;
};
const bool = (k) => {
  const v = env(k, "");
  return v === "1" || v?.toLowerCase?.() === "true";
};
const dbgOn = bool("OT_DEBUG");
const dbg = (...xs) => { if (dbgOn) console.log("[bin]", ...xs); };

// Parse JSON env safely
const parseJson = (raw, fallback) => {
  try { return JSON.parse(raw); } catch { return fallback; }
};

// ---------- configuration ----------
const pageSizeMax = 1000;
const defaultPageSize = Math.min(
  parseInt(env("OT_LIST_PAGE_SIZE", "500"), 10) || 500,
  pageSizeMax
);

// Bin field cascade (unless OT_BIN_PROP pins one)
const defaultBinProps = [
  "LocationBinRef.Name",
  "BinRef.Name",
  "LocationBin.Name",
  "Bin.Name",
  "Location.Name",
];

// Location filter defaults (UI shows Location IN [...])
const defaultLocationField = "LocationRef.Name";
const defaultLocationValues = ["KOP", "3PL"];

// Record type candidates: numeric + common typenames
const defaultTypeNums  = [1100, 1101, 1200, 1201];
const defaultTypeNames = [
  "LotOrSerialNo",
  "InventoryLotSerial",
  "ItemLocationSerial",
  "InventoryTransactionSerial",
];

// Build the ordered list of type forms we’ll try
const buildTypeForms = () => {
  const forms = [];

  // Explicit overrides first
  const typeName = env("OT_LIST_TYPENAME", "").trim();
  if (typeName) forms.push({ TypeName: typeName });

  const typeNums = env("OT_SERIAL_TYPES", "");
  if (typeNums) {
    const nums = parseJson(typeNums, []);
    if (Array.isArray(nums)) for (const n of nums) forms.push(n);
  }

  // Then our defaults
  for (const n of defaultTypeNums) forms.push(n);
  for (const tn of defaultTypeNames) forms.push({ TypeName: tn });

  // Dedupe
  const seen = new Set();
  return forms.filter((t) => {
    const key = typeof t === "object" ? JSON.stringify(t) : String(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Normalize a List record into our client shape
const normalizeRecord = (r = {}) => {
  const bin =
    r?.BinRef?.Name ||
    r?.LocationBinRef?.Name ||
    r?.Bin?.Name ||
    r?.LocationBin?.Name ||
    r?.Location?.Name ||
    null;

  const itemRef = r?.ItemRef?.Name || r?.ItemCode || null;
  const itemName = r?.ItemName || r?.Description || null;

  const serial =
    r?.SerialNo || r?.Serial || r?.LotNo || r?.Lot || r?.IMEI || null;

  const sku = r?.SKU || r?.ItemSKU || null;

  return { bin, itemRef, itemName, serial, sku, raw: r };
};

// ---------- handler ----------
module.exports = async (req, res) => {
  const bin = (req.query?.bin || req.body?.bin || "").trim();
  if (!bin) {
    return res.status(400).json({ error: "Query param ?bin= is required." });
  }

  // Env-driven knobs
  const forcedProp = env("OT_BIN_PROP", "").trim() || null;
  const binProps = forcedProp ? [forcedProp] : defaultBinProps;

  const locationField = env("OT_LOCATION_FIELD", "").trim() || defaultLocationField;
  const locationValues = (() => {
    const raw = env("OT_LOCATION_VALUES", "");
    if (!raw) return defaultLocationValues;
    const arr = parseJson(raw, null);
    return Array.isArray(arr) && arr.length ? arr : defaultLocationValues;
  })();

  const pageSize = defaultPageSize;
  const typeForms = buildTypeForms();

  dbg({ bin, pageSize, forcedProp, locationField, locationValues, typeForms });

  let attempts = 0;
  let lastErr = null;
  const out = [];

  try {
    // Try each bin field, then each type
    for (const prop of binProps) {
      // Build the pair of filters the UI shows: Location IN (…) AND Bin IN (bin)
      const baseFilters = [
        { FieldName: locationField, Operator: "In",  FilterValues: locationValues },
        { FieldName: prop,          Operator: "In",  FilterValues: [bin] },
      ];

      for (const t of typeForms) {
        // The _client knows how to fan out different dialects; we provide the most explicit shape.
        const params = {
          ...(typeof t === "object" ? t : { Type: t }),
          Filters: baseFilters,
          PageNumber: 1,
          NumberOfRecords: pageSize,
        };

        attempts++;
        dbg("try", { Type: params.Type ?? params.TypeName ?? params.RecordType, prop, page: 1, pageSize, bin, locations: locationValues });

        let data;
        try {
          data = await otPostList(params);
        } catch (e) {
          lastErr = e;
          dbg("err", String(e.message || e));
          continue; // try next variant
        }

        const records = Array.isArray(data?.Records) ? data.Records : [];
        if (records.length) {
          for (const r of records) out.push(normalizeRecord(r));
          // We found a working shape with data — return immediately.
          return res.status(200).json({
            bin,
            count: out.length,
            records: out,
            meta: {
              binPropTried: prop,
              typeUsed: params.Type ?? params.TypeName ?? params.RecordType ?? null,
              pageSize,
              locationField,
              locationValues,
            },
          });
        }
        // If no rows for this variant, keep trying next type / prop
      }
    }

    // If we got here: no variant returned rows.
    if (attempts === 0) {
      return res.status(502).json({
        error:
          "No requests were sent to OrderTime. Check OT_BASE_URL / credentials / OT_LIST_PATH(S).",
      });
    }

    // If _client reported structured error, pass it through for visibility.
    if (lastErr) {
      return res.status(502).json({
        error: "OrderTime list failed for all variants.",
        detail: String(lastErr.message || lastErr),
        tried: {
          binProps,
          typeForms,
          locationField,
          locationValues,
        },
        bin,
        count: 0,
        records: [],
      });
    }

    // Otherwise, we successfully called but got zero rows everywhere.
    return res.status(200).json({
      bin,
      count: 0,
      records: [],
      meta: {
        binPropsTried: binProps,
        typeForms,
        pageSize,
        locationField,
        locationValues,
      },
    });
  } catch (fatal) {
    return res.status(500).json({
      error: "bin endpoint crashed",
      detail: String(fatal && fatal.message || fatal),
    });
  }
};
