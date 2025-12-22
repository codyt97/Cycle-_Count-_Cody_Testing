const Store = require("../_lib/store");

function norm(v){ return String(v ?? "").replace(/\D/g, ""); }

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end();
  }

  const { bin, imei } = req.body || {};
  if (!bin || !imei) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ ok:false }));
  }

  const record = await Store.getBin(bin);
  if (!record) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ ok:false }));
  }

  let matched = 0;

  for (const it of (record.items || [])) {
    if (norm(it.systemImei) === norm(imei)) {
      it.scannedImei = imei;
      matched++;
    }
  }

  record.scanned = (Number(record.scanned) || 0) + matched;
  record.missing = Math.max(0, (Number(record.total) || 0) - record.scanned);
  record.submittedAt = new Date().toISOString();
  record.state = record.missing > 0 ? "investigation" : "complete";

  await Store.upsertBin(record);

  res.end(JSON.stringify({ ok:true, scanned: record.scanned }));
};
