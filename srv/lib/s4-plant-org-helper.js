'use strict';

/**
 * S/4HANA Plant & Material Org-Data Helper
 *
 * Fetches organizational data needed to create POs/STOs:
 *   - CompanyCode, DefaultPurchasingOrganization  →  from API_PLANT_SRV
 *   - PurchasingGroup, BaseUnit                   →  from API_PRODUCT_SRV
 *
 * All calls go through the BTP 'S4R' destination via @sap-cloud-sdk/http-client.
 */

const DEST = 'S4R';

/**
 * Fetch plant master data from API_PLANT_SRV.
 *
 * @param {Function} executeHttpRequest  – from @sap-cloud-sdk/http-client
 * @param {string}   plantId             – e.g. '1000'
 * @param {Object}   logger              – CDS logger
 * @returns {{ companyCode: string, purchasingOrganization: string, plantName: string }}
 */
async function getPlantOrgData(executeHttpRequest, plantId, logger) {
    const SRV = '/sap/opu/odata/sap/API_PLANT_SRV';
    const url = `${SRV}/A_Plant('${plantId}')`;

    logger.info(`[PlantOrgHelper] GET plant org data: ${url}`);

    try {
        const response = await executeHttpRequest(
            { destinationName: DEST },
            { method: 'GET', url, headers: { Accept: 'application/json' } }
        );

        const d = response.data?.d || response.data || {};

        const companyCode = d.CompanyCode || '';
        // DefaultPurchasingOrganization is often empty in plant master.
        // Fall back to CompanyCode (they frequently share the same value
        // in S/4HANA) to avoid "Enter Purchasing Org." errors.
        const purchasingOrganization = d.DefaultPurchasingOrganization || companyCode;

        return {
            success: true,
            companyCode,
            purchasingOrganization,
            plantName: d.PlantName || d.Plant || plantId
        };
    } catch (err) {
        const status = err.response?.status || err.cause?.response?.status || 'N/A';
        logger.error(`[PlantOrgHelper] Plant fetch failed (HTTP ${status}): ${err.message}`);
        return { success: false, error: `Plant org fetch failed (HTTP ${status}): ${err.message}` };
    }
}

/**
 * Fetch material-plant level data from API_PRODUCT_SRV.
 *
 * @param {Function} executeHttpRequest  – from @sap-cloud-sdk/http-client
 * @param {string}   materialId          – e.g. 'MAT-001'
 * @param {string}   plantId             – e.g. '1000'
 * @param {Object}   logger              – CDS logger
 * @returns {{ purchasingGroup: string, baseUnit: string }}
 */
async function getMaterialPlantData(executeHttpRequest, materialId, plantId, logger) {
    const SRV = '/sap/opu/odata/sap/API_PRODUCT_SRV';

    // First try to get the material-plant level data (has PurchasingGroup)
    const mpUrl = `${SRV}/A_ProductPlant(Product='${materialId}',Plant='${plantId}')`;
    logger.info(`[PlantOrgHelper] GET material-plant data: ${mpUrl}`);

    let purchasingGroup = '';
    let baseUnit = 'EA';

    try {
        const mpResp = await executeHttpRequest(
            { destinationName: DEST },
            { method: 'GET', url: mpUrl, headers: { Accept: 'application/json' } }
        );
        const mpData = mpResp.data?.d || mpResp.data || {};
        purchasingGroup = mpData.PurchasingGroup || '';
    } catch (err) {
        logger.warn(`[PlantOrgHelper] Material-plant fetch failed: ${err.message} — PurchasingGroup will be empty`);
    }

    // Also fetch the base product to get BaseUnit
    const prodUrl = `${SRV}/A_Product('${materialId}')`;
    logger.info(`[PlantOrgHelper] GET product data: ${prodUrl}`);

    try {
        const prodResp = await executeHttpRequest(
            { destinationName: DEST },
            { method: 'GET', url: prodUrl, headers: { Accept: 'application/json' } }
        );
        const prodData = prodResp.data?.d || prodResp.data || {};
        baseUnit = prodData.BaseUnit || 'EA';
    } catch (err) {
        logger.warn(`[PlantOrgHelper] Product fetch failed: ${err.message} — using BaseUnit='EA'`);
    }

    return {
        success: true,
        purchasingGroup,
        baseUnit
    };
}

/**
 * Convenience: fetch all org data needed for PO/STO creation in one call.
 *
 * @param {Function} executeHttpRequest
 * @param {string}   materialId
 * @param {string}   plantId   – the receiving / target plant
 * @param {Object}   logger
 * @returns {{ companyCode, purchasingOrganization, purchasingGroup, baseUnit, plantName }}
 */
async function getAllOrgData(executeHttpRequest, materialId, plantId, logger) {
    const [plantOrg, matPlant] = await Promise.all([
        getPlantOrgData(executeHttpRequest, plantId, logger),
        getMaterialPlantData(executeHttpRequest, materialId, plantId, logger)
    ]);

    if (!plantOrg.success) {
        return { success: false, error: plantOrg.error };
    }

    return {
        success: true,
        companyCode: plantOrg.companyCode,
        purchasingOrganization: plantOrg.purchasingOrganization,
        purchasingGroup: matPlant.purchasingGroup,
        baseUnit: matPlant.baseUnit,
        plantName: plantOrg.plantName
    };
}

module.exports = {
    getPlantOrgData,
    getMaterialPlantData,
    getAllOrgData
};