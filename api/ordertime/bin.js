// /api/ordertime/bin.js
export const runtime = 'edge';

import { postList } from './_client';

/**
 * OrderTime "Inventory Lot Item" list type for Bin movements.
 * 1141 is what you were querying in Postman.
 */
const LIST_TYPE = 1141;

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const binName = (searchParams.get('bin') || '').trim();

    if (!binName) {
      return jsonResponse(400, { error: 'Missing bin name (?bin=...)' });
    }

    // Filters match what worked in Postman:
    // Filter on BinRef.Name = <binName>
    const filters = [
      {
        Field: 'BinRef.Name',
        Operator: 0, // 0 = equals
        Value: binName,
      },
    ];

    const rows = await postList({
      type: LIST_TYPE,
      pageNumber: 1,
      numberOfRecords: 500,
      filters,
    });

    return jsonResponse(200, { ok: true, rowsCount: rows.length, rows });
  } catch (err) {
    // Keep the message clear for you
