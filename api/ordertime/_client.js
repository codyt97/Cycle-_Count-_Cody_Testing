// api/ordertime/_client.js

// Node 18+ / Vercel: use the global fetch (no node-fetch import needed)

const BASE =
  (process.env.OT_BASE_URL || "https://services.ordertime.com/api").replace(
    /\/+$/,
    ""
  );

/**
 * Build the auth + list payload for OrderTime /api/list
 * Throws with a clear message if required env vars are missing.
 */
function buildPayload() {
  const mode = (process.env.OT_AUTH_MODE || "PASSWORD").toUpperCase();

  if (mode !== "PASSWORD") {
    throw new Error(`Unsupported OT_AUTH_MODE "${mode}". Use PASSWORD.`);
  }

  const company = process.env.OT_COMPANY;
  const username = process.env.OT_USERNAME;
  const password = process.env.OT_PASSWORD;

  if (!company || !username || !password) {
    throw new Error("Missing OT_COMPANY or OT_USERNAME or OT_PASSWORD.");
  }

  return {
    Company: company,
    Username: username,
    Password: password,
  };
}

/**
 * POST /api/list to OrderTime
 * @param {object} listBody - fields like Type, Filters, PageNumber, NumberOfRecords
 */
async function postList(listBody) {
  const auth = buildPayload();

  const url = `${BASE}/list`; // absolute URL
  const body = { ...auth, ...listBody };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // OrderTime does NOT want Bearer for PASSWORD mode; payload is in the body.
    },
    body: JSON.stringify(body),
  });

  // OrderTime sends 200 with body on success, 400 with { Message } on failure.
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    // Non-JSON edge cases: still bubble up
    throw new Error(`OT ${res.status} [${url}] Non-JSON response: ${text}`);
  }

  if (!res.ok) {
    const msg =
      (data && (data.Message || data.message)) ||
      `HTTP ${res.status} calling ${url}`;
    throw new Error(`OT ${res.status} [/list] ${msg}`);
  }

  return data;
}

module.exports = { postList };
