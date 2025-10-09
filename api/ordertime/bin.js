// /pages/api/ordertime/bin.js  (Next.js Pages API, CommonJS, Node runtime)
/* eslint-disable no-console */

const BASE_URL   = process.env.OT_BASE_URL || 'https://services.ordertime.com';
const AUTH_MODE  = (process.env.OT_AUTH_MODE || 'PASSWORD').toUpperCase(); // 'PASSWORD' | 'APIKEY'
const OT_USER    = process.env.OT_USERNAME || '';
const OT_PASS    = process.env.OT_PASSWORD || '';
const OT_COMPANY = process.env.OT_COMPANY  || '';
const OT_API_KEY = process.env.OT_API_KEY  || '';

// Build absolute URL
function otUrl(path) {
  const base = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
  return `${base}${path}`;
}

function sendError(res, code, message, upstream) {
  res.status(code).json({ error: `[BIN] ${code}`, message, ...(upstream ? { upstream } : {}) });
}

// Query LotOrSerialNo (1100) by bin name using PropertyName filters
function buildListBody(bin) {
  return {
    Type: 1100, // LotOrSerialNo
    hasFilters: true,
    // Use PropertyName / Operator / FilterValueArray — consistent with the rest of your OT calls
    Filters: [
      { PropertyName: 'LocationBinRef.Name', Operator: 1, FilterValueArray: [bin] } // 1 = Equals
    ],
    PageNumber: 1,
    NumberOfRecords: 500
  };
}


async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end('Method Not Allowed');
  }

  const bin = String(req.query.bin || '').trim();
  if (!bin) return sendError(res, 400, 'Missing bin name (?bin=...)');

  if (AUTH_MODE === 'PASSWORD') {
    if (!OT_USER || !OT_PASS || !OT_COMPANY) {
      return sendError(res, 500, 'Missing email/password/company for PASSWORD mode');
    }
  } else if (AUTH_MODE === 'APIKEY') {
    if (!OT_API_KEY) return sendError(res, 500, 'Missing OT_API_KEY for APIKEY mode');
  } else {
    return sendError(res, 500, `Unsupported OT_AUTH_MODE: ${AUTH_MODE}`);
  }

  // Build a *clean* header set so nothing global can sneak in
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');

  if (AUTH_MODE === 'PASSWORD') {
    // STRICT: do not send any apiKey-style header in PASSWORD mode
    headers.set('company', OT_COMPANY);
    headers.set('email', OT_USER);
    headers.set('password', OT_PASS);

    // Belt & suspenders: in case any middleware tried to add them
    headers.delete('apiKey');
    headers.delete('apikey');
    headers.delete('x-api-key');
    headers.delete('x-apikey');
  } else {
    // APIKEY mode: only apiKey
    headers.set('apiKey', OT_API_KEY);
  }

  // Debug: log only header names (no secrets)
  try {
    console.log('[BIN] AUTH_MODE:', AUTH_MODE, 'headers:', Array.from(headers.keys()));
  } catch (_) {}

  const url  = otUrl('/api/list');
  const body = JSON.stringify(buildListBody(bin));

  try {
    const resp = await fetch(url, { method: 'POST', headers, body });
    const text = await resp.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}

    if (!resp.ok) {
  console.error('[BIN] OT /list failed', resp.status, data || text);
  return sendError(res, 400, `OT /list failed (${resp.status})`, data || { raw: text });
}

// Normalize to the front-end shape: { records: [{ location, sku, description, systemImei }...] }
const rows = Array.isArray(data) ? data : [];
const records = rows.map(r => ({
  location:    r?.LocationBinRef?.Name || r?.LocationRef?.Name || '',
  sku:         r?.ItemRef?.Code || r?.ItemCode || '',
  description: r?.ItemRef?.Name || r?.ItemName || '',
  systemImei:  String(r?.LotOrSerialNo || r?.SerialNo || r?.Imei || '')
}));
return res.status(200).json({ records });


    return res.status(200).json(data || []);
  } catch (err) {
    console.error('[BIN] fatal', err);
    return sendError(res, 500, err.message);
  }
}

module.exports = handler;
