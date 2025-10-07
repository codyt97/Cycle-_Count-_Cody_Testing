// api/ordertime/bin.js
const { postList } = require('./_client');

module.exports = async (req, res) => {
  try {
    const bin = (req.query.bin || '').trim();
    if (!bin) return res.status(400).json({ error: 'Missing ?bin=' });

    // RecordType 1141 (Inventory ledger rows by bin)
    const body = {
      Type: 1141,
      Filters: [
        { PropertyName: 'BinRef.Name', Operator: 1, FilterValueArray: [bin] },
      ],
      PageNumber: 1,
      NumberOfRecords: 50,
    };

    const data = await postList(body);
    return res.status(200).json({ rows: data || [] });
  } catch (err) {
    console.error('[BIN] error', err);
    return res.status(502).json({ error: String(err.message || err) });
  }
};
