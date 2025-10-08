// api/ordertime/bin.js
import { postList } from './_client';

export const config = { runtime: 'edge' }; // or remove if you use node runtime

export default async function handler(req) {
  try {
    const { q } = Object.fromEntries(new URL(req.url).searchParams); // e.g. ?q=B-04-03
    const binName = (q || '').trim();
    if (!binName) {
      return new Response(JSON.stringify({ error: 'Missing bin name (?q=...)' }), { status: 400 });
    }

    // Type 1141 = Inventory Lots/Serials (your working Postman case)
    const Type = 1141;

    // OT expects FilterOperator codes; 0 = Equals
    const Filters = [
      { FieldName: 'BinRef.Name', FilterOperator: 0, Value: binName }
    ];

    const data = await postList({
      mode: (process.env.OT_AUTH_MODE || 'PASSWORD').toUpperCase(), // 'PASSWORD' or 'API_KEY'
      Type,
      PageNumber: 1,
      NumberOfRecords: 500,
      filters: Filters
    });

    return new Response(JSON.stringify({ rows: data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err.message || err) }), { status: 502 });
  }
}
