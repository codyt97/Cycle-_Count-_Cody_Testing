// /api/ordertime/_client.js

const BASE_URL = process.env.OT_BASE_URL?.trim() || 'https://services.ordertime.com';

function readEnv(name, fallbacks = []) {
  const val =
    process.env[name] ??
    fallbacks
      .map((n) => process.env[n])
      .find((v) => typeof v === 'string' && v.length > 0);
  return typeof val === 'string' ? val.trim() : undefined;
}

/**
 * Resolve auth config from env; supports multiple aliases so a typo
 * in the project settings doesn't break prod.
 */
function getAuthFromEnv() {
  const mode = readEnv('OT_AUTH_MODE', ['ORDERTIME_AUTH_MODE']) || 'API_KEY';

  // Accept several aliases for each field
  const apiKey = readEnv('OT_API_KEY', ['ORDERTIME_API_KEY', 'API_KEY']);
  const username = readEnv('OT_USERNAME', ['OT_EMAIL', 'ORDERTIME_USERNAME', 'ORDERTIME_EMAIL', 'EMAIL']);
  const password = readEnv('OT_PASSWORD', ['ORDERTIME_PASSWORD', 'PASSWORD']);
  const company = readEnv('OT_COMPANY', ['ORDERTIME_COMPANY', 'COMPANY']);

  return { mode: mode.toUpperCase(), apiKey, username, password, company };
}

function buildHeaders(auth) {
  const headers = { 'Content-Type': 'application/json' };

  // The OrderTime REST API is case-sensitive on these:
  // email, password, apiKey, company
  if (auth.apiKey) headers['apiKey'] = auth.apiKey;

  if (auth.mode === 'PASSWORD') {
    if (!auth.username || !auth.password) {
      const miss = !auth.username && !auth.password ? 'email & password' : !auth.username ? 'email' : 'password';
      const err = new Error(`Missing ${miss} for PASSWORD mode`);
      err.code = 500;
      throw err;
    }
    headers['email'] = auth.username;
    headers['password'] = auth.password;
  }

  if (auth.company) headers['company'] = auth.company;

  return headers;
}

/**
 * POST /api/list
 */
async function postList({ type, pageNumber = 1, numberOfRecords = 50, filters = undefined }) {
  const auth = getAuthFromEnv();
  const headers = buildHeaders(auth);

  const body = {
    Type: type,
    PageNumber: pageNumber,
    NumberOfRecords: numberOfRecords,
  };

  // Only add hasFilters/Filters when caller provided filters
  if (filters && Array.isArray(filters) && filters.length > 0) {
    body.hasFilters = true;
    body.Filters = filters;
  }

  // Always use lowercase path as in Postman that worked
  const url = `${BASE_URL}/api/list`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    // Edge/runtime safe
    // @ts-ignore
    cache: 'no-store',
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const preview = json ?? { preview: text?.slice(0, 200) };
    const err = new Error(json?.Message || `OT ${res.status} [/list]`);
    err.code = res.status;
    err.upstream = preview;
    throw err;
  }

  // /list returns an array
  return Array.isArray(json) ? json : [];
}

export { postList, getAuthFromEnv };
