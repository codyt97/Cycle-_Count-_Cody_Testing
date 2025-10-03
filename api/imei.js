export default async function handler(req, res) {
  const { imei } = req.query;
  if (!imei) return res.status(400).json({ error: "IMEI parameter is required" });

  try {
    // Call OrderTime API to locate IMEI (replace endpoint path with correct one)
    const response = await fetch(
      `${process.env.OT_BASE_URL}/inventory/locate?imei=${encodeURIComponent(imei)}`,
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

    // Shape response
    const locationInfo = {
      imei,
      location: data.location || null,
      sku: data.sku || data.itemCode || "—",
      description: data.description || "—",
    };

    res.status(200).json(locationInfo);
  } catch (err) {
    console.error("IMEI fetch error:", err);
    res.status(500).json({ error: "Failed to fetch IMEI location from OrderTime" });
  }
}
