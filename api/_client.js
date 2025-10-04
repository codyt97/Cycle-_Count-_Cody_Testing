// /api/ordertime/_client.js
function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (process.env.OT_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OT_API_KEY}`;
    headers["X-Api-Key"] = process.env.OT_API_KEY;
  } else if (process.env.OT_EMAIL && process.env.OT_PASSWORD) {
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

async function otPost(path, body) {
  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, { method: "POST", headers: authHeaders(), body: JSON.stringify(body || {}), cache: "no-store" });
  const text = await res.text();
  if (!res.ok) { console.error("OrderTime POST failed:", { url, status: res.status, text }); throw new Error(text || `HTTP ${res.status}`); }
  try { return JSON.parse(text); } catch { throw new Error(`Non-JSON from OT: ${text.slice(0,200)}`); }
}

module.exports = { otPost };
