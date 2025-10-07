const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");

// Known useful record types (numbers are OT's RecordTypeEnum values)
const RT = {
  BIN: 151,              // Bin
  LOT_SERIAL: 1100,      // Lot or Serial Number (some tenants)
  INV_BY_BIN: 1141,      // Inventory-by-Bin / movement view (common)
  // Add more here if OT support tells you a different enum carries the IMEIs
};

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")      return method(res, ["GET", "OPTIONS"]);

  const binName = String(req.query.bin || "").trim();
  const forced  = String(req.query.strategy || "").trim();  // e.g. '1100:LocationBinRef.Name' or '1141:BinRef.Name'
  const debug   = String(req.query.debug || "0") === "1";
  if (!binName) return bad(res, "bin is required", 400);

  try {
    // 1) Get Bin.Id (helps for *.Id strategies)
    let binRow = null;
    try {
      const bins = await otList({
        Type: RT.BIN,
        Filters: [{ PropertyName: "Name", Operator: 1, FilterValueArray: binName }],
        PageNumber: 1,
        NumberOfRecords: 1,
      });
      binRow = bins?.[0] || null;
    } catch (_) { /* ignore – name-based strategies can still work */ }

    // 2) Build candidate strategies: array of { type, name, filter }
    const mkId = (prop) => binRow?.Id ? { PropertyName: prop, Operator: 1, FilterValueArray: String(binRow.Id) } : null;
    const mkNm = (prop) => ({ PropertyName: prop, Operator: 1, FilterValueArray: binName });

    let strategies = [];
    if (forced) {
      // Force a single 'Type:PropertyName' strategy if provided
      const [t, p] = forced.split(":");
      const type = Number(t);
      const filter = (p.endsWith(".Id") && binRow?.Id) ? mkId(p) : mkNm(p);
      if (!type || !filter) return bad(res, "invalid strategy or bin has no Id", 400);
      strategies = [{ type, name: `${type}:${p}`, filter }];
    } else {
      // Try Lot/Serial first, then Inventory-by-Bin
      const candidateTypes = [
        { type: RT.LOT_SERIAL, props: ["LocationBinRef.Id", "BinRef.Id", "LocationBinId", "LocationBinRef.Name", "BinRef.Name"] },
        { type: RT.INV_BY_BIN, props: ["BinRef.Id", "BinRef.Name", "LocationBinRef.Name", "Bin"] },
      ];
      for (const ct of candidateTypes) {
        for (const p of ct.props) {
          const filter = p.endsWith(".Id") ? mkId(p) : mkNm(p);
          if (filter) strategies.push({ type: ct.type, name: `${ct.type}:${p}`, filter });
          else if (!p.endsWith(".Id")) strategies.push({ type: ct.type, name: `${ct.type}:${p}`, filter: mkNm(p) });
        }
      }
    }

    // 3) Try them, skipping any 400s OT throws for unknown props
    const pageSize = 500;
    let used = null, all = [], probeErrors = [];

    for (const s of strategies) {
      try {
        let page = 1, acc = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const chunk = await otList({
            Type: s.type,
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
          all  = acc;
          break;
        }
      } catch (err) {
        probeErrors.push({ strategy: s.name, error: String(err.message || err) });
      }
    }

    // 4) Map to UI shape (IMEI / SKU / Description / Location)
    const records = all.map(r => ({
      location:    r?.LocationBinRef?.Name || r?.BinRef?.Name || r?.Bin || binName,
      sku:         r?.ItemRef?.Code || r?.ItemCode || r?.SKU || "—",
      description: r?.ItemRef?.Name || r?.ItemName || r?.Description || "—",
      systemImei:  String(r?.LotOrSerialNo || r?.Serial || r?.SerialNo || r?.IMEI || r?.SerialNumber || ""),
    })).filter(x => x.systemImei);

    const payload = { records };
    if (debug) payload.debug = {
      usedStrategy: used || "none",
      binFound: !!binRow?.Id,
      tried: strategies.map(s => s.name),
      probeErrors,
      count: records.length,
    };
    return ok(res, payload);
  } catch (e) {
    return bad(res, String(e.message || e), 502);
  }
};
