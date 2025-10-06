// api/_lib/respond.js
function withCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function ok(res, data = {}, code = 200) {
  withCORS(res);
  res.status(code).json(data);
}

function bad(res, message = "Bad Request", code = 400) {
  withCORS(res);
  res.status(code).json({ error: message });
}

function method(res, methods = ["GET"]) {
  withCORS(res);
  res.setHeader("Allow", methods.join(","));
  return bad(res, `Method Not Allowed`, 405);
}

module.exports = { ok, bad, method, withCORS };
