// /api/ordertime/bin.js
const client = require("./_client.js");
const otPostList = client && client.otPostList;

/**
 * Env overrides:
 *   OT_SERIAL_TYPES   - JSON array of numeric Types (only used if your tenant supports numeric)
 *   OT_BIN_PROP       - exact property to filter on (e.g., "BinRef.Name", "Bin.Name")
 *   OT_LIST_PAGE_SIZE - default 500, max 1000
 */
module.exports = async (req, res) => {
  const { bin } = req.query || {};
  if (!bin) return res.status(400).json({ error: "Bin parameter is required" });

  try {
  const pageSize = Math.min(parseInt(process.env.OT_LIST_PAGE_SIZE || "500", 10), 1000);

  // DEBUG/telemetry: count outbound attempts to OrderTime
  let attempts = 0;


    // Try Type(s) if your tenant still supports numeric Types; otherwise the client will switch to TypeName
    let serialTypes = [1100];
    if (process.env.OT_SERIAL_TYPES) {
      try {
        const parsed = JSON.parse(process.env.OT_SERIAL_TYPES);
        if (Array.isArray(parsed) && parsed.length) serialTypes = parsed.map(n => parseInt(n,10)).filter(Boolean);
      } catch(_) {}
    }

    // Property to filter by
    const forcedProp = (process.env.OT_BIN_PROP || "").trim();
    // Try a cascade of common bin/location fields if none is forced by env
    const binProps = forcedProp ? [forcedProp] : [
      "LocationBinRef.Name",
      "BinRef.Name",
      "LocationBin.Name",
      "Bin.Name",
      "Location.Name",
      ];
 // <- replace with the probe winner


    let records = [];
    let lastErr;

    // We’ll loop, but remember: the client may replace numeric Type with TypeName internally.
    for (const Type of serialTypes) {
      for (const prop of binProps) {
        try {
          const all = [];
          let page = 1;
          while (true) {
            attempts++;
if (process.env.OT_DEBUG) {
  console.log("[bin] try", { Type, prop, page, pageSize, bin });
}
const data = await otPostList({
  Type, // ignored if client flips to TypeName under the hood
  Filters: [{ FieldName: prop, Operator: "Equals", FilterValue: bin }],
  PageNumber: page,
  NumberOfRecords: pageSize,
});

            const batch = data?.Records || [];
            all.push(...batch);
            if (batch.length < pageSize) break;
            page++;
          }
          records = all;
          // Accept success immediately; if zero results, it may just be an empty bin — that’s still valid.
          if (records.length || forcedProp) break;
        } catch (e) { lastErr = e; }
      }
      if (records.length || forcedProp) break;
    }

    // If we never even attempted a fetch, that's a misconfiguration (otPostList not reachable or short-circuited)
if (!records.length && attempts === 0) {
  return res.status(502).json({
    error: "No requests sent to OrderTime. Check OT_BASE_URL, OT_API_KEY, OT_EMAIL, and OT_LIST_PATH envs.",
  });
}

// If we attempted and got an error, bubble that up unless a forcedProp is specified
if (!records.length && lastErr && !forcedProp) {
  return res.status(502).json({ error: `OrderTime error: ${String(lastErr.message || lastErr)}` });
}


    const items = records.map(r => ({
  location:
    r?.LocationBinRef?.Name ||
    r?.BinRef?.Name ||
    r?.LocationBin?.Name ||
    r?.Bin?.Name ||
    r?.Location?.Name ||
    bin,
  sku: r?.ItemRef?.Name || r?.ItemCode || r?.Item?.Code || "—",
  description: r?.ItemName || r?.Description || r?.Item?.Name || "—",
  systemImei: String(r?.SerialNo || r?.LotNo || r?.Serial || r?.LotOrSerialNo || ""),
}));


    return res.status(200).json({ bin, count: items.length, records: items });
  } catch (err) {
    console.error("bin.js error:", err);
    return res.status(500).json({ error: "Failed to fetch bin snapshot from OrderTime" });
  }
};
