// api/ordertime/bin.js
const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

// Report type for "Inventory By Bin"
const RT_INV_BY_BIN = 1141;

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    withCORS(res);
    return res.status(204).end();
  }
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);

  const bin = String(req.query.bin || "").trim();
  if (!bin) return bad(res, "bin is required", 400);

  try {
    console.info("[BIN] Querying 1141 by BinRef.Name=", bin);

    const rows = await otList({
      Type: RT_INV_BY_BIN,
      PageNumber: 1,
      NumberOfRecords: 500,
      Filters: [
        {
          // exact match on bin name (Operator 1)
          PropertyName: "BinRef.Name",
          Operator: 1,
          FilterValueArray: [bin],
        },
      ],
    });

    return ok(res, rows);
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
