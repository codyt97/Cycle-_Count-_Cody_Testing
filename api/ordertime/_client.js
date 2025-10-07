// api/ordertime/_client.js
// No node-fetch needed; Vercel's Node runtime has global fetch.
// Keep this file in CommonJS to avoid ESM import headaches on Vercel.

const BASE = process.env.OT_BASE_URL || 'https://services.ordertime.com/api';

function mode() {
  const m = (process.env.OT_AUTH_MODE || 'PASSWORD').toUpperCase().trim();
  return m === 'API_KEY' ? 'API_KEY' : 'PASSWORD';
}

function buildPayload({ type, filters = [], page = 1, pageSize = 50 }) {
  const m = mode();

  if (m === 'API_KEY') {
    const apiKey = (process.env.OT_API_KEY || '').trim();
    if (!apiKey) {
      throw new Error('OT_API_KEY is missing. Set OT_AUTH_MODE=API_KEY and OT_API_KEY in project env.');
    }
    return {
      ApiKey: apiKey,
      Type: type,
      Filters: filters,
      PageNumber: page,
      NumberOfRecords: pageSize,
    };
  }

  // PASSWORD mode
  const company = (process.env.OT_COMPANY || '').trim();
  const username = (process.env.OT_USERNAME || '').trim();
  const password = (process.env.OT_PASSWORD || '').trim();

  if (!company || !username || !password) {
    throw new Error('Missing OT_COMPANY or OT_USERNAME or OT_PASSWORD.');
  }

  return {
    Company: company,
    Username: username,
    Password: password,
    Type: type,
    Filters: filters,
    PageNumber: page,
    NumberOfRecords: pageSize,
  };
}

async function postList(payload) {
  const url = `${BASE}/list`;
  // For quick diagnosis
  console.log('[OT] POST /list', {
    url,
    Type: payload.Type,
    hasFilters: Array.isArray(payload.Filters) && payload.Filters.length > 0,
    PageNumber: payload.PageNumber,
    NumberOfRecords: payload.NumberOfRecords,
    mode: mode(),
    hasApiKey: !!process.env.OT_API_KEY && mode() === 'API_KEY',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const preview = await res.text().catch(() => '');
    console.error('[OT] /list response', { status: res.status, preview });
    // Normalize OrderTime error
    throw new Error(`OT ${res.status} [/list] ${preview || 'Unknown error'}`);
  }

  return res.json();
}

module.exports = {
  buildPayload,
  postList,
};
