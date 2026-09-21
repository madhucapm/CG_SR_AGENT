/**
 * Affected SKU Handler
 * 
 * Performs reverse BOM lookup to find finished goods (SKUs) 
 * that use a given component material.
 * 
 * API: API_BILL_OF_MATERIAL_SRV
 * Entity Sets: 
 *   - A_BillOfMaterialItem (find BOMs containing the component)
 *   - A_BillOfMaterial (get header material / SKU)
 * 
 * Flow:
 *   1. Query A_BillOfMaterialItem where Material = affected component
 *   2. Extract unique BOM IDs
 *   3. Query A_BillOfMaterial to get header materials (SKUs)
 *   4. Return array of affected SKUs
 */

'use strict';

const { createLogger } = require('./utils');
const logger = createLogger('AffectedSkuHandler');

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const BOM_API_BASE = '/sap/opu/odata/sap/API_BILL_OF_MATERIAL_SRV';
const DESTINATION_NAME = 'S4R';

// Maximum number of BOMs to process (performance limit)
const MAX_BOMS_TO_PROCESS = 50;

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get affected SKUs by performing reverse BOM lookup
 * 
 * @param {Function} httpClient - SAP Cloud SDK executeHttpRequest function
 * @param {string} materialId - The affected component material ID
 * @param {string} [plant] - Optional plant filter
 * @returns {Object} Result with affectedSkus array and metadata
 */
async function getAffectedSkus(httpClient, materialId, plant = null) {
    logger.info(`Getting affected SKUs for material=${materialId}, plant=${plant || 'all'}`);
    
    const result = {
        success: false,
        affectedSkus: [],
        affectedSkuCount: 0,
        affectedComponentId: materialId,
        plant: plant,
        bomApiAvailable: false,
        error: null
    };
    
    if (!httpClient) {
        result.error = 'HTTP client not available';
        logger.error(result.error);
        return result;
    }
    
    if (!materialId) {
        result.error = 'Material ID is required';
        logger.error(result.error);
        return result;
    }
    
    try {
        // ═══════════════════════════════════════════════════════════════════════
        // STEP 1: Find BOMs containing this material as a component
        // ═══════════════════════════════════════════════════════════════════════
        const bomItemsResult = await fetchBomItemsForComponent(httpClient, materialId, plant);
        
        if (!bomItemsResult.success) {
            result.error = bomItemsResult.error;
            return result;
        }
        
        result.bomApiAvailable = true;
        
        const bomItems = bomItemsResult.items;
        logger.info(`Found ${bomItems.length} BOM item(s) containing material ${materialId}`);
        
        if (bomItems.length === 0) {
            // No BOMs found - material is not used in any BOM
            result.success = true;
            result.affectedSkuCount = 0;
            logger.info(`Material ${materialId} is not used in any BOM`);
            return result;
        }
        
        // Extract unique BOM IDs (with variant)
        const uniqueBomKeys = extractUniqueBomKeys(bomItems);
        logger.info(`Found ${uniqueBomKeys.length} unique BOM(s)`);
        
        // Limit to prevent performance issues
        const bomsToProcess = uniqueBomKeys.slice(0, MAX_BOMS_TO_PROCESS);
        if (uniqueBomKeys.length > MAX_BOMS_TO_PROCESS) {
            logger.warn(`Limiting BOM processing to ${MAX_BOMS_TO_PROCESS} (total found: ${uniqueBomKeys.length})`);
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // STEP 2: Get header materials (SKUs) for each BOM
        // ═══════════════════════════════════════════════════════════════════════
        const bomHeadersResult = await fetchBomHeaders(httpClient, bomsToProcess);
        
        if (!bomHeadersResult.success) {
            result.error = bomHeadersResult.error;
            result.success = false;
            return result;
        }
        
        const bomHeaders = bomHeadersResult.headers;
        logger.info(`Retrieved ${bomHeaders.length} BOM header(s)`);
        
        // ═══════════════════════════════════════════════════════════════════════
        // STEP 3: Build affected SKUs array
        // ═══════════════════════════════════════════════════════════════════════
        const affectedSkus = buildAffectedSkusArray(bomHeaders, bomItems, materialId);
        
        result.success = true;
        result.affectedSkus = affectedSkus;
        result.affectedSkuCount = affectedSkus.length;
        
        logger.info(`Affected SKU calculation complete: ${affectedSkus.length} SKU(s) affected`);
        
        return result;
        
    } catch (error) {
        const errorMsg = error?.message || String(error);
        logger.error(`Error getting affected SKUs: ${errorMsg}`);
        result.error = errorMsg;
        return result;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch BOM items where the given material is used as a component
 * 
 * @param {Function} httpClient - HTTP client function
 * @param {string} materialId - Component material ID
 * @param {string} [plant] - Optional plant filter
 * @returns {Object} Result with items array
 */
async function fetchBomItemsForComponent(httpClient, materialId, plant) {
    // Build filter - use BillOfMaterialComponent (the component material ID)
    // NOT "Material" which is a different field in A_BillOfMaterialItem
    // NOTE: Plant is NOT available on A_BillOfMaterialItem - it's on A_BillOfMaterial header only
    let filter = `BillOfMaterialComponent eq '${materialId}'`;
    // Plant filter removed - Plant field does not exist on A_BillOfMaterialItem
    
    // Build URL - NOTE: Plant removed from $select as it's not on this entity
    // BillOfMaterialItemQuantity is the correct field name (not BOMItemQuantity)
    const url = `${BOM_API_BASE}/A_BillOfMaterialItem` +
        `?$filter=${encodeURIComponent(filter)}` +
        `&$select=BillOfMaterial,BillOfMaterialVariant,BillOfMaterialComponent,BillOfMaterialItemQuantity` +
        `&$top=${MAX_BOMS_TO_PROCESS * 2}` + // Allow for multiple items per BOM
        `&$format=json`;
    
    logger.info(`Fetching BOM items: ${url}`);
    
    try {
        const response = await httpClient(
            { destinationName: DESTINATION_NAME },
            { method: 'GET', url: url, headers: { Accept: 'application/json' } }
        );
        
        const data = response?.data || {};
        
        // Handle OData v2 response format
        const items = (data.d && Array.isArray(data.d.results)) 
            ? data.d.results
            : (Array.isArray(data.value)) 
                ? data.value
                : (Array.isArray(data)) 
                    ? data 
                    : [];
        
        return {
            success: true,
            items: items,
            error: null
        };
        
    } catch (error) {
        const errorDetail = extractErrorDetail(error);
        logger.error(`Failed to fetch BOM items: ${errorDetail}`);
        return {
            success: false,
            items: [],
            error: `BOM Item API failed: ${errorDetail}`
        };
    }
}

/**
 * Fetch BOM headers to get the parent material (SKU)
 * 
 * @param {Function} httpClient - HTTP client function
 * @param {Array} bomKeys - Array of {bomId, variant} objects
 * @returns {Object} Result with headers array
 */
async function fetchBomHeaders(httpClient, bomKeys) {
    if (!bomKeys || bomKeys.length === 0) {
        return { success: true, headers: [], error: null };
    }
    
    // Build OR filter for all BOMs
    // Format: (BillOfMaterial eq 'X' and BillOfMaterialVariant eq 'Y') or ...
    const filterParts = bomKeys.map(key => 
        `(BillOfMaterial eq '${key.bomId}'${key.variant ? ` and BillOfMaterialVariant eq '${key.variant}'` : ''})`
    );
    const filter = filterParts.join(' or ');
    
    // Build URL
    const url = `${BOM_API_BASE}/A_BillOfMaterial` +
        `?$filter=${encodeURIComponent(filter)}` +
        `&$select=BillOfMaterial,BillOfMaterialVariant,Material,Plant` +
        `&$format=json`;
    
    logger.info(`Fetching BOM headers for ${bomKeys.length} BOM(s)`);
    
    try {
        const response = await httpClient(
            { destinationName: DESTINATION_NAME },
            { method: 'GET', url: url, headers: { Accept: 'application/json' } }
        );
        
        const data = response?.data || {};
        
        // Handle OData v2 response format
        const headers = (data.d && Array.isArray(data.d.results)) 
            ? data.d.results
            : (Array.isArray(data.value)) 
                ? data.value
                : (Array.isArray(data)) 
                    ? data 
                    : [];
        
        return {
            success: true,
            headers: headers,
            error: null
        };
        
    } catch (error) {
        const errorDetail = extractErrorDetail(error);
        logger.error(`Failed to fetch BOM headers: ${errorDetail}`);
        return {
            success: false,
            headers: [],
            error: `BOM Header API failed: ${errorDetail}`
        };
    }
}

/**
 * Extract unique BOM keys from BOM items
 * 
 * @param {Array} bomItems - Array of BOM item records
 * @returns {Array} Array of {bomId, variant} objects
 */
function extractUniqueBomKeys(bomItems) {
    const seen = new Set();
    const keys = [];
    
    for (const item of bomItems) {
        const bomId = item.BillOfMaterial;
        const variant = item.BillOfMaterialVariant || '';
        const key = `${bomId}|${variant}`;
        
        if (bomId && !seen.has(key)) {
            seen.add(key);
            keys.push({ bomId, variant });
        }
    }
    
    return keys;
}

/**
 * Build the affected SKUs array from BOM headers and items
 * 
 * @param {Array} bomHeaders - BOM header records
 * @param {Array} bomItems - BOM item records (for additional context)
 * @param {string} affectedComponentId - The original affected material
 * @returns {Array} Array of affected SKU objects
 */
function buildAffectedSkusArray(bomHeaders, bomItems, affectedComponentId) {
    const affectedSkus = [];
    
    // Create a lookup for BOM items to get quantity info
    const bomItemLookup = new Map();
    for (const item of bomItems) {
        const key = `${item.BillOfMaterial}|${item.BillOfMaterialVariant || ''}`;
        if (!bomItemLookup.has(key)) {
            bomItemLookup.set(key, []);
        }
        bomItemLookup.get(key).push(item);
    }
    
    // Build affected SKU entries from headers
    for (const header of bomHeaders) {
        const bomId = header.BillOfMaterial;
        const variant = header.BillOfMaterialVariant || '';
        const skuMaterialId = header.Material;
        const plant = header.Plant;
        
        if (!skuMaterialId) {
            logger.warn(`BOM ${bomId} has no header material, skipping`);
            continue;
        }
        
        // Get component quantity from items (if available)
        // Note: Field is BillOfMaterialComponent (not Material) in A_BillOfMaterialItem
        // Field name is BillOfMaterialItemQuantity (not BOMItemQuantity)
        const itemKey = `${bomId}|${variant}`;
        const items = bomItemLookup.get(itemKey) || [];
        const componentItem = items.find(i => i.BillOfMaterialComponent === affectedComponentId);
        const componentQuantity = componentItem?.BillOfMaterialItemQuantity || null;
        
        affectedSkus.push({
            skuMaterialId: skuMaterialId,
            bomId: bomId,
            bomVariant: variant || null,
            affectedComponentId: affectedComponentId,
            componentQuantityPerSku: componentQuantity,
            plant: plant || null
        });
    }
    
    // Sort by SKU material ID for consistent output
    affectedSkus.sort((a, b) => (a.skuMaterialId || '').localeCompare(b.skuMaterialId || ''));
    
    return affectedSkus;
}

/**
 * Extract detailed error message from various error formats
 * 
 * @param {Error|Object} error - Error object
 * @returns {string} Error message
 */
function extractErrorDetail(error) {
    if (!error) return 'Unknown error';
    
    // Try various error formats
    const detail =
        (error.rootCause && error.rootCause.message) ||
        (error.cause && error.cause.message) ||
        (error.response && error.response.data && (
            (error.response.data.error && 
                (error.response.data.error.message?.value || error.response.data.error.message)) ||
            (typeof error.response.data === 'string' 
                ? error.response.data 
                : JSON.stringify(error.response.data).substring(0, 200))
        )) ||
        error.message ||
        String(error);
    
    return detail;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    getAffectedSkus
};