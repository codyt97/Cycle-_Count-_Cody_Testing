// api/ordertime/bin.js
const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

// Adjust the "Type" and "Prop" names to your tenant’s schema if needed.
// This version pulls Lot/Serial rows that are IN a specific LocationBin.
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);

  const bin = String(req.query.bin || "").trim();
  if (!bin) return bad(res, "bin is required", 400);

  try {
    // OrderTime List with Filters
    // Examples of Types you may need: "InventoryLotSerial", "ItemLocationSerial", or "BinLotOrSerial"
    // Use the one in your environment that returns IMEI/Serial + Item for a BIN.
    const Type = "BinLotOrSerial"; // try this first; if not present, switch to your known good type.
    const Filters = [
      { Prop: "LocationBinRef.Name", Op: "=", Value: bin },
      // Optional: restrict to locations if you need (KOP/3PL)
      // { Prop: "LocationRef.Name", Op: "in", Value: ["KOP","3PL"] }
    ];

    // Pull pages until done (cap to avoid runaway)
    let page = 1;
    const pageSize = 500;
    const all = [];
    for (; page <= 10; page++) {
      const recs = await otList({ Type, Filters, PageNumber: page, NumberOfRecords: pageSize });
      if (!recs.length) break;
      all.push(...recs);
      if (recs.length < pageSize) break;
    }

    // Map to UI shape
    const records = all.map(r => ({
      location: r?.LocationBinRef?.Name || bin,
      sku: r?.ItemRef?.Code || r?.ItemCode || r?.SKU || "—",
      description: r?.ItemRef?.Name || r?.ItemName || r?.Description || "—",
      systemImei: String(r?.LotOrSerialNo || r?.Serial || r?.IMEI || "")
    })).filter(r => r.systemImei);

    return ok(res, { records });
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
