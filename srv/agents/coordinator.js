/**
 * Coordinator Agent
 * 
 * Migrated from: supply-chain-agents/agents/coordinator/agent.py
 * 
 * Per Initial Development Guidelines:
 * - Task 1: Read the mock event
 * - Task 2: Validate the event
 * - Task 3: Create a disruption case
 * - Task 4: Call Early Warning Agent
 * - Task 5: Call Survival Agent
 * - Task 6: Consolidate results
 * - Task 7: Store results
 * 
 * Consolidation rules:
 * - High risk + survival shortfall → ACTION_REQUIRED
 * - High risk + no survival shortfall → MONITORING
 * - Missing data → DATA_INCOMPLETE
 */

'use strict';

const {
    AgentName,
    AgentStatus,
    CaseStatus,
    Priority,
    RiskLevel,
    DEFAULT_CONFIG
} = require('../lib/constants');

const {
    generateCaseId,
    generateRunId,
    getCurrentTimestamp,
    getDataMode,
    safeJsonStringify,
    createLogger
} = require('../lib/utils');

const { EventValidator } = require('./validator');
const { EarlyWarningAgent } = require('./early-warning');
const { SurvivalAgent } = require('./survival');

const logger = createLogger('Coordinator');

// ═══════════════════════════════════════════════════════════════════════════════
// COORDINATOR AGENT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Coordinator Agent
 * Orchestrates the disruption management workflow
 */
class CoordinatorAgent {
    /**
     * Create a Coordinator Agent instance
     * 
     * @param {Object} db - Database service (CDS)
     */
    constructor(db) {
        this.db = db;
        this.validator = new EventValidator();
        this.earlyWarningAgent = new EarlyWarningAgent(db);
        this.survivalAgent = new SurvivalAgent(db);
        this.agentName = AgentName.COORDINATOR;
    }
    
    /**
     * Run the coordinator workflow
     * 
     * @param {Object} eventData - Raw event data
     * @returns {Object} CoordinatorOutput with consolidated results
     */
    async run(eventData) {
        const runId = generateRunId();
        
        logger.info(`Starting coordinator workflow: runId=${runId}`);
        
        try {
            // Task 1 & 2: Validate the event
            const validationResult = this.validator.validate(eventData);
            
            if (!validationResult.isValid) {
                logger.warn(`Event validation failed: ${validationResult.getErrorMessages().join(', ')}`);
                return this._createErrorOutput(
                    eventData,
                    runId,
                    `Invalid event: ${validationResult.getErrorMessages().join('; ')}`
                );
            }
            
            const event = validationResult.validatedData;
            
            // Task 3: Create a disruption case
            const caseData = this._createCase(event);
            
            logger.info(`Created case: ${caseData.caseId}, priority=${caseData.priority}`);
            
            // Task 4: Call Early Warning Agent
            const earlyWarningResult = await this._callEarlyWarning(caseData);
            
            // Task 5: Call Survival Agent
            const survivalResult = await this._callSurvival(caseData, earlyWarningResult);
            
            // Task 6: Consolidate results
            const output = this._consolidateResults(
                event,
                caseData,
                runId,
                earlyWarningResult,
                survivalResult
            );
            
            // Task 7: Store results
            await this._saveToStorage(output, event, earlyWarningResult, survivalResult);
            
            logger.info(`Coordinator completed: caseId=${output.caseId}, status=${output.status}`);
            
            return output;
            
        } catch (error) {
            logger.error(`Coordinator error: ${error.message}`);
            return this._createErrorOutput(eventData, runId, error.message);
        }
    }
    
    /**
     * Task 3: Create a disruption case
     * 
     * @param {Object} event - Validated event data
     * @returns {Object} Case data
     */
    _createCase(event) {
        const caseId = generateCaseId();
        const priority = this._determinePriority(event.delayDays || 0);
        const createdAt = getCurrentTimestamp();
        
        return {
            caseId: caseId,
            eventId: event.eventId,
            status: CaseStatus.ANALYSIS_IN_PROGRESS,
            priority: priority,
            createdBy: 'Coordinator Agent',
            createdAt: createdAt,
            po: event.po,
            supplier: event.supplier,
            material: event.material,
            plant: event.plant,
            delayDays: event.delayDays || 0,
            eventType: event.eventType,
            eventTime: event.eventTime
        };
    }
    
    /**
     * Determine case priority based on delay days
     * 
     * @param {number} delayDays - Number of delay days
     * @returns {string} Priority level
     */
    _determinePriority(delayDays) {
        if (delayDays >= 21) {
            return Priority.CRITICAL;
        } else if (delayDays >= 14) {
            return Priority.HIGH;
        } else if (delayDays >= 7) {
            return Priority.MEDIUM;
        } else {
            return Priority.LOW;
        }
    }
    
    /**
     * Task 4: Call Early Warning Agent
     * 
     * @param {Object} caseData - Case data
     * @returns {Object} Early warning result
     */
    async _callEarlyWarning(caseData) {
        logger.info(`Calling Early Warning Agent for case: ${caseData.caseId}`);
        
        try {
            const result = await this.earlyWarningAgent.run({
                caseId: caseData.caseId,
                supplier: caseData.supplier,
                material: caseData.material,
                plant: caseData.plant,
                delayDays: caseData.delayDays
            });
            
            return result;
            
        } catch (error) {
            logger.error(`Early Warning Agent error: ${error.message}`);
            return {
                success: false,
                caseId: caseData.caseId,
                status: AgentStatus.FAILED,
                riskScore: 0,
                riskLevel: RiskLevel.LOW,
                error: error.message
            };
        }
    }
    
    /**
     * Task 5: Call Survival Agent
     * 
     * @param {Object} caseData - Case data
     * @param {Object} earlyWarningResult - Early warning result (for recovery estimate)
     * @returns {Object} Survival result
     */
    async _callSurvival(caseData, earlyWarningResult) {
        logger.info(`Calling Survival Agent for case: ${caseData.caseId}`);
        
        try {
            // Estimate recovery weeks based on delay
            // In production, this would come from supplier data or S/4HANA
            const recoveryWeeks = Math.max(
                DEFAULT_CONFIG.defaultRecoveryWeeks,
                Math.ceil(caseData.delayDays / 7) + 2
            );
            
            const result = await this.survivalAgent.run({
                caseId: caseData.caseId,
                material: caseData.material,
                plant: caseData.plant,
                supplierRecoveryWeeks: recoveryWeeks
            });
            
            return result;
            
        } catch (error) {
            logger.error(`Survival Agent error: ${error.message}`);
            return {
                success: false,
                caseId: caseData.caseId,
                status: AgentStatus.FAILED,
                survivalWeeks: 0,
                actionRequired: true,
                error: error.message
            };
        }
    }
    
    /**
     * Task 6: Consolidate results
     * 
     * @param {Object} event - Validated event data
     * @param {Object} caseData - Case data
     * @param {string} runId - Run identifier
     * @param {Object} earlyWarning - Early warning result
     * @param {Object} survival - Survival result
     * @returns {Object} Consolidated output
     */
    _consolidateResults(event, caseData, runId, earlyWarning, survival) {
        // Determine final status and recommendation
        const { status, recommendation } = this._determineStatusAndRecommendation(
            earlyWarning,
            survival
        );
        
        const completedAt = getCurrentTimestamp();
        
        return {
            success: true,
            caseId: caseData.caseId,
            eventId: event.eventId,
            runId: runId,
            status: status,
            priority: caseData.priority,
            createdAt: caseData.createdAt,
            completedAt: completedAt,
            po: event.po,
            supplier: event.supplier,
            material: event.material,
            plant: event.plant,
            delayDays: event.delayDays || 0,
            earlyWarning: {
                status: earlyWarning.status || AgentStatus.FAILED,
                riskScore: earlyWarning.riskScore || 0,
                riskLevel: earlyWarning.riskLevel || RiskLevel.LOW,
                affectedPlants: earlyWarning.affectedPlants || [],
                affectedSkus: earlyWarning.affectedSkus || [],
                topRiskDrivers: earlyWarning.topRiskDrivers || []
            },
            survival: {
                status: survival.status || AgentStatus.FAILED,
                availableInventory: survival.availableInventory || 0,
                weeklyDemand: survival.weeklyDemand || 0,
                unit: survival.unit || 'UNIT',
                survivalWeeks: survival.survivalWeeks || 0,
                supplierRecoveryWeeks: survival.supplierRecoveryWeeks || 0,
                coverageGapWeeks: survival.coverageGapWeeks || 0,
                uncoveredWeeks: survival.uncoveredWeeks || 0,
                shortfallQuantity: survival.shortfallQuantity || 0,
                actionRequired: survival.actionRequired || false
            },
            recommendation: recommendation,
            dataSource: getDataMode(),
            error: null
        };
    }
    
    /**
     * Determine final status and recommendation
     * 
     * Per guidelines:
     * - High risk + survival shortfall → ACTION_REQUIRED
     * - High risk + no survival shortfall → MONITORING
     * - Missing data → DATA_INCOMPLETE
     * 
     * @param {Object} earlyWarning - Early warning result
     * @param {Object} survival - Survival result
     * @returns {Object} { status, recommendation }
     */
    _determineStatusAndRecommendation(earlyWarning, survival) {
        // Check for missing or failed data
        const ewValid = earlyWarning && earlyWarning.status === AgentStatus.COMPLETED;
        const survValid = survival && survival.status === AgentStatus.COMPLETED;
        
        if (!ewValid && !survValid) {
            return {
                status: CaseStatus.DATA_INCOMPLETE,
                recommendation: 'Unable to assess risk - agent data incomplete'
            };
        }
        
        if (!ewValid) {
            return {
                status: CaseStatus.DATA_INCOMPLETE,
                recommendation: 'Early warning assessment incomplete'
            };
        }
        
        const riskLevel = earlyWarning.riskLevel || RiskLevel.LOW;
        const riskScore = earlyWarning.riskScore || 0;
        
        if (!survValid) {
            // We have risk data but no survival data
            if (riskLevel === RiskLevel.HIGH) {
                return {
                    status: CaseStatus.ACTION_REQUIRED,
                    recommendation: `High risk detected (score: ${riskScore}). Survival analysis pending.`
                };
            } else {
                return {
                    status: CaseStatus.MONITORING,
                    recommendation: `Risk level: ${riskLevel}. Survival analysis pending.`
                };
            }
        }
        
        // Both agents completed successfully
        const isHighRisk = riskLevel === RiskLevel.HIGH;
        const hasShortfall = survival.actionRequired;
        const survivalWeeks = survival.survivalWeeks || 0;
        const uncoveredWeeks = survival.uncoveredWeeks || 0;
        const shortfallQuantity = survival.shortfallQuantity || 0;
        const unit = survival.unit || 'units';
        
        if (isHighRisk && hasShortfall) {
            return {
                status: CaseStatus.ACTION_REQUIRED,
                recommendation: `HIGH RISK (score: ${riskScore}) with ${uncoveredWeeks.toFixed(1)} weeks shortfall. ` +
                    `Immediate action required to source ${shortfallQuantity.toFixed(0)} ${unit}.`
            };
        }
        
        if (isHighRisk && !hasShortfall) {
            return {
                status: CaseStatus.MONITORING,
                recommendation: `High risk supplier (score: ${riskScore}) but current inventory sufficient. ` +
                    `Survival window: ${survivalWeeks.toFixed(1)} weeks. Continue monitoring.`
            };
        }
        
        if (!isHighRisk && hasShortfall) {
            return {
                status: CaseStatus.ACTION_REQUIRED,
                recommendation: `Moderate risk (score: ${riskScore}) but inventory shortfall detected. ` +
                    `Action needed for ${uncoveredWeeks.toFixed(1)} weeks gap.`
            };
        }
        
        // Low/medium risk, no shortfall
        return {
            status: CaseStatus.MONITORING,
            recommendation: `Risk level: ${riskLevel} (score: ${riskScore}). ` +
                `Inventory adequate for ${survivalWeeks.toFixed(1)} weeks. No immediate action required.`
        };
    }
    
    /**
     * Task 7: Store results to database
     * 
     * @param {Object} output - Coordinator output
     * @param {Object} event - Event data
     * @param {Object} earlyWarning - Early warning result
     * @param {Object} survival - Survival result
     */
    async _saveToStorage(output, event, earlyWarning, survival) {
        try {
            const { Cases } = this.db.entities;
            
            // Save the case
            await INSERT.into(Cases).entries({
                caseId: output.caseId,
                eventId: output.eventId,
                runId: output.runId,
                status: output.status,
                priority: output.priority,
                eventType: event.eventType,
                po: output.po,
                supplier: output.supplier,
                material: output.material,
                plant: output.plant,
                delayDays: output.delayDays,
                eventTime: event.eventTime,
                completedAt: output.completedAt,
                recommendation: output.recommendation,
                dataSource: output.dataSource,
                error: output.error
            });
            
            logger.info(`Saved case to storage: ${output.caseId}`);
            
            // Save early warning result if completed
            if (earlyWarning && earlyWarning.status === AgentStatus.COMPLETED) {
                await this.earlyWarningAgent.saveResult(earlyWarning);
            }
            
            // Save survival result if completed
            if (survival && survival.status === AgentStatus.COMPLETED) {
                await this.survivalAgent.saveResult(survival);
            }
            
            logger.info(`Successfully stored all results for case: ${output.caseId}`);
            
        } catch (error) {
            // Log error but don't fail the main workflow
            logger.error(`Failed to save results to storage: ${error.message}`);
        }
    }
    
    /**
     * Create error output
     * 
     * @param {Object} eventData - Raw event data
     * @param {string} runId - Run identifier
     * @param {string} errorMessage - Error message
     * @returns {Object} Error output
     */
    _createErrorOutput(eventData, runId, errorMessage) {
        const caseId = `ERR-${generateCaseId()}`;
        
        return {
            success: false,
            caseId: caseId,
            eventId: eventData?.eventId || 'UNKNOWN',
            runId: runId,
            status: CaseStatus.DATA_INCOMPLETE,
            priority: Priority.HIGH,
            createdAt: getCurrentTimestamp(),
            completedAt: getCurrentTimestamp(),
            po: eventData?.po || 'UNKNOWN',
            supplier: eventData?.supplier || 'UNKNOWN',
            material: eventData?.material || 'UNKNOWN',
            plant: eventData?.plant || 'UNKNOWN',
            delayDays: eventData?.delayDays || 0,
            earlyWarning: {
                status: AgentStatus.SKIPPED,
                riskScore: 0,
                riskLevel: RiskLevel.LOW,
                affectedPlants: [],
                affectedSkus: [],
                topRiskDrivers: []
            },
            survival: {
                status: AgentStatus.SKIPPED,
                availableInventory: 0,
                weeklyDemand: 0,
                unit: 'UNKNOWN',
                survivalWeeks: 0,
                supplierRecoveryWeeks: 0,
                coverageGapWeeks: 0,
                uncoveredWeeks: 0,
                shortfallQuantity: 0,
                actionRequired: false
            },
            recommendation: null,
            dataSource: getDataMode(),
            error: errorMessage
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    CoordinatorAgent
};