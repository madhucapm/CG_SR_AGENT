sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "supplier/resilience/model/models"
], function (UIComponent, Device, models) {
    "use strict";

    return UIComponent.extend("supplier.resilience.Component", {
        metadata: {
            manifest: "json"
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            this.setModel(models.createDeviceModel(), "device");
            this.getRouter().initialize();
        }
    });
});