// /api/ordertime/_client.js

const ORDERTIME_BASE = 'https://services.ordertime.com';

/**
 * Post to OrderTime /api/list in PASSWORD mode.
 * Mirrors the successful Postman call you shared:
 *   headers: email, password, (optional) apiKey
 *   body: { Type, PageNumber, NumberOfRecords, mode: 'PASSWORD', hasApiKey: false }
 *
 * @param {object} opts
 * @param {number} opts.Type
 * @param {number} [opts.PageNumber=1]
 * @param {number} [opts.NumberOfRecords=500]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ ok: boolean, status: number, data?: any, error?: string }>}
 */
export async function postList({
  Type,
  PageNumber = 1,
  NumberOfRecords = 500,
  signal
}) {
  const email = process.env.ORDERTIME_EMAIL || '';
  const password = process.env.ORDERTIME_PASSWORD || '';
  const apiKey = process.env.ORDERTIME_API_KEY || '';

  const headers = {
    'Content-Type': 'application/json',
    email,
    password
  };

  // Postman worked even with apiKey present in headers, but your latest
  // successful request showed `hasApiKey: false`. We'll still send apiKey
  // if available since the server ignores it when hasApiKey=false.
  if (apiKey) headers.apiKey = apiKey;

  const body = {
    Type,
    PageNumber,
    NumberOfRecords,
    // Critical bits that matched your good Postman call:
    mode: 'PASSWORD',
    hasApiKey: false
  };

  const url = `${ORDERTIME_BASE}/api/list`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });

  let payload;
  try {
    // OrderTime tends to always return JSON
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    // Surface their message if present
    const msg =
      payload && typeof payload.Message === 'string'
        ? payload.Message
        : `Upstream error (${res.status})`;
    return { ok: false, status: res.status, error: msg, data: payload };
  }

  return { ok: true, status: res.status, data: payload };
}
