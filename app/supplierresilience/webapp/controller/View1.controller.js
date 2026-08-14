sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/format/DateFormat"
], function (Controller, JSONModel, MessageToast, Filter, FilterOperator, DateFormat) {
    "use strict";

    return Controller.extend("supplierresilience.controller.View1", {

        /**
         * Mapping from side-nav item keys to the `short` code of the agent
         * whose data should be shown on that sub-tab. Used by
         * _updateActiveAgent() to pick the right entry out of
         * dashboard>/agents for display on the agent sub-tab.
         */
        _AGENT_SHORT_BY_VIEW: {
            incidents:  "EW",   // Early Warning Agent
            signals:    "SP",   // Survival Planner Agent
            planning:   "SC",   // Substitution Checker Agent
            approvals:  "SR"    // Scenario & Recommendation Agent
        },

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
            var oCaseDetailsModel = new JSONModel({
                visible: false,
                caseId: "",
                eventType: "",
                po: "",
                supplier: "",
                material: "",
                plant: "",
                delayDays: "",
                eventTime: null
            });
            this.getView().setModel(oCaseDetailsModel, "caseDetails");

            // Coordinator Agent JSON model
            var oCoordinatorModel = new JSONModel({
                results: [],
                busy: false
            });
            this.getView().setModel(oCoordinatorModel, "coordinator");

            // Survival Planner Agent JSON model — populated by the runSurvival
            // POST action when the user is on the Survival Planner sub-tab and
            // picks a case (or switches to the tab with a case already selected).
            var oSurvModel = new JSONModel({
                busy: false,
                hasResult: false,
                items: [],
                caseId: ""
            });
            this.getView().setModel(oSurvModel, "survival");

            // PO Details JSON model — populated by getPurchaseOrderDetails
            // (which calls the S/4HANA `S4R` destination) whenever the user
            // is on the Early Warning sub-tab and a case (with a PO) is
            // selected. Drives the "Live PO Details from S/4HANA" card.
            var oPoDetailsModel = new JSONModel({
                busy: false,
                hasResult: false,
                po: "",
                headerItems: [],       // [{ label, value }, ...]
                items: [],             // raw purchase order items array
                materialDocuments: []  // raw material document items array (goods movements)
            });
            this.getView().setModel(oPoDetailsModel, "poDetails");

            // Disruptions JSON model — populated by the supplier_resilience_agent
            // POST /analyze call when the user investigates a risk from the
            // Global Risks card. Drives the Disruptions view.
            var oDisruptionsModel = new JSONModel({
                busy: false,
                hasResult: false,
                selectedRisk: null,
                result: null,
                affectedPOs: []
            });
            this.getView().setModel(oDisruptionsModel, "disruptions");

            // User model powering the Control Tower hero header greeting.
            // The "user" model is set at the Component level (Component.js)
            // and populated dynamically from /user-api/currentUser.
            // No need to create a local model here — the view inherits the
            // component-level "user" model automatically.

            // Start loading cases immediately on app init. The retry logic
            // inside _loadCoordinatorData handles the case where the
            // dashboard JSONModel hasn't been fully wired to the view yet
            // when the fetch response arrives.
            this._loadCoordinatorData();

            // Load global supply chain risks from Anthropic Claude LLM
            // via the AI_CORE_CGAI_COCKPIT destination. Called once on init;
            // users can manually refresh via the card's refresh button.
            this._loadGlobalRisksFromAI();
        },


        // ─────────────────────────────────────────────────────────────
        //  Control Tower home – new-design event handlers
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
         * Footer "View all disruptions →" link. Navigates the user to
         * the Cases sub-tab which shows the full case backlog.
         */
        onViewAllDisruptions: function () {
            this._selectSideNav("cases");
        },

        /**
         * "← Back to Risk Feed" link on the Disruptions view header.
         * Navigates the user back to the Control Tower home which
         * displays the Global Supply Chain Risks card.
         */
        onBackToRiskFeed: function () {
            this._selectSideNav("control");
        },

        /**
         * AI Assistant – "Investigate a Risk" primary action. Sends the
         * user to the Early Warning Agent sub-tab which is the entry
         * point for risk investigation.
         */
        onInvestigateRisk: function () {
            var oDisruptions = this.getView().getModel("disruptions");
            var oSelectedRisk = oDisruptions && oDisruptions.getProperty("/selectedRisk");

            if (!oSelectedRisk) {
                MessageToast.show("Please select a risk from the Global Risks list first");
                return;
            }

            // Navigate to the Disruptions view
            this._selectSideNav("disruptions");

            // Extract location (city) from the risk's region field
            // Format: "City, State, Country" → extract "City"
            var sRegion = oSelectedRisk.region || "";
            var sLocation = sRegion.split(",")[0].trim() || "Mumbai";

            // Use the risk category as impact_description
            var sImpactDescription = oSelectedRisk.category || "disruption";

            // Trigger the API call
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
            var oCasesView  = this.byId("casesView");
            var oCoordView  = this.byId("coordinatorView");
            var oDisrView   = this.byId("disruptionsView");
            var oProcView   = this.byId("processView");
            if (oDashView)  { oDashView.setVisible(sKey === "control"); }
            if (oCasesView) { oCasesView.setVisible(sKey === "cases"); }
            if (oCoordView) { oCoordView.setVisible(sKey === "coordinator"); }
            if (oDisrView)  { oDisrView.setVisible(sKey === "disruptions"); }
            if (oProcView)  { oProcView.setVisible(sKey !== "control" && sKey !== "cases" && sKey !== "coordinator" && sKey !== "disruptions"); }

            this._updateActiveAgent();

            var sExistingCaseId = oDashboard.getProperty("/selectedCaseId");
            if (sKey === "incidents" && sExistingCaseId) {
                this._loadPoDetailsForCase(sExistingCaseId);
            } else if (sKey === "signals" && sExistingCaseId) {
                this._runSurvivalAgent(sExistingCaseId);
            }
        },

        /**
         * Fetch the listCases OData function directly and populate:
         *  - the coordinator JSON model with the returned cases array
         *  - the dashboard JSON model's `caseOptions` used by the Cases dropdown
         * Also auto-selects the first case and loads its detail so the Control
         * Tower is populated on initial load.
         */
        _loadCoordinatorData: function () {
            var oView = this.getView();
            var oCoordinator = oView.getModel("coordinator");
            var oDashboard = oView.getModel("dashboard");
            var that = this;
            oCoordinator.setProperty("/busy", true);

            // Add cache-busting parameter to ensure fresh data
            var sTimestamp = new Date().getTime();
            // Resolve the service URL relative to the app's own base path so the
            // request works both locally (via ui5.yaml fiori-tools-proxy) and on
            // BTP Cloud Foundry when the app is served from the SAP Launchpad
            // under an application mount prefix. Using a hard-coded absolute
            // "/odata/..." breaks on the Launchpad host because /odata is not
            // routed there — only the app's own xs-app.json routes /odata to
            // the CAP backend destination.
            var sServiceUrl = this._getServiceUrl();
            var sUrl = sServiceUrl + "listCases()?_t=" + sTimestamp;
            console.log("[Coordinator] Fetching cases from:", sUrl);
            console.log("[Coordinator] Dashboard model present?", !!oDashboard);
            console.log("[Coordinator] Note: Request is proxied via ui5.yaml to backend service");

            fetch(sUrl, {
                method: "GET",
                headers: { 
                    "Accept": "application/json",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache"
                },
                credentials: "include",
                cache: "no-store"
            }).then(function (oResponse) {
                console.log("[ControlTower] listCases HTTP",
                            oResponse.status, oResponse.statusText,
                            "content-type:", oResponse.headers.get("content-type"));
                // Read as text first so we can log HTML redirects / errors
                return oResponse.text().then(function (sBody) {
                    return { ok: oResponse.ok, status: oResponse.status, text: sBody };
                });
            }).then(function (oResp) {
                if (!oResp.ok) {
                    console.error("[ControlTower] listCases non-OK body:", oResp.text.substring(0, 500));
                    throw new Error("HTTP " + oResp.status);
                }
                var oData;
                try {
                    oData = JSON.parse(oResp.text);
                } catch (e) {
                    console.error("[ControlTower] listCases response is not JSON. First 500 chars:", oResp.text.substring(0, 500));
                    throw new Error("Response is not JSON");
                }
                console.log("[Coordinator] listCases parsed response:", oData);
                console.log("[Coordinator] Response success:", oData && oData.success);
                console.log("[Coordinator] Response count:", oData && oData.count);

                var aCases = (oData && Array.isArray(oData.cases)) ? oData.cases : [];
                console.log("[Coordinator] Number of cases received:", aCases.length);
                
                // Log first 3 cases for debugging
                if (aCases.length > 0) {
                    console.log("[Coordinator] First case:", aCases[0]);
                    if (aCases.length > 1) console.log("[Coordinator] Second case:", aCases[1]);
                    if (aCases.length > 2) console.log("[Coordinator] Third case:", aCases[2]);
                }

                var aRows = aCases.map(function (oCase) {
                    return {
                        caseId:         oCase.caseId         || "",
                        eventId:        oCase.eventId        || "",
                        status:         oCase.status         || "",
                        priority:       oCase.priority       || "",
                        po:             oCase.po             || "",
                        supplier:       oCase.supplier       || "",
                        material:       oCase.material       || "",
                        plant:          oCase.plant          || "",
                        delayDays:      (oCase.delayDays !== undefined && oCase.delayDays !== null) ? oCase.delayDays : "",
                        eventType:      oCase.eventType      || "",
                        createdAt:      oCase.createdAt      || "",
                        recommendation: oCase.recommendation || ""
                    };
                });

                console.log("[Coordinator] Mapped rows count:", aRows.length);
                console.log("[Coordinator] Setting results to coordinator model...");
                oCoordinator.setProperty("/results", aRows);
                oCoordinator.setProperty("/busy", false);
                console.log("[Coordinator] Model updated. Current results:", oCoordinator.getProperty("/results"));

                // Populate the Control Tower Cases ComboBox with just caseIds.
                // The dashboard JSONModel is declared in manifest.json with a
                // remote uri ("localService/mockdata.json"), so it may not be
                // fully wired to the view at the exact moment listCases
                // resolves. Retry every 100 ms for up to ~2 seconds until the
                // model is available, so the dropdown never ends up empty due
                // to a race condition on initial app load.
                var aOptions = aRows
                    .filter(function (r) { return !!r.caseId; })
                    .map(function (r) { return { caseId: r.caseId }; });
                console.log("[ControlTower] Prepared caseOptions (count=" + aOptions.length + ")");

                // Apply the freshly-fetched caseOptions to the dashboard
                // JSONModel. The dashboard model is declared in manifest.json
                // with a remote URI (localService/mockdata.json), which means
                // its data arrives asynchronously via an HTTP fetch. If we
                // write /caseOptions BEFORE that fetch resolves, the incoming
                // JSON overwrites our runtime data and the Cases dropdown
                // stays empty until the user manually refreshes.
                //
                // To fix this reliably we:
                //   1. Wait for the initial dashboard fetch via dataLoaded().
                //   2. Also attach a permanent requestCompleted listener so
                //      any later refresh of the mockdata.json fetch will
                //      re-apply our runtime data instead of clobbering it.
                var applyCaseOptions = function () {
                    var oDash = oView.getModel("dashboard");
                    if (!oDash) { return; }
                    console.log("[ControlTower] Applying caseOptions to dashboard model (count=" + aOptions.length + ")");
                    oDash.setProperty("/caseOptions", aOptions);
                    oDash.refresh(true);

                    // Auto-select the first case and load its detail so the
                    // Agent network shows the correct data on initial load.
                    // Only do this the first time (when no case is selected
                    // yet) so we don't reset the user's pick on later
                    // model refreshes.
                    if (aOptions.length > 0 && !oDash.getProperty("/selectedCaseId")) {
                        oDash.setProperty("/selectedCaseId", aOptions[0].caseId);
                        that._loadCaseDetail(aOptions[0].caseId);
                    }
                };

                var waitForDashboardModel = function (attempt) {
                    var oDash = oView.getModel("dashboard");
                    if (!oDash) {
                        if (attempt < 20) {
                            setTimeout(function () { waitForDashboardModel(attempt + 1); }, 100);
                        } else {
                            console.error("[ControlTower] dashboard model never became available; cannot bind caseOptions");
                        }
                        return;
                    }

                    // If the JSONModel supports dataLoaded() (loaded from a
                    // remote URI), chain onto that Promise so we apply our
                    // runtime data AFTER the file has been fetched.
                    if (typeof oDash.dataLoaded === "function") {
                        oDash.dataLoaded().then(function () {
                            applyCaseOptions();
                            // Guard against subsequent reloads of the file
                            // wiping our runtime caseOptions.
                            if (!oDash._srCaseOptionsListenerAttached) {
                                oDash.attachRequestCompleted(applyCaseOptions);
                                oDash._srCaseOptionsListenerAttached = true;
                            }
                        }).catch(function (oErr) {
                            console.warn("[ControlTower] dashboard.dataLoaded() rejected:", oErr);
                            applyCaseOptions();
                        });
                    } else {
                        // Fallback: model does not expose dataLoaded (e.g.
                        // client-only JSONModel), just apply immediately.
                        applyCaseOptions();
                    }
                };
                waitForDashboardModel(0);

                if (aRows.length === 0) {
                    MessageToast.show("listCases returned no cases");
                }
            }).catch(function (oError) {
                console.error("[Coordinator] listCases failed:", oError);
                oCoordinator.setProperty("/busy", false);
                MessageToast.show("Failed to load cases: " + (oError && oError.message ? oError.message : "Unknown error"));
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

        onCoordinatorRefresh: function () {
            this._loadCoordinatorData();
        },

        /**
         * POST to the runSurvival OData v4 action with a payload built from
         * the currently-selected case row in the coordinator model.
         * Populates the `survival` JSON model so the right-side panel on the
         * Survival Planner Agent sub-tab renders the live analysis.
         *
         * Called from:
         *  - onCaseDropdownSelect (when the user is on the Survival Planner
         *    tab and picks a case)
         *  - onNavSelect (when the user switches TO the Survival Planner tab
         *    and a case is already selected)
         *  - _loadCaseDetail (when getCaseDetail returns no survival section
         *    for the selected case while the user is on the Survival tab)
         */
        _runSurvivalAgent: function (sCaseId) {
            if (!sCaseId) { return; }
            var oView = this.getView();
            var oSurv = oView.getModel("survival");
            var oCoord = oView.getModel("coordinator");
            var oDashboard = oView.getModel("dashboard");
            var that = this;

            // Look up the case row so we can build the payload from it.
            var aResults = (oCoord && oCoord.getProperty("/results")) || [];
            var oRow = null;
            for (var i = 0; i < aResults.length; i++) {
                if (aResults[i] && aResults[i].caseId === sCaseId) {
                    oRow = aResults[i];
                    break;
                }
            }
            if (!oRow) {
                console.warn("[SP] Case row not found for caseId:", sCaseId);
                if (oSurv) {
                    oSurv.setProperty("/items", []);
                    oSurv.setProperty("/hasResult", false);
                    oSurv.setProperty("/caseId", sCaseId);
                }
                return;
            }

            // Derive supplierRecoveryWeeks:
            //   1) prefer the value already loaded from getCaseDetail
            //      (dashboard>/agents entry with short === "SP" carries the
            //      Recovery Weeks output)
            //   2) fall back to 14 weeks (same default as backend example)
            var nRecoveryWeeks = 14;
            try {
                var aAgents = (oDashboard && oDashboard.getProperty("/agents")) || [];
                for (var j = 0; j < aAgents.length; j++) {
                    if (aAgents[j] && aAgents[j].short === "SP") {
                        var aOut = aAgents[j].outputs || [];
                        for (var k = 0; k < aOut.length; k++) {
                            if (aOut[k] && aOut[k].label === "Recovery Weeks") {
                                var nParsed = parseInt(aOut[k].value, 10);
                                if (!isNaN(nParsed)) { nRecoveryWeeks = nParsed; }
                                break;
                            }
                        }
                        break;
                    }
                }
            } catch (e) { /* keep default */ }

            var oPayload = {
                caseId:                sCaseId,
                material:              oRow.material || "",
                plant:                 oRow.plant    || "",
                supplierRecoveryWeeks: nRecoveryWeeks
            };

            var sServiceUrl = this._getServiceUrl();
            var sUrl = sServiceUrl + "runSurvival";
            console.log("[SP] POST", sUrl, "payload:", oPayload);

            if (oSurv) {
                oSurv.setProperty("/busy", true);
                oSurv.setProperty("/caseId", sCaseId);
            }

            fetch(sUrl, {
                method: "POST",
                credentials: "include",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json"
                },
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
                console.log("[SP] runSurvival response:", oData);
                var aItems = that._buildSurvivalItems(oData);
                if (oSurv) {
                    oSurv.setProperty("/items", aItems);
                    oSurv.setProperty("/hasResult", true);
                    oSurv.setProperty("/busy", false);
                }
            }).catch(function (oErr) {
                console.error("[SP] runSurvival failed:", oErr);
                if (oSurv) {
                    oSurv.setProperty("/items", []);
                    oSurv.setProperty("/hasResult", false);
                    oSurv.setProperty("/busy", false);
                }
                MessageToast.show("Survival Planner agent call failed: " +
                    (oErr && oErr.message ? oErr.message : "Unknown error"));
            });
        },

        /**
         * Flatten a runSurvival response into an array of
         *   { label, value }
         * rows suitable for a sap.m.List binding.
         *
         * The nested inventoryBreakdown object is expanded into individual
         * rows (with unit suffixed onto quantity fields). The calculation
         * formula is rendered as its own row so users can see how
         * availableInventory was derived.
         */
        _buildSurvivalItems: function (oData) {
            var arr = [];
            if (!oData) { return arr; }
            var unit = oData.unit || "";
            var push = function (l, v) {
                if (v !== undefined && v !== null && v !== "") {
                    arr.push({ label: l, value: String(v) });
                }
            };
            var pushQty = function (l, v) {
                if (v !== undefined && v !== null && v !== "") {
                    arr.push({ label: l, value: v + (unit ? " " + unit : "") });
                }
            };

            push("Material", oData.material);
            push("Plant",    oData.plant);
            pushQty("Available Inventory", oData.availableInventory);

            if (oData.inventoryBreakdown) {
                var ib = oData.inventoryBreakdown;
                pushQty("Current Stock",       ib.currentStock);
                pushQty("Blocked Stock",       ib.blockedStock);
                pushQty("Reserved Stock",      ib.reservedStock);
                pushQty("In-Transit Stock",    ib.inTransitStock);
                pushQty("Available Inventory (Breakdown)", ib.availableInventory);
                push("Calculation Formula",    ib.calculationFormula);
            }

            if (oData.weeklyDemand !== undefined && oData.weeklyDemand !== null && oData.weeklyDemand !== "") {
                arr.push({
                    label: "Weekly Demand",
                    value: oData.weeklyDemand + (unit ? " " + unit : "") + "/wk"
                });
            }
            push("Unit", oData.unit);
            if (oData.survivalWeeks !== undefined && oData.survivalWeeks !== null) {
                push("Survival Weeks", oData.survivalWeeks + " wks");
            }
            if (oData.supplierRecoveryWeeks !== undefined && oData.supplierRecoveryWeeks !== null) {
                push("Supplier Recovery Weeks", oData.supplierRecoveryWeeks + " wks");
            }
            if (oData.coverageGapWeeks !== undefined && oData.coverageGapWeeks !== null) {
                push("Coverage Gap Weeks", oData.coverageGapWeeks + " wks");
            }
            if (oData.uncoveredWeeks !== undefined && oData.uncoveredWeeks !== null) {
                push("Uncovered Weeks", oData.uncoveredWeeks + " wks");
            }
            pushQty("Shortfall Quantity", oData.shortfallQuantity);
            if (oData.actionRequired !== undefined && oData.actionRequired !== null) {
                push("Action Required", oData.actionRequired ? "Yes" : "No");
            }
            push("Data Source",   oData.dataSource);
            push("Calculated At", oData.calculatedAt);
            return arr;
        },

        /**
         * Resolve which agent card to display on the currently selected
         * agent sub-tab (Early Warning, Survival Planner, Substitution
         * Checker, or Scenario & Recommendation) and write it to
         * dashboard>/activeAgent so the view can bind to it.
         *
         * Called whenever:
         *  - The user switches side-nav tabs (onNavSelect)
         *  - A new case is picked and getCaseDetail returns fresh /agents
         */
        _updateActiveAgent: function () {
            var oDashboard = this.getView().getModel("dashboard");
            if (!oDashboard) { return; }
            var sView = oDashboard.getProperty("/selectedView");
            var sShort = this._AGENT_SHORT_BY_VIEW[sView];
            var aAgents = oDashboard.getProperty("/agents") || [];
            var oActive = null;
            if (sShort) {
                for (var i = 0; i < aAgents.length; i++) {
                    if (aAgents[i] && aAgents[i].short === sShort) {
                        oActive = aAgents[i];
                        break;
                    }
                }
            }
            oDashboard.setProperty("/activeAgent", oActive);
        },

        /**
         * Live search / filter handler for the Coordinator Agent Results table.
         *
         * Bound to the SearchField in the coordinator table toolbar via both
         * `liveChange` (fires on every keystroke) and `search` (fires on Enter
         * key or search-icon click). Performs an in-memory, case-insensitive
         * "Contains" filter across the most useful business fields, combined
         * with OR so a match in ANY field keeps the row visible.
         *
         * Filterable fields: caseId, eventId, status, priority, supplier,
         * material, plant, eventType, recommendation.
         */
        onCoordinatorSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue");
            if (sQuery === undefined || sQuery === null) {
                sQuery = oEvent.getParameter("query");
            }
            var oTable = this.byId("coordinatorTable");
            if (!oTable) { return; }
            var oBinding = oTable.getBinding("rows");
            if (!oBinding) { return; }

            // Empty query → clear filter, show all rows
            if (!sQuery) {
                oBinding.filter([]);
                return;
            }

            var aFields = [
                "caseId",
                "eventId",
                "status",
                "priority",
                "supplier",
                "material",
                "plant",
                "eventType",
                "recommendation"
            ];

            var aFilters = aFields.map(function (sField) {
                return new Filter({
                    path: sField,
                    operator: FilterOperator.Contains,
                    value1: sQuery,
                    caseSensitive: false
                });
            });

            var oCombined = new Filter({ filters: aFilters, and: false });
            oBinding.filter([oCombined]);
        },

        /**
         * Handler for the Cases dropdown change event on the Control Tower.
         * Fetches full case detail for the selected caseId and rebuilds the
         * dynamic Agent network shown below.
         */
        /**
         * Handler for the Cases dropdown (ComboBox) selectionChange event on
         * the Control Tower. Fetches full case detail for the selected caseId
         * and rebuilds the dynamic Agent network shown below.
         *
         * Works with both sap.m.ComboBox (selectionChange) and sap.m.Select
         * (change) events since both expose a `selectedItem` parameter with
         * a getKey() method.
         */
        onCaseDropdownSelect: function (oEvent) {
            var oSelected = oEvent.getParameter("selectedItem");
            if (!oSelected) { return; }
            var sCaseId = oSelected.getKey();
            if (!sCaseId) { return; }
            var oDashboard = this.getView().getModel("dashboard");
            if (oDashboard) {
                oDashboard.setProperty("/selectedCaseId", sCaseId);
            }
            this._loadCaseDetail(sCaseId);

            // If the user is currently on an agent sub-tab, also fire the
            // corresponding action so the right-side "Live Analysis" panel
            // shows fresh data for the newly selected case.
            //   - Early Warning tab → live S/4HANA PO details (S4R destination)
            //   - Survival Planner  → runSurvival POST
            var sSelectedView = oDashboard ? oDashboard.getProperty("/selectedView") : null;
            if (sSelectedView === "incidents") {
                this._loadPoDetailsForCase(sCaseId);
            } else if (sSelectedView === "signals") {
                this._runSurvivalAgent(sCaseId);
            }
        },

        /**
         * Look up the PO for a given caseId in the coordinator model and,
         * if present, fire _loadPoDetails to fetch live PO/PO-item data
         * from the S/4HANA `S4R` destination.
         */
        _loadPoDetailsForCase: function (sCaseId) {
            if (!sCaseId) { return; }
            var oView = this.getView();
            var oCoord = oView.getModel("coordinator");
            var oPo = oView.getModel("poDetails");
            var aResults = (oCoord && oCoord.getProperty("/results")) || [];
            var sPo = "";
            for (var i = 0; i < aResults.length; i++) {
                if (aResults[i] && aResults[i].caseId === sCaseId) {
                    sPo = aResults[i].po || "";
                    break;
                }
            }
            if (!sPo) {
                if (oPo) {
                    oPo.setProperty("/po", "");
                    oPo.setProperty("/headerItems", []);
                    oPo.setProperty("/items", []);
                    oPo.setProperty("/materialDocuments", []);
                    oPo.setProperty("/hasResult", false);
                    oPo.setProperty("/busy", false);
                }
                return;
            }
            this._loadPoDetails(sPo);
        },

        /**
         * Call the CAP backend function getPurchaseOrderDetails(po='...')
         * which in turn consumes the BTP `S4R` destination and calls the
         * S/4HANA API_PURCHASEORDER_PROCESS_SRV OData v2 service for
         *   - A_PurchaseOrder('<po>')                                (header)
         *   - A_PurchaseOrderItem?$filter=PurchaseOrder eq '<po>'    (items)
         * The response is flattened into { headerItems, items } on the
         * `poDetails` JSON model so the Early Warning tab's "Live PO Details
         * from S/4HANA" card can render it.
         */
        _loadPoDetails: function (sPo) {
            if (!sPo) { return; }
            var oView = this.getView();
            var oPo = oView.getModel("poDetails");
            var that = this;

            if (oPo) {
                oPo.setProperty("/busy", true);
                oPo.setProperty("/po", sPo);
                oPo.setProperty("/hasResult", false);
            }

            var sServiceUrl = this._getServiceUrl();
            var sUrl = sServiceUrl + "getPurchaseOrderDetails(po='" +
                encodeURIComponent(sPo) + "')";
            console.log("[PO] GET", sUrl);

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
                console.log("[PO] getPurchaseOrderDetails response:", oData);
                var aHeader = that._buildPoHeaderItems(oData && oData.purchaseOrder);
                // Normalize OData V2 "/Date(...)/" fields on the array rows
                // so the tables render "Aug 5, 2026" instead of the raw
                // wire format. Non-date fields are passed through untouched.
                var aItems  = (oData && Array.isArray(oData.purchaseOrderItems))
                    ? oData.purchaseOrderItems.map(function (r) {
                        return that._formatRowDates(r,
                            ["ScheduleLineDeliveryDate"], []);
                    })
                    : [];
                var aMatDocs = (oData && Array.isArray(oData.materialDocuments))
                    ? oData.materialDocuments.map(function (r) {
                        return that._formatRowDates(r,
                            ["PostingDate", "DocumentDate", "CreationDate"], []);
                    })
                    : [];
                if (oPo) {
                    oPo.setProperty("/headerItems",       aHeader);
                    oPo.setProperty("/items",             aItems);
                    oPo.setProperty("/materialDocuments", aMatDocs);
                    oPo.setProperty("/hasResult",
                        aHeader.length > 0 || aItems.length > 0 || aMatDocs.length > 0);
                    oPo.setProperty("/busy",              false);
                }
                if (oData && oData.success === false && oData.error) {
                    MessageToast.show("PO details error: " + oData.error);
                }
            }).catch(function (oErr) {
                console.error("[PO] getPurchaseOrderDetails failed:", oErr);
                if (oPo) {
                    oPo.setProperty("/headerItems",       []);
                    oPo.setProperty("/items",             []);
                    oPo.setProperty("/materialDocuments", []);
                    oPo.setProperty("/hasResult",         false);
                    oPo.setProperty("/busy",              false);
                }
                MessageToast.show("Failed to load PO details from S/4HANA: " +
                    (oErr && oErr.message ? oErr.message : "Unknown error"));
            });
        },

        /**
         * Format an S/4HANA OData V2 date/datetime value into a
         * human-readable string. Accepts:
         *   - The raw OData v2 wire format "/Date(1785801600000)/" or
         *     "/Date(1785801600000+0000)/"
         *   - ISO strings (e.g. "2026-08-05T00:00:00")
         *   - `Date` instances
         *   - Plain millisecond numbers
         * Returns the input unchanged when it can't be parsed, so callers
         * never lose information on malformed values.
         *
         * @param {*} vValue           value from the backend
         * @param {boolean} bWithTime  true to include time (used for
         *                             LastChangeDateTime), false for
         *                             plain calendar dates
         * @returns {string} formatted string or the original value
         */
        _formatSapDate: function (vValue, bWithTime) {
            if (vValue === undefined || vValue === null || vValue === "") {
                return "";
            }
            var oDate = null;
            if (vValue instanceof Date) {
                oDate = vValue;
            } else if (typeof vValue === "number" && isFinite(vValue)) {
                oDate = new Date(vValue);
            } else if (typeof vValue === "string") {
                // OData V2 wire format: /Date(1785801600000)/ or /Date(...+0000)/
                var m = vValue.match(/\/Date\((-?\d+)([+\-]\d{4})?\)\//);
                if (m) {
                    oDate = new Date(parseInt(m[1], 10));
                } else {
                    var iParsed = Date.parse(vValue);
                    if (!isNaN(iParsed)) { oDate = new Date(iParsed); }
                }
            }
            if (!oDate || isNaN(oDate.getTime())) {
                return String(vValue);
            }
            var oFormatter = bWithTime
                ? DateFormat.getDateTimeInstance({ style: "medium" })
                : DateFormat.getDateInstance({ style: "medium" });
            return oFormatter.format(oDate);
        },

        /**
         * Run every /Date(...)/ style field inside a plain object through
         * `_formatSapDate` so downstream tables (Line Items, Material
         * Documents) don't have to deal with the raw OData wire format.
         * Non-date fields are left untouched. Returns a shallow copy.
         *
         * @param {Object} oRow             row object from the backend
         * @param {string[]} aDateFields    date-only field names
         * @param {string[]} aDateTimeFields datetime field names
         */
        _formatRowDates: function (oRow, aDateFields, aDateTimeFields) {
            if (!oRow) { return oRow; }
            var oCopy = Object.assign({}, oRow);
            var that = this;
            (aDateFields || []).forEach(function (s) {
                if (oCopy[s]) { oCopy[s] = that._formatSapDate(oCopy[s], false); }
            });
            (aDateTimeFields || []).forEach(function (s) {
                if (oCopy[s]) { oCopy[s] = that._formatSapDate(oCopy[s], true); }
            });
            return oCopy;
        },

        /**
         * Flatten a purchaseOrder header object into an array of
         *   { label, value }
         * rows for a sap.m.List binding. Only non-empty fields are pushed.
         * Date fields are normalized through `_formatSapDate` so the UI
         * shows "Aug 5, 2026" instead of "/Date(1785801600000)/".
         */
        _buildPoHeaderItems: function (oPo) {
            var arr = [];
            if (!oPo) { return arr; }
            var that = this;
            var push = function (l, v) {
                if (v !== undefined && v !== null && v !== "") {
                    arr.push({ label: l, value: String(v) });
                }
            };
            push("Purchase Order",   oPo.PurchaseOrder);
            push("PO Type",          oPo.PurchaseOrderType);
            push("Company Code",     oPo.CompanyCode);
            push("Purch. Org.",      oPo.PurchasingOrganization);
            push("Purch. Group",     oPo.PurchasingGroup);
            push("Supplier",         oPo.Supplier);
            push("Supplier Phone",   oPo.SupplierPhoneNumber);
            push("Currency",         oPo.DocumentCurrency);
            push("PO Date",          that._formatSapDate(oPo.PurchaseOrderDate, false));
            push("Created By",       oPo.CreatedByUser);
            push("Creation Date",    that._formatSapDate(oPo.CreationDate, false));
            push("Last Changed",     that._formatSapDate(oPo.LastChangeDateTime, true));
            push("Net Amount",       oPo.PurchaseOrderNetAmount);
            push("Language",         oPo.Language);
            push("Payment Terms",    oPo.PaymentTerms);
            push("Address Name",     oPo.AddressName);
            push("Address City",     oPo.AddressCityName);
            push("Address Country",  oPo.AddressCountry);
            return arr;
        },

        /**
         * Fetch getCaseDetail(caseId='...') and rebuild the Agent network.
         */
        _loadCaseDetail: function (sCaseId) {
            if (!sCaseId) { return; }
            var oDashboard = this.getView().getModel("dashboard");
            var that = this;

            var sServiceUrl = this._getServiceUrl();
            var sUrl = sServiceUrl + "getCaseDetail(caseId='" +
                encodeURIComponent(sCaseId) + "')";

            fetch(sUrl, {
                method: "GET",
                headers: { "Accept": "application/json" },
                credentials: "include"
            }).then(function (oResponse) {
                if (!oResponse.ok) {
                    throw new Error("HTTP " + oResponse.status + " " + oResponse.statusText);
                }
                return oResponse.json();
            }).then(function (oData) {
                console.log("[ControlTower] getCaseDetail response:", oData);

                var aAgents = that._buildAgentsFromCaseDetail(oData);
                if (oDashboard) {
                    oDashboard.setProperty("/agents", aAgents);
                    // Track whether the Early Warning agent data is available
                    // in the getCaseDetail response. Used by the view to
                    // decide whether to render the left overview card or
                    // show ONLY the live analysis on the Early Warning tab.
                    var bHasEwAgent = !!(oData && oData.earlyWarning);
                    oDashboard.setProperty("/hasEarlyWarningAgentData", bHasEwAgent);
                    var bHasSurvivalAgent = !!(oData && oData.survival);
                    oDashboard.setProperty("/hasSurvivalAgentData", bHasSurvivalAgent);

                    // Refresh the agent sub-tab's active-agent card so it
                    // reflects the freshly-loaded case data.
                    that._updateActiveAgent();

                    // If the user is currently on an agent sub-tab and the
                    // getCaseDetail response has NO corresponding agent
                    // section, still populate the Live Analysis panel by
                    // firing the appropriate action for the newly selected
                    // case:
                    //   - Early Warning tab → live S/4HANA PO details (S4R destination)
                    //   - Survival Planner  → runSurvival POST
                    var sSelectedView = oDashboard.getProperty("/selectedView");
                    if (sSelectedView === "incidents") {
                        that._loadPoDetailsForCase(sCaseId);
                    } else if (sSelectedView === "signals" && !bHasSurvivalAgent) {
                        that._runSurvivalAgent(sCaseId);
                    }

                    // Update the priority incident panel from caseData so the
                    // Control Tower reflects the currently selected case.
                    var oCase = (oData && oData.caseData) || {};
                    var oEw   = (oData && oData.earlyWarning) || {};
                    var oSurv = (oData && oData.survival) || {};
                    oDashboard.setProperty("/incident", {
                        id:        oCase.caseId       || "",
                        title:     oCase.eventType    || "",
                        supplier:  oCase.supplier     || "",
                        material:  oCase.material     || "",
                        status:    oCase.status       || "",
                        score:     (oEw.riskScore !== undefined && oEw.riskScore !== null) ? oEw.riskScore : "",
                        severity:  oEw.riskLevel      || oCase.priority || "",
                        exposure:  oCase.recommendation || "",
                        tts:       (oSurv.survivalWeeks !== undefined && oSurv.survivalWeeks !== null) ? (oSurv.survivalWeeks + " wks") : "",
                        ttr:       (oSurv.supplierRecoveryWeeks !== undefined && oSurv.supplierRecoveryWeeks !== null) ? (oSurv.supplierRecoveryWeeks + " wks") : "",
                        gap:       (oSurv.coverageGapWeeks !== undefined && oSurv.coverageGapWeeks !== null) ? (oSurv.coverageGapWeeks + " wks") : ""
                    });
                }
            }).catch(function (oError) {
                console.error("[ControlTower] getCaseDetail failed:", oError);
                MessageToast.show("Failed to load case detail: " + (oError && oError.message ? oError.message : "Unknown error"));
            });
        },

        /**
         * Build the Agent network array dynamically based on which sections
         * are present in the getCaseDetail response. Only agents that have
         * a corresponding section in the response are returned. For each
         * agent, only fields with values are pushed into the outputs list.
         */
        _buildAgentsFromCaseDetail: function (oData) {
            var aAgents = [];
            if (!oData) { return aAgents; }

            var hasValue = function (v) {
                return v !== undefined && v !== null && v !== "";
            };
            var addOutput = function (arr, label, value) {
                if (hasValue(value)) {
                    arr.push({ label: label, value: String(value) });
                }
            };

            // ─── Early Warning Agent ─────────────────────────────────────
            if (oData.earlyWarning) {
                var ew = oData.earlyWarning;
                var ewOutputs = [];
                addOutput(ewOutputs, "Status",         ew.status);
                if (hasValue(ew.riskScore)) {
                    ewOutputs.push({ label: "Risk Score", value: ew.riskScore + "/100" });
                }
                addOutput(ewOutputs, "Risk Level",     ew.riskLevel);
                addOutput(ewOutputs, "Supplier",       ew.supplierName || ew.supplierId);
                if (hasValue(ew.supplierOtif)) {
                    ewOutputs.push({ label: "Supplier OTIF", value: ew.supplierOtif + "%" });
                }
                addOutput(ewOutputs, "Supplier Trend",   ew.supplierTrend);
                addOutput(ewOutputs, "Material",         ew.materialId);
                addOutput(ewOutputs, "Criticality",      ew.materialCriticality);
                if (Array.isArray(ew.affectedPlants) && ew.affectedPlants.length) {
                    ewOutputs.push({ label: "Affected Plants", value: ew.affectedPlants.join(", ") });
                }
                if (Array.isArray(ew.affectedSkus) && ew.affectedSkus.length) {
                    ewOutputs.push({ label: "Affected SKUs", value: ew.affectedSkus.join(", ") });
                }
                if (Array.isArray(ew.topRiskDrivers) && ew.topRiskDrivers.length) {
                    ewOutputs.push({ label: "Top Risk Driver", value: ew.topRiskDrivers[0] });
                }

                aAgents.push({
                    short: "EW",
                    name: "Early Warning Agent",
                    color: "green",
                    icon: "sap-icon://it-host",
                    activities: [
                        "Collect Supplier Data",
                        "Calculate Risk Indicators",
                        "Detect Deterioration"
                    ],
                    outputs: ewOutputs,
                    outputTitle: "Outputs"
                });
            }

            // ─── Survival Planner Agent ──────────────────────────────────
            if (oData.survival) {
                var sv = oData.survival;
                var unit = sv.unit || "";
                var svOutputs = [];
                addOutput(svOutputs, "Status",             sv.status);
                addOutput(svOutputs, "Material",           sv.material);
                addOutput(svOutputs, "Plant",              sv.plant);
                if (hasValue(sv.availableInventory)) {
                    svOutputs.push({ label: "Available Inventory", value: sv.availableInventory + (unit ? " " + unit : "") });
                }
                if (hasValue(sv.weeklyDemand)) {
                    svOutputs.push({ label: "Weekly Demand", value: sv.weeklyDemand + (unit ? " " + unit : "") + "/wk" });
                }
                if (hasValue(sv.survivalWeeks)) {
                    svOutputs.push({ label: "Survival Weeks", value: sv.survivalWeeks + " wks" });
                }
                if (hasValue(sv.supplierRecoveryWeeks)) {
                    svOutputs.push({ label: "Recovery Weeks", value: sv.supplierRecoveryWeeks + " wks" });
                }
                if (hasValue(sv.coverageGapWeeks)) {
                    svOutputs.push({ label: "Coverage Gap", value: sv.coverageGapWeeks + " wks" });
                }
                if (hasValue(sv.uncoveredWeeks)) {
                    svOutputs.push({ label: "Uncovered Weeks", value: sv.uncoveredWeeks + " wks" });
                }
                if (hasValue(sv.shortfallQuantity)) {
                    svOutputs.push({ label: "Shortfall Qty", value: sv.shortfallQuantity + (unit ? " " + unit : "") });
                }
                if (hasValue(sv.actionRequired)) {
                    svOutputs.push({ label: "Action Required", value: sv.actionRequired ? "Yes" : "No" });
                }

                aAgents.push({
                    short: "SP",
                    name: "Survival Planner Agent",
                    color: "blue",
                    icon: "sap-icon://it-host",
                    activities: [
                        "Get Inventory (On-hand, In-transit)",
                        "Get Demand (SO, Forecast, MRP)",
                        "Calculate Survival Window",
                        "Compare with Recovery Time"
                    ],
                    outputs: svOutputs,
                    outputTitle: "Outputs"
                });
            }

            // ─── Substitution Checker Agent (future) ─────────────────────
            if (oData.substitution) {
                var sub = oData.substitution;
                var subOutputs = [];
                Object.keys(sub).forEach(function (k) {
                    addOutput(subOutputs, k, sub[k]);
                });
                aAgents.push({
                    short: "SC",
                    name: "Substitution Checker Agent",
                    color: "teal",
                    icon: "sap-icon://it-host",
                    activities: [
                        "Check BOM & Material Data",
                        "Check Approved Suppliers",
                        "Apply Business Rules",
                        "Validate Compliance"
                    ],
                    outputs: subOutputs,
                    outputTitle: "Outputs"
                });
            }

            // ─── Scenario & Recommendation Agent (future) ────────────────
            if (oData.scenario || oData.recommendation) {
                var scen = oData.scenario || {};
                var scenOutputs = [];
                Object.keys(scen).forEach(function (k) {
                    addOutput(scenOutputs, k, scen[k]);
                });
                if (oData.caseData && hasValue(oData.caseData.recommendation)) {
                    scenOutputs.push({ label: "Recommendation", value: oData.caseData.recommendation });
                }
                if (scenOutputs.length) {
                    aAgents.push({
                        short: "SR",
                        name: "Scenario & Recommendation Agent",
                        color: "orange",
                        icon: "sap-icon://it-host",
                        activities: [
                            "Build Mitigation Scenarios",
                            "Evaluate (Coverage, Cost, Risk)",
                            "Rank Options",
                            "Provide Recommendation"
                        ],
                        outputs: scenOutputs,
                        outputTitle: "Outputs"
                    });
                }
            }

            return aAgents;
        },

        onApprove: function () {
            MessageToast.show("Approval recorded locally. Buyer remains gated until BTP workflow is connected.");
        },

        onCaseIdPress: function (oEvent) {
            var oLink = oEvent.getSource();
            var oContext = oLink.getBindingContext();
            if (!oContext) {
                return;
            }
            var oCaseDetails = this.getView().getModel("caseDetails");
            // Show panel immediately with what we already have
            var oSync = oContext.getObject() || {};
            oCaseDetails.setData({
                visible: true,
                caseId: oSync.caseId || "",
                eventType: oSync.eventType || "",
                po: oSync.po || "",
                supplier: oSync.supplier || "",
                material: oSync.material || "",
                plant: oSync.plant || "",
                delayDays: (oSync.delayDays !== undefined && oSync.delayDays !== null) ? oSync.delayDays : "",
                eventTime: oSync.eventTime || null
            });

            // For OData v4: force-fetch the full record so all fields are populated
            if (oContext.requestObject) {
                oContext.requestObject().then(function (oData) {
                    if (!oData) { return; }
                    oCaseDetails.setData({
                        visible: true,
                        caseId: oData.caseId || "",
                        eventType: oData.eventType || "",
                        po: oData.po || "",
                        supplier: oData.supplier || "",
                        material: oData.material || "",
                        plant: oData.plant || "",
                        delayDays: (oData.delayDays !== undefined && oData.delayDays !== null) ? oData.delayDays : "",
                        eventTime: oData.eventTime || null
                    });
                }).catch(function () {
                    MessageToast.show("Failed to load case details");
                });
            }
        },

        onCloseCaseDetails: function () {
            var oCaseDetails = this.getView().getModel("caseDetails");
            oCaseDetails.setProperty("/visible", false);
        },

        onCasesSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue");
            if (sQuery === undefined || sQuery === null) {
                sQuery = oEvent.getParameter("query");
            }
            var oTable = this.byId("casesTable");
            if (!oTable) {
                return;
            }
            var oBinding = oTable.getBinding("rows");
            if (!oBinding) {
                return;
            }
            if (!sQuery) {
                oBinding.filter([]);
                return;
            }
            var aFields = ["caseId", "eventId", "status", "priority", "createdBy"];
            var aFilters = aFields.map(function (sField) {
                return new Filter(sField, FilterOperator.Contains, sQuery);
            });
            var oCombined = new Filter({ filters: aFilters, and: false });
            oBinding.filter([oCombined]);
        },

        onRefresh: function () {
            var oOData = this.getView().getModel();
            if (oOData && oOData.refresh) {
                oOData.refresh();
            }
            var oDashboard = this.getView().getModel("dashboard");
            if (oDashboard && oDashboard.refresh) {
                oDashboard.refresh(true);
            }
            MessageToast.show("Control tower data refreshed");
        },

        onNavSelect: function (event) {
            var item = event.getParameter("item");
            var key = item.getKey() || "control";
            var oDashboard = this.getView().getModel("dashboard");

            oDashboard.setProperty("/selectedView", key);
            oDashboard.setProperty("/selectedSteps", oDashboard.getProperty("/workspaces/" + key + "/steps") || []);
            oDashboard.setProperty("/selectedWorkspace",
                oDashboard.getProperty("/workspaces/" + key) || oDashboard.getProperty("/workspaces/control"));

            this.byId("dashboardView").setVisible(key === "control");
            this.byId("casesView").setVisible(key === "cases");
            this.byId("coordinatorView").setVisible(key === "coordinator");
            this.byId("disruptionsView").setVisible(key === "disruptions");
            this.byId("processView").setVisible(key !== "control" && key !== "cases" && key !== "coordinator" && key !== "disruptions");

            // Refresh the agent sub-tab's active-agent card so it reflects
            // the correct agent for the newly selected tab.
            this._updateActiveAgent();

            // When switching TO an agent sub-tab, if a case is already
            // selected, fire the corresponding agent POST so the right-side
            // "Live Analysis" panel populates without the user needing to
            // re-pick the case.
            var sExistingCaseId = oDashboard.getProperty("/selectedCaseId");
            if (key === "incidents" && sExistingCaseId) {
                this._loadPoDetailsForCase(sExistingCaseId);
            } else if (key === "signals" && sExistingCaseId) {
                this._runSurvivalAgent(sExistingCaseId);
            }

            MessageToast.show(item.getText() + " workspace selected");
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
            var oCoordinator = oView.getModel("coordinator");
            var that = this;

            if (!oDisruptions) { return; }

            oDisruptions.setProperty("/busy", true);
            oDisruptions.setProperty("/hasResult", false);

            var oPayload = {
                location: sLocation,
                impact_description: sImpactDescription,
                assessment_radius_km: 100
            };

            // Use relative URL — routed by xs-app.json to the supplier_resilience_agent destination
            var sUrl = "supplier-resilience-agent/analyze";
            console.log("[Disruptions] POST", sUrl, "payload:", oPayload);

            fetch(sUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                credentials: "same-origin",
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
                console.log("[Disruptions] /analyze response:", oData);

                // Store the full response
                oDisruptions.setProperty("/result", oData);
                oDisruptions.setProperty("/hasResult", true);
                oDisruptions.setProperty("/busy", false);

                // Cross-reference affected suppliers with coordinator cases
                // to find affected POs
                var aAffectedSuppliers = (oData && Array.isArray(oData.affected_suppliers))
                    ? oData.affected_suppliers : [];
                var aAffectedPOs = that._findAffectedPOs(aAffectedSuppliers, oCoordinator);
                oDisruptions.setProperty("/affectedPOs", aAffectedPOs);

                MessageToast.show("Disruption analysis complete: " +
                    (oData.affected_supplier_count || 0) + " supplier(s) affected");
            }).catch(function (oErr) {
                console.error("[Disruptions] /analyze failed:", oErr);
                oDisruptions.setProperty("/result", null);
                oDisruptions.setProperty("/hasResult", false);
                oDisruptions.setProperty("/affectedPOs", []);
                oDisruptions.setProperty("/busy", false);
                MessageToast.show("Disruption analysis failed: " +
                    (oErr && oErr.message ? oErr.message : "Unknown error"));
            });
        },

        /**
         * Cross-reference affected suppliers from the /analyze response with
         * the coordinator model's case data to find POs linked to those suppliers.
         *
         * @param {Array} aAffectedSuppliers - Array of affected supplier objects from API
         * @param {sap.ui.model.json.JSONModel} oCoordinator - The coordinator model
         * @returns {Array} Array of PO objects { po, caseId, supplier, material, plant, status, priority }
         */
        _findAffectedPOs: function (aAffectedSuppliers, oCoordinator) {
            if (!aAffectedSuppliers || !aAffectedSuppliers.length || !oCoordinator) {
                return [];
            }

            var aResults = oCoordinator.getProperty("/results") || [];
            if (!aResults.length) { return []; }

            // Build a Set of affected supplier names/IDs for fast lookup
            var mAffectedSupplierIds = {};
            var mAffectedSupplierNames = {};
            aAffectedSuppliers.forEach(function (oSup) {
                if (oSup.supplier_id) { mAffectedSupplierIds[oSup.supplier_id.toUpperCase()] = true; }
                if (oSup.name) { mAffectedSupplierNames[oSup.name.toUpperCase()] = true; }
            });

            // Find all cases/POs whose supplier matches an affected supplier
            var aAffectedPOs = [];
            aResults.forEach(function (oCase) {
                if (!oCase.po) { return; }
                var sSupplier = (oCase.supplier || "").toUpperCase();
                if (mAffectedSupplierIds[sSupplier] || mAffectedSupplierNames[sSupplier]) {
                    aAffectedPOs.push({
                        po: oCase.po,
                        caseId: oCase.caseId,
                        supplier: oCase.supplier,
                        material: oCase.material,
                        plant: oCase.plant,
                        status: oCase.status,
                        priority: oCase.priority,
                        eventType: oCase.eventType
                    });
                }
            });

            console.log("[Disruptions] Found", aAffectedPOs.length, "affected POs");
            return aAffectedPOs;
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
