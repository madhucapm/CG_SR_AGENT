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
                allCasesBusy: false,
                availableCases: [],
                availableCasesBusy: false
            });
            this.getView().setModel(oCaseHierarchyModel, "caseHierarchy");

            // Load available cases for the case dropdowns on
            // Case Dashboard, Risk Assessment, and Survival Planning.
            this._loadAvailableCases();

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

            // Agent Disruptions JSON model — drives the Disruptions screen
            // with per-agent execution state, results, and case details.
            var oAgentDisruptionsModel = new JSONModel({
                selectedCaseId: "",
                caseData: null,
                agents: {
                    earlyWarning:    { status: "notRun", busy: false, result: null, error: null, formattedResult: "", statusText: "Not Run", statusClass: "adAgentStatusValue" },
                    coordinator:     { status: "notRun", busy: false, result: null, error: null, formattedResult: "", statusText: "Not Run", statusClass: "adAgentStatusValue" },
                    survivalPlanner: { status: "notRun", busy: false, result: null, error: null, formattedResult: "", statusText: "Not Run", statusClass: "adAgentStatusValue" },
                    substitution:    { status: "notRun", busy: false, result: null, error: null, formattedResult: "", statusText: "Not Run", statusClass: "adAgentStatusValue" },
                    buyer:           { status: "notRun", busy: false, result: null, error: null, formattedResult: "", statusText: "Not Run", statusClass: "adAgentStatusValue" }
                }
            });
            this.getView().setModel(oAgentDisruptionsModel, "agentDisruptions");

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

            // Build severity from impact data. Classification is intentionally
            // NOT forwarded to the backend: per product requirement the
            // disruption classification (Delayed Supply / Tariff / Complete
            // Interruption / Partial Interruption) is a news-item concept
            // shown only on the Global Risks card, and must never travel
            // down to the Case / Supplier / PO / SKU hierarchy.
            var oScope = oDisruptions.getProperty("/scope") || {};
            var iRiskScoreRaw = oImpact.riskScore || "0";
            var iRiskScore = parseInt(String(iRiskScoreRaw).replace(/[^0-9]/g, ""), 10) || 0;
            var sSeverity = iRiskScore >= 80 ? "CRITICAL" : iRiskScore >= 60 ? "HIGH" : iRiskScore >= 40 ? "MEDIUM" : "LOW";

            var oPayload = {
                eventTitle: oImpact.impactType || (oSelectedRisk && oSelectedRisk.title) || "",
                eventDescription: (oSelectedRisk && oSelectedRisk.description) || oResult.impact_description || "",
                severity: sSeverity,
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

                // Refresh the available cases list so the new case appears
                // in the Case Dashboard / Risk Assessment / Survival Planning dropdowns.
                that._loadAvailableCases();

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
            this._enableDisruptionsAndNavigate("Early Warning");
        },

        /**
         * Original Early Warning Agent implementation that calls the
         * runEarlyWarningWithS4R CAP action. Now invoked from the
         * Disruptions screen instead of the Case Dashboard Run button.
         */
        _executeEarlyWarningFromCaseDashboard: function () {
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

        /** Run Coordinator Agent — enable Disruptions and navigate. */
        onRunCoordinatorAgent: function () {
            this._enableDisruptionsAndNavigate("Coordinator");
        },

        /** Run Survival Planner Agent — enable Disruptions and navigate. */
        onRunSurvivalPlannerAgent: function () {
            this._enableDisruptionsAndNavigate("Survival Planner");
        },

        /** Run Substitution Agent — enable Disruptions and navigate. */
        onRunSubstitutionAgent: function () {
            this._enableDisruptionsAndNavigate("Substitution");
        },

        /** Run Buyer Agent — enable Disruptions and navigate. */
        onRunBuyerAgent: function () {
            this._enableDisruptionsAndNavigate("Buyer");
        },

        /** Run All Agents — enable Disruptions and navigate. */
        onRunAllAgents: function () {
            this._enableDisruptionsAndNavigate("All Agents");
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
            var oAdView     = this.byId("agentDisruptionsView");
            if (oDashView)  { oDashView.setVisible(sKey === "control"); }
            if (oRaView)    { oRaView.setVisible(sKey === "riskAssessment"); }
            if (oSpView)    { oSpView.setVisible(sKey === "survivalPlanning"); }
            if (oCdView)    { oCdView.setVisible(sKey === "caseDashboard"); }
            if (oRecView)   { oRecView.setVisible(sKey === "approvals"); }
            if (oExecView)  { oExecView.setVisible(sKey === "planning"); }
            if (oMonView)   { oMonView.setVisible(sKey === "audit"); }
            if (oAdView)    { oAdView.setVisible(sKey === "agentDisruptions"); }

            // Refresh the case dropdown list when entering a screen that has it
            if (sKey === "caseDashboard" || sKey === "riskAssessment" || sKey === "survivalPlanning" || sKey === "agentDisruptions") {
                this._loadAvailableCases();
            }

            var sExistingCaseId = oDashboard.getProperty("/selectedCaseId");
            if (sKey === "caseDashboard" && sExistingCaseId) {
                this._loadCaseHierarchy(sExistingCaseId);
            }
            if (sKey === "riskAssessment" && sExistingCaseId) {
                this._loadCaseDataForRiskAssessment(sExistingCaseId);
            }
            if (sKey === "survivalPlanning" && sExistingCaseId) {
                this._loadCaseDataForSurvivalPlanning(sExistingCaseId);
            }
            if (sKey === "agentDisruptions" && sExistingCaseId) {
                this._loadCaseDataForAgentDisruptions(sExistingCaseId);
            }
        },

        // ═══════════════════════════════════════════════════════════════
        // AGENT DISRUPTIONS — Enable / Navigate / Execute
        // ═══════════════════════════════════════════════════════════════

        /**
         * Called by every Case Dashboard agent Run button.
         * Validates case, enables Disruptions nav, navigates.
         * @param {string} sAgentLabel - Friendly name for the toast.
         */
        _enableDisruptionsAndNavigate: function (sAgentLabel) {
            var oView = this.getView();
            var oDashboard = oView.getModel("dashboard");
            var sCaseId = oDashboard.getProperty("/selectedCaseId");
            if (!sCaseId) {
                MessageToast.show("No case selected. Please select a case first.");
                return;
            }
            oDashboard.setProperty("/disruptionsEnabled", true);
            var oAdModel = oView.getModel("agentDisruptions");
            oAdModel.setProperty("/selectedCaseId", sCaseId);
            MessageToast.show(sAgentLabel + " — Navigating to Disruptions for " + sCaseId);
            this._selectSideNav("agentDisruptions");
        },

        /**
         * Load case data for the Agent Disruptions screen via
         * getCaseHierarchy. Resets agent results on new case.
         * @param {string} sCaseId - The case identifier.
         */
        _loadCaseDataForAgentDisruptions: function (sCaseId) {
            var oAdModel = this.getView().getModel("agentDisruptions");
            if (!oAdModel || !sCaseId) { return; }
            oAdModel.setProperty("/selectedCaseId", sCaseId);
            this._resetAllAgentDisruptionCards();

            fetch(this._getServiceUrl() + "getCaseHierarchy(caseId='" + encodeURIComponent(sCaseId) + "')", {
                method: "GET", headers: { "Accept": "application/json" }, credentials: "include"
            }).then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                return r.json();
            }).then(function (oData) {
                if (oData && oData.success !== false) {
                    oAdModel.setProperty("/caseData", oData.caseData || null);
                } else {
                    oAdModel.setProperty("/caseData", null);
                }
            }).catch(function (oErr) {
                console.error("[AgentDisruptions] Load case failed:", oErr);
                oAdModel.setProperty("/caseData", null);
            });
        },

        /** Reset all five agent cards to their initial Not Run state. */
        _resetAllAgentDisruptionCards: function () {
            var oAdModel = this.getView().getModel("agentDisruptions");
            if (!oAdModel) { return; }
            ["earlyWarning", "coordinator", "survivalPlanner", "substitution", "buyer"].forEach(function (sKey) {
                oAdModel.setProperty("/agents/" + sKey, {
                    status: "notRun", busy: false, result: null, error: null,
                    formattedResult: "", statusText: "Not Run", statusClass: "adAgentStatusValue"
                });
            });
        },

        /** Handle case dropdown change on Agent Disruptions screen. */
        onAgentDisruptionsCaseChange: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) { return; }
            var sCaseId = oItem.getKey();
            var oAdModel = this.getView().getModel("agentDisruptions");
            var oDashboard = this.getView().getModel("dashboard");
            oAdModel.setProperty("/selectedCaseId", sCaseId);
            oAdModel.setProperty("/caseData", null);
            if (oDashboard) { oDashboard.setProperty("/selectedCaseId", sCaseId); }
            this._resetAllAgentDisruptionCards();
            this._loadCaseDataForAgentDisruptions(sCaseId);
        },

        /** Disruptions Run handlers — thin wrappers. */
        onRunDisruptionEarlyWarning:    function () { this._runDisruptionAgent("earlyWarning"); },
        onRunDisruptionCoordinator:     function () { this._runDisruptionAgent("coordinator"); },
        onRunDisruptionSurvivalPlanner: function () { this._runDisruptionAgent("survivalPlanner"); },
        onRunDisruptionSubstitution:    function () { this._runDisruptionAgent("substitution"); },
        onRunDisruptionBuyer:           function () { this._runDisruptionAgent("buyer"); },

        /**
         * Generic agent execution for the Disruptions screen.
         * @param {string} sAgentKey - Agent key.
         */
        _runDisruptionAgent: function (sAgentKey) {
            var that = this, oAdModel = this.getView().getModel("agentDisruptions");
            var sCaseId = oAdModel.getProperty("/selectedCaseId");
            var oCaseData = oAdModel.getProperty("/caseData");
            if (!sCaseId || !oCaseData) { MessageToast.show("No case selected."); return; }
            var mCfg = {
                earlyWarning:    { action: "runEarlyWarning",  label: "Early Warning",    payload: { caseId: sCaseId, supplier: "", material: "", plant: "", delayDays: 0 } },
                coordinator:     { action: "runCoordinator",   label: "Coordinator",      payload: { eventId: oCaseData.eventId || sCaseId, eventType: oCaseData.eventType || "DISRUPTION", eventTime: new Date().toISOString(), po: "", supplier: "", material: "", plant: "", delayDays: 0 } },
                survivalPlanner: { action: "runSurvival",      label: "Survival Planner", payload: { caseId: sCaseId, material: "", plant: "", supplierRecoveryWeeks: 4 } },
                substitution:    { action: "runSubstitution",  label: "Substitution",     payload: { caseId: sCaseId } },
                buyer:           { action: "runBuyer",         label: "Buyer",            payload: { caseId: sCaseId } }
            };
            var oC = mCfg[sAgentKey]; if (!oC) { return; }
            var sP = "/agents/" + sAgentKey;
            oAdModel.setProperty(sP + "/busy", true);
            oAdModel.setProperty(sP + "/status", "running");
            oAdModel.setProperty(sP + "/statusText", "⏳ Running...");
            oAdModel.setProperty(sP + "/statusClass", "adAgentStatusValue adAgentStatusValue--running");
            oAdModel.setProperty(sP + "/error", null);
            oAdModel.setProperty(sP + "/formattedResult", "");
            MessageToast.show("Running " + oC.label + " for " + sCaseId + "…");
            fetch(this._getServiceUrl() + oC.action, {
                method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
                credentials: "include", body: JSON.stringify(oC.payload)
            }).then(function (r) {
                if (!r.ok) { return r.text().then(function (b) { throw new Error("HTTP " + r.status + (b ? ": " + b.substring(0,500) : "")); }); }
                return r.json();
            }).then(function (oData) {
                oAdModel.setProperty(sP + "/busy", false);
                oAdModel.setProperty(sP + "/result", oData);
                oAdModel.setProperty(sP + "/status", "completed");
                oAdModel.setProperty(sP + "/statusText", "✓ Completed");
                oAdModel.setProperty(sP + "/statusClass", "adAgentStatusValue adAgentStatusValue--success");
                oAdModel.setProperty(sP + "/formattedResult", that._formatAgentResponse(oData));
                MessageToast.show(oC.label + " completed.");
            }).catch(function (oErr) {
                oAdModel.setProperty(sP + "/busy", false);
                oAdModel.setProperty(sP + "/status", "failed");
                oAdModel.setProperty(sP + "/statusText", "✕ Failed");
                oAdModel.setProperty(sP + "/statusClass", "adAgentStatusValue adAgentStatusValue--error");
                oAdModel.setProperty(sP + "/error", oErr.message || "Unknown error");
                oAdModel.setProperty(sP + "/formattedResult", "");
                MessageToast.show(oC.label + " error: " + (oErr.message || "Unknown error"));
            });
        },

        /** Escape HTML special characters. */
        _escapeHtml: function (s) {
            if (!s) return "";
            return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
        },

        /** Format agent API response into readable HTML. */
        _formatAgentResponse: function (oData) {
            if (!oData) { return "<div class='adResponseEmpty'>No data.</div>"; }
            var that = this, aL = [];
            var mL = { success:"Success", status:"Status", caseId:"Case ID",
                riskScore:"Risk Score", riskLevel:"Risk Level", priority:"Priority",
                recommendation:"Recommendation", agent:"Agent",
                survivalWeeks:"Survival Weeks", coverageGapWeeks:"Coverage Gap",
                shortfallQuantity:"Shortfall", actionRequired:"Action Required",
                availableInventory:"Available Inventory", weeklyDemand:"Weekly Demand",
                supplierRecoveryWeeks:"Recovery Weeks", uncoveredWeeks:"Uncovered Weeks",
                supplierId:"Supplier ID", supplierName:"Supplier", supplierOtif:"OTIF",
                materialId:"Material", materialCriticality:"Criticality",
                dataSource:"Data Source", calculatedAt:"Calculated At",
                error:"Error" };
            Object.keys(oData).forEach(function (k) {
                var v = oData[k];
                if (v === null || v === undefined) return;
                if (k === "@odata.context" || k === "@odata.metadataEtag") return;
                var lb = mL[k] || k;
                if (typeof v === "object" && !Array.isArray(v)) {
                    aL.push("<div class='adRespSection'><strong>" + lb + "</strong></div>");
                    Object.keys(v).forEach(function (sk) {
                        if (v[sk] !== null && v[sk] !== undefined) {
                            aL.push("<div class='adRespRow'><span class='adRespKey'>" + (mL[sk]||sk) + ":</span> <span class='adRespVal'>" + that._escapeHtml(String(v[sk])) + "</span></div>");
                        }
                    });
                } else if (Array.isArray(v) && v.length > 0) {
                    aL.push("<div class='adRespRow'><span class='adRespKey'>" + lb + ":</span> <span class='adRespVal'>" + that._escapeHtml(v.join(", ")) + "</span></div>");
                } else if (!Array.isArray(v)) {
                    aL.push("<div class='adRespRow'><span class='adRespKey'>" + lb + ":</span> <span class='adRespVal'>" + that._escapeHtml(String(v)) + "</span></div>");
                }
            });
            return "<div class='adResponseWrap'>" + aL.join("") + "</div>";
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
                // from the enriched response for the top-row cards AND
                // write them back onto the news-feed item so its
                // "N POs · N Materials · N Plants" count line appears.
                var oScope = that._computeDisruptionScope(oResult);
                oDisruptions.setProperty("/scope", oScope);
                var oInvestigatedRisk = oDisruptions.getProperty("/selectedRisk");
                that._updateSelectedRiskCounts(oInvestigatedRisk, oScope);

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

                    // Populate the Early Warning Output metrics used by the
                    // AiAssistantCard IMPACT METRICS section. Previously this
                    // property was never set, leaving Suppliers / POs / Plants /
                    // SKUs empty even though the data was available in oScope.
                    oDisruptions.setProperty("/earlyWarningOutput", {
                        summary: oResult.message ||
                            ((oResult.affected_supplier_count || 0) + " supplier(s) found within " +
                             (oResult.assessment_radius_km || 500) + " km of the impact area."),
                        suppliers: oScope.supplierCount,
                        pos:       oScope.poCount,
                        plants:    oScope.plantCount,
                        skus:      oScope.skuCount
                    });

                    // Populate the classified disruption type shown in the
                    // AiAssistantCard "TYPE" row.
                    oDisruptions.setProperty("/classifiedType",
                        oSelectedRisk.classification ||
                        oResult.impact_description ||
                        "Supply Disruption");

                    // Write a summary sub-object onto /result so the
                    // DisruptionsView IMPACT SUMMARY panel can bind to
                    // disruptions>/result/summary/suppliers|pos|plants|skus.
                    oDisruptions.setProperty("/result/summary", {
                        suppliers: oScope.supplierCount,
                        pos:       oScope.poCount,
                        plants:    oScope.plantCount,
                        skus:      oScope.skuCount
                    });

                    // Populate Risk Assessment model + earlyWarningResult from live API data
                    that._populateRiskAssessmentFromImpact(oResult, oScope);

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
            var oMaterialSet = {};
            aSuppliers.forEach(function (s) {
                var aPOs = Array.isArray(s.purchase_orders) ? s.purchase_orders : [];
                iPoCount += aPOs.length;
                aPOs.forEach(function (po) {
                    var aMats = Array.isArray(po.materials) ? po.materials : [];
                    aMats.forEach(function (m) {
                        if (m.plant)    { oPlantSet[m.plant]        = true; }
                        if (m.sku)      { oSkuSet[m.sku]            = true; }
                        if (m.material) { oMaterialSet[m.material]  = true; }
                    });
                });
            });
            return {
                supplierCount: iSupplierCount,
                poCount:       iPoCount,
                plantCount:    Object.keys(oPlantSet).length,
                skuCount:      Object.keys(oSkuSet).length,
                // Distinct material master count. Fall back to SKU count if
                // the API didn't return `material` on the item level.
                materialCount: Object.keys(oMaterialSet).length || Object.keys(oSkuSet).length
            };
        },

        /**
         * After analyzeImpact returns real impact-scope data for the risk
         * the user just clicked, write those counts back onto that specific
         * news-feed item in dashboard>/globalRisks so its "N POs · N
         * Materials · N Plants" line becomes visible. Other news items
         * in the list stay unchanged (counts remain 0 → line hidden).
         *
         * @param {Object} oSelectedRisk - The risk the user investigated
         *                                 (already stored at disruptions>/selectedRisk)
         * @param {Object} oScope        - Output of _computeDisruptionScope
         */
        _updateSelectedRiskCounts: function (oSelectedRisk, oScope) {
            if (!oSelectedRisk || !oSelectedRisk.id) { return; }
            var oDashboard = this.getView().getModel("dashboard");
            if (!oDashboard) { return; }

            var aRisks = oDashboard.getProperty("/globalRisks") || [];
            var iFound = -1;
            for (var i = 0; i < aRisks.length; i++) {
                if (aRisks[i] && aRisks[i].id === oSelectedRisk.id) {
                    iFound = i;
                    break;
                }
            }
            if (iFound < 0) { return; }

            var sBasePath = "/globalRisks/" + iFound + "/";
            oDashboard.setProperty(sBasePath + "poCount",       oScope.poCount       || 0);
            oDashboard.setProperty(sBasePath + "materialCount", oScope.materialCount || 0);
            oDashboard.setProperty(sBasePath + "plantCount",    oScope.plantCount    || 0);
        },

        // ── Case Dropdown + Risk / Survival helpers ────────────────

        /** Fetch all cases from HANA for the case selector dropdowns. */
        _loadAvailableCases: function () {
            var oCH = this.getView().getModel("caseHierarchy");
            if (!oCH) return;
            oCH.setProperty("/availableCasesBusy", true);
            fetch(this._getServiceUrl() + "Cases?$orderby=createdAt desc", {
                method: "GET", headers: { "Accept": "application/json" }, credentials: "include"
            }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json();
            }).then(function (d) {
                oCH.setProperty("/availableCases", ((d && d.value) || []).map(function (c) {
                    return { caseId: c.caseId||"", eventTitle: c.eventTitle||"", severity: c.severity||"", status: c.status||"", riskScore: c.riskScore||0, region: c.region||"" };
                }));
                oCH.setProperty("/availableCasesBusy", false);
            }).catch(function () { oCH.setProperty("/availableCasesBusy", false); });
        },

        /** Shared handler for the Case dropdown on all three screens. */
        onCaseDropdownChange: function (oEvent) {
            var oI = oEvent.getParameter("selectedItem"); if (!oI) return;
            var sC = oI.getKey(), oD = this.getView().getModel("dashboard");
            if (oD) oD.setProperty("/selectedCaseId", sC);
            var sV = oD ? oD.getProperty("/selectedView") : "";
            if (sV === "caseDashboard") this._loadCaseHierarchy(sC);
            if (sV === "riskAssessment") this._loadCaseDataForRiskAssessment(sC);
            if (sV === "survivalPlanning") this._loadCaseDataForSurvivalPlanning(sC);
            MessageToast.show("Switched to case: " + sC);
        },

        /** Populate riskAssessment + earlyWarningResult from analyzeImpact. */
        _populateRiskAssessmentFromImpact: function (oResult, oScope) {
            var oRM=this.getView().getModel("riskAssessment"),oEW=this.getView().getModel("earlyWarningResult");
            if(!oRM||!oResult)return;
            var aAff=Array.isArray(oResult.affected_suppliers)?oResult.affected_suppliers:[];
            if(!aAff.length)return;
            var iMax=0,sMaxSup="";
            var aRows=aAff.map(function(s){
                var aPOs=Array.isArray(s.purchase_orders)?s.purchase_orders:[],pl=[],sk=[];
                aPOs.forEach(function(po){(Array.isArray(po.materials)?po.materials:[]).forEach(function(m){if(m.plant&&pl.indexOf(m.plant)===-1)pl.push(m.plant);if(m.sku&&sk.indexOf(m.sku)===-1)sk.push(m.sku);});});
                var d=s.distance_km||999,n=s.po_count||aPOs.length;
                var sc=d<50?90+Math.min(n,10):d<100?75+Math.min(n*2,15):d<200?60+Math.min(n*2,15):d<400?40+Math.min(n*3,20):20+Math.min(n*3,20);
                sc=Math.min(sc,100);if(sc>iMax){iMax=sc;sMaxSup=s.name||s.supplier_id||"";}
                var sev=sc>=80?"CRITICAL":sc>=60?"HIGH":sc>=40?"MEDIUM":"LOW";
                var cls=d<50?"COMPLETE INTERRUPTION":d<200?"DELAYED SUPPLY":"PARTIAL DISRUPTION";
                return{supplier:s.name||s.supplier_id||"Unknown",supplierId:s.supplier_id||"",classification:cls,riskScore:sc+"/100",riskScoreRaw:sc,severity:sev,posAtRisk:String(n),plants:pl.join(", ")||"—",skus:sk.join(", ")||"—"};
            });
            aRows.sort(function(a,b){return b.riskScoreRaw-a.riskScoreRaw;});
            oRM.setProperty("/kpi",{highestRisk:{value:String(iMax),supplier:sMaxSup},suppliersImpacted:{value:String(oScope.supplierCount),sub:"Affected by event"},posAtRisk:{value:String(oScope.poCount),sub:"At risk"},plants:{value:String(oScope.plantCount),sub:"Affected"}});
            oRM.setProperty("/supplierRisks",aRows);
            if(oEW){oEW.setProperty("/result",oResult);oEW.setProperty("/suppliers",aRows);oEW.setProperty("/totalSuppliers",aAff.length);oEW.setProperty("/totalPOs",oScope.poCount||0);oEW.setProperty("/summary/maxRiskScore",iMax);oEW.setProperty("/summary/maxRiskLevel",iMax>=80?"CRITICAL":iMax>=60?"HIGH":iMax>=40?"MEDIUM":"LOW");}
        },

        /** Load case data for Risk Assessment from getCaseHierarchy. */
        _loadCaseDataForRiskAssessment: function (sId) {
            var t=this;if(!sId)return;
            fetch(this._getServiceUrl()+"getCaseHierarchy(caseId='"+encodeURIComponent(sId)+"')",{method:"GET",headers:{"Accept":"application/json"},credentials:"include"}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}).then(function(d){if(d&&d.success!==false)t._populateRAFromHierarchy(d);}).catch(function(e){console.error("[RA] Load failed:",e);});
        },
        /** Populate riskAssessment model from getCaseHierarchy response. */
        _populateRAFromHierarchy: function (oH) {
            var oRM=this.getView().getModel("riskAssessment");if(!oRM)return;
            var cd=oH.caseData||{},aS=oH.suppliers||[],aPOs=oH.purchaseOrders||[],aM=oH.materials||[];
            var poBy={},matBy={};
            aPOs.forEach(function(p){var k=p.supplierId||"";if(!poBy[k])poBy[k]=[];poBy[k].push(p);});
            aM.forEach(function(m){var k=m.supplierId||"";if(!matBy[k])matBy[k]=[];matBy[k].push(m);});
            var iMax=cd.riskScore||0,sMax="",tPOs=0,pSet={};
            var aRows=aS.map(function(s){var sid=s.supplierId||"",sp=poBy[sid]||[],sm=matBy[sid]||[];var pl=[],sk=[];
                sm.forEach(function(m){if(m.plant&&pl.indexOf(m.plant)===-1){pl.push(m.plant);pSet[m.plant]=1;}if(m.sku&&sk.indexOf(m.sku)===-1)sk.push(m.sku);});
                var n=s.poCount||sp.length;tPOs+=n;var sc=cd.riskScore||0;
                if(aS.length>1){sc=Math.round((n/(cd.poCount||aPOs.length||1))*sc);sc=Math.max(sc,20);sc=Math.min(sc,100);}
                if(sc>=iMax){iMax=sc;sMax=s.name||sid;}var sev=sc>=80?"CRITICAL":sc>=60?"HIGH":sc>=40?"MEDIUM":"LOW";
                var cls=cd.classification||(sev==="CRITICAL"?"COMPLETE INTERRUPTION":sev==="HIGH"?"DELAYED SUPPLY":"PARTIAL DISRUPTION");
                return{supplier:s.name||sid,supplierId:sid,classification:cls,riskScore:sc+"/100",riskScoreRaw:sc,severity:sev,posAtRisk:String(n),plants:pl.join(", ")||"—",skus:sk.join(", ")||"—"};});
            aRows.sort(function(a,b){return b.riskScoreRaw-a.riskScoreRaw;});
            oRM.setProperty("/kpi",{highestRisk:{value:String(iMax),supplier:sMax||"—"},suppliersImpacted:{value:String(aS.length),sub:"Affected by event"},posAtRisk:{value:String(tPOs),sub:"At risk"},plants:{value:String(Object.keys(pSet).length),sub:"Affected"}});
            oRM.setProperty("/supplierRisks",aRows);
        },
        /** Load case data for Survival Planning from getCaseHierarchy. */
        _loadCaseDataForSurvivalPlanning: function (sId) {
            var t=this;if(!sId)return;
            fetch(this._getServiceUrl()+"getCaseHierarchy(caseId='"+encodeURIComponent(sId)+"')",{method:"GET",headers:{"Accept":"application/json"},credentials:"include"}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}).then(function(d){if(d&&d.success!==false)t._populateSPFromHierarchy(d);}).catch(function(e){console.error("[SP] Load failed:",e);});
        },
        /** Populate survivalPlanning model from getCaseHierarchy response. */
        _populateSPFromHierarchy: function (oH) {
            var oSP=this.getView().getModel("survivalPlanning");if(!oSP)return;
            var aM=oH.materials||[],crit=0,totCov=0,wGap=0,wGapM="",totSh=0;
            var rows=aM.map(function(m){var ic=parseInt(m.coverageDays,10)||0,ig=parseInt(m.gapDays,10)||0;
                if(ic>0&&ic<10)crit++;totCov+=ic;if(ig>wGap){wGap=ig;wGapM=(m.material||"")+" - "+(m.plant||"");}totSh+=(parseInt(m.shortfall,10)||0);
                return{material:m.material||"—",plant:m.plant||"—",coverage:ic?(ic+" days"):"—",timeToSurvive:m.survivalDays?(m.survivalDays+" days"):"—",recovery:m.recoveryDate||"—",gap:ig?(ig+" days"):"—",shortfall:m.shortfall?(m.shortfall+" MT"):"—"};});
            var avg=rows.length>0?Math.round(totCov/rows.length):0;
            oSP.setProperty("/kpi",{criticalItems:{value:String(crit),sub:"Coverage < 10 days"},avgCoverage:{value:avg>0?(avg+" days"):"—",sub:"All materials"},worstGap:{value:wGap>0?(wGap+" days"):"—",sub:wGapM||"—"},totalShortfall:{value:totSh>0?(totSh+" MT"):"—",sub:"Needs mitigation"}});
            oSP.setProperty("/materials",rows);
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
                "- \"category\": Exactly one of: \"tariff\", \"fire\", \"flood\", \"shipping\", \"commodity\", \"earthquake\", \"strike\", \"cyberattack\", \"geopolitical\"\n" +
                "- \"classification\": Exactly one of: \"DELAYED SUPPLY\", \"TARIFF\", \"COMPLETE INTERRUPTION\", \"PARTIAL INTERRUPTION\". " +
                "Use this rubric to choose the correct value:\n" +
                "    * \"TARIFF\" — trade policy / customs duties / sanctions / embargoes (cost or paperwork impact, supply itself is not physically blocked).\n" +
                "    * \"COMPLETE INTERRUPTION\" — supply is fully halted (factory destroyed, port closed, export ban, force majeure, no shipments moving).\n" +
                "    * \"PARTIAL INTERRUPTION\" — capacity is reduced but some supply continues (partial strike, reduced throughput, damaged but operational asset).\n" +
                "    * \"DELAYED SUPPLY\" — shipments are delayed but will still arrive (congestion, weather delays, rerouted vessels, longer lead times).\n\n" +
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

            // Allowed disruption classifications produced by the LLM. Any other
            // value returned by the model is normalized to the safe default so
            // downstream consumers (case creation, hierarchy view, filters) only
            // ever see one of these four canonical strings.
            var aAllowedClasses = [
                "DELAYED SUPPLY",
                "TARIFF",
                "COMPLETE INTERRUPTION",
                "PARTIAL INTERRUPTION"
            ];
            var normalizeClassification = function (sRaw) {
                var sVal = (sRaw == null ? "" : String(sRaw)).trim().toUpperCase();
                if (aAllowedClasses.indexOf(sVal) >= 0) {
                    return sVal;
                }
                if (sVal) {
                    // Log drift so QA can spot the LLM ignoring the rubric.
                    console.warn("[GlobalRisks] Unexpected classification from LLM, normalizing to PARTIAL INTERRUPTION:", sRaw);
                } else {
                    console.warn("[GlobalRisks] Missing classification from LLM, defaulting to PARTIAL INTERRUPTION");
                }
                return "PARTIAL INTERRUPTION";
            };

            return aRisks.map(function (oRisk, iIndex) {
                var sCategory = (oRisk.category || "geopolitical").toLowerCase();
                var sRiskLevel = oRisk.riskLevel || "Medium";
                var sColor = mRiskLevelColor[sRiskLevel] || "blue";
                var sIcon = mCategoryIcon[sCategory] || "sap-icon://warning";
                var sClassification = normalizeClassification(oRisk.classification);

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
                    category: sCategory,
                    classification: sClassification,
                    // Impact-scope counts remain 0 on the initial news feed.
                    // They are populated per-item only AFTER the user clicks
                    // Investigate on that specific card and analyzeImpact
                    // returns real supplier/PO/material data (see
                    // _analyzeDisruption → _updateSelectedRiskCounts). The
                    // count line in the fragment is guarded by visible={= !!poCount }
                    // so it stays hidden until real numbers arrive.
                    poCount: 0,
                    materialCount: 0,
                    plantCount: 0
                };
            });
        }
    });
});
