const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

// OrderTime RecordTypeEnum that works for your tenant
const RT_INV_BY_BIN = 1141; // Inventory-by-Bin

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")      return method(res, ["GET", "OPTIONS"]);

  const binName = String(req.query.bin || "").trim();
  if (!binName) return bad(res, "bin is required", 400);

  try {
    // Query the inventory-by-bin list by Bin name
    // (your Postman test proved this returns rows)
    const pageSize = 500;
    let page = 1, all = [];

    while (true) {
      const chunk = await otList({
        Type: RT_INV_BY_BIN,
        Filters: [{ PropertyName: "BinRef.Name", Operator: 1, FilterValueArray: binName }],
        PageNumber: page,
        NumberOfRecords: pageSize,
      });
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      all.push(...chunk);
      if (chunk.length < pageSize) break;
      page++;
    }

    // Map to your UI shape
    const records = all.map(r => ({
      location:    r?.BinRef?.Name || binName,           // show BIN
      sku:         r?.ItemRef?.Name || r?.ItemRef?.Code || r?.ItemCode || "—",
      description: r?.Description || r?.ItemRef?.Name || "—",
      systemImei:  String(r?.LotOrSerialNo || r?.LotOrSerialRef?.Name || r?.SerialNumber || ""),
    })).filter(x => x.systemImei);

    return ok(res, { records });
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
