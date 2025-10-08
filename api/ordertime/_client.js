// api/ordertime/_client.js
const BASE =
  (process.env.OT_BASE_URL || "https://services.ordertime.com").replace(/\/+$/, "");
const AUTH_MODE = (process.env.OT_AUTH_MODE || "PASSWORD").toUpperCase();

const H = (o) =>
  Object.fromEntries(
    Object.entries(o).filter(([_, v]) => v !== undefined && v !== "")
  );

async function postList(payload, dbg = {}) {
  const url = `${BASE}/api/list`;

  // Build headers exactly like the working Postman request
  const headers =
    AUTH_MODE === "API_KEY"
      ? H({
          "Content-Type": "application/json",
          apiKey: process.env.OT_API_KEY, // required in API_KEY mode
        })
      : H({
          "Content-Type": "application/json",
          apiKey: process.env.OT_API_KEY, // harmless if present
          email: process.env.OT_USERNAME, // REQUIRED in PASSWORD mode
          password: process.env.OT_PASSWORD, // REQUIRED in PASSWORD mode
        });

  // In PASSWORD mode Postman included hasApiKey:false in the body.
  const body =
    AUTH_MODE === "API_KEY"
      ? { ...payload }
      : { hasApiKey: false, ...payload };

  // Tiny log helpers (console appears in Vercel logs)
  const tag = "[OT]";
  console.info(
    tag,
    "POST /list attempt",
    H({
      url,
      mode: AUTH_MODE,
      apiKeyLen: (process.env.OT_API_KEY || "").length || undefined,
      Type: body?.Type,
      PageNumber: body?.PageNumber,
      NumberOfRecords: body?.NumberOfRecords,
      hasFilters: !!body?.hasFilters,
    })
  );

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const preview = await res.text().catch(() => "");
    console.error(tag, "/list response", { status: res.status, preview });
    throw new Error(`OT ${res.status} [/list] ${preview || ""}`.trim());
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// Public helper you can import elsewhere
async function otList({ Type, Filters = [], PageNumber = 1, NumberOfRecords = 500 }) {
  const hasFilters = Array.isArray(Filters) && Filters.length > 0;

  return postList({
    Type,
    Filters,
    hasFilters,
    PageNumber,
    NumberOfRecords,
  });
}

module.exports = { otList };
