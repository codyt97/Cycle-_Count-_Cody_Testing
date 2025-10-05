// /api/ordertime/list-probe.js  (CommonJS)
OT_BIN_PROP=BinRef.Name
const { otPostList } = require("./_client");

// Candidate record types seen across OT tenants for inventory detail / lot/serial/bin listings
const TYPE_CANDIDATES = [
  1100, 1101, // common Serial/Lot detail
  1200, 1201, // alt inv detail
  1300, 1400, 1500,
  2000, 2100, 2200,
  3000, 3100, 3200, 3300,
];

// Candidate bin properties used by different schemas
const BIN_PROPS = [
  "BinRef.Name",
  "LocationBinRef.Name",
  "Bin.Name",
  "LocationBin.Name",
  "Location.Name", // fallback if tenant stores at location level
];

module.exports = async (req, res) => {
  const bin = (req.query && req.query.bin || "").trim();
  if (!bin) return res.status(400).json({ error: "bin is required" });

  const limit = Number(process.env.OT_PROBE_LIMIT || 1); // fetch a single record per try

  const results = [];
  for (const Type of TYPE_CANDIDATES) {
    for (const prop of BIN_PROPS) {
      const body = {
        Type,
        Filters: [{ PropertyName: prop, FilterValueArray: [bin] }],
        PageNumber: 1,
        NumberOfRecords: limit,
      };
      const attempt = { Type, PropertyName: prop, ok: false, count: 0, note: "" };
      try {
        const data = await otPostList(body);
        const records = Array.isArray(data?.Records) ? data.Records : [];
        attempt.ok = true;
        attempt.count = records.length;
        // try to read field names we need later
        const r0 = records[0] || {};
        attempt.sample = {
          Bin: r0?.BinRef?.Name || r0?.LocationBinRef?.Name || r0?.Bin?.Name || r0?.LocationBin?.Name || null,
          ItemRef: r0?.ItemRef?.Name || r0?.ItemCode || null,
          ItemName: r0?.ItemName || r0?.Description || null,
          Serial: r0?.SerialNo || r0?.LotNo || r0?.Serial || null,
        };
      } catch (e) {
        attempt.note = String(e.message || e).slice(0, 300);
      }
      results.push(attempt);
    }
  }

  // rank useful hits first: ok with count>0, then ok with count=0, then errors
  results.sort((a,b)=>{
    if (a.ok && b.ok) return (b.count - a.count);
    if (a.ok && !b.ok) return -1;
    if (!a.ok && b.ok) return 1;
    return 0;
  });

  // best guess = first ok entry
  const best = results.find(r => r.ok) || null;
  res.status(200).json({ bin, best, results });
};
