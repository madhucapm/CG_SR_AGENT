/**
 * Get Supplier Details Handler
 * 
 * Handler for GET_SupplierDetails CAP function.
 * Fetches all Purchase Orders for a given supplier from S/4HANA
 * (API_PURCHASEORDER_PROCESS_SRV) and then fetches the line items
 * for each PO via the to_PurchaseOrderItem navigation property.
 * 
 * Additionally fetches material descriptions from API_PRODUCT_SRV.
 * 
 * Steps:
 * 1. Fetch POs filtered by Supplier from A_PurchaseOrder
 * 2. For each PO, fetch items from A_PurchaseOrder('<PO>')/to_PurchaseOrderItem
 * 3. Collect unique material IDs and fetch descriptions from API_PRODUCT_SRV
 * 4. Map PurchaseOrderItem → ItemNo, Material → Material & SKU, Plant → Plant,
 *    MaterialDescription → ProductDescription
 */

'use strict';

/**
 * Main handler function - bound to service context
 * @param {Function} executeHttpRequest - SAP Cloud SDK HTTP client
 * @param {Object} logger - Logger instance
 * @param {Object} req - CAP request object
 */
async function handleGetSupplierDetails(executeHttpRequest, logger, req) {
    logger.info('GET_SupplierDetails function called');

    const { supplier } = req.data;

    // Validate input
    if (!supplier) {
        req.reject(400, 'supplier is required');
        return;
    }

    if (!executeHttpRequest) {
        req.reject(500, '@sap-cloud-sdk/http-client is not available on the server');
        return;
    }

    const destination = { destinationName: 'S4R' };
    const opts = { method: 'GET', headers: { Accept: 'application/json' } };

    try {
        // ─────────────────────────────────────────────────────────────────────
        // STEP 1: Fetch Purchase Orders for the supplier
        // ─────────────────────────────────────────────────────────────────────
        const poListUrl =
            `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder` +
            `?$filter=Supplier eq '${encodeURIComponent(supplier)}'` +
            `&$select=PurchaseOrder` +
            `&$format=json`;

        logger.info(`Fetching POs for supplier ${supplier}`);
        const poListResp = await executeHttpRequest(destination, { ...opts, url: poListUrl });

        const poListData = poListResp?.data?.d?.results
            || poListResp?.data?.value
            || [];

        if (poListData.length === 0) {
            logger.info(`No POs found for supplier ${supplier}`);
            return { Supplier: supplier, PO: [] };
        }

        const poNumbers = poListData.map(po => po.PurchaseOrder);
        logger.info(`Found ${poNumbers.length} PO(s) for supplier ${supplier}. Fetching items...`);

        // ─────────────────────────────────────────────────────────────────────
        // STEP 2: For each PO, fetch items via to_PurchaseOrderItem
        // Process in batches of 10 to avoid overloading the backend
        // ─────────────────────────────────────────────────────────────────────
        const BATCH_SIZE = 10;
        const poItemsRaw = [];

        for (let i = 0; i < poNumbers.length; i += BATCH_SIZE) {
            const batch = poNumbers.slice(i, i + BATCH_SIZE);

            const batchPromises = batch.map(async (poNumber) => {
                try {
                    const itemsUrl =
                        `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder('${encodeURIComponent(poNumber)}')/to_PurchaseOrderItem` +
                        `?$select=PurchaseOrderItem,Material,Plant` +
                        `&$format=json`;

                    const itemsResp = await executeHttpRequest(destination, { ...opts, url: itemsUrl });

                    const itemsData = itemsResp?.data?.d?.results
                        || itemsResp?.data?.value
                        || [];

                    return { Number: poNumber, items: itemsData };
                } catch (itemErr) {
                    logger.warn(`Failed to fetch items for PO ${poNumber}: ${itemErr?.message || itemErr}`);
                    return { Number: poNumber, items: [] };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            poItemsRaw.push(...batchResults);
        }

        // ─────────────────────────────────────────────────────────────────────
        // STEP 3: Collect unique material IDs and fetch descriptions from
        // API_PRODUCT_SRV/A_ProductDescription(Product='<id>',Language='EN')
        // ─────────────────────────────────────────────────────────────────────
        const uniqueMaterials = new Set();
        poItemsRaw.forEach(po => {
            po.items.forEach(item => {
                const mat = item.Material || '';
                if (mat) uniqueMaterials.add(mat);
            });
        });

        const materialDescMap = {};
        const materialIds = Array.from(uniqueMaterials);

        if (materialIds.length > 0) {
            logger.info(`Fetching descriptions for ${materialIds.length} unique material(s)...`);

            for (let i = 0; i < materialIds.length; i += BATCH_SIZE) {
                const descBatch = materialIds.slice(i, i + BATCH_SIZE);

                const descPromises = descBatch.map(async (materialId) => {
                    try {
                        const descUrl =
                            `/sap/opu/odata/sap/API_PRODUCT_SRV/A_ProductDescription` +
                            `(Product='${encodeURIComponent(materialId)}',Language='EN')` +
                            `?$format=json`;

                        const descResp = await executeHttpRequest(destination, { ...opts, url: descUrl });

                        const description = descResp?.data?.d?.ProductDescription
                            || descResp?.data?.ProductDescription
                            || '';

                        materialDescMap[materialId] = description;
                    } catch (descErr) {
                        logger.warn(`Failed to fetch description for material ${materialId}: ${descErr?.message || descErr}`);
                        materialDescMap[materialId] = '';
                    }
                });

                await Promise.all(descPromises);
            }

            logger.info(`Fetched descriptions for ${Object.keys(materialDescMap).length} material(s)`);
        }

        // ─────────────────────────────────────────────────────────────────────
        // STEP 4: Map item fields to output structure, enriching with
        // material descriptions
        // ─────────────────────────────────────────────────────────────────────
        const poResults = poItemsRaw.map(po => {
            const materials = po.items.map(item => {
                const materialId = item.Material || '';
                return {
                    ItemNo: item.PurchaseOrderItem || '',
                    Material: materialId,
                    MaterialDescription: materialDescMap[materialId] || '',
                    Plant: item.Plant || '',
                    SKU: materialId
                };
            });
            return { Number: po.Number, Materials: materials };
        });

        logger.info(`GET_SupplierDetails complete: ${poResults.length} PO(s) with items returned`);
        return { Supplier: supplier, PO: poResults };

    } catch (error) {
        const detail = error?.rootCause?.message || error?.cause?.message ||
            error?.response?.data?.error?.message?.value || error?.message || String(error);
        logger.error(`GET_SupplierDetails error: ${detail}`);
        req.reject(500, `Failed to fetch supplier details: ${detail}`);
    }
}

module.exports = handleGetSupplierDetails;
