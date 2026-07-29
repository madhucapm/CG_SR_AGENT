sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Controller, JSONModel, MessageToast, Filter, FilterOperator) {
    "use strict";

    return Controller.extend("supplierresilience.controller.View1", {

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
            this.byId("processView").setVisible(key !== "control" && key !== "cases");

            MessageToast.show(item.getText() + " workspace selected");
        }
    });
});