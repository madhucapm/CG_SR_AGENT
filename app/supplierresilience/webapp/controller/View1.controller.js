sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageToast) {
    "use strict";

    return Controller.extend("supplierresilience.controller.View1", {
        /**
         * Available regions for the Global Risks dropdown.
         * Each entry has a `key` (used as the model value and in prompts)
         * and a `text` (display label in the Select control).
         */
        _GLOBAL_RISKS_REGIONS: [
            { key: "India",         text: "India" },
            { key: "America",       text: "America" },
            { key: "Europe",        text: "Europe" },
            { key: "North America", text: "North America" },
            { key: "East Asia",     text: "East Asia" },
            { key: "China",         text: "China" }
        ],

        onInit: function () {
            // Disruptions JSON model — populated by the supplier_resilience_agent
            // POST /analyze call when the user investigates a risk from the
            // Global Risks card. Drives the Disruptions view.
            var oDisruptionsModel = new JSONModel({
                busy: false,
                hasResult: false,
                selectedRisk: null,
                result: null,
                affectedPOs: [],
                aiRiskState: "initial",   // "initial" | "loading" | "impactPreview" | "creatingCase" | "caseCreated" | "error"
                impactPreview: null,      // populated on Investigate success
                createdCase: null         // populated on createImpactCase success
            });
            this.getView().setModel(oDisruptionsModel, "disruptions");

            // Case Hierarchy JSON model — populated by getCaseHierarchy
            // when the user opens the Case Dashboard for a specific case.
            var oCaseHierarchyModel = new JSONModel({
                busy: false,
                caseData: null,
                suppliers: [],
                purchaseOrders: [],
                materials: [],
                hierarchyTree: [],
                allCasesTree: [],
                allCasesBusy: false
            });
            this.getView().setModel(oCaseHierarchyModel, "caseHierarchy");

            // Early Warning Result JSON model — populated when the user
            // clicks "Run" on the Early Warning Agent in the Case Dashboard.
            // Holds the full response + extracted supplier/PO data for UI binding.
            var oEarlyWarningResultModel = new JSONModel({
                busy: false,
                error: null,
                result: null,
                caseId: null,
                status: null,
                totalSuppliers: 0,
                totalPOs: 0,
                dataSource: null,
                calculatedAt: null,
                suppliers: [],
                poDetails: [],
                summary: {
                    totalPOs: 0, deliveredPOs: 0, overduePOs: 0, onTimePOs: 0,
                    avgDelay: 0, totalOrdered: 0, totalDelivered: 0,
                    maxRiskScore: 0, maxRiskLevel: null
                }
            });
            this.getView().setModel(oEarlyWarningResultModel, "earlyWarningResult");

            // Monitoring JSON model — static MVP data for the Case Timeline.
            // In a future phase this model will be replaced with live
            // CAP/HANA AgentExecutionHistory data without redesigning the XML.
            var oMonitoringModel = new JSONModel({
                case: {
                    caseId: "#SC-2024-613",
                    event: "Fire at ABC Metals Plant",
                    severity: "CRITICAL",
                    classification: "COMPLETE INTERRUPTION"
                },
                activities: [
                    {
                        agent: "Coordinator Agent",
                        title: "Case Created",
                        description: "Case created after human confirmation. 1 supplier, 2 materials, 2 plants, 3 POs at risk.",
                        time: "14:00",
                        status: "completed"
                    },
                    {
                        agent: "Early Warning Agent",
                        title: "Risk Assessment Complete",
                        description: "Risk Score: 92/100 (Critical). ABC Metals sole supplier for Al Sheet to India plants.",
                        time: "14:03",
                        status: "completed"
                    },
                    {
                        agent: "Survival Planner",
                        title: "Coverage Analysis Complete",
                        description: "Mumbai: 8 days coverage. Pune: 12 days. Gap: 14/10 days. Total shortfall: 370 MT.",
                        time: "14:05",
                        status: "completed"
                    },
                    {
                        agent: "Substitution Agent",
                        title: "Recommendations Generated",
                        description: "3 options: Delta Metals alt supplier, Pune stock transfer, Al Alloy 3003 substitution.",
                        time: "14:08",
                        status: "completed"
                    },
                    {
                        agent: "Approval Workflow",
                        title: "Approved via Mock SBPA",
                        description: "All recommendations approved. Triggering Buyer Agent.",
                        time: "14:22",
                        status: "completed"
                    },
                    {
                        agent: "Buyer Agent",
                        title: "PO Created - Delta Metals (EXC-001)",
                        description: "EXC-001: 200 MT Aluminium Sheet. Confirmed by Mock S/4HANA. Agent cost: $12.",
                        time: "14:32",
                        status: "completed"
                    },
                    {
                        agent: "Buyer Agent",
                        title: "Stock Transfer Created (EXC-002)",
                        description: "EXC-002: 80 MT Pune to Mumbai. Confirmed. Agent cost: $8.",
                        time: "14:35",
                        status: "completed"
                    },
                    {
                        agent: "Buyer Agent",
                        title: "PO Submitted - PolyAsia (EXC-003)",
                        description: "EXC-003: 50 MT PET Resin. Awaiting confirmation. Agent cost: $11.",
                        time: "15:01",
                        status: "pending"
                    }
                ],
                agentStatuses: [
                    { name: "Coordinator", status: "completed" },
                    { name: "Early Warning", status: "completed" },
                    { name: "Survival Planner", status: "completed" },
                    { name: "Substitution", status: "completed" },
                    { name: "Approval", status: "completed" },
                    { name: "Buyer Agent", status: "pending" }
                ]
            });
            this.getView().setModel(oMonitoringModel, "monitoringModel");

            // Risk Assessment JSON model — sample/mock data as fallback;
            // intended to be populated from Early Warning Agent / case
            // impact results when a real case is active.
            var oRiskAssessmentModel = new JSONModel({
                kpi: {
                    highestRisk:      { value: "92", supplier: "ABC Metals" },
                    suppliersImpacted:{ value: "4",  sub: "Primary metric" },
                    posAtRisk:        { value: "8",  sub: "Primary metric" },
                    plants:           { value: "7",  sub: "Affected" }
                },
                supplierRisks: [
                    {
                        supplier: "ABC Metals",
                        classification: "COMPLETE INTERRUPTION",
                        riskScore: "92/100",
                        severity: "CRITICAL",
                        posAtRisk: "3",
                        plants: "Mumbai Plant, Pune Plant",
                        skus: "Coke Can, Sprite Can, Fanta Can"
                    },
                    {
                        supplier: "MetalCorp US",
                        classification: "TARIFF",
                        riskScore: "74/100",
                        severity: "HIGH",
                        posAtRisk: "2",
                        plants: "Atlanta Plant, Monterey Plant",
                        skus: "Soda Can Body, Can Lid"
                    }
                ]
            });
            this.getView().setModel(oRiskAssessmentModel, "riskAssessment");

            // Survival Planning JSON model — sample/mock data as fallback;
            // intended to be populated from Survival Planner Agent /
            // case material-supply data when a real case is active.
            var oSurvivalPlanningModel = new JSONModel({
                kpi: {
                    criticalItems:  { value: "3",      sub: "Coverage < 10 days" },
                    avgCoverage:    { value: "15 days", sub: "All materials" },
                    worstGap:       { value: "18 days", sub: "Aluminium Coil - Mumbai" },
                    totalShortfall: { value: "483 MT",  sub: "Needs mitigation" }
                },
                materials: [
                    { material: "Aluminium Sheet", plant: "Mumbai Plant",      coverage: "8 days",  timeToSurvive: "8 days",  recovery: "2024-03-15", gap: "14 days", shortfall: "240 MT" },
                    { material: "Aluminium Sheet", plant: "Pune Plant",        coverage: "12 days", timeToSurvive: "12 days", recovery: "2024-03-15", gap: "10 days", shortfall: "130 MT" },
                    { material: "Aluminium Coil",  plant: "Mumbai Plant",      coverage: "5 days",  timeToSurvive: "5 days",  recovery: "2024-03-18", gap: "18 days", shortfall: "95 MT" },
                    { material: "Aluminium Ingot", plant: "Atlanta Plant",     coverage: "21 days", timeToSurvive: "21 days", recovery: "2024-03-01", gap: "0 days",  shortfall: "—" },
                    { material: "PET Resin",       plant: "Ho Chi Minh Plant", coverage: "15 days", timeToSurvive: "15 days", recovery: "2024-03-10", gap: "3 days",  shortfall: "18 MT" },
                    { material: "Citric Acid",     plant: "Jebel Ali Hub",     coverage: "30 days", timeToSurvive: "30 days", recovery: "2024-03-05", gap: "0 days",  shortfall: "—" }
                ]
            });
            this.getView().setModel(oSurvivalPlanningModel, "survivalPlanning");

            // User model powering the News Feed hero header greeting.
            // The "user" model is set at the Component level (Component.js)
            // and populated dynamically from /user-api/currentUser.
            // No need to create a local model here — the view inherits the
            // component-level "user" model automatically.

            // Load global supply chain risks from Anthropic Claude LLM
            // via the AI_CORE_CGAI_COCKPIT destination. Called once on init;
            // users can manually refresh via the card's refresh button.
            this._loadGlobalRisksFromAI();
        },


        // ─────────────────────────────────────────────────────────────
        //  News Feed home – new-design event handlers
        // ─────────────────────────────────────────────────────────────

        /**
         * Row press on the "Today's Global Supply Chain Risks" list.
         * Bound to `List#itemPress`, so the pressed row is exposed via
         * the `listItem` event parameter (not the event source itself,
         * which is the List). For now we just surface a MessageToast;
         * can be wired to a detail dialog / route later.
         */
        onRiskPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oCtx  = oItem && oItem.getBindingContext("dashboard");
            if (!oCtx) { return; }
            var oRisk = oCtx.getObject() || {};

            // Store the selected risk in the disruptions model so the
            // "Investigate a Risk" button knows which risk to analyze.
            var oDisruptions = this.getView().getModel("disruptions");
            if (oDisruptions) {
                oDisruptions.setProperty("/selectedRisk", oRisk);
            }
            MessageToast.show("Risk selected: " + (oRisk.title || oRisk.id || "") + " — Click 'Investigate a Risk' to analyze");
        },

        /**
         * Called when the Global Risks list finishes rendering / updating items.
         * Programmatically applies the correct risk-level CSS class to each
         * badge Text control, since dynamic class binding on sap.m.Text
         * inside list templates is unreliable with the sap_horizon theme.
         */
        onRiskListUpdateFinished: function () {
            var oList = this.byId("globalRisksList");
            if (!oList) { return; }

            var aItems = oList.getItems();
            var mBadgeClass = {
                "Critical": "riskCritical",
                "High":     "riskHigh",
                "Medium":   "riskMedium",
                "Low":      "riskLow"
            };

            aItems.forEach(function (oItem) {
                var oCtx = oItem.getBindingContext("dashboard");
                if (!oCtx) { return; }
                var sRiskLevel = oCtx.getProperty("riskLevel") || "Medium";
                var sClass = mBadgeClass[sRiskLevel] || "riskMedium";

                // Find the Text control with class "riskBadgeText" inside the item
                var aContent = oItem.getContent();
                if (!aContent || !aContent.length) { return; }

                // Navigate: CustomListItem > HBox(ctRiskRow) > HBox(ctRiskRight) > VBox(ctRiskMeta) > HBox(ctRiskMetaRow[0]) > Text
                var aBadgeTexts = [];
                (function findBadgeTexts(aControls) {
                    if (!aControls) { return; }
                    for (var i = 0; i < aControls.length; i++) {
                        var oCtrl = aControls[i];
                        if (oCtrl.hasStyleClass && oCtrl.hasStyleClass("riskBadgeText")) {
                            aBadgeTexts.push(oCtrl);
                        }
                        // Recurse into child aggregations
                        if (oCtrl.getItems) { findBadgeTexts(oCtrl.getItems()); }
                        if (oCtrl.getContent) { findBadgeTexts(oCtrl.getContent()); }
                    }
                })(aContent);

                aBadgeTexts.forEach(function (oText) {
                    // Remove any previously applied risk classes
                    oText.removeStyleClass("riskCritical");
                    oText.removeStyleClass("riskHigh");
                    oText.removeStyleClass("riskMedium");
                    oText.removeStyleClass("riskLow");
                    // Apply the correct one
                    oText.addStyleClass(sClass);
                });
            });
        },

        /**
         * Side-navigation itemSelect handler. Called when the user clicks
         * any item in the SideNavigation. Reads the key and delegates to
         * _selectSideNav.
         */
        onNavSelect: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            var sKey = oItem && oItem.getKey();
            if (sKey && sKey !== "monitor" && sKey !== "assess" && sKey !== "act" && sKey !== "track") {
                this._selectSideNav(sKey);
            }
        },

        /**
         * Footer "View all disruptions →" link. Navigates the user to
         * the Cases sub-tab which shows the full case backlog.
         */
        onViewAllDisruptions: function () {
            this._selectSideNav("caseDashboard");
        },

        /**
         * "← Back to Risk Feed" link on the Case Dashboard view header.
         * Navigates the user back to the News Feed home which
         * displays the Global Supply Chain Risks card.
         */
        onBackToRiskFeed: function () {
            this._selectSideNav("control");
        },

        /**
         * "Investigate" button inside each Global Risks list item.
         * Selects the risk from the button's parent list-item context,
         * stores it in the disruptions model, and triggers the analysis.
         */
        onInvestigateRisk: function (oEvent) {
            var oDisruptions = this.getView().getModel("disruptions");

            // Prevent duplicate clicks while an investigation is in progress.
            if (oDisruptions && oDisruptions.getProperty("/aiRiskState") === "loading") {
                MessageToast.show("Investigation already in progress…");
                return;
            }

            // The button sits inside a CustomListItem. Walk up from the
            // button to find the binding context of the enclosing list item
            // so the risk is self-selected without relying on onRiskPress.
            var oSource = oEvent.getSource();
            var oCtx = oSource && oSource.getBindingContext("dashboard");
            if (!oCtx) {
                var oParent = oSource && oSource.getParent();
                while (oParent && !oCtx) {
                    oCtx = oParent.getBindingContext("dashboard");
                    oParent = oParent.getParent();
                }
            }

            var oSelectedRisk;
            if (oCtx) {
                oSelectedRisk = oCtx.getObject() || {};
                if (oDisruptions) {
                    oDisruptions.setProperty("/selectedRisk", oSelectedRisk);
                }
            } else {
                oSelectedRisk = oDisruptions && oDisruptions.getProperty("/selectedRisk");
            }

            if (!oSelectedRisk) {
                MessageToast.show("Please select a risk from the Global Risks list first");
                return;
            }

            // Transition right-side card to loading state
            if (oDisruptions) {
                oDisruptions.setProperty("/aiRiskState", "loading");
            }

            MessageToast.show("Investigating: " + (oSelectedRisk.title || ""));

            // Navigation to Case Dashboard is commented out —
            // the user stays on the current view.
            // this._selectSideNav("disruptions");

            var sRegion = oSelectedRisk.region || "";
            var sLocation = sRegion.split(",")[0].trim() || "Mumbai";
            var sImpactDescription = oSelectedRisk.category || "disruption";

            this._analyzeDisruption(sLocation, sImpactDescription);
        },

        /** AI Assistant – "Ask a Question" placeholder action. */
        onAskQuestion: function () {
            MessageToast.show("Ask a Question – coming soon");
        },

        /** AI Assistant – "View Recommended Actions" – opens Scenario tab. */
        onViewRecommendedActions: function () {
            this._selectSideNav("approvals");
            MessageToast.show("View Recommended Actions");
        },

        /** AI Assistant – "Upload or Add Information" placeholder action. */
        onUploadInfo: function () {
            MessageToast.show("Upload or Add Information – coming soon");
        },

        /**
         * Recommendations screen — static prototype Approve / Reject.
         * No backend call, no persistence, no business logic.
         * Will be replaced with real approval flow in a future phase.
         */
        onRecommendationAction: function () {
            MessageToast.show("Static prototype — approval flow will be implemented in the next phase.");
        },

        /**
         * "Confirm Impact & Create Case" button on the Impact Preview card.
         * Triggers the existing Coordinator / case-creation flow for the
         * currently investigated risk. Resets the card back to initial state
         * after confirmation.
         */
        onConfirmImpact: function () {
            var oView = this.getView();
            var oDisruptions = oView.getModel("disruptions");
            var oImpact = oDisruptions && oDisruptions.getProperty("/impactPreview");
            var oResult = oDisruptions && oDisruptions.getProperty("/result");
            var oSelectedRisk = oDisruptions && oDisruptions.getProperty("/selectedRisk");
            var that = this;

            if (!oImpact || !oResult) {
                MessageToast.show("No impact data to confirm.");
                return;
            }

            // Prevent duplicate clicks
            if (oDisruptions.getProperty("/aiRiskState") === "creatingCase") {
                return;
            }

            oDisruptions.setProperty("/aiRiskState", "creatingCase");

            // Build severity / classification from impact data
            var oScope = oDisruptions.getProperty("/scope") || {};
            var iRiskScoreRaw = oImpact.riskScore || "0";
            var iRiskScore = parseInt(String(iRiskScoreRaw).replace(/[^0-9]/g, ""), 10) || 0;
            var sSeverity = iRiskScore >= 80 ? "CRITICAL" : iRiskScore >= 60 ? "HIGH" : iRiskScore >= 40 ? "MEDIUM" : "LOW";

            var oPayload = {
                eventTitle: oImpact.impactType || (oSelectedRisk && oSelectedRisk.title) || "",
                eventDescription: (oSelectedRisk && oSelectedRisk.description) || oResult.impact_description || "",
                severity: sSeverity,
                classification: sSeverity === "CRITICAL" ? "COMPLETE INTERRUPTION" : sSeverity === "HIGH" ? "DELAYED SUPPLY" : "PARTIAL DISRUPTION",
                riskScore: iRiskScore,
                impactType: oImpact.impactType || "",
                estimatedImpact: oImpact.estimatedImpact || "",
                region: (oSelectedRisk && oSelectedRisk.region) || oResult.location || "",
                affectedSuppliers: JSON.stringify(oResult.affected_suppliers || [])
            };

            var sServiceUrl = this._getServiceUrl();
            console.log("[CaseCreation] POST createImpactCase", oPayload);

            fetch(sServiceUrl + "createImpactCase", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                credentials: "include",
                body: JSON.stringify(oPayload)
            }).then(function (oResp) {
                if (!oResp.ok) {
                    return oResp.text().then(function (sBody) {
                        throw new Error("HTTP " + oResp.status + " " + oResp.statusText +
                            (sBody ? (": " + sBody.substring(0, 300)) : ""));
                    });
                }
                return oResp.json();
            }).then(function (oData) {
                console.log("[CaseCreation] Response:", oData);

                if (!oData || oData.success === false) {
                    oDisruptions.setProperty("/aiRiskState", "impactPreview");
                    MessageToast.show("Case creation failed: " + (oData && oData.error || "Unknown error"));
                    return;
                }

                // Build summary strings from the returned data
                var aSuppliers = oData.suppliers || [];
                var aMaterials = oData.materials || [];
                var caseData = oData.caseData || {};

                var aSupplierNames = aSuppliers.map(function (s) { return s.name; }).filter(Boolean);
                var aPlantNames = [];
                var aSkuNames = [];
                aMaterials.forEach(function (m) {
                    if (m.plant && aPlantNames.indexOf(m.plant) === -1) aPlantNames.push(m.plant);
                    if (m.sku   && aSkuNames.indexOf(m.sku)     === -1) aSkuNames.push(m.sku);
                });

                oDisruptions.setProperty("/createdCase", {
                    caseId: oData.caseId,
                    eventTitle: caseData.eventTitle || oPayload.eventTitle,
                    supplierSummary: aSupplierNames.join(", ") || "—",
                    poSummary: (caseData.poCount || 0) + " Purchase Orders",
                    plantSummary: aPlantNames.join(", ") || "—",
                    skuSummary: aSkuNames.join(", ") || "—",
                    caseData: caseData,
                    suppliers: aSuppliers,
                    purchaseOrders: oData.purchaseOrders || [],
                    materials: aMaterials
                });

                // Set the created case as the selected case in the dashboard model
                var oDashboard = oView.getModel("dashboard");
                if (oDashboard) {
                    oDashboard.setProperty("/selectedCaseId", oData.caseId);
                }

                oDisruptions.setProperty("/aiRiskState", "caseCreated");
                MessageToast.show("Case " + oData.caseId + " created successfully!");

            }).catch(function (oErr) {
                console.error("[CaseCreation] Failed:", oErr);
                oDisruptions.setProperty("/aiRiskState", "impactPreview");
                MessageToast.show("Case creation failed: " + (oErr && oErr.message ? oErr.message : "Unknown error"));
            });
        },

        /**
         * "Dismiss" button on the Impact Preview card.
         * Returns the right-side card to the initial Case Creation state
         * and clears the temporary impact-preview data.
         */
        onDismissImpact: function () {
            var oDisruptions = this.getView().getModel("disruptions");
            if (oDisruptions) {
                oDisruptions.setProperty("/aiRiskState", "initial");
                oDisruptions.setProperty("/impactPreview", null);
            }
            MessageToast.show("Investigation dismissed.");
        },

        /**
         * "Open Case Dashboard →" button on the Case Created card.
         * Navigates to the Case Dashboard view and loads the newly
         * created case from HANA Cloud.
         */
        onOpenCaseDashboard: function () {
            var oDisruptions = this.getView().getModel("disruptions");
            var oCreated = oDisruptions && oDisruptions.getProperty("/createdCase");
            if (!oCreated || !oCreated.caseId) {
                MessageToast.show("No case available.");
                return;
            }

            var oDashboard = this.getView().getModel("dashboard");
            if (oDashboard) {
                oDashboard.setProperty("/selectedCaseId", oCreated.caseId);
            }

            // Navigate to Case Dashboard
            this._selectSideNav("caseDashboard");

            // Load hierarchy from HANA Cloud
            this._loadCaseHierarchy(oCreated.caseId);
        },

        /**
         * "View Monitoring →" button on Case Dashboard header.
         * Navigates to the Monitoring / Audit trail sub-tab.
         */
        onViewMonitoring: function () {
            this._selectSideNav("audit");
        },

        /* ═══════════════════════════════════════════════════════════
         * Agent Execution — Run buttons (Case Dashboard).
         * Each handler currently shows a warning MessageToast.
         * In a future phase these will trigger real backend
         * service calls to the respective agents.
         * ═══════════════════════════════════════════════════════════ */

        /**
         * Run Early Warning Agent with S4R data.
         *
         * Reads the active case from the caseHierarchy model, extracts the
         * PO numbers (and optional supplier/plant info), then calls the
         * CAP action `runEarlyWarningWithS4R`.
         *
         * Uses MULTI MODE (poList) when multiple POs exist, otherwise
         * falls back to SINGLE MODE (po) for backward compatibility.
         *
         * The full response is stored in the `earlyWarningResult` JSONModel
         * so it can be consumed by the Risk Assessment screen or any other
         * UI that needs live Early Warning Agent output.
         */
        onRunEarlyWarningAgent: function () {
            var that = this;
            var oCaseH = this.getView().getModel("caseHierarchy");
            var oEwModel = this.getView().getModel("earlyWarningResult");

            // ── Validate: a case must be loaded ──
            var oCaseData = oCaseH.getProperty("/caseData");
            if (!oCaseData || !oCaseData.caseId) {
                MessageToast.show("No active case. Please select a case first.");
                return;
            }

            var sCaseId = oCaseData.caseId;
            var aPurchaseOrders = oCaseH.getProperty("/purchaseOrders") || [];
            var aSuppliers = oCaseH.getProperty("/suppliers") || [];
            var aMaterials = oCaseH.getProperty("/materials") || [];

            // Build the PO list from the case hierarchy
            var aPoNumbers = aPurchaseOrders
                .map(function (po) { return po.poNumber; })
                .filter(Boolean);

            if (aPoNumbers.length === 0) {
                MessageToast.show("No Purchase Orders found for this case.");
                return;
            }

            // ── Build payload ──
            var oPayload;
            if (aPoNumbers.length === 1) {
                // SINGLE MODE — backward compatible
                var sSupplierId = (aSuppliers.length > 0 && aSuppliers[0].supplierId) || "";
                oPayload = {
                    caseId: sCaseId,
                    po: aPoNumbers[0],
                    supplierId: sSupplierId
                };
            } else {
                // MULTI MODE — multiple POs grouped by supplier
                oPayload = {
                    caseId: sCaseId,
                    poList: aPoNumbers
                };
            }

            // ── Set busy state ──
            oEwModel.setProperty("/busy", true);
            oEwModel.setProperty("/result", null);
            oEwModel.setProperty("/error", null);
            MessageToast.show("Running Early Warning Agent for " + aPoNumbers.length + " PO(s)…");

            var sServiceUrl = this._getServiceUrl();
            console.log("[EarlyWarning] POST runEarlyWarningWithS4R", oPayload);

            fetch(sServiceUrl + "runEarlyWarningWithS4R", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                credentials: "include",
                body: JSON.stringify(oPayload)
            }).then(function (oResp) {
                if (!oResp.ok) {
                    return oResp.text().then(function (sBody) {
                        throw new Error("HTTP " + oResp.status + " " + oResp.statusText +
                            (sBody ? (": " + sBody.substring(0, 500)) : ""));
                    });
                }
                return oResp.json();
            }).then(function (oData) {
                console.log("[EarlyWarning] runEarlyWarningWithS4R response:", oData);
                oEwModel.setProperty("/busy", false);

                if (!oData || oData.success === false) {
                    var sError = (oData && oData.error) || "Unknown error";
                    that._resetEarlyWarningModel(oEwModel, sError);
                    MessageToast.show("Early Warning Agent failed: " + sError);
                    return;
                }

                // ── Store full raw result for debugging / advanced use ──
                oEwModel.setProperty("/result", oData);
                oEwModel.setProperty("/error", null);

                // ── Top-level fields ──
                oEwModel.setProperty("/caseId", oData.caseId || null);
                oEwModel.setProperty("/status", oData.status || null);
                oEwModel.setProperty("/totalSuppliers", oData.totalSuppliers || 0);
                oEwModel.setProperty("/totalPOs", oData.totalPOs || 0);
                oEwModel.setProperty("/dataSource", oData.dataSource || null);
                oEwModel.setProperty("/calculatedAt", oData.calculatedAt || null);

                // ── Suppliers array (full objects as returned by API) ──
                var aSuppliers = Array.isArray(oData.suppliers) ? oData.suppliers : [];
                oEwModel.setProperty("/suppliers", aSuppliers);

                // ── Flatten ALL poDetails across suppliers, enrich with parent supplier info ──
                var aAllPoDetails = [];
                aSuppliers.forEach(function (oSupplier) {
                    var aPOs = Array.isArray(oSupplier.poDetails) ? oSupplier.poDetails : [];
                    aPOs.forEach(function (oPO) {
                        aAllPoDetails.push(Object.assign({}, oPO, {
                            supplierId: oSupplier.supplierId,
                            supplierName: oSupplier.supplierName
                        }));
                    });
                });
                oEwModel.setProperty("/poDetails", aAllPoDetails);

                // ── Compute summary KPIs from flat PO list ──
                var iDelivered = 0, iOverdue = 0, iOnTime = 0;
                var iTotalOrdered = 0, iTotalDelivered = 0, iTotalDelay = 0;
                aAllPoDetails.forEach(function (po) {
                    if (po.deliveryStatus === "DELIVERED") { iDelivered++; }
                    if (po.deliveryStatus === "OVERDUE")   { iOverdue++; }
                    if (po.isOnTime === true)               { iOnTime++; }
                    iTotalOrdered   += (po.orderedQuantity   || 0);
                    iTotalDelivered += (po.deliveredQuantity  || 0);
                    iTotalDelay     += (po.delayDays          || 0);
                });
                var iMaxRiskScore = 0;
                var sMaxRiskLevel = null;
                aSuppliers.forEach(function (s) {
                    if ((s.riskScore || 0) > iMaxRiskScore) {
                        iMaxRiskScore = s.riskScore;
                        sMaxRiskLevel = s.riskLevel || null;
                    }
                });
                oEwModel.setProperty("/summary", {
                    totalPOs:       aAllPoDetails.length,
                    deliveredPOs:   iDelivered,
                    overduePOs:     iOverdue,
                    onTimePOs:      iOnTime,
                    avgDelay:       aAllPoDetails.length > 0
                                        ? Math.round(iTotalDelay / aAllPoDetails.length)
                                        : 0,
                    totalOrdered:   iTotalOrdered,
                    totalDelivered: iTotalDelivered,
                    maxRiskScore:   iMaxRiskScore,
                    maxRiskLevel:   sMaxRiskLevel
                });

                console.log("[EarlyWarning] Model populated —",
                    aSuppliers.length, "supplier(s),",
                    aAllPoDetails.length, "PO detail(s)");

                // ── User-friendly success message ──
                var sMsg = "Early Warning Agent completed — ";
                if (oData.totalSuppliers !== undefined) {
                    sMsg += oData.totalSuppliers + " supplier(s), " +
                            oData.totalPOs + " PO(s) assessed.";
                } else {
                    sMsg += "Risk score: " + (oData.riskScore || oData.riskPercentage || "N/A");
                }
                if (oData.status) { sMsg += " Status: " + oData.status; }
                MessageToast.show(sMsg);

            }).catch(function (oErr) {
                console.error("[EarlyWarning] runEarlyWarningWithS4R failed:", oErr);
                oEwModel.setProperty("/busy", false);
                that._resetEarlyWarningModel(oEwModel, oErr.message || "Network error");
                MessageToast.show("Early Warning Agent error: " +
                    (oErr.message || "Unknown error"));
            });
        },

        /** Run Coordinator Agent. */
        onRunCoordinatorAgent: function () {
            MessageToast.show("Coordinator Agent — will be connected to backend service in a future phase.");
        },

        /** Run Survival Planner Agent. */
        onRunSurvivalPlannerAgent: function () {
            MessageToast.show("Survival Planner Agent — will be connected to backend service in a future phase.");
        },

        /** Run Substitution Agent. */
        onRunSubstitutionAgent: function () {
            MessageToast.show("Substitution Agent — will be connected to backend service in a future phase.");
        },

        /** Run Buyer Agent. */
        onRunBuyerAgent: function () {
            MessageToast.show("Buyer Agent — will be connected to backend service in a future phase.");
        },

        /** Run All Agents sequentially. */
        onRunAllAgents: function () {
            MessageToast.show("Run All Agents — will be connected to backend service in a future phase.");
        },

        /**
         * Toggle expand / collapse on a hierarchy tree node.
         * The pressed Button sits inside a binding context that
         * carries an "_expanded" boolean. We simply flip it.
         */
        onHierToggle: function (oEvent) {
            var oSource = oEvent.getSource();
            var oCtx = oSource.getBindingContext("caseHierarchy");
            if (!oCtx) { return; }
            var sPath = oCtx.getPath() + "/_expanded";
            var oModel = oCtx.getModel();
            oModel.setProperty(sPath, !oModel.getProperty(sPath));
        },

        /**
         * Load the full case hierarchy from HANA Cloud via
         * getCaseHierarchy CAP function and populate the
         * caseHierarchy JSON model for the Case Dashboard.
         *
         * @param {string} sCaseId - The case identifier
         */
        _loadCaseHierarchy: function (sCaseId) {
            var oView = this.getView();
            var oCaseH = oView.getModel("caseHierarchy");
            var that = this;
            if (!oCaseH) { return; }

            oCaseH.setProperty("/busy", true);
            oCaseH.setProperty("/caseData", null);
            oCaseH.setProperty("/suppliers", []);
            oCaseH.setProperty("/purchaseOrders", []);
            oCaseH.setProperty("/materials", []);
            oCaseH.setProperty("/hierarchyTree", []);

            var sServiceUrl = this._getServiceUrl();
            var sUrl = sServiceUrl +
                "getCaseHierarchy(caseId='" + encodeURIComponent(sCaseId) + "')";

            console.log("[CaseDashboard] GET", sUrl);

            fetch(sUrl, {
                method: "GET",
                headers: { "Accept": "application/json" },
                credentials: "include"
            }).then(function (oResp) {
                if (!oResp.ok) {
                    return oResp.text().then(function (sBody) {
                        throw new Error("HTTP " + oResp.status + ": " + sBody.substring(0, 300));
                    });
                }
                return oResp.json();
            }).then(function (oData) {
                console.log("[CaseDashboard] getCaseHierarchy response:", oData);
                oCaseH.setProperty("/busy", false);

                if (!oData || oData.success === false) {
                    MessageToast.show("Failed to load case: " + (oData && oData.error || "Unknown error"));
                    return;
                }

                oCaseH.setProperty("/caseData", oData.caseData || null);
                oCaseH.setProperty("/suppliers", oData.suppliers || []);
                oCaseH.setProperty("/purchaseOrders", oData.purchaseOrders || []);
                oCaseH.setProperty("/materials", oData.materials || []);

                // Build nested hierarchy tree for current case
                var aTree = that._buildHierarchyTree(
                    oData.suppliers || [], oData.purchaseOrders || [],
                    oData.materials || [], oData.caseData || {}
                );
                oCaseH.setProperty("/hierarchyTree", aTree);

                // Load all cases from HANA for the hierarchy panel
                that._loadAllCasesForHierarchy();

            }).catch(function (oErr) {
                console.error("[CaseDashboard] Load failed:", oErr);
                oCaseH.setProperty("/busy", false);
                MessageToast.show("Failed to load case: " + (oErr.message || "Unknown error"));
            });
        },

        /**
         * Build a nested tree from flat supplier/PO/material data.
         * Returns: [ { name, supplierId, severity, classification,
         *   poCount, purchaseOrders: [ { poNumber,
         *     plants: [ { plant, materials: [ { material, sku } ] } ]
         *   } ] } ]
         */
        _buildHierarchyTree: function (aSuppliers, aPOs, aMats, oCaseData) {
            var oPOsBySup = {};
            (aPOs || []).forEach(function (po) {
                var sid = po.supplierId || "";
                if (!oPOsBySup[sid]) { oPOsBySup[sid] = []; }
                oPOsBySup[sid].push(po);
            });
            var oMatsByPO = {};
            (aMats || []).forEach(function (m) {
                var key = (m.supplierId || "") + "|" + (m.poNumber || "");
                if (!oMatsByPO[key]) { oMatsByPO[key] = []; }
                oMatsByPO[key].push(m);
            });
            return (aSuppliers || []).map(function (s) {
                var sid = s.supplierId || "";
                var aSupPOs = oPOsBySup[sid] || [];
                var aParsedPOs = aSupPOs.map(function (po) {
                    var key = sid + "|" + (po.poNumber || "");
                    var aM = oMatsByPO[key] || [];
                    var oByPlant = {};
                    aM.forEach(function (m) {
                        var p = m.plant || "Unknown";
                        if (!oByPlant[p]) { oByPlant[p] = []; }
                        oByPlant[p].push({ material: m.material || "", sku: m.sku || "", itemNo: m.itemNo || "" });
                    });
                    var aPlants = Object.keys(oByPlant).map(function (p) {
                        return { plant: p, materials: oByPlant[p], _expanded: false };
                    });
                    return { poNumber: po.poNumber || "", plants: aPlants, _expanded: false };
                });
                return {
                    name: s.name || sid, supplierId: sid,
                    poCount: s.poCount || aSupPOs.length,
                    severity: oCaseData.severity || "",
                    classification: oCaseData.classification || "",
                    purchaseOrders: aParsedPOs,
                    _expanded: false
                };
            });
        },

        /**
         * Load ALL cases from HANA Cloud and build a hierarchy tree
         * for each. Populates caseHierarchy>/allCasesTree.
         */
        _loadAllCasesForHierarchy: function () {
            var oView = this.getView();
            var oCaseH = oView.getModel("caseHierarchy");
            var that = this;
            if (!oCaseH) { return; }

            oCaseH.setProperty("/allCasesTree", []);
            oCaseH.setProperty("/allCasesBusy", true);

            var sServiceUrl = this._getServiceUrl();
            var sCasesUrl = sServiceUrl + "Cases?$orderby=createdAt desc";

            fetch(sCasesUrl, {
                method: "GET",
                headers: { "Accept": "application/json" },
                credentials: "include"
            }).then(function (oResp) {
                if (!oResp.ok) { throw new Error("HTTP " + oResp.status); }
                return oResp.json();
            }).then(function (oData) {
                var aCases = (oData && oData.value) || [];
                if (!aCases.length) {
                    oCaseH.setProperty("/allCasesBusy", false);
                    return;
                }
                var aPromises = aCases.map(function (c) {
                    var sHUrl = sServiceUrl + "getCaseHierarchy(caseId='" + encodeURIComponent(c.caseId) + "')";
                    return fetch(sHUrl, { method: "GET", headers: { "Accept": "application/json" }, credentials: "include" })
                        .then(function (r) { return r.ok ? r.json() : null; })
                        .catch(function () { return null; });
                });
                return Promise.all(aPromises).then(function (aResults) {
                    var aAll = [];
                    aResults.forEach(function (oH, idx) {
                        if (!oH || oH.success === false) { return; }
                        var cd = oH.caseData || {};
                        aAll.push({
                            caseId: cd.caseId || aCases[idx].caseId,
                            eventTitle: cd.eventTitle || aCases[idx].eventTitle || "",
                            severity: cd.severity || aCases[idx].severity || "",
                            classification: cd.classification || "",
                            status: cd.status || aCases[idx].status || "",
                            suppliers: that._buildHierarchyTree(oH.suppliers || [], oH.purchaseOrders || [], oH.materials || [], cd),
                            _expanded: true
                        });
                    });
                    oCaseH.setProperty("/allCasesTree", aAll);
                    oCaseH.setProperty("/allCasesBusy", false);
                });
            }).catch(function (oErr) {
                console.error("[CaseDashboard] Load all cases failed:", oErr);
                oCaseH.setProperty("/allCasesBusy", false);
            });
        },

        /**
         * Programmatically switch the side-navigation to a given key.
         * Mirrors what onNavSelect does when the user clicks the nav,
         * so the rest of the app (agent sub-tabs, case list) reacts
         * consistently regardless of what triggered the switch.
         */
        _selectSideNav: function (sKey) {
            var oDashboard = this.getView().getModel("dashboard");
            if (!oDashboard || !sKey) { return; }

            oDashboard.setProperty("/selectedView", sKey);
            oDashboard.setProperty("/selectedSteps", oDashboard.getProperty("/workspaces/" + sKey + "/steps") || []);
            oDashboard.setProperty("/selectedWorkspace",
                oDashboard.getProperty("/workspaces/" + sKey) || oDashboard.getProperty("/workspaces/control"));

            var oDashView   = this.byId("dashboardView");
            var oRaView     = this.byId("riskAssessmentView");
            var oSpView     = this.byId("survivalPlanningView");
            var oCdView     = this.byId("caseDashboardView");
            var oRecView    = this.byId("recommendationsView");
            var oExecView   = this.byId("executionView");
            var oMonView    = this.byId("monitoringView");
            if (oDashView)  { oDashView.setVisible(sKey === "control"); }
            if (oRaView)    { oRaView.setVisible(sKey === "riskAssessment"); }
            if (oSpView)    { oSpView.setVisible(sKey === "survivalPlanning"); }
            if (oCdView)    { oCdView.setVisible(sKey === "caseDashboard"); }
            if (oRecView)   { oRecView.setVisible(sKey === "approvals"); }
            if (oExecView)  { oExecView.setVisible(sKey === "planning"); }
            if (oMonView)   { oMonView.setVisible(sKey === "audit"); }

            var sExistingCaseId = oDashboard.getProperty("/selectedCaseId");
            if (sKey === "caseDashboard" && sExistingCaseId) {
                this._loadCaseHierarchy(sExistingCaseId);
            }
        },
        /**
         * Reset the earlyWarningResult model to its clean initial state.
         * Called on error / failure to ensure no stale data persists.
         *
         * @param {sap.ui.model.json.JSONModel} oModel - the earlyWarningResult model
         * @param {string} [sError] - optional error message to store
         */
        _resetEarlyWarningModel: function (oModel, sError) {
            oModel.setProperty("/result", null);
            oModel.setProperty("/error", sError || null);
            oModel.setProperty("/caseId", null);
            oModel.setProperty("/status", null);
            oModel.setProperty("/totalSuppliers", 0);
            oModel.setProperty("/totalPOs", 0);
            oModel.setProperty("/dataSource", null);
            oModel.setProperty("/calculatedAt", null);
            oModel.setProperty("/suppliers", []);
            oModel.setProperty("/poDetails", []);
            oModel.setProperty("/summary", {
                totalPOs: 0, deliveredPOs: 0, overduePOs: 0, onTimePOs: 0,
                avgDelay: 0, totalOrdered: 0, totalDelivered: 0,
                maxRiskScore: 0, maxRiskLevel: null
            });
        },

        /**
         * Resolve the OData service URL relative to the component's manifest
         * so it is prefixed with the correct application base path at runtime.
         *
         *  - Local dev (ui5.yaml proxy):  "/odata/v4/supplier-resilience/"
         *  - BTP Launchpad:               "/<app-mount>/odata/v4/supplier-resilience/"
         *
         * Falls back to the absolute path if the component/manifest is
         * temporarily unavailable.
         */
        _getServiceUrl: function () {
            try {
                var oComponent = this.getOwnerComponent();
                if (oComponent && oComponent.getManifestObject) {
                    var oManifest = oComponent.getManifestObject();
                    if (oManifest && typeof oManifest.resolveUri === "function") {
                        // Use the mainService URI declared in manifest.json
                        // sap.app/dataSources/mainService/uri
                        var sDsUri = oComponent.getManifestEntry(
                            "/sap.app/dataSources/mainService/uri"
                        ) || "odata/v4/supplier-resilience/";
                        var sResolved = oManifest.resolveUri(sDsUri);
                        // Ensure trailing slash
                        if (sResolved && sResolved.charAt(sResolved.length - 1) !== "/") {
                            sResolved += "/";
                        }
                        return sResolved;
                    }
                }
            } catch (e) {
                console.warn("[Coordinator] Could not resolve service URL via manifest:", e);
            }
            return "/odata/v4/supplier-resilience/";
        },


        // ─────────────────────────────────────────────────────────────
        //  Disruptions – Supplier Resilience Agent Integration
        //  via supplier_resilience_agent destination (/analyze endpoint)
        // ─────────────────────────────────────────────────────────────

        /**
         * POST to the supplier_resilience_agent /analyze endpoint to assess
         * the impact of a disruption at a given location. Populates the
         * `disruptions` JSON model with affected suppliers and cross-references
         * the coordinator model to find affected POs.
         *
         * @param {string} sLocation - City name (e.g. "Mumbai")
         * @param {string} sImpactDescription - Category/type (e.g. "fire", "flood")
         */
        _analyzeDisruption: function (sLocation, sImpactDescription) {
            var oView = this.getView();
            var oDisruptions = oView.getModel("disruptions");
            var that = this;

            if (!oDisruptions) { return; }

            oDisruptions.setProperty("/busy", true);
            oDisruptions.setProperty("/hasResult", false);
            oDisruptions.setProperty("/scope", {
                poCount: 0, plantCount: 0, skuCount: 0, supplierCount: 0
            });

            // Call the CAP orchestrator analyzeImpact instead of hitting the
            // Python agent directly. CAP fans out Get_supplier → Python
            // /analyze → GET_SupplierDetails in a single round-trip.
            var sServiceUrl = this._getServiceUrl();
            var nRadius = 500;
            var sUrl = sServiceUrl +
                "analyzeImpact(" +
                "location='"           + encodeURIComponent(sLocation)          + "'," +
                "impact_description='" + encodeURIComponent(sImpactDescription) + "'," +
                "assessment_radius_km=" + encodeURIComponent(nRadius) +
                ")";

            console.log("[Disruptions] GET", sUrl);

            fetch(sUrl, {
                method: "GET",
                headers: { "Accept": "application/json" },
                credentials: "include"
            }).then(function (oResp) {
                if (!oResp.ok) {
                    return oResp.text().then(function (sBody) {
                        throw new Error("HTTP " + oResp.status + " " + oResp.statusText +
                            (sBody ? (": " + sBody.substring(0, 300)) : ""));
                    });
                }
                return oResp.json();
            }).then(function (oData) {
                console.log("[Disruptions] analyzeImpact response:", oData);

                var oResult = oData || {};

                // Store the full response
                oDisruptions.setProperty("/result", oResult);
                oDisruptions.setProperty("/hasResult", oResult.success !== false);
                oDisruptions.setProperty("/busy", false);

                // Compute the impact-scope metrics (PO count, plants, SKUs)
                // from the enriched response for the top-row cards.
                var oScope = that._computeDisruptionScope(oResult);
                oDisruptions.setProperty("/scope", oScope);

                if (oResult.success === false) {
                    oDisruptions.setProperty("/aiRiskState", "initial");
                    MessageToast.show("Disruption analysis failed: " +
                        (oResult.error || "Unknown error"));
                } else {
                    // Build the Impact Preview data from the API response.
                    var oSelectedRisk = oDisruptions.getProperty("/selectedRisk") || {};
                    var aAffSuppliers = Array.isArray(oResult.affected_suppliers)
                        ? oResult.affected_suppliers : [];

                    // Collect plant names and SKU names from all affected suppliers
                    var aPlantNames = [];
                    var aSkuNames = [];
                    aAffSuppliers.forEach(function (s) {
                        var aPOs = Array.isArray(s.purchase_orders) ? s.purchase_orders : [];
                        aPOs.forEach(function (po) {
                            var aMats = Array.isArray(po.materials) ? po.materials : [];
                            aMats.forEach(function (m) {
                                if (m.plant && aPlantNames.indexOf(m.plant) === -1) { aPlantNames.push(m.plant); }
                                if (m.sku   && aSkuNames.indexOf(m.sku)     === -1) { aSkuNames.push(m.sku); }
                            });
                        });
                    });

                    // First affected supplier name (for the summary)
                    var sFirstSupplier = (aAffSuppliers.length > 0 && aAffSuppliers[0].name)
                        ? aAffSuppliers[0].name : "Unknown";

                    oDisruptions.setProperty("/impactPreview", {
                        impactType: (oSelectedRisk.title || oResult.impact_description || "Supply disruption"),
                        riskScore:  (oScope.supplierCount > 3 ? "92" : oScope.supplierCount > 1 ? "74" : "55") + "/100",
                        estimatedImpact: "$" + (oScope.poCount * 0.6 || 0).toFixed(1) + "M",
                        supplierName: sFirstSupplier +
                            (aAffSuppliers.length > 1 ? " (+" + (aAffSuppliers.length - 1) + " more)" : ""),
                        posAtRisk:  oScope.poCount + " at risk",
                        plants:     aPlantNames.join(", ") || "—",
                        skus:       aSkuNames.join(", ")   || "—"
                    });
                    oDisruptions.setProperty("/aiRiskState", "impactPreview");

                    MessageToast.show("Disruption analysis complete: " +
                        (oResult.affected_supplier_count || 0) + " supplier(s) affected, " +
                        oScope.poCount + " PO(s) at risk");
                }
            }).catch(function (oErr) {
                console.error("[Disruptions] analyzeImpact failed:", oErr);
                oDisruptions.setProperty("/result", null);
                oDisruptions.setProperty("/hasResult", false);
                oDisruptions.setProperty("/affectedPOs", []);
                oDisruptions.setProperty("/scope", {
                    poCount: 0, plantCount: 0, skuCount: 0, supplierCount: 0
                });
                oDisruptions.setProperty("/busy", false);
                oDisruptions.setProperty("/aiRiskState", "initial");
                oDisruptions.setProperty("/impactPreview", null);
                MessageToast.show("Disruption analysis failed: " +
                    (oErr && oErr.message ? oErr.message : "Unknown error"));
            });
        },

        /**
         * Compute impact-scope metrics from the enriched analyzeImpact
         * response so the top-row cards in the DisruptionsView can bind to
         * concrete numbers instead of being cosmetically empty.
         *
         * @param {Object} oResult - analyzeImpact response payload
         * @returns {Object} { poCount, plantCount, skuCount, supplierCount }
         */
        _computeDisruptionScope: function (oResult) {
            var aSuppliers = (oResult && Array.isArray(oResult.affected_suppliers))
                ? oResult.affected_suppliers : [];
            var iSupplierCount = aSuppliers.length;
            var iPoCount = 0;
            var oPlantSet = {};
            var oSkuSet = {};
            aSuppliers.forEach(function (s) {
                var aPOs = Array.isArray(s.purchase_orders) ? s.purchase_orders : [];
                iPoCount += aPOs.length;
                aPOs.forEach(function (po) {
                    var aMats = Array.isArray(po.materials) ? po.materials : [];
                    aMats.forEach(function (m) {
                        if (m.plant) { oPlantSet[m.plant] = true; }
                        if (m.sku)   { oSkuSet[m.sku]     = true; }
                    });
                });
            });
            return {
                supplierCount: iSupplierCount,
                poCount:       iPoCount,
                plantCount:    Object.keys(oPlantSet).length,
                skuCount:      Object.keys(oSkuSet).length
            };
        },
        // ─────────────────────────────────────────────────────────────
        //  Global Risks – Anthropic Claude 4.5 Opus LLM Integration
        //  via AI_CORE_CGAI_COCKPIT_SRA destination using Orchestration
        //  Model: anthropic--claude-4.5-opus (via orchestration endpoint)
        // ─────────────────────────────────────────────────────────────

        /**
         * Refresh button handler for the Global Risks card.
         * Re-fetches live risks from the Anthropic Claude 4.5 Opus LLM.
         */
        onRefreshGlobalRisks: function () {
            this._loadGlobalRisksFromAI();
        },

        /**
         * Handler for the region Select dropdown change event on the
         * Global Risks card. Updates the selected region in the dashboard
         * model and re-fetches risks from the AI for the new region.
         */
        onRegionChange: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (!oSelectedItem) { return; }
            var sRegion = oSelectedItem.getKey();
            var oGlobalRisks = this.getView().getModel("globalRisks");
            if (oGlobalRisks) {
                oGlobalRisks.setProperty("/selectedRegion", sRegion);
            }
            console.log("[GlobalRisks] Region changed to:", sRegion);
            this._loadGlobalRisksFromAI();
        },

        /**
         * Build the dynamic prompt (system + user messages) for the Global
         * Risks AI call based on the selected region. Encapsulates all
         * prompt engineering logic in one modular method.
         *
         * @param {string} sRegion - The selected region (e.g. "India", "China")
         * @returns {Object} { system: string, user: string }
         */
        _buildGlobalRisksPrompt: function (sRegion) {
            var sToday = new Date().toISOString().split("T")[0];

            var sSystemMessage = "You are a global supply chain intelligence analyst with access to real-time news and event data.";

            var sUserMessage = "Today's date is " + sToday + ". " +
                "Provide exactly 5 of the most critical real-world global supply chain disruption events " +
                "that are currently happening or have happened very recently in or significantly affecting the " + sRegion + " region. " +
                "All 5 events MUST be directly related to or impacting " + sRegion + " " +
                "(e.g., port congestion, natural disasters, labor strikes, policy changes, cyberattacks, factory incidents, trade disruptions in " + sRegion + "). " +
                "These should be actual events like natural disasters (floods, earthquakes, typhoons), geopolitical conflicts, trade policy changes (tariffs, sanctions), " +
                "port/shipping disruptions, factory fires, labor strikes, cyberattacks on logistics, or commodity price shocks that impact supply chains in " + sRegion + ".\n\n" +
                "For each event, return a JSON object with these exact fields:\n" +
                "- \"title\": A concise headline (maximum 60 characters)\n" +
                "- \"description\": One sentence describing the supply chain impact (maximum 120 characters)\n" +
                "- \"riskLevel\": Exactly one of: \"Critical\", \"High\", \"Medium\", or \"Low\"\n" +
                "- \"region\": A specific location in the format \"City, State, Country\" within " + sRegion + ". Always include city and country; include state/province where applicable.\n" +
                "- \"time\": Approximate recency as a relative time string (e.g., \"2h ago\", \"6h ago\", \"1d ago\", \"2d ago\")\n" +
                "- \"category\": Exactly one of: \"tariff\", \"fire\", \"flood\", \"shipping\", \"commodity\", \"earthquake\", \"strike\", \"cyberattack\", \"geopolitical\"\n\n" +
                "IMPORTANT: Return ONLY a valid JSON array of exactly 5 objects. No markdown formatting, no code fences, no explanation text — just the raw JSON array.";

            return {
                system: sSystemMessage,
                user: sUserMessage
            };
        },

        /**
         * Main orchestrator: calls Anthropic Claude 4.5 Opus via AI Core
         * Orchestration to get top 5 global supply chain risks.
         * Populates dashboard>/globalRisks on success.
         *
         * Uses orchestration endpoint with model anthropic--claude-4.5-opus
         * via the AI_CORE_CGAI_COCKPIT_SRA destination.
         *
         * Called once on onInit and on manual refresh.
         */
        _loadGlobalRisksFromAI: function () {
            var oView = this.getView();
            var that = this;

            // Set busy state while loading
            var setGlobalRisksBusy = function (bBusy) {
                var oDash = oView.getModel("dashboard");
                if (oDash) {
                    oDash.setProperty("/globalRisksBusy", bBusy);
                } else {
                    // Dashboard model may not be ready yet; retry
                    setTimeout(function () {
                        var oDash2 = oView.getModel("dashboard");
                        if (oDash2) { oDash2.setProperty("/globalRisksBusy", bBusy); }
                    }, 500);
                }
            };

            setGlobalRisksBusy(true);
            console.log("[GlobalRisks] Starting AI-powered global risks fetch via Claude 4.5 Opus...");

            // Call the Anthropic Claude 4.5 Opus deployment directly
            this._callClaudeForRisks().then(function (aRisks) {
                console.log("[GlobalRisks] LLM returned risks:", aRisks);

                // Map LLM response to UI model format
                var aMappedRisks = that._mapLLMResponseToRisks(aRisks);
                console.log("[GlobalRisks] Mapped risks for UI:", aMappedRisks);

                // Set the data on the dashboard model
                var applyRisks = function () {
                    var oDash = oView.getModel("dashboard");
                    if (!oDash) {
                        setTimeout(applyRisks, 200);
                        return;
                    }
                    oDash.setProperty("/globalRisks", aMappedRisks);
                    oDash.setProperty("/globalRisksBusy", false);
                };
                applyRisks();

                MessageToast.show("Global risks updated from AI");
            }).catch(function (oErr) {
                console.error("[GlobalRisks] Failed to load AI risks:", oErr);
                setGlobalRisksBusy(false);
                MessageToast.show("AI risk fetch failed: " + (oErr.message || "Unknown error"));
            });
        },

        /**
         * Call Anthropic Claude 4.5 Opus via SAP AI Core Orchestration endpoint.
         *
         * Uses the orchestration pattern:
         * 1. First fetches the orchestration deployment ID from /lm/deployments
         * 2. Then calls /deployments/{orchestrationId}/completion with orchestration payload
         *
         * @returns {Promise<Array>} Array of risk objects from LLM
         */
        _callClaudeForRisks: function () {
            var that = this;
            var sModelName = "anthropic--claude-4.5-opus";
            // Use empty basePath - xs-app.json routes are relative to app root
            var sBasePath = "";

            // Read the currently selected region from the globalRisks model
            var oGlobalRisks = this.getView().getModel("globalRisks");
            var sRegion = (oGlobalRisks && oGlobalRisks.getProperty("/selectedRegion")) || "India";

            // Build dynamic prompt based on selected region (modular helper)
            var oPrompt = this._buildGlobalRisksPrompt(sRegion);
            var sSystemMessage = oPrompt.system;
            var sUserMessage = oPrompt.user;

            console.log("[GlobalRisks] Starting orchestration call for model:", sModelName, "| Region:", sRegion);

            // Step 1: Get orchestration deployment ID
            return this._getOrchestrationDeploymentId(sBasePath).then(function (sDeploymentId) {
                if (!sDeploymentId) {
                    throw new Error("Orchestration deployment not found or not running");
                }

                console.log("[GlobalRisks] Using orchestration deployment ID:", sDeploymentId);

                // Step 2: Build orchestration payload
                var oPayload = {
                    orchestration_config: {
                        stream: false,
                        module_configurations: {
                            llm_module_config: {
                                model_name: sModelName,
                                model_params: {
                                    max_tokens: 2000,
                                    temperature: 0.3
                                }
                            },
                            templating_module_config: {
                                template: [
                                    { role: "system", content: "{{?system_message}}" },
                                    { role: "user", content: "{{?user_message}}" }
                                ]
                            }
                        }
                    },
                    input_params: {
                        system_message: sSystemMessage,
                        user_message: sUserMessage
                    }
                };

                // Use relative URL (no leading slash) for managed approuter compatibility
                var sUrl = "deployments/" + sDeploymentId + "/completion";
                console.log("[GlobalRisks] Calling orchestration endpoint:", sUrl);

                // Step 3: Make the orchestration call
                return fetch(sUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "AI-Resource-Group": "default"
                    },
                    credentials: "same-origin",
                    body: JSON.stringify(oPayload)
                });
            }).then(function (response) {
                if (!response.ok) {
                    return response.text().then(function (sBody) {
                        console.error("[GlobalRisks] LLM call failed. Status:", response.status, "Body:", sBody.substring(0, 500));
                        throw new Error("LLM API Error: " + response.status + " " + response.statusText);
                    });
                }
                return response.json();
            }).then(function (data) {
                console.log("[GlobalRisks] Orchestration raw response:", data);

                // Extract content from orchestration response (primary format)
                var sContent = "";
                if (data && data.orchestration_result && data.orchestration_result.choices) {
                    var choices = data.orchestration_result.choices;
                    if (choices.length > 0 && choices[0].message) {
                        sContent = choices[0].message.content || "";
                    }
                } else if (data && data.choices && data.choices.length > 0) {
                    // Fallback to standard chat completions format
                    sContent = data.choices[0].message
                        ? data.choices[0].message.content || ""
                        : (data.choices[0].text || "");
                } else if (data && data.content && typeof data.content === "string") {
                    sContent = data.content;
                }

                if (!sContent) {
                    console.error("[GlobalRisks] Could not extract content from response:", JSON.stringify(data).substring(0, 500));
                    throw new Error("Empty response from LLM");
                }

                console.log("[GlobalRisks] Extracted LLM content:", sContent.substring(0, 300));

                // Parse the JSON from the LLM response
                // Strip any markdown code fences if present
                sContent = sContent.trim();
                if (sContent.startsWith("```")) {
                    sContent = sContent.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
                }

                var aRisks;
                try {
                    aRisks = JSON.parse(sContent);
                } catch (e) {
                    console.error("[GlobalRisks] Failed to parse LLM JSON:", e, "Content:", sContent.substring(0, 500));
                    throw new Error("LLM returned invalid JSON");
                }

                if (!Array.isArray(aRisks)) {
                    throw new Error("LLM response is not an array");
                }

                return aRisks;
            });
        },

        /**
         * Get the orchestration deployment ID from AI Core.
         * Caches the deployment ID for subsequent calls.
         *
         * @param {string} sBasePath - Base path for API calls
         * @returns {Promise<string|null>} Orchestration deployment ID or null
         */
        _getOrchestrationDeploymentId: function (sBasePath) {
            var that = this;

            // Return cached deployment ID if available
            if (this._sOrchestrationDeploymentId) {
                return Promise.resolve(this._sOrchestrationDeploymentId);
            }

            // Return existing promise if already fetching
            if (this._oOrchestrationDeploymentIdPromise) {
                return this._oOrchestrationDeploymentIdPromise;
            }

            // Use relative URL (no leading slash) for managed approuter compatibility
            // Filter by scenarioId and status to avoid 500 errors from unfiltered bulk queries
            var sUrl = "lm/deployments?scenarioId=orchestration&status=RUNNING&$top=1";
            console.log("[GlobalRisks] Fetching orchestration deployments from:", sUrl);

            this._oOrchestrationDeploymentIdPromise = fetch(sUrl, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "AI-Resource-Group": "default"
                },
                credentials: "same-origin"
            })
            .then(function (response) {
                console.log("[GlobalRisks] Deployments response status:", response.status);
                if (!response.ok) {
                    return response.text().then(function (errorBody) {
                        console.error("[GlobalRisks] Deployments fetch failed. Status:", response.status, "Body:", errorBody);
                        throw new Error("Failed to fetch deployments: " + response.status + " - " + errorBody);
                    });
                }
                return response.json();
            })
            .then(function (data) {
                console.log("[GlobalRisks] Deployments response:", data);

                // Find a running orchestration deployment
                var deployment = (data.resources || []).find(function (item) {
                    return item.scenarioId === "orchestration" && item.status === "RUNNING";
                });

                // Fallback: look for configurationName containing "orchestration"
                if (!deployment) {
                    deployment = (data.resources || []).find(function (item) {
                        return (item.configurationName || "").toLowerCase().includes("orchestration") &&
                               item.status === "RUNNING";
                    });
                }

                if (deployment && deployment.id) {
                    that._sOrchestrationDeploymentId = deployment.id;
                    console.log("[GlobalRisks] Found orchestration deployment:", deployment.id, deployment.configurationName);
                } else {
                    console.warn("[GlobalRisks] No running orchestration deployment found");
                }

                return that._sOrchestrationDeploymentId;
            })
            .catch(function (error) {
                console.error("[GlobalRisks] Failed to fetch orchestration deployment ID:", error);
                that._oOrchestrationDeploymentIdPromise = null;
                return null;
            });

            return this._oOrchestrationDeploymentIdPromise;
        },

        /**
         * Map raw LLM risk objects to the UI model format expected by
         * GlobalRisksCard.fragment.xml. Adds icon, CSS class mappings
         * based on category and riskLevel.
         *
         * @param {Array} aRisks - Raw risk objects from LLM
         * @returns {Array} Mapped risk objects with UI properties
         */
        _mapLLMResponseToRisks: function (aRisks) {
            if (!Array.isArray(aRisks)) { return []; }

            // Icon mapping by category
            var mCategoryIcon = {
                "tariff":       "sap-icon://warning",
                "fire":         "sap-icon://alert",
                "flood":        "sap-icon://cloud",
                "shipping":     "sap-icon://shipping-status",
                "commodity":    "sap-icon://bar-chart",
                "earthquake":   "sap-icon://alert",
                "strike":       "sap-icon://employee",
                "cyberattack":  "sap-icon://locked",
                "geopolitical": "sap-icon://world"
            };

            // Color mapping by risk level
            var mRiskLevelColor = {
                "Critical": "red",
                "High":     "amber",
                "Medium":   "blue"
            };

            // Badge class mapping by risk level
            var mBadgeClass = {
                "Critical": "riskCritical",
                "High":     "riskHigh",
                "Medium":   "riskMedium",
                "Low":      "riskLow"
            };

            return aRisks.map(function (oRisk, iIndex) {
                var sCategory = (oRisk.category || "geopolitical").toLowerCase();
                var sRiskLevel = oRisk.riskLevel || "Medium";
                var sColor = mRiskLevelColor[sRiskLevel] || "blue";
                var sIcon = mCategoryIcon[sCategory] || "sap-icon://warning";

                return {
                    id: "AI_R" + (iIndex + 1),
                    title: oRisk.title || "Unknown Risk",
                    description: oRisk.description || "",
                    icon: sIcon,
                    iconColor: sColor,
                    titleColor: sColor,
                    iconWrapClass: "ctRiskIconWrap ctRiskIconWrap-" + sColor,
                    iconClass: "ctRiskIcon ctRiskIcon-" + sColor,
                    titleClass: "ctRiskTitle ctRiskTitle-" + sColor,
                    badgeClass: mBadgeClass[sRiskLevel] || "riskMedium",
                    riskLevel: sRiskLevel,
                    severityClass: "ctBadge-" + sRiskLevel.toLowerCase(),
                    region: oRisk.region || "Global",
                    time: oRisk.time || "recently",
                    category: sCategory
                };
            });
        }
    });
});
