// /api/ordertime/bin.js
const client = require("./_client.js");
const otPostList = client && client.otPostList;

/**
 * Returns ALL item lines in a bin (not just first page), normalized as:
 *   { location, sku, description, systemImei }
 *
 * Notes:
 * - Paginates until fewer than pageSize records.
 * - Tries both BinRef.Name and LocationBinRef.Name (tenants differ).
 * - Allows overriding the "Type" for Lot/Serial via OT_SERIAL_TYPES env.
 */
module.exports = async (req, res) => {
  const { bin } = req.query || {};
  if (!bin) return res.status(400).json({ error: "Bin parameter is required" });

  try {
    const pageSize = Math.min(parseInt(process.env.OT_LIST_PAGE_SIZE || "500", 10), 1000);

    // Some tenants use different entity Types for Lot/Serial; allow override.
    let serialTypes = [1100];
    if (process.env.OT_SERIAL_TYPES) {
      try {
        const parsed = JSON.parse(process.env.OT_SERIAL_TYPES);
        if (Array.isArray(parsed) && parsed.length) serialTypes = parsed.map(n => parseInt(n, 10)).filter(Boolean);
      } catch (_) { /* ignore bad JSON */ }
    }

    // Try both possible bin property names per tenant schema.
    const binFilters = [
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

          if (all.length) {
            records = all;
            break; // success
          }
        } catch (e) {
          lastErr = e;
          // try next combination
        }
      }
      if (records.length) break;
    }

    // If no records AND we had an API error, surface it to the client
    if (!records.length && lastErr) {
      return res
        .status(502)
        .json({ error: `OrderTime error: ${String(lastErr.message || lastErr)}` });
    }

    // Normalize fields for the front-end
    const items = records.map(r => ({
      location: r?.BinRef?.Name || r?.LocationBinRef?.Name || bin,
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
