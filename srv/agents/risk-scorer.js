/**
 * Risk Scoring Engine for Early Warning Agent
 * 
 * Migrated from: supply-chain-agents/agents/early_warning/scoring.py
 * 
 * Per Initial Development Guidelines - Task 4: Calculate risk score
 * Start with a simple scoring rule:
 * - Supplier performance:  30 points
 * - Delay severity:        25 points
 * - Material criticality:  20 points
 * - Affected SKUs/plants:  15 points
 * - Revenue exposure:      10 points
 * 
 * Risk levels:
 * - 0–39   = LOW
 * - 40–69  = MEDIUM
 * - 70–100 = HIGH
 * 
 * Per guidelines: Python/JavaScript code—not an LLM—must calculate risk score.
 * The score should be configurable and not scattered across the code.
 */

'use strict';

const {
    RiskLevel,
    RISK_WEIGHTS,
    RISK_THRESHOLDS,
    OTIF_THRESHOLDS,
    DELAY_THRESHOLDS,
    CRITICALITY_SCORES,
    REVENUE_THRESHOLDS,
    DEFAULT_CONFIG
} = require('../lib/constants');

const { clamp, createLogger } = require('../lib/utils');

const logger = createLogger('RiskScorer');

// ═══════════════════════════════════════════════════════════════════════════════
// SCORING CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Default scoring context values
 */
const DEFAULT_CONTEXT = {
    // Supplier data
    otif: 80,
    previousDelays: 0,
    trend: 'STABLE',
    
    // Delay data
    delayDays: 0,
    
    // Material data
    criticality: 'MEDIUM',
    affectedPlants: [],
    affectedSkus: [],
    
    // Revenue data
    estimatedRevenueImpact: 0
};

/**
 * Create a scoring context with defaults
 * 
 * @param {Object} data - Partial context data
 * @returns {Object} Complete scoring context
 */
function createScoringContext(data = {}) {
    return {
        ...DEFAULT_CONTEXT,
        ...data,
        // Ensure arrays are arrays
        affectedPlants: Array.isArray(data.affectedPlants) ? data.affectedPlants : [],
        affectedSkus: Array.isArray(data.affectedSkus) ? data.affectedSkus : []
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RISK SCORER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Risk Scorer - Calculates deterministic risk scores
 * 
 * This class implements the risk scoring logic per the guidelines.
 * All calculations are deterministic - same input always produces same output.
 */
class RiskScorer {
    /**
     * Create a RiskScorer instance
     * 
     * @param {Object} weights - Custom risk weights (optional)
     * @param {Object} thresholds - Custom risk thresholds (optional)
     */
    constructor(weights = RISK_WEIGHTS, thresholds = RISK_THRESHOLDS) {
        this.weights = { ...weights };
        this.thresholds = { ...thresholds };
    }
    
    /**
     * Calculate the overall risk score
     * 
     * @param {Object} context - Scoring context with all relevant data
     * @returns {Object} Result with totalScore, riskLevel, breakdown, topRiskDrivers
     */
    calculateRisk(context) {
        const ctx = createScoringContext(context);
        const riskDrivers = [];
        
        // Calculate each component
        const { score: supplierScore, drivers: supplierDrivers } = 
            this._scoreSupplierPerformance(ctx);
        
        const { score: delayScore, drivers: delayDrivers } = 
            this._scoreDelaySeverity(ctx);
        
        const { score: criticalityScore, drivers: criticalityDrivers } = 
            this._scoreMaterialCriticality(ctx);
        
        const { score: scopeScore, drivers: scopeDrivers } = 
            this._scoreAffectedScope(ctx);
        
        const { score: revenueScore, drivers: revenueDrivers } = 
            this._scoreRevenueExposure(ctx);
        
        // Collect all risk drivers (highest impact first)
        riskDrivers.push(
            ...supplierDrivers,
            ...delayDrivers,
            ...criticalityDrivers,
            ...scopeDrivers,
            ...revenueDrivers
        );
        
        // Create score breakdown
        const breakdown = {
            supplierPerformance: supplierScore,
            delaySeverity: delayScore,
            materialCriticality: criticalityScore,
            affectedScope: scopeScore,
            revenueExposure: revenueScore,
            total: supplierScore + delayScore + criticalityScore + scopeScore + revenueScore
        };
        
        // Calculate total score (capped at 100)
        const totalScore = clamp(breakdown.total, 0, 100);
        
        // Determine risk level
        const riskLevel = this._determineRiskLevel(totalScore);
        
        // Keep top N risk drivers
        const topRiskDrivers = riskDrivers.slice(0, DEFAULT_CONFIG.maxRiskDrivers);
        
        logger.debug(`Calculated risk: score=${totalScore}, level=${riskLevel}`);
        
        return {
            totalScore,
            riskLevel,
            breakdown,
            topRiskDrivers
        };
    }
    
    /**
     * Score supplier performance (max 30 points)
     * 
     * Factors:
     * - OTIF percentage (up to 15 points)
     * - Number of previous delays (up to 10 points)
     * - Performance trend (up to 5 points)
     * 
     * @param {Object} context - Scoring context
     * @returns {Object} { score, drivers }
     */
    _scoreSupplierPerformance(context) {
        const maxScore = this.weights.supplierPerformance;
        let score = 0;
        const drivers = [];
        
        const { otif, previousDelays, trend } = context;
        
        // OTIF scoring (up to 15 points)
        if (otif < OTIF_THRESHOLDS.poor) {
            // Below 70%
            score += 15;
            drivers.push(`Supplier OTIF is critically low at ${otif}% (below 70% threshold)`);
        } else if (otif < OTIF_THRESHOLDS.acceptable) {
            // 70-79%
            score += 10;
            drivers.push(`Supplier OTIF is ${otif}% (below 80% threshold)`);
        } else if (otif < OTIF_THRESHOLDS.excellent) {
            // 80-89%
            score += 5;
            drivers.push(`Supplier OTIF is ${otif}% (below 90% excellence threshold)`);
        }
        // OTIF >= 90% = no additional risk
        
        // Previous delays scoring (up to 10 points)
        if (previousDelays >= 4) {
            score += 10;
            drivers.push(`Supplier has ${previousDelays} previous delays (high recurrence)`);
        } else if (previousDelays >= 2) {
            score += 6;
            drivers.push(`Supplier has ${previousDelays} previous delays`);
        } else if (previousDelays >= 1) {
            score += 3;
            drivers.push(`Supplier has ${previousDelays} previous delay`);
        }
        
        // Trend scoring (up to 5 points)
        const trendUpper = (trend || 'STABLE').toUpperCase();
        if (trendUpper === 'DETERIORATING') {
            score += 5;
            drivers.push('Supplier performance trend is deteriorating');
        } else if (trendUpper === 'STABLE' && score > 10) {
            // Stable but already has issues
            score += 2;
        }
        // IMPROVING trend doesn't add risk
        
        // Cap at max score
        return {
            score: Math.min(score, maxScore),
            drivers
        };
    }
    
    /**
     * Score delay severity (max 25 points)
     * 
     * Factors:
     * - Number of delay days
     * 
     * @param {Object} context - Scoring context
     * @returns {Object} { score, drivers }
     */
    _scoreDelaySeverity(context) {
        const maxScore = this.weights.delaySeverity;
        let score = 0;
        const drivers = [];
        
        const { delayDays } = context;
        const days = delayDays || 0;
        
        if (days > DELAY_THRESHOLDS.significant) {
            // > 21 days = severe
            score = 25;
            drivers.push(`Severe delay of ${days} days (>3 weeks)`);
        } else if (days > DELAY_THRESHOLDS.moderate) {
            // 15-21 days
            score = 20;
            drivers.push(`Significant delay of ${days} days (2-3 weeks)`);
        } else if (days > DELAY_THRESHOLDS.minor) {
            // 8-14 days
            score = 12;
            drivers.push(`Moderate delay of ${days} days (1-2 weeks)`);
        } else if (days > 3) {
            // 4-7 days
            score = 6;
            drivers.push(`Minor delay of ${days} days`);
        } else if (days > 0) {
            // 1-3 days
            score = 3;
        }
        
        return {
            score: Math.min(score, maxScore),
            drivers
        };
    }
    
    /**
     * Score material criticality (max 20 points)
     * 
     * Factors:
     * - Material criticality level (CRITICAL/HIGH/MEDIUM/LOW)
     * 
     * @param {Object} context - Scoring context
     * @returns {Object} { score, drivers }
     */
    _scoreMaterialCriticality(context) {
        const maxScore = this.weights.materialCriticality;
        const drivers = [];
        
        const criticality = (context.criticality || 'MEDIUM').toUpperCase();
        const score = CRITICALITY_SCORES[criticality] || CRITICALITY_SCORES.MEDIUM;
        
        if (criticality === 'CRITICAL') {
            drivers.push('Material is marked as CRITICAL for production');
        } else if (criticality === 'HIGH') {
            drivers.push('Material has HIGH criticality rating');
        }
        // Medium and Low criticality don't warrant a risk driver
        
        return {
            score: Math.min(score, maxScore),
            drivers
        };
    }
    
    /**
     * Score affected scope (max 15 points)
     * 
     * Factors:
     * - Number of affected plants (up to 8 points)
     * - Number of affected SKUs (up to 7 points)
     * 
     * @param {Object} context - Scoring context
     * @returns {Object} { score, drivers }
     */
    _scoreAffectedScope(context) {
        const maxScore = this.weights.affectedScope;
        let score = 0;
        const drivers = [];
        
        const plants = context.affectedPlants?.length || 0;
        const skus = context.affectedSkus?.length || 0;
        
        // Plants scoring (up to 8 points)
        if (plants >= 4) {
            score += 8;
            drivers.push(`Disruption affects ${plants} plants (widespread impact)`);
        } else if (plants >= 2) {
            score += 5;
            drivers.push(`Disruption affects ${plants} plants`);
        } else if (plants === 1) {
            score += 2;
        }
        
        // SKUs scoring (up to 7 points)
        if (skus >= 5) {
            score += 7;
            drivers.push(`Disruption affects ${skus} SKUs (broad product impact)`);
        } else if (skus >= 3) {
            score += 5;
            drivers.push(`Disruption affects ${skus} SKUs`);
        } else if (skus >= 1) {
            score += 2;
        }
        
        return {
            score: Math.min(score, maxScore),
            drivers
        };
    }
    
    /**
     * Score revenue exposure (max 10 points)
     * 
     * Factors:
     * - Estimated revenue impact
     * 
     * @param {Object} context - Scoring context
     * @returns {Object} { score, drivers }
     */
    _scoreRevenueExposure(context) {
        const maxScore = this.weights.revenueExposure;
        let score = 0;
        const drivers = [];
        
        const revenue = context.estimatedRevenueImpact || 0;
        
        if (revenue >= REVENUE_THRESHOLDS.high) {
            // >= 1M
            score = 10;
            const revenueInLakhs = (revenue / 100000).toFixed(1);
            drivers.push(`High revenue exposure: ₹${revenueInLakhs}L+ at risk`);
        } else if (revenue >= REVENUE_THRESHOLDS.medium) {
            // 500K - 1M
            score = 7;
            const revenueInLakhs = (revenue / 100000).toFixed(1);
            drivers.push(`Significant revenue exposure: ₹${revenueInLakhs}L at risk`);
        } else if (revenue >= REVENUE_THRESHOLDS.low) {
            // 100K - 500K
            score = 4;
        } else if (revenue > 0) {
            // < 100K
            score = 2;
        }
        
        return {
            score: Math.min(score, maxScore),
            drivers
        };
    }
    
    /**
     * Determine risk level from total score
     * 
     * Per guidelines:
     * - 0–39   = LOW
     * - 40–69  = MEDIUM
     * - 70–100 = HIGH
     * 
     * @param {number} score - Total risk score
     * @returns {string} Risk level (LOW, MEDIUM, HIGH)
     */
    _determineRiskLevel(score) {
        for (const [level, range] of Object.entries(this.thresholds)) {
            if (score >= range.min && score <= range.max) {
                return level;
            }
        }
        // Default to HIGH if score exceeds 100
        return RiskLevel.HIGH;
    }
    
    /**
     * Get current configuration
     * 
     * @returns {Object} Current weights and thresholds
     */
    getConfig() {
        return {
            weights: { ...this.weights },
            thresholds: { ...this.thresholds }
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate risk score (convenience function)
 * 
 * @param {Object} context - Scoring context
 * @returns {Object} Risk calculation result
 */
function calculateRiskScore(context) {
    const scorer = new RiskScorer();
    return scorer.calculateRisk(context);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    RiskScorer,
    calculateRiskScore,
    createScoringContext
};