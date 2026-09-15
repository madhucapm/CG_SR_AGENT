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

 @protocol: [{ kind: 'odata-v4', path: 'supplier-resilience' }, { kind: 'mcp', path: 'supplier-resilience' }]

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

    entity CaseSuppliers as projection on supplierresilience.CaseSupplier;
    entity CasePurchaseOrders as projection on supplierresilience.CasePurchaseOrder;
    entity CaseMaterials as projection on supplierresilience.CaseMaterial;


    // ═══════════════════════════════════════════════════════════════════════════
    // IMPACT CASE CREATION & HIERARCHY
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Create Impact Case
     *
     * Creates a new case from the analyzeImpact result together with all
     * supplier / PO / material hierarchy rows in a single transaction.
     * The backend generates the unique SC-YYYY-NNN case ID.
     *
     * @param eventTitle        - Title of the disruption event
     * @param eventDescription  - Description / impact_description
     * @param severity          - CRITICAL, HIGH, MEDIUM, LOW
     * @param classification    - e.g. COMPLETE INTERRUPTION
     * @param riskScore         - 0-100
     * @param impactType        - Free-text impact type
     * @param estimatedImpact   - e.g. "$4.8M"
     * @param region            - e.g. "Mumbai, India"
     * @param affectedSuppliers - JSON string of affected_suppliers array from analyzeImpact
     */
    action createImpactCase(
        eventTitle          : String,
        eventDescription    : String,
        severity            : String,
        classification      : String,
        riskScore           : Integer,
        impactType          : String,
        estimatedImpact     : String,
        region              : String,
        affectedSuppliers   : LargeString
    ) returns {
        success         : Boolean;
        caseId          : String;
        message         : String;
        error           : String;
        caseData        : {
            caseId          : String;
            eventTitle      : String;
            severity        : String;
            classification  : String;
            riskScore       : Integer;
            impactType      : String;
            estimatedImpact : String;
            region          : String;
            supplierCount   : Integer;
            poCount         : Integer;
            materialCount   : Integer;
            plantCount      : Integer;
            skuCount        : Integer;
            status          : String;
            createdAt       : String;
        };
        suppliers       : array of {
            supplierId  : String;
            name        : String;
            address     : String;
            distanceKm  : Decimal;
            poCount     : Integer;
        };
        purchaseOrders  : array of {
            supplierId  : String;
            poNumber    : String;
        };
        materials       : array of {
            supplierId          : String;
            poNumber            : String;
            itemNo              : String;
            material            : String;
            materialDescription : String;
            plant               : String;
            sku                 : String;
        };
    };

    /**
     * Get Case Hierarchy
     *
     * Retrieves a single case with all supplier / PO / material children.
     * Used by the Case Dashboard to display the full hierarchy for one
     * specific case.
     *
     * @param caseId - The SC-YYYY-NNN case identifier
     */
    function getCaseHierarchy(caseId : String) returns {
        success         : Boolean;
        error           : String;
        caseData        : {
            caseId          : String;
            eventTitle      : String;
            eventDescription: String;
            severity        : String;
            classification  : String;
            riskScore       : Integer;
            impactType      : String;
            estimatedImpact : String;
            region          : String;
            status          : String;
            priority        : String;
            supplierCount   : Integer;
            poCount         : Integer;
            materialCount   : Integer;
            plantCount      : Integer;
            skuCount        : Integer;
            createdAt       : String;
            createdBy       : String;
        };
        suppliers       : array of {
            supplierId  : String;
            name        : String;
            address     : String;
            distanceKm  : Decimal;
            poCount     : Integer;
        };
        purchaseOrders  : array of {
            supplierId  : String;
            poNumber    : String;
        };
        materials       : array of {
            supplierId          : String;
            poNumber            : String;
            itemNo              : String;
            material            : String;
            materialDescription : String;
            plant               : String;
            sku                 : String;
        };
    };


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
            po              : String;
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
     * Get Purchase Order Details from S/4HANA
     * 
     * Calls the S/4HANA API_PURCHASEORDER_PROCESS_SRV OData service via the
     * BTP `S4R` destination to fetch live PO header and PO items for a given
     * purchase order number. Used by the Early Warning Agent live analysis.
     * 
     * @param po - Purchase order number
     * 
     * @returns PO header + line-items
     */
    function getPurchaseOrderDetails(po : String) returns {
        success             : Boolean;
        po                  : String;
        purchaseOrder       : {
            PurchaseOrder                   : String;
            PurchaseOrderType               : String;
            CompanyCode                     : String;
            PurchasingOrganization          : String;
            PurchasingGroup                 : String;
            Supplier                        : String;
            SupplierPhoneNumber             : String;
            DocumentCurrency                : String;
            PurchaseOrderDate               : String;
            CreatedByUser                   : String;
            CreationDate                    : String;
            LastChangeDateTime              : String;
            PurchaseOrderNetAmount          : String;
            Language                        : String;
            PaymentTerms                    : String;
            AddressName                     : String;
            AddressCityName                 : String;
            AddressCountry                  : String;
        };
        purchaseOrderItems  : array of {
            PurchaseOrder                   : String;
            PurchaseOrderItem               : String;
            PurchaseOrderItemText           : String;
            Material                        : String;
            Plant                           : String;
            StorageLocation                 : String;
            OrderQuantity                   : String;
            PurchaseOrderQuantityUnit       : String;
            NetPriceAmount                  : String;
            NetPriceQuantity                : String;
            DocumentCurrency                : String;
            ScheduleLineDeliveryDate        : String;
            IsCompletelyDelivered           : Boolean;
            PurchaseOrderItemCategory       : String;
        };
        // Schedule lines from A_PurchaseOrderScheduleLine
        // Each PO item can have multiple schedule lines (e.g., split deliveries)
        scheduleLines       : array of {
            PurchaseOrder                   : String;  // Maps from PurchasingDocument
            PurchaseOrderItem               : String;  // Maps from PurchasingDocumentItem
            ScheduleLine                    : String;  // Schedule line number within item
            ScheduleLineDeliveryDate        : String;  // Planned delivery date (ISO YYYY-MM-DD)
            SchedLineStscDeliveryDate       : String;  // Statistical/confirmed date (ISO YYYY-MM-DD)
            ScheduleLineOrderQuantity       : String;  // Ordered quantity on this schedule line
            PurchaseOrderQuantityUnit       : String;  // Unit of measure
            DelivDateCategory               : String;  // Delivery date category (1=confirmed, etc.)
        };
        materialDocuments   : array of {
            MaterialDocument                : String;
            MaterialDocumentYear            : String;
            MaterialDocumentItem            : String;
            // Header-level fields (from A_MaterialDocumentHeader)
            PostingDate                     : String;  // Posting date for accounting
            DocumentDate                    : String;  // Date on physical document
            CreatedByUser                   : String;  // User who created the GR
            CreationDate                    : String;  // System creation date
            ReferenceDocument               : String;  // Reference to delivery note/ASN
            BillOfLading                    : String;  // Shipment tracking reference
            // Item-level fields (from A_MaterialDocumentItem)
            GoodsMovementType               : String;
            PurchaseOrder                   : String;
            PurchaseOrderItem               : String;
            Material                        : String;
            Plant                           : String;
            QuantityInEntryUnit             : String;
            EntryUnit                       : String;
            Supplier                        : String;
        };
        error               : String;
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
     * Run Early Warning Agent with S4R Data
     * 
     * Uses real-time data from S/4HANA via getPurchaseOrderDetails API.
     * All metrics are computed from live S4R data - no mock/DB data used.
     * 
     * Supports TWO modes:
     * 
     * SINGLE MODE (backward compatible):
     *   - Input: po (single PO number)
     *   - Returns: Single supplier/PO result in flat structure
     * 
     * MULTI MODE (new):
     *   - Input: poList (array of PO numbers)
     *   - Returns: Array of supplier results in 'suppliers', each with nested poDetails
     * 
     * For each supplier, historical OTIF is fetched via getSupplierHistoricalOtif.
     * 
     * Computed from S4R:
     * - delayDays: actualDate - plannedDate (from GR PostingDate and ScheduleLine)
     * - otifForThisPO: Binary (0 or 100%) based on isOnTime && isInFull
     * - estimatedRevenueImpact: From PO net amount
     * - affectedPlants: Derived from PO items
     * 
     * @param caseId - Case identifier (optional - auto-generated if not provided)
     * @param po - Purchase Order number (for single mode - backward compatible)
     * @param supplierId - Supplier ID (optional - auto-detected from PO)
     * @param poList - Array of Purchase Order numbers (for multi mode)
     * 
     * @returns Risk assessment computed from real-time S4R data including supplier historical OTIF
     */
    action runEarlyWarningWithS4R(
        caseId      : String,
        po          : String,
        supplierId  : String,
        poList      : array of String
    ) returns {
        success                 : Boolean;
        agent                   : String;
        caseId                  : String;
        caseIdGenerated         : Boolean;
        status                  : String;
        
        // ═══════════════════════════════════════════════════════════════════════
        // MULTI MODE FIELDS (populated when using poList)
        // ═══════════════════════════════════════════════════════════════════════
        totalSuppliers          : Integer;
        totalPOs                : Integer;
        
        // Suppliers array - each supplier contains full assessment + poDetails
        suppliers               : array of {
            supplierId              : String;
            supplierName            : String;
            supplierOtif            : Integer;
            supplierTrend           : String;
            previousDelays          : Integer;
            riskScore               : Integer;
            maxPossibleScore        : Integer;
            riskPercentage          : Integer;
            riskLevel               : String;
            scoreBreakdown          : {
                supplierPerformance     : Integer;
                delaySeverity           : Integer;
                materialCriticality     : Integer;
                affectedScope           : Integer;
                revenueExposure         : Integer;
                total                   : Integer;
            };
            scoringNote             : String;
            supplierOtifData        : {
                otifPercentage          : Integer;
                totalPOs                : Integer;
                deliveredPOs            : Integer;
                otifPOs                 : Integer;
                onTimePOs               : Integer;
                inFullPOs               : Integer;
                pendingPOs              : Integer;
                overduePOs              : Integer;
                partiallyDeliveredPOs   : Integer;
                onTimePercentage        : Integer;
                inFullPercentage        : Integer;
                fromDate                : String;
                toDate                  : String;
            };
            affectedPlants          : array of String;
            affectedPlantsCount     : Integer;
            totalRevenueExposure    : Decimal;
            topRiskDrivers          : array of String;
            poCount                 : Integer;
            poDetails               : array of {
                poNumber                : String;
                orderDate               : String;
                currency                : String;
                poNetAmount             : Decimal;
                materialId              : String;
                materialDescription     : String;
                plant                   : String;
                expectedDeliveryDate    : String;
                actualDeliveryDate      : String;
                delayDays               : Integer;
                deliveryStatus          : String;
                isOnTime                : Boolean;
                isInFull                : Boolean;
                otifForThisPO           : Integer;
                otifReason              : String;
                orderedQuantity         : Decimal;
                deliveredQuantity       : Decimal;
                quantityUnit            : String;
                deliveryCompletion      : Integer;
                estimatedRevenueImpact  : Decimal;
            };
            dataSource              : String;
            calculatedAt            : String;
            unavailableFields       : array of String;
            error                   : String;
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // SINGLE MODE FIELDS (backward compatible - populated when using single po)
        // ═══════════════════════════════════════════════════════════════════════
        
        // Risk Scoring (only available components)
        riskScore               : Integer;
        maxPossibleScore        : Integer;
        riskPercentage          : Integer;
        riskLevel               : String;
        scoreBreakdown          : {
            supplierPerformance     : Integer;
            delaySeverity           : Integer;
            materialCriticality     : Integer;
            affectedScope           : Integer;
            revenueExposure         : Integer;
            total                   : Integer;
        };
        scoringNote             : String;
        
        // Supplier Data
        supplierId              : String;
        supplierName            : String;
        supplierOtif            : Integer;
        supplierTrend           : String;
        previousDelays          : Integer;
        
        // Supplier Historical OTIF Data (from getSupplierHistoricalOtif)
        supplierOtifData        : {
            otifPercentage          : Integer;
            totalPOs                : Integer;
            deliveredPOs            : Integer;
            otifPOs                 : Integer;
            onTimePOs               : Integer;
            inFullPOs               : Integer;
            pendingPOs              : Integer;
            overduePOs              : Integer;
            partiallyDeliveredPOs   : Integer;
            onTimePercentage        : Integer;
            inFullPercentage        : Integer;
            fromDate                : String;
            toDate                  : String;
        };
        
        // Material Data
        materialId              : String;
        materialDescription     : String;
        materialCriticality     : String;
        
        // NEW: Material Stock Data for Criticality Calculation
        unrestrictedStock       : Decimal;
        safetyStock             : Decimal;
        stockCoverageRatio      : String;
        criticalityReason       : String;
        stockUnit               : String;
        
        // PO Header Data
        poNumber                : String;
        orderDate               : String;
        currency                : String;
        poNetAmount             : Decimal;
        
        // Delivery Data (COMPUTED from S4R)
        expectedDeliveryDate    : String;
        actualDeliveryDate      : String;
        delayDays               : Integer;
        deliveryStatus          : String;
        
        // OTIF for this PO (COMPUTED)
        isOnTime                : Boolean;
        isInFull                : Boolean;
        otifForThisPO           : Integer;
        otifReason              : String;
        
        // Quantity Data
        orderedQuantity         : Decimal;
        deliveredQuantity       : Decimal;
        quantityUnit            : String;
        deliveryCompletion      : Integer;
        
        // Impact Data
        affectedPlants          : array of String;
        affectedPlantsCount     : Integer;
        affectedSkus            : array of String;
        estimatedRevenueImpact  : Decimal;
        
        // Risk Drivers
        topRiskDrivers          : array of String;
        
        // Metadata
        dataSource              : String;
        calculatedAt            : String;
        availableData           : {
            poHeader            : Boolean;
            poItems             : Boolean;
            scheduleLines       : Boolean;
            goodsReceipts       : Boolean;
        };
        unavailableFields       : array of String;
        error                   : String;
    };
    
    /**
     * Run Survival Planner (S/4HANA-Integrated)
     *
     * Fetches real-time PO, Inbound Delivery and schedule-line data
     * from S/4HANA via the BTP S4R destination and computes:
     *   - TTS  (Time-To-Survive) per Plant × Material
     *   - TTR  (Time-To-Recover)  from earliest confirmed inbound delivery
     *   - Gap  = TTR − TTS
     *   - Shortfall = Gap × Weekly_Demand
     *
     * Steps:
     *  3. Fetch Open POs  (API_PURCHASEORDER_PROCESS_SRV)
     *  4. Fetch Inbound Deliveries (API_INBOUND_DELIVERY_SRV)
     *  5. Anti-Double-Count Reconciliation
     *  6. Compute Weekly Demand (unshipped PO qty ÷ 7 × 7)
     *  7. Compute Eligible Supply (in-transit + confirmed deliveries)
     *  8. Derive TTR from Inbound Delivery
     *  9. Compute TTS, Gap, Shortfall per Plant × Material
     * 10. Aggregate KPIs
     *
     * @param caseId - Case identifier (e.g. SC-2026-613)
     *
     * @returns SVP output with KPIs, per-record metrics and narratives
     */
    action runSurvival(
        caseId                  : String
    ) returns {
        success                     : Boolean;
        incidentId                  : String;
        agentId                     : String;
        timestamp                   : String;
        portfolioHeadlineTTS_Weeks  : Decimal;
        kpis                        : {
            criticalItems           : {
                count               : Integer;
                thresholdWeeks      : Integer;
            };
            averageCoverageWeeks    : Decimal;
            worstGap                : {
                weeks               : Decimal;
                plant               : String;
                material            : String;
            };
            totalShortfall          : array of {
                uom                 : String;
                qty                 : Decimal;
            };
        };
        records                     : array of {
            plant                   : String;
            material                : String;
            ttsWeeks                : Decimal;
            ttrWeeks                : Decimal;
            ttrSource               : String;
            ttrConfidence           : String;
            gapWeeks                : Decimal;
            shortfallQty            : Decimal;
            shortfallUoM            : String;
            confidence              : String;
            dataFlags               : array of String;
            weeklyDemand            : Decimal;
            eligibleSupply          : Decimal;
            usableInventory         : Decimal;
            totalSupply             : Decimal;
        };
        narratives                  : {
            ttsSummary              : String;
            ttrAssumption           : String;
            dataGaps                : String;
        };
        dataSource                  : String;
        calculatedAt                : String;
        error                       : String;
    };
    

    /**
     * Run Substitution Agent
     * 
     * Checks BOM, approved suppliers, and material alternatives
     * for the given case. Returns substitution recommendations.
     * 
     * @param caseId - Case identifier
     * 
     * @returns Substitution analysis with alternatives
     */
    action runSubstitution(
        caseId      : String
    ) returns {
        success             : Boolean;
        agent               : String;
        caseId              : String;
        status              : String;
        alternatives        : array of {
            materialId          : String;
            description         : String;
            alternateSupplier   : String;
            feasibility         : String;
            leadTimeDays        : Integer;
            costImpact          : String;
        };
        substitutes         : array of {
            originalMaterial    : String;
            substituteMaterial  : String;
            complianceStatus    : String;
            qualityMatch        : String;
        };
        recommendation      : String;
        dataSource          : String;
        calculatedAt        : String;
        error               : String;
    };

    /**
     * Run Buyer Agent
     * 
     * Handles PO creation, stock transfers, and procurement
     * execution for the given case.
     * 
     * @param caseId - Case identifier
     * 
     * @returns Buyer execution result with PO details
     */
    action runBuyer(
        caseId      : String
    ) returns {
        success             : Boolean;
        agent               : String;
        caseId              : String;
        status              : String;
        poNumber            : String;
        poStatus            : String;
        totalAmount         : String;
        actions             : array of {
            actionType          : String;
            description         : String;
            status              : String;
            reference           : String;
        };
        recommendation      : String;
        dataSource          : String;
        calculatedAt        : String;
        error               : String;
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
     * Analyze Impact — Enriched Disruption Analysis (Path B orchestrator)
     *
     * Given an impact scenario, this function orchestrates the full
     * end-to-end flow entirely on the backend so the UI needs only a
     * single OData round-trip:
     *
     *   1. Get_supplier()              → fetch real supplier universe from
     *                                    S/4HANA API_BUSINESS_PARTNER
     *   2. POST /analyze on the        → send those real suppliers to the
     *      supplier_resilience_agent     Python geo-agent (which geocodes
     *      destination                   addresses and computes distances)
     *   3. GET_SupplierDetails(id)     → for each affected supplier, fetch
     *                                    POs + line items from S/4HANA
     *                                    API_PURCHASEORDER_PROCESS_SRV
     *                                    (parallel via Promise.all)
     *   4. Merge and return one enriched payload.
     *
     * No fallback data is used anywhere — S/4HANA is the single source of
     * truth. The Python agent will reject the request with 400 if the
     * supplier list is empty, and this function surfaces that error
     * cleanly. Per-supplier geocoding failures are silently skipped by
     * the Python agent (already logged there); per-supplier PO fetch
     * failures are captured and reported without sinking the whole batch.
     *
     * @param location             Location impacted by the event (free-form
     *                             text such as "Mumbai, India"; geocoded
     *                             internally by the Python agent).
     * @param impact_description   Free-text description of the event
     *                             (e.g. "Monsoon flooding").
     * @param assessment_radius_km Impact radius in km. Optional; defaults
     *                             to 100 on the Python side if omitted.
     */
    function analyzeImpact(
        location             : String,
        impact_description   : String,
        assessment_radius_km : Decimal
    ) returns {
        success                 : Boolean;
        location                : String;
        impact_description      : String;
        assessment_radius_km    : Decimal;
        impact_coords           : {
            location  : String;
            latitude  : Decimal;
            longitude : Decimal;
        };
        supplier_count          : Integer;    // total suppliers considered (from Get_supplier)
        affected_supplier_count : Integer;    // how many fell inside the radius
        message                 : String;
        error                   : String;

        // ── Aggregate risk metrics (from runEarlyWarningWithS4R) ──
        // Populated in Step 4 of analyze-impact-handler.js. Values come from
        // the "worst" affected supplier (highest riskPercentage). If risk
        // scoring fails for any reason, these are null but the rest of the
        // response is preserved.
        riskScore               : Integer;    // 0–58 (raw score)
        maxPossibleScore        : Integer;    // 58 (fixed ceiling for S4R model)
        riskPercentage          : Integer;    // 0–100 (normalized for UI)
        riskLevel               : String;     // LOW / MEDIUM / HIGH

        affected_suppliers      : array of {
            supplier_id     : String;
            name            : String;
            address         : String;
            latitude        : Decimal;
            longitude       : Decimal;
            distance_km     : Decimal;
            po_count        : Integer;

            // ── Per-supplier risk metrics (from runEarlyWarningWithS4R) ──
            risk_score          : Integer;    // 0–58
            max_possible_score  : Integer;    // 58
            risk_percentage     : Integer;    // 0–100
            risk_level          : String;     // LOW / MEDIUM / HIGH

            // ── Per-supplier estimated impact (money at risk) ──
            // Sourced from runEarlyWarningWithS4R.suppliers[i].totalRevenueExposure,
            // which is the SUM of estimatedRevenueImpact (= PO net amount) across
            // that supplier's affected POs. Currency follows the PO's own
            // DocumentCurrency and is NOT converted.
            estimated_impact    : Decimal;

            purchase_orders : array of {
                po_number : String;
                materials : array of {
                    item_no              : String;
                    material             : String;
                    material_description : String;
                    plant                : String;
                    sku                  : String;
                };
            };
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
    
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SUPPLIER HISTORICAL OTIF
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Get Historical Supplier OTIF
     * 
     * Fetches all POs for a supplier within a date range from S/4HANA and
     * calculates aggregate OTIF (On-Time In-Full) percentage.
     * 
     * Algorithm:
     * 1. Fetch all POs for supplier (A_PurchaseOrder filtered by Supplier)
     * 2. For each PO, fetch schedule lines (planned delivery dates)
     * 3. For each PO, fetch material documents (actual goods receipts)
     * 4. Compute isOnTime and isInFull for each delivered PO
     * 5. Aggregate: OTIF% = (count of OTIF POs / delivered POs) × 100
     * 
     * @param supplierId - Supplier ID (SAP format with leading zeros, e.g., '0000001234')
     * @param fromDate - Start date for PO filter (ISO format YYYY-MM-DD, defaults to 6 months ago)
     * @param toDate - End date for PO filter (ISO format YYYY-MM-DD, defaults to today)
     * 
     * @returns Historical OTIF calculation with breakdown
     */
    function getSupplierHistoricalOtif(
        supplierId  : String,
        fromDate    : String,
        toDate      : String
    ) returns {
        success             : Boolean;
        supplierId          : String;
        supplierName        : String;
        
        // Aggregate OTIF metrics
        otifPercentage      : Integer;     // Main metric: (OTIF POs / Delivered POs) × 100
        totalPOs            : Integer;     // Total POs fetched
        deliveredPOs        : Integer;     // POs with goods receipt (used for OTIF calc)
        otifPOs             : Integer;     // POs that are both on-time AND in-full
        onTimePOs           : Integer;     // POs delivered on or before planned date
        inFullPOs           : Integer;     // POs delivered with full quantity
        pendingPOs          : Integer;     // POs not yet delivered
        overduePOs          : Integer;     // POs past due date with no delivery
        partiallyDeliveredPOs : Integer;   // POs with partial delivery
        
        // Breakdown percentages
        onTimePercentage    : Integer;     // (On-time POs / Delivered POs) × 100
        inFullPercentage    : Integer;     // (In-full POs / Delivered POs) × 100
        
        // Period info
        fromDate            : String;
        toDate              : String;
        
        // Individual PO details (for drill-down)
        poDetails           : array of {
            poNumber            : String;
            orderDate           : String;
            plannedDeliveryDate : String;
            actualDeliveryDate  : String;
            orderedQuantity     : Decimal;
            deliveredQuantity   : Decimal;
            isOnTime            : Boolean;
            isInFull            : Boolean;
            isOtif              : Boolean;
            delayDays           : Integer;
            status              : String;   // DELIVERED, PARTIALLY_DELIVERED, PENDING, OVERDUE
            reason              : String;
        };
        
        dataSource          : String;
        calculatedAt        : String;
        processingTimeMs    : Integer;
        error               : String;
    };
    
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GET SUPPLIER WITH ADDRESS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Get Supplier List with Addresses
     * 
     * Fetches all suppliers from S/4HANA (API_BUSINESS_PARTNER) and their
     * corresponding addresses. The address fields (AddressID, CityName,
     * Country, Region) are concatenated into a single Address string.
     * 
     * Steps:
     * 1. Fetch supplier list from A_Supplier
     * 2. For each supplier, fetch addresses from A_BusinessPartnerAddress
     * 3. Combine address fields into a single comma-separated string
     * 
     * @returns Array of supplier-address records
     */
    function Get_supplier() returns array of {
        Supplier     : String;
        SupplierName : String;
        Address      : String;
    };
    
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GET SUPPLIER DETAILS (POs + Items)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Get Supplier Details
     * 
     * Fetches all Purchase Orders for a given supplier from S/4HANA
     * (API_PURCHASEORDER_PROCESS_SRV) and then fetches the line items
     * for each PO via the to_PurchaseOrderItem navigation property.
     * 
     * Steps:
     * 1. Fetch POs filtered by Supplier from A_PurchaseOrder
     * 2. For each PO, fetch items from A_PurchaseOrder('<PO>')/to_PurchaseOrderItem
     * 3. Map PurchaseOrderItem → ItemNo, Material → Material & SKU, Plant → Plant
     * 
     * @param supplier - Supplier ID (e.g., '100075')
     * 
     * @returns Supplier with nested POs and their material items
     */
    function GET_SupplierDetails(
        supplier    : String
    ) returns {
        Supplier    : String;
        PO          : array of {
            Number      : String;
            Materials   : array of {
                ItemNo              : String;
                Material            : String;
                MaterialDescription : String;
                Plant               : String;
                SKU                 : String;
            };
        };
    };


    // ═══════════════════════════════════════════════════════════════════════════
    // RUN RECOMMENDATION — Backend proxy for Python agent /recommend-scenario
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Run Recommendation Agent (via CAP backend proxy)
     *
     * Proxies the request to the Python supplier_resilience_agent's
     * /recommend-scenario endpoint through the CAP server, bypassing the
     * SAP Launchpad managed approuter which has a ~30-second HTTP timeout
     * that cannot be configured.
     *
     * The payload is passed as a JSON string so the schema remains flexible
     * and matches whatever the Python agent expects (incidentId,
     * affectedMaterial, affectedPlant, disruptedSupplier, gapMagnitudeWeeks,
     * portfolioHeadlineTts, ttsPerPlantMaterial[]).
     *
     * The Python agent's response is returned as a JSON string in the
     * `result` field; the UI JSON.parse()s it.
     *
     * @param payload - JSON string with the recommend-scenario request body
     *
     * @returns Success flag, JSON-stringified result, and optional error
     */
    action runRecommendation(
        payload     : String
    ) returns {
        success     : Boolean;
        result      : LargeString;
        error       : String;
    };
}