const { ok, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

function toEST(s){
  const t = String(s ?? "").trim();
  if (!t || t === "—" || t.toLowerCase() === "invalid date") return "—";

  const d = new Date(t);
  if (isNaN(d.getTime())) return "—"; // never leak "Invalid Date" into UI

  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });
}



module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return withCORS(res), res.status(204).end();
  if (req.method !== "GET") return method(res, ["GET", "OPTIONS"]);

    const bins = await Store.listBins();

  const num = (v) => {
    // Redis often returns strings. Convert "2" -> 2 safely.
    if (v === null || v === undefined || v === "") return null;
    const n = Number(String(v).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  };

  const records = bins.map(b => {
  const items = Array.isArray(b.items) ? b.items : [];

  // total: prefer stored total; else fallback to items count
  const total = (num(b.total) != null) ? num(b.total) : items.length;

  // scanned: prefer stored scanned; else count rows that have a scanned imei OR qtyEntered > 0
  const computedScanned = items.filter(it => {
    const scannedImei = String(it.scannedImei ?? "").trim();
    const qtyEntered = Number(it.qtyEntered ?? 0);
    return !!scannedImei || qtyEntered > 0;
  }).length;

  const scanned = (num(b.scanned) != null) ? num(b.scanned) : computedScanned;

  // missing: prefer stored missing; else derive from missingImeis + nonSerialShortages
  const mi = Array.isArray(b.missingImeis) ? b.missingImeis.length : 0;
  const ns = Array.isArray(b.nonSerialShortages) ? b.nonSerialShortages.length : 0;
  const computedMissing = mi + ns;

  const missing = (num(b.missing) != null) ? num(b.missing) : computedMissing;

  return {
    bin: b.bin,
    counter: b.counter || "—",
    started: toEST(b.started || b.createdAt || "—"),
    updated: toEST(b.submittedAt || b.updatedAt || b.updated || b.submitted || "—"),
    total,
    scanned,
    missing,
    state: b.state || (missing > 0 ? "investigation" : "complete"),
  };
});



  return ok(res, { records });
};
