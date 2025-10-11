// api/_lib/respond.js
function withCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Sync-Token");
}
function ok(res, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).end(JSON.stringify(body));
}
function bad(res, msg, code = 400) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(code).end(JSON.stringify({ error: msg }));
}
function method(res, allowed) {
  res.setHeader("Allow", allowed.join(", "));
  return bad(res, "Method Not Allowed", 405);
}
module.exports = { withCORS, ok, bad, method };
