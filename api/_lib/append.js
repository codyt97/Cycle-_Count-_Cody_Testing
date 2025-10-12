// api/logs/append.js
/* eslint-disable no-console */
const { withCORS, ok, bad, method } = require("../_lib/respond");
const { appendRow } = require("../_lib/sheets");

// Map friendly types → tab names and quick validators
const TAB_BY_TYPE = {
  bins: "Bins",
  audits: "WrongBinAudits",
  notscanned: "NotScanned",
};

function norm(s) { return String(s ?? "").trim(); }

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "POST")    return method(res, ["POST","OPTIONS"]);
  withCORS(res);

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const type = norm(body.type || "").toLowerCase();
    const values = Array.isArray(body.values) ? body.values : null;

    if (!type || !TAB_BY_TYPE[type]) return bad(res, "invalid type (bins|audits|notscanned)", 400);
    if (!values || !Array.isArray(values)) return bad(res, "values must be an array", 400);

    const tabName = TAB_BY_TYPE[type];

    // Minimal shape checks (won’t block extra cells):
    // Bins expected header: Bin, Counter, Total, Scanned, Missing, StartedAt, SubmittedAt, State
    // Audits expected header: IMEI, ScannedBin, TrueLocation, ScannedBy, Status, CreatedAt, UpdatedAt
    // NotScanned expected header: Bin, Counter, SKU, Description, Type, QtySystem, QtyEntered

    const out = await appendRow(tabName, values);
    return ok(res, { ok: true, tab: tabName, ...out });
  } catch (e) {
    console.error("[logs/append] fail:", e);
    return bad(res, String(e.message || e), 500);
  }
};
