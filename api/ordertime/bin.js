// api/ordertime/bin.js
const { postList } = require("./_client");

// OT "types"
const TYPE_BINS = 151;   // Bin records
const TYPE_IL   = 1141;  // Inventory Ledger (lot/serial movements)

function ok(json) {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function fail(status, error) {
  return new Response(JSON.stringify({ error: String(error) }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

module.exports = async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const binName = (searchParams.get("bin") || "").trim();

    if (!binName) {
      return fail(400, "Missing ?bin= parameter");
    }

    console.info(`[BIN] Search for`, binName);

    // Step A: resolve bin name → bin Id (Type 151)
    const binRows = await postList({
      type: TYPE_BINS,
      page: 1,
      size: 1,
      filters: [
        { PropertyName: "Name", Operator: 1, FilterValueArray: [binName] } // equals
      ],
      select: ["Id", "Name", "LocationRef.Id", "LocationRef.Name"] // optional
    });

    if (!binRows.length) {
      console.info(`[BIN] no such bin`, binName);
      return ok({ page: 1, total: 0, rows: [] });
    }

    const binId = binRows[0].Id;
    console.info(`[BIN] Found bin`, binName, "→ Id", binId);

    // Step B: Pull Inventory Ledger by BinRef.Id (Type 1141)
    // This avoids the null-ref and works reliably vs BinRef.Name.
    const ilRows = await postList({
      type: TYPE_IL,
      page: 1,
      size: 500, // up to you
      filters: [
        { PropertyName: "BinRef.Id", Operator: 1, FilterValueArray: [String(binId)] }
      ],
      select: [
        "ItemRef.Name",
        "Description",
        "LotOrSerialNo",
        "LocationRef.Name",
        "BinRef.Name",
        "Quantity"
      ]
    });

    // Map to what your table expects
    const rows = ilRows.map(r => ({
      sku: r?.ItemRef?.Name || "",
      description: r?.Description || "",
      imei: r?.LotOrSerialNo || "",
      location: r?.LocationRef?.Name || "",
      bin: r?.BinRef?.Name || "",
      qty: r?.Quantity ?? 1
    }));

    console.info(`[BIN] page 1 → ${rows.length} rows`);
    return ok({ page: 1, total: rows.length, rows });
  } catch (err) {
    console.error("[BIN] error", err);
    // normalize to 502 for the UI message banner
    return fail(502, err.message || err);
  }
};
