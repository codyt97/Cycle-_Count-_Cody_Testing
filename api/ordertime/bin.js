// /api/ordertime/bin.js

import { postList } from './_client';

// Force Node runtime (avoid Edge incompatibilities)
export const config = { runtime: 'nodejs' };

// Helper: uniform JSON response
function send(res, status, body) {
  res.status(status).json(body);
}

// Next.js API Route default export
export default async function handler(req, res) {
  try {
    // Only GET supported: /api/ordertime/bin?bin=B-04-03
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return send(res, 405, { error: 'Method not allowed' });
    }

    const bin = (req.query.bin || req.query.q || '').toString().trim();

    // Guard against missing/empty bin param (this produced a 400 in your UI)
    if (!bin) {
      return send(res, 400, { error: 'Missing bin name (?bin=...)' });
    }

    // Call OrderTime: Type 1141 (inventory lots / movements)
    const ot = await postList({
      Type: 1141,
      PageNumber: 1,
      NumberOfRecords: 500
      // NOTE: If you later need server-side filtering by Bin,
      // augment the /api/list body to include Filters for BinRef.Name.
      // For now we’re mirroring the successful Postman call you shared.
    });

    if (!ot.ok) {
      // Bubble up useful upstream details while keeping a 4xx/5xx boundary
      const status = ot.status === 400 ? 400 : 502;
      return send(res, status, {
        error: `OT ${ot.status} [/list]`,
        Message: ot.error || 'OrderTime request failed',
        upstream: ot.data ?? null
      });
    }

    // Optional: filter by bin on our side if payload contains Bin info.
    // Many 1141 rows include BinRef; if present we can narrow to that bin.
    let rows = Array.isArray(ot.data) ? ot.data : [];
    if (rows.length && rows[0] && typeof rows[0] === 'object' && 'BinRef' in rows[0]) {
      rows = rows.filter((r) => {
        const name = r?.BinRef?.Name;
        return typeof name === 'string' && name.trim().toLowerCase() === bin.toLowerCase();
      });
    }

    return send(res, 200, { bin, count: rows.length, rows });
  } catch (err) {
    // Never throw raw – always respond JSON so UI shows a clear message
    const message =
      err && typeof err.message === 'string'
        ? err.message
        : 'Unexpected server error';
    return send(res, 500, { error: 'BIN API 500', message });
  }
}
