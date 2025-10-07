// api/ordertime/bin.js
const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

// Try several entity Types, stop on first that returns rows
const TYPE_CANDIDATES = [
  "BinLotOrSerial",          // best if your tenant has it
  "InventoryLotSerial",      // common
  "ItemLocationSerial",      // fallback
];

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);

  const bin = String(req.query.bin || "").trim();
  if (!bin) return bad(res, "bin is required", 400);

  try {
    let all = [];
    for (const Type of TYPE_CANDIDATES) {
      // Each page
      let page = 1;
      const pageSize = 500;
      let fetched = [];
      do {
        fetched = await otList({
          Type,
          Filters: [{ Prop: "LocationBinRef.Name", Op: "=", Value: bin }],
          PageNumber: page,
          NumberOfRecords: pageSize,
        });
        all.push(...fetched);
        page++;
      } while (fetched.length === pageSize);

      if (all.length) break; // got data with this Type
    }

    if (!all.length) return ok(res, { records: [] });

    const records = all.map(r => ({
      location: r?.LocationBinRef?.Name || bin,
      sku: r?.ItemRef?.Code || r?.ItemCode || r?.SKU || "—",
      description: r?.ItemRef?.Name || r?.ItemName || r?.Description || "—",
      systemImei: String(
        r?.LotOrSerialNo || r?.Serial || r?.SerialNo || r?.IMEI || ""
      ),
    })).filter(r => r.systemImei);

    return ok(res, { records });
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
