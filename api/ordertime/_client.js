// api/ordertime/_client.js
const OT_BASE_URL = process.env.OT_BASE_URL || 'https://services.ordertime.com';

function buildHeaders(mode) {
  const headers = { 'Content-Type': 'application/json' };

  // Company header is optional but harmless if present
  if (process.env.OT_COMPANY) headers.company = process.env.OT_COMPANY;

  if (mode === 'PASSWORD') {
    headers.email = process.env.OT_USERNAME;
    headers.password = process.env.OT_PASSWORD;
  } else if (mode === 'API_KEY') {
    headers.apiKey = process.env.OT_API_KEY;
  } else {
    throw new Error(`Unknown auth mode: ${mode}`);
  }
  return headers;
}

// Generic list poster
async function postList({ mode, Type, PageNumber = 1, NumberOfRecords = 500, filters = [] }) {
  const url = `${OT_BASE_URL}/api/list`;
  const hasFilters = Array.isArray(filters) && filters.length > 0;

  const body = {
    Type,
    PageNumber,
    NumberOfRecords,
    hasFilters,
    ...(hasFilters ? { Filters: filters } : {})
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(mode),
    body: JSON.stringify(body)
  });

  // small preview for logs without leaking secrets
  const previewText = await res.text();
  if (!res.ok) {
    throw new Error(`OT ${res.status} [/list] ${previewText}`);
  }
  try {
    return JSON.parse(previewText);
  } catch {
    // some OT endpoints return text for errors; success should be JSON
    return previewText;
  }
}

export { postList };
