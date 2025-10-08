// api/ordertime/bin.js
const { otList } = require('./_client');

// Primary & fallback shapes
const T_INV_BY_BIN   = 1141;     // inventory-by-bin/ledger-like
const T_LOT_SERIAL   = 1100;     // LotOrSerialNo

async function listAll({ type, filters, pageSize = 500 }) {
  // Simple pagination loop; stops when fewer than pageSize rows are returned
  let page = 1;
  const out = [];
  while (true) {
    const rows = await otList({ Type: type, Filters: filters, PageNumber: page, NumberOfRecords: pageSize });
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    page += 1;
    if (page > 50) break; // hard-stop guardrail
  }
  return out;
}

function mapRows(rows, fallbackBin) {
  return rows
    .map(r => ({
      location:    r?.BinRef?.Name || r?.LocationBinRef?.Name || r?.LocationRef?.Name || fallbackBin || '',
      sku:         r?.ItemRef?.Code || r?.ItemCode || r?.ItemRef?.Name || '—',
      description: r?.ItemRef?.Name || r?.ItemName || r?.Description || '—',
      systemImei:  String(r?.LotOrSerialNo || r?.Serial || r?.IMEI || ''),
    }))
    .filter(x => !!x.systemImei); // keep only serial-tracked items
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bin = (url.searchParams.get('bin') || '').trim();
    const location = (url.searchParams.get('location') || '').trim(); // optional
    if (!bin) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: 'Missing ?bin=...' }));
    }

    // Common filters
    const filters1141 = [{ PropertyName: 'BinRef.Name', Operator: 1, FilterValueArray: [bin] }];
    if (location) filters1141.push({ PropertyName: 'LocationRef.Name', Operator: 1, FilterValueArray: [location] });

    // Try 1141 first
    let rows = await listAll({ type: T_INV_BY_BIN, filters: filters1141, pageSize: 500 });

    // If empty, try LotOrSerialNo(1100) with equivalent filter
    if (!rows.length) {
      const filters1100 = [{ PropertyName: 'LocationBinRef.Name', Operator: 1, FilterValueArray: [bin] }];
      if (location) filters1100.push({ PropertyName: 'LocationRef.Name', Operator: 1, FilterValueArray: [location] });
      rows = await listAll({ type: T_LOT_SERIAL, filters: filters1100, pageSize: 500 });
    }

    const records = mapRows(rows, bin);

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ records }));
  } catch (err) {
    console.error('[BIN] error', err);
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
};
