// api/_lib/respond.js
function withCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, payload) {
  withCORS(res);
  res.status(status).json(payload);
}

function ok(res, payload) {
  return json(res, 200, payload);
}

function bad(res, message, status = 400) {
  return json(res, status, { error: message });
}

function method(res, allowed) {
  res.setHeader("Allow", allowed.join(","));
  return bad(res, `Method Not Allowed. Use: ${allowed.join(",")}`, 405);
}

module.exports = { withCORS, ok, bad, method };
