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