function authHeaders() {
  // OrderTime requires apiKey + email headers (optionally devKey)
  // https://help.ordertime.com/help/order-time-rest-api
  const headers = { "Content-Type": "application/json" };

  if (!process.env.OT_API_KEY || !process.env.OT_EMAIL) {
    throw new Error("Missing OT_API_KEY or OT_EMAIL env vars");
  }

  headers["apiKey"] = process.env.OT_API_KEY;   // required
  headers["email"]  = process.env.OT_EMAIL;     // required

  // Optional: if your tenant issued a DevKey, include it
  if (process.env.OT_DEVKEY) headers["devKey"] = process.env.OT_DEVKEY;

  // Keep these *only* if your gateway also accepts them (harmless otherwise)
  // headers.Authorization = `Bearer ${process.env.OT_API_KEY}`;
  // headers["X-Api-Key"]   = process.env.OT_API_KEY;

  return headers;
}
