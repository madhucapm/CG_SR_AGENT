'use strict';

/**
 * Stock Transport Order (STO) Creation Handler
 *
 * Creates a real STO in S/4HANA via API_PURCHASEORDER_PROCESS_SRV
 * with PurchaseOrderType = "NB" and SupplyingPlant set.
 *
 * Flow:
 *   1. Fetch org data (CompanyCode, PurchasingOrg, PurchasingGroup, BaseUnit)
 *      from API_PLANT_SRV + API_PRODUCT_SRV via s4-plant-org-helper
 *   2. Fetch CSRF token from API_PURCHASEORDER_PROCESS_SRV
 *   3. POST A_PurchaseOrder with type "UB" and SupplyingPlant
 *   4. Return created PO number
 */

const { getAllOrgData } = require('./s4-plant-org-helper');

const DEST = 'S4R';
const ODATA_PO_SRV = '/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV';

/**
 * Create a Stock Transport Order in S/4HANA.
 *
 * @param {Object} params
 * @param {string} params.sourcePlantId  – Supplying plant
 * @param {string} params.targetPlantId  – Receiving plant
 * @param {string} params.materialId     – Material number
 * @param {number} params.quantity       – Quantity to transfer
 * @param {string} [params.caseId]       – Optional case ID for audit
 * @param {Function} executeHttpRequest  – from @sap-cloud-sdk/http-client
 * @param {Object} logger               – CDS logger
 * @returns {Object} Result with poNumber on success
 */
async function createStockTransportOrder(params, executeHttpRequest, logger) {
    const { sourcePlantId, targetPlantId, materialId, quantity, caseId, supplierId } = params;

    logger.info(`[STO] Creating STO: ${materialId} from ${sourcePlantId} → ${targetPlantId}, qty=${quantity}, supplier=${supplierId || '(none)'}`);

    // ── Step 1: Fetch org data ──────────────────────────────────────────
    const orgData = await getAllOrgData(executeHttpRequest, materialId, targetPlantId, logger);
    if (!orgData.success) {
        logger.error(`[STO] Org data fetch failed: ${orgData.error}`);
        return {
            success: false,
            orderType: 'STO',
            error: `Failed to resolve org data: ${orgData.error}`
        };
    }

    logger.info(`[STO] Org data resolved: CC=${orgData.companyCode}, POrg=${orgData.purchasingOrganization}, PGrp=${orgData.purchasingGroup}, Unit=${orgData.baseUnit}`);

    // Validate required org fields — S/4HANA rejects empty values one by one
    if (!orgData.purchasingOrganization) {
        return { success: false, orderType: 'STO', error: 'PurchasingOrganization is empty — not maintained in plant master for ' + targetPlantId };
    }
    if (!orgData.companyCode) {
        return { success: false, orderType: 'STO', error: 'CompanyCode is empty — not maintained in plant master for ' + targetPlantId };
    }

    // ── Step 2: Fetch CSRF token ────────────────────────────────────────
    let csrfToken = '';
    let cookies = [];
    try {
        const tokenResp = await executeHttpRequest(
            { destinationName: DEST },
            {
                method: 'GET',
                url: `${ODATA_PO_SRV}/`,
                headers: {
                    'Accept': 'application/json',
                    'x-csrf-token': 'fetch'
                }
            }
        );
        csrfToken = tokenResp.headers['x-csrf-token'] || '';
        // Collect cookies for session affinity
        const rawCookies = tokenResp.headers['set-cookie'];
        if (rawCookies) {
            cookies = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
        }
        logger.info(`[STO] CSRF token fetched: ${csrfToken ? 'OK' : 'EMPTY'}`);
    } catch (err) {
        logger.error(`[STO] CSRF token fetch failed: ${err.message}`);
        return {
            success: false,
            orderType: 'STO',
            error: `CSRF token fetch failed: ${err.message}`
        };
    }

    // ── Step 3: Build STO payload ───────────────────────────────────────
    // Use PO type "NB" (Standard) with SupplyingPlant set — this is how
    // many S/4HANA systems handle stock transport orders.  Type "UB" is
    // not always configured; the SupplyingPlant field is what tells
    // S/4HANA this is an inter-plant stock transfer.
    // Delivery date — 14 days from today (reasonable lead time for inter-plant transfer)
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + 14);
    const sDeliveryDate = deliveryDate.toISOString().split('T')[0] + 'T00:00:00';

    // For type "NB" S/4HANA requires a Supplier.  For inter-plant
    // transfers the supplier is typically the vendor representing the
    // supplying plant.  If no supplierId was provided, fail early with
    // a clear message rather than letting S/4HANA return "Enter a supplier".
    if (!supplierId) {
        return { success: false, orderType: 'STO', error: 'Supplier (vendor) is required for STO with PO type NB. Pass supplierId from the case context.' };
    }

    const payload = {
        PurchaseOrderType: 'NB',
        Supplier: supplierId,
        SupplyingPlant: sourcePlantId,
        PurchasingOrganization: orgData.purchasingOrganization,
        PurchasingGroup: orgData.purchasingGroup,
        CompanyCode: orgData.companyCode,
        to_PurchaseOrderItem: [{
            PurchaseOrderItem: '10',
            Plant: targetPlantId,
            Material: materialId,
            OrderQuantity: String(quantity),
            PurchaseOrderQuantityUnit: orgData.baseUnit,
            NetPriceAmount: '0',
            NetPriceQuantity: '1',
            DocumentCurrency: 'EUR',
            to_ScheduleLine: [{
                ScheduleLineDeliveryDate: sDeliveryDate,
                ScheduleLineOrderQuantity: String(quantity)
            }]
        }]
    };

    logger.info(`[STO] POST payload: ${JSON.stringify(payload)}`);

    // ── Step 4: POST to create the STO ──────────────────────────────────
    try {
        const postHeaders = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
        };
        if (cookies.length > 0) {
            postHeaders['Cookie'] = cookies.map(c => c.split(';')[0]).join('; ');
        }

        const postResp = await executeHttpRequest(
            { destinationName: DEST },
            {
                method: 'POST',
                url: `${ODATA_PO_SRV}/A_PurchaseOrder`,
                headers: postHeaders,
                data: payload
            }
        );

        const result = postResp.data?.d || postResp.data || {};
        const poNumber = result.PurchaseOrder || '';

        if (!poNumber) {
            logger.error(`[STO] STO created but no PO number returned`);
            return {
                success: false,
                orderType: 'STO',
                error: 'STO created but no PurchaseOrder number in response'
            };
        }

        logger.info(`[STO] ✅ STO created successfully: ${poNumber}`);

        return {
            success: true,
            orderType: 'STO',
            poNumber,
            purchaseOrderType: 'NB',
            sourcePlantId,
            targetPlantId,
            materialId,
            quantity,
            unit: orgData.baseUnit,
            companyCode: orgData.companyCode,
            purchasingOrganization: orgData.purchasingOrganization,
            purchasingGroup: orgData.purchasingGroup,
            createdAt: new Date().toISOString(),
            error: null
        };

    } catch (err) {
        const status = err.response?.status || err.cause?.response?.status || 'N/A';
        const body = err.response?.data || err.cause?.response?.data || '';
        const errorMsg = typeof body === 'object'
            ? (body?.error?.message?.value || JSON.stringify(body).substring(0, 500))
            : String(body).substring(0, 500);

        logger.error(`[STO] POST failed (HTTP ${status}): ${errorMsg}`);

        return {
            success: false,
            orderType: 'STO',
            error: `STO creation failed (HTTP ${status}): ${errorMsg}`
        };
    }
}

module.exports = { createStockTransportOrder };