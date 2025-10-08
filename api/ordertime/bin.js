// api/ordertime/bin.js
const { postList, buildPayload } = require('./_client');

const TYPE_INVENTORY_LEDGER = 1141;

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bin = (url.searchParams.get('bin') || '').trim();
    if (!bin) {
      res.statusCode = 400;
      res.setHeader('content-type','application/json');
      return res.end(JSON.stringify({ error: 'Missing ?bin=...' }));
    }

    console.log('[BIN] Querying 1141 by BinRef.Name=', bin);

    // Try BinRef.Name first; some tenants expose LocationBinRef.Name
    const filters = [
      { PropertyName: 'BinRef.Name', Operator: 1, FilterValueArray: [bin] },
    ];

    const data = await postList(buildPayload({
      type: TYPE_INVENTORY_LEDGER,
      filters,
      page: 1,
      pageSize: 500,
    }));

    const raw = Array.isArray(data?.Rows) ? data.Rows : [];

    const records = raw.map(r => ({
      location:    r?.BinRef?.Name || r?.LocationBinRef?.Name || r?.LocationRef?.Name || bin,
      sku:         r?.ItemRef?.Code || r?.ItemRef?.Name || r?.ItemCode || '—',
      description: r?.ItemRef?.Name || r?.Description || r?.ItemName || '—',
      systemImei:  String(r?.LotOrSerialNo || r?.Serial || r?.IMEI || ''),
    }));

    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ records }));
  } catch (err) {
    console.error('[BIN] error', err);
    res.statusCode = 502;
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
};
