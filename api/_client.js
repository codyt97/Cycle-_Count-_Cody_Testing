// /api/ordertime/_client.js (CommonJS)
function authHeaders() {
  // OrderTime REST expects JSON; API key works for most tenants.
  // If your tenant requires Basic, set OT_EMAIL/OT_PASSWORD.
  const headers = { "Content-Type": "application/json" };

  // Try API key first (most robust for REST)
  if (process.env.OT_API_KEY) {
    // Some OT installations accept Bearer, others expect a custom key header.
    // We send both safely.
    headers.Authorization = `Bearer ${process.env.OT_API_KEY}`;
    headers["X-Api-Key"] = process.env.OT_API_KEY;
  }

  // Optional fallback: Basic
  if (!process.env.OT_API_KEY && process.env.OT_EMAIL && process.env.OT_PASSWORD) {
    const b64 = Buffer.from(`${process.env.OT_EMAIL}:${process.env.OT_PASSWORD}`).toString("base64");
    headers.Authorization = `Basic ${b64}`;
  }

  return headers;
}

function baseUrl() {
  const base = (process.env.OT_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("OT_BASE_URL missing");
  return base;
}

async function otGet(path) {
  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`OrderTime ${res.status}: ${await res.text()}`);
  return res.json();
}

async function otPost(path, body) {
  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body || {}),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OrderTime ${res.status}: ${await res.text()}`);
  return res.json();
}

module.exports = { authHeaders, otGet, otPost };
