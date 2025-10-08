// /api/ordertime/_client.js

const ORDERTIME_URL = 'https://services.ordertime.com/api/list';

/**
 * POST /api/list
 * mode: 'PASSWORD' | 'API_KEY'
 * opts: {
 *   email?: string,
 *   password?: string,
 *   apiKey?: string,
 *   body: object
 * }
 */
export async function postList(mode, opts) {
  const { email, password, apiKey, body } = opts ?? {};

  // Build headers depending on auth mode.
  /** @type {Record<string,string>} */
  const headers = { 'Content-Type': 'application/json' };

  if (mode === 'PASSWORD') {
    // IMPORTANT: do NOT include apiKey header in PASSWORD mode.
    if (!email || !password) {
      throw new Error('Missing email/password for PASSWORD mode');
    }
    headers.email = email;
    headers.password = password;
  } else if (mode === 'API_KEY') {
    if (!apiKey) throw new Error('Missing apiKey for API_KEY mode');
    headers.apiKey = apiKey;
  } else {
    throw new Error(`Unknown auth mode: ${mode}`);
  }

  // Call OrderTime
  const res = await fetch(ORDERTIME_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });

  // Helpful preview for logs
  let preview = '';
  try {
    preview = await res.clone().text();
  } catch {
    // ignore
  }

  if (!res.ok) {
    const code = res.status;
    throw Object.assign(
      new Error(`[OT] /list response error ${code}`),
      { code, preview }
    );
  }

  return res.json();
}
