// /api/ordertime/bin.js
const { otPost } = require("./_client");

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

    const data = await otPost("/list", body);
    const items = (data?.Records || []).map(r => ({
      location: r?.BinRef?.Name || bin,
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
