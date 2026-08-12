# 📚 SUPPLIER RESILIENCE - Complete Project Documentation

**Version:** 1.0.4 | **Last Updated:** August 10, 2026 | **Technology:** SAP CAP + SAPUI5

---

## 1. EXECUTIVE SUMMARY

**Supplier Resilience** is a supply chain risk management solution on SAP BTP using a multi-agent architecture to detect, assess, and respond to supply chain disruptions.

### Key Capabilities
- Disruption Detection (PO delays, quality issues)
- Risk Assessment (100-point scoring algorithm)
- Inventory Survival Analysis
- Live S/4HANA Integration
- Control Tower Dashboard

---

## 2. TECHNOLOGY STACK

| Layer | Technology | Version |
|-------|------------|---------|
| Runtime | Node.js | 18+ |
| Backend | SAP CAP | @sap/cds ^9 |
| Database | SAP HANA Cloud | HDI Container |
| Frontend | SAPUI5 | 1.120+ |
| Integration | SAP Cloud SDK | ^3 |
| Platform | SAP BTP | Cloud Foundry |

---

## 3. PROJECT FOLDER STRUCTURE

```
SupplierResilience/
├── app/supplierresilience/webapp/    # SAPUI5 Frontend
│   ├── controller/View1.controller.js  (1,294 lines)
│   ├── view/View1.view.xml
│   ├── manifest.json
│   └── Component.js
├── db/schema.cds                     # Database Schema (262 lines)
├── srv/
│   ├── service.cds                   # API Definitions (737 lines)
│   ├── service.js                    # Implementations (1,359 lines)
│   ├── agents/
│   │   ├── coordinator.js            # Orchestrator (505 lines)
│   │   ├── early-warning.js          # Risk Agent (395 lines)
│   │   ├── survival.js               # Survival Agent (332 lines)
│   │   ├── risk-scorer.js            # Scoring Engine (447 lines)
│   │   └── validator.js              # Event Validation (406 lines)
│   └── lib/
│       ├── constants.js              # Configuration (272 lines)
│       └── utils.js                  # Utilities (352 lines)
├── mta.yaml                          # MTA Deployment
└── package.json
```

---

## 4. DATABASE SCHEMA (db/schema.cds)

### Master Data Entities
| Entity | Purpose | Key Fields |
|--------|---------|------------|
| Supplier | Supplier performance | supplierId, otif, previousDelays, trend |
| Material | Material criticality | materialId, criticality, revenueImpact |
| Inventory | Stock levels | materialId, plant, currentStock |
| Demand | Demand forecasts | materialId, plant, weeklyDemand |
| PurchaseOrder | PO tracking | poNumber, supplier, deliveryDate |

### Workflow Entities
| Entity | Purpose | Key Fields |
|--------|---------|------------|
| DisruptionEvent | Incoming events | eventId, eventType, delayDays |
| Case | Disruption cases | caseId, status, priority |
| EarlyWarningResult | Risk results | caseId, riskScore, riskLevel |
| SurvivalResult | Inventory results | caseId, survivalWeeks, shortfall |
| CaseHistory | Audit trail | caseId, timestamp, action |

---

## 5. AGENT ARCHITECTURE

### Agent Overview
```
              ┌─────────────────────┐
              │ COORDINATOR AGENT   │ (Orchestrator)
              │ coordinator.js      │
              └──────────┬──────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
┌─────────────────────┐      ┌─────────────────────┐
│ EARLY WARNING AGENT │      │ SURVIVAL AGENT      │
│ early-warning.js    │      │ survival.js         │
│ + risk-scorer.js    │      │ + survival-calc.js  │
└─────────────────────┘      └─────────────────────┘
```

### Coordinator Workflow
1. **Validate** event using validator.js
2. **Create** disruption case
3. **Call** Early Warning Agent → Risk Score
4. **Call** Survival Agent → Inventory Analysis
5. **Consolidate** results → Final status
6. **Store** to database

### Decision Logic
| Risk | Inventory | Status |
|------|-----------|--------|
| HIGH | Shortfall | ACTION_REQUIRED |
| HIGH | No Shortfall | MONITORING |
| LOW/MED | Any | MONITORING/COMPLETED |

---

## 6. RISK SCORING ALGORITHM (risk-scorer.js)

**Total: 100 Points**

| Component | Max Points | Factors |
|-----------|------------|---------|
| Supplier Performance | 30 | OTIF%, Previous delays, Trend |
| Delay Severity | 25 | Days delayed |
| Material Criticality | 20 | CRITICAL/HIGH/MED/LOW |
| Affected Scope | 15 | Plants & SKUs count |
| Revenue Exposure | 10 | Revenue at risk |

### Scoring Details

**Supplier Performance (30 pts):**
- OTIF < 70% → +15 pts
- OTIF 70-79% → +10 pts
- Previous delays > 5 → +8 pts
- Trend DETERIORATING → +7 pts

**Delay Severity (25 pts):**
- > 21 days → 25 pts (Severe)
- 15-21 days → 20 pts (Significant)
- 8-14 days → 12 pts (Moderate)
- 1-7 days → 5 pts (Minor)

**Risk Levels:**
- 0-39 → **LOW** (Green)
- 40-69 → **MEDIUM** (Yellow)
- 70-100 → **HIGH** (Red)

---

## 7. SURVIVAL CALCULATION (survival-calculator.js)

### Formulas

```
Available Inventory = Current - Blocked - Reserved + InTransit

Survival Weeks = Available Inventory ÷ Weekly Demand

Coverage Gap = Survival Weeks - Supplier Recovery Weeks

Shortfall Qty = max(0, -Gap) × Weekly Demand

Action Required = (Coverage Gap < 0)
```

### Example
| Field | Value |
|-------|-------|
| Current Stock | 5,000 |
| Blocked | 500 |
| Reserved | 1,000 |
| In-Transit | 800 |
| **Available** | **4,300** |
| Weekly Demand | 500 |
| **Survival Weeks** | **8.6** |
| Recovery Weeks | 14 |
| **Gap** | **-5.4 weeks** |
| **Shortfall** | **2,700 units** |

---

## 8. API REFERENCE

### Dashboard APIs
| API | Method | Description |
|-----|--------|-------------|
| listCases() | GET | List cases with filters |
| getCaseDetails(caseId) | GET | Single case details |
| getDashboardSummary() | GET | Dashboard KPIs |
| getCaseHistory(caseId) | GET | Audit trail |

### Agent APIs
| API | Method | Description |
|-----|--------|-------------|
| runCoordinator(...) | POST | Full workflow |
| runEarlyWarning(...) | POST | Risk assessment |
| runSurvival(...) | POST | Survival analysis |

### S/4HANA Integration
| API | Method | Description |
|-----|--------|-------------|
| getPurchaseOrderDetails(po) | GET | Live PO from S/4HANA |

### Utility APIs
| API | Method | Description |
|-----|--------|-------------|
| health() | GET | Service health |
| getConfig() | GET | Risk configuration |

---

## 9. S/4HANA INTEGRATION

### APIs Consumed
| S/4HANA API | Endpoint | Purpose |
|-------------|----------|---------|
| API_PURCHASEORDER_PROCESS_SRV | A_PurchaseOrder | PO Header |
| API_PURCHASEORDER_PROCESS_SRV | A_PurchaseOrderItem | PO Items |
| API_MATERIAL_DOCUMENT_SRV | A_MaterialDocumentItem | Goods Receipts |

### Code Pattern
```javascript
// Import SAP Cloud SDK
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

// Define BTP destination
const destination = { destinationName: 'S4R' };

// Build OData URL
const url = `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder('${po}')?$format=json`;

// Execute request
const response = await executeHttpRequest(destination, {
    method: 'GET',
    url: url,
    headers: { Accept: 'application/json' }
});
```

---

## 10. DEPLOYMENT (mta.yaml)

### Modules
- **SupplierResilience-srv** - CAP Backend (Node.js)
- **SupplierResilience-db-deployer** - HANA DB Deployer
- **supplierresilience** - UI5 Application (HTML5)

### Resources
- **SupplierResilience-auth** - XSUAA
- **SupplierResilience-db** - HANA HDI Container
- **SupplierResilience-destination-service** - Destination
- **SupplierResilience-connectivity** - Connectivity

### Commands
```bash
npm install          # Install dependencies
cds watch            # Local development
mbt build            # Build MTA archive
cf deploy *.mtar     # Deploy to BTP
```

---

## 11. CONFIGURATION (constants.js)

| Constant | Value |
|----------|-------|
| RISK_WEIGHTS.supplierPerformance | 30 |
| RISK_WEIGHTS.delaySeverity | 25 |
| RISK_WEIGHTS.materialCriticality | 20 |
| RISK_WEIGHTS.affectedScope | 15 |
| RISK_WEIGHTS.revenueExposure | 10 |
| RISK_THRESHOLDS.LOW | 0-39 |
| RISK_THRESHOLDS.MEDIUM | 40-69 |
| RISK_THRESHOLDS.HIGH | 70-100 |
| DEFAULT_CONFIG.defaultRecoveryWeeks | 14 |

### Environment Variables
| Variable | Values |
|----------|--------|
| DATA_MODE | MOCK / S4 |
| DEBUG | true / false |

---

*End of Document*



