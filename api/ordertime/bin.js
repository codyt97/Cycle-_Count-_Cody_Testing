// api/ordertime/bin.js
// Lists inventory lots filtered by BinRef.Name.
// Works with either ?bin= or ?q= in the query string.

const { buildPayload, postList } = require('./_client');

function pickBinParam(req) {
  try {
    // Vercel passes the full URL in req.url; use URL to parse query.
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const sp = url.searchParams;

    // Accept both keys to stay compatible with older UI calls.
    const val = sp.get('bin') ?? sp.get('q') ?? '';
    return (val || '').trim();
  } catch {
    return '';
  }
}

function error(res, status, msg) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: msg }));
}

module.exports.handler = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return error(res, 405, 'Method not allowed');
  }

  const binName = pickBinParam(req);

  if (!binName) {
    // Keep message consistent with what you saw in the UI logs.
    return error(res, 400, 'Missing bin name (?q=…)');
  }

  try {
    console.info('[BIN] Querying 1141 by BinRef.Name=', binName);

    // Build OT list payload
    const payload = buildPayload({
      type: 1141,          // Inventory Lots / Item Lots table
      page: 1,
      pageSize: 500,
      filters: [
        {
          Field: 'BinRef.Name',
          // Equality comparison; OT API expects the numeric enum for Equals.
          // (If your _client converts string names, that's fine too.)
          Comparison: 0,
          Values: [binName],
        },
      ],
    });

    // POST to OT /list
    const rows = await postList(payload);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(rows));
  } catch (err) {
    // Normalize error messages coming back from OrderTime
    const msg =
      (err && err.message) ||
      'Failed to query OrderTime /list';

    // If our client wrapped it like: "OT 400 [/list] {...}"
    const statusMatch = /OT\s+(\d{3})\s+\[\/list\]/.exec(msg);
    const status = statusMatch ? Number(statusMatch[1]) : 502;

    console.error('[BIN] error', err);
    error(res, status, status === 502 ? msg : `OT ${status} [/list] ${msg.replace(/^OT \d+ \[\/list\]\s*/,'')}`);
  }
};
