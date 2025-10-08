// api/ordertime/bin.js  — CommonJS (Node) serverless function

const OT_BASE_URL = (process.env.OT_BASE_URL || 'https://services.ordertime.com').replace(/\/$/, '');
const AUTH_MODE   = (process.env.OT_AUTH_MODE || 'PASSWORD').toUpperCase(); // 'PASSWORD' | 'API_KEY'
const USERNAME    = process.env.OT_USERNAME || '';
const PASSWORD    = process.env.OT_PASSWORD || '';
const API_KEY     = process.env.OT_API_KEY  || '';
const COMPANY     = process.env.OT_COMPANY  || ''; // optional

async function callOrderTimeList(type, extraBody = {}, extraHeaders = {}) {
  const hasApiKey = AUTH_MODE === 'API_KEY';

  const body = {
    Type: type,
    PageNumber: 1,
    NumberOfRecords: 500,
    hasFilters: Boolean(extraBody.Filters?.length),
    mode: AUTH_MODE,      // IMPORTANT for OrderTime
    hasApiKey: hasApiKey, // mirrors the header auth we send
    ...extraBody,
  };

  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  if (hasApiKey) {
    headers.apiKey = API_KEY;
  } else {
    headers.email = USERNAME;
    headers.password = PASSWORD;
  }
  if (COMPANY) headers.company = COMPANY;

  const resp = await fetch(`${OT_BASE_URL}/api/list`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!resp.ok) {
    const err = new Error(`OT /list failed (${resp.status})`);
    err.status = resp.status;
    err.response = data;
    throw err;
  }
  return data;
}

module.exports = async (req, res) => {
  try {
    const bin = (req.query?.bin || req.query?.q || '').trim();
    if (!bin) {
      res.status(400).json({ error: 'Missing bin (use ?bin= or ?q=)' });
      return;
    }

    // OrderTime "Inventory Movements / Lots" list — Type 1141 (matches your Postman success)
    const upstream = await callOrderTimeList(1141);

    // OT sometimes returns the array directly; sometimes { data: [...] }
    const rows = Array.isArray(upstream) ? upstream : (upstream?.data || upstream?.rows || []);

    // Filter by BinRef.Name here (avoids guessing OT filter syntax)
    const items = rows.filter(r => (r?.BinRef?.Name || '').toUpperCase() === bin.toUpperCase());

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      bin,
      count: items.length,
      upstreamCount: rows.length,
      items,
    });
  } catch (err) {
    console.error('[BIN] error', { code: err.status || 500, message: err.message, upstream: err.response });
    res.status(err.status || 500).json({
      error: `[BIN] ${err.status || 500}`,
      message: err.message,
      upstream: err.response,
    });
  }
};
