const { withCORS, ok, bad, method } = require("../_lib/respond");
const { otList } = require("./_client");
const RT_INV_BY_BIN = 1141; // proven in your Postman

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET")      return method(res, ["GET", "OPTIONS"]);

  const binName = String(req.query.bin || "").trim();
  const debug   = String(req.query.debug || "0") === "1";
  if (!binName) return bad(res, "bin is required", 400);

  try {
    const pageSize = 500;
    let page = 1, all = [];
    const filter = { PropertyName: "BinRef.Name", Operator: 1, FilterValueArray: binName };

    console.log(`[BIN] Querying 1141 by BinRef.Name="${binName}"`);

    while (true) {
      const chunk = await otList({
        Type: RT_INV_BY_BIN,
        Filters: [filter],
        PageNumber: page,
        NumberOfRecords: pageSize,
      });
      console.log(`[BIN] page ${page} -> ${Array.isArray(chunk) ? chunk.length : 0} rows`);
      if (!Array.isArray(chunk) || chunk.length === 0) break;
      all.push(...chunk);
      if (chunk.length < pageSize) break;
      page++;
    }

    const records = all.map(r => ({
      location:    r?.BinRef?.Name || r?.LocationRef?.Name || binName,
      sku:         r?.ItemRef?.Name || r?.ItemRef?.Code || r?.ItemCode || "—",
      description: r?.Description || r?.ItemRef?.Name || "—",
      systemImei:  String(r?.LotOrSerialNo || r?.LotOrSerialRef?.Name || r?.SerialNumber || ""),
    })).filter(x => x.systemImei);

    const payload = { records };
    if (debug) payload.debug = { queriedType: RT_INV_BY_BIN, filter, rawCount: all.length, mappedCount: records.length };
    return ok(res, payload);
  } catch (e) {
    console.error("[BIN] error", e);
    return bad(res, String(e.message || e), 502);
  }
};
