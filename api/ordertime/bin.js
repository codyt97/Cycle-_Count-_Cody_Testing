// NEXT.JS PAGES API ROUTE (CommonJS)
// Path: /pages/api/ordertime/bin.js

/* eslint-disable no-console */

const BASE_URL = process.env.OT_BASE_URL || 'https://services.ordertime.com';
const AUTH_MODE = (process.env.OT_AUTH_MODE || 'PASSWORD').toUpperCase(); // 'PASSWORD' | 'APIKEY'
const OT_USERNAME = process.env.OT_USERNAME || '';
const OT_PASSWORD = process.env.OT_PASSWORD || '';
const OT_COMPANY  = process.env.OT_COMPANY  || '';
const OT_API_KEY  = process.env.OT_API_KEY  || ''; // only used if AUTH_MODE === 'APIKEY'

// ---- Helper: normalize base URL
function otUrl(path) {
  const base = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
  return `${base}${path}`;
}

// ---- Helper: standard error reply
function sendError(res, code, message, upstream) {
  res.status(code).json({
    error: `[BIN] ${code}`,
    message,
    ...(upstream ? { upstream } : {})
  });
}

// ---- Build auth headers for OrderTime
function buildAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };

  if (AUTH_MODE === 'PASSWORD') {
    // IMPORTANT: do NOT include apiKey in PASSWORD mode
    headers.company  = OT_COMPANY;
    headers.email    = OT_USERNAME;
    headers.password = OT_PASSWORD;
  } else if (AUTH_MODE === 'APIKEY') {
    // IMPORTANT: ONLY include apiKey in APIKEY mode
    headers.apiKey = OT_API_KEY;
  } else {
    throw new Error(`Unsupported OT_AUTH_MODE: ${AUTH_MODE}`);
  }

  return headers;
}

// ---- Build /api/list body to query Bin transactions (Type 1141)
function buildListBody(binName) {
  // Filter by BinRef.Name equals <binName>
  const filters = [
    {
      FieldName: 'BinRef.Name',
      Operator: 0,          // 0 = equals
      Value: binName
    }
  ];

  return {
    Type: 1141,            // Bin Transactions
    hasFilters: true,
    Filters: filters,
    PageNumber: 1,
    NumberOfRecords: 500,
    mode: AUTH_MODE,
    // Let the server infer based on headers; set explicitly to guide it
    hasApiKey: AUTH_MODE === 'APIKEY'
  };
}

// ---- Main handler
async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end('Method Not Allowed');
  }

  const bin = String(req.query.bin || '').trim();
  if (!bin) {
    return sendError(res, 400, 'Missing bin name (?bin=...)');
  }

  // Basic safety checks to avoid 500s due to missing envs
  try {
    if (AUTH_MODE === 'PASSWORD') {
      if (!OT_USERNAME || !OT_PASSWORD || !OT_COMPANY) {
        return sendError(res, 500, 'Missing email/password/company for PASSWORD mode');
      }
    } else if (AUTH_MODE === 'APIKEY') {
      if (!OT_API_KEY) {
        return sendError(res, 500, 'Missing OT_API_KEY for APIKEY mode');
      }
    }
  } catch (e) {
    return sendError(res, 500, e.message);
  }

  const url = otUrl('/api/list');
  const headers = buildAuthHeaders();
  const body = buildListBody(bin);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }

    if (!resp.ok) {
      // Bubble up OrderTime's message so you see the real cause
      const upstream = data || { raw: text };
      console.error('[BIN] OT /list failed', resp.status, upstream);
      return sendError(
        res,
        400,
        `OT /list failed (${resp.status})`,
        upstream
      );
    }

    // Success — should be an array of transactions
    return res.status(200).json(data || []);
  } catch (err) {
    console.error('[BIN] error', err);
    return sendError(res, 500, err.message);
  }
}

module.exports = handler;
