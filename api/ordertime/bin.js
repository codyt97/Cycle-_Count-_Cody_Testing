// api/ordertime/bin.js
const { postList } = require("./_client");

/**
 * GET /api/ordertime/bin?bin=B-04-03
 * Returns the latest inventory movement rows for a given BIN.
 * Uses Type 1141 with filter on BinRef.Name.
 */
module.exports = async (req, res) => {
  try {
    const { bin } = req.query || {};
    if (!bin || typeof bin !== "string") {
      res.status(400).json({ error: "Missing ?bin= parameter" });
      return;
    }

    // OrderTime inventory movement query (works from your Postman tests)
    const body = {
      Type: 1141,
      Filters: [
        {
          PropertyName: "BinRef.Name",
          Operator: 1, // Equals
          FilterValueArray: [bin],
        },
      ],
      PageNumber: 1,
      NumberOfRecords: 50,
    };

    console.log("[BIN] Querying 1141 by BinRef.Name=%s", bin);
    const data = await postList(body);

    // Normalize to rows array (OrderTime usually returns an array directly)
    const rows = Array.isArray(data) ? data : data?.Rows || [];
    console.log("[BIN] page %d -> %d rows", body.PageNumber, rows.length);

    res.status(200).json({ bin, rows });
  } catch (err) {
    console.error("[BIN] error", err);
    // Keep the message short for the UI; the console has full details
    res.status(502).json({ error: String(err.message || err) });
  }
};
