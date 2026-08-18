/**
 * Supplier Resilience Service Implementation
 *
 * Original `triggerDelayAlert` action is preserved exactly as-is (writes to
 * the `Cases` HANA table using the `delayedDays` field defined in
 * db/schema.cds).
 *
 * Additional agent-based handlers were added from the Python migration:
 *  - runCoordinator, runEarlyWarning, runSurvival
 *  - assessSupplier
 *  - health, getConfig
 *  - before/after CREATE hooks on Cases and DisruptionEvents
 *
 * Agent modules and optional entities are loaded defensively so that
 * server startup does not fail if any of them are not yet in place.
 */

'use strict';

const cds = require('@sap/cds');

// ─────────────────────────────────────────────────────────────────────────────
// Safe requires for agent modules — server still starts if any are missing
// ─────────────────────────────────────────────────────────────────────────────
let CoordinatorAgent, EarlyWarningAgent, SurvivalAgent;
try { ({ CoordinatorAgent } = require('./agents/coordinator')); }
catch (e) { console.warn('[Service] agents/coordinator not loaded:', e.message); }
try { ({ EarlyWarningAgent } = require('./agents/early-warning')); }
catch (e) { console.warn('[Service] agents/early-warning not loaded:', e.message); }
try { ({ SurvivalAgent } = require('./agents/survival')); }
catch (e) { console.warn('[Service] agents/survival not loaded:', e.message); }

// SAP Cloud SDK — used to call the S/4HANA `S4R` destination configured in
// the BTP Destination service. Loaded defensively so the CAP srv still starts
// locally even if the SDK is not yet installed.
let executeHttpRequest = null;
try {
    ({ executeHttpRequest } = require('@sap-cloud-sdk/http-client'));
} catch (e) {
    console.warn('[Service] @sap-cloud-sdk/http-client not loaded:', e.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities & constants
// ─────────────────────────────────────────────────────────────────────────────
const {
    APP_VERSION,
    RISK_WEIGHTS,
    DELAY_THRESHOLDS
} = require('./lib/constants');

const {
    getCurrentTimestamp,
    getDataMode,
    generateCaseId,
    generateEventId,
    createLogger
} = require('./lib/utils');

const logger = createLogger('Service');

// ═════════════════════════════════════════════════════════════════════════════
// SERVICE IMPLEMENTATION
// ═════════════════════════════════════════════════════════════════════════════

module.exports = cds.service.impl(async function () {

    // Get entity references (only Cases is guaranteed by db/schema.cds today;
    // the rest are looked up defensively before use)
    const { Cases } = this.entities;

    // Initialize agents lazily; if a class is missing we expose null and
    // the corresponding action will return a graceful error.
    const coordinatorAgent  = CoordinatorAgent  ? new CoordinatorAgent(this)  : null;
    const earlyWarningAgent = EarlyWarningAgent ? new EarlyWarningAgent(this) : null;
    const survivalAgent     = SurvivalAgent     ? new SurvivalAgent(this)     : null;

    logger.info('Supplier Resilience Service initialized');

    // ═════════════════════════════════════════════════════════════════════════
    // ORIGINAL ACTION — PRESERVED EXACTLY
    // Early Warning Agent - Trigger Delay Alert
    // Creates a new Case row in HANA on every call.
    // ═════════════════════════════════════════════════════════════════════════
    this.on('triggerDelayAlert', async (req) => {
        const { supplier, material, delayedDays, po, plant } = req.data;

        // Validate required fields
        if (!supplier || !material || delayedDays === undefined) {
            return {
                success: false,
                message: 'Missing required fields: supplier, material, and delayedDays are required',
                caseId: null,
                eventId: null,
                priority: null,
                alertTime: null
            };
        }

        // Generate unique IDs (original format — CASE-<epochMs>)
        const timestamp = Date.now();
        const caseId    = `CASE-${timestamp}`;
        const eventId   = `EVT-${timestamp}`;
        const alertTime = new Date().toISOString();

        // Calculate priority based on delay days
        let priority;
        if (delayedDays >= 14) {
            priority = 'Critical';
        } else if (delayedDays >= 7) {
            priority = 'High';
        } else if (delayedDays >= 3) {
            priority = 'Medium';
        } else {
            priority = 'Low';
        }

        try {
            // Insert new case record into database (uses schema column `delayedDays`)
            await INSERT.into(Cases).entries({
                caseId:      caseId,
                eventId:     eventId,
                eventType:   'Delivery Delay',
                status:      'Open',
                priority:    priority,
                supplier:    supplier || '',
                material:    material || '',
                delayDays:   delayedDays,
                po:          po    || '',
                plant:       plant || '',
                eventTime:   alertTime
            });

            // Log the alert
            console.log(`[Early Warning Agent] ALERT TRIGGERED!`);
            console.log(`  Case ID: ${caseId}`);
            console.log(`  Supplier: ${supplier}`);
            console.log(`  Material: ${material}`);
            console.log(`  Delayed Days: ${delayedDays}`);
            console.log(`  Priority: ${priority}`);
            console.log(`  Alert Time: ${alertTime}`);

            return {
                success: true,
                message: `🚨 Early Warning Alert! Delivery delay of ${delayedDays} days detected for supplier "${supplier}" on material "${material}". Priority: ${priority}`,
                caseId:    caseId,
                eventId:   eventId,
                priority:  priority,
                alertTime: alertTime
            };

        } catch (error) {
            console.error('[Early Warning Agent] Error creating case:', error);
            return {
                success: false,
                message: `Failed to create alert: ${error.message}`,
                caseId:    null,
                eventId:   null,
                priority:  null,
                alertTime: null
            };
        }
    });

    // ═════════════════════════════════════════════════════════════════════════
    // ACTION: Run Coordinator Agent
    // Equivalent to: POST /api/v1/agents/coordinator/run
    // ═════════════════════════════════════════════════════════════════════════
    this.on('runCoordinator', async (req) => {
        logger.info('runCoordinator action called');

        if (!coordinatorAgent) {
            return { success: false, error: 'CoordinatorAgent module is not available' };
        }

        const eventData = {
            eventId:    req.data.eventId,
            eventType:  req.data.eventType,
            eventTime:  req.data.eventTime,
            po:         req.data.po,
            supplier:   req.data.supplier,
            material:   req.data.material,
            plant:      req.data.plant,
            delayDays:  req.data.delayDays
        };

        try {
            const result = await coordinatorAgent.run(eventData);
            return result;
        } catch (error) {
            logger.error(`runCoordinator error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    // ═════════════════════════════════════════════════════════════════════════
    // ACTION: Run Early Warning Agent
    // Equivalent to: POST /api/v1/agents/early-warning/run
    // ═════════════════════════════════════════════════════════════════════════
    this.on('runEarlyWarning', async (req) => {
        logger.info('runEarlyWarning action called');

        if (!earlyWarningAgent) {
            return { success: false, error: 'EarlyWarningAgent module is not available' };
        }

        const input = {
            caseId:    req.data.caseId,
            supplier:  req.data.supplier,
            material:  req.data.material,
            plant:     req.data.plant,
            delayDays: req.data.delayDays
        };

        try {
            const result = await earlyWarningAgent.run(input);
            return result;
        } catch (error) {
            logger.error(`runEarlyWarning error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    // ═════════════════════════════════════════════════════════════════════════
    // ACTION: Run Early Warning Agent with S4R Data
    // Uses real-time data from S/4HANA - no mock data
    // ═════════════════════════════════════════════════════════════════════════
    this.on('runEarlyWarningWithS4R', async (req) => {
        logger.info('runEarlyWarningWithS4R action called');

        const { po } = req.data;
        let { caseId } = req.data;
        let caseIdGenerated = false;

        // Validate required input
        if (!po) {
            return {
                success: false, agent: 'EARLY_WARNING', caseId: caseId || null,
                caseIdGenerated: false, status: 'FAILED',
                error: 'Purchase Order number (po) is required'
            };
        }

        // Auto-generate caseId if not provided
        if (!caseId) {
            caseId = generateCaseId();
            caseIdGenerated = true;
            logger.info(`Auto-generated caseId: ${caseId}`);
        }

        try {
            logger.info(`Fetching S4R data for PO: ${po}`);

            if (!executeHttpRequest) {
                return {
                    success: false, agent: 'EARLY_WARNING', caseId: caseId,
                    caseIdGenerated, status: 'FAILED', poNumber: po,
                    error: '@sap-cloud-sdk/http-client is not available'
                };
            }

            // Call internal S4R fetch
            const s4rResponse = await fetchPurchaseOrderDetailsInternal(po, executeHttpRequest, logger);
            if (!s4rResponse.success) {
                return {
                    success: false, agent: 'EARLY_WARNING', caseId, caseIdGenerated,
                    status: 'FAILED', poNumber: po,
                    error: `Failed to fetch S4R data: ${s4rResponse.error}`
                };
            }

            // Extract metrics and compute risk
            const { extractEarlyWarningData } = require('./lib/s4r-data-extractor');
            const s4rData = extractEarlyWarningData(s4rResponse);
            const scoreResult = calculateS4RRiskScore(s4rData);
            const topRiskDrivers = buildS4RRiskDrivers(s4rData, scoreResult);

            // Build response
            const output = buildS4ROutput(caseId, caseIdGenerated, s4rData, scoreResult, topRiskDrivers);
            logger.info(`Early Warning S4R completed: PO=${po}, riskScore=${output.riskScore}, riskLevel=${output.riskLevel}`);
            return output;

        } catch (error) {
            logger.error(`runEarlyWarningWithS4R error: ${error.message}`);
            return {
                success: false, agent: 'EARLY_WARNING', caseId, caseIdGenerated,
                status: 'FAILED', poNumber: po, error: error.message
            };
        }
    });

    // ═════════════════════════════════════════════════════════════════════════
    // ACTION: Run Survival Agent
    // Equivalent to: POST /api/v1/agents/survival/run
    // ═════════════════════════════════════════════════════════════════════════
    this.on('runSurvival', async (req) => {
        logger.info('runSurvival action called');

        if (!survivalAgent) {
            return { success: false, error: 'SurvivalAgent module is not available' };
        }

        const input = {
            caseId:                req.data.caseId,
            material:              req.data.material,
            plant:                 req.data.plant,
            supplierRecoveryWeeks: req.data.supplierRecoveryWeeks
        };

        try {
            const result = await survivalAgent.run(input);
            return result;
        } catch (error) {
            logger.error(`runSurvival error: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    // ═════════════════════════════════════════════════════════════════════════
    // FUNCTION: Assess Supplier
    // Equivalent to: GET /api/v1/suppliers/{id}/assess
    // ═════════════════════════════════════════════════════════════════════════
    this.on('assessSupplier', async (req) => {
        logger.info('assessSupplier function called');

        const { supplierId, delayDays } = req.data;

        if (!earlyWarningAgent || typeof earlyWarningAgent.assessSupplier !== 'function') {
            return {
                success: false,
                supplierId: supplierId,
                error: 'EarlyWarningAgent.assessSupplier is not available'
            };
        }

        try {
            const result = await earlyWarningAgent.assessSupplier(supplierId, delayDays || 0);
            return result;
        } catch (error) {
            logger.error(`assessSupplier error: ${error.message}`);
            return { success: false, supplierId: supplierId, error: error.message };
        }
    });

    // ═════════════════════════════════════════════════════════════════════════
    // FUNCTION: Health Check
    // Equivalent to: GET /api/v1/health
    // ═════════════════════════════════════════════════════════════════════════
    this.on('health', () => {
        logger.info('health function called');

        return {
            status:    'healthy',
            timestamp: getCurrentTimestamp(),
            dataMode:  getDataMode(),
            version:   APP_VERSION,
            agents: {
                coordinator:  coordinatorAgent  ? 'active' : 'unavailable',
                earlyWarning: earlyWarningAgent ? 'active' : 'unavailable',
                survival:     survivalAgent     ? 'active' : 'unavailable'
            }
        };
    });

    // ═════════════════════════════════════════════════════════════════════════
    // FUNCTION: Get Configuration
    // ═════════════════════════════════════════════════════════════════════════
    this.on('getConfig', () => {
        logger.info('getConfig function called');

        return {
            dataMode: getDataMode(),
            riskWeights: {
                supplierPerformance: RISK_WEIGHTS.supplierPerformance,
                delaySeverity:       RISK_WEIGHTS.delaySeverity,
                materialCriticality: RISK_WEIGHTS.materialCriticality,
                affectedScope:       RISK_WEIGHTS.affectedScope,
                revenueExposure:     RISK_WEIGHTS.revenueExposure,
                total: 100
            },
            riskLevels: {
                low:    '0-39',
                medium: '40-69',
                high:   '70-100'
            },
            delayThresholds: {
                minor:       DELAY_THRESHOLDS.minor,
                moderate:    DELAY_THRESHOLDS.moderate,
                significant: DELAY_THRESHOLDS.significant
            }
        };
    });

    // ═════════════════════════════════════════════════════════════════════════
    // DASHBOARD API HANDLERS
    // These handlers implement the dashboard functions defined in service.cds
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * List Cases with Filters
     * GET /odata/v4/supplier-resilience/listCases(...)
     */
    this.on('listCases', async (req) => {
        logger.info('listCases function called');
        
        const { status, priority, plant, supplier, fromDate, toDate, limit } = req.data;
        const maxResults = limit || 100;
        
        try {
            const { Cases } = this.entities;
            
            // Build query with filters
            let query = SELECT.from(Cases);
            const conditions = [];
            
            if (status) {
                conditions.push({ status: status });
            }
            if (priority) {
                conditions.push({ priority: priority });
            }
            if (plant) {
                conditions.push({ plant: plant });
            }
            if (supplier) {
                conditions.push({ supplier: supplier });
            }
            
            if (conditions.length > 0) {
                query = query.where(conditions.reduce((acc, cond) => ({ ...acc, ...cond }), {}));
            }
            
            query = query.limit(maxResults).orderBy({ createdAt: 'desc' });
            
            const cases = await query;
            
            // Format response
            const formattedCases = cases.map(c => ({
                caseId: c.caseId,
                eventId: c.eventId,
                status: c.status,
                priority: c.priority,
                po: c.po,
                supplier: c.supplier,
                material: c.material,
                plant: c.plant,
                delayDays: c.delayDays,
                eventType: c.eventType,
                createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
                recommendation: c.recommendation
            }));
            
            return {
                success: true,
                count: formattedCases.length,
                cases: formattedCases
            };
            
        } catch (error) {
            logger.error(`listCases error: ${error.message}`);
            return {
                success: false,
                count: 0,
                cases: []
            };
        }
    });

    /**
     * Get Case Detail with Agent Results
     * GET /odata/v4/supplier-resilience/getCaseDetail(caseId='...')
     */
    this.on('getCaseDetail', async (req) => {
        logger.info('getCaseDetail function called');
        
        const { caseId } = req.data;
        
        if (!caseId) {
            return {
                success: false,
                caseData: null,
                earlyWarning: null,
                survival: null,
                error: 'caseId is required'
            };
        }
        
        try {
            const { Cases, EarlyWarningResults, SurvivalResults } = this.entities;
            
            // Get case data
            const caseData = await SELECT.one.from(Cases).where({ caseId: caseId });
            
            if (!caseData) {
                return {
                    success: false,
                    caseData: null,
                    earlyWarning: null,
                    survival: null,
                    error: `Case not found: ${caseId}`
                };
            }
            
            // Get early warning result — first try persisted result, else run agent on-demand
            let earlyWarning = null;
            if (EarlyWarningResults) {
                const ewResult = await SELECT.one.from(EarlyWarningResults).where({ caseId: caseId });
                if (ewResult) {
                    earlyWarning = {
                        status: ewResult.status,
                        riskScore: ewResult.riskScore,
                        riskLevel: ewResult.riskLevel,
                        supplierPerformanceScore: ewResult.supplierPerformanceScore,
                        delaySeverityScore: ewResult.delaySeverityScore,
                        materialCriticalityScore: ewResult.materialCriticalityScore,
                        affectedScopeScore: ewResult.affectedScopeScore,
                        revenueExposureScore: ewResult.revenueExposureScore,
                        supplierId: ewResult.supplierId,
                        supplierName: ewResult.supplierName,
                        supplierOtif: ewResult.supplierOtif,
                        supplierTrend: ewResult.supplierTrend,
                        materialId: ewResult.materialId,
                        materialCriticality: ewResult.materialCriticality,
                        affectedPlants: JSON.parse(ewResult.affectedPlants || '[]'),
                        affectedSkus: JSON.parse(ewResult.affectedSkus || '[]'),
                        topRiskDrivers: JSON.parse(ewResult.topRiskDrivers || '[]'),
                        calculatedAt: ewResult.calculatedAt ? new Date(ewResult.calculatedAt).toISOString() : null
                    };
                }
            }
            
            // If no persisted early-warning result, run the agent on-demand so the UI
            // always sees at least one agent output for each case.
            if (!earlyWarning && earlyWarningAgent) {
                try {
                    const ewLive = await earlyWarningAgent.run({
                        caseId:    caseData.caseId,
                        supplier:  caseData.supplier,
                        material:  caseData.material,
                        plant:     caseData.plant,
                        delayDays: caseData.delayDays
                    });
                    if (ewLive) {
                        const bd = ewLive.scoreBreakdown || {};
                        earlyWarning = {
                            status:                   ewLive.status,
                            riskScore:                ewLive.riskScore,
                            riskLevel:                ewLive.riskLevel,
                            supplierPerformanceScore: bd.supplierPerformance || 0,
                            delaySeverityScore:       bd.delaySeverity || 0,
                            materialCriticalityScore: bd.materialCriticality || 0,
                            affectedScopeScore:       bd.affectedScope || 0,
                            revenueExposureScore:     bd.revenueExposure || 0,
                            supplierId:               ewLive.supplierId,
                            supplierName:             ewLive.supplierName,
                            supplierOtif:             ewLive.supplierOtif,
                            supplierTrend:            ewLive.supplierTrend,
                            materialId:               ewLive.materialId,
                            materialCriticality:      ewLive.materialCriticality,
                            affectedPlants:           ewLive.affectedPlants || [],
                            affectedSkus:             ewLive.affectedSkus || [],
                            topRiskDrivers:           ewLive.topRiskDrivers || [],
                            calculatedAt:             ewLive.calculatedAt || getCurrentTimestamp()
                        };
                    }
                } catch (ewErr) {
                    logger.warn(`getCaseDetail: on-demand early-warning failed: ${ewErr.message}`);
                }
            }
            
            // Get survival result — first try persisted result, else run agent on-demand
            let survival = null;
            if (SurvivalResults) {
                const survResult = await SELECT.one.from(SurvivalResults).where({ caseId: caseId });
                if (survResult) {
                    survival = {
                        status: survResult.status,
                        material: survResult.material,
                        plant: survResult.plant,
                        currentStock: parseFloat(survResult.currentStock) || 0,
                        blockedStock: parseFloat(survResult.blockedStock) || 0,
                        reservedStock: parseFloat(survResult.reservedStock) || 0,
                        inTransitStock: parseFloat(survResult.inTransitStock) || 0,
                        availableInventory: parseFloat(survResult.availableInventory) || 0,
                        calculationFormula: survResult.calculationFormula,
                        weeklyDemand: parseFloat(survResult.weeklyDemand) || 0,
                        unit: survResult.unit,
                        survivalWeeks: parseFloat(survResult.survivalWeeks) || 0,
                        supplierRecoveryWeeks: survResult.supplierRecoveryWeeks,
                        coverageGapWeeks: parseFloat(survResult.coverageGapWeeks) || 0,
                        uncoveredWeeks: parseFloat(survResult.uncoveredWeeks) || 0,
                        shortfallQuantity: parseFloat(survResult.shortfallQuantity) || 0,
                        actionRequired: survResult.actionRequired,
                        calculatedAt: survResult.calculatedAt ? new Date(survResult.calculatedAt).toISOString() : null
                    };
                }
            }
            
            // If no persisted survival result, run the agent on-demand so the UI
            // always sees at least one agent output for each case.
            if (!survival && survivalAgent) {
                try {
                    const survLive = await survivalAgent.run({
                        caseId:                caseData.caseId,
                        material:              caseData.material,
                        plant:                 caseData.plant,
                        supplierRecoveryWeeks: 4
                    });
                    if (survLive) {
                        const ib = survLive.inventoryBreakdown || {};
                        survival = {
                            status:                survLive.status,
                            material:              survLive.material,
                            plant:                 survLive.plant,
                            currentStock:          parseFloat(ib.currentStock) || 0,
                            blockedStock:          parseFloat(ib.blockedStock) || 0,
                            reservedStock:         parseFloat(ib.reservedStock) || 0,
                            inTransitStock:        parseFloat(ib.inTransitStock) || 0,
                            availableInventory:    parseFloat(survLive.availableInventory) || 0,
                            calculationFormula:    ib.calculationFormula,
                            weeklyDemand:          parseFloat(survLive.weeklyDemand) || 0,
                            unit:                  survLive.unit,
                            survivalWeeks:         parseFloat(survLive.survivalWeeks) || 0,
                            supplierRecoveryWeeks: survLive.supplierRecoveryWeeks,
                            coverageGapWeeks:      parseFloat(survLive.coverageGapWeeks) || 0,
                            uncoveredWeeks:        parseFloat(survLive.uncoveredWeeks) || 0,
                            shortfallQuantity:     parseFloat(survLive.shortfallQuantity) || 0,
                            actionRequired:        survLive.actionRequired,
                            calculatedAt:          survLive.calculatedAt || getCurrentTimestamp()
                        };
                    }
                } catch (survErr) {
                    logger.warn(`getCaseDetail: on-demand survival failed: ${survErr.message}`);
                }
            }
            
            return {
                success: true,
                caseData: {
                    caseId: caseData.caseId,
                    eventId: caseData.eventId,
                    runId: caseData.runId,
                    status: caseData.status,
                    priority: caseData.priority,
                    eventType: caseData.eventType,
                    po: caseData.po,
                    supplier: caseData.supplier,
                    material: caseData.material,
                    plant: caseData.plant,
                    delayDays: caseData.delayDays,
                    eventTime: caseData.eventTime ? new Date(caseData.eventTime).toISOString() : null,
                    createdAt: caseData.createdAt ? new Date(caseData.createdAt).toISOString() : null,
                    completedAt: caseData.completedAt ? new Date(caseData.completedAt).toISOString() : null,
                    recommendation: caseData.recommendation,
                    dataSource: caseData.dataSource
                },
                earlyWarning: earlyWarning,
                survival: survival,
                error: null
            };
            
        } catch (error) {
            logger.error(`getCaseDetail error: ${error.message}`);
            return {
                success: false,
                caseData: null,
                earlyWarning: null,
                survival: null,
                error: error.message
            };
        }
    });

    /**
     * Get Purchase Order Details from S/4HANA
     * GET /odata/v4/supplier-resilience/getPurchaseOrderDetails(po='...')
     *
     * Consumes the BTP `S4R` destination and calls two S/4HANA OData v2
     * endpoints of API_PURCHASEORDER_PROCESS_SRV in parallel:
     *   - A_PurchaseOrder('<po>')                 → header
     *   - A_PurchaseOrderItem?$filter=PurchaseOrder eq '<po>'  → items
     * The raw responses are normalized into flat objects for the UI.
     */
    this.on('getPurchaseOrderDetails', async (req) => {
        logger.info('getPurchaseOrderDetails function called');

        const { po } = req.data;

        if (!po) {
            return {
                success: false,
                po: null,
                purchaseOrder: null,
                purchaseOrderItems: [],
                error: 'po is required'
            };
        }

        if (!executeHttpRequest) {
            return {
                success: false,
                po: po,
                purchaseOrder: null,
                purchaseOrderItems: [],
                error: '@sap-cloud-sdk/http-client is not available on the server'
            };
        }

        // OData v2 endpoints of API_PURCHASEORDER_PROCESS_SRV
        const HEADER_URL =
            `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder('${encodeURIComponent(po)}')?$format=json`;
        const ITEMS_URL =
            `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem?$filter=` +
            encodeURIComponent(`PurchaseOrder eq '${po}'`) + `&$format=json`;

        // OData v2 endpoint of API_PURCHASEORDER_PROCESS_SRV — schedule lines
        // Contains delivery dates per PO item; one item can have multiple schedule lines
        // (e.g., split deliveries). Key fields: ScheduleLineDeliveryDate, SchedLineStscDeliveryDate
        const SCHEDULE_LINES_URL =
            `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderScheduleLine?$filter=` +
            encodeURIComponent(`PurchasingDocument eq '${po}'`) +
            `&$select=PurchasingDocument,PurchasingDocumentItem,ScheduleLine,` +
            `ScheduleLineDeliveryDate,SchedLineStscDeliveryDate,ScheduleLineOrderQuantity,` +
            `PurchaseOrderQuantityUnit,DelivDateCategory` +
            `&$format=json`;

        // OData v2 endpoint of API_MATERIAL_DOCUMENT_SRV — goods movements
        // (101 = GR against PO, 102 = reversal of GR, 122 = return delivery)
        // for the same PO. Reuses the same `S4R` destination.
        // NOTE: PostingDate, DocumentDate, CreatedByUser, etc. are NOT available on
        // A_MaterialDocumentItem — they exist on A_MaterialDocumentHeader.
        // We fetch items first, then fetch headers for matching documents in a
        // second call to populate header-level fields (Option 3: Two-Step Targeted).
        const MATERIAL_DOC_ITEM_URL =
            `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem?$select=` +
            `MaterialDocument,MaterialDocumentYear,MaterialDocumentItem,` +
            `PurchaseOrder,PurchaseOrderItem,GoodsMovementType,` +
            `Material,Plant,QuantityInEntryUnit,EntryUnit,Supplier` +
            `&$filter=` +
            encodeURIComponent(
                `PurchaseOrder eq '${po}' and (` +
                `GoodsMovementType eq '101' or ` +
                `GoodsMovementType eq '102' or ` +
                `GoodsMovementType eq '122')`
            ) +
            `&$format=json`;

        const destination = { destinationName: 'S4R' };
        const commonOptions = {
            method: 'GET',
            headers: { Accept: 'application/json' }
        };

        try {
            logger.info(`getPurchaseOrderDetails calling S4R for PO ${po}`);
            // Call all four endpoints in parallel. The material-document and schedule-lines
            // calls are wrapped so their failure does NOT reject the whole
            // Promise.all — header/items must remain available even if optional
            // services are unavailable or the PO has no GRs/schedule lines.
            const [headerResp, itemsResp, schedLinesRespOrErr, matDocItemRespOrErr] = await Promise.all([
                executeHttpRequest(destination, { ...commonOptions, url: HEADER_URL }),
                executeHttpRequest(destination, { ...commonOptions, url: ITEMS_URL }),
                executeHttpRequest(destination, { ...commonOptions, url: SCHEDULE_LINES_URL })
                    .catch((err) => {
                        logger.warn(`getPurchaseOrderDetails schedule-lines call failed: ${err && err.message ? err.message : err}`);
                        return { __failed: true, error: err };
                    }),
                executeHttpRequest(destination, { ...commonOptions, url: MATERIAL_DOC_ITEM_URL })
                    .catch((err) => {
                        logger.warn(`getPurchaseOrderDetails material-document-item call failed: ${err && err.message ? err.message : err}`);
                        return { __failed: true, error: err };
                    })
            ]);

            // Both v2 payload shapes are handled: { d: { ... } } for a single
            // entity and { d: { results: [ ... ] } } for a collection. If the
            // service is v4 (unlikely for this SRV, but harmless), fall back
            // to the raw body.
            const hData = headerResp && headerResp.data ? headerResp.data : {};
            const iData = itemsResp && itemsResp.data ? itemsResp.data : {};

            const rawHeader = (hData.d && !hData.d.results) ? hData.d
                : (hData.d && hData.d.results && hData.d.results[0]) ? hData.d.results[0]
                : hData;

            const rawItems = (iData.d && Array.isArray(iData.d.results)) ? iData.d.results
                : (Array.isArray(iData.value)) ? iData.value
                : (Array.isArray(iData)) ? iData
                : [];

            // Normalize (stringify) known fields; keep only what the CDS type declares
            const asStr = (v) => (v === undefined || v === null) ? '' : String(v);

            // Convert OData v2 date format "/Date(timestamp)/" to ISO 8601 format
            // Example: "/Date(1786320000000)/" -> "2026-08-10"
            const parseODataDate = (v) => {
                if (!v || typeof v !== 'string') return '';
                const match = v.match(/\/Date\((-?\d+)\)\//);
                if (match) {
                    const timestamp = parseInt(match[1], 10);
                    const date = new Date(timestamp);
                    // Return ISO date string (YYYY-MM-DD format for date-only fields)
                    return date.toISOString().split('T')[0];
                }
                // If not OData format, return as string
                return String(v);
            };

            const purchaseOrder = rawHeader ? {
                PurchaseOrder:               asStr(rawHeader.PurchaseOrder),
                PurchaseOrderType:           asStr(rawHeader.PurchaseOrderType),
                CompanyCode:                 asStr(rawHeader.CompanyCode),
                PurchasingOrganization:      asStr(rawHeader.PurchasingOrganization),
                PurchasingGroup:             asStr(rawHeader.PurchasingGroup),
                Supplier:                    asStr(rawHeader.Supplier),
                SupplierPhoneNumber:         asStr(rawHeader.SupplierPhoneNumber),
                DocumentCurrency:            asStr(rawHeader.DocumentCurrency),
                PurchaseOrderDate:           parseODataDate(rawHeader.PurchaseOrderDate),
                CreatedByUser:               asStr(rawHeader.CreatedByUser),
                CreationDate:                parseODataDate(rawHeader.CreationDate),
                LastChangeDateTime:          parseODataDate(rawHeader.LastChangeDateTime),
                PurchaseOrderNetAmount:      asStr(rawHeader.PurchaseOrderNetAmount),
                Language:                    asStr(rawHeader.Language),
                PaymentTerms:                asStr(rawHeader.PaymentTerms),
                AddressName:                 asStr(rawHeader.AddressName),
                AddressCityName:             asStr(rawHeader.AddressCityName),
                AddressCountry:              asStr(rawHeader.AddressCountry)
            } : null;

            const purchaseOrderItems = rawItems.map((it) => ({
                PurchaseOrder:              asStr(it.PurchaseOrder),
                PurchaseOrderItem:          asStr(it.PurchaseOrderItem),
                PurchaseOrderItemText:      asStr(it.PurchaseOrderItemText),
                Material:                   asStr(it.Material),
                Plant:                      asStr(it.Plant),
                StorageLocation:            asStr(it.StorageLocation),
                OrderQuantity:              asStr(it.OrderQuantity),
                PurchaseOrderQuantityUnit:  asStr(it.PurchaseOrderQuantityUnit),
                NetPriceAmount:             asStr(it.NetPriceAmount),
                NetPriceQuantity:           asStr(it.NetPriceQuantity),
                DocumentCurrency:           asStr(it.DocumentCurrency),
                ScheduleLineDeliveryDate:   asStr(it.ScheduleLineDeliveryDate),
                IsCompletelyDelivered:      it.IsCompletelyDelivered === true || it.IsCompletelyDelivered === 'true',
                PurchaseOrderItemCategory:  asStr(it.PurchaseOrderItemCategory)
            }));

            // Normalize Material Document rows. If the parallel call failed
            // we return an empty array so header/items still render on the UI.
            // 
            // OPTION 3 IMPLEMENTATION: Two-Step Targeted Approach
            // Step 1: Get items (already done above via MATERIAL_DOC_ITEM_URL)
            // Step 2: Extract unique MaterialDocument + MaterialDocumentYear keys
            // Step 3: Fetch only those specific headers from A_MaterialDocumentHeader
            // Step 4: Create lookup map and merge header fields into items
            let materialDocuments = [];
            if (matDocItemRespOrErr && !matDocItemRespOrErr.__failed) {
                const mData = matDocItemRespOrErr.data ? matDocItemRespOrErr.data : {};
                const rawMatDocs = (mData.d && Array.isArray(mData.d.results)) ? mData.d.results
                    : (Array.isArray(mData.value)) ? mData.value
                    : (Array.isArray(mData)) ? mData
                    : [];

                // Step 2: Extract unique document keys from items
                const uniqueDocKeys = [...new Map(
                    rawMatDocs.map(md => [
                        `${md.MaterialDocument}-${md.MaterialDocumentYear}`,
                        { doc: md.MaterialDocument, year: md.MaterialDocumentYear }
                    ])
                ).values()];

                // Step 3: Fetch headers for those specific documents (if any items exist)
                let matDocHeaderMap = new Map();
                if (uniqueDocKeys.length > 0) {
                    try {
                        // Build $filter with OR conditions for each unique document
                        const headerFilterParts = uniqueDocKeys.map(k =>
                            `(MaterialDocument eq '${k.doc}' and MaterialDocumentYear eq '${k.year}')`
                        );
                        const headerFilter = headerFilterParts.join(' or ');

                        // Note: BillOfLading and ReferenceDocument are not available on all
                        // S/4HANA versions/configurations. They have been removed from $select
                        // to avoid 404 "Resource not found for segment" errors.
                        const MATERIAL_DOC_HEADER_URL =
                            `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader?$select=` +
                            `MaterialDocument,MaterialDocumentYear,PostingDate,DocumentDate,` +
                            `CreatedByUser,CreationDate` +
                            `&$filter=${encodeURIComponent(headerFilter)}` +
                            `&$format=json`;

                        logger.info(`getPurchaseOrderDetails fetching ${uniqueDocKeys.length} material document header(s)`);
                        const matDocHeaderResp = await executeHttpRequest(destination, {
                            ...commonOptions,
                            url: MATERIAL_DOC_HEADER_URL
                        });

                        // Parse header response and build lookup map
                        const hdrData = matDocHeaderResp && matDocHeaderResp.data ? matDocHeaderResp.data : {};
                        const rawHeaders = (hdrData.d && Array.isArray(hdrData.d.results)) ? hdrData.d.results
                            : (Array.isArray(hdrData.value)) ? hdrData.value
                            : (Array.isArray(hdrData)) ? hdrData
                            : [];

                        // Step 4a: Create lookup map keyed by "MaterialDocument-Year"
                        rawHeaders.forEach(hdr => {
                            const key = `${hdr.MaterialDocument}-${hdr.MaterialDocumentYear}`;
                            matDocHeaderMap.set(key, hdr);
                        });
                        logger.info(`getPurchaseOrderDetails loaded ${matDocHeaderMap.size} material document header(s)`);
                    } catch (hdrErr) {
                        // If header fetch fails, continue without header data (items still available)
                        logger.warn(`getPurchaseOrderDetails material-document-header call failed: ${hdrErr && hdrErr.message ? hdrErr.message : hdrErr}`);
                    }
                }

                // Step 4b: Merge header fields into each item row
                materialDocuments = rawMatDocs.map((md) => {
                    const headerKey = `${md.MaterialDocument}-${md.MaterialDocumentYear}`;
                    const hdr = matDocHeaderMap.get(headerKey) || {};

                    return {
                        // Keys
                        MaterialDocument:     asStr(md.MaterialDocument),
                        MaterialDocumentYear: asStr(md.MaterialDocumentYear),
                        MaterialDocumentItem: asStr(md.MaterialDocumentItem),
                        // Header-level fields (from A_MaterialDocumentHeader)
                        // Date fields converted from OData v2 format to ISO 8601 (YYYY-MM-DD)
                        PostingDate:          parseODataDate(hdr.PostingDate),    // e.g. "2026-08-10"
                        DocumentDate:         parseODataDate(hdr.DocumentDate),   // e.g. "2026-08-10"
                        CreatedByUser:        asStr(hdr.CreatedByUser),           // User ID (string)
                        CreationDate:         parseODataDate(hdr.CreationDate),   // e.g. "2026-08-10"
                        ReferenceDocument:    asStr(hdr.ReferenceDocument),       // Delivery ref (not available)
                        BillOfLading:         asStr(hdr.BillOfLading),            // Shipment ref (not available)
                        // Item-level fields (from A_MaterialDocumentItem)
                        GoodsMovementType:    asStr(md.GoodsMovementType),
                        PurchaseOrder:        asStr(md.PurchaseOrder),
                        PurchaseOrderItem:    asStr(md.PurchaseOrderItem),
                        Material:             asStr(md.Material),
                        Plant:                asStr(md.Plant),
                        QuantityInEntryUnit:  asStr(md.QuantityInEntryUnit),
                        EntryUnit:            asStr(md.EntryUnit),
                        Supplier:             asStr(md.Supplier)
                    };
                });
            }

            // Parse and format Schedule Lines from A_PurchaseOrderScheduleLine
            // Each PO item can have multiple schedule lines (e.g., split deliveries)
            let scheduleLines = [];
            if (schedLinesRespOrErr && !schedLinesRespOrErr.__failed) {
                const slData = schedLinesRespOrErr.data ? schedLinesRespOrErr.data : {};
                const rawScheduleLines = (slData.d && Array.isArray(slData.d.results)) ? slData.d.results
                    : (Array.isArray(slData.value)) ? slData.value
                    : (Array.isArray(slData)) ? slData
                    : [];

                scheduleLines = rawScheduleLines.map((sl) => ({
                    // Keys - map from A_PurchaseOrderScheduleLine field names
                    PurchaseOrder:              asStr(sl.PurchasingDocument),       // Note: API uses PurchasingDocument
                    PurchaseOrderItem:          asStr(sl.PurchasingDocumentItem),   // Note: API uses PurchasingDocumentItem
                    ScheduleLine:               asStr(sl.ScheduleLine),
                    // Delivery dates converted from OData v2 format to ISO 8601 (YYYY-MM-DD)
                    ScheduleLineDeliveryDate:   parseODataDate(sl.ScheduleLineDeliveryDate),    // Planned delivery date
                    SchedLineStscDeliveryDate:  parseODataDate(sl.SchedLineStscDeliveryDate),   // Statistical/confirmed date
                    // Quantity and unit
                    ScheduleLineOrderQuantity:  asStr(sl.ScheduleLineOrderQuantity),
                    PurchaseOrderQuantityUnit:  asStr(sl.PurchaseOrderQuantityUnit),
                    // Delivery date category (1 = confirmed, etc.)
                    DelivDateCategory:          asStr(sl.DelivDateCategory)
                }));

                logger.info(`getPurchaseOrderDetails loaded ${scheduleLines.length} schedule line(s)`);
            }

            return {
                success: true,
                po: po,
                purchaseOrder: purchaseOrder,
                purchaseOrderItems: purchaseOrderItems,
                scheduleLines: scheduleLines,
                materialDocuments: materialDocuments,
                error: null
            };

        } catch (error) {
            // The SAP Cloud SDK often wraps the real cause deep inside
            // error.cause / error.rootCause / axios error.response. Surface as
            // much detail as possible so the browser payload tells us WHY it
            // failed (missing service binding, 401 from S/4, ETIMEDOUT via
            // Cloud Connector, destination not found, etc.).
            const detail =
                (error && error.rootCause && error.rootCause.message) ||
                (error && error.cause     && error.cause.message)     ||
                (error && error.response  && error.response.data && (
                    (error.response.data.error && (error.response.data.error.message && error.response.data.error.message.value || error.response.data.error.message)) ||
                    (typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data).substring(0, 500))
                )) ||
                (error && error.message) ||
                String(error);

            logger.error(`getPurchaseOrderDetails error: ${detail}`);
            if (error && error.stack) {
                logger.error(error.stack);
            }
            return {
                success: false,
                po: po,
                purchaseOrder: null,
                purchaseOrderItems: [],
                scheduleLines: [],
                materialDocuments: [],
                error: detail
            };
        }
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // SUPPLIER HISTORICAL OTIF - Get aggregate OTIF for a supplier's POs
    // ═══════════════════════════════════════════════════════════════════════════
    this.on('getSupplierHistoricalOtif', require('./lib/supplier-otif-handler').bind(this, executeHttpRequest, getCurrentTimestamp, logger));

    // ═══════════════════════════════════════════════════════════════════════════
    // GET SUPPLIER WITH ADDRESS - Fetch suppliers and their addresses from S4R
    // ═══════════════════════════════════════════════════════════════════════════
    this.on('Get_supplier', require('./lib/get-supplier-handler').bind(this, executeHttpRequest, logger));

    // ═══════════════════════════════════════════════════════════════════════════
    // GET SUPPLIER DETAILS - Fetch POs and their items for a given supplier
    // ═══════════════════════════════════════════════════════════════════════════
    this.on('GET_SupplierDetails', require('./lib/get-supplier-details-handler').bind(this, executeHttpRequest, logger));

    /**
     * Get Case History / Timeline
     * GET /odata/v4/supplier-resilience/getCaseHistory(caseId='...')
     */
    this.on('getCaseHistory', async (req) => {
        logger.info('getCaseHistory function called');
        
        const { caseId } = req.data;
        
        if (!caseId) {
            return {
                success: false,
                caseId: null,
                history: [],
                error: 'caseId is required'
            };
        }
        
        try {
            const { CaseHistories } = this.entities;
            
            if (!CaseHistories) {
                return {
                    success: true,
                    caseId: caseId,
                    history: [],
                    error: null
                };
            }
            
            const history = await SELECT.from(CaseHistories)
                .where({ caseId: caseId })
                .orderBy({ timestamp: 'asc' });
            
            const formattedHistory = history.map(h => ({
                timestamp: h.timestamp ? new Date(h.timestamp).toISOString() : null,
                previousStatus: h.previousStatus,
                newStatus: h.newStatus,
                action: h.action,
                agent: h.agent,
                details: h.details,
                userId: h.userId
            }));
            
            return {
                success: true,
                caseId: caseId,
                history: formattedHistory,
                error: null
            };
            
        } catch (error) {
            logger.error(`getCaseHistory error: ${error.message}`);
            return {
                success: false,
                caseId: caseId,
                history: [],
                error: error.message
            };
        }
    });

    /**
     * Delete / Archive a Case
     * POST /odata/v4/supplier-resilience/deleteCase
     */
    this.on('deleteCase', async (req) => {
        logger.info('deleteCase action called');
        
        const { caseId } = req.data;
        
        if (!caseId) {
            return {
                success: false,
                message: 'caseId is required',
                deletedAt: null
            };
        }
        
        try {
            const { Cases, EarlyWarningResults, SurvivalResults, CaseHistories } = this.entities;
            
            // Check if case exists
            const existingCase = await SELECT.one.from(Cases).where({ caseId: caseId });
            
            if (!existingCase) {
                return {
                    success: false,
                    message: `Case not found: ${caseId}`,
                    deletedAt: null
                };
            }
            
            // Delete related records
            if (EarlyWarningResults) {
                await DELETE.from(EarlyWarningResults).where({ caseId: caseId });
            }
            if (SurvivalResults) {
                await DELETE.from(SurvivalResults).where({ caseId: caseId });
            }
            if (CaseHistories) {
                await DELETE.from(CaseHistories).where({ caseId: caseId });
            }
            
            // Delete the case
            await DELETE.from(Cases).where({ caseId: caseId });
            
            return {
                success: true,
                message: `Case ${caseId} deleted successfully`,
                deletedAt: getCurrentTimestamp()
            };
            
        } catch (error) {
            logger.error(`deleteCase error: ${error.message}`);
            return {
                success: false,
                message: `Failed to delete case: ${error.message}`,
                deletedAt: null
            };
        }
    });

    /**
     * Dashboard Summary
     * GET /odata/v4/supplier-resilience/getDashboardSummary()
     */
    this.on('getDashboardSummary', async () => {
        logger.info('getDashboardSummary function called');
        
        try {
            const { Cases, Suppliers, EarlyWarningResults, SurvivalResults } = this.entities;
            
            // Get all cases
            const allCases = await SELECT.from(Cases);
            
            // Calculate counts
            const totalCases = allCases.length;
            const openCases = allCases.filter(c => c.status === 'Open').length;
            const inProgressCases = allCases.filter(c => c.status === 'In Progress').length;
            const resolvedCases = allCases.filter(c => c.status === 'Resolved' || c.status === 'Closed').length;
            const actionRequiredCases = allCases.filter(c => c.status === 'ACTION_REQUIRED').length;
            const monitoringCases = allCases.filter(c => c.status === 'MONITORING').length;
            const criticalCases = allCases.filter(c => c.priority === 'Critical' || c.priority === 'CRITICAL').length;
            
            // Priority breakdown
            const casesByPriority = {
                critical: allCases.filter(c => c.priority === 'Critical' || c.priority === 'CRITICAL').length,
                high: allCases.filter(c => c.priority === 'High' || c.priority === 'HIGH').length,
                medium: allCases.filter(c => c.priority === 'Medium' || c.priority === 'MEDIUM').length,
                low: allCases.filter(c => c.priority === 'Low' || c.priority === 'LOW').length
            };
            
            // Status breakdown
            const casesByStatus = {
                analysisInProgress: allCases.filter(c => c.status === 'ANALYSIS_IN_PROGRESS').length,
                actionRequired: allCases.filter(c => c.status === 'ACTION_REQUIRED').length,
                monitoring: allCases.filter(c => c.status === 'MONITORING').length,
                dataIncomplete: allCases.filter(c => c.status === 'DATA_INCOMPLETE').length,
                completed: allCases.filter(c => c.status === 'COMPLETED' || c.status === 'Closed' || c.status === 'Resolved').length
            };
            
            // Event type breakdown
            const eventTypes = {};
            allCases.forEach(c => {
                if (c.eventType) {
                    eventTypes[c.eventType] = (eventTypes[c.eventType] || 0) + 1;
                }
            });
            const casesByEventType = Object.entries(eventTypes).map(([eventType, count]) => ({
                eventType,
                count
            }));
            
            // Recent cases (last 5)
            const recentCases = allCases
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 5)
                .map(c => ({
                    caseId: c.caseId,
                    status: c.status,
                    priority: c.priority,
                    supplier: c.supplier,
                    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null
                }));
            
            // Calculate risk metrics
            let avgRiskScore = 0;
            let highRiskSuppliers = 0;
            
            if (EarlyWarningResults) {
                const riskResults = await SELECT.from(EarlyWarningResults);
                if (riskResults.length > 0) {
                    const totalRisk = riskResults.reduce((sum, r) => sum + (r.riskScore || 0), 0);
                    avgRiskScore = totalRisk / riskResults.length;
                    highRiskSuppliers = new Set(riskResults.filter(r => r.riskLevel === 'HIGH').map(r => r.supplierId)).size;
                }
            }
            
            // Calculate inventory alerts
            let inventoryAlerts = 0;
            if (SurvivalResults) {
                const survivalResults = await SELECT.from(SurvivalResults);
                inventoryAlerts = survivalResults.filter(s => s.actionRequired === true).length;
            }
            
            // Calculate cases in time ranges
            const now = new Date();
            const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            
            const casesLast24h = allCases.filter(c => c.createdAt && new Date(c.createdAt) >= last24h).length;
            const casesLast7d = allCases.filter(c => c.createdAt && new Date(c.createdAt) >= last7d).length;
            
            return {
                success: true,
                timestamp: getCurrentTimestamp(),
                totalCases,
                openCases,
                inProgressCases,
                resolvedCases,
                actionRequiredCases,
                monitoringCases,
                criticalCases,
                highRiskSuppliers,
                avgRiskScore: Math.round(avgRiskScore * 10) / 10,
                inventoryAlerts,
                casesLast24h,
                casesLast7d,
                casesByPriority,
                casesByStatus,
                casesByEventType,
                recentCases
            };
            
        } catch (error) {
            logger.error(`getDashboardSummary error: ${error.message}`);
            return {
                success: false,
                timestamp: getCurrentTimestamp(),
                totalCases: 0,
                openCases: 0,
                inProgressCases: 0,
                resolvedCases: 0,
                actionRequiredCases: 0,
                monitoringCases: 0,
                criticalCases: 0,
                highRiskSuppliers: 0,
                avgRiskScore: 0,
                inventoryAlerts: 0,
                casesLast24h: 0,
                casesLast7d: 0,
                casesByPriority: { critical: 0, high: 0, medium: 0, low: 0 },
                casesByStatus: { analysisInProgress: 0, actionRequired: 0, monitoring: 0, dataIncomplete: 0, completed: 0 },
                casesByEventType: [],
                recentCases: []
            };
        }
    });

    /**
     * Inventory Health Overview
     * GET /odata/v4/supplier-resilience/getInventoryHealth()
     */
    this.on('getInventoryHealth', async () => {
        logger.info('getInventoryHealth function called');
        
        try {
            const { Inventory, Demands } = this.entities;
            
            // Get all inventory and demand data
            const inventoryData = await SELECT.from(Inventory);
            const demandData = await SELECT.from(Demands);
            
            // Create demand lookup
            const demandLookup = {};
            demandData.forEach(d => {
                const key = `${d.materialId}_${d.plant}`;
                demandLookup[key] = d;
            });
            
            // Calculate health for each inventory record
            const inventoryHealth = inventoryData.map(inv => {
                const key = `${inv.materialId}_${inv.plant}`;
                const demand = demandLookup[key];
                
                const currentStock = parseFloat(inv.currentStock) || 0;
                const blockedStock = parseFloat(inv.blockedStock) || 0;
                const reservedStock = parseFloat(inv.reservedStock) || 0;
                const inTransitStock = parseFloat(inv.inTransitStock) || 0;
                
                const availableInventory = currentStock - blockedStock - reservedStock + inTransitStock;
                const weeklyDemand = demand ? parseFloat(demand.weeklyDemand) || 0 : 0;
                
                let survivalWeeks = 0;
                if (weeklyDemand > 0) {
                    survivalWeeks = availableInventory / weeklyDemand;
                }
                
                // Flag if survival is less than 4 weeks (configurable threshold)
                const actionRequired = survivalWeeks < 4 && weeklyDemand > 0;
                
                let status = 'HEALTHY';
                if (survivalWeeks < 2) {
                    status = 'CRITICAL';
                } else if (survivalWeeks < 4) {
                    status = 'WARNING';
                }
                
                return {
                    materialId: inv.materialId,
                    plant: inv.plant,
                    currentStock,
                    availableInventory: Math.round(availableInventory * 100) / 100,
                    weeklyDemand: Math.round(weeklyDemand * 100) / 100,
                    survivalWeeks: Math.round(survivalWeeks * 10) / 10,
                    unit: inv.unit,
                    actionRequired,
                    status
                };
            });
            
            const alertCount = inventoryHealth.filter(i => i.actionRequired).length;
            
            return {
                success: true,
                timestamp: getCurrentTimestamp(),
                totalMaterials: inventoryHealth.length,
                alertCount,
                inventory: inventoryHealth
            };
            
        } catch (error) {
            logger.error(`getInventoryHealth error: ${error.message}`);
            return {
                success: false,
                timestamp: getCurrentTimestamp(),
                totalMaterials: 0,
                alertCount: 0,
                inventory: []
            };
        }
    });

    /**
     * Supplier Risk Overview
     * GET /odata/v4/supplier-resilience/getSupplierRiskOverview()
     */
    this.on('getSupplierRiskOverview', async () => {
        logger.info('getSupplierRiskOverview function called');
        
        try {
            const { Suppliers, Cases } = this.entities;
            
            // Get all suppliers
            const suppliers = await SELECT.from(Suppliers);
            
            // Get all cases to count active cases per supplier
            const cases = await SELECT.from(Cases);
            
            // Count active cases per supplier
            const activeCasesPerSupplier = {};
            cases.forEach(c => {
                if (c.supplier && c.status !== 'Closed' && c.status !== 'Resolved' && c.status !== 'COMPLETED') {
                    activeCasesPerSupplier[c.supplier] = (activeCasesPerSupplier[c.supplier] || 0) + 1;
                }
            });
            
            // Calculate risk level for each supplier
            const suppliersWithRisk = suppliers.map(s => {
                let riskLevel = 'LOW';
                const otif = s.otif || 100;
                const trend = s.trend || 'STABLE';
                
                if (otif < 70 || trend === 'DETERIORATING') {
                    riskLevel = 'HIGH';
                } else if (otif < 85 || s.previousDelays > 2) {
                    riskLevel = 'MEDIUM';
                }
                
                return {
                    supplierId: s.supplierId,
                    supplierName: s.name,
                    category: s.category,
                    location: s.location,
                    otif: s.otif,
                    trend: s.trend,
                    previousDelays: s.previousDelays,
                    qualityRating: s.qualityRating,
                    riskLevel,
                    activeCases: activeCasesPerSupplier[s.supplierId] || 0,
                    contractStatus: s.contractStatus
                };
            });
            
            const atRiskCount = suppliersWithRisk.filter(s => s.riskLevel === 'HIGH' || s.riskLevel === 'MEDIUM').length;
            
            return {
                success: true,
                timestamp: getCurrentTimestamp(),
                totalSuppliers: suppliersWithRisk.length,
                atRiskCount,
                suppliers: suppliersWithRisk
            };
            
        } catch (error) {
            logger.error(`getSupplierRiskOverview error: ${error.message}`);
            return {
                success: false,
                timestamp: getCurrentTimestamp(),
                totalSuppliers: 0,
                atRiskCount: 0,
                suppliers: []
            };
        }
    });

    /**
     * Risk Analytics
     * GET /odata/v4/supplier-resilience/getRiskAnalytics()
     */
    this.on('getRiskAnalytics', async () => {
        logger.info('getRiskAnalytics function called');
        
        try {
            const { Cases, EarlyWarningResults } = this.entities;
            
            let riskDistribution = { high: 0, medium: 0, low: 0 };
            let avgRiskScore = 0;
            let topRiskDrivers = [];
            
            if (EarlyWarningResults) {
                const riskResults = await SELECT.from(EarlyWarningResults);
                
                // Risk distribution
                riskResults.forEach(r => {
                    if (r.riskLevel === 'HIGH') riskDistribution.high++;
                    else if (r.riskLevel === 'MEDIUM') riskDistribution.medium++;
                    else riskDistribution.low++;
                });
                
                // Average risk score
                if (riskResults.length > 0) {
                    const totalRisk = riskResults.reduce((sum, r) => sum + (r.riskScore || 0), 0);
                    avgRiskScore = totalRisk / riskResults.length;
                }
                
                // Top risk drivers
                const driverCounts = {};
                riskResults.forEach(r => {
                    if (r.topRiskDrivers) {
                        try {
                            const drivers = JSON.parse(r.topRiskDrivers);
                            drivers.forEach(driver => {
                                // Normalize driver names
                                const normalizedDriver = driver.split('(')[0].trim();
                                driverCounts[normalizedDriver] = (driverCounts[normalizedDriver] || 0) + 1;
                            });
                        } catch (e) {
                            // Ignore parse errors
                        }
                    }
                });
                
                topRiskDrivers = Object.entries(driverCounts)
                    .map(([driver, count]) => ({ driver, count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 5);
            }
            
            // Risk by plant
            const allCases = await SELECT.from(Cases);
            const plantRisk = {};
            allCases.forEach(c => {
                if (c.plant) {
                    if (!plantRisk[c.plant]) {
                        plantRisk[c.plant] = { totalRisk: 0, count: 0 };
                    }
                    plantRisk[c.plant].count++;
                }
            });
            
            const riskByPlant = Object.entries(plantRisk).map(([plant, data]) => ({
                plant,
                avgRisk: 0, // Would need to join with EarlyWarningResults for actual values
                caseCount: data.count
            }));
            
            // Risk trend (simplified - would need time-series data)
            const riskTrend = [];
            
            return {
                success: true,
                timestamp: getCurrentTimestamp(),
                riskDistribution,
                avgRiskScore: Math.round(avgRiskScore * 10) / 10,
                topRiskDrivers,
                riskByPlant,
                riskTrend
            };
            
        } catch (error) {
            logger.error(`getRiskAnalytics error: ${error.message}`);
            return {
                success: false,
                timestamp: getCurrentTimestamp(),
                riskDistribution: { high: 0, medium: 0, low: 0 },
                avgRiskScore: 0,
                topRiskDrivers: [],
                riskByPlant: [],
                riskTrend: []
            };
        }
    });

    // ═════════════════════════════════════════════════════════════════════════
    // ENTITY EVENT HANDLERS
    // Registered defensively — only when the target entity is actually
    // projected by this service (i.e. exists in this.entities).
    // ═════════════════════════════════════════════════════════════════════════

    // Before creating a Case, ensure caseId is set.
    // (Note: `dataSource` is intentionally NOT set here because it is not a
    // column on the current Case entity in db/schema.cds. Add it there first
    // if you want it stored.)
    if (this.entities.Cases) {
        this.before('CREATE', 'Cases', (req) => {
            if (!req.data.caseId) {
                req.data.caseId = generateCaseId();
            }
        });

        this.after('CREATE', 'Cases', (data) => {
            logger.info(`Case created: ${data.caseId}, status=${data.status}`);
        });
    }

    // Before creating a DisruptionEvent, ensure eventId/eventTime are set.
    if (this.entities.DisruptionEvents) {
        this.before('CREATE', 'DisruptionEvents', (req) => {
            if (!req.data.eventId) {
                req.data.eventId = generateEventId();
            }
            if (!req.data.eventTime) {
                req.data.eventTime = new Date().toISOString();
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER FUNCTIONS FOR runEarlyWarningWithS4R
    // ═══════════════════════════════════════════════════════════════════════════

    /** Fetch PO Details internally (reuses S4R destination logic) */
    async function fetchPurchaseOrderDetailsInternal(po, httpClient, log) {
        const dest = { destinationName: 'S4R' }, opts = { method: 'GET' }, encPo = encodeURIComponent(po);
        const asStr = v => (v == null) ? '' : String(v);
        const parseODataDate = v => {
            if (!v || typeof v !== 'string') return '';
            const m = v.match(/\/Date\((-?\d+)\)\//);
            return m ? new Date(parseInt(m[1], 10)).toISOString().split('T')[0] : String(v);
        };

        const urls = {
            header: `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder('${encPo}')?$format=json`,
            items: `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem?$filter=${encodeURIComponent(`PurchaseOrder eq '${po}'`)}&$format=json`,
            schedLines: `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderScheduleLine?$filter=${encodeURIComponent(`PurchasingDocument eq '${po}'`)}&$select=PurchasingDocument,ScheduleLineDeliveryDate,SchedLineStscDeliveryDate&$format=json`,
            matDocItems: `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem?$select=MaterialDocument,MaterialDocumentYear,GoodsMovementType,QuantityInEntryUnit&$filter=${encodeURIComponent(`PurchaseOrder eq '${po}' and GoodsMovementType eq '101'`)}&$format=json`
        };

        try {
            const [hdrR, itmR, slR, mdR] = await Promise.all([
                httpClient(dest, { ...opts, url: urls.header }),
                httpClient(dest, { ...opts, url: urls.items }),
                httpClient(dest, { ...opts, url: urls.schedLines }).catch(() => ({ __failed: true })),
                httpClient(dest, { ...opts, url: urls.matDocItems }).catch(() => ({ __failed: true }))
            ]);

            const hd = hdrR?.data?.d || hdrR?.data || {};
            const rawH = hd.results ? hd.results[0] : hd;
            const purchaseOrder = rawH?.PurchaseOrder ? {
                PurchaseOrder: asStr(rawH.PurchaseOrder), Supplier: asStr(rawH.Supplier),
                DocumentCurrency: asStr(rawH.DocumentCurrency), PurchaseOrderDate: parseODataDate(rawH.PurchaseOrderDate),
                PurchaseOrderNetAmount: asStr(rawH.PurchaseOrderNetAmount), AddressName: asStr(rawH.AddressName)
            } : null;

            const id = itmR?.data?.d?.results || itmR?.data?.value || [];
            const purchaseOrderItems = id.map(it => ({
                Material: asStr(it.Material), Plant: asStr(it.Plant), OrderQuantity: asStr(it.OrderQuantity),
                PurchaseOrderQuantityUnit: asStr(it.PurchaseOrderQuantityUnit), PurchaseOrderItemText: asStr(it.PurchaseOrderItemText),
                IsCompletelyDelivered: it.IsCompletelyDelivered === true || it.IsCompletelyDelivered === 'true'
            }));

            let scheduleLines = [];
            if (slR && !slR.__failed) {
                const sld = slR?.data?.d?.results || slR?.data?.value || [];
                scheduleLines = sld.map(sl => ({ ScheduleLineDeliveryDate: parseODataDate(sl.ScheduleLineDeliveryDate), SchedLineStscDeliveryDate: parseODataDate(sl.SchedLineStscDeliveryDate) }));
            }

            let materialDocuments = [];
            if (mdR && !mdR.__failed) {
                const mdd = mdR?.data?.d?.results || mdR?.data?.value || [];
                const ukeys = [...new Map(mdd.map(m => [`${m.MaterialDocument}-${m.MaterialDocumentYear}`, m])).values()];
                let hdrMap = new Map();
                if (ukeys.length > 0) {
                    try {
                        const fc = ukeys.map(k => `(MaterialDocument eq '${k.MaterialDocument}' and MaterialDocumentYear eq '${k.MaterialDocumentYear}')`).join(' or ');
                        const hr = await httpClient(dest, { ...opts, url: `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader?$select=MaterialDocument,MaterialDocumentYear,PostingDate&$filter=${encodeURIComponent(fc)}&$format=json` });
                        (hr?.data?.d?.results || hr?.data?.value || []).forEach(h => hdrMap.set(`${h.MaterialDocument}-${h.MaterialDocumentYear}`, h));
                    } catch (e) { /* ignore */ }
                }
                materialDocuments = mdd.map(m => ({ GoodsMovementType: asStr(m.GoodsMovementType), QuantityInEntryUnit: asStr(m.QuantityInEntryUnit), PostingDate: parseODataDate((hdrMap.get(`${m.MaterialDocument}-${m.MaterialDocumentYear}`) || {}).PostingDate) }));
            }

            return { success: true, purchaseOrder, purchaseOrderItems, scheduleLines, materialDocuments, error: null };
        } catch (error) { return { success: false, purchaseOrder: null, purchaseOrderItems: [], scheduleLines: [], materialDocuments: [], error: error?.message || String(error) }; }
    }

    /** Calculate risk score using only S4R available components */
    function calculateS4RRiskScore(s4rData) {
        const breakdown = { delaySeverity: 0, affectedScope: 0, revenueExposure: 0 };
        const maxPossibleScore = 43; // Delay: 25, AffectedScope (plants): 8, Revenue: 10
        const delayDays = s4rData.delayDays || 0;
        if (delayDays > 21) breakdown.delaySeverity = 25;
        else if (delayDays >= 15) breakdown.delaySeverity = 20;
        else if (delayDays >= 8) breakdown.delaySeverity = 12;
        else if (delayDays >= 1) breakdown.delaySeverity = 5;

        const plantCount = (s4rData.affectedPlants || []).length;
        if (plantCount >= 4) breakdown.affectedScope = 8;
        else if (plantCount >= 2) breakdown.affectedScope = 5;
        else if (plantCount === 1) breakdown.affectedScope = 2;

        const revenue = s4rData.estimatedRevenueImpact || 0;
        if (revenue >= 1000000) breakdown.revenueExposure = 10;
        else if (revenue >= 500000) breakdown.revenueExposure = 7;
        else if (revenue >= 100000) breakdown.revenueExposure = 4;
        else if (revenue > 0) breakdown.revenueExposure = 2;

        const totalScore = breakdown.delaySeverity + breakdown.affectedScope + breakdown.revenueExposure;
        const riskPercentage = Math.round((totalScore / maxPossibleScore) * 100);
        let riskLevel = riskPercentage >= 70 ? 'HIGH' : riskPercentage >= 40 ? 'MEDIUM' : 'LOW';
        return { totalScore, maxPossibleScore, riskPercentage, riskLevel, breakdown };
    }

    /** Build risk drivers from S4R data */
    function buildS4RRiskDrivers(s4rData, scoreResult) {
        const drivers = [];
        const delayDays = s4rData.delayDays || 0;
        if (delayDays > 21) drivers.push(`Severe delay of ${delayDays} days (>3 weeks)`);
        else if (delayDays >= 15) drivers.push(`Significant delay of ${delayDays} days (2-3 weeks)`);
        else if (delayDays >= 8) drivers.push(`Moderate delay of ${delayDays} days (1-2 weeks)`);
        else if (delayDays >= 1) drivers.push(`Minor delay of ${delayDays} days`);

        const revenue = s4rData.estimatedRevenueImpact || 0;
        if (revenue >= 1000000) drivers.push(`High revenue exposure: ${(revenue/100000).toFixed(1)}L at risk`);
        else if (revenue >= 500000) drivers.push(`Significant revenue exposure: ${(revenue/100000).toFixed(1)}L at risk`);

        const plantCount = (s4rData.affectedPlants || []).length;
        if (plantCount >= 4) drivers.push(`Disruption affects ${plantCount} plants (widespread impact)`);
        else if (plantCount >= 2) drivers.push(`Disruption affects ${plantCount} plants`);

        if (s4rData.otifForThisPO === 0) drivers.push(`OTIF for this PO: 0% (${s4rData.otifReason})`);
        if (s4rData.deliveryStatus === 'OVERDUE') drivers.push('Delivery is overdue - no goods receipt yet');
        else if (s4rData.deliveryStatus === 'PARTIALLY_DELIVERED') drivers.push(`Partial delivery: ${s4rData.deliveryCompletion}% complete`);
        return drivers;
    }

    /** Build the complete S4R output response */
    function buildS4ROutput(caseId, caseIdGenerated, s4rData, scoreResult, topRiskDrivers) {
        return {
            success: true, agent: 'EARLY_WARNING', caseId, caseIdGenerated, status: 'COMPLETED',
            riskScore: scoreResult.totalScore, maxPossibleScore: scoreResult.maxPossibleScore,
            riskPercentage: scoreResult.riskPercentage, riskLevel: scoreResult.riskLevel,
            scoreBreakdown: { supplierPerformance: null, delaySeverity: scoreResult.breakdown.delaySeverity,
                materialCriticality: null, affectedScope: scoreResult.breakdown.affectedScope,
                revenueExposure: scoreResult.breakdown.revenueExposure, total: scoreResult.totalScore },
            scoringNote: 'Score based on available S4R data only. Supplier performance and material criticality not available from single PO.',
            supplierId: s4rData.supplierId, supplierName: s4rData.supplierName,
            supplierOtif: null, supplierTrend: null, previousDelays: null,
            materialId: s4rData.materialId, materialDescription: s4rData.materialDescription, materialCriticality: null,
            poNumber: s4rData.poNumber, orderDate: s4rData.orderDate, currency: s4rData.currency, poNetAmount: s4rData.poNetAmount,
            expectedDeliveryDate: s4rData.expectedDeliveryDate, actualDeliveryDate: s4rData.actualDeliveryDate,
            delayDays: s4rData.delayDays, deliveryStatus: s4rData.deliveryStatus,
            isOnTime: s4rData.isOnTime, isInFull: s4rData.isInFull, otifForThisPO: s4rData.otifForThisPO, otifReason: s4rData.otifReason,
            orderedQuantity: s4rData.orderedQuantity, deliveredQuantity: s4rData.deliveredQuantity,
            quantityUnit: s4rData.quantityUnit, deliveryCompletion: s4rData.deliveryCompletion,
            affectedPlants: s4rData.affectedPlants, affectedPlantsCount: s4rData.affectedPlants.length, affectedSkus: null,
            estimatedRevenueImpact: s4rData.estimatedRevenueImpact, topRiskDrivers,
            dataSource: 'S4R', calculatedAt: getCurrentTimestamp(),
            availableData: s4rData.dataAvailability,
            unavailableFields: ['supplierOtif', 'supplierTrend', 'previousDelays', 'materialCriticality', 'affectedSkus'],
            error: null
        };
    }
});