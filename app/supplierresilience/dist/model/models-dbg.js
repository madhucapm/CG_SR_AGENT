sap.ui.define([
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device"
], function (JSONModel, Device) {
    "use strict";

    // Module-level cache for orchestration deployment ID
    var _sDeploymentId = null;
    var _oDeploymentIdPromise = null;

    return {
        createDeviceModel: function () {
            var oModel = new JSONModel(Device);
            oModel.setDefaultBindingMode("OneWay");
            return oModel;
        },
            getOrchestrationDeploymentId: function (basePath) {
                if (_sDeploymentId) {
                    return Promise.resolve(_sDeploymentId);
                }
                if (_oDeploymentIdPromise) {
                    return _oDeploymentIdPromise;
                }
                _oDeploymentIdPromise = fetch(basePath + "/lm/deployments", {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "AI-Resource-Group": "default"
                    }
                })
                    .then(function (response) {
                        return response.json();
                    })
                    .then(function (data) {
                        var deployment = (data.resources || []).find(function (item) {
                            return item.configurationName === "orchestration" &&
                                item.status === "RUNNING";
                        });
                        if (deployment && deployment.id) {
                            _sDeploymentId = deployment.id;
                        }
                        return _sDeploymentId;
                    })
                    .catch(function (error) {
                        console.error("Failed to fetch orchestration deployment ID:", error);
                        _oDeploymentIdPromise = null;
                        return null;
                    });

                return _oDeploymentIdPromise;
            },
               aiModelDefaultPayload: function (apiModelName) {
                let defaultPayload = {}, retPayload;

                if (apiModelName === "amazon--nova-pro") {
                    defaultPayload = {
                        comnPopUpModelParamTemp: 0.5,
                        comnPopUpModelParamMaxLength: 6144,
                        maxValue: 10240,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: false,
                        presPVis: false

                    };
                }
                // 
                else if (apiModelName === "amazon--nova-lite") {
                    defaultPayload = {
                        comnPopUpModelParamTemp: 0.5,
                        comnPopUpModelParamMaxLength: 3932,
                        maxValue: 65535,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: false,
                        presPVis: false

                    };
                } else if (apiModelName == "amazon--nova-micro") {
                    defaultPayload = {
                        comnPopUpModelParamTemp: 0.5,
                        comnPopUpModelParamMaxLength:6000,
                        maxValue: 10000,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: false,
                        presPVis: false

                    };
                }else if (apiModelName.includes("anthropic")) {
                    // || apiModelName == 'anthropic--claude-4.6-sonnet'
                    if (apiModelName == "anthropic--claude-4.7-opus" || apiModelName == "anthropic--claude-3-haiku" ) {
                        // comnPopUpModelParamMaxLength: 1000000,
                        defaultPayload = {
                            anthropic_version: "bedrock-2023-05-314",
                            comnPopUpModelParamTemp: 1,
                            comnPopUpModelParamMaxLength: 120000,
                            maxValue: 200000,
                            tempVis: true,
                            maxRespVis: true,
                            topPVis: false,
                            freqPVis: false,
                            presPVis: false
                        };
                    } else if(apiModelName == "anthropic--claude-4.5-opus"){
                        
                        defaultPayload = {
                            anthropic_version: "bedrock-2023-05-314",
                            comnPopUpModelParamTemp: 1,
                            comnPopUpModelParamMaxLength: 38400,
                            maxValue: 64000,
                            tempVis: true,
                            maxRespVis: true,
                            topPVis: false,
                            freqPVis: false,
                            presPVis: false
                        };
                    }else {
                        defaultPayload = {
                            anthropic_version: "bedrock-2023-05-31",
                            comnPopUpModelParamTemp: 1,
                            comnPopUpModelParamMaxLength: 76800,
                            maxValue: 128000,
                            tempVis: true,
                            maxRespVis: true,
                            topPVis: false,
                            freqPVis: false,
                            presPVis: false
                        };
                    }
                }
                else if (apiModelName.includes("gpt")) {
                    if (apiModelName === "gpt-5" || apiModelName === "gpt-5-mini" || apiModelName === "gpt-5-nano" || apiModelName === "gpt-5.5") {
                        defaultPayload = {
                            // comnPopUpModelParamMaxLength: 272000,
                            comnPopUpModelParamMaxLength: 76800,
                            maxValue: 128000,
                            tempVis: false,
                            maxRespVis: true,
                            topPVis: false,
                            freqPVis: false,
                            presPVis: false
                        };
                    } else if (apiModelName === "gpt-5.4") {
                        defaultPayload = {
                            comnPopUpModelParamMaxLength: 630000,
                            maxValue: 1050000,
                            tempVis: false,
                            maxRespVis: true,
                            topPVis: false,
                            freqPVis: false,
                            presPVis: false
                        };
                    } else if (apiModelName === "gpt-4.1" || apiModelName == "gpt-4.1-nano" || apiModelName == "gpt-4.1-mini") {
                        defaultPayload = {
                            comnPopUpModelParamTemp: 1,
                            // comnPopUpModelParamMaxLength: 1047576,
                            comnPopUpModelParamMaxLength: 19660,
                            maxValue: 32768,
                            comnPopUpModelParamFreqP: 0,
                            comnPopUpModelParamPresenceP: 0,
                            tempVis: true,
                            maxRespVis: true,
                            topPVis: false,
                            freqPVis: true,
                            presPVis: true
                        };
                    } else {
                        defaultPayload = {
                            comnPopUpModelParamTemp: 1,
                            comnPopUpModelParamMaxLength: 9830,
                            maxValue: 16384,
                            comnPopUpModelParamFreqP: 0,
                            comnPopUpModelParamPresenceP: 0,
                            tempVis: true,
                            maxRespVis: true,
                            topPVis: false,
                            freqPVis: true,
                            presPVis: true
                        };
                    }
                } else if (apiModelName === "mistralai--mistral-large-instruct") {
                    ///not in ai models list
                    defaultPayload = {
                        model: "mistralai--mistral-large-instruct",
                        comnPopUpModelParamTemp: 1,
                        comnPopUpModelParamFreqP: 0,
                        comnPopUpModelParamPresenceP: 0,
                        comnPopUpModelParamMaxLength: 38400,
                        maxValue: 64000,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: true,
                        freqPVis: true,
                        presPVis: true
                    };
                }
                else if (apiModelName === "mistralai--mistral-medium-instruct") {
                    defaultPayload = {
                        model: "mistralai--mistral-medium-instruct",
                        comnPopUpModelParamTemp: 1,
                        comnPopUpModelParamFreqP: 0,
                        comnPopUpModelParamPresenceP: 0,
                        comnPopUpModelParamMaxLength: 76800,
                        maxValue: 128000,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: true,
                        freqPVis: true,
                        presPVis: true
                    };
                }
                else if (apiModelName === "mistralai--mistral-small-instruct" || apiModelName === "mistralai--mistral-small") {
                    defaultPayload = {
                        model: "mistralai--mistral-small-instruct",
                        comnPopUpModelParamTemp: 1,
                        comnPopUpModelParamFreqP: 0,
                        comnPopUpModelParamPresenceP: 0,
                        comnPopUpModelParamMaxLength: 76800,
                        maxValue: 128000,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: true,
                        presPVis: true
                    };
                } else if (apiModelName === "o3") {
                    //200000
                    defaultPayload = {
                        model: "o3",
                        comnPopUpModelParamMaxLength: 60000,
                        maxValue: 100000,
                        tempVis: false,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: false,
                        presPVis: false
                    };
                } else if (apiModelName === "o4-mini") {
                    //200000
                    defaultPayload = {
                        model: "o3",
                        comnPopUpModelParamMaxLength: 60000,
                        maxValue: 100000,
                        tempVis: false,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: false,
                        presPVis: false
                    };
                } else if (apiModelName === "sonar") {
                    defaultPayload = {
                        comnPopUpModelParamTemp: 0.3,
                        comnPopUpModelParamMaxLength: 76800,
                        maxValue: 128000,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: false,
                        presPVis: false
                    };
                }
                else if (apiModelName === "sonar-pro") {
                    defaultPayload = {
                        comnPopUpModelParamTemp: 1.9,
                        comnPopUpModelParamMaxLength: 120000,
                        maxValue: 200000,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: false,
                        presPVis: false
                    };
                }
                else if (apiModelName === "sap-abap-1") {
                    defaultPayload = {
                        model: "sap-abap-1",
                        comnPopUpModelParamTemp: 0.5,
                        comnPopUpModelParamMaxLength: 19660,
                        maxValue: 32768,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: false,
                        presPVis: false
                    };
                }
                 else if (apiModelName === "cohere--command-a-reasoning") {
                    defaultPayload = {
                        model: "cohere--command-a-reasoning",
                        comnPopUpModelParamTemp: 1,
                        comnPopUpModelParamMaxLength: 2457,
                        maxValue: 4096,
                        comnPopUpModelParamFreqP: 0,
                        comnPopUpModelParamPresenceP: 0,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: true,
                        presPVis: true
                    };
                }
                 else if (apiModelName === "gemini-2.5-pro") {
                    defaultPayload = {
                        comnPopUpModelParamTemp: 2,
                        comnPopUpModelParamMaxLength: 39321,
                        maxValue: 65536,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: false,
                        presPVis: false
                    };
                }
                else if (apiModelName === "gemini-2.5-pro"|| apiModelName === "gemini-2.5-flash" || apiModelName === "gemini-3.5-flash") {
                    defaultPayload = {
                        comnPopUpModelParamTemp: 2,
                        comnPopUpModelParamMaxLength: 39321,
                        maxValue: 65536,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: false,
                        presPVis: false
                    };
                }
                else if (apiModelName === "gemini-3.1-flash-lite" || apiModelName === "gemini-2.5-flash-lite") {
                 defaultPayload = {
                      
                        comnPopUpModelParamMaxLength: 39321,
                        maxValue: 65536,
                        tempVis: false,
                        maxRespVis: true,
                        topPVis: false,
                        freqPVis: false,
                        presPVis: false
                    };   
                }
                else {
                    defaultPayload = {
                        comnPopUpModelParamTemp: 1,
                        comnPopUpModelParamTopP: 0,
                        comnPopUpModelParamFreqP: 0,
                        comnPopUpModelParamPresenceP: 0,
                        comnPopUpModelParamMaxLength: 76800,
                        maxValue: 128000,
                        tempVis: true,
                        maxRespVis: true,
                        topPVis: true,
                        freqPVis: true,
                        presPVis: true
                    };
                }
                retPayload = new sap.ui.model.json.JSONModel(defaultPayload);
                return retPayload;
            }
    };
});