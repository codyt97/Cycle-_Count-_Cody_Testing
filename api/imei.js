// /api/ordertime/imei.js (CommonJS)
const { otFetch } = require("./_client");

module.exports = async (req, res) => {
  const { imei } = req.query || {};
  if (!imei) return res.status(400).json({ error: "IMEI parameter is required" });

  try {
    const IMEI_PATH = process.env.OT_IMEI_PATH || "/inventory/locate?imei=";
    const data = await otFetch(`${IMEI_PATH}${encodeURIComponent(imei)}`);

    // Some OT endpoints return arrays; normalize
    const d = Array.isArray(data) ? data[0] || {} : data || {};

    const info = {
      imei,
      location: d.location || d.bin || d.binCode || null,
      sku: d.sku || d.itemCode || d.partNo || "—",
      description: d.description || d.itemDescription || d.itemName || "—",
    };

    return res.status(200).json(info);
  } catch (err) {
    console.error("imei.js error:", err);
    return res.status(500).json({ error: "Failed to fetch IMEI location from OrderTime" });
  }
};
