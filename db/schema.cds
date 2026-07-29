using { cuid, managed } from '@sap/cds/common';

namespace supplierresilience;

// ═══════════════════════════════════════════════════════════════════════════════
// MASTER DATA ENTITIES (from supply-chain-agents/mock_data JSON files)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Supplier Master Data
 * Source: supply-chain-agents/mock_data/suppliers.json
 * Contains supplier performance metrics, delivery history, and risk indicators
 */
entity Supplier : cuid, managed {
    supplierId          : String(30) @mandatory;
    name                : String(100);
    category            : String(50);           // Raw Materials, Packaging, etc.
    location            : String(100);
    otif                : Integer;              // On-Time In-Full percentage (0-100)
    previousDelays      : Integer;              // Number of previous delays
    trend               : String(20);           // IMPROVING, STABLE, DETERIORATING
    avgLeadTimeDays     : Integer;
    qualityRating       : Integer;              // Quality score (0-100)
    contractStatus      : String(20);           // ACTIVE, INACTIVE, SUSPENDED
    alternateSuppliers  : LargeString;          // JSON array stored as string
    criticalMaterials   : LargeString;          // JSON array stored as string
    lastDeliveryDate    : Date;
    totalOrdersYTD      : Integer;
    onTimeDeliveriesYTD : Integer;
    notes               : String(500);
}

/**
 * Material Master Data
 * Source: supply-chain-agents/mock_data/materials.json
 * Contains material criticality, affected scope, and revenue impact
 */
entity Material : cuid, managed {
    materialId              : String(30) @mandatory;
    description             : String(200);
    category                : String(50);
    criticality             : String(20);       // CRITICAL, HIGH, MEDIUM, LOW
    unitOfMeasure           : String(10);
    affectedPlants          : LargeString;      // JSON array of plant codes
    affectedSkus            : LargeString;      // JSON array of SKU codes
    estimatedRevenueImpact  : Decimal(15,2);    // Revenue at risk
    primarySupplier         : String(30);
    safetyStockDays         : Integer;
}

/**
 * Inventory Data
 * Source: supply-chain-agents/mock_data/inventory.json
 * Current stock levels by material and plant
 */
entity Inventory : cuid, managed {
    materialId      : String(30) @mandatory;
    plant           : String(20) @mandatory;
    currentStock    : Decimal(15,3);
    blockedStock    : Decimal(15,3);
    reservedStock   : Decimal(15,3);
    inTransitStock  : Decimal(15,3);
    unit            : String(10);
    lastUpdated     : Timestamp;
}

/**
 * Demand Data
 * Source: supply-chain-agents/mock_data/demand.json
 * Demand forecasts by material and plant
 */
entity Demand : cuid, managed {
    materialId      : String(30) @mandatory;
    plant           : String(20) @mandatory;
    weeklyDemand    : Decimal(15,3);
    monthlyDemand   : Decimal(15,3);
    unit            : String(10);
    forecastPeriod  : String(20);
}

/**
 * Purchase Orders
 * Source: supply-chain-agents/mock_data/purchase_orders.json
 * PO tracking with delivery status
 */
entity PurchaseOrder : cuid, managed {
    poNumber            : String(20) @mandatory;
    supplier            : String(30);
    material            : String(30);
    plant               : String(20);
    quantity            : Decimal(15,3);
    unit                : String(10);
    orderDate           : Date;
    expectedDelivery    : Date;
    actualDelivery      : Date;
    status              : String(20);           // OPEN, IN_TRANSIT, DELIVERED, DELAYED
    delayDays           : Integer;
}


// ═══════════════════════════════════════════════════════════════════════════════
// AGENT WORKFLOW ENTITIES (Case tracking and results)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Disruption Events
 * Incoming events that trigger the agent workflow
 * Source: supply-chain-agents/mock_data/events.json
 */
entity DisruptionEvent : cuid, managed {
    eventId         : String(30) @mandatory;
    eventType       : String(30);               // PO_DELAY, QUALITY_ISSUE, SUPPLIER_RISK, etc.
    eventTime       : Timestamp;
    po              : String(20);
    supplier        : String(60);
    material        : String(60);
    plant           : String(40);
    delayDays       : Integer;
    description     : String(500);
    source          : String(50);               // EVENT_MESH, MANUAL, S4_WEBHOOK
    processed       : Boolean default false;
}

/**
 * Disruption Case
 * Main case entity created by Coordinator Agent
 * Tracks the overall workflow status and consolidated results
 */
entity ![Case] : cuid, managed {
    caseId          : String(30) @mandatory;
    eventId         : String(30);
    runId           : String(50);
    status          : String(30);               // ANALYSIS_IN_PROGRESS, ACTION_REQUIRED, MONITORING, DATA_INCOMPLETE, COMPLETED
    priority        : String(20);               // CRITICAL, HIGH, MEDIUM, LOW
    eventType       : String(30);
    po              : String(20);
    supplier        : String(60);
    material        : String(60);
    plant           : String(40);
    delayDays       : Integer;
    eventTime       : Timestamp;
    completedAt     : Timestamp;
    recommendation  : String(1000);             // AI-generated or rule-based recommendation
    dataSource      : String(20);               // MOCK, S4
    error           : String(500);
}

/**
 * Early Warning Results
 * Generated by Early Warning Agent
 * Contains risk assessment and scoring breakdown
 */
entity EarlyWarningResult : cuid, managed {
    caseId                      : String(30) @mandatory;
    status                      : String(20);   // COMPLETED, FAILED, SKIPPED
    riskScore                   : Integer;      // Total risk score (0-100)
    riskLevel                   : String(20);   // LOW, MEDIUM, HIGH
    
    // Score Breakdown (per guidelines: configurable weights)
    supplierPerformanceScore    : Integer;      // max 30 points
    delaySeverityScore          : Integer;      // max 25 points
    materialCriticalityScore    : Integer;      // max 20 points
    affectedScopeScore          : Integer;      // max 15 points
    revenueExposureScore        : Integer;      // max 10 points
    
    // Supplier Details
    supplierId                  : String(30);
    supplierName                : String(100);
    supplierOtif                : Integer;
    supplierTrend               : String(20);
    
    // Material Details
    materialId                  : String(30);
    materialCriticality         : String(20);
    
    // Impact Scope
    affectedPlants              : LargeString;  // JSON array
    affectedSkus                : LargeString;  // JSON array
    
    // Risk Drivers (top 5)
    topRiskDrivers              : LargeString;  // JSON array of driver strings
    
    dataSource                  : String(20);
    calculatedAt                : Timestamp;
    error                       : String(500);
}

/**
 * Survival Results
 * Generated by Survival Agent
 * Contains inventory survival analysis and shortfall calculations
 */
entity SurvivalResult : cuid, managed {
    caseId                  : String(30) @mandatory;
    status                  : String(20);       // COMPLETED, FAILED, SKIPPED, ERROR
    material                : String(30);
    plant                   : String(20);
    
    // Inventory Breakdown
    currentStock            : Decimal(15,3);
    blockedStock            : Decimal(15,3);
    reservedStock           : Decimal(15,3);
    inTransitStock          : Decimal(15,3);
    availableInventory      : Decimal(15,3);
    calculationFormula      : String(200);      // e.g., "current - blocked - reserved + inTransit"
    
    // Demand & Survival Metrics
    weeklyDemand            : Decimal(15,3);
    unit                    : String(10);
    survivalWeeks           : Decimal(10,2);    // How long inventory lasts
    supplierRecoveryWeeks   : Integer;          // Expected recovery time
    coverageGapWeeks        : Decimal(10,2);    // Positive = buffer, Negative = shortfall
    uncoveredWeeks          : Decimal(10,2);    // Weeks without coverage (max 0)
    shortfallQuantity       : Decimal(15,3);    // Quantity needed to cover gap
    actionRequired          : Boolean;          // True if uncoveredWeeks > 0
    
    dataSource              : String(20);
    calculatedAt            : Timestamp;
    error                   : String(500);
}


// ═══════════════════════════════════════════════════════════════════════════════
// INDEXES for performance (optional, CAP handles automatically for common queries)
// ═══════════════════════════════════════════════════════════════════════════════

// Add unique constraint annotations
annotate Supplier with @(
    assert.unique: { supplierId: [supplierId] }
);

annotate Material with @(
    assert.unique: { materialId: [materialId] }
);

annotate PurchaseOrder with @(
    assert.unique: { poNumber: [poNumber] }
);

annotate DisruptionEvent with @(
    assert.unique: { eventId: [eventId] }
);

annotate ![Case] with @(
    assert.unique: { caseId: [caseId] }
);