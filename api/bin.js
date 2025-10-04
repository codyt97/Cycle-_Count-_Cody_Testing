// /api/ordertime/bin.js (CommonJS)
const { otPost } = require("./_client");

module.exports = async (req, res) => {
  const { bin } = req.query || {};
  if (!bin) return res.status(400).json({ error: "Bin parameter is required" });

  try {
    const useInvStatus = String(process.env.OT_USE_INV_STATUS_BY_LOC || "false").toLowerCase() === "true";
    const pageSize = Math.min(parseInt(process.env.OT_LIST_PAGE_SIZE || "500", 10), 1000);

    if (useInvStatus) {
      // OPTIONAL path (items/qty by location). Not used for IMEIs; kept for completeness.
      // Type 1112: Inventory Status by Location
      const body = {
        Type: 1112,
        Filters: [
          { PropertyName: "LocationBinRef.Name", FilterValueArray: [bin] },
        ],
        PageNumber: 1,
        NumberOfRecords: pageSize,
      };
      const data = await otPost("/list", body);
      const items = (data?.Records || data?.records || []).map(r => ({
        location: r?.LocationBinRef?.Name || r?.BinRef?.Name || bin,
        sku: r?.ItemRef?.Name || r?.ItemCode || r?.Item?.Code || "—",
        description: r?.ItemName || r?.Description || "—",
        systemImei: "", // inventory status doesn’t include serials
      }));
      return res.status(200).json({ bin, records: items });
    }

    // Primary path: Type 1100 Lot or Serial Number → gives us serial (IMEI) + Bin
    const body = {
      Type: 1100,
      Filters: [
        // Match by Bin name exactly; adjust to starts-with by adding another filter with op if needed.
        { PropertyName: "BinRef.Name", FilterValueArray: [bin] },
      ],
      PageNumber: 1,
      NumberOfRecords: pageSize,
    };

    const data = await otPost("/list", body);

    const items = (data?.Records || data?.records || []).map(r => ({
      location: r?.BinRef?.Name || bin,
      sku: r?.ItemRef?.Name || r?.ItemCode || "—",
      description: r?.ItemName || r?.Description || "—",
      systemImei: String(r?.SerialNo || r?.LotNo || r?.Serial || ""),
    }));

    return res.status(200).json({ bin, records: items });
  } catch (err) {
    console.error("bin.js error:", err);
    return res.status(500).json({ error: "Failed to fetch bin snapshot from OrderTime" });
  }
};
mImei: String(r.imei || r.serial || r.systemImei || ""),
    }));

    return res.status(200).json({ bin, records: items });
  } catch (err) {
    console.error("bin.js error:", err);
    return res.status(500).json({ error: "Failed to fetch bin snapshot from OrderTime" });
  }
};
