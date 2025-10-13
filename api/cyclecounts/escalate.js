// api/cyclecounts/escalate.js
/* eslint-disable no-console */
const { ok, bad, cors, norm } = require("../_lib/sheets-utils");

// === CONFIG ===
const LOGS_POST_URL = "https://script.google.com/a/macros/connectuscorp.com/s/AKfycbzuY99ioTUZYYDtDJZY-fhj1eoRer0OUTMJ8JF13iJ5AAOqhmY-p90g3-e9xWw3epAM/exec";

module.exports = async (req, res) => {
  cors(res, "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return bad(res, "Method Not Allowed", 405);

  try {
    const body = req.body || {};
    const bin  = norm(body.bin);
    const user = norm(body.user);
    const notes= norm(body.notes || "");
    if (!bin) return bad(res, "bin is required");

    await fetch(LOGS_POST_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        user, action:"escalate",
        bin, sku:"", systemImei:"",
        moved:"", movedTo:"",
        notes,
        sessionId:"api"
      })
    });

    return ok(res, { ok:true });
  } catch (e) {
    console.error("[escalate]", e?.stack || e);
    return bad(res, "internal_error", 500);
  }
};
