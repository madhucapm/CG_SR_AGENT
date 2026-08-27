# 📊 Early Warning Agent - Technical Documentation

**Version:** 1.0.0 | **Last Updated:** August 24, 2026

---

## 1. Executive Summary

The **Early Warning Agent** evaluates supplier and PO risk using real-time S/4HANA data (S4R destination).

### Key Tasks
| Task | Description |
|------|-------------|
| **Task 1** | Read event and supplier data from S4R |
| **Task 2** | Calculate supplier risk (OTIF, delays, trend) |
| **Task 3** | Assess business impact (plants, revenue) |
| **Task 4** | Calculate risk score using configurable weights |
| **Task 5** | Return structured result with topRiskDrivers |

---

## 2. End-to-End Flow

```
User Request: runEarlyWarningWithS4R(po)
        │
        ▼
┌─────────────────────────────────────────┐
│ STEP 1: FETCH S4R DATA                  │
│ • A_PurchaseOrder (header)              │
│ • A_PurchaseOrderItem (items)           │
│ • A_PurchaseOrderScheduleLine           │
│ • A_MaterialDocumentItem (GR)           │
└─────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────┐
│ STEP 2: EXTRACT METRICS                 │
│ • delayDays = actual - planned          │
│ • OTIF for PO (0% or 100%)              │
│ • deliveryStatus                        │
└─────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────┐
│ STEP 3: FETCH SUPPLIER OTIF             │
│ • Last 6 months, max 50 POs             │
│ • OTIF% = otifPOs / deliveredPOs        │
└─────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────┐
│ STEP 4: CALCULATE RISK SCORE            │
│ Supplier Performance: 15 pts max        │
│ Delay Severity: 25 pts max              │
│ Affected Scope: 8 pts max               │
│ Revenue Exposure: 10 pts max            │
│ TOTAL: 58 pts max                       │
└─────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────┐
│ STEP 5: BUILD RISK DRIVERS              │
│ STEP 6: RETURN OUTPUT                   │
└─────────────────────────────────────────┘
```

---

## 3. S4R Data Integration

### 3.1 S/4HANA APIs Consumed

| API Service | Entity | Purpose |
|-------------|--------|---------|
| `API_PURCHASEORDER_PROCESS_SRV` | `A_PurchaseOrder` | PO Header |
| `API_PURCHASEORDER_PROCESS_SRV` | `A_PurchaseOrderItem` | PO Items |
| `API_PURCHASEORDER_PROCESS_SRV` | `A_PurchaseOrderScheduleLine` | Delivery Dates |
| `API_MATERIAL_DOCUMENT_SRV` | `A_MaterialDocumentItem` | Goods Receipts |
| `API_MATERIAL_DOCUMENT_SRV` | `A_MaterialDocumentHeader` | GR Posting Date |

### 3.2 OData URL Patterns

```javascript
// PO Header
`/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder('${po}')?$format=json`

// PO Items  
`/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem?$filter=PurchaseOrder eq '${po}'`

// Schedule Lines
`/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderScheduleLine?$filter=PurchasingDocument eq '${po}'`

// Goods Receipts (Movement Type 101)
`/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentItem?$filter=PurchaseOrder eq '${po}' and GoodsMovementType eq '101'`
```

---

## 4. Data Fields & Mapping

### 4.1 PO Header Fields (A_PurchaseOrder)

| S4R Field | Internal Field | Description |
|-----------|----------------|-------------|
| `PurchaseOrder` | `poNumber` | PO number |
| `Supplier` | `supplierId` | Supplier ID (10-digit) |
| `AddressName` | `supplierName` | Supplier name |
| `DocumentCurrency` | `currency` | Currency code |
| `PurchaseOrderDate` | `orderDate` | PO creation date |
| `PurchaseOrderNetAmount` | `poNetAmount` | Total PO value |

### 4.2 PO Item Fields (A_PurchaseOrderItem)

| S4R Field | Internal Field | Description |
|-----------|----------------|-------------|
| `Material` | `materialId` | Material number |
| `Plant` | `plant` | Plant code |
| `OrderQuantity` | `orderedQuantity` | Ordered quantity |
| `PurchaseOrderQuantityUnit` | `quantityUnit` | Unit of measure |

### 4.3 Schedule Line Fields

| S4R Field | Internal Field | Description |
|-----------|----------------|-------------|
| `ScheduleLineDeliveryDate` | `expectedDeliveryDate` | Planned delivery |

### 4.4 Material Document Fields

| S4R Field | Internal Field | Description |
|-----------|----------------|-------------|
| `GoodsMovementType` | - | `101` = Goods Receipt |
| `QuantityInEntryUnit` | `deliveredQuantity` | Received quantity |
| `PostingDate` | `actualDeliveryDate` | Actual GR date |

### 4.5 Computed Fields (Derived)

| Field | Formula |
|-------|---------|
| `delayDays` | `actualDate - plannedDate` |
| `isOnTime` | `actualDate <= plannedDate` |
| `isInFull` | `deliveredQty >= orderedQty` |
| `otifForThisPO` | `100%` if both true, else `0%` |
| `deliveryCompletion` | `(delivered/ordered) × 100` |
| `affectedPlants` | Unique plants from items |


---

## 5. Metrics Calculation Logic

### 5.1 Delay Days Calculation

**File:** `srv/lib/s4r-data-extractor.js`

```javascript
function computeDelayDays(plannedDate, actualDate, hasGoodsReceipt) {
    if (hasGoodsReceipt && actualDate) {
        return daysBetween(actual, planned);  // Actual delay
    }
    if (planned < today) {
        return daysBetween(today, planned);   // Days overdue
    }
    return 0;  // Not yet due
}
```

**Formula:**
```
IF goods receipt exists:
    delayDays = actualDeliveryDate - plannedDeliveryDate
ELSE IF plannedDate < today:
    delayDays = today - plannedDeliveryDate (overdue)
ELSE:
    delayDays = 0 (not yet due)
```

### 5.2 Delivery Status Logic

| Has GR | In-Full | Overdue | Status |
|--------|---------|---------|--------|
| Yes | Yes | - | `DELIVERED` |
| Yes | No | - | `PARTIALLY_DELIVERED` |
| No | - | Yes | `OVERDUE` |
| No | - | No | `PENDING` |

### 5.3 OTIF for Single PO

```javascript
isOnTime = actualDeliveryDate <= plannedDeliveryDate
isInFull = deliveredQuantity >= orderedQuantity

otifForThisPO = (isOnTime && isInFull) ? 100 : 0
```

---

## 6. Risk Scoring Model

### 6.1 S4R Risk Score Components

**File:** `srv/service.js` - `calculateS4RRiskScore()`

| Component | Max Points | Scoring Logic |
|-----------|------------|---------------|
| **Supplier Performance** | 15 | Based on historical OTIF % |
| **Delay Severity** | 25 | Based on delay days |
| **Affected Scope** | 8 | Based on plant count |
| **Revenue Exposure** | 10 | Based on PO net amount |
| **TOTAL** | **58** | |

### 6.2 Supplier Performance Scoring (15 pts max)

| Historical OTIF % | Points | Classification |
|-------------------|--------|----------------|
| ≥ 90% | 0 | Good |
| 85-89% | 3 | Acceptable |
| 70-84% | 8 | Below Target |
| 50-69% | 12 | Poor |
| < 50% | 15 | Critical |

### 6.3 Delay Severity Scoring (25 pts max)

| Delay Days | Points | Classification |
|------------|--------|----------------|
| 0 | 0 | On-Time |
| 1-7 | 5 | Minor |
| 8-14 | 12 | Moderate |
| 15-21 | 20 | Significant |
| > 21 | 25 | Severe |

### 6.4 Affected Scope Scoring (8 pts max)

| Plant Count | Points |
|-------------|--------|
| 0 | 0 |
| 1 | 2 |
| 2-3 | 5 |
| ≥ 4 | 8 |

### 6.5 Revenue Exposure Scoring (10 pts max)

| Revenue | Points |
|---------|--------|
| 0 | 0 |
| 1 - 99,999 | 2 |
| 100,000 - 499,999 | 4 |
| 500,000 - 999,999 | 7 |
| ≥ 1,000,000 | 10 |

### 6.6 Why 58 Points Maximum? (Not 100)

The **S4R Mode Risk Scoring** uses **4 components** (not 5 as in mock mode) because **Material Criticality** data is not available from the S/4HANA Purchase Order APIs.

```
┌────────────────────────────────────────────────────────────────┐
│           WHY MAX SCORE = 58 (NOT 100)                         │
├────────────────────────────────────────────────────────────────┤
│  Component               Max Points    Status                  │
│  ─────────────────────────────────────────────────────────────│
│  Supplier Performance       15         ✅ Available            │
│  Delay Severity             25         ✅ Available            │
│  Affected Scope              8         ✅ Available            │
│  Revenue Exposure           10         ✅ Available            │
│  Material Criticality       --         ❌ NOT AVAILABLE        │
│  ─────────────────────────────────────────────────────────────│
│  TOTAL                      58                                 │
└────────────────────────────────────────────────────────────────┘
```

**Formula:** `maxPossibleScore = 15 + 25 + 8 + 10 = 58`

### 6.7 Component Details with Code References

#### 6.7.1 Supplier Performance - Detailed Logic

**What It Measures:** Historical OTIF performance over last 6 months.

**Code** (`srv/service.js` lines 1817-1824):
```javascript
if (supplierOtifData?.success && supplierOtifData.otifPercentage !== null) {
    const otif = supplierOtifData.otifPercentage;
    if (otif < 50) breakdown.supplierPerformance = 15;       // Critical
    else if (otif < 70) breakdown.supplierPerformance = 12;  // Poor
    else if (otif < 85) breakdown.supplierPerformance = 8;   // Below target
    else if (otif < 90) breakdown.supplierPerformance = 3;   // Acceptable
    else breakdown.supplierPerformance = 0;                  // Good (>= 90%)
}
```

| OTIF Range | Points | Classification | Why This Score |
|------------|--------|----------------|----------------|
| **≥ 90%** | 0 | Good | Reliable supplier, minimal risk |
| **85-89%** | 3 | Acceptable | Slight concerns |
| **70-84%** | 8 | Below Target | Elevated risk (~50% of max) |
| **50-69%** | 12 | Poor | High risk (~80% of max) |
| **< 50%** | 15 | Critical | Maximum risk |

#### 6.7.2 Delay Severity - Detailed Logic

**What It Measures:** Current delay of the specific PO.

**Code** (`srv/service.js` lines 1827-1832):
```javascript
const delayDays = s4rData.delayDays || 0;
if (delayDays > 21) breakdown.delaySeverity = 25;        // Severe
else if (delayDays >= 15) breakdown.delaySeverity = 20;  // Significant
else if (delayDays >= 8) breakdown.delaySeverity = 12;   // Moderate
else if (delayDays >= 1) breakdown.delaySeverity = 5;    // Minor
```

**Why Highest Weight (25 pts)?** Current disruption has immediate impact.

#### 6.7.3 Affected Scope - Detailed Logic

**Code** (`srv/service.js` lines 1834-1838):
```javascript
const plantCount = (s4rData.affectedPlants || []).length;
if (plantCount >= 4) breakdown.affectedScope = 8;
else if (plantCount >= 2) breakdown.affectedScope = 5;
else if (plantCount === 1) breakdown.affectedScope = 2;
```

#### 6.7.4 Revenue Exposure - Detailed Logic

**Code** (`srv/service.js` lines 1840-1845):
```javascript
const revenue = s4rData.estimatedRevenueImpact || 0;
if (revenue >= 1000000) breakdown.revenueExposure = 10;
else if (revenue >= 500000) breakdown.revenueExposure = 7;
else if (revenue >= 100000) breakdown.revenueExposure = 4;
else if (revenue > 0) breakdown.revenueExposure = 2;
```

### 6.8 Total Score Calculation

**Formula** (`srv/service.js` line 1847):
```javascript
const totalScore = breakdown.supplierPerformance + 
                   breakdown.delaySeverity + 
                   breakdown.affectedScope + 
                   breakdown.revenueExposure;
```

```
totalScore = supplierPerformance (0-15)
           + delaySeverity       (0-25)
           + affectedScope       (0-8)
           + revenueExposure     (0-10)
           ─────────────────────────────
           = 0 to 58 points
```

### 6.9 Risk Percentage Calculation

**Formula** (`srv/service.js` line 1848):
```javascript
const riskPercentage = Math.round((totalScore / maxPossibleScore) * 100);
```

**Examples:**
| Score | Calculation | Risk % |
|-------|-------------|--------|
| 10 | (10/58)×100 | 17% |
| 23 | (23/58)×100 | 40% |
| 32 | (32/58)×100 | 55% |
| 41 | (41/58)×100 | 71% |
| 58 | (58/58)×100 | 100% |

### 6.10 Risk Level Determination

**Formula** (`srv/service.js` line 1849):
```javascript
let riskLevel = riskPercentage >= 70 ? 'HIGH' 
              : riskPercentage >= 40 ? 'MEDIUM' 
              : 'LOW';
```

| Risk % Range | Risk Level | Color | Action |
|--------------|------------|-------|--------|
| **0-39%** | LOW | 🟢 Green | Monitor |
| **40-69%** | MEDIUM | 🟡 Amber | Review needed |
| **70-100%** | HIGH | 🔴 Red | Immediate action |

**Visual Scale:**
```
Score:    0         23        41        58
          │─────────┼─────────┼─────────│
          │   LOW   │  MEDIUM │  HIGH   │
          │ (0-39%) │ (40-69%)│(70-100%)│
          │   🟢    │    🟡   │   🔴    │
          └─────────┴─────────┴─────────┘
```

### 6.11 Complete Scoring Flow

```
INPUT: OTIF=72%, Delay=10d, Plants=3, Revenue=750K
                    │
                    ▼
┌─────────────────────────────────────────────┐
│ STEP 1: Score Each Component                │
│   Supplier: 72% → <85% → 8 pts              │
│   Delay: 10d → ≥8d → 12 pts                 │
│   Scope: 3 plants → ≥2 → 5 pts              │
│   Revenue: 750K → ≥500K → 7 pts             │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│ STEP 2: Sum Total                           │
│   totalScore = 8 + 12 + 5 + 7 = 32          │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│ STEP 3: Calculate Percentage                │
│   riskPct = (32/58) × 100 = 55%             │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│ STEP 4: Determine Level                     │
│   55% ≥ 40% AND < 70% → MEDIUM 🟡           │
└─────────────────────────────────────────────┘
                    │
                    ▼
OUTPUT: { totalScore: 32, riskPercentage: 55, 
          riskLevel: "MEDIUM" }
```

### 6.12 S4R vs Mock Mode Comparison

| Aspect | S4R Mode | Mock Mode |
|--------|----------|-----------|
| Max Score | 58 | 100 |
| Components | 4 | 5 |
| Supplier Performance | 15 pts | 30 pts |
| Material Criticality | ❌ N/A | ✅ 20 pts |
| Affected Scope | 8 pts | 15 pts |
| Data Source | Live S/4HANA | Mock files |

### 6.13 Worked Examples

#### Example 1: LOW Risk
| Input | Value | Points |
|-------|-------|--------|
| OTIF | 92% | 0 |
| Delay | 3 days | 5 |
| Plants | 1 | 2 |
| Revenue | ₹50K | 2 |
| **Total** | | **9** |

`Risk% = 16% → LOW 🟢`

#### Example 2: MEDIUM Risk
| Input | Value | Points |
|-------|-------|--------|
| OTIF | 72% | 8 |
| Delay | 10 days | 12 |
| Plants | 3 | 5 |
| Revenue | ₹750K | 7 |
| **Total** | | **32** |

`Risk% = 55% → MEDIUM 🟡`

#### Example 3: HIGH Risk
| Input | Value | Points |
|-------|-------|--------|
| OTIF | 45% | 15 |
| Delay | 25 days | 25 |
| Plants | 5 | 8 |
| Revenue | ₹2.5M | 10 |
| **Total** | | **58** |

`Risk% = 100% → HIGH 🔴`

---

## 7. Supplier OTIF Calculation (getSupplierHistoricalOtif)

### 7.1 Overview & Purpose

**API Endpoint:**
```
GET /odata/v4/supplier-resilience/getSupplierHistoricalOtif(supplierId='<ID>')
```

**Purpose:** Fetches all POs for a supplier from S/4HANA (last 6 months, max 50 POs) and calculates aggregate OTIF metrics.

**Files:**
- `srv/lib/supplier-otif-handler.js` - Orchestrates S4R API calls
- `srv/lib/supplier-otif-calculator.js` - Performs OTIF calculations

### 7.2 End-to-End Flow

```
STEP 1: Fetch PO list for supplier (A_PurchaseOrder)
        Filter: Supplier + Date range (last 6 months)
        │
        ▼
STEP 2: For each PO, fetch in parallel:
        • A_PurchaseOrderItem → orderedQuantity
        • A_PurchaseOrderScheduleLine → plannedDeliveryDate
        • A_MaterialDocumentItem (101) → deliveredQuantity
        • A_MaterialDocumentHeader → actualDeliveryDate
        │
        ▼
STEP 3: For each PO, calculate:
        • status: DELIVERED|PARTIALLY_DELIVERED|PENDING|OVERDUE
        • isOnTime = actualDate <= plannedDate
        • isInFull = deliveredQty >= orderedQty
        • isOTIF = isOnTime AND isInFull
        │
        ▼
STEP 4: Aggregate supplier metrics:
        • OTIF% = (otifPOs / deliveredPOs) × 100
        • OnTime% = (onTimePOs / deliveredPOs) × 100
        • InFull% = (inFullPOs / deliveredPOs) × 100
```

### 7.3 S4R APIs Consumed

| API | Entity | Purpose | Key Fields |
|-----|--------|---------|------------|
| `API_PURCHASEORDER_PROCESS_SRV` | `A_PurchaseOrder` | PO list | PurchaseOrder, Supplier, AddressName |
| `API_PURCHASEORDER_PROCESS_SRV` | `A_PurchaseOrderItem` | Ordered qty | OrderQuantity |
| `API_PURCHASEORDER_PROCESS_SRV` | `A_PurchaseOrderScheduleLine` | Planned date | ScheduleLineDeliveryDate |
| `API_MATERIAL_DOCUMENT_SRV` | `A_MaterialDocumentItem` | Delivered qty | QuantityInEntryUnit (type 101) |
| `API_MATERIAL_DOCUMENT_SRV` | `A_MaterialDocumentHeader` | Actual date | PostingDate |

### 7.4 Data Extraction Logic

**Ordered Quantity:**
```javascript
orderedQty = SUM(OrderQuantity) from all PO items
```

**Planned Delivery Date:**
```javascript
plannedDate = EARLIEST(ScheduleLineDeliveryDate) from schedule lines
```

**Delivered Quantity:**
```javascript
deliveredQty = SUM(QuantityInEntryUnit) where GoodsMovementType = '101'
```

**Actual Delivery Date:**
```javascript
actualDate = PostingDate from Material Document Header
```

### 7.5 OTIF Calculation Formulas

#### Per-PO OTIF:
```
isOnTime = actualDeliveryDate <= plannedDeliveryDate
isInFull = deliveredQuantity >= orderedQuantity
isOTIF   = isOnTime AND isInFull
delayDays = MAX(0, actualDate - plannedDate)
```

#### Supplier Aggregate OTIF:
```
otifPercentage = (otifPOs / deliveredPOs) × 100
onTimePercentage = (onTimePOs / deliveredPOs) × 100
inFullPercentage = (inFullPOs / deliveredPOs) × 100

Note: deliveredPOs = DELIVERED + PARTIALLY_DELIVERED
      PENDING and OVERDUE are excluded from % calculations
```

### 7.6 PO Status Classification

| Status | Condition | In deliveredPOs? |
|--------|-----------|------------------|
| `DELIVERED` | Has GR, qty >= ordered | ✅ Yes |
| `PARTIALLY_DELIVERED` | Has GR, qty < ordered | ✅ Yes |
| `PENDING` | No GR, planned >= today | ❌ No |
| `OVERDUE` | No GR, planned < today | ❌ No |

### 7.7 Output Fields

| Field | Description |
|-------|-------------|
| `otifPercentage` | Overall OTIF % |
| `totalPOs` | Total POs in period |
| `deliveredPOs` | DELIVERED + PARTIALLY_DELIVERED count |
| `otifPOs` | Count where isOtif=true |
| `onTimePOs` | Count where isOnTime=true |
| `inFullPOs` | Count where isInFull=true |
| `pendingPOs` | Count with status=PENDING |
| `overduePOs` | Count with status=OVERDUE |
| `partiallyDeliveredPOs` | Count with status=PARTIALLY_DELIVERED |
| `onTimePercentage` | On-time % |
| `inFullPercentage` | In-full % |
| `poDetails[]` | Per-PO breakdown array |

---

## 8. Score Breakdown & Weights

### 8.1 S4R Mode Score Breakdown

```
┌──────────────────────────────────────────────────────────────────┐
│        S4R MODE - RISK SCORE BREAKDOWN (Max: 58 pts)            │
├──────────────────────────────────────────────────────────────────┤
│ Component             │ Max Pts │ Source                        │
├───────────────────────┼─────────┼───────────────────────────────┤
│ Supplier Performance  │   15    │ Historical OTIF %             │
│ Delay Severity        │   25    │ Delay days                    │
│ Affected Scope        │    8    │ Plant count                   │
│ Revenue Exposure      │   10    │ PO net amount                 │
├───────────────────────┼─────────┼───────────────────────────────┤
│ Material Criticality  │  N/A    │ NOT AVAILABLE from S4R        │
│ Affected SKUs         │  N/A    │ NOT AVAILABLE from S4R        │
└──────────────────────────────────────────────────────────────────┘
```

### 8.2 Configuration Constants (constants.js)

```javascript
const RISK_WEIGHTS = {
    supplierPerformance: 30,  // Mock mode
    delaySeverity: 25,
    materialCriticality: 20,
    affectedScope: 15,
    revenueExposure: 10
};

const RISK_THRESHOLDS = {
    LOW: { min: 0, max: 39 },
    MEDIUM: { min: 40, max: 69 },
    HIGH: { min: 70, max: 100 }
};

const OTIF_THRESHOLDS = {
    excellent: 90,
    good: 80,
    poor: 70
};

const DELAY_THRESHOLDS = {
    minor: 7,
    moderate: 14,
    significant: 21
};


---

## 9. KPIs Calculated per PO & Supplier

### 9.1 Per-PO KPIs

| KPI | Description | Calculation |
|-----|-------------|-------------|
| `delayDays` | Days late/early | actual - planned |
| `deliveryStatus` | Status | PENDING/OVERDUE/DELIVERED/PARTIAL |
| `isOnTime` | On-time flag | actual <= planned |
| `isInFull` | In-full flag | delivered >= ordered |
| `otifForThisPO` | Binary OTIF | 100% or 0% |
| `deliveryCompletion` | % delivered | (delivered/ordered) × 100 |
| `estimatedRevenueImpact` | PO value | PO net amount |
| `affectedPlants` | Plants list | Unique from items |

### 9.2 Per-Supplier KPIs

| KPI | Description | Calculation |
|-----|-------------|-------------|
| `supplierOtif` | Historical OTIF % | otifPOs / deliveredPOs × 100 |
| `supplierTrend` | Performance trend | STABLE/DECLINING/CRITICAL |
| `previousDelays` | Issue count | overduePOs + partialPOs |
| `onTimePercentage` | On-time % | onTimePOs / deliveredPOs × 100 |
| `inFullPercentage` | In-full % | inFullPOs / deliveredPOs × 100 |

### 9.3 Supplier Trend Derivation

| OTIF % | Trend |
|--------|-------|
| ≥ 90% | STABLE |
| 70-89% | DECLINING |
| < 70% | CRITICAL |

---

## 10. What's Not Calculated Yet

### 10.1 Missing Metrics (Not Available from S4R)

| Metric | Reason |
|--------|--------|
| **Material Criticality** | Not in PO data |
| **Affected SKUs Count** | Needs material master |
| **Quality Issues** | Requires QM data |
| **Supplier Financial Health** | External data needed |
| **Geographic Risk** | Needs supplier master |

### 10.2 Unavailable Fields in Output

```javascript
unavailableFields: [
    'materialCriticality',
    'affectedSkus'
]

// Without OTIF data, also unavailable:
// 'supplierOtif', 'supplierTrend', 'previousDelays'
```

### 10.3 Scoring Notes

```javascript
// With OTIF data:
"Score includes supplier historical OTIF from last 6 months. Material criticality not available."

// Without OTIF data:
"Score based on available S4R data only. Supplier performance and material criticality not available."
```

---

## 11. Example Walkthrough

### 11.1 Scenario: Single PO Risk Assessment

**Input:** `{ po: '4500017890' }`

### 11.2 Step-by-Step Execution

**Step 1: Fetch S4R Data**
```json
// PO Header
{ "PurchaseOrder": "4500017890", "Supplier": "0000100075",
  "AddressName": "ABC Electronics Ltd", "PurchaseOrderNetAmount": "750000.00" }

// Schedule Line → Planned: Aug 19, 2026
// Material Doc → Actual: Aug 24, 2026, Qty: 700
```

**Step 2: Compute Metrics**
```javascript
orderedQuantity: 800
deliveredQuantity: 700
delayDays: 5  // Aug 24 - Aug 19
isOnTime: false
isInFull: false  // 700 < 800
otifForThisPO: 0%
deliveryStatus: 'PARTIALLY_DELIVERED'
deliveryCompletion: 87.5%
affectedPlants: ['1000', '1001']
```

**Step 3: Supplier OTIF**
```javascript
{ otifPercentage: 72, deliveredPOs: 20, otifPOs: 14, overduePOs: 2 }
```

**Step 4: Calculate Risk Score**
```javascript
breakdown = {
    supplierPerformance: 8,  // OTIF 72% → <85%
    delaySeverity: 5,        // 5 days
    affectedScope: 5,        // 2 plants
    revenueExposure: 7       // 750K
}

totalScore = 25
riskPercentage = 43%  // 25/58
riskLevel = 'MEDIUM'
```

**Step 5: Risk Drivers**
```javascript
[
    'Below target: Supplier OTIF at 72% (target: 85%)',
    'Supplier has 2 previous delivery issues',
    'Minor delay of 5 days',
    'Significant revenue exposure: 7.5L at risk',
    'Disruption affects 2 plants'
]
```


---

## 12. Flow Diagrams

### 12.1 OTIF Calculation Decision Tree

```
                    Has Goods Receipt?
                          │
           ┌──────────────┴──────────────┐
           │ NO                          │ YES
           ▼                             ▼
    ┌──────────────┐          ┌────────────────────┐
    │ Planned <    │          │ actual <= planned? │
    │ Today?       │          └─────────┬──────────┘
    └──────┬───────┘                    │
           │                 ┌──────────┴──────────┐
    ┌──────┴──────┐          │ YES               │ NO
    ▼             ▼          ▼                   ▼
 PENDING      OVERDUE    isOnTime=true     isOnTime=false
                              │                   │
                              └─────────┬─────────┘
                                        ▼
                         ┌─────────────────────────┐
                         │ delivered >= ordered?   │
                         └──────────┬──────────────┘
                                    │
                         ┌──────────┴──────────┐
                         │ YES                 │ NO
                         ▼                     ▼
                    isInFull=true        isInFull=false
                              │                   │
                              └─────────┬─────────┘
                                        ▼
                            isOTIF = isOnTime AND isInFull
                                        │
                         ┌──────────────┴──────────────┐
                         │ TRUE                        │ FALSE
                         ▼                             ▼
                    OTIF = 100%                   OTIF = 0%
```

### 12.2 Risk Level Classification

```
Score:    0         23        40        58
          │─────────┼─────────┼─────────│
          │   LOW   │  MEDIUM │  HIGH   │
          │  (0-39%)│ (40-69%)│(70-100%)│
          │   ✅    │    ⚠️   │   🔴    │
          └─────────┴─────────┴─────────┘
Risk %:   0%       39%       69%      100%
```

---

## 13. Appendix

### 13.1 File References

| File | Purpose |
|------|---------|
| `srv/service.js` | Main service, `runEarlyWarningWithS4R` |
| `srv/agents/early-warning.js` | Early Warning Agent (mock) |
| `srv/agents/risk-scorer.js` | Risk Scorer (mock) |
| `srv/lib/s4r-data-extractor.js` | S4R data extraction |
| `srv/lib/supplier-otif-handler.js` | OTIF fetch orchestration |
| `srv/lib/supplier-otif-calculator.js` | OTIF calculation |
| `srv/lib/constants.js` | Configuration |

### 13.2 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `runEarlyWarningWithS4R` | POST | Live S4R analysis |
| `runEarlyWarning` | POST | Mock data analysis |
| `getPurchaseOrderDetails` | GET | Fetch PO from S4R |
| `getSupplierHistoricalOtif` | GET | Calculate OTIF |

### 13.3 Error Handling

| Error | Response |
|-------|----------|
| Missing PO | `{ error: 'PO number required' }` |
| S4R fetch failed | `{ error: 'Failed to fetch S4R data' }` |
| No HTTP client | `{ error: 'http-client not available' }` |

---

**Document Author:** Generated from codebase analysis  
**Last Updated:** August 24, 2026

*End of Document*
