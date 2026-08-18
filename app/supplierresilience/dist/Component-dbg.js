sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "sap/ui/model/json/JSONModel",
    "supplierresilience/model/models"
], function (UIComponent, Device, JSONModel, models) {
    "use strict";

    return UIComponent.extend("supplierresilience.Component", {
        metadata: {
            manifest: "json"
        },
         defaultHeaders: {
            "AI-Resource-Group": "default",
            "Content-Type": "application/json",
            "Accept": "application/json"
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            this.setModel(models.createDeviceModel(), "device");
            this.getRouter().initialize();

            // Initialize user model with defaults; will be updated by _fetchCurrentUser
            var oUserModel = new JSONModel({
                greeting: this._computeGreeting(),
                name: "",
                role: "Procurement Lead"
            });
            this.setModel(oUserModel, "user");
            
            // Initialize orchestration deployment ID fetch with empty basePath
            // (xs-app.json routes are relative to app root, so /lm/deployments works directly)
            //models.getOrchestrationDeploymentId("");

            // Fetch the logged-in user's info from the App Router user API
             this.getFoundationModels();
            this._fetchCurrentUser();
            const sComponentName = this.getManifestObject().getComponentName();
            const sInitBasePath = this.getManifestObject()._oBaseUri.pathname.replace(/\/$/, "");
            models.getOrchestrationDeploymentId(sInitBasePath);
        },

        /**
         * Compute a time-of-day greeting for the Control Tower hero header.
         */
        _computeGreeting: function () {
            var iHour = new Date().getHours();
            if (iHour < 12) { return "Good Morning"; }
            if (iHour < 17) { return "Good Afternoon"; }
            return "Good Evening";
        },

        /**
         * Fetch the current logged-in user's information from the SAP App Router
         * user API endpoint (/user-api/currentUser). Updates the component-level
         * "user" JSON model with the user's name.
         */
        _fetchCurrentUser: function () {
            var that = this;
            var sComponentName = this.getManifestObject().getComponentName();
            var sBasePath = sap.ui.require.toUrl(sComponentName.replace(/\./g, "/"));
            var sUrl = sBasePath + "/user-api/currentUser";

            $.ajax({
                url: sUrl,
                method: "GET",
                success: function (data) {
                    // eslint-disable-next-line no-console
                    console.log("User API Response:", data);
                    var oUserModel = that.getModel("user");
                    if (oUserModel && data) {
                        // The user API typically returns firstname, lastname, email
                        var sName = "";
                        if (data.firstname && data.lastname) {
                            sName = data.firstname + " " + data.lastname;
                        } else if (data.firstname) {
                            sName = data.firstname;
                        } else if (data.lastname) {
                            sName = data.lastname;
                        } else if (data.name) {
                            sName = data.name;
                        } else if (data.email) {
                            // Fallback to email prefix if no name is available
                            sName = data.email.split("@")[0];
                        }
                        if (sName) {
                            oUserModel.setProperty("/name", sName);
                        }
                    }
                },
                error: function (err) {
                    // eslint-disable-next-line no-console
                    console.error("Failed to fetch current user:", err);
                    // Keep the default empty name; the fragment will show "there" as fallback
                }
            });
        },
         getFoundationModels: function () {
            let sComponentName = this.getManifestObject().getComponentName();
            let sBasePath = this.getManifestObject()._oBaseUri.pathname.replace(/\/$/, "");
            let sUrl = sBasePath + "/lm/scenarios/foundation-models/models";
 
            let that = this;
 
            return fetch(sUrl, {
                method: "GET",
                headers: this.defaultHeaders,
                credentials: "same-origin"
            })
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error("API Error: " + response.status + " " + response.statusText);
                    }
                    return response.json();
                })
                .then(function (data) {
                    let tokenData = {};
 
                    if (Array.isArray(data.resources)) {
                        data.resources.forEach(function (modelInfo) {
                            if (modelInfo.model && modelInfo.versions[0].contextLength) {
                                tokenData[modelInfo.model] = {
                                    UsageToken: 0,
                                    TotalToken: modelInfo.versions[0].contextLength
                                };
                            }
                        });
                    }
 
                    const allModels = data?.resources || data?.models || data || [];
                    let orchestrationModels = [];
                    if (Array.isArray(allModels)) {
                        const HIDDEN_MODELS = ["anthropic--claude-4.8-opus", "sap-abap-1"];
 
                        orchestrationModels = allModels
                            .filter(function (model) {
                                const modelName = (model.model || model.name || "").toLowerCase();
                                const isEmbeddingModel = modelName.includes("embed") || modelName.includes("embedding");
 
                                const versions = Array.isArray(model.versions) ? model.versions : [];
                                const hasNonDeprecatedVersion = versions.some(function (v) {
                                    return v && (v.deprecated === false || v.deprecated === "false");
                                });
 
                                const allowed = Array.isArray(model.allowedScenarios) ? model.allowedScenarios : [];
                                const isOrchestrationAllowed = allowed.some(function (s) {
                                    if (!s) { return false; }
                                    if (typeof s === "string") {
                                        return s.toLowerCase() === "orchestration";
                                    }
                                    const sid = (s.scenarioId || s.id || "").toLowerCase();
                                    return sid === "orchestration";
                                });
                                const isHiddenModel = HIDDEN_MODELS.indexOf(modelName) !== -1;
 
                                return !isEmbeddingModel && hasNonDeprecatedVersion && isOrchestrationAllowed && !isHiddenModel;
                            })
                            .map(function (model) {
                                const nonDeprecatedVersions = (Array.isArray(model.versions) ? model.versions : []).filter(function (v) {
                                    return v && (v.deprecated === false || v.deprecated === "false");
                                });
 
                                const firstVer = nonDeprecatedVersions && nonDeprecatedVersions[0] ? (nonDeprecatedVersions[0].name || nonDeprecatedVersions[0].version || "") : "";
                                const sModelName = model.model || model.name || model.modelName || "";
                                const key = sModelName;
                                const label = sModelName;
 
                                const sModelNameLower = sModelName.toLowerCase();
                                const sExecIdLower = (model.executableId || "").toLowerCase();
                                let aiType = "Others";
                                if (sModelNameLower.includes("gpt") || sModelNameLower.includes("o3") || sModelNameLower.includes("o4")) {
                                    aiType = "GPT";
                                } else if (sModelNameLower.includes("mistral")) {
                                    aiType = "Mistral";
                                } else if (sModelNameLower.includes("claude") || sModelNameLower.includes("anthropic")) {
                                    aiType = "Anthropic";
                                } else if (sModelNameLower.includes("amazon") || sModelNameLower.includes("nova")) {
                                    aiType = "Amazon";
                                } else if (sModelNameLower.includes("gemini")) {
                                    aiType = "Google";
                                } else if (sModelNameLower.includes("sonar") || sExecIdLower.includes("perplexity")) {
                                    aiType = "Perplexity";
                                } else if (sModelNameLower.includes("cohere")) {
                                    aiType = "Cohere";
                                } else if (sModelNameLower.includes("sap")) {
                                    aiType = "SAP";
                                }
 
                                return {
                                    key: key,
                                    text: label,
                                    label: label,
                                    aiType: aiType,
                                    name: sModelName,
                                    executableId: model.executableId,
                                    description: model.description,
                                    versions: nonDeprecatedVersions,
                                    provider: model.provider,
                                    displayName: model.displayName,
                                    isOrchestrationCompatible: true,
                                    contextLength: nonDeprecatedVersions[0] ? nonDeprecatedVersions[0].contextLength : 0,
                                    streamingSupported: nonDeprecatedVersions[0] ? !!nonDeprecatedVersions[0].streamingSupported : false
                                };
                            })
                            .filter(function (m) { return m.name; });
                    }
 
                    let sDefaultKey = "";
                    if (orchestrationModels.length > 0) {
                        let gpt4oModel = orchestrationModels.find(function (m) {
                            return (m.key || "").toLowerCase() === "gpt-4o";
                        });
                        sDefaultKey = gpt4oModel ? gpt4oModel.key : orchestrationModels[0].key;
                    }
 
                    that.setModel(new sap.ui.model.json.JSONModel({ items: orchestrationModels, selectedKey: sDefaultKey }), "OrchestrationModels");
 
                    const apiVersion = (data && data.sqlResponse && data.sqlResponse.APIVERSION) || data?.APIVERSION || "";
                    that.setModel(new sap.ui.model.json.JSONModel({ apiVersion: apiVersion }), "LMApiInfo");
 
                    //that.foundationModelTabs(tokenData,data);
                   
                })
                .catch(function (error) {
                    console.error("API Error:", error);
                    throw error;
                });
        },
    });
});