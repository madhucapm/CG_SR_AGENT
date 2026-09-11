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
 * Design Principle:
 *   "Dumb data pipe" — this handler does NO ranking, scoring, or math
 *   beyond removing excluded suppliers.  All interpretation (coverage,
 *   cost delta, risk assessment) is performed downstream by the LLM.
 *
 * S/4HANA APIs used:
 *   1. API_PURCHASING_SOURCE_SRV / A_PurchasingSource   [PRIMARY]
 *        Real Source List (SAP tx ME03, table EORD).
 *        Fields: Material, Plant, Supplier, ValidityStartDate,
 *                ValidityEndDate, SourceOfSupplyIsBlocked,
 *                PurchasingOrganization, SourceListRecord
 *        This is the authoritative "which suppliers are approved for
 *        (material, plant)" list — exactly what ME03 shows.
 *
 *   2. API_INFORECORD_PROCESS_SRV / A_PurgInfoRecdOrgPlantData [ENRICHMENT]
 *        Fields: Material, Supplier, Plant, NetPriceAmount,
 *                MaterialPlannedDeliveryDurn
 *        Provides pricing and planned delivery duration per supplier.
 *        Not every supplier on the Source List has an info record; when
 *        missing, we still return the supplier with unitPrice=null and
 *        leadTimeDays=null (Option A: source list is authority; pricing
 *        is enrichment).
 *
 * Reliability enrichment:
 *   Historical OTIF percentage is fetched per candidate supplier via the
 *   existing `supplier-otif-handler` module, then bucketed:
 *       otifPercentage >= 95  → HIGH
 *       otifPercentage >= 85  → MEDIUM
 *       otifPercentage <  85  → LOW
 *       otifPercentage == null → UNKNOWN  (no delivery history in window)
 */

'use strict';

const supplierOtifHandler = require('./supplier-otif-handler');

// ─────────────────────────────────────────────────────────────────────────────
// Reliability bucketing
// ─────────────────────────────────────────────────────────────────────────────
function bucketReliability(otifPercentage) {
    if (otifPercentage === null || otifPercentage === undefined) return 'UNKNOWN';
    if (otifPercentage >= 95) return 'HIGH';
    if (otifPercentage >= 85) return 'MEDIUM';
    return 'LOW';
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe numeric parsing — OData v2 returns numbers as strings
// ─────────────────────────────────────────────────────────────────────────────
function toNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// OData v2 date parser — turns "/Date(1785196800000)/" into a millisecond
// epoch number.  Returns null for empty / malformed inputs.
// ─────────────────────────────────────────────────────────────────────────────
function parseODataDateMs(v) {
    if (!v || typeof v !== 'string') return null;
    const m = v.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
    if (!m) return null;
    const ms = parseInt(m[1], 10);
    return Number.isFinite(ms) ? ms : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Fetch approved suppliers from the SAP Source List
//
// Hits API_PURCHASING_SOURCE_SRV / A_PurchasingSource — the real source list
// (equivalent to SAP tx ME03).  Returns raw rows filtered by material+plant.
// Downstream filtering (validity, blocked, excluded) is applied after.
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Filter Source-List rows by validity window, blocked flag, and
// the caller-supplied exclusion list.
// ─────────────────────────────────────────────────────────────────────────────
function filterSourceListRows(rows, excludedSet, logger) {
    const nowMs = Date.now();
    const alive = rows.filter(r => {
        if (r.SourceOfSupplyIsBlocked === true) return false;

        const startMs = parseODataDateMs(r.ValidityStartDate);
        const endMs   = parseODataDateMs(r.ValidityEndDate);

        if (startMs !== null && startMs > nowMs) return false;   // not yet valid
        if (endMs   !== null && endMs   < nowMs) return false;   // expired

        if (!r.Supplier) return false;
        if (excludedSet.has(r.Supplier)) return false;

        return true;
    });
    logger.info(`[alt-source-data] Rows after validity + block + exclusion filters: ${alive.length}`);
    return alive;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — De-duplicate by Supplier
//
// A supplier can have multiple source-list entries per (material, plant)
// (e.g., different SourceListRecord IDs or purchasing orgs). We keep the
// first occurrence — one entry per unique supplier is enough for the LLM.
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Fetch pricing + lead time for a specific supplier via info record.
//
// Not every supplier on the Source List has an info record; if none is
// found we return { unitPrice: null, leadTimeDays: null } and let the LLM
// deal with the missing values downstream.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchPricingForSupplier(material, plant, supplier, destination, opts, executeHttpRequest, logger) {
    const url =
        `/sap/opu/odata/sap/API_INFORECORD_PROCESS_SRV/A_PurgInfoRecdOrgPlantData` +
        `?$filter=${encodeURIComponent(
            `Material eq '${material}' and Plant eq '${plant}' and Supplier eq '${supplier}'`
        )}` +
        `&$select=Supplier,NetPriceAmount,MaterialPlannedDeliveryDurn` +
        `&$format=json`;

    try {
        const resp = await executeHttpRequest(destination, { ...opts, url });
        const rows = resp?.data?.d?.results || resp?.data?.value || [];

        if (rows.length === 0) {
            // Fallback: some tenants only maintain the plant-generic info record
            // (Plant = '' on the child entity).  Try again without the plant filter.
            const fallbackUrl =
                `/sap/opu/odata/sap/API_INFORECORD_PROCESS_SRV/A_PurgInfoRecdOrgPlantData` +
                `?$filter=${encodeURIComponent(
                    `Material eq '${material}' and Supplier eq '${supplier}'`
                )}` +
                `&$select=Supplier,Plant,NetPriceAmount,MaterialPlannedDeliveryDurn` +
                `&$format=json`;
            const fbResp = await executeHttpRequest(destination, { ...opts, url: fallbackUrl });
            const fbRows = fbResp?.data?.d?.results || fbResp?.data?.value || [];
            if (fbRows.length === 0) return { unitPrice: null, leadTimeDays: null };
            // Prefer a row where Plant equals the requested plant (if any)
            const preferred = fbRows.find(r => r.Plant === plant) || fbRows[0];
            return {
                unitPrice: toNumber(preferred.NetPriceAmount),
                leadTimeDays: toNumber(preferred.MaterialPlannedDeliveryDurn)
            };
        }

        // Take the cheapest row (if multiple info records exist per supplier)
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

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — Fetch historical OTIF for a supplier and bucket it.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchReliabilityForSupplier(supplier, executeHttpRequest, getCurrentTimestamp, logger) {
    try {
        const otifResp = await supplierOtifHandler(
            executeHttpRequest,
            getCurrentTimestamp,
            logger,
            { data: { supplierId: supplier, fromDate: null, toDate: null } }
        );
        const pct = otifResp && otifResp.success ? otifResp.otifPercentage : null;
        return bucketReliability(pct);
    } catch (err) {
        logger.warn(`[alt-source-data] OTIF fetch failed for supplier ${supplier}: ${err?.message || err}`);
        return 'UNKNOWN';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 — Enrich all surviving suppliers in parallel with pricing + OTIF.
// ─────────────────────────────────────────────────────────────────────────────
async function enrichAllSuppliers(
    candidates, material, plant,
    destination, opts, executeHttpRequest, getCurrentTimestamp, logger
) {
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

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function handleGetAltSourceData(executeHttpRequest, getCurrentTimestamp, logger, req) {
    logger.info('getAltSourceData function called');

    const { material, plant } = req.data;
    const excludedSuppliers = Array.isArray(req.data.excludedSuppliers)
        ? req.data.excludedSuppliers.filter(Boolean)
        : [];

    // ── Input validation ────────────────────────────────────────────────────
    if (!material || !plant) {
        return {
            success: false,
            toolName: 'get_alt_source_data',
            material: material || null,
            plant: plant || null,
            excludedSuppliers,
            candidateSuppliers: [],
            sourcedFromApis: [],
            dataSource: 'S4R',
            calculatedAt: getCurrentTimestamp(),
            error: 'material and plant are required'
        };
    }

    if (!executeHttpRequest) {
        return {
            success: false,
            toolName: 'get_alt_source_data',
            material, plant, excludedSuppliers,
            candidateSuppliers: [],
            sourcedFromApis: [],
            dataSource: 'S4R',
            calculatedAt: getCurrentTimestamp(),
            error: '@sap-cloud-sdk/http-client is not available on the server'
        };
    }

    const destination = { destinationName: 'S4R' };
    const opts = { method: 'GET', headers: { Accept: 'application/json' } };
    const excludedSet = new Set(excludedSuppliers);

    try {
        // STEP 1 — Source List (authoritative supplier list)
        const rawSourceRows = await fetchApprovedSuppliersFromSourceList(
            material, plant, destination, opts, executeHttpRequest, logger
        );

        // STEP 2 — Filter by validity + block + exclusion
        const aliveRows = filterSourceListRows(rawSourceRows, excludedSet, logger);

        // STEP 3 — Deduplicate by supplier
        const candidates = deduplicateBySupplier(aliveRows);
        logger.info(`[alt-source-data] Unique candidate suppliers: ${candidates.length}`);

        // STEP 4+5+6 — Parallel enrichment (pricing + reliability)
        const enriched = await enrichAllSuppliers(
            candidates, material, plant,
            destination, opts, executeHttpRequest, getCurrentTimestamp, logger
        );

        // ── Assemble spec-conforming output ────────────────────────────────
        return {
            success: true,
            toolName: 'get_alt_source_data',
            material,
            plant,
            excludedSuppliers,
            candidateSuppliers: enriched,
            sourcedFromApis: [
                'API_PURCHASING_SOURCE_SRV',
                'API_INFORECORD_PROCESS_SRV'
            ],
            dataSource: 'S4R',
            calculatedAt: getCurrentTimestamp(),
            error: null
        };

    } catch (error) {
        const detail = error?.rootCause?.message
            || error?.cause?.message
            || error?.response?.data?.error?.message?.value
            || error?.message
            || String(error);
        logger.error(`getAltSourceData error: ${detail}`);

        return {
            success: false,
            toolName: 'get_alt_source_data',
            material, plant, excludedSuppliers,
            candidateSuppliers: [],
            sourcedFromApis: [
                'API_PURCHASING_SOURCE_SRV',
                'API_INFORECORD_PROCESS_SRV'
            ],
            dataSource: 'S4R',
            calculatedAt: getCurrentTimestamp(),
            error: detail
        };
    }
}

module.exports = handleGetAltSourceData;