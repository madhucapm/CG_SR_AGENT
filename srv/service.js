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
            
            // Get early warning result
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
            
            // Get survival result
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
});