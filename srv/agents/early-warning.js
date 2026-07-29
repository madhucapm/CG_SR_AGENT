/**
 * Early Warning Agent
 * 
 * Migrated from: supply-chain-agents/agents/early_warning/agent.py
 * 
 * Per Initial Development Guidelines:
 * - Task 1: Read event and supplier data
 * - Task 2: Calculate supplier risk (OTIF, previous delays, trend)
 * - Task 3: Assess business impact (affected plants, SKUs, criticality, revenue)
 * - Task 4: Calculate risk score using configurable weights
 * - Task 5: Return structured result with topRiskDrivers
 * 
 * Expected completion:
 * Early Warning should produce the same result every time for the same mock input.
 */

'use strict';

const {
    AgentName,
    AgentStatus,
    RiskLevel,
    DataMode
} = require('../lib/constants');

const {
    getCurrentTimestamp,
    getDataMode,
    isMockMode,
    parseArrayField,
    safeJsonStringify,
    createLogger
} = require('../lib/utils');

const { RiskScorer, createScoringContext } = require('./risk-scorer');

const logger = createLogger('EarlyWarning');

// ═══════════════════════════════════════════════════════════════════════════════
// EARLY WARNING AGENT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Early Warning Agent
 * Assesses supplier risk and calculates deterministic risk score
 */
class EarlyWarningAgent {
    /**
     * Create an Early Warning Agent instance
     * 
     * @param {Object} db - Database service (CDS)
     */
    constructor(db) {
        this.db = db;
        this.scorer = new RiskScorer();
        this.agentName = AgentName.EARLY_WARNING;
    }
    
    /**
     * Run the early warning assessment
     * 
     * @param {Object} input - Assessment input
     * @param {string} input.caseId - Disruption case identifier
     * @param {string} input.supplier - Supplier identifier
     * @param {string} input.material - Material identifier
     * @param {string} input.plant - Plant identifier
     * @param {number} input.delayDays - Number of days delayed
     * 
     * @returns {Object} EarlyWarningOutput with risk assessment results
     */
    async run(input) {
        const { caseId, supplier, material, plant, delayDays } = input;
        
        logger.info(`Running early warning assessment for case=${caseId}, supplier=${supplier}`);
        
        try {
            // Task 1: Load supplier data
            const supplierData = await this._loadSupplierData(supplier);
            
            if (!supplierData) {
                return this._createErrorOutput(
                    caseId,
                    supplier,
                    material,
                    `Supplier data not found: ${supplier}`
                );
            }
            
            // Task 1: Load material data
            const materialData = await this._loadMaterialData(material);
            
            if (!materialData) {
                return this._createErrorOutput(
                    caseId,
                    supplier,
                    material,
                    `Material data not found: ${material}`
                );
            }
            
            // Task 2 & 3: Build scoring context
            const context = this._buildScoringContext(supplierData, materialData, delayDays);
            
            // Task 4: Calculate risk score
            const riskResult = this.scorer.calculateRisk(context);
            
            // Parse arrays from database (stored as JSON strings)
            const affectedPlants = parseArrayField(materialData.affectedPlants);
            const affectedSkus = parseArrayField(materialData.affectedSkus);
            
            // Task 5: Return structured result
            const output = {
                success: true,
                agent: this.agentName,
                caseId: caseId,
                status: AgentStatus.COMPLETED,
                riskScore: riskResult.totalScore,
                riskLevel: riskResult.riskLevel,
                scoreBreakdown: {
                    supplierPerformance: riskResult.breakdown.supplierPerformance,
                    delaySeverity: riskResult.breakdown.delaySeverity,
                    materialCriticality: riskResult.breakdown.materialCriticality,
                    affectedScope: riskResult.breakdown.affectedScope,
                    revenueExposure: riskResult.breakdown.revenueExposure,
                    total: riskResult.breakdown.total
                },
                supplierId: supplier,
                supplierName: supplierData.name,
                supplierOtif: supplierData.otif,
                supplierTrend: supplierData.trend,
                materialId: material,
                materialCriticality: materialData.criticality,
                affectedPlants: affectedPlants,
                affectedSkus: affectedSkus,
                topRiskDrivers: riskResult.topRiskDrivers,
                dataSource: getDataMode(),
                calculatedAt: getCurrentTimestamp(),
                error: null
            };
            
            logger.info(`Early warning completed: riskScore=${output.riskScore}, riskLevel=${output.riskLevel}`);
            
            return output;
            
        } catch (error) {
            logger.error(`Error in early warning assessment: ${error.message}`);
            return this._createErrorOutput(caseId, supplier, material, error.message);
        }
    }
    
    /**
     * Load supplier data from database
     * 
     * Task 1: Load supplier performance data
     * - OTIF
     * - Previous delays
     * - Trend
     * 
     * @param {string} supplierId - Supplier identifier
     * @returns {Object|null} Supplier data or null
     */
    async _loadSupplierData(supplierId) {
        try {
            const { Suppliers } = this.db.entities;
            
            const supplier = await SELECT.one
                .from(Suppliers)
                .where({ supplierId: supplierId });
            
            if (!supplier) {
                logger.warn(`Supplier not found: ${supplierId}`);
                return null;
            }
            
            return supplier;
        } catch (error) {
            logger.error(`Error loading supplier data: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Load material data from database
     * 
     * Task 1: Load material data
     * - Criticality
     * - Affected plants
     * - Affected SKUs
     * - Revenue exposure
     * 
     * @param {string} materialId - Material identifier
     * @returns {Object|null} Material data or null
     */
    async _loadMaterialData(materialId) {
        try {
            const { Materials } = this.db.entities;
            
            const material = await SELECT.one
                .from(Materials)
                .where({ materialId: materialId });
            
            if (!material) {
                logger.warn(`Material not found: ${materialId}`);
                return null;
            }
            
            return material;
        } catch (error) {
            logger.error(`Error loading material data: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Build scoring context from supplier and material data
     * 
     * @param {Object} supplierData - Supplier data from database
     * @param {Object} materialData - Material data from database
     * @param {number} delayDays - Number of delay days
     * @returns {Object} Scoring context
     */
    _buildScoringContext(supplierData, materialData, delayDays) {
        // Parse array fields (stored as JSON strings in database)
        const affectedPlants = parseArrayField(materialData.affectedPlants);
        const affectedSkus = parseArrayField(materialData.affectedSkus);
        
        return createScoringContext({
            // Supplier data
            otif: supplierData.otif || 80,
            previousDelays: supplierData.previousDelays || 0,
            trend: supplierData.trend || 'STABLE',
            
            // Delay data
            delayDays: delayDays || 0,
            
            // Material data
            criticality: materialData.criticality || 'MEDIUM',
            affectedPlants: affectedPlants,
            affectedSkus: affectedSkus,
            
            // Revenue data
            estimatedRevenueImpact: parseFloat(materialData.estimatedRevenueImpact) || 0
        });
    }
    
    /**
     * Create error output
     * 
     * @param {string} caseId - Case identifier
     * @param {string} supplierId - Supplier identifier
     * @param {string} materialId - Material identifier
     * @param {string} errorMessage - Error message
     * @returns {Object} Error output
     */
    _createErrorOutput(caseId, supplierId, materialId, errorMessage) {
        return {
            success: false,
            agent: this.agentName,
            caseId: caseId,
            status: AgentStatus.FAILED,
            riskScore: 0,
            riskLevel: RiskLevel.LOW,
            scoreBreakdown: {
                supplierPerformance: 0,
                delaySeverity: 0,
                materialCriticality: 0,
                affectedScope: 0,
                revenueExposure: 0,
                total: 0
            },
            supplierId: supplierId,
            supplierName: null,
            supplierOtif: null,
            supplierTrend: null,
            materialId: materialId,
            materialCriticality: null,
            affectedPlants: [],
            affectedSkus: [],
            topRiskDrivers: [],
            dataSource: getDataMode(),
            calculatedAt: getCurrentTimestamp(),
            error: errorMessage
        };
    }
    
    /**
     * Quick supplier assessment (standalone)
     * 
     * @param {string} supplierId - Supplier identifier
     * @param {number} delayDays - Number of delay days
     * @returns {Object} Quick assessment result
     */
    async assessSupplier(supplierId, delayDays = 0) {
        logger.info(`Quick assessment for supplier=${supplierId}, delayDays=${delayDays}`);
        
        try {
            const supplierData = await this._loadSupplierData(supplierId);
            
            if (!supplierData) {
                return {
                    success: false,
                    supplierId: supplierId,
                    error: `Supplier not found: ${supplierId}`
                };
            }
            
            // Build minimal context (supplier only)
            const context = createScoringContext({
                otif: supplierData.otif || 80,
                previousDelays: supplierData.previousDelays || 0,
                trend: supplierData.trend || 'STABLE',
                delayDays: delayDays
            });
            
            const riskResult = this.scorer.calculateRisk(context);
            
            return {
                success: true,
                supplierId: supplierData.supplierId,
                supplierName: supplierData.name,
                otif: supplierData.otif,
                previousDelays: supplierData.previousDelays,
                trend: supplierData.trend,
                riskScore: riskResult.totalScore,
                riskLevel: riskResult.riskLevel,
                scoreBreakdown: {
                    supplierPerformance: riskResult.breakdown.supplierPerformance,
                    delaySeverity: riskResult.breakdown.delaySeverity,
                    total: riskResult.breakdown.supplierPerformance + riskResult.breakdown.delaySeverity
                },
                topRiskDrivers: riskResult.topRiskDrivers,
                error: null
            };
            
        } catch (error) {
            logger.error(`Error in supplier assessment: ${error.message}`);
            return {
                success: false,
                supplierId: supplierId,
                error: error.message
            };
        }
    }
    
    /**
     * Save early warning result to database
     * 
     * @param {Object} result - Early warning result
     * @returns {boolean} Success status
     */
    async saveResult(result) {
        try {
            const { EarlyWarningResults } = this.db.entities;
            
            await INSERT.into(EarlyWarningResults).entries({
                caseId: result.caseId,
                status: result.status,
                riskScore: result.riskScore,
                riskLevel: result.riskLevel,
                supplierPerformanceScore: result.scoreBreakdown.supplierPerformance,
                delaySeverityScore: result.scoreBreakdown.delaySeverity,
                materialCriticalityScore: result.scoreBreakdown.materialCriticality,
                affectedScopeScore: result.scoreBreakdown.affectedScope,
                revenueExposureScore: result.scoreBreakdown.revenueExposure,
                supplierId: result.supplierId,
                supplierName: result.supplierName,
                supplierOtif: result.supplierOtif,
                supplierTrend: result.supplierTrend,
                materialId: result.materialId,
                materialCriticality: result.materialCriticality,
                affectedPlants: safeJsonStringify(result.affectedPlants),
                affectedSkus: safeJsonStringify(result.affectedSkus),
                topRiskDrivers: safeJsonStringify(result.topRiskDrivers),
                dataSource: result.dataSource,
                calculatedAt: result.calculatedAt,
                error: result.error
            });
            
            logger.info(`Saved early warning result for case: ${result.caseId}`);
            return true;
            
        } catch (error) {
            logger.error(`Error saving early warning result: ${error.message}`);
            return false;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    EarlyWarningAgent
};