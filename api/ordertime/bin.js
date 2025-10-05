import axios from "axios";

export default async function handler(req, res) {
  try {
    const { bin } = req.query;

    if (!bin) {
      return res.status(400).json({ error: "Bin parameter is required" });
    }

    // OrderTime API credentials
    const baseUrl = process.env.ORDERTIME_API_URL || "https://services.ordertime.com/api";
    const username = process.env.ORDERTIME_USERNAME;
    const password = process.env.ORDERTIME_PASSWORD;
    const company = process.env.ORDERTIME_COMPANY;

    // Get auth token
    const tokenResponse = await axios.post(`${baseUrl}/Login`, {
      Username: username,
      Password: password,
      CompanyName: company,
    });

    const token = tokenResponse.data?.Token;
    if (!token) throw new Error("Authentication failed – no token returned.");

    console.log("[bin] 🔑 Auth successful, token obtained.");

    // Request filters for Bin + Location
    const payload = {
      Type: "InventoryLotSerial",
      Filters: [
        {
          PropertyName: "LocationRef.Name",
          FilterOperation: "Equals",
          Value: "KOP",
        },
        {
          PropertyName: "BinRef.Name",
          FilterOperation: "Equals",
          Value: bin,
        },
      ],
      PageNumber: 1,
      NumberOfRecords: 500,
    };

    console.log("[bin] 📦 Request Payload:", payload);

    // Make API call to OrderTime
    const response = await axios.post(`${baseUrl}/List`, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const rows = response.data?.Rows || [];

    console.log(`[bin] ✅ Received ${rows.length} records from OrderTime.`);

    // Shape the response for frontend
    const formatted = rows.map((r) => ({
      item: r.ItemRef?.Name || "",
      description: r.ItemRef?.Description || "",
      location: r.LocationRef?.Name || "",
      bin: r.BinRef?.Name || "",
      imei:
        r.SerialNo ||
        r.LotNumber ||
        r.SerialNumber ||
        r.LotOrSerialNo ||
        "N/A",
      available: r.Available || 0,
    }));

    return res.status(200).json({ bin, count: formatted.length, results: formatted });
  } catch (error) {
    console.error("[bin] ❌ Error:", error.response?.data || error.message);
    return res.status(500).json({
      error: "OrderTime bin lookup failed",
      details: error.response?.data || error.message,
    });
  }
}
