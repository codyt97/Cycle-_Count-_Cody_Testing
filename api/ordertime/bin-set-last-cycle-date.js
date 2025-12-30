import { otFetch, postList } from './_client.js';

const BIN_RECORDTYPE = 151; // OrderTime RecordTypeEnum for Bin (used by /list)

function asDateOnlyISO(d = new Date()) {
  // OrderTime custom field type Date generally wants a date (not datetime).
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function findBinIdByName(binName) {
  const payload = {
    ListInfo: {
      Type: BIN_RECORDTYPE,
      IncludeCount: false,
      IncludeInactive: true,
      Filters: [
        {
          PropertyName: 'Name',
          Op: 0, // Equals (FilterOpEnum usually 0 = Equals in their API style)
          Value: binName,
        },
      ],
    },
  };

  const list = await postList(payload);

  const row = (list?.Items || list?.items || [])[0];
  const id = row?.Id || row?.id;
  return id || null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'POST only' });
    }

    const { bin, date } = req.body || {};
    if (!bin) return res.status(400).json({ ok: false, error: 'Missing bin' });

    const binId = await findBinIdByName(bin);
    if (!binId) return res.status(404).json({ ok: false, error: `Bin not found: ${bin}` });

    const dateValue = date || asDateOnlyISO(new Date());

    // Get the current bin object
    const current = await otFetch(`/locationbin?id=${encodeURIComponent(binId)}`, { method: 'GET' });

    // Normalize custom fields
    const cf = current.CustomFields || current.customFields || [];
    const nextCustomFields = Array.isArray(cf) ? [...cf] : [];

    const idx = nextCustomFields.findIndex(
      (x) => (x.Name || x.name) === 'BinCust1'
    );

    const newEntry = { Name: 'BinCust1', Value: dateValue };

    if (idx >= 0) nextCustomFields[idx] = { ...nextCustomFields[idx], ...newEntry };
    else nextCustomFields.push(newEntry);

    const updated = {
      ...current,
      CustomFields: nextCustomFields,
    };

    // PUT update back
    const putResp = await otFetch(`/locationbin`, {
      method: 'PUT',
      body: JSON.stringify(updated),
    });

    return res.status(200).json({ ok: true, bin, binId, dateValue, putResp });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}
