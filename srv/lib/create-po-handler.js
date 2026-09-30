'use strict';

/**
 * Standard Purchase Order (PO) Creation Handler
 *
 * Creates a real PO in S/4HANA via API_PURCHASEORDER_PROCESS_SRV
 * with PurchaseOrderType = "NB".
 *
 * Flow:
 *   1. Fetch org data (CompanyCode, PurchasingOrg, PurchasingGroup, BaseUnit)
 *      from API_PLANT_SRV + API_PRODUCT_SRV via s4-plant-org-helper
 *   2. Fetch CSRF token from API_PURCHASEORDER_PROCESS_SRV
 *   3. POST A_PurchaseOrder with type "NB" and Supplier
 *   4. Return created PO number
 */

const { getAllOrgData } = require('./s4-plant-org-helper');

const DEST = 'S4R';
const ODATA_PO_SRV = '/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV';

/**
 * Create a Standard Purchase Order in S/4HANA.
 *
 * @param {Object} params
 * @param {string} params.supplierId     – Supplier / vendor number
 * @param {string} params.plantId        – Receiving plant
 * @param {string} params.materialId     – Material number
 * @param {number} params.quantity       – Order quantity
 * @param {string} [params.caseId]       – Optional case ID for audit
 * @param {Function} executeHttpRequest  – from @sap-cloud-sdk/http-client
 * @param {Object} logger               – CDS logger
 * @returns {Object} Result with poNumber on success
 */
async function createPurchaseOrder(params, executeHttpRequest, logger) {
    const { supplierId, plantId, materialId, quantity, caseId } = params;

    logger.info(`[PO] Creating PO: ${materialId} from supplier ${supplierId} to plant ${plantId}, qty=${quantity}`);

    // ── Step 1: Fetch org data ──────────────────────────────────────────
    const orgData = await getAllOrgData(executeHttpRequest, materialId, plantId, logger);
    if (!orgData.success) {
        logger.error(`[PO] Org data fetch failed: ${orgData.error}`);
        return {
            success: false,
            orderType: 'PO',
            error: `Failed to resolve org data: ${orgData.error}`
        };
    }

    logger.info(`[PO] Org data resolved: CC=${orgData.companyCode}, POrg=${orgData.purchasingOrganization}, PGrp=${orgData.purchasingGroup}, Unit=${orgData.baseUnit}`);

    // Validate required org fields — S/4HANA rejects empty values one by one
    if (!orgData.purchasingOrganization) {
        return { success: false, orderType: 'PO', error: 'PurchasingOrganization is empty — not maintained in plant master for ' + plantId };
    }
    if (!orgData.companyCode) {
        return { success: false, orderType: 'PO', error: 'CompanyCode is empty — not maintained in plant master for ' + plantId };
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
        const rawCookies = tokenResp.headers['set-cookie'];
        if (rawCookies) {
            cookies = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
        }
        logger.info(`[PO] CSRF token fetched: ${csrfToken ? 'OK' : 'EMPTY'}`);
    } catch (err) {
        logger.error(`[PO] CSRF token fetch failed: ${err.message}`);
        return {
            success: false,
            orderType: 'PO',
            error: `CSRF token fetch failed: ${err.message}`
        };
    }

    // ── Step 3: Build PO payload ────────────────────────────────────────
    // Delivery date — 14 days from today (standard lead time)
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + 14);
    const sDeliveryDate = deliveryDate.toISOString().split('T')[0] + 'T00:00:00';

    const payload = {
        PurchaseOrderType: 'NB',
        Supplier: supplierId,
        PurchasingOrganization: orgData.purchasingOrganization,
        PurchasingGroup: orgData.purchasingGroup,
        CompanyCode: orgData.companyCode,
        to_PurchaseOrderItem: [{
            PurchaseOrderItem: '10',
            Plant: plantId,
            Material: materialId,
            OrderQuantity: String(quantity),
            PurchaseOrderQuantityUnit: orgData.baseUnit,
            NetPriceAmount: '1',
            NetPriceQuantity: '1',
            DocumentCurrency: 'EUR',
            to_ScheduleLine: [{
                ScheduleLineDeliveryDate: sDeliveryDate,
                ScheduleLineOrderQuantity: String(quantity)
            }]
        }]
    };

    logger.info(`[PO] POST payload: ${JSON.stringify(payload)}`);

    // ── Step 4: POST to create the PO ───────────────────────────────────
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
            logger.error(`[PO] PO created but no PO number returned`);
            return {
                success: false,
                orderType: 'PO',
                error: 'PO created but no PurchaseOrder number in response'
            };
        }

        logger.info(`[PO] ✅ PO created successfully: ${poNumber}`);

        return {
            success: true,
            orderType: 'PO',
            poNumber,
            purchaseOrderType: 'NB',
            supplierId,
            plantId,
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

        logger.error(`[PO] POST failed (HTTP ${status}): ${errorMsg}`);

        return {
            success: false,
            orderType: 'PO',
            error: `PO creation failed (HTTP ${status}): ${errorMsg}`
        };
    }
}

module.exports = { createPurchaseOrder };