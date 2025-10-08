// api/ordertime/bin.js
// CommonJS, Node runtime (no ESM/export), PASSWORD-only to avoid apiKey being sent by mistake.

const OT_BASE = process.env.OT_BASE_URL || 'https://services.ordertime.com';
const USERNAME = process.env.OT_USERNAME || '';
const PASSWORD = process.env.OT_PASSWORD || '';
const COMPANY  = process.env.OT_COMPANY || ''; // optional

function json(res, code, payload) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return text; }
}

module.exports = async (req, res) => {
  try {
    // Parse query (?bin=B-04-03)
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bin = (url.searchParams.get('bin') || '').trim();
    if (!bin) return json(res, 400, { error: 'Missing bin name (?bin=...)' });

    if (!USERNAME || !PASSWORD) {
      return json(res, 500, { error: 'Missing email/password for PASSWORD mode' });
    }

    // Build OT /api/list request
    const body = {
      Type: 1141,               // Inventory Lot/Serial ledger
      PageNumber: 1,
      NumberOfRecords: 500,
      hasFilters: true,
      mode: 'PASSWORD'          // <- force PASSWORD auth
      // NOTE: we are NOT adding the "filters" object here on purpose. We pull all and filter locally.
    };

    // PASSWORD headers (no apiKey ever)
    const headers = {
      'Content-Type': 'application/json',
      email: USERNAME,
      password: PASSWORD
    };
    if (COMPANY) headers.company = COMPANY;

    const upstream = await fetch(`${OT_BASE}/api/list`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      // Surface OT’s message for quick diagnosis
      return json(res, upstream.status, {
        error: `[BIN] ${upstream.status}`,
        message: 'OT /list failed',
        upstream: safeParse(text)
      });
    }

    // Expecting an array of ledger rows
    const rows = safeParse(text);
    if (!Array.isArray(rows)) {
      return json(res, 502, { error: 'Unexpected OT payload', upstream: rows });
    }

    // Filter by bin name (case-insensitive)
    const target = bin.toUpperCase();
    const filtered = rows.filter(r => (r?.BinRef?.Name || '').toUpperCase() === target);

    return json(res, 200, { bin, count: filtered.length, data: filtered });
  } catch (err) {
    return json(res, 500, { error: 'BIN function crashed', message: err.message });
  }
};
