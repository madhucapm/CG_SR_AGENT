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
                suppliers: [],
                materials: [],
                agents: {
                    survivalPlanner:  { status: "notRun", busy: false, result: null, error: null, formattedResult: "", statusText: "Not Run", statusClass: "adAgentStatusValue" },
                    buyer:            { status: "notRun", busy: false, result: null, error: null, formattedResult: "", statusText: "Not Run", statusClass: "adAgentStatusValue" },
                    recommendation:   { status: "notRun", busy: false, result: null, error: null, formattedResult: "", statusText: "Not Run", statusClass: "adAgentStatusValue" }
                }
            });
            this.getView().setModel(oAgentDisruptionsModel, "agentDisruptions");

            // Monitoring JSON model — drives the Case Timeline / Audit tab.
            // Populated dynamically from getCaseHistory + getCaseHierarchy +
            // in-memory agentDisruptions state when the user selects a case.
            var oMonitoringModel = new JSONModel({
                case: { caseId: "", event: "", severity: "", classification: "" },
                activities: [],
                agentStatuses: [
                    { name: "Survival Planner", status: "notRun" },
                    { name: "Buyer Agent", status: "notRun" },
                    { name: "Recommendation Agent", status: "notRun" }
                ]
            });
            this.getView().setModel(oMonitoringModel, "monitoringModel");

            // Risk Assessment JSON model — sample/mock data as fallback;
            // intended to be populated from Early Warning Agent / case
            // impact results when a real case is active.
            var oRiskAssessmentModel = new JSONModel({
                kpi: {
                    highestRisk:      { value: "—", supplier: "Select a case" },
                    suppliersImpacted:{ value: "—", sub: "Select a case" },
                    posAtRisk:        { value: "—", sub: "Select a case" },
                    plants:           { value: "—", sub: "Select a case" }
                },
                supplierRisks: []
            });
            this.getView().setModel(oRiskAssessmentModel, "riskAssessment");

            // Survival Planning JSON model — sample/mock data as fallback;
            // intended to be populated from Survival Planner Agent /
            // case material-supply data when a real case is active.
            var oSurvivalPlanningModel = new JSONModel({
                kpi: {
                    criticalItems:  { value: "—", sub: "Select a case" },
                    avgCoverage:    { value: "—", sub: "Select a case" },
                    worstGap:       { value: "—", sub: "Select a case" },
                    totalShortfall: { value: "—", sub: "Select a case" }
                },
                materials: []
            });
            this.getView().setModel(oSurvivalPlanningModel, "survivalPlanning");

            // Recommendation Result JSON model — populated when the user
            // runs the Recommendation Agent. Drives the Recommendations
            // navigation view with real data from the Python agent endpoint.
            var oRecommendationResultModel = new JSONModel({
                busy: false,
                hasResult: false,
                caseId: null,
                incidentId: null,
                topRecommendation: null,
                rankedOptionList: [],
                weightMatrix: null,
                portfolioHeadlineTts: null,
                gapMagnitudeWeeks: null,
                agentId: null,
                timestamp: null,
                aiNarrative: null
            });
            this.getView().setModel(oRecommendationResultModel, "recommendationResult");

            // Execution Model — tracks STO/PO orders created by the Buyer
            // Agent when the user approves recommendations. Drives the
            // Execution Tracking view with real data from S/4HANA.
            var oExecutionModel = new JSONModel({
                executionItems: [],
                stoCreatedCount: 0,
                poCreatedCount: 0,
                failedCount: 0,
                pendingCount: 0,
                totalCount: 0
            });
            this.getView().setModel(oExecutionModel, "execution");

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
         * Recommendations screen — Approve a ranked option.
         * Determines whether it's an AlternatePlant (STO) or
         * AlternateSupplier (PO) and calls the respective backend
         * action to create a real order in S/4HANA.
         *
         * The result is appended to the execution model which
         * drives the Execution Tracking view.
         */
        onRecommendationAction: function (oEvent) {
            var oView = this.getView();
            var that = this;

            // Get the recommendation row context
            var oSource = oEvent.getSource();
            var oCtx = oSource.getBindingContext("recommendationResult");
            if (!oCtx) {
                MessageToast.show("No recommendation context found.");
                return;
            }

            var oRec = oCtx.getObject();
            if (!oRec) {
                MessageToast.show("No recommendation data available.");
                return;
            }

            // Only the Approve button should trigger creation
            var sButtonType = oSource.getType ? oSource.getType() : "";
            if (sButtonType === "Reject") {
                MessageToast.show("Recommendation #" + (oRec.rank || "") + " rejected.");
                var sRejectPath = oCtx.getPath();
                var oRecModelR = oView.getModel("recommendationResult");
                if (oRecModelR) { oRecModelR.setProperty(sRejectPath + "/_rejected", true); }
                return;
            }

            // Get case ID from the recommendation model
            var oRecModel = oView.getModel("recommendationResult");
            var sCaseId = oRecModel.getProperty("/caseId") || "";

            // ── Resolve context from case models (agentDisruptions) ──────
            // Ranked options from the Python agent have lever/coverage/cost/
            // risk/rationale but NOT plant/material/supplier IDs.  We source
            // actual IDs from the case hierarchy and survival planner data.
            var oAdModel = oView.getModel("agentDisruptions");
            var aCaseMaterials = oAdModel ? oAdModel.getProperty("/materials") || [] : [];
            var aCaseSuppliers = oAdModel ? oAdModel.getProperty("/suppliers") || [] : [];
            var oSvpResult = oAdModel ? oAdModel.getProperty("/agents/survivalPlanner/result") : null;

            var sTargetPlant = "", sMaterialId = "", nQuantity = 0;
            if (oSvpResult && Array.isArray(oSvpResult.records) && oSvpResult.records.length > 0) {
                sTargetPlant = oSvpResult.records[0].plant || "";
                sMaterialId = oSvpResult.records[0].material || "";
                nQuantity = oSvpResult.records[0].shortfallQty || oSvpResult.records[0].weeklyDemand || 100;
            }
            if ((!sTargetPlant || !sMaterialId) && aCaseMaterials.length > 0) {
                sTargetPlant = sTargetPlant || aCaseMaterials[0].plant || "";
                sMaterialId = sMaterialId || aCaseMaterials[0].material || "";
            }
            // Fallback: also check caseHierarchy model (populated by Case Dashboard)
            if (!sTargetPlant || !sMaterialId || aCaseSuppliers.length === 0) {
                var oCaseH = oView.getModel("caseHierarchy");
                if (oCaseH) {
                    var aHierarchyMats = oCaseH.getProperty("/materials") || [];
                    if (aHierarchyMats.length > 0) {
                        sTargetPlant = sTargetPlant || aHierarchyMats[0].plant || "";
                        sMaterialId = sMaterialId || aHierarchyMats[0].material || "";
                    }
                    if (aCaseSuppliers.length === 0) {
                        var aHierarchySuppliers = oCaseH.getProperty("/suppliers") || [];
                        if (aHierarchySuppliers.length > 0) {
                            aCaseSuppliers = aHierarchySuppliers;
                        }
                    }
                }
            }
            if (!nQuantity || nQuantity <= 0) { nQuantity = 100; }

            // Determine STO vs PO from the lever text
            var sLever = (oRec.lever || "").toUpperCase();
            var bIsSTO = sLever.indexOf("PLANT") >= 0 ||
                         sLever.indexOf("STOCK TRANSFER") >= 0 ||
                         sLever.indexOf("INTER-PLANT") >= 0 ||
                         sLever.indexOf("TRANSFER") >= 0;

            var sServiceUrl = this._getServiceUrl();
            var sEndpoint, oPayload, sOrderType;

            if (bIsSTO) {
                sEndpoint = "createStockTransportOrder";
                sOrderType = "STO";
            } else {
                sEndpoint = "createPurchaseOrder";
                sOrderType = "PO";
            }

            // Validate material + target plant before proceeding
            if (!sMaterialId) {
                MessageToast.show("Cannot create " + sOrderType + ": no material ID from case data.");
                return;
            }
            if (!sTargetPlant) {
                MessageToast.show("Cannot create " + sOrderType + ": no plant available from case data.");
                return;
            }

            // For STO: call getAlternatePlantSource to resolve the real
            // source plant and required quantity from S/4HANA, then create.
            // For PO: resolve supplier from case data, then create.
            if (bIsSTO) {
                // Pass a supplier ID for the STO — S/4HANA type "NB" requires it
                var sStoSupplierId = "";
                if (aCaseSuppliers.length > 0) {
                    sStoSupplierId = aCaseSuppliers[0].supplierId || "";
                }
                this._createSTOWithAlternatePlant(oRec, oCtx, sCaseId, sMaterialId, sTargetPlant, sServiceUrl, sStoSupplierId);
            } else {
                var sSupplierId = "";
                if (aCaseSuppliers.length > 0) {
                    sSupplierId = aCaseSuppliers[0].supplierId || "";
                }
                if (!sSupplierId) {
                    MessageToast.show("Cannot create PO: no supplier ID available from case data.");
                    return;
                }
                oPayload = {
                    supplierId: sSupplierId, plantId: sTargetPlant,
                    materialId: sMaterialId, quantity: nQuantity, caseId: sCaseId
                };
                console.log("[BuyerAgent] PO payload:", oPayload);
                this._executeOrderCreation(oRec, oCtx, sOrderType, sEndpoint, oPayload, sServiceUrl, sMaterialId, sTargetPlant, bIsSTO);
            }

            return; // execution continues in _createSTOWithAlternatePlant or _executeOrderCreation
        },

        /**
         * Shared helper — adds an execution-model entry, calls the backend
         * endpoint, and updates the execution model with the result.
         * Used by both STO and PO approval flows.
         */
        _executeOrderCreation: function (oRec, oCtx, sOrderType, sEndpoint, oPayload, sServiceUrl, sMaterialId, sTargetPlant, bIsSTO) {
            var that = this;
            var oView = this.getView();
            var oExecModel = oView.getModel("execution");
            var oRecModel = oView.getModel("recommendationResult");
            var aItems = oExecModel.getProperty("/executionItems") || [];
            var iPendingCount = oExecModel.getProperty("/pendingCount") || 0;
            var iTotal = oExecModel.getProperty("/totalCount") || 0;

            var sPlantDisplay = bIsSTO
                ? (oPayload.sourcePlantId + " → " + oPayload.targetPlantId)
                : (sTargetPlant || "");

            var oNewItem = {
                id: "EXC-" + String(iTotal + 1).padStart(3, "0"),
                caseId: oPayload.caseId || "",
                orderType: sOrderType,
                type: bIsSTO ? "Stock Transfer" : "Purchase Order",
                material: sMaterialId || "",
                plant: sPlantDisplay,
                strategy: oRec.lever || "",
                quantity: oPayload.quantity,
                status: "Processing",
                poNumber: "",
                time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
                error: ""
            };
            aItems.push(oNewItem);
            oExecModel.setProperty("/executionItems", aItems);
            oExecModel.setProperty("/pendingCount", iPendingCount + 1);
            oExecModel.setProperty("/totalCount", iTotal + 1);

            // Mark the recommendation row as approved
            if (oCtx && oRecModel) {
                oRecModel.setProperty(oCtx.getPath() + "/_approved", true);
            }

            MessageToast.show("Creating " + sOrderType + " for " + (sMaterialId || "material") + " …");

            fetch(sServiceUrl + sEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                credentials: "include",
                body: JSON.stringify(oPayload)
            }).then(function (oResp) {
                if (!oResp.ok) {
                    return oResp.text().then(function (sBody) {
                        throw new Error("HTTP " + oResp.status + ": " + sBody.substring(0, 300));
                    });
                }
                return oResp.json();
            }).then(function (oData) {
                console.log("[BuyerAgent] " + sEndpoint + " response:", oData);
                var aUpdated = oExecModel.getProperty("/executionItems");
                var iIdx = aUpdated.length - 1;
                for (var i = aUpdated.length - 1; i >= 0; i--) {
                    if (aUpdated[i].id === oNewItem.id) { iIdx = i; break; }
                }
                var iPending = oExecModel.getProperty("/pendingCount") || 1;

                if (oData && oData.success) {
                    oExecModel.setProperty("/executionItems/" + iIdx + "/status", "Confirmed");
                    oExecModel.setProperty("/executionItems/" + iIdx + "/poNumber", oData.poNumber || "");
                    oExecModel.setProperty("/executionItems/" + iIdx + "/time",
                        new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
                    if (sOrderType === "STO") {
                        oExecModel.setProperty("/stoCreatedCount", (oExecModel.getProperty("/stoCreatedCount") || 0) + 1);
                    } else {
                        oExecModel.setProperty("/poCreatedCount", (oExecModel.getProperty("/poCreatedCount") || 0) + 1);
                    }
                    oExecModel.setProperty("/pendingCount", Math.max(0, iPending - 1));
                    MessageToast.show("✅ " + sOrderType + " " + (oData.poNumber || "") + " created!");
                } else {
                    var sErr = (oData && oData.error) || "Unknown error";
                    oExecModel.setProperty("/executionItems/" + iIdx + "/status", "Failed");
                    oExecModel.setProperty("/executionItems/" + iIdx + "/error", sErr);
                    oExecModel.setProperty("/failedCount", (oExecModel.getProperty("/failedCount") || 0) + 1);
                    oExecModel.setProperty("/pendingCount", Math.max(0, iPending - 1));
                    MessageToast.show("❌ " + sOrderType + " failed: " + sErr);
                }
                // Navigate to Execution Tracking tab (on success or failure)
                setTimeout(function () { that._selectSideNav("planning"); }, 600);
            }).catch(function (oErr) {
                console.error("[BuyerAgent] " + sEndpoint + " error:", oErr);
                var aUpdated = oExecModel.getProperty("/executionItems");
                var iIdx = aUpdated.length - 1;
                for (var i = aUpdated.length - 1; i >= 0; i--) {
                    if (aUpdated[i].id === oNewItem.id) { iIdx = i; break; }
                }
                oExecModel.setProperty("/executionItems/" + iIdx + "/status", "Failed");
                oExecModel.setProperty("/executionItems/" + iIdx + "/error", oErr.message || "Network error");
                oExecModel.setProperty("/failedCount", (oExecModel.getProperty("/failedCount") || 0) + 1);
                var iPending = oExecModel.getProperty("/pendingCount") || 1;
                oExecModel.setProperty("/pendingCount", Math.max(0, iPending - 1));
                MessageToast.show("❌ " + sOrderType + " error: " + (oErr.message || "Unknown"));
                // Navigate to Execution Tracking tab even on network error
                setTimeout(function () { that._selectSideNav("planning"); }, 600);
            });
        },

        /**
         * STO creation helper — calls getAlternatePlantSource to resolve the
         * real source plant and required quantity from S/4HANA, then delegates
         * to _executeOrderCreation with the correct payload.
         */
        _createSTOWithAlternatePlant: function (oRec, oCtx, sCaseId, sMaterialId, sTargetPlant, sServiceUrl, sSupplierId) {
            var that = this;
            var oView = this.getView();

            // Show a toast while we resolve the source plant
            MessageToast.show("Resolving alternate plant for " + sMaterialId + " …");

            // Call getAlternatePlantSource (OData function — uses GET)
            var sAltUrl = sServiceUrl +
                "getAlternatePlantSource(affectedMaterial='" + encodeURIComponent(sMaterialId) +
                "',affectedPlant='" + encodeURIComponent(sTargetPlant) + "')";

            console.log("[BuyerAgent] GET", sAltUrl);

            fetch(sAltUrl, {
                method: "GET",
                headers: { "Accept": "application/json" },
                credentials: "include"
            }).then(function (oResp) {
                if (!oResp.ok) {
                    return oResp.text().then(function (b) {
                        throw new Error("HTTP " + oResp.status + (b ? ": " + b.substring(0, 300) : ""));
                    });
                }
                return oResp.json();
            }).then(function (oAlt) {
                console.log("[BuyerAgent] getAlternatePlantSource result:", oAlt);

                if (!oAlt || oAlt.success === false) {
                    throw new Error(oAlt && oAlt.error ? oAlt.error : "No alternate plant source found");
                }

                var aSourcePlants = Array.isArray(oAlt.sourcePlants) ? oAlt.sourcePlants : [];
                if (aSourcePlants.length === 0) {
                    throw new Error("No source plants with available stock found for " + sMaterialId);
                }

                // Pick the best source plant (first = highest available stock)
                var sBestPlant = aSourcePlants[0].plant || "";
                if (!sBestPlant) {
                    throw new Error("Source plant ID is empty in getAlternatePlantSource response");
                }

                // Use the required qty from S/4HANA open POs if available
                var nQty = oAlt.requiredQty || 100;
                if (nQty <= 0) { nQty = 100; }

                var oPayload = {
                    sourcePlantId: sBestPlant,
                    targetPlantId: sTargetPlant,
                    materialId: sMaterialId,
                    quantity: nQty,
                    caseId: sCaseId,
                    supplierId: sSupplierId || ""
                };

                console.log("[BuyerAgent] STO payload (from S/4HANA):", oPayload);

                that._executeOrderCreation(
                    oRec, oCtx, "STO", "createStockTransportOrder",
                    oPayload, sServiceUrl, sMaterialId, sTargetPlant, true
                );
            }).catch(function (oErr) {
                console.error("[BuyerAgent] getAlternatePlantSource failed:", oErr);
                MessageToast.show("❌ STO: " + (oErr.message || "Failed to resolve source plant"));
            });
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
            // riskScore may be "27/100" — extract the number before the slash
            var iRiskScore = parseInt(String(iRiskScoreRaw).split("/")[0], 10) || 0;
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
                var aMaterialNames = [];
                aMaterials.forEach(function (m) {
                    if (m.plant && aPlantNames.indexOf(m.plant) === -1) aPlantNames.push(m.plant);
                    var sMatDisplay = m.material || "";
                    if (sMatDisplay && aMaterialNames.indexOf(sMatDisplay) === -1) aMaterialNames.push(sMatDisplay);
                });

                oDisruptions.setProperty("/createdCase", {
                    caseId: oData.caseId,
                    eventTitle: caseData.eventTitle || oPayload.eventTitle,
                    supplierSummary: aSupplierNames.join(", ") || "—",
                    poSummary: (caseData.poCount || 0) + " Purchase Orders",
                    plantSummary: aPlantNames.join(", ") || "—",
                    materialSummary: aMaterialNames.join(", ") || "—",
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

        /**
         * Run Survival Planner Agent from the Case Dashboard.
         * Navigates to the Disruptions screen and auto-triggers the
         * Survival Planner agent once the case data has loaded.
         * The result populates both the Disruptions agent card AND
         * the Survival Planning navigation tab.
         */
        onRunSurvivalPlannerAgent: function () {
            var that = this;
            var oView = this.getView();
            var oDashboard = oView.getModel("dashboard");
            var sCaseId = oDashboard ? oDashboard.getProperty("/selectedCaseId") : "";
            if (!sCaseId) {
                MessageToast.show("No case selected. Please select a case first.");
                return;
            }
            // Navigate to Disruptions first — this loads case data + resets agent cards
            this._enableDisruptionsAndNavigate("Survival Planner");

            // Auto-trigger the Survival Planner agent run after a short delay
            // to allow the Disruptions case data to load and populate the model.
            setTimeout(function () {
                var oAdModel = oView.getModel("agentDisruptions");
                if (oAdModel && oAdModel.getProperty("/caseData")) {
                    that._runDisruptionAgent("survivalPlanner");
                } else {
                    // Case data hasn't loaded yet — retry once more
                    setTimeout(function () {
                        that._runDisruptionAgent("survivalPlanner");
                    }, 1500);
                }
            }, 800);
        },

        /** Run Buyer Agent — enable Disruptions and navigate. */
        onRunBuyerAgent: function () {
            this._enableDisruptionsAndNavigate("Buyer");
        },

        /**
         * Run Recommendation Agent from the Case Dashboard.
         * Navigates to the Disruptions screen and auto-triggers the
         * Recommendation agent once the case data has loaded.
         * The result populates both the Disruptions agent card AND
         * the Recommendations navigation tab.
         */
        onRunRecommendationAgent: function () {
            var that = this;
            var oView = this.getView();
            var oDashboard = oView.getModel("dashboard");
            var sCaseId = oDashboard ? oDashboard.getProperty("/selectedCaseId") : "";
            if (!sCaseId) {
                MessageToast.show("No case selected. Please select a case first.");
                return;
            }
            // Navigate to Disruptions first — this loads case data + resets agent cards
            this._enableDisruptionsAndNavigate("Recommendation");

            // Auto-trigger the Recommendation agent run after a short delay
            // to allow the Disruptions case data to load and populate the model.
            setTimeout(function () {
                var oAdModel = oView.getModel("agentDisruptions");
                if (oAdModel && oAdModel.getProperty("/caseData")) {
                    that._runDisruptionAgent("recommendation");
                } else {
                    // Case data hasn't loaded yet — retry once more
                    setTimeout(function () {
                        that._runDisruptionAgent("recommendation");
                    }, 1500);
                }
            }, 800);
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

                // Build selectedCaseTree — single-case array for the hierarchy panel
                var cd = oData.caseData || {};
                oCaseH.setProperty("/selectedCaseTree", [{
                    caseId: cd.caseId || sCaseId,
                    eventTitle: cd.eventTitle || "",
                    severity: cd.severity || "",
                    classification: cd.classification || "",
                    status: cd.status || "",
                    suppliers: aTree,
                    _expanded: true
                }]);

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
                        oByPlant[p].push({ material: m.material || "", materialDescription: m.materialDescription || "", sku: m.sku || "", itemNo: m.itemNo || "" });
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

            // Sync the SideNavigation highlight to match the programmatic view switch
            var oSideNav = this.byId("sideNavigation");
            if (oSideNav) {
                var oNavList = oSideNav.getItem();  // the main NavigationList
                if (oNavList) {
                    var aNavItems = oNavList.getItems() || [];
                    for (var i = 0; i < aNavItems.length; i++) {
                        if (aNavItems[i].getKey && aNavItems[i].getKey() === sKey) {
                            oSideNav.setSelectedItem(aNavItems[i]);
                            break;
                        }
                    }
                }
            }

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
            if (sKey === "caseDashboard" || sKey === "riskAssessment" || sKey === "survivalPlanning" || sKey === "agentDisruptions" || sKey === "approvals" || sKey === "planning" || sKey === "audit") {
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
            if (sKey === "audit" && sExistingCaseId) {
                this._loadCaseDataForMonitoring(sExistingCaseId);
            }
            if (sKey === "approvals" && sExistingCaseId) {
                this._loadPersistedRecommendations(sExistingCaseId);
                // Also load case hierarchy into agentDisruptions so that
                // /materials and /suppliers are available when the user
                // clicks Approve to create an STO or PO.
                this._loadCaseDataForAgentDisruptions(sExistingCaseId);
            }
            if (sKey === "planning" && sExistingCaseId) {
                this._loadPersistedExecutionItems(sExistingCaseId);
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
                    oAdModel.setProperty("/suppliers", Array.isArray(oData.suppliers) ? oData.suppliers : []);
                    oAdModel.setProperty("/materials", Array.isArray(oData.materials) ? oData.materials : []);
                } else {
                    oAdModel.setProperty("/caseData", null);
                    oAdModel.setProperty("/suppliers", []);
                    oAdModel.setProperty("/materials", []);
                }
            }).catch(function (oErr) {
                console.error("[AgentDisruptions] Load case failed:", oErr);
                oAdModel.setProperty("/caseData", null);
                oAdModel.setProperty("/materials", []);
            });
        },

        // ═══════════════════════════════════════════════════════════════
        // MONITORING — Load case data for the Case Timeline / Audit tab
        // ═══════════════════════════════════════════════════════════════
        /**
         * Load case data for Monitoring / Audit tab.
         * @param {string} sCaseId - The case identifier.
         */
        _loadCaseDataForMonitoring: function (sCaseId) {
            var that = this;
            var oMon = this.getView().getModel("monitoringModel");
            if (!oMon || !sCaseId) { return; }
            oMon.setProperty("/case", { caseId: sCaseId, event: "", severity: "", classification: "" });
            oMon.setProperty("/activities", []);
            oMon.setProperty("/agentStatuses", [
                { name: "Survival Planner", status: "notRun" },
                { name: "Buyer Agent", status: "notRun" },
                { name: "Recommendation Agent", status: "notRun" }
            ]);
            var sUrl = this._getServiceUrl();
            // 1. Case header
            fetch(sUrl + "getCaseHierarchy(caseId='" + encodeURIComponent(sCaseId) + "')", {
                method: "GET", headers: { "Accept": "application/json" }, credentials: "include"
            }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
              .then(function (o) {
                if (o && o.caseData) {
                    var cd = o.caseData, sv = cd.severity || cd.priority || "";
                    var cl = sv === "CRITICAL" ? "COMPLETE INTERRUPTION" : sv === "HIGH" ? "DELAYED SUPPLY" : "PARTIAL DISRUPTION";
                    oMon.setProperty("/case", { caseId: cd.caseId || sCaseId, event: cd.eventTitle || cd.eventDescription || "", severity: sv, classification: cd.classification || cl });
                }
            }).catch(function (e) { console.warn("[Monitoring] getCaseHierarchy failed:", e); });
            // 2. History + in-memory merge
            fetch(sUrl + "getCaseHistory(caseId='" + encodeURIComponent(sCaseId) + "')", {
                method: "GET", headers: { "Accept": "application/json" }, credentials: "include"
            }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
              .then(function (o) { that._buildMonitoringActivities(o, sCaseId); })
              .catch(function (e) { console.warn("[Monitoring] getCaseHistory failed:", e); that._buildMonitoringActivities(null, sCaseId); });
        },

        /** @private Build activities + agent statuses from DB history + in-memory. */
        _buildMonitoringActivities: function (oData, sCaseId) {
            var oMon = this.getView().getModel("monitoringModel");
            if (!oMon) { return; }
            var aH = (oData && Array.isArray(oData.history)) ? oData.history : [];
            var aAct = [], mSt = {};
            for (var i = 0; i < aH.length; i++) {
                var h = aH[i], sT = "";
                if (h.timestamp) { try { var d = new Date(h.timestamp); sT = String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0"); } catch(e){} }
                aAct.push({ agent: h.agent || "System", title: h.action || "", description: h.details || "", time: sT, status: "completed" });
                if (h.agent) { mSt[h.agent] = "completed"; }
            }
            this._mergeInMemoryAgentStates(aAct, mSt, sCaseId);
            oMon.setProperty("/activities", aAct);
            var aSt = [
                { name: "Survival Planner", status: mSt["Survival Planner"] || "notRun" },
                { name: "Buyer Agent", status: mSt["Buyer Agent"] || "notRun" },
                { name: "Recommendation Agent", status: mSt["Recommendation Agent"] || "notRun" }
            ];
            if (mSt["Coordinator Agent"]) { aSt.unshift({ name: "Coordinator", status: "completed" }); }
            oMon.setProperty("/agentStatuses", aSt);
        },

        /** @private Merge in-memory agentDisruptions states into activities. */
        _mergeInMemoryAgentStates: function (aAct, mSt, sCaseId) {
            var oAd = this.getView().getModel("agentDisruptions");
            if (!oAd || oAd.getProperty("/selectedCaseId") !== sCaseId) { return; }
            var mC = { survivalPlanner: { l: "Survival Planner", r: "Running Coverage Analysis…" }, buyer: { l: "Buyer Agent", r: "Running Procurement…" }, recommendation: { l: "Recommendation Agent", r: "Generating Recommendations…" } };
            ["survivalPlanner","buyer","recommendation"].forEach(function(k){
                var o = oAd.getProperty("/agents/" + k); if (!o) return;
                var lb = mC[k].l; if (mSt[lb]) return;
                if (o.status === "completed") { aAct.push({ agent: lb, title: lb + " Completed", description: "Completed during current session.", time: "Now", status: "completed" }); mSt[lb] = "completed"; }
                else if (o.status === "running") { aAct.push({ agent: lb, title: mC[k].r, description: "Agent is currently executing.", time: "Now", status: "pending" }); mSt[lb] = "pending"; }
                else if (o.status === "failed") { aAct.push({ agent: lb, title: lb + " Failed", description: o.error || "Unknown error.", time: "Now", status: "pending" }); mSt[lb] = "pending"; }
            });
        },

        /** Reset all agent cards to their initial Not Run state. */
        _resetAllAgentDisruptionCards: function () {
            var oAdModel = this.getView().getModel("agentDisruptions");
            if (!oAdModel) { return; }
            ["survivalPlanner", "buyer", "recommendation"].forEach(function (sKey) {
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
            oAdModel.setProperty("/materials", []);
            if (oDashboard) { oDashboard.setProperty("/selectedCaseId", sCaseId); }
            this._resetAllAgentDisruptionCards();
            this._loadCaseDataForAgentDisruptions(sCaseId);
        },

        /** Disruptions Run handlers — thin wrappers. */
        onRunDisruptionSurvivalPlanner: function () { this._runDisruptionAgent("survivalPlanner"); },
        onRunDisruptionBuyer:           function () { this._runDisruptionAgent("buyer"); },
        onRunDisruptionRecommendation:  function () { this._runDisruptionAgent("recommendation"); },

        /**
         * Generic agent execution for the Disruptions screen.
         * @param {string} sAgentKey - Agent key.
         */
        _runDisruptionAgent: function (sAgentKey) {
            var that = this, oAdModel = this.getView().getModel("agentDisruptions");
            var sCaseId = oAdModel.getProperty("/selectedCaseId");
            var oCaseData = oAdModel.getProperty("/caseData");
            if (!sCaseId || !oCaseData) { MessageToast.show("No case selected."); return; }

            // Recommendation agent uses a different endpoint (Python agent)
            // so delegate to a dedicated method.
            if (sAgentKey === "recommendation") {
                this._runRecommendationAgent();
                return;
            }

            var mCfg = {
                survivalPlanner: { action: "runSurvival",      label: "Survival Planner", payload: { caseId: sCaseId } },
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
                // Survival Planner: show a loading indicator while the LLM
                // generates a polished executive narrative. If the LLM
                // fails, fall back to the raw template narrative.
                if (sAgentKey === "survivalPlanner") {
                    if (oData && oData.success !== false) {
                        that._populateSurvivalPlanningFromSVP(oData);
                        // Show loading state while LLM processes
                        oAdModel.setProperty(sP + "/formattedResult",
                            "<div class='adResponseWrap'><div class='adRespSection'>" +
                            "<strong>Survival Planner \u2014 Generating AI Narrative\u2026</strong></div>" +
                            "<div class='adRespRow'>Analyzing results and composing executive summary.</div></div>");
                        that._enhanceNarrativeWithLLM(oData, sP);
                    } else {
                        // API failure — show raw narrative directly
                        oAdModel.setProperty(sP + "/formattedResult", that._formatSurvivalPlannerResponse(oData));
                    }
                } else {
                    oAdModel.setProperty(sP + "/formattedResult", that._formatAgentResponse(oData));
                }
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
                error:"Error",
                // SVP-specific labels
                incidentId:"Incident ID", agentId:"Agent ID", timestamp:"Timestamp",
                portfolioHeadlineTTS_Weeks:"Portfolio Headline TTS (Weeks)",
                kpis:"Key Performance Indicators", records:"Plant × Material Records",
                narratives:"Narratives", ttsWeeks:"TTS (Weeks)", ttrWeeks:"TTR (Weeks)",
                ttrSource:"TTR Source", ttrConfidence:"TTR Confidence",
                gapWeeks:"Gap (Weeks)", shortfallQty:"Shortfall Qty",
                shortfallUoM:"Shortfall UoM", confidence:"Confidence",
                dataFlags:"Data Flags", eligibleSupply:"Eligible Supply",
                usableInventory:"Usable Inventory", totalSupply:"Total Supply",
                criticalItems:"Critical Items", averageCoverageWeeks:"Avg Coverage (Weeks)",
                worstGap:"Worst Gap", totalShortfall:"Total Shortfall",
                ttsSummary:"TTS Summary", ttrAssumption:"TTR Assumption", dataGaps:"Data Gaps" };
            Object.keys(oData).forEach(function (k) {
                var v = oData[k];
                if (v === null || v === undefined) return;
                if (k === "@odata.context" || k === "@odata.metadataEtag") return;
                var lb = mL[k] || k;
                if (Array.isArray(v)) {
                    // Array of objects → render each as a numbered sub-section
                    if (v.length === 0) return;
                    if (typeof v[0] === "object" && v[0] !== null) {
                        aL.push("<div class='adRespSection'><strong>" + lb + " (" + v.length + ")</strong></div>");
                        v.forEach(function (item, idx) {
                            aL.push("<div class='adRespRow' style='margin-left:0.5rem;margin-top:0.25rem'><em>#" + (idx + 1) + "</em></div>");
                            Object.keys(item).forEach(function (ik) {
                                var iv = item[ik];
                                if (iv === null || iv === undefined) return;
                                var ilb = mL[ik] || ik;
                                if (Array.isArray(iv)) {
                                    aL.push("<div class='adRespRow' style='margin-left:1rem'><span class='adRespKey'>" + ilb + ":</span> <span class='adRespVal'>" + that._escapeHtml(iv.join(", ")) + "</span></div>");
                                } else if (typeof iv === "object") {
                                    aL.push("<div class='adRespRow' style='margin-left:1rem'><span class='adRespKey'>" + ilb + ":</span> <span class='adRespVal'>" + that._escapeHtml(JSON.stringify(iv)) + "</span></div>");
                                } else {
                                    aL.push("<div class='adRespRow' style='margin-left:1rem'><span class='adRespKey'>" + ilb + ":</span> <span class='adRespVal'>" + that._escapeHtml(String(iv)) + "</span></div>");
                                }
                            });
                        });
                    } else {
                        // Array of primitives
                        aL.push("<div class='adRespRow'><span class='adRespKey'>" + lb + ":</span> <span class='adRespVal'>" + that._escapeHtml(v.join(", ")) + "</span></div>");
                    }
                } else if (typeof v === "object") {
                    // Nested object → render each property, recursing one level for sub-objects
                    aL.push("<div class='adRespSection'><strong>" + lb + "</strong></div>");
                    Object.keys(v).forEach(function (sk) {
                        var sv = v[sk];
                        if (sv === null || sv === undefined) return;
                        var slb = mL[sk] || sk;
                        if (Array.isArray(sv)) {
                            if (sv.length > 0 && typeof sv[0] === "object") {
                                aL.push("<div class='adRespRow' style='margin-left:0.5rem'><span class='adRespKey'>" + slb + " (" + sv.length + "):</span></div>");
                                sv.forEach(function (si, sidx) {
                                    var parts = [];
                                    Object.keys(si).forEach(function (sik) {
                                        if (si[sik] !== null && si[sik] !== undefined) {
                                            parts.push((mL[sik] || sik) + ": " + String(si[sik]));
                                        }
                                    });
                                    aL.push("<div class='adRespRow' style='margin-left:1rem'><span class='adRespVal'>#" + (sidx + 1) + " — " + that._escapeHtml(parts.join(", ")) + "</span></div>");
                                });
                            } else if (sv.length > 0) {
                                aL.push("<div class='adRespRow' style='margin-left:0.5rem'><span class='adRespKey'>" + slb + ":</span> <span class='adRespVal'>" + that._escapeHtml(sv.join(", ")) + "</span></div>");
                            }
                        } else if (typeof sv === "object") {
                            // Sub-sub-object: inline its fields
                            var subParts = [];
                            Object.keys(sv).forEach(function (ssk) {
                                if (sv[ssk] !== null && sv[ssk] !== undefined) {
                                    subParts.push((mL[ssk] || ssk) + ": " + String(sv[ssk]));
                                }
                            });
                            aL.push("<div class='adRespRow' style='margin-left:0.5rem'><span class='adRespKey'>" + slb + ":</span> <span class='adRespVal'>" + that._escapeHtml(subParts.join(", ")) + "</span></div>");
                        } else {
                            aL.push("<div class='adRespRow' style='margin-left:0.5rem'><span class='adRespKey'>" + slb + ":</span> <span class='adRespVal'>" + that._escapeHtml(String(sv)) + "</span></div>");
                        }
                    });
                } else {
                    aL.push("<div class='adRespRow'><span class='adRespKey'>" + lb + ":</span> <span class='adRespVal'>" + that._escapeHtml(String(v)) + "</span></div>");
                }
            });
            return "<div class='adResponseWrap'>" + aL.join("") + "</div>";
        },

        /**
         * Enhance the Survival Planner narrative using the LLM.
         *
         * Sends the full SVP response to the SAP AI Core orchestration
         * endpoint and asks the LLM to rewrite it as a clear, executive-
         * style narrative.  On success the formattedResult is replaced;
         * on failure the original raw narrative stays (graceful degradation).
         *
         * @param {Object} oSvpData  - Full runSurvival response
         * @param {string} sModelPath - e.g. "/agents/survivalPlanner"
         */
        _enhanceNarrativeWithLLM: function (oSvpData, sModelPath) {
            var that = this;
            var oAdModel = this.getView().getModel("agentDisruptions");
            if (!oAdModel) { return; }

            console.log("[SVP-LLM] Starting narrative enhancement\u2026");

            var oCompact = this._buildSvpLLMPayload(oSvpData);
            var sSystemMessage = this._buildSvpSystemPrompt();
            var sUserMessage = JSON.stringify(oCompact);
            // Keep raw narrative for fallback
            var sRawHtml = that._formatSurvivalPlannerResponse(oSvpData);

            this._getOrchestrationDeploymentId().then(function (sDeploymentId) {
                if (!sDeploymentId) {
                    console.warn("[SVP-LLM] No orchestration deployment \u2014 falling back to raw.");
                    oAdModel.setProperty(sModelPath + "/formattedResult", sRawHtml);
                    return;
                }
                return that._callOrchestrationLLM(sDeploymentId, sSystemMessage, sUserMessage);
            }).then(function (sContent) {
                if (!sContent) { return; }
                console.log("[SVP-LLM] Enhanced (" + sContent.length + " chars).");
                var sHtml = "<div class='adResponseWrap'>" +
                    "<div class='adRespSection'><strong>Survival Planner \u2014 AI Narrative</strong></div>" +
                    "<div class='adRespRow'>" + sContent + "</div></div>";
                oAdModel.setProperty(sModelPath + "/formattedResult", sHtml);
            }).catch(function (oErr) {
                console.warn("[SVP-LLM] Enhancement failed, falling back to raw narrative:", oErr.message || oErr);
                oAdModel.setProperty(sModelPath + "/formattedResult", sRawHtml);
            });
        },

        /** Build a compact JSON payload for the LLM from the SVP response. */
        _buildSvpLLMPayload: function (oSvpData) {
            var o = {
                caseId: oSvpData.incidentId || "",
                portfolioHeadlineTTS_Weeks: oSvpData.portfolioHeadlineTTS_Weeks,
                kpis: oSvpData.kpis || {},
                narratives: oSvpData.narratives || {},
                recordCount: Array.isArray(oSvpData.records) ? oSvpData.records.length : 0,
                dataSource: oSvpData.dataSource || "",
                calculatedAt: oSvpData.calculatedAt || ""
            };
            if (Array.isArray(oSvpData.records)) {
                o.recordSummaries = oSvpData.records.slice(0, 20).map(function (r) {
                    return {
                        material: r.material || "", plant: r.plant || "",
                        ttsWeeks: r.ttsWeeks, ttrWeeks: r.ttrWeeks,
                        gapWeeks: r.gapWeeks, shortfallQty: r.shortfallQty,
                        weeklyDemand: r.weeklyDemand, usableInventory: r.usableInventory,
                        dataFlags: r.dataFlags || []
                    };
                });
            }
            return o;
        },

        /**
         * Generic orchestration LLM call.  Reusable by any feature that
         * needs a non-streaming completion from SAP AI Core.
         *
         * @param {string} sDeploymentId  - Orchestration deployment ID
         * @param {string} sSystemMessage - System prompt
         * @param {string} sUserMessage   - User prompt
         * @returns {Promise<string>} LLM content string
         */
        _callOrchestrationLLM: function (sDeploymentId, sSystemMessage, sUserMessage) {
            var oComponent = this.getOwnerComponent();
            var sComponentName = oComponent.getManifestObject().getComponentName();
            var sBasePath = sap.ui.require.toUrl(sComponentName.replace(/\./g, "/"));
            var sUrl = sBasePath + "/deployments/" + sDeploymentId + "/completion";

            var oPayload = {
                orchestration_config: {
                    stream: false,
                    module_configurations: {
                        llm_module_config: {
                            model_name: "anthropic--claude-4.5-opus",
                            model_params: { max_tokens: 1500, temperature: 0.2 }
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

            return fetch(sUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "AI-Resource-Group": "default"
                },
                credentials: "same-origin",
                body: JSON.stringify(oPayload)
            }).then(function (response) {
                if (!response.ok) {
                    throw new Error("LLM HTTP " + response.status);
                }
                return response.json();
            }).then(function (data) {
                var sContent = "";
                if (data && data.orchestration_result && data.orchestration_result.choices) {
                    var choices = data.orchestration_result.choices;
                    if (choices.length > 0 && choices[0].message) {
                        sContent = choices[0].message.content || "";
                    }
                } else if (data && data.choices && data.choices.length > 0) {
                    sContent = data.choices[0].message
                        ? data.choices[0].message.content || ""
                        : (data.choices[0].text || "");
                }
                if (!sContent) { throw new Error("Empty LLM response"); }
                return sContent;
            });
        },

        /** System prompt for the SVP narrative LLM call. */
        _buildSvpSystemPrompt: function () {
            return "You are a senior supply chain analyst presenting findings to executive leadership. " +
                "Rewrite the following Survival Planner JSON output into a clear, concise executive narrative. " +
                "Structure the narrative with these sections:\n" +
                "1. **Executive Summary** \u2014 one-sentence headline finding.\n" +
                "2. **Coverage Analysis** \u2014 summarize TTS (Time-To-Survive) findings.\n" +
                "3. **Recovery Outlook** \u2014 summarize TTR (Time-To-Recover) and any gaps.\n" +
                "4. **Risks & Data Gaps** \u2014 highlight data quality issues.\n" +
                "5. **Recommended Actions** \u2014 2\u20133 bullet points.\n\n" +
                "Rules:\n" +
                "- Use ONLY facts from the provided data; do NOT invent numbers.\n" +
                "- Use bullet points and bold headings for readability.\n" +
                "- Keep total length under 250 words.\n" +
                "- Return valid HTML (use <strong>, <ul>, <li>, <p> tags). No markdown.\n" +
                "- Wrap the entire output in a single <div> tag.";
        },

        /**
         * Format the Survival Planner (SVP) response to show only the
         * narratives section — ttsSummary, ttrAssumption, dataGaps.
         *
         * @param {Object} oData - runSurvival SVP response
         * @returns {string} HTML string for the Disruptions agent card
         */
        _formatSurvivalPlannerResponse: function (oData) {
            if (!oData) { return "<div class='adResponseEmpty'>No data.</div>"; }
            var n = oData.narratives || {};
            var aL = [];
            aL.push("<div class='adRespSection'><strong>Survival Planner — Narratives</strong></div>");
            if (n.ttsSummary) {
                aL.push("<div class='adRespRow'><span class='adRespKey'>TTS Summary:</span> <span class='adRespVal'>" + this._escapeHtml(n.ttsSummary) + "</span></div>");
            }
            if (n.ttrAssumption) {
                aL.push("<div class='adRespRow'><span class='adRespKey'>TTR Assumption:</span> <span class='adRespVal'>" + this._escapeHtml(n.ttrAssumption) + "</span></div>");
            }
            if (n.dataGaps) {
                aL.push("<div class='adRespRow'><span class='adRespKey'>Data Gaps:</span> <span class='adRespVal'>" + this._escapeHtml(n.dataGaps) + "</span></div>");
            }
            if (!n.ttsSummary && !n.ttrAssumption && !n.dataGaps) {
                aL.push("<div class='adRespRow'><span class='adRespVal'>No narrative data available.</span></div>");
            }
            return "<div class='adResponseWrap'>" + aL.join("") + "</div>";
        },

        // ═══════════════════════════════════════════════════════════════
        // RECOMMENDATION AGENT — CAP backend proxy to Python agent
        // POST /odata/v4/supplier-resilience/runRecommendation
        //   → server-to-server → POST /recommend-scenario on Python agent
        // ═══════════════════════════════════════════════════════════════
        /**
         * Run the Recommendation Agent via the CAP backend proxy action
         * `runRecommendation`.  This routes the call server-to-server
         * (CAP → Python agent) using the @sap-cloud-sdk/http-client,
         * bypassing the SAP Launchpad managed approuter's ~30-second
         * HTTP timeout that previously caused 504 Gateway Timeout errors.
         */
        _runRecommendationAgent: function () {
            var that = this;
            var oView = this.getView();
            var oAdModel = oView.getModel("agentDisruptions");
            var sCaseId = oAdModel.getProperty("/selectedCaseId");
            var oCaseData = oAdModel.getProperty("/caseData");
            var sP = "/agents/recommendation";

            oAdModel.setProperty(sP + "/busy", true);
            oAdModel.setProperty(sP + "/status", "running");
            oAdModel.setProperty(sP + "/statusText", "\u23F3 Running...");
            oAdModel.setProperty(sP + "/statusClass", "adAgentStatusValue adAgentStatusValue--running");
            oAdModel.setProperty(sP + "/error", null);
            oAdModel.setProperty(sP + "/formattedResult", "");
            MessageToast.show("Running Recommendation Agent for " + sCaseId + "\u2026");

            var oPayload = this._buildRecommendationPayload(sCaseId, oCaseData);

            // Route through the CAP backend action instead of the managed
            // approuter destination to avoid the ~30s Launchpad timeout.
            var sUrl = this._getServiceUrl() + "runRecommendation";

            console.log("[Recommendation] POST (via CAP proxy)", sUrl, oPayload);

            var oRecModel = oView.getModel("recommendationResult");
            if (oRecModel) { oRecModel.setProperty("/busy", true); }

            fetch(sUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                credentials: "include",
                body: JSON.stringify({ payload: JSON.stringify(oPayload) })
            }).then(function (r) {
                if (!r.ok) {
                    return r.text().then(function (b) {
                        throw new Error("HTTP " + r.status + (b ? ": " + b.substring(0, 500) : ""));
                    });
                }
                return r.json();
            }).then(function (oWrapper) {
                // The CAP action returns { success, result (JSON string), error }
                if (!oWrapper.success) {
                    throw new Error(oWrapper.error || "Recommendation Agent returned an error");
                }

                // Parse the JSON-stringified Python agent response
                var oData;
                try {
                    oData = JSON.parse(oWrapper.result);
                } catch (e) {
                    throw new Error("Failed to parse recommendation result: " + e.message);
                }

                console.log("[Recommendation] Response:", oData);
                oAdModel.setProperty(sP + "/busy", false);
                oAdModel.setProperty(sP + "/result", oData);
                oAdModel.setProperty(sP + "/status", "completed");
                oAdModel.setProperty(sP + "/statusText", "\u2713 Completed");
                oAdModel.setProperty(sP + "/statusClass", "adAgentStatusValue adAgentStatusValue--success");

                that._populateRecommendationsFromAgent(oData, sCaseId);

                oAdModel.setProperty(sP + "/formattedResult",
                    "<div class='adResponseWrap'><div class='adRespSection'>" +
                    "<strong>Recommendation Agent \u2014 Generating AI Narrative\u2026</strong></div>" +
                    "<div class='adRespRow'>Analyzing ranked scenarios and composing executive summary.</div></div>");
                that._enhanceRecommendationWithLLM(oData, sP);

                MessageToast.show("Recommendation Agent completed.");
            }).catch(function (oErr) {
                console.error("[Recommendation] Error:", oErr);
                oAdModel.setProperty(sP + "/busy", false);
                oAdModel.setProperty(sP + "/status", "failed");
                oAdModel.setProperty(sP + "/statusText", "\u2715 Failed");
                oAdModel.setProperty(sP + "/statusClass", "adAgentStatusValue adAgentStatusValue--error");
                oAdModel.setProperty(sP + "/error", oErr.message || "Unknown error");
                oAdModel.setProperty(sP + "/formattedResult", "");
                if (oRecModel) { oRecModel.setProperty("/busy", false); }
                MessageToast.show("Recommendation Agent error: " + (oErr.message || "Unknown error"));
            });
        },

        /**
         * Build the payload for the recommend-scenario endpoint from
         * Survival Execution output (SVP result), case-specific materials
         * from getCaseHierarchy, or the survivalPlanning model as a final
         * fallback.
         *
         * Priority:
         *   1. Survival Planner agent result (real SVP execution output)
         *   2. Case-specific materials from getCaseHierarchy (stored in
         *      agentDisruptions /materials)
         *   3. survivalPlanning model (fallback / mock data)
         *
         * @param {string} sCaseId   - Active case ID
         * @param {Object} oCaseData - Case data from agentDisruptions model
         * @returns {Object} Payload for /recommend-scenario
         */
        _buildRecommendationPayload: function (sCaseId, oCaseData) {
            var oView = this.getView();
            var oAdModel = oView.getModel("agentDisruptions");
            var oSP = oView.getModel("survivalPlanning");
            var oSvpResult = oAdModel ? oAdModel.getProperty("/agents/survivalPlanner/result") : null;

            var aRecords = [], nPortfolioTts = 2, nGapWeeks = 5;
            var sAffectedMaterial = "", sAffectedPlant = "";

            // ── Source 1: Survival Planner agent execution output ─────────
            // Best source — contains computed TTS, TTR, gap and shortfall
            // per plant × material from real S/4HANA data.
            if (oSvpResult && Array.isArray(oSvpResult.records) && oSvpResult.records.length > 0) {
                aRecords = oSvpResult.records;
                nPortfolioTts = oSvpResult.portfolioHeadlineTTS_Weeks || 2;
                var oKpis = oSvpResult.kpis || {};
                var oWorstGap = oKpis.worstGap || {};
                nGapWeeks = oWorstGap.weeks || (aRecords[0] && aRecords[0].gapWeeks) || 5;
                sAffectedMaterial = aRecords[0].material || "";
                sAffectedPlant = aRecords[0].plant || "";
            }

            // ── Source 2: Case-specific materials from getCaseHierarchy ───
            // If SVP hasn't been run (or had no records), use the case's
            // actual material/plant data loaded from the DB via
            // getCaseHierarchy and stored in the agentDisruptions model.
            if (!sAffectedMaterial && !sAffectedPlant && oAdModel) {
                var aCaseMaterials = oAdModel.getProperty("/materials") || [];
                if (aCaseMaterials.length > 0) {
                    sAffectedMaterial = aCaseMaterials[0].material || "";
                    sAffectedPlant = aCaseMaterials[0].plant || "";
                    if (aRecords.length === 0) {
                        aRecords = aCaseMaterials;
                    }
                }
            }

            // ── Source 3: survivalPlanning model (final fallback) ─────────
            // Only used when neither SVP results nor case hierarchy
            // materials are available.
            if (!sAffectedMaterial && !sAffectedPlant && oSP) {
                var aSPMaterials = oSP.getProperty("/materials") || [];
                if (aSPMaterials.length > 0) {
                    sAffectedMaterial = aSPMaterials[0].material || "";
                    sAffectedPlant = aSPMaterials[0].plant || "";
                    nPortfolioTts = aSPMaterials[0].ttsWeeks || 2;
                    nGapWeeks = aSPMaterials[0].gapWeeks || 5;
                    if (aRecords.length === 0) {
                        aRecords = aSPMaterials;
                    }
                }
            }

            // Read suppliers from the agentDisruptions model (stored separately
            // from caseData by _loadCaseDataForAgentDisruptions from the
            // getCaseHierarchy response's top-level suppliers array).
            var sDisruptedSupplier = "";
            var aSuppliers = oAdModel ? oAdModel.getProperty("/suppliers") || [] : [];
            if (aSuppliers.length > 0) {
                sDisruptedSupplier = aSuppliers[0].supplierId || aSuppliers[0].name || "";
            }

            var aTtsPerPM = [];
            var aSource = (oSvpResult && Array.isArray(oSvpResult.records)) ? oSvpResult.records : aRecords;
            for (var i = 0; i < aSource.length; i++) {
                var r = aSource[i];
                aTtsPerPM.push({
                    plant: r.plant || sAffectedPlant || "DC01",
                    material: r.material || sAffectedMaterial || "",
                    ttsWeeks: r.ttsWeeks || nPortfolioTts || 2
                });
            }
            if (aTtsPerPM.length === 0) {
                aTtsPerPM.push({ plant: sAffectedPlant || "DC01", material: sAffectedMaterial || "", ttsWeeks: nPortfolioTts });
            }

            return {
                incidentId: sCaseId,
                affectedMaterial: sAffectedMaterial,
                affectedPlant: sAffectedPlant,
                disruptedSupplier: sDisruptedSupplier,
                gapMagnitudeWeeks: nGapWeeks,
                portfolioHeadlineTts: nPortfolioTts,
                ttsPerPlantMaterial: aTtsPerPM
            };
        },

        /**
         * Populate the recommendationResult model from the
         * recommend-scenario API response for the Recommendations nav view.
         */
        _populateRecommendationsFromAgent: function (oData, sCaseId) {
            var oRecModel = this.getView().getModel("recommendationResult");
            if (!oRecModel || !oData) { return; }
            var aRanked = Array.isArray(oData.rankedOptionList) ? oData.rankedOptionList : [];
            aRanked.forEach(function (opt) {
                var sRisk = (opt.risk || "").toUpperCase();
                opt.riskState = sRisk === "LOW" ? "Success" : sRisk === "MEDIUM" ? "Warning" : sRisk === "HIGH" ? "Error" : "None";
                opt.isTopRecommendation = (opt.rank === 1);
            });
            oRecModel.setData({
                busy: false, hasResult: true, caseId: sCaseId,
                incidentId: oData.incidentId || sCaseId,
                topRecommendation: oData.topRecommendation || (aRanked.length > 0 ? { rank: 1, lever: aRanked[0].lever } : null),
                rankedOptionList: aRanked,
                weightMatrix: oData.weightMatrix || null,
                portfolioHeadlineTts: oData.portfolioHeadlineTts || null,
                gapMagnitudeWeeks: oData.gapMagnitudeWeeks || null,
                agentId: oData.agentId || "SCN",
                timestamp: oData.timestamp || null,
                aiNarrative: null
            });
            console.log("[Recommendations] Populated from agent:", aRanked.length, "ranked options");
        },

        /**
         * Load persisted recommendation results from the RecommendationResults
         * OData entity for the given case ID. If a persisted result exists, the
         * recommendationResult model is populated; otherwise it is reset to the
         * empty state.
         *
         * This is called when the user switches cases on the Recommendations
         * tab or navigates to the approvals screen.
         *
         * @param {string} sCaseId - The case identifier
         */
        _loadPersistedExecutionItems: function (sCaseId) {
            var oExecModel = this.getView().getModel("execution");
            if (!oExecModel) { return; }

            // Reset while loading
            oExecModel.setData({
                executionItems: [], stoCreatedCount: 0, poCreatedCount: 0,
                failedCount: 0, pendingCount: 0, totalCount: 0
            });

            if (!sCaseId) { return; }

            var sUrl = this._getServiceUrl() +
                "ExecutionItems?$filter=caseId eq '" + encodeURIComponent(sCaseId) +
                "'&$orderby=createdAt desc";

            fetch(sUrl, {
                method: "GET",
                headers: { "Accept": "application/json" },
                credentials: "include"
            }).then(function (oResp) {
                if (!oResp.ok) { throw new Error("HTTP " + oResp.status); }
                return oResp.json();
            }).then(function (oBody) {
                var aResults = oBody.value || [];
                if (aResults.length === 0) {
                    console.log("[Execution] No persisted items for case", sCaseId);
                    return;
                }

                var iSto = 0, iPo = 0, iFailed = 0;
                var aItems = aResults.map(function (row, idx) {
                    var sStatus = row.status || "Confirmed";
                    if (row.orderType === "STO") { iSto++; }
                    if (row.orderType === "PO") { iPo++; }
                    if (sStatus === "Failed") { iFailed++; }
                    return {
                        id: row.actionId || ("EXC-" + String(idx + 1).padStart(3, "0")),
                        caseId: row.caseId || sCaseId,
                        orderType: row.orderType || "",
                        type: row.type || "",
                        material: row.material || "",
                        plant: row.plant || "",
                        quantity: row.quantity || 0,
                        poNumber: row.poNumber || "",
                        status: sStatus,
                        strategy: row.strategy || "",
                        time: row.completedAt
                            ? new Date(row.completedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
                            : "",
                        error: row.error || ""
                    };
                });

                oExecModel.setData({
                    executionItems: aItems,
                    stoCreatedCount: iSto,
                    poCreatedCount: iPo,
                    failedCount: iFailed,
                    pendingCount: 0,
                    totalCount: aItems.length
                });
                console.log("[Execution] Loaded", aItems.length, "persisted item(s) for case", sCaseId);
            }).catch(function (oErr) {
                console.warn("[Execution] Failed to load persisted items:", oErr.message || oErr);
            });
        },

        _loadPersistedRecommendations: function (sCaseId) {
            var that = this;
            var oRecModel = this.getView().getModel("recommendationResult");
            if (!oRecModel) { return; }

            // Set busy + reset while loading
            oRecModel.setData({
                busy: true, hasResult: false, caseId: sCaseId,
                incidentId: null, topRecommendation: null,
                rankedOptionList: [], weightMatrix: null,
                portfolioHeadlineTts: null, gapMagnitudeWeeks: null,
                agentId: null, timestamp: null, aiNarrative: null
            });

            var sUrl = this._getServiceUrl() +
                "RecommendationResults?$filter=caseId eq '" + encodeURIComponent(sCaseId) +
                "'&$orderby=createdAt desc&$top=1";

            fetch(sUrl, {
                method: "GET",
                headers: { "Accept": "application/json" },
                credentials: "include"
            }).then(function (oResp) {
                if (!oResp.ok) { throw new Error("HTTP " + oResp.status); }
                return oResp.json();
            }).then(function (oBody) {
                var aResults = (oBody.value || oBody.d && oBody.d.results || []);
                if (aResults.length === 0) {
                    // No persisted data — show empty state
                    oRecModel.setProperty("/busy", false);
                    console.log("[Recommendations] No persisted data for case", sCaseId);
                    return;
                }

                var oRow = aResults[0];
                var aRanked = [];
                try { aRanked = JSON.parse(oRow.rankedOptionList || "[]"); } catch (e) { /* ignore */ }
                var oTop = null;
                try { oTop = JSON.parse(oRow.topRecommendation || "null"); } catch (e) { /* ignore */ }
                var oWM = null;
                try { oWM = JSON.parse(oRow.weightMatrix || "null"); } catch (e) { /* ignore */ }

                // Enrich ranked options with UI state (same logic as _populateRecommendationsFromAgent)
                aRanked.forEach(function (opt) {
                    var sRisk = (opt.risk || "").toUpperCase();
                    opt.riskState = sRisk === "LOW" ? "Success" : sRisk === "MEDIUM" ? "Warning" : sRisk === "HIGH" ? "Error" : "None";
                    opt.isTopRecommendation = (opt.rank === 1);
                });

                oRecModel.setData({
                    busy: false, hasResult: true, caseId: sCaseId,
                    incidentId: oRow.incidentId || sCaseId,
                    topRecommendation: oTop || (aRanked.length > 0 ? { rank: 1, lever: aRanked[0].lever } : null),
                    rankedOptionList: aRanked,
                    weightMatrix: oWM,
                    portfolioHeadlineTts: oRow.portfolioHeadlineTts || null,
                    gapMagnitudeWeeks: oRow.gapMagnitudeWeeks || null,
                    agentId: oRow.agentId || "SCN",
                    timestamp: oRow.calculatedAt || null,
                    aiNarrative: oRow.aiNarrative || null
                });
                console.log("[Recommendations] Loaded persisted data for case", sCaseId,
                    "—", aRanked.length, "ranked option(s)");
            }).catch(function (oErr) {
                console.warn("[Recommendations] Failed to load persisted data:", oErr.message || oErr);
                oRecModel.setProperty("/busy", false);
            });
        },

        /**
         * Enhance the Recommendation Agent response using the LLM.
         * @param {Object} oData      - recommend-scenario response
         * @param {string} sModelPath - e.g. "/agents/recommendation"
         */
        _enhanceRecommendationWithLLM: function (oData, sModelPath) {
            var that = this;
            var oAdModel = this.getView().getModel("agentDisruptions");
            var oRecModel = this.getView().getModel("recommendationResult");
            if (!oAdModel) { return; }
            console.log("[REC-LLM] Starting recommendation narrative enhancement\u2026");
            var oCompact = this._buildRecommendationLLMPayload(oData);
            var sSystemMessage = this._buildRecommendationSystemPrompt();
            var sUserMessage = JSON.stringify(oCompact);
            var sRawHtml = that._formatRecommendationResponse(oData);
            this._getOrchestrationDeploymentId().then(function (sDeploymentId) {
                if (!sDeploymentId) {
                    console.warn("[REC-LLM] No orchestration deployment \u2014 falling back to raw.");
                    oAdModel.setProperty(sModelPath + "/formattedResult", sRawHtml);
                    return;
                }
                return that._callOrchestrationLLM(sDeploymentId, sSystemMessage, sUserMessage);
            }).then(function (sContent) {
                if (!sContent) { return; }
                console.log("[REC-LLM] Enhanced (" + sContent.length + " chars).");
                var sHtml = "<div class='adResponseWrap'>" +
                    "<div class='adRespSection'><strong>Recommendation Agent \u2014 AI Narrative</strong></div>" +
                    "<div class='adRespRow'>" + sContent + "</div></div>";
                oAdModel.setProperty(sModelPath + "/formattedResult", sHtml);
                if (oRecModel) { oRecModel.setProperty("/aiNarrative", sContent); }
            }).catch(function (oErr) {
                console.warn("[REC-LLM] Enhancement failed, falling back to raw:", oErr.message || oErr);
                oAdModel.setProperty(sModelPath + "/formattedResult", sRawHtml);
            });
        },

        /** Build a compact JSON payload for the LLM from the recommendation response. */
        _buildRecommendationLLMPayload: function (oData) {
            var aRanked = Array.isArray(oData.rankedOptionList) ? oData.rankedOptionList : [];
            return {
                incidentId: oData.incidentId || "",
                gapMagnitudeWeeks: oData.gapMagnitudeWeeks || 0,
                portfolioHeadlineTts: oData.portfolioHeadlineTts || 0,
                weightMatrix: oData.weightMatrix || {},
                topRecommendation: oData.topRecommendation || {},
                optionCount: aRanked.length,
                rankedOptions: aRanked.map(function (o) {
                    return { rank: o.rank, lever: o.lever, coverage: o.coverage,
                        cost: o.cost, risk: o.risk, rationale: o.rationale,
                        goScenario: o.goScenario, noGo: o.noGo };
                })
            };
        },

        /** System prompt for the Recommendation narrative LLM call. */
        _buildRecommendationSystemPrompt: function () {
            return "You are a senior supply chain strategist presenting scenario recommendations to executive leadership. " +
                "Rewrite the following Recommendation Agent JSON output into a clear, concise executive narrative. " +
                "Structure the narrative with these sections:\n" +
                "1. **Executive Summary** \u2014 one-sentence headline finding with the top recommendation.\n" +
                "2. **Top Recommendation** \u2014 detail the #1 ranked option (coverage, cost, risk, rationale).\n" +
                "3. **Alternative Options** \u2014 briefly summarize remaining ranked options.\n" +
                "4. **Weight Matrix** \u2014 explain how options were scored (coverage/cost/risk weights).\n" +
                "5. **Recommended Next Steps** \u2014 2\u20133 bullet points.\n\n" +
                "Rules:\n" +
                "- Use ONLY facts from the provided data; do NOT invent numbers.\n" +
                "- Use bullet points and bold headings for readability.\n" +
                "- Keep total length under 300 words.\n" +
                "- Return valid HTML (use <strong>, <ul>, <li>, <p> tags). No markdown.\n" +
                "- Wrap the entire output in a single <div> tag.";
        },

        /**
         * Format the Recommendation Agent response into readable HTML
         * for the Disruptions agent card (raw fallback).
         * @param {Object} oData - recommend-scenario response
         * @returns {string} HTML string
         */
        _formatRecommendationResponse: function (oData) {
            if (!oData) { return "<div class='adResponseEmpty'>No data.</div>"; }
            var that = this, aL = [];
            aL.push("<div class='adRespSection'><strong>Recommendation Agent \u2014 Scenario Analysis</strong></div>");
            var oTop = oData.topRecommendation;
            if (oTop) {
                aL.push("<div class='adRespRow'><span class='adRespKey'>Top Recommendation:</span> <span class='adRespVal'>#" +
                    that._escapeHtml(String(oTop.rank || 1)) + " \u2014 " + that._escapeHtml(oTop.lever || "") + "</span></div>");
            }
            if (oData.gapMagnitudeWeeks) {
                aL.push("<div class='adRespRow'><span class='adRespKey'>Gap Magnitude:</span> <span class='adRespVal'>" +
                    that._escapeHtml(String(oData.gapMagnitudeWeeks)) + " weeks</span></div>");
            }
            if (oData.portfolioHeadlineTts) {
                aL.push("<div class='adRespRow'><span class='adRespKey'>Portfolio Headline TTS:</span> <span class='adRespVal'>" +
                    that._escapeHtml(String(oData.portfolioHeadlineTts)) + " weeks</span></div>");
            }
            var oWM = oData.weightMatrix;
            if (oWM) {
                aL.push("<div class='adRespSection'><strong>Weight Matrix</strong></div>");
                aL.push("<div class='adRespRow' style='margin-left:0.5rem'><span class='adRespKey'>Coverage:</span> <span class='adRespVal'>" + (oWM.coverage || 0) + "</span></div>");
                aL.push("<div class='adRespRow' style='margin-left:0.5rem'><span class='adRespKey'>Cost:</span> <span class='adRespVal'>" + (oWM.cost || 0) + "</span></div>");
                aL.push("<div class='adRespRow' style='margin-left:0.5rem'><span class='adRespKey'>Risk:</span> <span class='adRespVal'>" + (oWM.risk || 0) + "</span></div>");
            }
            var aRanked = Array.isArray(oData.rankedOptionList) ? oData.rankedOptionList : [];
            if (aRanked.length > 0) {
                aL.push("<div class='adRespSection'><strong>Ranked Options (" + aRanked.length + ")</strong></div>");
                aRanked.forEach(function (opt) {
                    aL.push("<div class='adRespRow' style='margin-left:0.5rem;margin-top:0.25rem'><em>#" + (opt.rank || "") + " \u2014 " + that._escapeHtml(opt.lever || "") + "</em></div>");
                    aL.push("<div class='adRespRow' style='margin-left:1rem'><span class='adRespKey'>Coverage:</span> <span class='adRespVal'>" + that._escapeHtml(opt.coverage || "") + "</span></div>");
                    aL.push("<div class='adRespRow' style='margin-left:1rem'><span class='adRespKey'>Cost:</span> <span class='adRespVal'>" + that._escapeHtml(opt.cost || "") + "</span></div>");
                    aL.push("<div class='adRespRow' style='margin-left:1rem'><span class='adRespKey'>Risk:</span> <span class='adRespVal'>" + that._escapeHtml(opt.risk || "") + "</span></div>");
                    aL.push("<div class='adRespRow' style='margin-left:1rem'><span class='adRespKey'>Rationale:</span> <span class='adRespVal'>" + that._escapeHtml(opt.rationale || "") + "</span></div>");
                });
            }
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

                    // Collect plant names and material display names from all affected suppliers
                    var aPlantNames = [];
                    var aMaterialDisplayNames = [];
                    aAffSuppliers.forEach(function (s) {
                        var aPOs = Array.isArray(s.purchase_orders) ? s.purchase_orders : [];
                        aPOs.forEach(function (po) {
                            var aMats = Array.isArray(po.materials) ? po.materials : [];
                            aMats.forEach(function (m) {
                                if (m.plant && aPlantNames.indexOf(m.plant) === -1) { aPlantNames.push(m.plant); }
                                var sMatDisplay = m.material_description || m.material || "";
                                if (sMatDisplay && aMaterialDisplayNames.indexOf(sMatDisplay) === -1) { aMaterialDisplayNames.push(sMatDisplay); }
                            });
                        });
                    });

                    // First affected supplier name (for the summary)
                    var sFirstSupplier = (aAffSuppliers.length > 0 && aAffSuppliers[0].name)
                        ? aAffSuppliers[0].name : "Unknown";

                    // Use actual risk score from the API response when available.
                    // The analyzeImpact backend intentionally defers risk scoring
                    // (all per-supplier risk_percentage / risk_score fields are null),
                    // so we first check top-level + per-supplier fields, then fall
                    // back to a proxy score derived from the disruption scope
                    // (affected suppliers, POs, materials).
                    var iApiRisk = oResult.riskPercentage || oResult.riskScore || oResult.risk_score || 0;
                    if (!iApiRisk && aAffSuppliers.length > 0) {
                        aAffSuppliers.forEach(function (s) {
                            var sp = s.risk_percentage || s.riskPercentage || s.risk_score || 0;
                            if (sp > iApiRisk) { iApiRisk = sp; }
                        });
                    }
                    // Proxy score from disruption scope when all API risk fields are null/0
                    if (!iApiRisk) {
                        var iSupFactor  = Math.min(aAffSuppliers.length * 20, 60);
                        var iPoFactor   = Math.min((oScope.poCount || 0) * 5, 30);
                        var iMatFactor  = Math.min((oScope.materialCount || 0) * 2, 10);
                        iApiRisk = Math.min(iSupFactor + iPoFactor + iMatFactor, 100);
                        if (iApiRisk === 0 && aAffSuppliers.length > 0) { iApiRisk = 10; }
                    }
                    oDisruptions.setProperty("/impactPreview", {
                        impactType: (oSelectedRisk.title || oResult.impact_description || "Supply disruption"),
                        riskScore:  String(iApiRisk) + "/100",
                        estimatedImpact: "$" + (oScope.poCount * 0.6 || 0).toFixed(1) + "M",
                        supplierName: sFirstSupplier +
                            (aAffSuppliers.length > 1 ? " (+" + (aAffSuppliers.length - 1) + " more)" : ""),
                        posAtRisk:  oScope.poCount + " at risk",
                        plants:     aPlantNames.join(", ") || "—",
                        materials:  aMaterialDisplayNames.join(", ") || "—"
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
                        materials: oScope.materialCount,
                        // Hover tooltips for IMPACT METRICS (same style as news feed)
                        supplierTooltip: that._buildSupplierTooltip(oScope),
                        poTooltip:       that._buildPoTooltip(oScope),
                        plantTooltip:    that._buildPlantTooltip(oScope),
                        materialTooltip: that._buildMaterialTooltip(oScope)
                    });

                    // Populate the classified disruption type shown in the
                    // AiAssistantCard "TYPE" row.
                    oDisruptions.setProperty("/classifiedType",
                        oSelectedRisk.classification ||
                        oResult.impact_description ||
                        "Supply Disruption");

                    // Write a summary sub-object onto /result so the
                    // DisruptionsView IMPACT SUMMARY panel can bind to
                    // disruptions>/result/summary/suppliers|pos|plants|materials.
                    oDisruptions.setProperty("/result/summary", {
                        suppliers: oScope.supplierCount,
                        pos:       oScope.poCount,
                        plants:    oScope.plantCount,
                        materials: oScope.materialCount
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
         * Also collects detail arrays for the hover tooltip on each
         * news-feed risk card: supplier names, PO numbers, material
         * descriptions, and plant codes.
         *
         * @param {Object} oResult - analyzeImpact response payload
         * @returns {Object} { poCount, plantCount, skuCount, supplierCount,
         *                     materialCount, supplierDetails, poNumbers,
         *                     materialDetails, plantCodes }
         */
        _computeDisruptionScope: function (oResult) {
            var aSuppliers = (oResult && Array.isArray(oResult.affected_suppliers))
                ? oResult.affected_suppliers : [];
            var iSupplierCount = aSuppliers.length;
            var iPoCount = 0;
            var oPlantSet = {};
            var oSkuSet = {};
            var oMaterialSet = {};

            // Detail arrays for hover tooltip
            var aSupplierDetails = [];   // [{ id, name }]
            var aPoNumbers = [];         // ["4500000123", …]
            var oMaterialDetailMap = {}; // keyed by material code → description
            // oPlantSet already tracks unique plant codes

            aSuppliers.forEach(function (s) {
                // Collect supplier id + name (description)
                if (s.supplier_id || s.name) {
                    aSupplierDetails.push({
                        id:   s.supplier_id || "",
                        name: s.name || ""
                    });
                }

                var aPOs = Array.isArray(s.purchase_orders) ? s.purchase_orders : [];
                iPoCount += aPOs.length;
                aPOs.forEach(function (po) {
                    // Collect PO number
                    if (po.po_number && aPoNumbers.indexOf(po.po_number) === -1) {
                        aPoNumbers.push(po.po_number);
                    }
                    var aMats = Array.isArray(po.materials) ? po.materials : [];
                    aMats.forEach(function (m) {
                        if (m.plant)    { oPlantSet[m.plant]        = true; }
                        if (m.sku)      { oSkuSet[m.sku]            = true; }
                        if (m.material) {
                            oMaterialSet[m.material] = true;
                            // Store best available description per material
                            if (!oMaterialDetailMap[m.material]) {
                                oMaterialDetailMap[m.material] = m.material_description || "";
                            }
                        }
                    });
                });
            });

            // Build material detail array from the map
            var aMaterialDetails = Object.keys(oMaterialDetailMap).map(function (sCode) {
                return { code: sCode, description: oMaterialDetailMap[sCode] };
            });

            return {
                supplierCount: iSupplierCount,
                poCount:       iPoCount,
                plantCount:    Object.keys(oPlantSet).length,
                skuCount:      Object.keys(oSkuSet).length,
                // Distinct material master count. Fall back to SKU count if
                // the API didn't return `material` on the item level.
                materialCount: Object.keys(oMaterialSet).length || Object.keys(oSkuSet).length,
                // Detail arrays for hover tooltip
                supplierDetails: aSupplierDetails,
                poNumbers:       aPoNumbers,
                materialDetails: aMaterialDetails,
                plantCodes:      Object.keys(oPlantSet)
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
            oDashboard.setProperty(sBasePath + "supplierCount", oScope.supplierCount || 0);

            // Build per-category hover tooltip strings from the detail
            // arrays so each count chip (POs, Materials, Plants, Suppliers)
            // has its own tooltip on mouse-over.
            oDashboard.setProperty(sBasePath + "poTooltip",       this._buildPoTooltip(oScope));
            oDashboard.setProperty(sBasePath + "materialTooltip", this._buildMaterialTooltip(oScope));
            oDashboard.setProperty(sBasePath + "plantTooltip",    this._buildPlantTooltip(oScope));
            oDashboard.setProperty(sBasePath + "supplierTooltip", this._buildSupplierTooltip(oScope));
        },

        /**
         * Build tooltip for the POs count chip.
         * Lists each affected PO number.
         *
         * @param {Object} oScope - Output of _computeDisruptionScope
         * @returns {string} Tooltip text
         */
        _buildPoTooltip: function (oScope) {
            var aPOs = oScope.poNumbers || [];
            if (aPOs.length === 0) { return ""; }
            return "Affected POs:\n" + aPOs.join("\n");
        },

        /**
         * Build tooltip for the Materials count chip.
         * Lists each material with its description (when available) and code.
         *
         * @param {Object} oScope - Output of _computeDisruptionScope
         * @returns {string} Tooltip text
         */
        _buildMaterialTooltip: function (oScope) {
            var aMaterials = oScope.materialDetails || [];
            if (aMaterials.length === 0) { return ""; }
            var aItems = aMaterials.map(function (m) {
                return m.description ? m.description + " (" + m.code + ")" : m.code;
            });
            return "Affected Materials:\n" + aItems.join("\n");
        },

        /**
         * Build tooltip for the Plants count chip.
         * Lists each plant code. The S/4HANA PO API does not return a
         * plant description, so we prefix with "Plant" for clarity.
         *
         * @param {Object} oScope - Output of _computeDisruptionScope
         * @returns {string} Tooltip text
         */
        _buildPlantTooltip: function (oScope) {
            var aPlants = oScope.plantCodes || [];
            if (aPlants.length === 0) { return ""; }
            var aItems = aPlants.map(function (sCode) {
                return "Plant " + sCode;
            });
            return "Affected Plants:\n" + aItems.join("\n");
        },

        /**
         * Build tooltip for the Suppliers count chip.
         * Lists each supplier with its name/description and ID.
         *
         * @param {Object} oScope - Output of _computeDisruptionScope
         * @returns {string} Tooltip text
         */
        _buildSupplierTooltip: function (oScope) {
            var aSuppliers = oScope.supplierDetails || [];
            if (aSuppliers.length === 0) { return ""; }
            var aItems = aSuppliers.map(function (s) {
                return s.name ? s.name + " (" + s.id + ")" : s.id;
            });
            return "Affected Suppliers:\n" + aItems.join("\n");
        },

        // ── Case Dropdown + Risk / Survival helpers ────────────────

        /** Fetch all cases from HANA for the case selector dropdowns. */
        _loadAvailableCases: function () {
            var oCH = this.getView().getModel("caseHierarchy");
            if (!oCH) return;
            oCH.setProperty("/availableCasesBusy", true);
            fetch(this._getServiceUrl() + "Cases?$orderby=createdAt desc", {
                method: "GET", headers: { "Accept": "application/json" }, credentials: "include"
            }).then(function (r) { return r.ok ? r.json() : { value: [] }; })
              .then(function (d) {
                var aCases = ((d && d.value) || [])
                    // Filter out old CASE-10xx format cases
                    .filter(function (c) {
                        var id = c.caseId || "";
                        return id.indexOf("CASE-100") !== 0 && id.indexOf("CASE-101") !== 0;
                    })
                    .map(function (c) {
                        // Clean eventTitle: remove meaningless values like "—", "\u2014", empty
                        var sTitle = c.eventTitle || "";
                        if (sTitle === "\u2014" || sTitle === "—" || sTitle.trim() === "") {
                            sTitle = "";
                        }
                        return { caseId: c.caseId||"", eventTitle: sTitle, severity: c.severity||"", status: c.status||"", riskScore: c.riskScore||0, region: c.region||"" };
                    });
                oCH.setProperty("/availableCases", aCases);
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
            if (sV === "audit") this._loadCaseDataForMonitoring(sC);
            if (sV === "approvals") {
                // Try to load persisted recommendations for the new case.
                // If none are found the model stays in its empty state.
                this._loadPersistedRecommendations(sC);
                // Also load case hierarchy into agentDisruptions so that
                // /materials and /suppliers are available when the user
                // clicks Approve to create an STO or PO.
                this._loadCaseDataForAgentDisruptions(sC);
            }
            if (sV === "planning") {
                this._loadPersistedExecutionItems(sC);
            }
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
                var aPOs=Array.isArray(s.purchase_orders)?s.purchase_orders:[],pl=[],ml=[];
                aPOs.forEach(function(po){(Array.isArray(po.materials)?po.materials:[]).forEach(function(m){if(m.plant&&pl.indexOf(m.plant)===-1)pl.push(m.plant);var md=m.material_description||m.material||"";if(md&&ml.indexOf(md)===-1)ml.push(md);});});
                // Use actual risk_score / risk_percentage from the API when available
                var n=s.po_count||aPOs.length;
                var sc=s.risk_percentage||s.risk_score||oResult.riskPercentage||oResult.riskScore||0;
                sc=Math.min(sc,100);if(sc>iMax){iMax=sc;sMaxSup=s.name||s.supplier_id||"";}
                var sev=sc>=80?"CRITICAL":sc>=60?"HIGH":sc>=40?"MEDIUM":"LOW";
                var rl=(s.risk_level||oResult.riskLevel||"").toUpperCase();
                if(rl==="CRITICAL"||rl==="HIGH"||rl==="MEDIUM"||rl==="LOW") sev=rl;
                var cls=sev==="CRITICAL"?"COMPLETE INTERRUPTION":sev==="HIGH"?"DELAYED SUPPLY":"PARTIAL DISRUPTION";
                return{supplier:s.name||s.supplier_id||"Unknown",supplierId:s.supplier_id||"",classification:cls,riskScore:sc+"/100",riskScoreRaw:sc,severity:sev,posAtRisk:String(n),plants:pl.join(", ")||"—",materials:ml.join(", ")||"—"};
            });
            aRows.sort(function(a,b){return b.riskScoreRaw-a.riskScoreRaw;});
            oRM.setProperty("/kpi",{highestRisk:{value:iMax,supplier:sMaxSup},suppliersImpacted:{value:String(oScope.supplierCount),sub:"Affected by event"},posAtRisk:{value:String(oScope.poCount),sub:"At risk"},plants:{value:String(oScope.plantCount),sub:"Affected"}});
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
            var oRM = this.getView().getModel("riskAssessment");
            if (!oRM) { return; }
            var cd = oH.caseData || {}, aS = oH.suppliers || [],
                aPOs = oH.purchaseOrders || [], aM = oH.materials || [];

            // Index POs and materials by supplierId
            var poBy = {}, matBy = {};
            aPOs.forEach(function (p) {
                var k = p.supplierId || "";
                if (!poBy[k]) { poBy[k] = []; }
                poBy[k].push(p);
            });
            aM.forEach(function (m) {
                var k = m.supplierId || "";
                if (!matBy[k]) { matBy[k] = []; }
                matBy[k].push(m);
            });

            var caseScore = parseInt(String(cd.riskScore || 0).split("/")[0], 10) || 0;
            var caseSev = (cd.severity || "").toUpperCase();
            var iMax = caseScore, sMax = "", tPOs = 0, pSet = {};

            var aRows = aS.map(function (s) {
                var sid = s.supplierId || "";
                var sp = poBy[sid] || [], sm = matBy[sid] || [];
                var pl = [], ml = [];
                sm.forEach(function (m) {
                    if (m.plant && pl.indexOf(m.plant) === -1) { pl.push(m.plant); pSet[m.plant] = 1; }
                    // Use materialDescription when available, fall back to material ID
                    var md = m.materialDescription || m.material || "";
                    if (md && ml.indexOf(md) === -1) { ml.push(md); }
                });
                var n = s.poCount || sp.length;
                tPOs += n;

                // Use the case-level riskScore directly for each supplier
                // (the hierarchy doesn't store per-supplier scores)
                var sc = caseScore;
                if (sc > iMax) { iMax = sc; }
                if (sc >= iMax) { sMax = s.name || sid; }

                // Use the case-level severity when available
                var sev = caseSev;
                if (sev !== "CRITICAL" && sev !== "HIGH" && sev !== "MEDIUM" && sev !== "LOW") {
                    sev = sc >= 80 ? "CRITICAL" : sc >= 60 ? "HIGH" : sc >= 40 ? "MEDIUM" : "LOW";
                }

                var cls = cd.classification || (sev === "CRITICAL" ? "COMPLETE INTERRUPTION" : sev === "HIGH" ? "DELAYED SUPPLY" : "PARTIAL DISRUPTION");
                return {
                    supplier: s.name || sid, supplierId: sid,
                    classification: cls, riskScore: sc,
                    riskScoreRaw: sc, severity: sev,
                    posAtRisk: String(n),
                    plants: pl.join(", ") || "—",
                    materials: ml.join(", ") || "—"
                };
            });

            aRows.sort(function (a, b) { return b.riskScoreRaw - a.riskScoreRaw; });
            oRM.setProperty("/kpi", {
                highestRisk:      { value: iMax, supplier: sMax || "—" },
                suppliersImpacted: { value: String(aS.length), sub: "Affected by event" },
                posAtRisk:        { value: String(tPOs), sub: "At risk" },
                plants:           { value: String(Object.keys(pSet).length), sub: "Affected" }
            });
            oRM.setProperty("/supplierRisks", aRows);
        },
        /**
         * Load case data for Survival Planning by calling the S/4HANA-
         * integrated runSurvival action (POST).  Falls back to the
         * hierarchy-based mapper if the SVP call fails.
         */
        _loadCaseDataForSurvivalPlanning: function (sId) {
            var t = this;
            if (!sId) { return; }
            fetch(this._getServiceUrl() + "runSurvival", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                credentials: "include",
                body: JSON.stringify({ caseId: sId })
            }).then(function (r) {
                if (!r.ok) {
                    return r.text().then(function (b) {
                        throw new Error("HTTP " + r.status + (b ? ": " + b.substring(0, 500) : ""));
                    });
                }
                return r.json();
            }).then(function (oData) {
                if (oData && oData.success !== false) {
                    t._populateSurvivalPlanningFromSVP(oData);
                } else {
                    console.warn("[SP] runSurvival returned error, falling back to hierarchy:", oData && oData.error);
                    t._loadSurvivalPlanningFallback(sId);
                }
            }).catch(function (e) {
                console.warn("[SP] runSurvival call failed, falling back to hierarchy:", e);
                t._loadSurvivalPlanningFallback(sId);
            });
        },

        /** Fallback: populate Survival Planning from getCaseHierarchy when SVP is unavailable. */
        _loadSurvivalPlanningFallback: function (sId) {
            var t = this;
            if (!sId) { return; }
            fetch(this._getServiceUrl() + "getCaseHierarchy(caseId='" + encodeURIComponent(sId) + "')", {
                method: "GET", headers: { "Accept": "application/json" }, credentials: "include"
            }).then(function (r) {
                if (!r.ok) { throw new Error("HTTP " + r.status); }
                return r.json();
            }).then(function (d) {
                if (d && d.success !== false) { t._populateSPFromHierarchy(d); }
            }).catch(function (e) { console.error("[SP] Fallback load failed:", e); });
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

        /**
         * Populate the survivalPlanning model from a runSurvival (SVP)
         * response.  Called after the Survival Planner agent completes
         * in the Disruptions tab so the Survival Planning navigation
         * tab is kept in sync with real S/4HANA data.
         *
         * @param {Object} oData - runSurvival response (SVP output)
         */
        _populateSurvivalPlanningFromSVP: function (oData) {
            var oSP = this.getView().getModel("survivalPlanning");
            if (!oSP || !oData) { return; }

            var aRecords = Array.isArray(oData.records) ? oData.records : [];
            var oKpis    = oData.kpis || {};

            // Build material rows for the table
            var rows = aRecords.map(function (r) {
                var ttsDisplay = (r.ttsWeeks !== null && r.ttsWeeks !== undefined)
                    ? (String(r.ttsWeeks) + " wk") : "—";
                var ttrDisplay = (r.ttrWeeks > 0)
                    ? (String(r.ttrWeeks) + " wk") : "—";
                var gapDisplay = (r.gapWeeks > 0)
                    ? (String(r.gapWeeks) + " wk") : "0";
                var sfDisplay  = (r.shortfallQty > 0)
                    ? (String(Math.round(r.shortfallQty)) + " " + (r.shortfallUoM || "")) : "—";
                return {
                    material:      r.material || "—",
                    plant:         r.plant || "—",
                    coverage:      ttsDisplay,
                    timeToSurvive: ttsDisplay,
                    recovery:      ttrDisplay,
                    gap:           gapDisplay,
                    shortfall:     sfDisplay,
                    ttsWeeks:      r.ttsWeeks || 0,
                    ttrWeeks:      r.ttrWeeks || 0,
                    gapWeeks:      r.gapWeeks || 0,
                    shortfallQty:  r.shortfallQty || 0,
                    shortfallUoM:  r.shortfallUoM || "",
                    confidence:    r.confidence || "",
                    ttrSource:     r.ttrSource || "",
                    weeklyDemand:  r.weeklyDemand || 0,
                    totalSupply:   r.totalSupply || 0,
                    dataFlags:     Array.isArray(r.dataFlags) ? r.dataFlags.join(", ") : ""
                };
            });

            // KPI tiles
            var critItems = (oKpis.criticalItems && oKpis.criticalItems.count) || 0;
            var avgCov    = oKpis.averageCoverageWeeks || 0;
            var wg        = oKpis.worstGap || {};
            var wgWeeks   = wg.weeks || 0;
            var wgLabel   = (wg.material || "") + (wg.plant ? " — " + wg.plant : "");

            // Total shortfall display
            var aTotSh = Array.isArray(oKpis.totalShortfall) ? oKpis.totalShortfall : [];
            var sTotSh = aTotSh.length > 0
                ? aTotSh.map(function (s) { return Math.round(s.qty) + " " + s.uom; }).join(", ")
                : "—";

            oSP.setProperty("/kpi", {
                criticalItems:  { value: String(critItems),             sub: "TTS < 2 weeks" },
                avgCoverage:    { value: avgCov > 0 ? (avgCov + " wk") : "—", sub: "All materials" },
                worstGap:       { value: wgWeeks > 0 ? (wgWeeks + " wk") : "—", sub: wgLabel || "—" },
                totalShortfall: { value: sTotSh,                        sub: "Needs mitigation" }
            });
            oSP.setProperty("/materials", rows);

            console.log("[SurvivalPlanning] Populated from SVP:", rows.length, "records");
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

            // Compute component base path so URLs resolve correctly in both
            // standalone approuter (HTML5 repo) and managed approuter (Build Work Zone).
            // Same pattern used in Component.js _fetchCurrentUser.
            var oComponent = this.getOwnerComponent();
            var sComponentName = oComponent.getManifestObject().getComponentName();
            var sBasePath = sap.ui.require.toUrl(sComponentName.replace(/\./g, "/"));

            // Read the currently selected region from the globalRisks model
            var oGlobalRisks = this.getView().getModel("globalRisks");
            var sRegion = (oGlobalRisks && oGlobalRisks.getProperty("/selectedRegion")) || "India";

            // Build dynamic prompt based on selected region (modular helper)
            var oPrompt = this._buildGlobalRisksPrompt(sRegion);
            var sSystemMessage = oPrompt.system;
            var sUserMessage = oPrompt.user;

            console.log("[GlobalRisks] Starting orchestration call for model:", sModelName, "| Region:", sRegion);

            // Step 1: Get orchestration deployment ID
            return this._getOrchestrationDeploymentId().then(function (sDeploymentId) {
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

                // Build URL with component base path for managed approuter compatibility
                var sUrl = sBasePath + "/deployments/" + sDeploymentId + "/completion";
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
         * Computes the component base path internally using sap.ui.require.toUrl
         * so the URL resolves correctly in both standalone approuter (HTML5 repo)
         * and managed approuter (Build Work Zone).
         *
         * @returns {Promise<string|null>} Orchestration deployment ID or null
         */
        _getOrchestrationDeploymentId: function () {
            var that = this;

            // Return cached deployment ID if available
            if (this._sOrchestrationDeploymentId) {
                return Promise.resolve(this._sOrchestrationDeploymentId);
            }

            // Return existing promise if already fetching
            if (this._oOrchestrationDeploymentIdPromise) {
                return this._oOrchestrationDeploymentIdPromise;
            }

            // Compute component base path (same pattern as Component.js _fetchCurrentUser)
            var oComponent = this.getOwnerComponent();
            var sComponentName = oComponent.getManifestObject().getComponentName();
            var sBasePath = sap.ui.require.toUrl(sComponentName.replace(/\./g, "/"));

            // Build URL with component base path for managed approuter compatibility
            // Filter by scenarioId and status to avoid 500 errors from unfiltered bulk queries
            var sUrl = sBasePath + "/lm/deployments?scenarioId=orchestration&status=RUNNING&$top=1";
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
                    plantCount: 0,
                    supplierCount: 0,
                    // Per-category hover tooltips showing affected items
                    // with descriptions. Populated alongside the counts
                    // by _updateSelectedRiskCounts after Investigate.
                    poTooltip: "",
                    materialTooltip: "",
                    plantTooltip: "",
                    supplierTooltip: ""
                };
            });
        }
    });
});
