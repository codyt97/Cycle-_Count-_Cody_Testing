const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

const RT_BIN = 151;         // Bin
const RT_LOT_SERIAL = 1100; // Lot or Serial Number

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")      return method(res, ["GET", "OPTIONS"]);

  const bin = String(req.query.bin || "").trim();
  const forced = String(req.query.strategy || "").trim(); // e.g. LocationBinRef.Name
  const debug = String(req.query.debug || "0") === "1";
  if (!bin) return bad(res, "bin is required", 400);

  try {
    // 1) Find the Bin row by Name (for Id-based strategies)
    let binRow = null;
    try {
      const bins = await otList({
        Type: RT_BIN,
        Filters: [{ PropertyName: "Name", Operator: 1, FilterValueArray: bin }],
        PageNumber: 1,
        NumberOfRecords: 1,
      });
      binRow = bins?.[0] || null;
    } catch (_) {
      // If this fails, we can still try name-based strategies below.
    }

    // 2) Build candidate strategies in order of "most robust" first
    const strategies = [];
    if (forced) {
      // If user forces a property, try only that
      const arrVal = forced.endsWith(".Id") && binRow?.Id ? String(binRow.Id) : bin;
      strategies.push({ name: forced, filter: { PropertyName: forced, Operator: 1, FilterValueArray: arrVal } });
    } else {
      if (binRow?.Id) {
        const id = String(binRow.Id);
        strategies.push(
          { name: "LocationBinRef.Id", filter: { PropertyName: "LocationBinRef.Id", Operator: 1, FilterValueArray: id } },
          { name: "BinRef.Id",         filter: { PropertyName: "BinRef.Id",         Operator: 1, FilterValueArray: id } },
          { name: "LocationBinId",     filter: { PropertyName: "LocationBinId",     Operator: 1, FilterValueArray: id } },
        );
      }
      // Name-based joins (some tenants expose only Name on the lot/serial)
      strategies.push(
        { name: "LocationBinRef.Name", filter: { PropertyName: "LocationBinRef.Name", Operator: 1, FilterValueArray: bin } },
        { name: "BinRef.Name",         filter: { PropertyName: "BinRef.Name",         Operator: 1, FilterValueArray: bin } },
      );
    }

    // 3) Try each strategy; skip any that cause OT 400/500
    const pageSize = 500;
    let used = null;
    let all = [];
    let probeErrors = [];

    for (const s of strategies) {
      try {
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
      } catch (err) {
        // Record and continue — OrderTime sometimes throws
        // "Object reference not set..." for unknown properties.
        probeErrors.push({ strategy: s.name, error: String(err.message || err) });
        continue;
      }
    }

    // 4) Map to UI shape
    const records = all.map(r => ({
      location:    r?.LocationBinRef?.Name || r?.BinRef?.Name || bin,
      sku:         r?.ItemRef?.Code || r?.ItemCode || r?.SKU || "—",
      description: r?.ItemRef?.Name || r?.ItemName || r?.Description || "—",
      systemImei:  String(r?.LotOrSerialNo || r?.Serial || r?.SerialNo || r?.IMEI || ""),
    })).filter(x => x.systemImei);

    const payload = { records };
    if (debug) payload.debug = {
      usedStrategy: used || "none",
      binFound: !!binRow?.Id,
      tried: strategies.map(s => s.name),
      probeErrors
    };

    return ok(res, payload);
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
