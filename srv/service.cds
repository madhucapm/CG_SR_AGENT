using { supplierresilience } from '../db/schema';

/**
 * Supplier Resilience Service
 * 
 * This service exposes all entities and agent actions for the
 * Supply Chain Resilience solution migrated from Python.
 * 
 * Agents:
 * - Coordinator Agent: Orchestrates the workflow
 * - Early Warning Agent: Assesses supplier risk
 * - Survival Agent: Calculates inventory survival
 */
@path: '/odata/v4/supplier-resilience'
service SupplierResilienceService {

    // ═══════════════════════════════════════════════════════════════════════════
    // MASTER DATA ENTITIES (read-only for agents)
    //
    // NOTE: The following entities are not yet defined in db/schema.cds.
    // They are kept here (commented) as placeholders. Uncomment each entity
    // after adding the corresponding definition to db/schema.cds.
    // ═══════════════════════════════════════════════════════════════════════════

    // @readonly
    // entity Suppliers as projection on supplierresilience.Supplier;

    // @readonly
    // entity Materials as projection on supplierresilience.Material;

    // @readonly
    // entity Inventory as projection on supplierresilience.Inventory;

    // @readonly
    // entity Demands as projection on supplierresilience.Demand;

    // @readonly
    // entity PurchaseOrders as projection on supplierresilience.PurchaseOrder;


    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT WORKFLOW ENTITIES (read/write)
    // ═══════════════════════════════════════════════════════════════════════════

    // entity DisruptionEvents as projection on supplierresilience.DisruptionEvent;

    entity Cases as projection on supplierresilience.![Case];

    // entity EarlyWarningResults as projection on supplierresilience.EarlyWarningResult;

    // entity SurvivalResults as projection on supplierresilience.SurvivalResult;
    
    
    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT ACTIONS
    // These replace the FastAPI endpoints from the Python project
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Run Coordinator Agent
     * 
     * Equivalent to: POST /api/v1/agents/coordinator/run
     * 
     * The Coordinator Agent:
     * 1. Validates the incoming event
     * 2. Creates a disruption case
     * 3. Calls Early Warning Agent
     * 4. Calls Survival Agent
     * 5. Consolidates results
     * 6. Stores results to database
     * 
     * @param eventId - Unique event identifier
     * @param eventType - Type of event (PO_DELAY, QUALITY_ISSUE, etc.)
     * @param eventTime - ISO timestamp of when event occurred
     * @param po - Purchase order number
     * @param supplier - Supplier identifier
     * @param material - Material identifier
     * @param plant - Plant code
     * @param delayDays - Number of days delayed
     * 
     * @returns Consolidated result with case, risk assessment, and survival analysis
     */
    action runCoordinator(
        eventId     : String,
        eventType   : String,
        eventTime   : String,
        po          : String,
        supplier    : String,
        material    : String,
        plant       : String,
        delayDays   : Integer
    ) returns {
        success         : Boolean;
        caseId          : String;
        eventId         : String;
        runId           : String;
        status          : String;
        priority        : String;
        createdAt       : String;
        completedAt     : String;
        po              : String;
        supplier        : String;
        material        : String;
        plant           : String;
        delayDays       : Integer;
        earlyWarning    : {
            status          : String;
            riskScore       : Integer;
            riskLevel       : String;
            affectedPlants  : array of String;
            affectedSkus    : array of String;
            topRiskDrivers  : array of String;
        };
        survival        : {
            status              : String;
            availableInventory  : Decimal;
            weeklyDemand        : Decimal;
            unit                : String;
            survivalWeeks       : Decimal;
            supplierRecoveryWeeks : Integer;
            coverageGapWeeks    : Decimal;
            uncoveredWeeks      : Decimal;
            shortfallQuantity   : Decimal;
            actionRequired      : Boolean;
        };
        recommendation  : String;
        dataSource      : String;
        error           : String;
    };
    
    /**
     * Run Early Warning Agent
     * 
     * Equivalent to: POST /api/v1/agents/early-warning/run
     * 
     * The Early Warning Agent:
     * 1. Loads supplier data
     * 2. Loads material data
     * 3. Calculates risk score using configurable weights
     * 4. Returns structured result with topRiskDrivers
     * 
     * Risk Score Components (max 100 points):
     * - Supplier Performance: 30 points
     * - Delay Severity: 25 points
     * - Material Criticality: 20 points
     * - Affected Scope: 15 points
     * - Revenue Exposure: 10 points
     * 
     * @param caseId - Case identifier
     * @param supplier - Supplier identifier
     * @param material - Material identifier
     * @param plant - Plant code
     * @param delayDays - Number of days delayed
     * 
     * @returns Risk assessment with score breakdown
     */
    action runEarlyWarning(
        caseId      : String,
        supplier    : String,
        material    : String,
        plant       : String,
        delayDays   : Integer
    ) returns {
        success                 : Boolean;
        agent                   : String;
        caseId                  : String;
        status                  : String;
        riskScore               : Integer;
        riskLevel               : String;
        scoreBreakdown          : {
            supplierPerformance     : Integer;
            delaySeverity           : Integer;
            materialCriticality     : Integer;
            affectedScope           : Integer;
            revenueExposure         : Integer;
            total                   : Integer;
        };
        supplierId              : String;
        supplierName            : String;
        supplierOtif            : Integer;
        supplierTrend           : String;
        materialId              : String;
        materialCriticality     : String;
        affectedPlants          : array of String;
        affectedSkus            : array of String;
        topRiskDrivers          : array of String;
        dataSource              : String;
        calculatedAt            : String;
        error                   : String;
    };
    
    /**
     * Run Survival Agent
     * 
     * Equivalent to: POST /api/v1/agents/survival/run
     * 
     * The Survival Agent:
     * 1. Loads inventory data for material/plant
     * 2. Loads demand data for material/plant
     * 3. Calculates available inventory
     * 4. Calculates survival period (weeks)
     * 5. Compares with supplier recovery time
     * 6. Calculates shortfall if any
     * 
     * Formula:
     * - Available Inventory = Current - Blocked - Reserved + InTransit
     * - Survival Weeks = Available Inventory / Weekly Demand
     * - Coverage Gap = Survival Weeks - Recovery Weeks
     * - Uncovered Weeks = max(0, -Coverage Gap)
     * - Shortfall Quantity = Uncovered Weeks × Weekly Demand
     * 
     * @param caseId - Case identifier
     * @param material - Material identifier
     * @param plant - Plant code
     * @param supplierRecoveryWeeks - Expected weeks for supplier to recover
     * 
     * @returns Survival analysis with inventory breakdown and gap assessment
     */
    action runSurvival(
        caseId                  : String,
        material                : String,
        plant                   : String,
        supplierRecoveryWeeks   : Integer
    ) returns {
        success                 : Boolean;
        agent                   : String;
        caseId                  : String;
        status                  : String;
        material                : String;
        plant                   : String;
        availableInventory      : Decimal;
        inventoryBreakdown      : {
            currentStock        : Decimal;
            blockedStock        : Decimal;
            reservedStock       : Decimal;
            inTransitStock      : Decimal;
            availableInventory  : Decimal;
            calculationFormula  : String;
        };
        weeklyDemand            : Decimal;
        unit                    : String;
        survivalWeeks           : Decimal;
        supplierRecoveryWeeks   : Integer;
        coverageGapWeeks        : Decimal;
        uncoveredWeeks          : Decimal;
        shortfallQuantity       : Decimal;
        actionRequired          : Boolean;
        dataSource              : String;
        calculatedAt            : String;
        error                   : String;
    };
    
    
    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Quick Supplier Risk Assessment
     * 
     * Equivalent to: GET /api/v1/suppliers/{id}/assess
     * 
     * Performs a standalone risk assessment for a supplier
     * without creating a case.
     * 
     * @param supplierId - Supplier identifier
     * @param delayDays - Number of days delayed (optional, defaults to 0)
     * 
     * @returns Quick risk assessment
     */
    function assessSupplier(
        supplierId  : String,
        delayDays   : Integer
    ) returns {
        success         : Boolean;
        supplierId      : String;
        supplierName    : String;
        otif            : Integer;
        previousDelays  : Integer;
        trend           : String;
        riskScore       : Integer;
        riskLevel       : String;
        scoreBreakdown  : {
            supplierPerformance : Integer;
            delaySeverity       : Integer;
            total               : Integer;
        };
        topRiskDrivers  : array of String;
        error           : String;
    };
    
    /**
     * Health Check
     * 
     * Equivalent to: GET /api/v1/health
     * 
     * @returns Service health status and configuration
     */
    function health() returns {
        status      : String;
        timestamp   : String;
        dataMode    : String;
        version     : String;
        agents      : {
            coordinator     : String;
            earlyWarning    : String;
            survival        : String;
        };
    };
    
    /**
     * Get Current Configuration
     * 
     * Returns the current risk scoring configuration
     * 
     * @returns Configuration settings
     */
    function getConfig() returns {
        dataMode    : String;
        riskWeights : {
            supplierPerformance : Integer;
            delaySeverity       : Integer;
            materialCriticality : Integer;
            affectedScope       : Integer;
            revenueExposure     : Integer;
            total               : Integer;
        };
        riskLevels  : {
            low     : String;
            medium  : String;
            high    : String;
        };
        delayThresholds : {
            minor       : Integer;
            moderate    : Integer;
            significant : Integer;
        };
    };
    
    /**
     * Trigger Delay Alert (Legacy compatibility)
     * 
     * Original action from the existing CAP project.
     * Kept for backward compatibility.
     */
    action triggerDelayAlert(
        supplier    : String,
        material    : String,
        delayedDays : Integer,
        po          : String,
        plant       : String
    ) returns {
        success     : Boolean;
        message     : String;
        caseId      : String;
        eventId     : String;
        priority    : String;
        alertTime   : Timestamp;
    };
}