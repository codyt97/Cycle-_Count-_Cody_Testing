const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

const RT_BIN = 151;         // Bin
const RT_LOT_SERIAL = 1100; // Lot or Serial Number

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")      return method(res, ["GET", "OPTIONS"]);

  const bin = String(req.query.bin || "").trim();
  const debug = String(req.query.debug || "0") === "1";
  if (!bin) return bad(res, "bin is required", 400);

  try {
    // 1) Find the Bin row by its Name (Id + metadata)
    const bins = await otList({
      Type: RT_BIN,
      Filters: [{ PropertyName: "Name", Operator: 1, FilterValueArray: bin }],
      PageNumber: 1,
      NumberOfRecords: 1,
    });
    const binRow = bins?.[0];

    // 2) Build candidate filter strategies from the bin we found (if any)
    const strategies = [];
    if (binRow?.Id) {
      const id = String(binRow.Id);
      strategies.push(
        { name: "LocationBinRef.Id",   filter: { PropertyName: "LocationBinRef.Id",   Operator: 1, FilterValueArray: id } },
        { name: "BinRef.Id",           filter: { PropertyName: "BinRef.Id",           Operator: 1, FilterValueArray: id } },
        { name: "LocationBinId",       filter: { PropertyName: "LocationBinId",       Operator: 1, FilterValueArray: id } },
      );
    }
    // Also try name-based joins (works in some tenants)
    strategies.push(
      { name: "LocationBinRef.Name", filter: { PropertyName: "LocationBinRef.Name", Operator: 1, FilterValueArray: bin } },
      { name: "BinRef.Name",         filter: { PropertyName: "BinRef.Name",         Operator: 1, FilterValueArray: bin } },
    );

    const pageSize = 500;
    let used = null;
    let all = [];

    // 3) Try each strategy until we get rows
    for (const s of strategies) {
      let page = 1;
      let acc = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const chunk = await otList({
          Type: RT_LOT_SERIAL,
          Filters: [s.filter],
          PageNumber: page,
          NumberOfRecords: pageSize,
        });
        if (!chunk.length) break;
        acc.push(...chunk);
        if (chunk.length < pageSize) break;
        page++;
      }
      if (acc.length > 0) {
        used = s.name;
        all = acc;
        break;
      }
    }

    // 4) Map to UI shape
    const records = all.map(r => ({
      location:    r?.LocationBinRef?.Name || r?.BinRef?.Name || bin,
      sku:         r?.ItemRef?.Code || r?.ItemCode || r?.SKU || "—",
      description: r?.ItemRef?.Name || r?.ItemName || r?.Description || "—",
      systemImei:  String(r?.LotOrSerialNo || r?.Serial || r?.SerialNo || r?.IMEI || ""),
    })).filter(x => x.systemImei);

    // 5) Respond (include debug info if asked)
    return ok(res, debug ? { records, debug: { usedStrategy: used || "none", binFound: !!binRow?.Id } } : { records });
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
