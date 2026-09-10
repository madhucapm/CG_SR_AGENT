/**
 * Material Stock Handler
 * 
 * Fetches unrestricted stock and safety stock from S/4HANA APIs
 * to calculate dynamic material criticality.
 * 
 * APIs Used:
 * - API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod: For unrestricted stock (MatlWrhsStkQtyInMatlBaseUnit)
 * - API_PRODUCT_SRV/A_ProductSupplyPlanning: For safety stock from MRP Planning (SafetyStockQuantity)
 * 
 * Logic:
 * - If unrestrictedStock < safetyStock → Material is CRITICAL
 */

'use strict';

const { createLogger } = require('./utils');
const logger = createLogger('MaterialStockHandler');

const DESTINATION = { destinationName: 'S4R' };

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch material stock data from S/4HANA and calculate criticality
 * 
 * @param {Function} executeHttpRequest - SAP Cloud SDK HTTP client
 * @param {string} materialId - Material number (e.g., 'MAT001')
 * @param {string} plant - Plant code (e.g., 'MUMBAI')
 * @returns {Object} Stock data with criticality assessment
 */
async function getMaterialStockData(executeHttpRequest, materialId, plant) {
    
    if (!materialId || !plant) {
        logger.warn('Material ID or Plant is missing, cannot fetch stock data');
        return createEmptyResult(materialId, plant, 'Material ID or Plant is required');
    }

    // Normalize material and plant (remove leading zeros, trim)
    const normalizedMaterial = normalizeValue(materialId);
    const normalizedPlant = normalizeValue(plant);

    logger.info(`Fetching stock data for Material=${normalizedMaterial}, Plant=${normalizedPlant}`);

    // API 1: Get Unrestricted Stock from Material Stock API
    const STOCK_URL = `/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod?` +
        `$filter=${encodeURIComponent(`Material eq '${normalizedMaterial}' and Plant eq '${normalizedPlant}'`)}` +
        `&$select=Material,Plant,MatlWrhsStkQtyInMatlBaseUnit,MaterialBaseUnit` +
        `&$format=json`;

    // API 2: Get Safety Stock from Product Supply Planning API
    // Note: SafetyStockQuantity is in A_ProductSupplyPlanning, not A_ProductPlant
    const SAFETY_URL = `/sap/opu/odata/sap/API_PRODUCT_SRV/A_ProductSupplyPlanning?` +
        `$filter=${encodeURIComponent(`Product eq '${normalizedMaterial}' and Plant eq '${normalizedPlant}'`)}` +
        `&$select=Product,Plant,SafetyStockQuantity` +
        `&$format=json`;

    try {
        // Call both APIs in parallel for better performance
        const [stockResp, safetyResp] = await Promise.all([
            executeHttpRequest(DESTINATION, { method: 'GET', url: STOCK_URL, headers: { Accept: 'application/json' } })
                .catch(err => {
                    logger.warn(`Stock API call failed: ${err.message}`);
                    return { __failed: true, error: err };
                }),
            executeHttpRequest(DESTINATION, { method: 'GET', url: SAFETY_URL, headers: { Accept: 'application/json' } })
                .catch(err => {
                    logger.warn(`Safety Stock API call failed: ${err.message}`);
                    return { __failed: true, error: err };
                })
        ]);

        // Parse Unrestricted Stock
        let unrestrictedStock = 0;
        let unit = '';
        let stockApiSuccess = false;

        if (stockResp && !stockResp.__failed) {
            const stockData = stockResp.data || {};
            const stockResults = extractResults(stockData);
            
            if (stockResults.length > 0) {
                unrestrictedStock = stockResults.reduce((sum, item) => 
                    sum + (parseFloat(item.MatlWrhsStkQtyInMatlBaseUnit) || 0), 0);
                unit = stockResults[0]?.MaterialBaseUnit || '';
                stockApiSuccess = true;
                logger.info(`Stock API: Found ${stockResults.length} record(s), unrestrictedStock=${unrestrictedStock} ${unit}`);
            } else {
                logger.info(`Stock API: No records found for Material=${normalizedMaterial}, Plant=${normalizedPlant}`);
            }
        }

        // Parse Safety Stock from A_ProductSupplyPlanning
        let safetyStock = 0;
        let safetyApiSuccess = false;

        if (safetyResp && !safetyResp.__failed) {
            const safetyData = safetyResp.data || {};
            const safetyResults = extractResults(safetyData);
            
            if (safetyResults.length > 0) {
                // Use SafetyStockQuantity from A_ProductSupplyPlanning
                safetyStock = parseFloat(safetyResults[0].SafetyStockQuantity) || 0;
                safetyApiSuccess = true;
                logger.info(`Safety Stock API (A_ProductSupplyPlanning): safetyStock=${safetyStock}`);
            } else {
                logger.info(`Safety Stock API: No records found for Product=${normalizedMaterial}, Plant=${normalizedPlant}`);
            }
        }

        // Calculate Criticality
        const isCritical = safetyStock > 0 && unrestrictedStock < safetyStock;
        const computedCriticality = isCritical ? 'CRITICAL' : null;
        
        // Calculate stock coverage ratio
        let stockCoverageRatio = null;
        if (safetyStock > 0) {
            stockCoverageRatio = ((unrestrictedStock / safetyStock) * 100).toFixed(1);
        }

        // Build criticality reason
        let criticalityReason = null;
        if (isCritical) {
            criticalityReason = `Unrestricted stock (${unrestrictedStock.toFixed(2)}) is below safety stock (${safetyStock.toFixed(2)})`;
        }

        logger.info(`Stock Assessment: unrestricted=${unrestrictedStock}, safety=${safetyStock}, critical=${isCritical}, coverage=${stockCoverageRatio}%`);

        return {
            success: true,
            materialId: normalizedMaterial,
            plant: normalizedPlant,
            unrestrictedStock: roundTo(unrestrictedStock, 3),
            safetyStock: roundTo(safetyStock, 3),
            unit,
            isCritical,
            computedCriticality,
            stockCoverageRatio,
            criticalityReason,
            dataAvailability: {
                stockApi: stockApiSuccess,
                safetyStockApi: safetyApiSuccess
            },
            error: null
        };

    } catch (error) {
        logger.error(`Failed to fetch stock data: ${error.message}`);
        return createEmptyResult(materialId, plant, error.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract results from OData response (handles both v2 and v4 formats)
 */
function extractResults(data) {
    // OData v2: { d: { results: [...] } }
    if (data.d && Array.isArray(data.d.results)) {
        return data.d.results;
    }
    // OData v2 single entity: { d: {...} }
    if (data.d && !Array.isArray(data.d.results) && typeof data.d === 'object') {
        return [data.d];
    }
    // OData v4: { value: [...] }
    if (Array.isArray(data.value)) {
        return data.value;
    }
    return [];
}

/**
 * Normalize material/plant value (trim, uppercase)
 */
function normalizeValue(value) {
    if (!value) return '';
    return String(value).trim();
}

/**
 * Round to specified decimal places
 */
function roundTo(num, decimals) {
    if (typeof num !== 'number' || isNaN(num)) return 0;
    return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Create empty result structure for error cases
 */
function createEmptyResult(materialId, plant, errorMessage) {
    return {
        success: false,
        materialId: materialId || null,
        plant: plant || null,
        unrestrictedStock: null,
        safetyStock: null,
        unit: null,
        isCritical: false,
        computedCriticality: null,
        stockCoverageRatio: null,
        criticalityReason: null,
        dataAvailability: {
            stockApi: false,
            safetyStockApi: false
        },
        error: errorMessage
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH FETCH FUNCTION (for multi-PO scenarios)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch stock data for multiple material/plant combinations
 * 
 * @param {Function} executeHttpRequest - SAP Cloud SDK HTTP client
 * @param {Array} materialPlantPairs - Array of { materialId, plant } objects
 * @returns {Map} Map of "materialId_plant" -> stockData
 */
async function getMaterialStockDataBatch(executeHttpRequest, materialPlantPairs) {
    const results = new Map();
    
    if (!Array.isArray(materialPlantPairs) || materialPlantPairs.length === 0) {
        return results;
    }

    logger.info(`Fetching stock data for ${materialPlantPairs.length} material/plant combinations`);

    // Process in parallel with concurrency limit
    const BATCH_SIZE = 5;
    for (let i = 0; i < materialPlantPairs.length; i += BATCH_SIZE) {
        const batch = materialPlantPairs.slice(i, i + BATCH_SIZE);
        
        const batchResults = await Promise.all(
            batch.map(({ materialId, plant }) => 
                getMaterialStockData(executeHttpRequest, materialId, plant)
                    .then(data => ({ key: `${materialId}_${plant}`, data }))
                    .catch(err => ({ key: `${materialId}_${plant}`, data: createEmptyResult(materialId, plant, err.message) }))
            )
        );

        for (const { key, data } of batchResults) {
            results.set(key, data);
        }
    }

    logger.info(`Completed stock data fetch for ${results.size} combinations`);
    return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    getMaterialStockData,
    getMaterialStockDataBatch
};