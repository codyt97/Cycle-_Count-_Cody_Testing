const { buildPayload, postList } = require("./_client");

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bin = url.searchParams.get("bin");
    if (!bin) return res.status(400).json({ error: "Missing 'bin' query param" });

    // Type 1141 = Inventory Transactions (includes LotOrSerialNo + Bin)
    const payload = buildPayload({
      Type: 1141,
      Filters: [
        { PropertyName: "BinRef.Name", Operator: 1, FilterValueArray: [bin] },
      ],
      PageNumber: 1,
      NumberOfRecords: 50,
    });

    const ot = await postList(payload);

    // (Optional) normalize to the shape your UI expects
    res.status(200).json({ rows: ot || [] });
  } catch (err) {
    console.error("[BIN] error", err);
    // 502 keeps your frontend message consistent
    res.status(502).json({ error: String(err.message || err) });
  }
};
