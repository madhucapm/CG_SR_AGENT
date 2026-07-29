/**
 * Survival Calculator
 * 
 * Migrated from: supply-chain-agents/agents/survival/calculator.py
 * 
 * Calculates inventory survival metrics:
 * - Available inventory (after blocks and reservations)
 * - Survival period in weeks
 * - Coverage gap vs supplier recovery time
 * - Shortfall quantity if inventory runs out
 * 
 * All calculations are deterministic - same input always produces same output.
 */

'use strict';

const { roundTo, safeDivide, createLogger } = require('../lib/utils');

const logger = createLogger('SurvivalCalculator');

// ═══════════════════════════════════════════════════════════════════════════════
// INVENTORY DATA CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Inventory data structure
 */
class InventoryData {
    /**
     * Create inventory data
     * 
     * @param {Object} data - Inventory data
     * @param {string} data.materialId - Material identifier
     * @param {string} data.plant - Plant code
     * @param {number} data.currentStock - Total current stock
     * @param {number} data.blockedStock - Blocked/quarantine stock
     * @param {number} data.reservedStock - Reserved for orders
     * @param {number} data.inTransitStock - Stock in transit
     * @param {string} data.unit - Unit of measure
     */
    constructor(data = {}) {
        this.materialId = data.materialId || '';
        this.plant = data.plant || '';
        this.currentStock = parseFloat(data.currentStock) || 0;
        this.blockedStock = parseFloat(data.blockedStock) || 0;
        this.reservedStock = parseFloat(data.reservedStock) || 0;
        this.inTransitStock = parseFloat(data.inTransitStock) || 0;
        this.unit = data.unit || 'UNIT';
    }
    
    /**
     * Calculate available inventory
     * Formula: Available = Current - Blocked - Reserved + InTransit
     * 
     * @returns {number} Available inventory
     */
    getAvailableInventory() {
        return this.currentStock - this.blockedStock - this.reservedStock + this.inTransitStock;
    }
    
    /**
     * Get calculation formula as string
     * 
     * @returns {string} Formula description
     */
    getFormula() {
        return `${this.currentStock} - ${this.blockedStock} - ${this.reservedStock} + ${this.inTransitStock} = ${this.getAvailableInventory()}`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMAND DATA CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Demand data structure
 */
class DemandData {
    /**
     * Create demand data
     * 
     * @param {Object} data - Demand data
     * @param {string} data.materialId - Material identifier
     * @param {string} data.plant - Plant code
     * @param {number} data.weeklyDemand - Weekly demand
     * @param {string} data.unit - Unit of measure
     */
    constructor(data = {}) {
        this.materialId = data.materialId || '';
        this.plant = data.plant || '';
        this.weeklyDemand = parseFloat(data.weeklyDemand) || 0;
        this.unit = data.unit || 'UNIT';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SURVIVAL RESULT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Survival calculation result
 */
class SurvivalResult {
    /**
     * Create survival result
     * 
     * @param {Object} data - Result data
     */
    constructor(data = {}) {
        // Inventory breakdown
        this.currentStock = data.currentStock || 0;
        this.blockedStock = data.blockedStock || 0;
        this.reservedStock = data.reservedStock || 0;
        this.inTransitStock = data.inTransitStock || 0;
        this.availableInventory = data.availableInventory || 0;
        this.calculationFormula = data.calculationFormula || '';
        
        // Demand & survival metrics
        this.weeklyDemand = data.weeklyDemand || 0;
        this.unit = data.unit || 'UNIT';
        this.survivalWeeks = data.survivalWeeks || 0;
        this.supplierRecoveryWeeks = data.supplierRecoveryWeeks || 0;
        
        // Gap analysis
        this.coverageGapWeeks = data.coverageGapWeeks || 0;      // Positive = buffer, Negative = shortfall
        this.uncoveredWeeks = data.uncoveredWeeks || 0;          // Weeks without coverage
        this.shortfallQuantity = data.shortfallQuantity || 0;    // Quantity needed
        this.actionRequired = data.actionRequired || false;       // True if shortfall exists
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SURVIVAL CALCULATOR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Survival Calculator
 * Performs deterministic survival calculations
 */
class SurvivalCalculator {
    /**
     * Create a SurvivalCalculator instance
     */
    constructor() {
        // Configuration can be added here for customization
    }
    
    /**
     * Calculate survival metrics
     * 
     * @param {Object} params - Calculation parameters
     * @param {InventoryData|Object} params.inventory - Inventory data
     * @param {DemandData|Object} params.demand - Demand data
     * @param {number} params.supplierRecoveryWeeks - Expected recovery time in weeks
     * 
     * @returns {SurvivalResult} Calculation result
     */
    calculate(params) {
        const { inventory, demand, supplierRecoveryWeeks } = params;
        
        // Ensure proper data types
        const inv = inventory instanceof InventoryData ? inventory : new InventoryData(inventory);
        const dem = demand instanceof DemandData ? demand : new DemandData(demand);
        const recoveryWeeks = parseInt(supplierRecoveryWeeks, 10) || 0;
        
        logger.debug(`Calculating survival: material=${inv.materialId}, plant=${inv.plant}`);
        
        // Step 1: Calculate available inventory
        const availableInventory = inv.getAvailableInventory();
        
        // Step 2: Calculate survival weeks
        // Formula: Survival Weeks = Available Inventory / Weekly Demand
        const survivalWeeks = this._calculateSurvivalWeeks(availableInventory, dem.weeklyDemand);
        
        // Step 3: Calculate coverage gap
        // Formula: Coverage Gap = Survival Weeks - Recovery Weeks
        // Positive = buffer, Negative = shortfall
        const coverageGapWeeks = roundTo(survivalWeeks - recoveryWeeks, 2);
        
        // Step 4: Calculate uncovered weeks (only if shortfall)
        // Uncovered Weeks = max(0, -Coverage Gap)
        const uncoveredWeeks = Math.max(0, -coverageGapWeeks);
        
        // Step 5: Calculate shortfall quantity
        // Shortfall = Uncovered Weeks × Weekly Demand
        const shortfallQuantity = roundTo(uncoveredWeeks * dem.weeklyDemand, 2);
        
        // Step 6: Determine if action is required
        const actionRequired = uncoveredWeeks > 0;
        
        const result = new SurvivalResult({
            // Inventory breakdown
            currentStock: inv.currentStock,
            blockedStock: inv.blockedStock,
            reservedStock: inv.reservedStock,
            inTransitStock: inv.inTransitStock,
            availableInventory: roundTo(availableInventory, 2),
            calculationFormula: inv.getFormula(),
            
            // Demand & survival
            weeklyDemand: dem.weeklyDemand,
            unit: inv.unit || dem.unit,
            survivalWeeks: roundTo(survivalWeeks, 2),
            supplierRecoveryWeeks: recoveryWeeks,
            
            // Gap analysis
            coverageGapWeeks: coverageGapWeeks,
            uncoveredWeeks: roundTo(uncoveredWeeks, 2),
            shortfallQuantity: shortfallQuantity,
            actionRequired: actionRequired
        });
        
        logger.debug(`Survival result: survivalWeeks=${result.survivalWeeks}, gap=${result.coverageGapWeeks}, action=${result.actionRequired}`);
        
        return result;
    }
    
    /**
     * Calculate survival weeks
     * 
     * @param {number} availableInventory - Available inventory
     * @param {number} weeklyDemand - Weekly demand
     * @returns {number} Survival weeks
     */
    _calculateSurvivalWeeks(availableInventory, weeklyDemand) {
        // Handle edge cases
        if (weeklyDemand <= 0) {
            // No demand = infinite survival (cap at reasonable number)
            return availableInventory > 0 ? 999 : 0;
        }
        
        if (availableInventory <= 0) {
            // No inventory = zero survival
            return 0;
        }
        
        return safeDivide(availableInventory, weeklyDemand, 0);
    }
    
    /**
     * Quick survival calculation (convenience method)
     * 
     * @param {number} availableInventory - Available inventory
     * @param {number} weeklyDemand - Weekly demand
     * @param {number} recoveryWeeks - Supplier recovery weeks
     * @returns {Object} Quick result
     */
    quickCalculate(availableInventory, weeklyDemand, recoveryWeeks) {
        const survivalWeeks = this._calculateSurvivalWeeks(availableInventory, weeklyDemand);
        const coverageGapWeeks = survivalWeeks - recoveryWeeks;
        const uncoveredWeeks = Math.max(0, -coverageGapWeeks);
        const shortfallQuantity = uncoveredWeeks * weeklyDemand;
        
        return {
            availableInventory: roundTo(availableInventory, 2),
            weeklyDemand: roundTo(weeklyDemand, 2),
            survivalWeeks: roundTo(survivalWeeks, 2),
            supplierRecoveryWeeks: recoveryWeeks,
            coverageGapWeeks: roundTo(coverageGapWeeks, 2),
            uncoveredWeeks: roundTo(uncoveredWeeks, 2),
            shortfallQuantity: roundTo(shortfallQuantity, 2),
            actionRequired: uncoveredWeeks > 0
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate survival (convenience function)
 * 
 * @param {Object} inventory - Inventory data
 * @param {Object} demand - Demand data
 * @param {number} supplierRecoveryWeeks - Recovery weeks
 * @returns {SurvivalResult} Calculation result
 */
function calculateSurvival(inventory, demand, supplierRecoveryWeeks) {
    const calculator = new SurvivalCalculator();
    return calculator.calculate({ inventory, demand, supplierRecoveryWeeks });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    SurvivalCalculator,
    SurvivalResult,
    InventoryData,
    DemandData,
    calculateSurvival
};