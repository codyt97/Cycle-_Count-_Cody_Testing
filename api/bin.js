export default async function handler(req, res) {
  const { bin } = req.query;
  if (!bin) return res.status(400).json({ error: "Bin parameter is required" });

  try {
    // Call OrderTime API (replace endpoint path with correct one for your instance)
    const response = await fetch(
      `${process.env.OT_BASE_URL}/inventory?bin=${encodeURIComponent(bin)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${process.env.OT_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`OrderTime error: ${response.statusText}`);
    }

    const data = await response.json();

    // Map response into consistent shape for your front-end
    const items = (data.records || []).map(r => ({
      location: r.location || bin,
      description: r.description || r.itemName || "—",
      sku: r.sku || r.itemCode || "—",
      systemImei: String(r.imei || r.systemImei || r.serial || ""),
    }));

    res.status(200).json({ records: items });
  } catch (err) {
    console.error("Bin fetch error:", err);
    res.status(500).json({ error: "Failed to fetch bin snapshot from OrderTime" });
  }
}
