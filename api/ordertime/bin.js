// api/ordertime/bin.js
const { buildPayload, postList } = require('./_client');

// OrderTime "Inventory Ledger" type for the view you’re calling
const TYPE_INVENTORY_LEDGER = 1141;

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bin = (url.searchParams.get('bin') || '').trim();

    if (!bin) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Missing ?bin=...' }));
      return;
    }

    console.log('[BIN] Querying 1141 by BinRef.Name=', bin);

    const filters = [
      {
        PropertyName: 'BinRef.Name',
        Operator: 1, // equals
        FilterValueArray: [bin],
      },
    ];

    const payload = buildPayload({
      type: TYPE_INVENTORY_LEDGER,
      filters,
      page: 1,
      pageSize: 50,
    });

    const data = await postList(payload);

    // Return rows to the frontend
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ rows: Array.isArray(data?.Rows) ? data.Rows : [] }));
  } catch (err) {
    console.error('[BIN] error', err);
    res.statusCode = 502;
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
};
