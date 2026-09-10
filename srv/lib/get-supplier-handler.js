/**
 * Get Supplier Handler
 * 
 * Handler for Get_supplier CAP function.
 * Fetches all suppliers from S/4HANA via API_BUSINESS_PARTNER, resolves
 * their Business Partner IDs, then retrieves their addresses and returns
 * a flat array of { Supplier, SupplierName, Address } objects.
 * 
 * Steps:
 * 1. Fetch A_Supplier and A_BusinessPartner in parallel (single call each)
 * 2. Build Supplier → BP lookup map from the parallel results
 * 3. For each resolved BP, fetch addresses from A_BusinessPartnerAddress
 * 4. Combine AddressID, CityName, Country, Region into a single Address string
 * 5. Return array with one entry per supplier-address combination
 */

'use strict';

/**
 * Main handler function - bound to service context
 * @param {Function} executeHttpRequest - SAP Cloud SDK HTTP client
 * @param {Object} logger - Logger instance
 * @param {Object} req - CAP request object
 */
async function handleGetSupplier(executeHttpRequest, logger, req) {
    logger.info('Get_supplier function called');

    if (!executeHttpRequest) {
        req.reject(500, '@sap-cloud-sdk/http-client is not available on the server');
        return;
    }

    const destination = { destinationName: 'S4R' };
    const opts = { method: 'GET', headers: { Accept: 'application/json' } };

    try {
        // ─────────────────────────────────────────────────────────────────────
        // STEP 1: Fetch A_Supplier and A_BusinessPartner in PARALLEL.
        // Both are independent single GET calls — running them concurrently
        // saves ~1-2 seconds versus the previous serial execution.
        // ─────────────────────────────────────────────────────────────────────
        const supplierUrl = `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_Supplier?$select=Supplier,SupplierName&$format=json`;
        const bpUrl =
            `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner` +
            `?$filter=Supplier ne ''` +
            `&$select=BusinessPartner,Supplier,BusinessPartnerFullName` +
            `&$format=json`;

        logger.info('Fetching A_Supplier and A_BusinessPartner in parallel');
        const [supplierResp, bpResp] = await Promise.all([
            executeHttpRequest(destination, { ...opts, url: supplierUrl }),
            executeHttpRequest(destination, { ...opts, url: bpUrl })
                .catch(bpErr => {
                    logger.warn(`Bulk BP resolution failed: ${bpErr?.message || bpErr}. Falling back to Supplier IDs as BP IDs`);
                    return null; // graceful fallback — will use Supplier IDs
                })
        ]);

        const supplierData = supplierResp?.data?.d?.results
            || supplierResp?.data?.value
            || [];

        if (supplierData.length === 0) {
            logger.info('No suppliers found');
            return [];
        }

        const supplierIds = supplierData.map(s => s.Supplier);
        // Build a lookup map: Supplier ID → SupplierName
        const supplierNameMap = {};
        supplierData.forEach(s => {
            supplierNameMap[s.Supplier] = s.SupplierName || '';
        });
        logger.info(`Found ${supplierIds.length} supplier(s)`);

        // ─────────────────────────────────────────────────────────────────────
        // STEP 2: Build the Supplier → Business Partner lookup map from the
        // parallel BP response. The Supplier ID and Business Partner ID are
        // not always the same in S/4HANA.
        // ─────────────────────────────────────────────────────────────────────
        const supplierToBpMap = {}; // Supplier ID → Business Partner ID

        if (bpResp) {
            const bpData = bpResp?.data?.d?.results
                || bpResp?.data?.value
                || [];

            bpData.forEach(bp => {
                if (bp.Supplier && bp.BusinessPartner) {
                    supplierToBpMap[bp.Supplier] = bp.BusinessPartner;
                }
            });

            logger.info(`Bulk BP fetch returned ${bpData.length} record(s), mapped ${Object.keys(supplierToBpMap).length} supplier(s) to BP IDs`);
        }

        // For any supplier not found in the bulk response, fall back to using the Supplier ID itself
        supplierIds.forEach(supplierId => {
            if (!supplierToBpMap[supplierId]) {
                supplierToBpMap[supplierId] = supplierId;
            }
        });

        logger.info(`Resolved ${Object.keys(supplierToBpMap).length} Business Partner ID(s). Fetching addresses...`);

        // ─────────────────────────────────────────────────────────────────────
        // STEP 3 & 4: For each supplier, fetch addresses from
        // A_BusinessPartnerAddress using the resolved Business Partner ID.
        // Process in batches of 10 to avoid overloading the backend.
        // ─────────────────────────────────────────────────────────────────────
        const BATCH_SIZE = 10;
        const results = [];

        for (let i = 0; i < supplierIds.length; i += BATCH_SIZE) {
            const batch = supplierIds.slice(i, i + BATCH_SIZE);

            const batchPromises = batch.map(async (supplierId) => {
                try {
                    const bpId = supplierToBpMap[supplierId] || supplierId;
                    const addressUrl =
                        `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartnerAddress` +
                        `?$filter=BusinessPartner eq '${encodeURIComponent(bpId)}'` +
                        `&$select=AddressID,CityName,Country,Region` +
                        `&$format=json`;

                    const addrResp = await executeHttpRequest(destination, { ...opts, url: addressUrl });

                    const addresses = addrResp?.data?.d?.results
                        || addrResp?.data?.value
                        || [];

                    if (addresses.length === 0) {
                        // Supplier exists but has no address — include with empty address
                        return [{ Supplier: supplierId, SupplierName: supplierNameMap[supplierId] || '', Address: '' }];
                    }

                    // Each address produces a separate entry
                    return addresses.map(addr => {
                        const parts = [
                            addr.AddressID || '',
                            addr.CityName || '',
                            addr.Country || '',
                            addr.Region || ''
                        ].filter(p => p.length > 0);

                        return {
                            Supplier: supplierId,
                            SupplierName: supplierNameMap[supplierId] || '',
                            Address: parts.join(',')
                        };
                    });
                } catch (addrErr) {
                    logger.warn(`Failed to fetch address for supplier ${supplierId}: ${addrErr?.message || addrErr}`);
                    return [{ Supplier: supplierId, SupplierName: supplierNameMap[supplierId] || '', Address: '' }];
                }
            });

            const batchResults = await Promise.all(batchPromises);
            // Flatten: each supplier may have multiple addresses
            batchResults.forEach(entries => results.push(...entries));
        }

        logger.info(`Get_supplier complete: returning ${results.length} record(s)`);
        return results;

    } catch (error) {
        const detail = error?.rootCause?.message || error?.cause?.message ||
            error?.response?.data?.error?.message?.value || error?.message || String(error);
        logger.error(`Get_supplier error: ${detail}`);
        req.reject(500, `Failed to fetch suppliers: ${detail}`);
    }
}

module.exports = handleGetSupplier;
