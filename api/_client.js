function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (process.env.OT_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OT_API_KEY}`;
  } else if (process.env.OT_EMAIL && process.env.OT_PASSWORD) {
    const b64 = Buffer.from(`${process.env.OT_EMAIL}:${process.env.OT_PASSWORD}`).toString("base64");
    headers.Authorization = `Basic ${b64}`;
  }
  return headers;
}

async function otFetch(pathWithQuery) {
  const base = (process.env.OT_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("OT_BASE_URL missing");
  const url = `${base}${pathWithQuery}`;
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`OrderTime ${res.status}: ${await res.text()}`);
  return res.json();
}

module.exports = { authHeaders, otFetch };
