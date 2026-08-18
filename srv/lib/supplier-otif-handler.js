/**
 * Supplier Historical OTIF Handler
 * 
 * Handler for getSupplierHistoricalOtif CAP function.
 * Fetches all POs for a supplier from S/4HANA and calculates aggregate OTIF.
 */

'use strict';

const otifCalculator = require('./supplier-otif-calculator');

/**
 * Main handler function - bound to service context
 * @param {Function} executeHttpRequest - SAP Cloud SDK HTTP client
 * @param {Function} getCurrentTimestamp - Timestamp utility
 * @param {Object} logger - Logger instance
 * @param {Object} req - CAP request object
 */
async function handleGetSupplierHistoricalOtif(executeHttpRequest, getCurrentTimestamp, logger, req) {
    const startTime = Date.now();
    logger.info('getSupplierHistoricalOtif function called');

    const { supplierId, fromDate: inputFromDate, toDate: inputToDate } = req.data;

    // Validate input
    if (!supplierId) {
        return { success: false, supplierId: null, error: 'supplierId is required' };
    }

    if (!executeHttpRequest) {
        return { success: false, supplierId, error: '@sap-cloud-sdk/http-client not available' };
    }

    // Set defaults: last 6 months, max 50 POs
    const toDate = inputToDate || new Date().toISOString().split('T')[0];
    const fromDate = inputFromDate || otifCalculator.getDateMonthsAgo(6);
    const MAX_POS = 50;

    const destination = { destinationName: 'S4R' };
    const opts = { method: 'GET', headers: { Accept: 'application/json' } };

    // OData date parser
    const parseODataDate = (v) => {
        if (!v || typeof v !== 'string') return '';
        const m = v.match(/\/Date\((-?\d+)\)\//);
        return m ? new Date(parseInt(m[1], 10)).toISOString().split('T')[0] : String(v);
    };

    try {
        // STEP 1: Fetch PO list for supplier
        logger.info(`Fetching POs for supplier ${supplierId} from ${fromDate} to ${toDate}`);

        const poListUrl = `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder` +
            `?$filter=Supplier eq '${encodeURIComponent(supplierId)}'` +
            ` and PurchaseOrderDate ge datetime'${fromDate}T00:00:00'` +
            ` and PurchaseOrderDate le datetime'${toDate}T23:59:59'` +
            `&$select=PurchaseOrder,Supplier,PurchaseOrderDate,AddressName` +
            `&$top=${MAX_POS}&$orderby=PurchaseOrderDate desc&$format=json`;

        const poListResp = await executeHttpRequest(destination, { ...opts, url: poListUrl });
        const poListData = poListResp?.data?.d?.results || poListResp?.data?.value || [];

        if (poListData.length === 0) {
            logger.info(`No POs found for supplier ${supplierId}`);
            return buildEmptyResponse(supplierId, fromDate, toDate, getCurrentTimestamp(), startTime);
        }

        const supplierName = poListData[0]?.AddressName || null;
        const poNumbers = poListData.map(po => po.PurchaseOrder);
        logger.info(`Found ${poNumbers.length} POs for supplier`);

        // STEP 2 & 3: Fetch details for each PO in batches
        const poDataList = await fetchPoDetails(
            poNumbers, poListData, destination, opts, executeHttpRequest, parseODataDate, logger
        );

        // STEP 4 & 5: Calculate aggregate OTIF
        const otifResult = otifCalculator.calculateSupplierOtif(poDataList);
        const processingTimeMs = Date.now() - startTime;
        
        logger.info(`OTIF calculation complete: ${otifResult.otifPercentage}% in ${processingTimeMs}ms`);

        return {
            success: true, supplierId, supplierName,
            otifPercentage: otifResult.otifPercentage, totalPOs: otifResult.totalPOs,
            deliveredPOs: otifResult.deliveredPOs, otifPOs: otifResult.otifPOs,
            onTimePOs: otifResult.onTimePOs, inFullPOs: otifResult.inFullPOs,
            pendingPOs: otifResult.pendingPOs, overduePOs: otifResult.overduePOs,
            partiallyDeliveredPOs: otifResult.partiallyDeliveredPOs,
            onTimePercentage: otifResult.onTimePercentage, inFullPercentage: otifResult.inFullPercentage,
            fromDate, toDate, poDetails: otifResult.poDetails,
            dataSource: 'S4R', calculatedAt: getCurrentTimestamp(), processingTimeMs, error: null
        };

    } catch (error) {
        const detail = error?.rootCause?.message || error?.cause?.message ||
            error?.response?.data?.error?.message?.value || error?.message || String(error);
        logger.error(`getSupplierHistoricalOtif error: ${detail}`);
        
        return {
            success: false,
            supplierId,
            supplierName: null,
            otifPercentage: null,
            totalPOs: 0,
            fromDate: inputFromDate,
            toDate: inputToDate,
            poDetails: [],
            dataSource: 'S4R',
            calculatedAt: getCurrentTimestamp(),
            processingTimeMs: Date.now() - startTime,
            error: detail
        };
    }
}

/**
 * Fetch PO details (items, schedule lines, material docs) for each PO in batches
 */
async function fetchPoDetails(poNumbers, poListData, destination, opts, executeHttpRequest, parseODataDate, logger) {
    const poDataList = [];
    const BATCH_SIZE = 10;

    for (let i = 0; i < poNumbers.length; i += BATCH_SIZE) {
        const batch = poNumbers.slice(i, i + BATCH_SIZE);
        logger.info(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(poNumbers.length / BATCH_SIZE)}`);

        const batchPromises = batch.map(async (poNumber) => {
            const poInfo = poListData.find(p => p.PurchaseOrder === poNumber);

            // Build URLs
            const itemsUrl = `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem` +
                `?$filter=${encodeURIComponent(`PurchaseOrder eq '${poNumber}'`)}` +
                `&$select=PurchaseOrder,OrderQuantity&$format=json`;

            const schedUrl = `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderScheduleLine` +
                `?$filter=${encodeURIComponent(`PurchasingDocument eq '${poNumber}'`)}` +
                `&$select=ScheduleLineDeliveryDate,SchedLineStscDeliveryDate&$format=json`;

            // NOTE: PostingDate is NOT available on A_MaterialDocumentItem - it exists on A_MaterialDocumentHeader.
            // We use a two-step approach: fetch items first, then fetch headers to get PostingDate.
            const matUrl = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem` +
                `?$filter=${encodeURIComponent(`PurchaseOrder eq '${poNumber}' and GoodsMovementType eq '101'`)}` +
                `&$select=MaterialDocument,MaterialDocumentYear,GoodsMovementType,QuantityInEntryUnit&$format=json`;

            // Parallel fetch
            const [itemsR, schedR, matR] = await Promise.all([
                executeHttpRequest(destination, { ...opts, url: itemsUrl }).catch(() => ({ __failed: true })),
                executeHttpRequest(destination, { ...opts, url: schedUrl }).catch(() => ({ __failed: true })),
                executeHttpRequest(destination, { ...opts, url: matUrl }).catch((err) => {
                    logger.warn(`Material document item fetch failed for PO ${poNumber}: ${err?.message || err}`);
                    return { __failed: true };
                })
            ]);

            // Parse responses
            const items = !itemsR.__failed ? (itemsR?.data?.d?.results || itemsR?.data?.value || []) : [];
            
            const scheduleLines = !schedR.__failed
                ? (schedR?.data?.d?.results || schedR?.data?.value || []).map(sl => ({
                    ScheduleLineDeliveryDate: parseODataDate(sl.ScheduleLineDeliveryDate),
                    SchedLineStscDeliveryDate: parseODataDate(sl.SchedLineStscDeliveryDate)
                }))
                : [];

            // Two-step approach for material documents: fetch items, then fetch headers for PostingDate
            let materialDocuments = [];
            if (!matR.__failed) {
                const rawMatDocs = matR?.data?.d?.results || matR?.data?.value || [];
                
                if (rawMatDocs.length > 0) {
                    // Step 2: Extract unique document keys and fetch headers to get PostingDate
                    const uniqueDocKeys = [...new Map(
                        rawMatDocs.map(md => [
                            `${md.MaterialDocument}-${md.MaterialDocumentYear}`,
                            { doc: md.MaterialDocument, year: md.MaterialDocumentYear }
                        ])
                    ).values()];

                    // Fetch headers for PostingDate
                    let matDocHeaderMap = new Map();
                    if (uniqueDocKeys.length > 0) {
                        try {
                            const headerFilterParts = uniqueDocKeys.map(k =>
                                `(MaterialDocument eq '${k.doc}' and MaterialDocumentYear eq '${k.year}')`
                            );
                            const headerFilter = headerFilterParts.join(' or ');
                            const headerUrl = `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader` +
                                `?$select=MaterialDocument,MaterialDocumentYear,PostingDate` +
                                `&$filter=${encodeURIComponent(headerFilter)}&$format=json`;

                            const headerResp = await executeHttpRequest(destination, { ...opts, url: headerUrl });
                            const rawHeaders = headerResp?.data?.d?.results || headerResp?.data?.value || [];
                            rawHeaders.forEach(hdr => {
                                const key = `${hdr.MaterialDocument}-${hdr.MaterialDocumentYear}`;
                                matDocHeaderMap.set(key, hdr);
                            });
                        } catch (hdrErr) {
                            logger.warn(`Material document header fetch failed for PO ${poNumber}: ${hdrErr?.message || hdrErr}`);
                        }
                    }

                    // Merge header PostingDate into item data
                    materialDocuments = rawMatDocs.map(md => {
                        const headerKey = `${md.MaterialDocument}-${md.MaterialDocumentYear}`;
                        const hdr = matDocHeaderMap.get(headerKey) || {};
                        return {
                            GoodsMovementType: md.GoodsMovementType,
                            QuantityInEntryUnit: md.QuantityInEntryUnit,
                            PostingDate: parseODataDate(hdr.PostingDate)
                        };
                    });
                }
            }

            return {
                poNumber,
                orderDate: parseODataDate(poInfo?.PurchaseOrderDate),
                items,
                scheduleLines,
                materialDocuments
            };
        });

        const batchResults = await Promise.all(batchPromises);
        poDataList.push(...batchResults);
    }

    return poDataList;
}

/**
 * Build empty response when no POs found
 */
function buildEmptyResponse(supplierId, fromDate, toDate, timestamp, startTime) {
    return {
        success: true,
        supplierId,
        supplierName: null,
        otifPercentage: null,
        totalPOs: 0,
        deliveredPOs: 0,
        otifPOs: 0,
        onTimePOs: 0,
        inFullPOs: 0,
        pendingPOs: 0,
        overduePOs: 0,
        partiallyDeliveredPOs: 0,
        onTimePercentage: null,
        inFullPercentage: null,
        fromDate,
        toDate,
        poDetails: [],
        dataSource: 'S4R',
        calculatedAt: timestamp,
        processingTimeMs: Date.now() - startTime,
        error: null
    };
}

module.exports = handleGetSupplierHistoricalOtif;

