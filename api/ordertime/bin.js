// api/ordertime/bin.js

const { postList } = require("./_client");

module.exports = async function handler(req, res) {
  try {
    const bin = (req.query?.bin || req.query?.Bin || "").trim();
    if (!bin) {
      res.status(400).json({ error: "Missing required query param ?bin=" });
      return;
    }

    // 1141 => InventoryTransaction (Lot/Serial movement history)
    // Filter by BinRef.Name == bin
    const payload = {
      Type: 1141,
      Filters: [
        {
          PropertyName: "BinRef.Name",
          Operator: 1, // Equals
          FilterValueArray: [bin],
        },
      ],
      PageNumber: 1,
      NumberOfRecords: 50, // tweak as needed
    };

    const data = await postList(payload);

    // Return raw data; your frontend can map as needed.
    res.status(200).json({ bin, rows: Array.isArray(data) ? data : [] });
  } catch (err) {
    // Bubble a clear message back to UI
    res
      .status(500)
      .json({ error: err?.message || "Unknown error calling OrderTime" });
  }
};
