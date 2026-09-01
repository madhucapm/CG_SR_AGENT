/**
 * analyze-impact-handler.js
 *
 * Path B orchestrator for the `analyzeImpact` CAP function.
 *
 * Reuses the existing S/4HANA-backed handlers so business logic stays in
 * one place (S/4HANA is the single source of truth):
 *
 *   Step 1: Get_supplier()             → real supplier universe from
 *                                        API_BUSINESS_PARTNER
 *   Step 2: POST /analyze on the       → send the real suppliers to the
 *           supplier_resilience_agent    Python geo-agent (which now
 *           destination                  requires this list; there is no
 *                                        fallback in the Python service)
 *   Step 3: GET_SupplierDetails(id)    → for each affected supplier, fetch
 *                                        POs + items from
 *                                        API_PURCHASEORDER_PROCESS_SRV
 *                                        in parallel via Promise.all
 *
 * Step 3 failures per supplier are captured but do NOT sink the batch;
 * step 2 empty-supplier / bad-request errors are surfaced verbatim with
 * `success: false`.
 *
 * This module is designed to be unit-testable — the outbound HTTP
 * dependency and the two reused handlers are injected, and the module
 * exports its helpers separately so they can be exercised with stubs.
 */

'use strict';

const getSupplierHandler        = require('./get-supplier-handler');
const getSupplierDetailsHandler = require('./get-supplier-details-handler');

/** Safely coerce any value to string, mapping undefined/null to empty. */
function asStr(v) {
    if (v === undefined || v === null) { return ''; }
    return String(v);
}

/**
 * Normalize a S/4HANA Business Partner ID for reliable matching.
 * `A_Supplier.Supplier` (used by Get_supplier) and `A_PurchaseOrder.Supplier`
 * (used inside runEarlyWarningWithS4R) are the same field in S/4HANA, but we
 * defend against subtle drift (Number vs String, missing leading zeros,
 * whitespace) so the key lookup in Step 4 stays robust.
 */
function normalizeSupplierId(id) {
    if (id === undefined || id === null) { return ''; }
    const s = String(id).trim();
    // S/4HANA convention: numeric BP IDs are 10-digit zero-padded.
    return /^\d+$/.test(s) ? s.padStart(10, '0') : s;
}

/**
 * Extract a human-readable error message from an SAP Cloud SDK / axios
 * error. The SDK often nests the real cause several levels deep.
 */
function extractErrorDetail(error) {
    return (
        (error && error.rootCause && error.rootCause.message) ||
        (error && error.cause     && error.cause.message)     ||
        (error && error.response  && error.response.data && (
            (error.response.data.error && (
                (error.response.data.error.message && error.response.data.error.message.value) ||
                error.response.data.error.message
            )) ||
            (error.response.data.detail) ||
            (typeof error.response.data === 'string'
                ? error.response.data
                : JSON.stringify(error.response.data).substring(0, 500))
        )) ||
        (error && error.message) ||
        String(error)
    );
}

/**
 * Adapter: call an existing CAP handler that expects
 * (executeHttpRequest, logger, req) and returns a value or rejects via
 * req.reject(). We synthesize a lightweight `req` so we can invoke the
 * handlers in-process without going through OData.
 */
function invokeInternalHandler(handlerFn, executeHttpRequest, logger, data) {
    return new Promise(async (resolve, reject) => {
        const fakeReq = {
            data: data || {},
            reject(code, message) {
                const err = new Error(asStr(message) || `Handler rejected (${code})`);
                err.code = code;
                reject(err);
            }
        };
        try {
            const result = await handlerFn(executeHttpRequest, logger, fakeReq);
            resolve(result);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Build the failure envelope in a single place so every early-return has
 * the same shape as the success envelope.
 */
function failureEnvelope({ location, impact_description, assessment_radius_km, error }) {
    return {
        success: false,
        location: asStr(location),
        impact_description: asStr(impact_description),
        assessment_radius_km: assessment_radius_km || 0,
        impact_coords: null,
        supplier_count: 0,
        affected_supplier_count: 0,
        message: '',
        error: asStr(error),
        affected_suppliers: []
    };
}

/**
 * Fetch enriched PO/material data for one supplier by delegating to the
 * existing GET_SupplierDetails handler. On failure, log the error and
 * return an empty PO list so the batch keeps going.
 */
async function enrichSupplierWithPOs(executeHttpRequest, logger, affectedSupplier) {
    const supplierId = affectedSupplier.supplier_id;
    try {
        const detail = await invokeInternalHandler(
            getSupplierDetailsHandler,
            executeHttpRequest,
            logger,
            { supplier: supplierId }
        );

        // Existing handler returns { Supplier, PO: [{ Number, Materials: [...] }] }
        const rawPOs = (detail && Array.isArray(detail.PO)) ? detail.PO : [];

        const purchaseOrders = rawPOs.map((po) => ({
            po_number: asStr(po.Number),
            materials: (Array.isArray(po.Materials) ? po.Materials : []).map((m) => ({
                item_no:  asStr(m.ItemNo),
                material: asStr(m.Material),
                plant:    asStr(m.Plant),
                sku:      asStr(m.SKU)
            }))
        }));

        return {
            supplier_id: supplierId,
            name:        asStr(affectedSupplier.name),
            address:     asStr(affectedSupplier.address),
            latitude:    affectedSupplier.latitude,
            longitude:   affectedSupplier.longitude,
            distance_km: affectedSupplier.distance_km,
            po_count:    purchaseOrders.length,
            purchase_orders: purchaseOrders
        };
    } catch (err) {
        logger.warn(
            `analyzeImpact: GET_SupplierDetails failed for supplier '${supplierId}': ` +
            extractErrorDetail(err)
        );
        return {
            supplier_id: supplierId,
            name:        asStr(affectedSupplier.name),
            address:     asStr(affectedSupplier.address),
            latitude:    affectedSupplier.latitude,
            longitude:   affectedSupplier.longitude,
            distance_km: affectedSupplier.distance_km,
            po_count:    0,
            purchase_orders: []
        };
    }
}
/**
 * Build the CAP handler bound to `executeHttpRequest` + `logger`.
 * Usage in service.js:
 *
 *     this.on('analyzeImpact',
 *         require('./lib/analyze-impact-handler')(executeHttpRequest, logger));
 */
module.exports = function buildHandler(executeHttpRequest, logger) {

    return async function analyzeImpact(req) {
        logger.info('analyzeImpact function called');

        const { location, impact_description, assessment_radius_km } = req.data || {};

        // ─── Input validation ────────────────────────────────────────────
        if (!location || !impact_description) {
            return failureEnvelope({
                location, impact_description, assessment_radius_km,
                error: 'location and impact_description are required'
            });
        }

        if (!executeHttpRequest) {
            return failureEnvelope({
                location, impact_description, assessment_radius_km,
                error: '@sap-cloud-sdk/http-client is not available on the server'
            });
        }

        const radius = (typeof assessment_radius_km === 'number' && assessment_radius_km > 0)
            ? assessment_radius_km
            : 100;

        // ─── Step 1: Get_supplier() — real S/4HANA supplier universe ─────
        let supplierList;
        try {
            logger.info('analyzeImpact: calling Get_supplier() for real supplier universe');
            supplierList = await invokeInternalHandler(
                getSupplierHandler, executeHttpRequest, logger, {}
            );
        } catch (err) {
            const detail = extractErrorDetail(err);
            logger.error(`analyzeImpact: Get_supplier failed: ${detail}`);
            return failureEnvelope({
                location, impact_description, assessment_radius_km: radius,
                error: `Get_supplier failed: ${detail}`
            });
        }

        if (!Array.isArray(supplierList) || supplierList.length === 0) {
            logger.warn('analyzeImpact: Get_supplier returned no suppliers');
            return failureEnvelope({
                location, impact_description, assessment_radius_km: radius,
                error: 'No suppliers found in S/4HANA. Cannot proceed with impact analysis.'
            });
        }

        logger.info(`analyzeImpact: Get_supplier returned ${supplierList.length} supplier(s)`);

        // Adapt from CAP handler shape { Supplier, Address } to Python
        // agent shape { supplier_id, name, address }. Skip records that
        // have no usable address — the Python agent would fail to geocode
        // them anyway and its own rule is to skip and log.
        const pythonPayloadSuppliers = supplierList
            .filter((s) => s && s.Supplier && s.Address)
            .map((s) => ({
                supplier_id: asStr(s.Supplier),
                name:        asStr(s.Supplier),
                address:     asStr(s.Address)
            }));

        if (pythonPayloadSuppliers.length === 0) {
            return failureEnvelope({
                location, impact_description, assessment_radius_km: radius,
                error: 'No suppliers with addresses found. Cannot geocode.'
            });
        }
        // ─── Step 2: POST /analyze on the Python geo-agent ───────────────
        let geoResponse;
        try {
            logger.info(
                `analyzeImpact: POST /analyze to supplier_resilience_agent with ` +
                `${pythonPayloadSuppliers.length} supplier(s), radius=${radius}km`
            );
            const geoResp = await executeHttpRequest(
                { destinationName: 'supplier_resilience_agent' },
                {
                    method: 'POST',
                    url: '/analyze',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json'
                    },
                    data: {
                        location: location,
                        impact_description: impact_description,
                        assessment_radius_km: radius,
                        suppliers: pythonPayloadSuppliers
                    }
                }
            );
            geoResponse = (geoResp && geoResp.data) ? geoResp.data : null;
        } catch (err) {
            const detail = extractErrorDetail(err);
            logger.error(`analyzeImpact: /analyze failed: ${detail}`);
            return {
                ...failureEnvelope({
                    location, impact_description, assessment_radius_km: radius,
                    error: `supplier_resilience_agent /analyze failed: ${detail}`
                }),
                supplier_count: supplierList.length
            };
        }

        if (!geoResponse || !Array.isArray(geoResponse.affected_suppliers)) {
            return {
                ...failureEnvelope({
                    location, impact_description, assessment_radius_km: radius,
                    error: 'supplier_resilience_agent returned an unexpected payload'
                }),
                supplier_count: supplierList.length,
                impact_coords: (geoResponse && geoResponse.impact_coords) || null,
                message: geoResponse ? asStr(geoResponse.message) : ''
            };
        }

        const affected = geoResponse.affected_suppliers;
        logger.info(`analyzeImpact: /analyze returned ${affected.length} affected supplier(s)`);

        // ─── Step 3: enrich each affected supplier with S/4HANA PO data ──
        // Parallel fan-out. Per-supplier failure is captured in
        // enrichSupplierWithPOs, so a bad supplier never sinks the batch.
        const enriched = await Promise.all(
            affected.map((s) => enrichSupplierWithPOs(executeHttpRequest, logger, s))
        );

        // ─── Step 4: risk scoring via runEarlyWarningWithS4R ─────────────
        // Delegate the actual scoring to the existing CAP action so risk
        // logic stays in one place (calculateS4RRiskScore lives inside
        // service.js, closes over service-local helpers). We fan out ONE
        // multi-mode call for all affected suppliers' POs and then map
        // each returned supplier back onto our `enriched[]` list.
        //
        // TECH DEBT: We invoke another action via srv.send() here for
        // delivery speed. Long-term consider extracting the multi-mode
        // handler into `srv/lib/` so it can be called as a plain function
        // (matches the pattern used by this handler, create-impact-case,
        // get-case-hierarchy, etc.).
        let aggRiskScore        = null;
        let aggMaxPossibleScore = null;
        let aggRiskPercentage   = null;
        let aggRiskLevel        = null;

        try {
            // 4a. Flatten every PO from every affected supplier
            const allPOs = [];
            for (const s of enriched) {
                for (const po of (s.purchase_orders || [])) {
                    if (po.po_number) allPOs.push(po.po_number);
                }
            }

            if (allPOs.length > 0) {
                logger.info(
                    `analyzeImpact: Step 4 calling runEarlyWarningWithS4R with ` +
                    `${allPOs.length} PO(s) across ${enriched.length} supplier(s)`
                );

                // 4b. Single MULTI-MODE call. Prefer the already-loaded
                // service singleton (zero-overhead); fall back to
                // cds.connect.to for cold-start / test scenarios.
                const cds = require('@sap/cds');
                const srv = cds.services.SupplierResilienceService
                         || await cds.connect.to('SupplierResilienceService');

                const ew = await srv.send('runEarlyWarningWithS4R', { poList: allPOs });

                // 4c. Index the response by normalized supplierId
                const bySupplier = {};
                for (const s of ((ew && ew.suppliers) || [])) {
                    bySupplier[normalizeSupplierId(s.supplierId)] = s;
                }

                // 4d. Attach the 4 risk fields per supplier; track worst
                //     by riskPercentage to build the top-level aggregate.
                let matched = 0;
                let worst   = null;
                for (const s of enriched) {
                    const rs = bySupplier[normalizeSupplierId(s.supplier_id)];
                    if (rs) {
                        s.risk_score         = (rs.riskScore        !== undefined && rs.riskScore        !== null) ? rs.riskScore        : null;
                        s.max_possible_score = (rs.maxPossibleScore !== undefined && rs.maxPossibleScore !== null) ? rs.maxPossibleScore : null;
                        s.risk_percentage    = (rs.riskPercentage   !== undefined && rs.riskPercentage   !== null) ? rs.riskPercentage   : null;
                        s.risk_level         = rs.riskLevel || null;
                        matched++;

                        if (typeof s.risk_percentage === 'number' &&
                            (!worst || s.risk_percentage > worst.risk_percentage)) {
                            worst = s;
                        }
                    } else {
                        s.risk_score         = null;
                        s.max_possible_score = null;
                        s.risk_percentage    = null;
                        s.risk_level         = null;
                    }
                }
                logger.info(
                    `analyzeImpact: risk-score matched ${matched}/${enriched.length} supplier(s)`
                );

                // 4e. Top-level KPIs come from the "worst" supplier
                //     (highest riskPercentage) — matches the "HIGHEST RISK"
                //     tile semantics in the UI.
                if (worst) {
                    aggRiskScore        = worst.risk_score;
                    aggMaxPossibleScore = worst.max_possible_score;
                    aggRiskPercentage   = worst.risk_percentage;
                    aggRiskLevel        = worst.risk_level;
                }
            } else {
                logger.info(
                    'analyzeImpact: Step 4 skipped — no POs on any affected supplier'
                );
                // Still initialize the per-supplier fields to null so the
                // response shape is stable.
                for (const s of enriched) {
                    s.risk_score         = null;
                    s.max_possible_score = null;
                    s.risk_percentage    = null;
                    s.risk_level         = null;
                }
            }
        } catch (err) {
            logger.warn(
                'analyzeImpact: Step 4 (risk scoring) failed, returning null KPIs: ' +
                extractErrorDetail(err)
            );
            // Keep response usable: initialize any missing risk fields to
            // null so callers see the same shape whether Step 4 succeeded
            // or not.
            for (const s of enriched) {
                if (s.risk_score         === undefined) s.risk_score         = null;
                if (s.max_possible_score === undefined) s.max_possible_score = null;
                if (s.risk_percentage    === undefined) s.risk_percentage    = null;
                if (s.risk_level         === undefined) s.risk_level         = null;
            }
        }

        // ─── Build the final response ────────────────────────────────────
        return {
            success: true,
            location: asStr(geoResponse.location) || location,
            impact_description: asStr(geoResponse.impact_description) || impact_description,
            assessment_radius_km: geoResponse.assessment_radius_km || radius,
            impact_coords: geoResponse.impact_coords || null,
            supplier_count: supplierList.length,
            affected_supplier_count: enriched.length,
            message: asStr(geoResponse.message),
            error: '',
            // Aggregate risk metrics (from runEarlyWarningWithS4R via Step 4)
            riskScore:        aggRiskScore,
            maxPossibleScore: aggMaxPossibleScore,
            riskPercentage:   aggRiskPercentage,
            riskLevel:        aggRiskLevel,
            affected_suppliers: enriched
        };
    };
};

// Expose helpers so unit tests can exercise them independently
module.exports.asStr                 = asStr;
module.exports.normalizeSupplierId   = normalizeSupplierId;
module.exports.extractErrorDetail    = extractErrorDetail;
module.exports.invokeInternalHandler = invokeInternalHandler;
module.exports.enrichSupplierWithPOs = enrichSupplierWithPOs;
module.exports.failureEnvelope       = failureEnvelope;


