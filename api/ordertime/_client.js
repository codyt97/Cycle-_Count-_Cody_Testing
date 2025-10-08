// api/ordertime/_client.js
const BASE = (process.env.OT_BASE_URL || 'https://services.ordertime.com/api')
  .replace(/\/+$/,''); // ensure no trailing slash

function mode() {
  const m = (process.env.OT_AUTH_MODE || 'PASSWORD').toUpperCase().trim();
  return m === 'API_KEY' ? 'API_KEY' : 'PASSWORD';
}

function sanitizeKey() {
  // strip accidental quotes/whitespace from copy/paste
  return (process.env.OT_API_KEY || '').replace(/^["']|["']$/g,'').trim();
}

function buildPayload({ type, filters = [], page = 1, pageSize = 50 }) {
  const m = mode();

  if (m === 'API_KEY') {
    const apiKey = sanitizeKey();
    if (!apiKey) throw new Error('OT_API_KEY is missing. Set OT_AUTH_MODE=API_KEY and OT_API_KEY.');
    const company = (process.env.OT_COMPANY || '').trim(); // some tenants require Company even with ApiKey
    return {
      ...(company ? { Company: company } : {}),
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

  console.log('[OT] POST /list', {
    url,
    Type: payload.Type,
    hasFilters: Array.isArray(payload.Filters) && payload.Filters.length > 0,
    PageNumber: payload.PageNumber,
    NumberOfRecords: payload.NumberOfRecords,
    mode: mode(),
    apiKeyLen: (payload.ApiKey || '').length || undefined,
    companySet: !!payload.Company,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const preview = await res.text().catch(() => '');
    console.error('[OT] /list response', { status: res.status, preview });
    throw new Error(`OT ${res.status} [/list] ${preview || 'Unknown error'}`);
  }
  return res.json(); // { Rows: [...] }
}

// Small helper used by other routes
async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 50 }) {
  const payload = buildPayload({
    type: Type,
    filters: Filters,
    page: PageNumber,
    pageSize: NumberOfRecords,
  });
  const data = await postList(payload);
  return Array.isArray(data?.Rows) ? data.Rows : [];
}

module.exports = { buildPayload, postList, otList };
