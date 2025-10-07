// api/ordertime/bin.js
const { postList } = require("./_client");

module.exports = async function handler(req, res) {
  try {
    // --- SAFE query parsing for Vercel Node functions ---
    const base = `http://${req.headers.host || "localhost"}`;         // supply a base
    const url = new URL(req.url, base);
    const bin = (req.query && req.query.bin) || url.searchParams.get("bin");

    if (!bin) {
      return res.status(400).json({ error: "Missing ?bin= parameter" });
    }

    console.log('[BIN] Querying 1141 by BinRef.Name="%s"', bin);

    // OT type 1141 = Inventory Ledger filtered by Bin
    const body = {
      Type: 1141,
      Filters: [
        { PropertyName: "BinRef.Name", Operator: 1, FilterValueArray: [bin] },
      ],
      PageNumber: 1,
      NumberOfRecords: 50,
    };

    // call OrderTime
    const rows = await postList(body);

    console.log("[BIN] page %d → %d rows", body.PageNumber, rows?.length || 0);
    return res.status(200).json({ rows });
  } catch (err) {
    console.error("[BIN] error", err);
    // surface a clean message back to the client
    const msg = err?.message || "Unknown error";
    const code = /OT\s+\d+/.test(msg) ? 502 : 500;
    return res.status(code).json({ error: msg });
  }
};
