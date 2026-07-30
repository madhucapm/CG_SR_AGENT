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
    // ═══════════════════════════════════════════════════════════════════════════

    @readonly
    entity Suppliers as projection on supplierresilience.Supplier;

    @readonly
    entity Materials as projection on supplierresilience.Material;

    @readonly
    entity Inventory as projection on supplierresilience.Inventory;

    @readonly
    entity Demands as projection on supplierresilience.Demand;

    @readonly
    entity PurchaseOrders as projection on supplierresilience.PurchaseOrder;


    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT WORKFLOW ENTITIES (read/write)
    // ═══════════════════════════════════════════════════════════════════════════

    entity DisruptionEvents as projection on supplierresilience.DisruptionEvent;

    entity Cases as projection on supplierresilience.![Case];

    entity EarlyWarningResults as projection on supplierresilience.EarlyWarningResult;

    entity SurvivalResults as projection on supplierresilience.SurvivalResult;
    
    entity CaseHistories as projection on supplierresilience.CaseHistory;
    
    
    // ═══════════════════════════════════════════════════════════════════════════
    // DASHBOARD APIs
    // These functions provide aggregated data for UI dashboard visualization
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * List Cases with Filters
     * 
     * Equivalent to: GET /api/v1/cases
     * 
     * Returns a filtered list of disruption cases for dashboard table view.
     * Supports filtering by status, priority, plant, and date range.
     * 
     * @param status - Filter by case status (Open, In Progress, Resolved, etc.)
     * @param priority - Filter by priority (CRITICAL, HIGH, MEDIUM, LOW)
     * @param plant - Filter by plant code
     * @param supplier - Filter by supplier ID
     * @param fromDate - Filter cases created after this date (ISO format)
     * @param toDate - Filter cases created before this date (ISO format)
     * @param limit - Maximum number of cases to return (default 100)
     * 
     * @returns Array of case summaries
     */
    function listCases(
        status      : String,
        priority    : String,
        plant       : String,
        supplier    : String,
        fromDate    : String,
        toDate      : String,
        limit       : Integer
    ) returns {
        success     : Boolean;
        count       : Integer;
        cases       : array of {
            caseId          : String;
            eventId         : String;
            status          : String;
            priority        : String;
            supplier        : String;
            material        : String;
            plant           : String;
            delayDays       : Integer;
            eventType       : String;
            createdAt       : String;
            recommendation  : String;
        };
    };
    
    /**
     * Get Case Detail with Agent Results
     * 
     * Equivalent to: GET /api/v1/cases/{case_id}
     * 
     * Returns complete case information including early warning and survival
     * analysis results. Used for case detail view in dashboard.
     * 
     * @param caseId - The case identifier
     * 
     * @returns Full case details with agent results
     */
    function getCaseDetail(caseId : String) returns {
        success         : Boolean;
        caseData        : {
            caseId          : String;
            eventId         : String;
            runId           : String;
            status          : String;
            priority        : String;
            eventType       : String;
            po              : String;
            supplier        : String;
            material        : String;
            plant           : String;
            delayDays       : Integer;
            eventTime       : String;
            createdAt       : String;
            completedAt     : String;
            recommendation  : String;
            dataSource      : String;
        };
        earlyWarning    : {
            status                  : String;
            riskScore               : Integer;
            riskLevel               : String;
            supplierPerformanceScore : Integer;
            delaySeverityScore      : Integer;
            materialCriticalityScore : Integer;
            affectedScopeScore      : Integer;
            revenueExposureScore    : Integer;
            supplierId              : String;
            supplierName            : String;
            supplierOtif            : Integer;
            supplierTrend           : String;
            materialId              : String;
            materialCriticality     : String;
            affectedPlants          : array of String;
            affectedSkus            : array of String;
            topRiskDrivers          : array of String;
            calculatedAt            : String;
        };
        survival        : {
            status              : String;
            material            : String;
            plant               : String;
            currentStock        : Decimal;
            blockedStock        : Decimal;
            reservedStock       : Decimal;
            inTransitStock      : Decimal;
            availableInventory  : Decimal;
            calculationFormula  : String;
            weeklyDemand        : Decimal;
            unit                : String;
            survivalWeeks       : Decimal;
            supplierRecoveryWeeks : Integer;
            coverageGapWeeks    : Decimal;
            uncoveredWeeks      : Decimal;
            shortfallQuantity   : Decimal;
            actionRequired      : Boolean;
            calculatedAt        : String;
        };
        error           : String;
    };
    
    /**
     * Get Case History / Timeline
     * 
     * Equivalent to: GET /api/v1/cases/{case_id}/history
     * 
     * Returns the timeline of status changes and agent actions for a case.
     * Used for audit trail and timeline visualization.
     * 
     * @param caseId - The case identifier
     * 
     * @returns Array of history entries
     */
    function getCaseHistory(caseId : String) returns {
        success     : Boolean;
        caseId      : String;
        history     : array of {
            timestamp       : String;
            previousStatus  : String;
            newStatus       : String;
            action          : String;
            agent           : String;
            details         : String;
            userId          : String;
        };
        error       : String;
    };
    
    /**
     * Delete / Archive a Case
     * 
     * Equivalent to: DELETE /api/v1/cases/{case_id}
     * 
     * Removes a case and its associated results from the system.
     * Used for cleanup or archiving resolved cases.
     * 
     * @param caseId - The case identifier to delete
     * 
     * @returns Success status and message
     */
    action deleteCase(caseId : String) returns {
        success     : Boolean;
        message     : String;
        deletedAt   : String;
    };
    
    /**
     * Dashboard Summary
     * 
     * Equivalent to: GET /api/v1/dashboard/summary
     * 
     * Returns all KPIs and aggregated metrics for the main dashboard view.
     * Single API call to populate dashboard cards and counters.
     * 
     * @returns Dashboard summary with all KPIs
     */
    function getDashboardSummary() returns {
        success             : Boolean;
        timestamp           : String;
        totalCases          : Integer;
        openCases           : Integer;
        inProgressCases     : Integer;
        resolvedCases       : Integer;
        actionRequiredCases : Integer;
        monitoringCases     : Integer;
        criticalCases       : Integer;
        highRiskSuppliers   : Integer;
        avgRiskScore        : Decimal;
        inventoryAlerts     : Integer;
        casesLast24h        : Integer;
        casesLast7d         : Integer;
        casesByPriority     : {
            critical    : Integer;
            high        : Integer;
            medium      : Integer;
            low         : Integer;
        };
        casesByStatus       : {
            analysisInProgress  : Integer;
            actionRequired      : Integer;
            monitoring          : Integer;
            dataIncomplete      : Integer;
            completed           : Integer;
        };
        casesByEventType    : array of {
            eventType   : String;
            count       : Integer;
        };
        recentCases         : array of {
            caseId      : String;
            status      : String;
            priority    : String;
            supplier    : String;
            createdAt   : String;
        };
    };
    
    /**
     * Inventory Health Overview
     * 
     * Returns inventory health status for all materials.
     * Shows survival weeks and identifies materials requiring action.
     * 
     * @returns Array of inventory health records
     */
    function getInventoryHealth() returns {
        success         : Boolean;
        timestamp       : String;
        totalMaterials  : Integer;
        alertCount      : Integer;
        inventory       : array of {
            materialId          : String;
            plant               : String;
            currentStock        : Decimal;
            availableInventory  : Decimal;
            weeklyDemand        : Decimal;
            survivalWeeks       : Decimal;
            unit                : String;
            actionRequired      : Boolean;
            status              : String;
        };
    };
    
    /**
     * Supplier Risk Overview
     * 
     * Returns supplier performance and risk metrics.
     * Used for supplier risk dashboard and monitoring.
     * 
     * @returns Array of supplier risk records
     */
    function getSupplierRiskOverview() returns {
        success         : Boolean;
        timestamp       : String;
        totalSuppliers  : Integer;
        atRiskCount     : Integer;
        suppliers       : array of {
            supplierId      : String;
            supplierName    : String;
            category        : String;
            location        : String;
            otif            : Integer;
            trend           : String;
            previousDelays  : Integer;
            qualityRating   : Integer;
            riskLevel       : String;
            activeCases     : Integer;
            contractStatus  : String;
        };
    };
    
    /**
     * Risk Analytics
     * 
     * Returns risk distribution and analytics data for charts.
     * Used for risk visualization in dashboard.
     * 
     * @returns Risk distribution and analytics
     */
    function getRiskAnalytics() returns {
        success             : Boolean;
        timestamp           : String;
        riskDistribution    : {
            high    : Integer;
            medium  : Integer;
            low     : Integer;
        };
        avgRiskScore        : Decimal;
        topRiskDrivers      : array of {
            driver  : String;
            count   : Integer;
        };
        riskByPlant         : array of {
            plant       : String;
            avgRisk     : Decimal;
            caseCount   : Integer;
        };
        riskTrend           : array of {
            date        : String;
            avgRisk     : Decimal;
            caseCount   : Integer;
        };
    };
    
    
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