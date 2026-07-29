/**
 * Survival Agent
 * 
 * Migrated from: supply-chain-agents/agents/survival/agent.py
 * 
 * Calculates how long available inventory can sustain production
 * and identifies coverage gaps relative to supplier recovery time.
 * 
 * Per Initial Development Guidelines:
 * - Must produce same result every time for same mock input
 * - Must clearly show: inventory used, demand used, formula,
 *   survival period, recovery period, shortfall
 */

'use strict';

const {
    AgentName,
    AgentStatus,
    DEFAULT_CONFIG
} = require('../lib/constants');

const {
    getCurrentTimestamp,
    getDataMode,
    safeJsonStringify,
    createLogger
} = require('../lib/utils');

const {
    SurvivalCalculator,
    InventoryData,
    DemandData
} = require('./survival-calculator');

const logger = createLogger('Survival');

// ═══════════════════════════════════════════════════════════════════════════════
// SURVIVAL AGENT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Survival Agent
 * Calculates inventory survival period and identifies coverage gaps
 */
class SurvivalAgent {
    /**
     * Create a Survival Agent instance
     * 
     * @param {Object} db - Database service (CDS)
     */
    constructor(db) {
        this.db = db;
        this.calculator = new SurvivalCalculator();
        this.agentName = AgentName.SURVIVAL;
    }
    
    /**
     * Run survival analysis
     * 
     * @param {Object} input - Analysis input
     * @param {string} input.caseId - Case identifier
     * @param {string} input.material - Material identifier
     * @param {string} input.plant - Plant code
     * @param {number} input.supplierRecoveryWeeks - Expected recovery weeks
     * 
     * @returns {Object} SurvivalOutput with analysis results
     */
    async run(input) {
        const { caseId, material, plant, supplierRecoveryWeeks } = input;
        
        const recoveryWeeks = supplierRecoveryWeeks || DEFAULT_CONFIG.defaultRecoveryWeeks;
        
        logger.info(`Running survival analysis: case=${caseId}, material=${material}, plant=${plant}`);
        
        try {
            // Step 1: Load inventory data
            const inventoryData = await this._loadInventoryData(material, plant);
            
            if (!inventoryData) {
                return this._createErrorOutput(
                    caseId,
                    material,
                    plant,
                    recoveryWeeks,
                    `No inventory data found for ${material} at ${plant}`
                );
            }
            
            // Step 2: Load demand data
            const demandData = await this._loadDemandData(material, plant);
            
            if (!demandData) {
                return this._createErrorOutput(
                    caseId,
                    material,
                    plant,
                    recoveryWeeks,
                    `No demand data found for ${material} at ${plant}`
                );
            }
            
            // Step 3: Perform survival calculation
            const result = this.calculator.calculate({
                inventory: inventoryData,
                demand: demandData,
                supplierRecoveryWeeks: recoveryWeeks
            });
            
            // Step 4: Build and return response
            const output = {
                success: true,
                agent: this.agentName,
                caseId: caseId,
                status: AgentStatus.COMPLETED,
                material: material,
                plant: plant,
                availableInventory: result.availableInventory,
                inventoryBreakdown: {
                    currentStock: result.currentStock,
                    blockedStock: result.blockedStock,
                    reservedStock: result.reservedStock,
                    inTransitStock: result.inTransitStock,
                    availableInventory: result.availableInventory,
                    calculationFormula: result.calculationFormula
                },
                weeklyDemand: result.weeklyDemand,
                unit: result.unit,
                survivalWeeks: result.survivalWeeks,
                supplierRecoveryWeeks: result.supplierRecoveryWeeks,
                coverageGapWeeks: result.coverageGapWeeks,
                uncoveredWeeks: result.uncoveredWeeks,
                shortfallQuantity: result.shortfallQuantity,
                actionRequired: result.actionRequired,
                dataSource: getDataMode(),
                calculatedAt: getCurrentTimestamp(),
                error: null
            };
            
            logger.info(`Survival analysis completed: survivalWeeks=${output.survivalWeeks}, actionRequired=${output.actionRequired}`);
            
            return output;
            
        } catch (error) {
            logger.error(`Error in survival analysis: ${error.message}`);
            return this._createErrorOutput(
                caseId,
                material,
                plant,
                recoveryWeeks,
                error.message
            );
        }
    }
    
    /**
     * Load inventory data from database
     * 
     * @param {string} materialId - Material identifier
     * @param {string} plant - Plant code
     * @returns {InventoryData|null} Inventory data or null
     */
    async _loadInventoryData(materialId, plant) {
        try {
            const { Inventory } = this.db.entities;
            
            // Try exact match first
            let inventory = await SELECT.one
                .from(Inventory)
                .where({ materialId: materialId, plant: plant });
            
            if (!inventory) {
                // Try by material only (first match)
                inventory = await SELECT.one
                    .from(Inventory)
                    .where({ materialId: materialId });
            }
            
            if (!inventory) {
                logger.warn(`Inventory not found for ${materialId} at ${plant}`);
                return null;
            }
            
            return new InventoryData({
                materialId: inventory.materialId,
                plant: inventory.plant,
                currentStock: parseFloat(inventory.currentStock) || 0,
                blockedStock: parseFloat(inventory.blockedStock) || 0,
                reservedStock: parseFloat(inventory.reservedStock) || 0,
                inTransitStock: parseFloat(inventory.inTransitStock) || 0,
                unit: inventory.unit || 'UNIT'
            });
            
        } catch (error) {
            logger.error(`Error loading inventory data: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Load demand data from database
     * 
     * @param {string} materialId - Material identifier
     * @param {string} plant - Plant code
     * @returns {DemandData|null} Demand data or null
     */
    async _loadDemandData(materialId, plant) {
        try {
            const { Demands } = this.db.entities;
            
            // Try exact match first
            let demand = await SELECT.one
                .from(Demands)
                .where({ materialId: materialId, plant: plant });
            
            if (!demand) {
                // Try by material only (first match)
                demand = await SELECT.one
                    .from(Demands)
                    .where({ materialId: materialId });
            }
            
            if (!demand) {
                logger.warn(`Demand not found for ${materialId} at ${plant}`);
                return null;
            }
            
            return new DemandData({
                materialId: demand.materialId,
                plant: demand.plant,
                weeklyDemand: parseFloat(demand.weeklyDemand) || 0,
                unit: demand.unit || 'UNIT'
            });
            
        } catch (error) {
            logger.error(`Error loading demand data: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Create error output
     * 
     * @param {string} caseId - Case identifier
     * @param {string} material - Material identifier
     * @param {string} plant - Plant code
     * @param {number} supplierRecoveryWeeks - Recovery weeks
     * @param {string} errorMessage - Error message
     * @returns {Object} Error output
     */
    _createErrorOutput(caseId, material, plant, supplierRecoveryWeeks, errorMessage) {
        return {
            success: false,
            agent: this.agentName,
            caseId: caseId,
            status: AgentStatus.ERROR,
            material: material,
            plant: plant,
            availableInventory: 0,
            inventoryBreakdown: {
                currentStock: 0,
                blockedStock: 0,
                reservedStock: 0,
                inTransitStock: 0,
                availableInventory: 0,
                calculationFormula: 'N/A - Error'
            },
            weeklyDemand: 0,
            unit: 'UNKNOWN',
            survivalWeeks: 0,
            supplierRecoveryWeeks: supplierRecoveryWeeks,
            coverageGapWeeks: -supplierRecoveryWeeks,
            uncoveredWeeks: supplierRecoveryWeeks,
            shortfallQuantity: 0,
            actionRequired: true,
            dataSource: getDataMode(),
            calculatedAt: getCurrentTimestamp(),
            error: errorMessage
        };
    }
    
    /**
     * Save survival result to database
     * 
     * @param {Object} result - Survival result
     * @returns {boolean} Success status
     */
    async saveResult(result) {
        try {
            const { SurvivalResults } = this.db.entities;
            
            await INSERT.into(SurvivalResults).entries({
                caseId: result.caseId,
                status: result.status,
                material: result.material,
                plant: result.plant,
                currentStock: result.inventoryBreakdown.currentStock,
                blockedStock: result.inventoryBreakdown.blockedStock,
                reservedStock: result.inventoryBreakdown.reservedStock,
                inTransitStock: result.inventoryBreakdown.inTransitStock,
                availableInventory: result.availableInventory,
                calculationFormula: result.inventoryBreakdown.calculationFormula,
                weeklyDemand: result.weeklyDemand,
                unit: result.unit,
                survivalWeeks: result.survivalWeeks,
                supplierRecoveryWeeks: result.supplierRecoveryWeeks,
                coverageGapWeeks: result.coverageGapWeeks,
                uncoveredWeeks: result.uncoveredWeeks,
                shortfallQuantity: result.shortfallQuantity,
                actionRequired: result.actionRequired,
                dataSource: result.dataSource,
                calculatedAt: result.calculatedAt,
                error: result.error
            });
            
            logger.info(`Saved survival result for case: ${result.caseId}`);
            return true;
            
        } catch (error) {
            logger.error(`Error saving survival result: ${error.message}`);
            return false;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    SurvivalAgent
};