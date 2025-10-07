// api/ordertime/_client.js
// Tiny fetch shim so it works on Vercel/Node
const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

const BASE = process.env.OT_BASE_URL || 'https://services.ordertime.com/api';

/**
 * Build auth fields to include in every /list request.
 * - APIKEY mode => { ApiKey }
 * - PASSWORD mode => { Company, Username, Password }
 */
function buildAuthFields() {
  const mode = (process.env.OT_AUTH_MODE || 'PASSWORD').toUpperCase();

  if (mode === 'APIKEY') {
    const apiKey = process.env.OT_API_KEY;
    if (!apiKey) throw new Error('OT_API_KEY not set');
    return { authMode: 'APIKEY', fields: { ApiKey: apiKey } };
  }

  // Default to PASSWORD mode
  const company = process.env.OT_COMPANY;
  const username = process.env.OT_USERNAME;
  const password = process.env.OT_PASSWORD;
  if (!company || !username || !password) {
    throw new Error('Missing OT_COMPANY or OT_USERNAME or OT_PASSWORD.');
  }
  return {
    authMode: 'PASSWORD',
    fields: { Company: company, Username: username, Password: password },
  };
}

/**
 * POST /list
 * body must include: { Type, Filters?, PageNumber, NumberOfRecords }
 */
async function postList(body) {
  const { authMode, fields } = buildAuthFields();

  // IMPORTANT: merge auth fields into the payload
  const payload = { ...fields, ...body };

  // Helpful logs without leaking secrets
  console.log('[OT] POST /list', {
    url: `${BASE}/list`,
    Type: body?.Type,
    hasFilters: Array.isArray(body?.Filters) && body.Filters.length > 0,
    PageNumber: body?.PageNumber,
    NumberOfRecords: body?.NumberOfRecords,
    hasApiKey: !!fields.ApiKey,
    hasCompany: !!fields.Company,
    mode: authMode,
  });

  const res = await fetch(`${BASE}/list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log('[OT] /list response', {
    status: res.status,
    preview: text.slice(0, 180),
  });

  if (!res.ok) throw new Error(`OT ${res.status} [/list] ${text}`);

  return text ? JSON.parse(text) : {};
}

module.exports = { postList };
