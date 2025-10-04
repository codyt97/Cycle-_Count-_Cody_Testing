// /api/ordertime/bin.js
const { otPostList } = require("./_client");

module.exports = async (req, res) => {
  const { bin } = req.query || {};
  if (!bin) return res.status(400).json({ error: "Bin parameter is required" });

  try {
    const pageSize = Math.min(parseInt(process.env.OT_LIST_PAGE_SIZE || "500", 10), 1000);

    // Use OrderTime List API: Type 1100 = Lot or Serial Number
    const body = {
      Type: 1100,
      Filters: [{ PropertyName: "BinRef.Name", FilterValueArray: [bin] }],
      PageNumber: 1,
      NumberOfRecords: pageSize,
    };

    // try BinRef.Name, then LocationBinRef.Name (schemas vary across tenants)
const attempts = [
  { PropertyName: "BinRef.Name",          FilterValueArray: [bin] },
  { PropertyName: "LocationBinRef.Name",  FilterValueArray: [bin] },
];

let records = [];
let lastErr;

for (const f of attempts) {
  try {
    const data = await otPostList({
  Type: 1100, // Lot or Serial Number
  Filters: [f],
  PageNumber: 1,
  NumberOfRecords: Math.min(parseInt(process.env.OT_LIST_PAGE_SIZE || "500",10), 1000),
});
    records = data?.Records || [];
    if (records.length) break; // success
  } catch (e) {
    lastErr = e;
  }
}

// If no records and we had an API error, surface it to the client
if (!records.length && lastErr) {
  return res.status(502).json({ error: `OrderTime error: ${String(lastErr.message || lastErr)}` });
}

// Map results (OK to return empty array if bin legitimately has no serials)
const items = records.map(r => ({
  location: r?.BinRef?.Name || r?.LocationBinRef?.Name || bin,
  sku: r?.ItemRef?.Name || r?.ItemCode || "—",
  description: r?.ItemName || r?.Description || "—",
  systemImei: String(r?.SerialNo || r?.LotNo || r?.Serial || ""),
}));

return res.status(200).json({ bin, records: items });

  } catch (err) {
    console.error("bin.js error:", err);
    return res.status(500).json({ error: "Failed to fetch bin snapshot from OrderTime" });
  }
};
