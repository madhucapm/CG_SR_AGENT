/**
 * Constants and Enums for Supply Chain Resilience Agents
 * 
 * Migrated from: supply-chain-agents/common/models.py
 * 
 * This module contains all configurable constants, enums, and thresholds
 * used by the agents. Per guidelines, risk scoring configuration should
 * be centralized and not scattered across the code.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// DATA MODES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Data source modes
 * MOCK = Use mock data from CSV files
 * S4 = Connect to S/4HANA (future)
 */
const DataMode = Object.freeze({
    MOCK: 'MOCK',
    S4: 'S4'
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT IDENTIFIERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agent names for logging and identification
 */
const AgentName = Object.freeze({
    COORDINATOR: 'COORDINATOR',
    EARLY_WARNING: 'EARLY_WARNING',
    SURVIVAL: 'SURVIVAL',
    SURVIVAL_PLANNER: 'SVP'
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS ENUMS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agent processing status
 */
const AgentStatus = Object.freeze({
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    SKIPPED: 'SKIPPED',
    ERROR: 'ERROR'
});

/**
 * Case status - Final status after consolidation
 * Per guidelines:
 * - High risk + survival shortfall → ACTION_REQUIRED
 * - High risk + no survival shortfall → MONITORING
 * - Missing data → DATA_INCOMPLETE
 */
const CaseStatus = Object.freeze({
    ANALYSIS_IN_PROGRESS: 'ANALYSIS_IN_PROGRESS',
    ACTION_REQUIRED: 'ACTION_REQUIRED',
    MONITORING: 'MONITORING',
    DATA_INCOMPLETE: 'DATA_INCOMPLETE',
    COMPLETED: 'COMPLETED'
});

/**
 * Priority levels for cases
 */
const Priority = Object.freeze({
    CRITICAL: 'CRITICAL',
    HIGH: 'HIGH',
    MEDIUM: 'MEDIUM',
    LOW: 'LOW'
});

// ═══════════════════════════════════════════════════════════════════════════════
// RISK SCORING CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Risk levels
 * Per guidelines:
 * - 0-39 = LOW
 * - 40-69 = MEDIUM
 * - 70-100 = HIGH
 */
const RiskLevel = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH'
});

/**
 * Risk scoring weights (max points per component)
 * Per Initial Development Guidelines - Task 4:
 * - Supplier performance: 30 points
 * - Delay severity: 25 points
 * - Material criticality: 20 points
 * - Affected SKUs/plants: 15 points
 * - Revenue exposure: 10 points
 * Total: 100 points
 */
const RISK_WEIGHTS = Object.freeze({
    supplierPerformance: 30,
    delaySeverity: 25,
    materialCriticality: 20,
    affectedScope: 15,
    revenueExposure: 10
});

/**
 * Risk level thresholds
 * Per guidelines:
 * - 0-39 = LOW
 * - 40-69 = MEDIUM
 * - 70-100 = HIGH
 */
const RISK_THRESHOLDS = Object.freeze({
    LOW: { min: 0, max: 39 },
    MEDIUM: { min: 40, max: 69 },
    HIGH: { min: 70, max: 100 }
});

/**
 * OTIF (On-Time In-Full) thresholds for supplier scoring
 */
const OTIF_THRESHOLDS = Object.freeze({
    excellent: 90,    // OTIF >= 90% = good supplier
    acceptable: 80,   // OTIF >= 80% = acceptable
    poor: 70          // OTIF >= 70% = needs attention
    // Below 70% = critical
});

/**
 * Delay severity thresholds (days)
 */
const DELAY_THRESHOLDS = Object.freeze({
    minor: 7,         // <= 7 days = minor delay
    moderate: 14,     // <= 14 days = moderate
    significant: 21   // <= 21 days = significant
    // > 21 days = severe
});

/**
 * Material criticality scores
 */
const CRITICALITY_SCORES = Object.freeze({
    CRITICAL: 20,
    HIGH: 15,
    MEDIUM: 10,
    LOW: 5
});

/**
 * Revenue impact thresholds (in local currency)
 */
const REVENUE_THRESHOLDS = Object.freeze({
    low: 100000,      // < 100K = low impact
    medium: 500000,   // < 500K = medium
    high: 1000000     // < 1M = high
    // >= 1M = critical
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Supported disruption event types
 */
const EventType = Object.freeze({
    PO_DELAY: 'PO_DELAY',
    QUALITY_ISSUE: 'QUALITY_ISSUE',
    SUPPLIER_RISK: 'SUPPLIER_RISK',
    CAPACITY_ISSUE: 'CAPACITY_ISSUE',
    LOGISTICS_DELAY: 'LOGISTICS_DELAY'
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPLIER TRENDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Supplier performance trends
 */
const SupplierTrend = Object.freeze({
    IMPROVING: 'IMPROVING',
    STABLE: 'STABLE',
    DETERIORATING: 'DETERIORATING'
});

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Required fields for event validation
 */
const REQUIRED_EVENT_FIELDS = Object.freeze([
    'eventId',
    'eventType',
    'supplier',
    'material',
    'plant'
]);

/**
 * Maximum field lengths for validation
 */
const FIELD_MAX_LENGTHS = Object.freeze({
    eventId: 30,
    eventType: 30,
    po: 20,
    supplier: 60,
    material: 60,
    plant: 40
});

// ═══════════════════════════════════════════════════════════════════════════════
// APPLICATION CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Application version
 */
const APP_VERSION = '1.0.0';

/**
 * Default configuration
 */
const DEFAULT_CONFIG = Object.freeze({
    dataMode: DataMode.MOCK,
    defaultRecoveryWeeks: 14,
    maxRiskDrivers: 5
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    // Enums
    DataMode,
    AgentName,
    AgentStatus,
    CaseStatus,
    Priority,
    RiskLevel,
    EventType,
    SupplierTrend,
    
    // Risk Scoring Configuration
    RISK_WEIGHTS,
    RISK_THRESHOLDS,
    OTIF_THRESHOLDS,
    DELAY_THRESHOLDS,
    CRITICALITY_SCORES,
    REVENUE_THRESHOLDS,
    
    // Validation
    REQUIRED_EVENT_FIELDS,
    FIELD_MAX_LENGTHS,
    
    // Application
    APP_VERSION,
    DEFAULT_CONFIG
};
