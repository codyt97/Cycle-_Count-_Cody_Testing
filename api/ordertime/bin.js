// /api/ordertime/bin.js
const client = require("./_client.js");
const otPostList = client && client.otPostList;

/**
 * Returns ALL item lines in a bin (not just first page), normalized as:
 *   { location, sku, description, systemImei }
 *
 * Env overrides:
 *   OT_SERIAL_TYPES   - JSON array of Type ids to try, e.g. [1100,1200,3100]
 *   OT_BIN_PROP       - exact PropertyName to filter on (e.g., "BinRef.Name")
 *   OT_LIST_PAGE_SIZE - page size (default 500; max 1000)
 */
module.exports = async (req, res) => {
  const { bin } = req.query || {};
  if (!bin) return res.status(400).json({ error: "Bin parameter is required" });

  try {
    const pageSize = Math.min(parseInt(process.env.OT_LIST_PAGE_SIZE || "500", 10), 1000);

    // 1) Types to try (from env or defaults)
    let serialTypes = [1100];
    if (process.env.OT_SERIAL_TYPES) {
      try {
        const parsed = JSON.parse(process.env.OT_SERIAL_TYPES);
        if (Array.isArray(parsed) && parsed.length) {
          serialTypes = parsed.map(n => parseInt(n, 10)).filter(Boolean);
        }
      } catch (_) { /* ignore */ }
    }

    // 2) Bin property to use
    const forcedProp = (process.env.OT_BIN_PROP || "").trim();
    const binFilters = forcedProp
      ? [{ PropertyName: forcedProp, FilterValueArray: [bin] }]
      : [
          { PropertyName: "BinRef.Name",         FilterValueArray: [bin] },
          { PropertyName: "LocationBinRef.Name", FilterValueArray: [bin] },
        ];

    let records = [];
    let lastErr;

    // Try combinations until one returns data (or we exhaust options).
    for (const Type of serialTypes) {
      for (const filter of binFilters) {
        try {
          const all = [];
          let page = 1;
          while (true) {
            const data = await otPostList({
              Type,
              Filters: [filter],
              PageNumber: page,
              NumberOfRecords: pageSize,
            });
            const batch = data?.Records || [];
            all.push(...batch);
            if (batch.length < pageSize) break; // last page
            page++;
          }
          if (all.length || forcedProp) {
            // If forcedProp is set, accept empty (means bin empty), but still a valid shape.
            records = all;
            break;
          }
        } catch (e) {
          lastErr = e;
          // try next combination
        }
      }
      if (records.length || forcedProp) break;
    }

    // If no records AND we had an API error, surface it to the client
    if (!records.length && lastErr && !forcedProp) {
      return res.status(502).json({ error: `OrderTime error: ${String(lastErr.message || lastErr)}` });
    }

    // Normalize fields for the front-end
    const items = records.map(r => ({
      location: r?.BinRef?.Name || r?.LocationBinRef?.Name || r?.Bin?.Name || r?.LocationBin?.Name || bin,
      sku: r?.ItemRef?.Name || r?.ItemCode || "—",
      description: r?.ItemName || r?.Description || "—",
      systemImei: String(r?.SerialNo || r?.LotNo || r?.Serial || ""),
    }));

    return res.status(200).json({ bin, count: items.length, records: items });
  } catch (err) {
    console.error("bin.js error:", err);
    return res.status(500).json({ error: "Failed to fetch bin snapshot from OrderTime" });
  }
};
