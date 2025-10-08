// /api/ordertime/bin.js
import { postList } from './_client';

// Grab required secrets from env (same ones you used in Postman)
const OT_EMAIL = process.env.ORDERTIME_EMAIL;
const OT_PASSWORD = process.env.ORDERTIME_PASSWORD;

/**
 * Vercel default export handler
 * GET /api/ordertime/bin?bin=B-04-03
 */
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bin = (url.searchParams.get('bin') || '').trim();

    if (!bin) {
      return res
        .status(400)
        .json({ error: 'Missing bin name (?bin=…)'}); // matches your UI
    }

    // Build the body exactly like your successful Postman call
    // Type 1141 (InventoryLots?) + filter by BinRef.Name
    const body = {
      Type: 1141,
      hasFilters: true,
      PageNumber: 1,
      NumberOfRecords: 500,
      mode: 'PASSWORD',
      // Minimal server-side filter by BinRef.Name
      Filters: [
        {
          FieldName: 'BinRef.Name',
          Operation: 0, // 0 = Equals
          Value: bin,
        },
      ],
    };

    // Call OrderTime in PASSWORD mode — no apiKey header at all.
    const data = await postList('PASSWORD', {
      email: OT_EMAIL,
      password: OT_PASSWORD,
      body,
    });

    // Return the raw payload. Your front-end will do its own mapping
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    // Normalize errors for your toast UI
    const code = err?.code || 500;
    const message =
      err?.preview ||
      err?.message ||
      'Unknown error calling OrderTime';

    // Helpful log line in Vercel
    console.error('[BIN] error', { code, message });

    // Bubble the upstream message to help you debug from the UI
    return res
      .status(code === 400 ? 400 : 500)
      .json({ error: `OT ${code === 400 ? 400 : 500} [/list]`, Message: message });
  }
}
