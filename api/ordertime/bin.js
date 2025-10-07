const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

const RT_BIN = 151;         // Bin
const RT_LOT_SERIAL = 1100; // Lot or Serial Number

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")      return method(res, ["GET", "OPTIONS"]);

  const bin = String(req.query.bin || "").trim();
  if (!bin) return bad(res, "bin is required", 400);

  try {
    // Find Bin by Name
    const bins = await otList({
      Type: RT_BIN,
      Filters: [{ PropertyName: "Name", Operator: 1, FilterValueArray: bin }],
      PageNumber: 1,
      NumberOfRecords: 1,
    });
    const binRow = bins?.[0];
    if (!binRow?.Id) return ok(res, { records: [] });

    const pageSize = 500;
    let page = 1, all = [];
    const filter = { PropertyName: "LocationBinRef.Id", Operator: 1, FilterValueArray: String(binRow.Id) };

    while (true) {
      const chunk = await otList({
        Type: RT_LOT_SERIAL,
        Filters: [filter],
        PageNumber: page,
        NumberOfRecords: pageSize,
      });
      if (!chunk.length) break;
      all.push(...chunk);
      if (chunk.length < pageSize) break;
      page++;
    }

    const records = all.map(r => ({
      location:    r?.LocationBinRef?.Name || bin,
      sku:         r?.ItemRef?.Code || r?.ItemCode || r?.SKU || "—",
      description: r?.ItemRef?.Name || r?.ItemName || r?.Description || "—",
      systemImei:  String(r?.LotOrSerialNo || r?.Serial || r?.SerialNo || r?.IMEI || ""),
    })).filter(x => x.systemImei);

    return ok(res, { records });
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
