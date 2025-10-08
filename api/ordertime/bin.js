// api/ordertime/bin.js
const { otList } = require('./_client');

// Primary & fallback shapes
const T_INV_BY_BIN    = 1141;     // inventory-by-bin/ledger-like
const T_LOT_SERIAL    = 1100;     // LotOrSerialNo
const T_PART_ITEM     = 'Part Item';
const T_ASSEMBLY_ITEM = 'Assembly Item';

const MAX_IN_FILTER   = 200;      // safety for "IN" filters

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

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
      // carry IDs/Codes forward for enrichment
      itemId:      r?.ItemRef?.Id ?? r?.ItemId ?? null,
      itemCode:    r?.ItemRef?.Code || r?.ItemCode || null,

      location:    r?.BinRef?.Name || r?.LocationBinRef?.Name || r?.LocationRef?.Name || fallbackBin || '',
      sku:         r?.ItemRef?.Code || r?.ItemCode || r?.ItemRef?.Name || '—',
      description: r?.ItemRef?.Name || r?.ItemName || r?.Description || '—',
      systemImei:  String(r?.LotOrSerialNo || r?.Serial || r?.IMEI || ''),
    }))
    .filter(x => !!x.systemImei);
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

        // Base records from 1141/1100
    const baseRecords = mapRows(rows, bin);
    // Enrich with canonical item names/descriptions
    const records = await enrichItems(baseRecords);

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ records }));

  } catch (err) {
    console.error('[BIN] error', err);
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
  async function fetchItemsById(ids) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return new Map();
  const chunks = chunk(unique, MAX_IN_FILTER);
  const map = new Map();

  // Try Part Item first
  for (const idsPart of chunks) {
    const rows = await otList({
      Type: T_PART_ITEM,
      Filters: [{ PropertyName: 'Id', Operator: 8, FilterValueArray: idsPart }], // 8 == IN
      PageNumber: 1,
      NumberOfRecords: 500
    });
    for (const r of (rows || [])) map.set(`id:${r?.Id}`, { code: r?.Code || r?.Name || '', name: r?.Name || r?.Description || '' });
  }

  // Fill gaps with Assembly Item
  const missing = unique.filter(id => !map.has(`id:${id}`));
  if (missing.length) {
    for (const idsAsm of chunk(missing, MAX_IN_FILTER)) {
      const rows = await otList({
        Type: T_ASSEMBLY_ITEM,
        Filters: [{ PropertyName: 'Id', Operator: 8, FilterValueArray: idsAsm }],
        PageNumber: 1,
        NumberOfRecords: 500
      });
      for (const r of (rows || [])) map.set(`id:${r?.Id}`, { code: r?.Code || r?.Name || '', name: r?.Name || r?.Description || '' });
    }
  }
  return map;
}

async function fetchItemsByCode(codes) {
  const unique = Array.from(new Set(codes.filter(Boolean)));
  if (!unique.length) return new Map();
  const map = new Map();

  for (const codesPart of chunk(unique, MAX_IN_FILTER)) {
    const rows = await otList({
      Type: T_PART_ITEM,
      Filters: [{ PropertyName: 'Code', Operator: 8, FilterValueArray: codesPart }],
      PageNumber: 1,
      NumberOfRecords: 500
    });
    for (const r of (rows || [])) map.set(`code:${(r?.Code || '').toUpperCase()}`, { code: r?.Code || r?.Name || '', name: r?.Name || r?.Description || '' });
  }

  const missing = unique.filter(c => !map.has(`code:${c.toUpperCase()}`));
  if (missing.length) {
    for (const codesAsm of chunk(missing, MAX_IN_FILTER)) {
      const rows = await otList({
        Type: T_ASSEMBLY_ITEM,
        Filters: [{ PropertyName: 'Code', Operator: 8, FilterValueArray: codesAsm }],
        PageNumber: 1,
        NumberOfRecords: 500
      });
      for (const r of (rows || [])) map.set(`code:${(r?.Code || '').toUpperCase()}`, { code: r?.Code || r?.Name || '', name: r?.Name || r?.Description || '' });
    }
  }
  return map;
}

async function enrichItems(records) {
  const ids = records.map(r => r.itemId).filter(Boolean);
  const codes = records.map(r => r.itemCode).filter(Boolean);

  const [byId, byCode] = await Promise.all([
    fetchItemsById(ids),
    fetchItemsByCode(codes)
  ]);

  return records.map(r => {
    const idHit = r.itemId ? byId.get(`id:${r.itemId}`) : null;
    const codeHit = r.itemCode ? byCode.get(`code:${r.itemCode.toUpperCase()}`) : null;
    const hit = idHit || codeHit;

    return {
      location: r.location,
      sku: hit?.code || r.sku || '—',
      description: hit?.name || r.description || '—',
      systemImei: r.systemImei
    };
  });
}

};
