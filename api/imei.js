// /api/ordertime/imei.js
const { otPost } = require("./_client");

module.exports = async (req, res) => {
  const { imei } = req.query || {};
  if (!imei) return res.status(400).json({ error: "IMEI parameter is required" });

  try {
    const body = {
      Type: 1100, // Lot or Serial Number
      Filters: [{ PropertyName: "SerialNo", FilterValueArray: [String(imei)] }],
      PageNumber: 1,
      NumberOfRecords: 5,
    };

    const data = await otPost("/list", body);
    const rec = (data?.Records || [])[0] || {};

    const info = {
      imei: String(imei),
      location: rec?.BinRef?.Name || rec?.LocationBinRef?.Name || null,
      sku: rec?.ItemRef?.Name || rec?.ItemCode || "—",
      description: rec?.ItemName || rec?.Description || "—",
    };

    return res.status(200).json(info);
  } catch (err) {
    console.error("imei.js error:", err);
    return res.status(500).json({ error: "Failed to fetch IMEI location from OrderTime" });
  }
};
