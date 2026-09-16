/**
 * Alternate Plant Source Handler
 *
 * Handler for the `getAlternatePlantSource` CAP function — one of the
 * data-fetch tools consumed by the Scenario & Recommendation Agent (SCN).
 *
 * Purpose:
 *   When a plant's supplier is disrupted, find another plant in the
 *   network that stocks the SAME material and recommend a stock transfer.
 *   Material is NOT substituted — only the source plant changes.
 *
 * S/4HANA APIs used:
 *   1. API_PURCHASEORDER_PROCESS_SRV / A_PurchaseOrderItem
 *        Computes real requiredQty from open (not-fully-delivered) POs.
 *   2. API_MATERIAL_STOCK_SRV / A_MatlStkInAcctMod
 *        Reads on-hand stock at each fallback plant.
 *
 * MVP constraints:
 *   - Fallback plant mapping is hard-coded in plant-fallback-map.js
 *   - No distance calculation (deferred)
 *   - Read-only — no PO creation, no stock movement
 */

'use strict';

const plantFallbackMap = require('./plant-fallback-map');
const fetchRequiredQty = require('./required-qty-handler');

function toNumber(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}


/**
 * Fetch on-hand stock at a single plant from API_MATERIAL_STOCK_SRV.
 * Sums MatlWrhsStkQtyInMatlBaseUnit across all storage locations.
 */
async function fetchStockAtPlant(material, plant, executeHttpRequest, logger) {
    const destination = { destinationName: 'S4R' };
    const opts = { method: 'GET', headers: { Accept: 'application/json' } };

    const url =
        `/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod` +
        `?$filter=${encodeURIComponent(
            `Material eq '${material}' and Plant eq '${plant}'`
        )}` +
        `&$select=Material,Plant,StorageLocation,` +
        `MatlWrhsStkQtyInMatlBaseUnit,MaterialBaseUnit` +
        `&$format=json`;

    logger.info(`[alt-plant] Fetching stock for material=${material} at plant=${plant}`);

    try {
        const resp = await executeHttpRequest(destination, { ...opts, url });
        const rows = resp?.data?.d?.results || resp?.data?.value || [];
        logger.info(`[alt-plant] Stock rows returned for plant ${plant}: ${rows.length}`);

        if (rows.length === 0) {
            return { availableStock: 0, stockUnit: null };
        }

        let totalStock = 0;
        let unit = null;
        for (const r of rows) {
            totalStock += toNumber(r.MatlWrhsStkQtyInMatlBaseUnit);
            if (!unit && r.MaterialBaseUnit) {
                unit = r.MaterialBaseUnit;
            }
        }

        logger.info(`[alt-plant] Total stock at ${plant}: ${totalStock} ${unit || '?'}`);
        return { availableStock: totalStock, stockUnit: unit };
    } catch (err) {
        logger.warn(`[alt-plant] Stock fetch failed for plant ${plant}: ${err?.message || err}`);
        return { availableStock: 0, stockUnit: null };
    }
}

/**
 * Build a plain-English recommendation sentence.
 */
function buildRecommendation(material, affectedPlant, requiredQty, requiredQtyUnit, poItemCount, sourcePlants) {
    if (sourcePlants.length === 0) {
        return `No fallback plants with available stock found for material ${material} from plant ${affectedPlant}.`;
    }

    const best = sourcePlants[0]; // already sorted by availableStock DESC
    const unitStr = requiredQtyUnit || best.stockUnit || 'EA';

    if (requiredQty === 0) {
        return `No open PO demand at plant ${affectedPlant} for material ${material}. ` +
            `Plant ${best.plant} has ${best.availableStock} ${best.stockUnit || unitStr} available if needed.`;
    }

    if (best.coversDemand) {
        return `Transfer ${requiredQty} ${unitStr} of material ${material} from plant ${best.plant} ` +
            `to plant ${affectedPlant} — ${best.plant} has ${best.availableStock} ${best.stockUnit || unitStr} in stock. ` +
            `Required quantity ${requiredQty} ${unitStr} computed from ${poItemCount} open PO items at ${affectedPlant}.`;
    }

    return `Plant ${best.plant} has ${best.availableStock} ${best.stockUnit || unitStr} of material ${material}, ` +
        `but ${requiredQty} ${unitStr} is needed at ${affectedPlant} (shortfall: ${best.shortfallQty} ${unitStr}). ` +
        `Required quantity ${requiredQty} ${unitStr} computed from ${poItemCount} open PO items at ${affectedPlant}.`;
}

/**
 * Main handler — wired to this.on('getAlternatePlantSource') in service.js.
 *
 * @param {Function} executeHttpRequest  - SAP Cloud SDK HTTP client
 * @param {Function} getCurrentTimestamp - Timestamp utility
 * @param {Object}   logger             - Logger instance
 * @param {Object}   req                - CAP request object
 */
async function handleGetAlternatePlantSource(executeHttpRequest, getCurrentTimestamp, logger, req) {
    logger.info('getAlternatePlantSource function called');

    const { affectedMaterial, affectedPlant } = req.data;
    const APIS = ['API_PURCHASEORDER_PROCESS_SRV', 'API_MATERIAL_STOCK_SRV'];

    // ── Step 1: Validate inputs ──────────────────────────────────────────
    if (!affectedMaterial || !affectedPlant) {
        return {
            success: false, toolName: 'get_alternate_plant_source',
            affectedMaterial: affectedMaterial || null,
            affectedPlant: affectedPlant || null,
            requiredQty: 0, requiredQtyUnit: null,
            requiredQtySource: 'OPEN_POS', requiredQtyBreakdown: [],
            sourcePlantCount: 0, sourcePlants: [],
            recommendation: null, sourcedFromApis: [],
            dataSource: 'S4R', calculatedAt: getCurrentTimestamp(),
            error: 'affectedMaterial and affectedPlant are required'
        };
    }

    if (!executeHttpRequest) {
        return {
            success: false, toolName: 'get_alternate_plant_source',
            affectedMaterial, affectedPlant,
            requiredQty: 0, requiredQtyUnit: null,
            requiredQtySource: 'OPEN_POS', requiredQtyBreakdown: [],
            sourcePlantCount: 0, sourcePlants: [],
            recommendation: null, sourcedFromApis: [],
            dataSource: 'S4R', calculatedAt: getCurrentTimestamp(),
            error: '@sap-cloud-sdk/http-client is not available on the server'
        };
    }


    try {
        // ── Step 2: Compute requiredQty from open POs ────────────────────
        const qtyResult = await fetchRequiredQty(
            executeHttpRequest, logger, affectedMaterial, affectedPlant
        );

        if (qtyResult.error) {
            return {
                success: false, toolName: 'get_alternate_plant_source',
                affectedMaterial, affectedPlant,
                requiredQty: 0, requiredQtyUnit: null,
                requiredQtySource: 'OPEN_POS', requiredQtyBreakdown: [],
                sourcePlantCount: 0, sourcePlants: [],
                recommendation: null, sourcedFromApis: APIS,
                dataSource: 'S4R', calculatedAt: getCurrentTimestamp(),
                error: qtyResult.error
            };
        }

        const { requiredQty, requiredQtyUnit, requiredQtyBreakdown } = qtyResult;

        // ── Step 3: Look up fallback plants ──────────────────────────────
        const fallbackPlants = plantFallbackMap[affectedPlant] || [];

        if (fallbackPlants.length === 0) {
            return {
                success: true, toolName: 'get_alternate_plant_source',
                affectedMaterial, affectedPlant,
                requiredQty, requiredQtyUnit,
                requiredQtySource: 'OPEN_POS', requiredQtyBreakdown,
                sourcePlantCount: 0, sourcePlants: [],
                recommendation: `No fallback plant mapping exists for plant ${affectedPlant}. ` +
                    `Add an entry to plant-fallback-map.js to enable inter-plant transfers.`,
                sourcedFromApis: APIS,
                dataSource: 'S4R', calculatedAt: getCurrentTimestamp(),
                error: null
            };
        }

        // ── Step 4: Fetch stock at each fallback plant (parallel) ────────
        const stockResults = await Promise.all(
            fallbackPlants.map(async (fbPlant) => {
                const stock = await fetchStockAtPlant(
                    affectedMaterial, fbPlant, executeHttpRequest, logger
                );
                return { plant: fbPlant, ...stock };
            })
        );


        // ── Step 5: Feasibility ──────────────────────────────────────────
        const sourcePlants = stockResults
            .filter(s => s.availableStock > 0)
            .map(s => ({
                plant: s.plant,
                availableStock: s.availableStock,
                stockUnit: s.stockUnit,
                coversDemand: s.availableStock >= requiredQty,
                shortfallQty: Math.max(0, requiredQty - s.availableStock)
            }));

        // ── Step 6: Sort DESC by stock, build recommendation ─────────────
        sourcePlants.sort((a, b) => b.availableStock - a.availableStock);

        const recommendation = buildRecommendation(
            affectedMaterial, affectedPlant,
            requiredQty, requiredQtyUnit,
            requiredQtyBreakdown.length, sourcePlants
        );

        return {
            success: true, toolName: 'get_alternate_plant_source',
            affectedMaterial, affectedPlant,
            requiredQty, requiredQtyUnit,
            requiredQtySource: 'OPEN_POS', requiredQtyBreakdown,
            sourcePlantCount: sourcePlants.length, sourcePlants,
            recommendation, sourcedFromApis: APIS,
            dataSource: 'S4R', calculatedAt: getCurrentTimestamp(),
            error: null
        };
    } catch (error) {
        const detail = error?.rootCause?.message || error?.cause?.message
            || error?.response?.data?.error?.message?.value
            || error?.message || String(error);
        logger.error(`getAlternatePlantSource error: ${detail}`);
        return {
            success: false, toolName: 'get_alternate_plant_source',
            affectedMaterial, affectedPlant,
            requiredQty: 0, requiredQtyUnit: null,
            requiredQtySource: 'OPEN_POS', requiredQtyBreakdown: [],
            sourcePlantCount: 0, sourcePlants: [],
            recommendation: null, sourcedFromApis: APIS,
            dataSource: 'S4R', calculatedAt: getCurrentTimestamp(),
            error: detail
        };
    }
}

module.exports = handleGetAlternatePlantSource;

