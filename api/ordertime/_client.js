// _client.js
const BASE = process.env.OT_BASE_URL || 'https://services.ordertime.com';
const AUTH_MODE = (process.env.OT_AUTH_MODE || 'PASSWORD').toUpperCase(); // 'PASSWORD' | 'API_KEY'

function buildAuthHeaders() {
  const h = { 'Content-Type': 'application/json' };

  if (AUTH_MODE === 'API_KEY') {
    if (!process.env.OT_API_KEY) throw new Error('Missing OT_API_KEY');
    h.apiKey = process.env.OT_API_KEY.trim();
    return h;
  }

  // PASSWORD mode
  if (!process.env.OT_USERNAME || !process.env.OT_PASSWORD) {
    throw new Error('Missing OT_USERNAME or OT_PASSWORD for PASSWORD mode');
  }
  h.email = process.env.OT_USERNAME.trim();
  h.password = process.env.OT_PASSWORD;
  // Do not add company; not required for REST /api/list
  // If you REALLY want to keep apiKey in PASSWORD mode, make sure it's valid:
  // if (process.env.OT_API_KEY) h.apiKey = process.env.OT_API_KEY.trim();
  return h;
}

export async function postList(payload) {
  const url = `${BASE}/api/list`;
  const headers = buildAuthHeaders();

  const body = {
    Type: payload?.Type ?? 1141,
    hasFilters: payload?.hasFilters ?? true,
    PageNumber: payload?.PageNumber ?? 1,
    NumberOfRecords: payload?.NumberOfRecords ?? 500,
    mode: AUTH_MODE, // 'PASSWORD' or 'API_KEY'
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const preview = await res.text();
  if (!res.ok) {
    throw new Error(`OT ${res.status} [/list] ${preview}`);
  }
  return JSON.parse(preview);
}
