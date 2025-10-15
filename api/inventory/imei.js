// api/inventory/imei.js
/* eslint-disable no-console */
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");
const { appendRow } = require("../_lib/sheets");

const clean = (s) => String(s ?? "").trim();
const nowISO = () => new Date().toISOString();

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "GET") return method(res, ["GET","OPTIONS"]);
  withCORS(res);

  try {
    const imei = clean(req.query.imei);
    const scannedBin = clean(req.query.scannedBin || req.query.bin);
    const scannedBy = clean(req.query.scannedBy || req.query.user || "");

    if (!imei || !scannedBin) return bad(res, "imei and scannedBin are required", 400);

    let matched = false;

    // Upsert inside the scanned bin (serial -> qtyEntered = 1)
    await Store.upsertBin(scannedBin, (b) => {
      if (!b || !Array.isArray(b.items)) return b;
      const items = b.items.map((it) => {
        if (clean(it.systemImei) === imei) {
          matched = true;
          return {
            ...it,
            qtyEntered: 1,
            updatedAt: nowISO(),
            updatedBy: scannedBy || (b.counter || "—"),
          };
        }
        return it;
      });
      return { ...b, items, updatedAt: nowISO() };
    });

    // If not matched, find true bin so UI can show it
    let expectedBin = "";
    if (!matched) {
      const all = await Store.listBins();
      const hit = (all || []).find(x => (x.items || []).some(it => clean(it.systemImei) === imei));
      expectedBin = hit?.bin || "";
      try {
        if (process.env.LOGS_SHEET_ID) {
          await appendRow(process.env.LOGS_SHEET_ID, "WrongBin", [
            nowISO(), imei, scannedBin, expectedBin || "—", scannedBy || "—"
          ]);
        }
      } catch (e) { console.error("[imei] audit append fail:", e?.message || e); }
    }

    // Back-compat + normalized fields the UI expects
const found = !!expectedBin;
return ok(res, {
  ok: true,
  match: matched,
  imei,
  scannedBin,
  expectedBin,
  // New normalized fields:
  found,
  location: expectedBin || ""
});

  } catch (e) {
    console.error("[imei] fail:", e);
    return bad(res, e?.message || String(e), 500);
  }
};
