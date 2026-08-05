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

            // User model powering the Control Tower hero header greeting.
            // Currently seeded with a static persona; when real auth is
            // available this can be populated from /user-api or a CAP
            // getCurrentUser function without changing the view.
            var oUserModel = new JSONModel({
                greeting: this._computeGreeting(),
                name: "Nikhil",
                role: "Procurement Lead"
            });
            this.getView().setModel(oUserModel, "user");

            // Start loading cases immediately on app init. The retry logic
            // inside _loadCoordinatorData handles the case where the
            // dashboard JSONModel hasn't been fully wired to the view yet
            // when the fetch response arrives.
            this._loadCoordinatorData();
        },

        /**
         * Compute a time-of-day greeting for the Control Tower hero header.
         * Kept intentionally simple; can be extended to honor the user's
         * locale/timezone once we wire real user info.
         */
        _computeGreeting: function () {
            var iHour = new Date().getHours();
            if (iHour < 12) { return "Good Morning"; }
            if (iHour < 17) { return "Good Afternoon"; }
            return "Good Evening";
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
            MessageToast.show("Opening risk: " + (oRisk.title || oRisk.id || ""));
        },

        /**
         * Footer "View all disruptions →" link. Navigates the user to
         * the Cases sub-tab which shows the full case backlog.
         */
        onViewAllDisruptions: function () {
            this._selectSideNav("cases");
        },

        /**
         * AI Assistant – "Investigate a Risk" primary action. Sends the
         * user to the Early Warning Agent sub-tab which is the entry
         * point for risk investigation.
         */
        onInvestigateRisk: function () {
            this._selectSideNav("incidents");
            MessageToast.show("Investigate a Risk");
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
            var oProcView   = this.byId("processView");
            if (oDashView)  { oDashView.setVisible(sKey === "control"); }
            if (oCasesView) { oCasesView.setVisible(sKey === "cases"); }
            if (oCoordView) { oCoordView.setVisible(sKey === "coordinator"); }
            if (oProcView)  { oProcView.setVisible(sKey !== "control" && sKey !== "cases" && sKey !== "coordinator"); }

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
                            ["PostingDate", "DocumentDate"], []);
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
            this.byId("processView").setVisible(key !== "control" && key !== "cases" && key !== "coordinator");

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
        }
    });
});