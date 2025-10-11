// api/cyclecounts/submit.js
const { ok, bad, method, withCORS } = require("../_lib/respond");
const Store = require("../_lib/store");

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") { withCORS(res); return res.status(204).end(); }
  if (req.method !== "POST")    return method(res, ["POST","OPTIONS"]);
  withCORS(res);

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const bin = String(body.bin || "").trim();
    const counter = String(body.counter || "").trim() || "—";
    const scannedItems = Array.isArray(body.items) ? body.items : [];

    if (!bin) return bad(res, "bin is required", 400);

    // Snapshot rows for this bin
    const inv = await Store.getInventory();
    const expected = inv.filter(r => (String(r.location||"").trim().toLowerCase() === bin.toLowerCase()));

    // --- Split expected into serial and non-serial
    const expSerial = expected.filter(r => !!r.systemImei);
    const expNonSerial = expected.filter(r => !r.systemImei);

// Serial "expected set" by IMEI + lookup map for details
const expectedSerialSet = new Set(expSerial.map(x => String(x.systemImei || "").trim()).filter(Boolean));
const byImei = new Map(
  expSerial.map(r => [ String(r.systemImei || "").trim(), { sku: r.sku || "—", description: r.description || "—" } ])
);


   // Scanned serial IMEIs (MUST use scannedImei, not systemImei)
const scannedSerialSet = new Set(
  scannedItems
    .map(x => String(x.scannedImei || x.imei || "").trim())
    .filter(Boolean)
);


// Missing serial IMEIs (save with SKU/Description for UI & deletes)
const missingImeis = [...expectedSerialSet]
  .filter(imei => !scannedSerialSet.has(imei))
  .map(imei => {
    const meta = byImei.get(imei) || { sku: "—", description: "—" };
    return { sku: meta.sku, description: meta.description, systemImei: imei };
  });


    // --- Non-serial quantities
    // Build a map of systemQty per SKU (sum if multiple rows)
    const sysQtyBySku = new Map();
    for (const r of expNonSerial) {
      const sku = String(r.sku || "").trim() || "—";
      const q = Number.isFinite(r.systemQty) ? r.systemQty : 0;
      sysQtyBySku.set(sku, (sysQtyBySku.get(sku) || 0) + q);
    }

    // Pull qtyEntered for non-serials from scannedItems rows: { sku, qtyEntered }
    const enteredQtyBySku = new Map();
    for (const it of scannedItems) {
      if (!it || (it.systemImei || it.imei)) continue; // serial rows handled above
      const sku = String(it.sku || "").trim() || "—";
      const q = Number(it.qtyEntered || 0);
      if (q > 0) enteredQtyBySku.set(sku, (enteredQtyBySku.get(sku) || 0) + q);
    }

    // Compute shortages for non-serials
    const nonSerialShortages = [];
    let scannedNonSerialTotal = 0;
    for (const [sku, sysQty] of sysQtyBySku.entries()) {
      const entered = enteredQtyBySku.get(sku) || 0;
      scannedNonSerialTotal += Math.min(entered, sysQty);
      const short = Math.max(sysQty - entered, 0);
      if (short > 0) {
        const any = expNonSerial.find(r => (String(r.sku||"").trim() || "—") === sku);
        nonSerialShortages.push({
          bin,
          sku,
          description: any?.description || "—",
          systemQty: sysQty,
          qtyEntered: entered
        });
      }
    }

    // Totals
    const totalExpected = (
      expSerial.length + // each serial row = 1
      [...sysQtyBySku.values()].reduce((a,b)=>a+b,0)
    );

    const scannedTotal = (
      scannedSerialSet.size +
      scannedNonSerialTotal
    );

    const missingTotal = Math.max(totalExpected - scannedTotal, 0);

    const user = String(body.user || req.query?.user || req.headers["x-user"] || "anon").toLowerCase();
const payload = {
  user,                   // <-- tag the record with the user
  bin,
  counter,
  total: totalExpected,
  scanned: scannedTotal,
  missing: missingTotal,
  items: scannedItems,
  missingImeis,
  nonSerialShortages,
  state: missingTotal ? "investigation" : "complete",
  submittedAt: new Date().toISOString(),
};

