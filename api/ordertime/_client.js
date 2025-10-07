// api/ordertime/_client.js

const BASE =
  (process.env.OT_BASE_URL || "https://services.ordertime.com/api").replace(
    /\/+$/,
    ""
  );

function buildPayload() {
  const mode = (process.env.OT_AUTH_MODE || "PASSWORD").toUpperCase();

  if (mode !== "PASSWORD") {
    throw new Error(`Unsupported OT_AUTH_MODE "${mode}". Use PASSWORD.`);
  }

  const company = process.env.OT_COMPANY;
  const username = process.env.OT_USERNAME;
  const password = process.env.OT_PASSWORD;

  // --- NEW: safe debug ---
  console.log("[OT] buildPayload", {
    mode,
    hasCompany: !!company,
    hasUsername: !!username,
    hasPassword: !!password,
    base: BASE,
  });
  // -----------------------

  if (!company || !username || !password) {
    throw new Error("Missing OT_COMPANY or OT_USERNAME or OT_PASSWORD.");
  }

  return {
    Company: company,
    Username: username,
    Password: password,
  };
}

async function postList(listBody) {
  const auth = buildPayload();

  const url = `${BASE}/list`;
  const body = { ...auth, ...listBody };

  // --- NEW: safe debug of list parameters (not secrets) ---
  const { Type, Filters, PageNumber, NumberOfRecords } = listBody || {};
  console.log("[OT] POST /list", {
    url,
    Type,
    hasFilters: Array.isArray(Filters),
    PageNumber,
    NumberOfRecords,
  });
  // --------------------------------------------------------

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();

  // --- NEW: log status + short preview to catch server messages ---
  console.log("[OT] /list response", { status: res.status, preview: text?.slice?.(0, 120) });
  // ----------------------------------------------------------------

  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
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
