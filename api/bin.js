// /api/ordertime/bin.js (CommonJS)
const { otFetch } = require("./_client");

module.exports = async (req, res) => {
  const { bin } = req.query || {};
  if (!bin) return res.status(400).json({ error: "Bin parameter is required" });

  try {
    const BIN_PATH = process.env.OT_BIN_PATH || "/inventory?bin=";
    const data = await otFetch(`${BIN_PATH}${encodeURIComponent(bin)}`);

    const items = (data.records || data.items || data || []).map((r) => ({
      location: r.location || r.bin || bin,
      description: r.description || r.itemDescription || r.itemName || "—",
      sku: r.sku || r.itemCode || r.partNo || "—",
      systemImei: String(r.imei || r.serial || r.systemImei || ""),
    }));

    return res.status(200).json({ bin, records: items });
  } catch (err) {
    console.error("bin.js error:", err);
    return res.status(500).json({ error: "Failed to fetch bin snapshot from OrderTime" });
  }
};
