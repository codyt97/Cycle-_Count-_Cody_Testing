// /api/ordertime/imei.js
const client = require("./_client.js");
const otPostList = client && client.otPostList;


module.exports = async (req, res) => {
  const { imei } = req.query || {};
  if (!imei) return res.status(400).json({ error: "IMEI parameter is required" });

  try {
    const filters = [
      { PropertyName: "SerialNo",       FilterValueArray: [String(imei)] },
      { PropertyName: "LotNo",          FilterValueArray: [String(imei)] },
      { PropertyName: "LotOrSerialNo",  FilterValueArray: [String(imei)] }, // some tenants expose this name
      { PropertyName: "Serial",         FilterValueArray: [String(imei)] }, // seen in alt schemas
   ];


let rec = null, lastErr = null;
for (const flt of filters) {
  try {
    const data = await otPostList({ Type: 1100, Filters: [flt], PageNumber: 1, NumberOfRecords: 5 });
    rec = (data?.Records || [])[0];
    if (rec) break;
  } catch (e) { lastErr = e; }
}
if (!rec && lastErr) throw lastErr;
if (!rec) rec = {};


    const info = {
  imei: String(imei),
  location:
    rec?.LocationBinRef?.Name ||
    rec?.BinRef?.Name ||
    rec?.LocationBin?.Name ||
    rec?.Bin?.Name ||
    rec?.Location?.Name ||
    null,
  sku: rec?.ItemRef?.Name || rec?.ItemCode || rec?.Item?.Code || "—",
  description: rec?.ItemName || rec?.Description || rec?.Item?.Name || "—",
};


    return res.status(200).json(info);
  } catch (err) {
    console.error("imei.js error:", err);
    return res.status(500).json({ error: "Failed to fetch IMEI location from OrderTime" });
  }
};
