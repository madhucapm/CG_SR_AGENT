/**
 * Required Quantity Handler
 *
 * Helper module for getAlternatePlantSource.
 * Computes the total outstanding quantity from open (not-fully-delivered)
 * Purchase Order items for a given (material, plant) via S/4HANA.
 *
 * S/4HANA API used:
 *   API_PURCHASEORDER_PROCESS_SRV / A_PurchaseOrderItem
 *   Filters: Material, Plant, IsCompletelyDelivered eq false
 */

'use strict';

function toNumber(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Fetch open PO items and compute required quantity.
 *
 * @param {Function} executeHttpRequest - SAP Cloud SDK HTTP client
 * @param {Object}   logger            - Logger instance
 * @param {string}   material          - Material number (e.g. '1122')
 * @param {string}   plant             - Plant code     (e.g. 'DE01')
 * @returns {Object} { requiredQty, requiredQtyUnit, requiredQtyBreakdown, error }
 */
async function fetchRequiredQty(executeHttpRequest, logger, material, plant) {
    const destination = { destinationName: 'S4R' };
    const opts = { method: 'GET', headers: { Accept: 'application/json' } };

    const url =
        `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem` +
        `?$filter=${encodeURIComponent(
            `Material eq '${material}' and Plant eq '${plant}' and IsCompletelyDelivered eq false`
        )}` +
        `&$select=PurchaseOrder,PurchaseOrderItem,Material,Plant,` +
        `OrderQuantity,PurchaseOrderQuantityUnit,IsCompletelyDelivered` +
        `&$format=json`;

    logger.info(`[required-qty] Fetching open PO items for material=${material}, plant=${plant}`);

    try {
        const resp = await executeHttpRequest(destination, { ...opts, url });
        const rows = resp?.data?.d?.results || resp?.data?.value || [];
        logger.info(`[required-qty] Open PO item rows returned: ${rows.length}`);

        if (rows.length === 0) {
            return {
                requiredQty: 0,
                requiredQtyUnit: null,
                requiredQtyBreakdown: [],
                error: null
            };
        }

        let totalQty = 0;
        let unit = null;
        const breakdown = [];

        for (const r of rows) {
            const qty = toNumber(r.OrderQuantity);
            totalQty += qty;
            if (!unit && r.PurchaseOrderQuantityUnit) {
                unit = r.PurchaseOrderQuantityUnit;
            }
            breakdown.push({
                poNumber: r.PurchaseOrder || null,
                poItem: r.PurchaseOrderItem || null,
                outstandingQty: qty,
                unit: r.PurchaseOrderQuantityUnit || null
            });
        }

        logger.info(`[required-qty] Total required: ${totalQty} ${unit || '?'} from ${rows.length} open PO items`);

        return {
            requiredQty: totalQty,
            requiredQtyUnit: unit,
            requiredQtyBreakdown: breakdown,
            error: null
        };
    } catch (err) {
        const detail = err?.rootCause?.message || err?.cause?.message
            || err?.response?.data?.error?.message?.value
            || err?.message || String(err);
        logger.error(`[required-qty] Failed: ${detail}`);
        return {
            requiredQty: 0,
            requiredQtyUnit: null,
            requiredQtyBreakdown: [],
            error: detail
        };
    }
}

module.exports = fetchRequiredQty;
