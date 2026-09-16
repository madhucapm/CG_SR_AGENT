/**
 * Alt-Source Data Handler
 *
 * Handler for the `getAltSourceData` CAP function — one of the 5 data-fetch
 * tools consumed by the Scenario & Recommendation Agent (SCN).
 *
 * Purpose (per SCN Dev Spec v1.5 §5B.4):
 *   Fetch the list of APPROVED alternate suppliers for a given
 *   (material, plant), together with unit price, lead time, and a
 *   HIGH/MEDIUM/LOW historical reliability bucket.
 *
 * S/4HANA APIs used:
 *   1. API_PURCHASING_SOURCE_SRV / A_PurchasingSource   [PRIMARY]
 *        Real Source List (SAP tx ME03).
 *   2. API_INFORECORD_PROCESS_SRV / A_PurgInfoRecdOrgPlantData [ENRICHMENT]
 *        Provides unit price + planned delivery duration per supplier.
 */

'use strict';

const supplierOtifHandler = require('./supplier-otif-handler');

function bucketReliability(otifPercentage) {
    if (otifPercentage === null || otifPercentage === undefined) return 'UNKNOWN';
    if (otifPercentage >= 95) return 'HIGH';
    if (otifPercentage >= 85) return 'MEDIUM';
    return 'LOW';
}

function toNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function parseODataDateMs(v) {
    if (!v || typeof v !== 'string') return null;
    const m = v.match(/\/Date((-?\d+)([+-]\d{4})?)\//);
    if (!m) return null;
    const ms = parseInt(m[1], 10);
    return Number.isFinite(ms) ? ms : null;
}

async function fetchApprovedSuppliersFromSourceList(material, plant, destination, opts, executeHttpRequest, logger) {
    const url =
        `/sap/opu/odata/sap/API_PURCHASING_SOURCE_SRV/A_PurchasingSource` +
        `?$filter=${encodeURIComponent(`Material eq '${material}' and Plant eq '${plant}'`)}` +
        `&$select=Material,Plant,Supplier,SourceListRecord,` +
        `ValidityStartDate,ValidityEndDate,SourceOfSupplyIsBlocked,PurchasingOrganization` +
        `&$format=json`;
    logger.info(`[alt-source-data] Fetching Source List for material=${material}, plant=${plant}`);
    const resp = await executeHttpRequest(destination, { ...opts, url });
    const rows = resp?.data?.d?.results || resp?.data?.value || [];
    logger.info(`[alt-source-data] Source-list rows returned: ${rows.length}`);
    return rows;
}

function filterSourceListRows(rows, excludedSet, logger) {
    const nowMs = Date.now();
    const alive = rows.filter(r => {
        if (r.SourceOfSupplyIsBlocked === true) return false;
        const startMs = parseODataDateMs(r.ValidityStartDate);
        const endMs   = parseODataDateMs(r.ValidityEndDate);
        if (startMs !== null && startMs > nowMs) return false;
        if (endMs   !== null && endMs   < nowMs) return false;
        if (!r.Supplier) return false;
        if (excludedSet.has(r.Supplier)) return false;
        return true;
    });
    logger.info(`[alt-source-data] Rows after validity + block + exclusion filters: ${alive.length}`);
    return alive;
}

function deduplicateBySupplier(rows) {
    const seen = new Set();
    const unique = [];
    for (const r of rows) {
        if (seen.has(r.Supplier)) continue;
        seen.add(r.Supplier);
        unique.push({
            supplier: r.Supplier,
            purchasingOrganization: r.PurchasingOrganization || null,
            sourceListRecord: r.SourceListRecord || null
        });
    }
    return unique;
}


async function fetchPricingForSupplier(material, plant, supplier, destination, opts, executeHttpRequest, logger) {
    const url =
        `/sap/opu/odata/sap/API_INFORECORD_PROCESS_SRV/A_PurgInfoRecdOrgPlantData` +
        `?$filter=${encodeURIComponent(`Material eq '${material}' and Plant eq '${plant}' and Supplier eq '${supplier}'`)}` +
        `&$select=Supplier,NetPriceAmount,MaterialPlannedDeliveryDurn` +
        `&$format=json`;
    try {
        const resp = await executeHttpRequest(destination, { ...opts, url });
        const rows = resp?.data?.d?.results || resp?.data?.value || [];
        if (rows.length === 0) {
            const fallbackUrl =
                `/sap/opu/odata/sap/API_INFORECORD_PROCESS_SRV/A_PurgInfoRecdOrgPlantData` +
                `?$filter=${encodeURIComponent(`Material eq '${material}' and Supplier eq '${supplier}'`)}` +
                `&$select=Supplier,Plant,NetPriceAmount,MaterialPlannedDeliveryDurn` +
                `&$format=json`;
            const fbResp = await executeHttpRequest(destination, { ...opts, url: fallbackUrl });
            const fbRows = fbResp?.data?.d?.results || fbResp?.data?.value || [];
            if (fbRows.length === 0) return { unitPrice: null, leadTimeDays: null };
            const preferred = fbRows.find(r => r.Plant === plant) || fbRows[0];
            return {
                unitPrice: toNumber(preferred.NetPriceAmount),
                leadTimeDays: toNumber(preferred.MaterialPlannedDeliveryDurn)
            };
        }
        let cheapest = rows[0];
        for (const r of rows) {
            const cur = toNumber(cheapest.NetPriceAmount) ?? Number.POSITIVE_INFINITY;
            const nxt = toNumber(r.NetPriceAmount)         ?? Number.POSITIVE_INFINITY;
            if (nxt < cur) cheapest = r;
        }
        return {
            unitPrice: toNumber(cheapest.NetPriceAmount),
            leadTimeDays: toNumber(cheapest.MaterialPlannedDeliveryDurn)
        };
    } catch (err) {
        logger.warn(`[alt-source-data] Info-record fetch failed for supplier ${supplier}: ${err?.message || err}`);
        return { unitPrice: null, leadTimeDays: null };
    }
}

async function fetchReliabilityForSupplier(supplier, executeHttpRequest, getCurrentTimestamp, logger) {
    try {
        const otifResp = await supplierOtifHandler(
            executeHttpRequest, getCurrentTimestamp, logger,
            { data: { supplierId: supplier, fromDate: null, toDate: null } }
        );
        const pct = otifResp && otifResp.success ? otifResp.otifPercentage : null;
        return bucketReliability(pct);
    } catch (err) {
        logger.warn(`[alt-source-data] OTIF fetch failed for supplier ${supplier}: ${err?.message || err}`);
        return 'UNKNOWN';
    }
}


async function enrichAllSuppliers(candidates, material, plant, destination, opts, executeHttpRequest, getCurrentTimestamp, logger) {
    if (candidates.length === 0) return [];
    logger.info(`[alt-source-data] Enriching ${candidates.length} supplier(s) with pricing + OTIF`);
    return Promise.all(candidates.map(async (c) => {
        const [pricing, reliability] = await Promise.all([
            fetchPricingForSupplier(material, plant, c.supplier, destination, opts, executeHttpRequest, logger),
            fetchReliabilityForSupplier(c.supplier, executeHttpRequest, getCurrentTimestamp, logger)
        ]);
        return {
            supplier: c.supplier,
            unitPrice: pricing.unitPrice,
            leadTimeDays: pricing.leadTimeDays,
            historicalReliability: reliability
        };
    }));
}


async function handleGetAltSourceData(executeHttpRequest, getCurrentTimestamp, logger, req) {
    logger.info('getAltSourceData function called');
    const { material, plant } = req.data;
    const excludedSuppliers = Array.isArray(req.data.excludedSuppliers)
        ? req.data.excludedSuppliers.filter(Boolean) : [];

    if (!material || !plant) {
        return {
            success: false, toolName: 'get_alt_source_data',
            material: material || null, plant: plant || null,
            excludedSuppliers, candidateSuppliers: [], sourcedFromApis: [],
            dataSource: 'S4R', calculatedAt: getCurrentTimestamp(),
            error: 'material and plant are required'
        };
    }
    if (!executeHttpRequest) {
        return {
            success: false, toolName: 'get_alt_source_data',
            material, plant, excludedSuppliers,
            candidateSuppliers: [], sourcedFromApis: [],
            dataSource: 'S4R', calculatedAt: getCurrentTimestamp(),
            error: '@sap-cloud-sdk/http-client is not available on the server'
        };
    }

    const destination = { destinationName: 'S4R' };
    const opts = { method: 'GET', headers: { Accept: 'application/json' } };
    const excludedSet = new Set(excludedSuppliers);

    try {
        const rawSourceRows = await fetchApprovedSuppliersFromSourceList(
            material, plant, destination, opts, executeHttpRequest, logger
        );
        const aliveRows = filterSourceListRows(rawSourceRows, excludedSet, logger);
        const candidates = deduplicateBySupplier(aliveRows);
        logger.info(`[alt-source-data] Unique candidate suppliers: ${candidates.length}`);

        const enriched = await enrichAllSuppliers(
            candidates, material, plant,
            destination, opts, executeHttpRequest, getCurrentTimestamp, logger
        );

        return {
            success: true, toolName: 'get_alt_source_data',
            material, plant, excludedSuppliers,
            candidateSuppliers: enriched,
            sourcedFromApis: ['API_PURCHASING_SOURCE_SRV', 'API_INFORECORD_PROCESS_SRV'],
            dataSource: 'S4R', calculatedAt: getCurrentTimestamp(), error: null
        };
    } catch (error) {
        const detail = error?.rootCause?.message || error?.cause?.message
            || error?.response?.data?.error?.message?.value
            || error?.message || String(error);
        logger.error(`getAltSourceData error: ${detail}`);
        return {
            success: false, toolName: 'get_alt_source_data',
            material, plant, excludedSuppliers,
            candidateSuppliers: [],
            sourcedFromApis: ['API_PURCHASING_SOURCE_SRV', 'API_INFORECORD_PROCESS_SRV'],
            dataSource: 'S4R', calculatedAt: getCurrentTimestamp(), error: detail
        };
    }
}

module.exports = handleGetAltSourceData;

