sap.ui.define([
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/BusyDialog",
    "sap/ui/model/json/JSONModel",
    "supplierresilience/model/models"
], function (Fragment, MessageBox, BusyDialog, JSONModel, models) {
    "use strict";

    return {

         getApiUrl: async function (apiModelName, aiKey, sApiUrl, basePath) {
            const deploymentId = await models.getOrchestrationDeploymentId(basePath);
            if (!deploymentId) {
                throw new Error("Orchestration deployment not found");
            }
            return `${basePath}/deployments/${deploymentId}/completion`;
        },
        _getModelProvider: function (modelName) {
            if (!modelName) return "openai";
            var name = modelName.toLowerCase();
            if (name.includes("sap-abap") || name.includes("abap")) return "sap-abap";
            if (name.includes("anthropic") || name.includes("claude")) return "anthropic";
            if (name.includes("gemini")) return "google";
            if (name.includes("amazon") || name.includes("titan") || name.includes("nova")) return "amazon";
            if (name.includes("mistral") || name.includes("codestral") || name.includes("mixtral")) return "mistral";
            if (name.includes("meta") || name.includes("llama")) return "meta";
            if (name.includes("cohere") || name.includes("command")) return "cohere";
            return "openai";
        },
         _createOrchestrationPayload: function (apiModelName, aMessages, params, stream) {
            if (stream === undefined) stream = true;
            var provider = this._getModelProvider(apiModelName);
            var modelParams = this._buildModelParams(provider, params);
            var isMultiTurn = aMessages.some(function (msg) { return msg.role === "assistant"; });

        if (provider === "sap-abap") {
                var systemMessage = "";
                for (var s = 0; s < aMessages.length; s++) {
                    if (aMessages[s].role === "system" && aMessages[s].content) {
                        systemMessage = aMessages[s].content;
                        break;
                    }
                }
                var nonSystemMessages = aMessages.filter(function (msg) { return msg.role !== "system"; });
 
                if (isMultiTurn) {
                    var firstUserMsg = "";
                    var lastAssistantMsg = "";
                    var lastUserMsg = "";
 
                    for (var i = 0; i < nonSystemMessages.length; i++) {
                        var msg = nonSystemMessages[i];
                        if (msg.role === "user" && !firstUserMsg) {
                            firstUserMsg = msg.content || "";
                        }
                        if (msg.role === "assistant") {
                            lastAssistantMsg = msg.content || "";
                        }
                        if (msg.role === "user") {
                            lastUserMsg = msg.content || "";
                        }
                    }
 
                    return {
                        orchestration_config: {
                            stream: stream,
                            module_configurations: {
                                llm_module_config: {
                                    model_name: apiModelName,
                                    model_params: modelParams
                                },
                                templating_module_config: {
                                    template: [
                                        { role: "user", content: "{{?initial_request}}" },
                                        { role: "assistant", content: "{{?previous_response}}" },
                                        { role: "user", content: "{{?followup_request}}" }
                                    ]
                                }
                            }
                        },
                        input_params: {
                            initial_request: initialRequest,
                            previous_response: lastAssistantMsg,
                            followup_request: lastUserMsg
                        }
                    };
                }
 
                var userContent = "";
                for (var j = 0; j < nonSystemMessages.length; j++) {
                    if (nonSystemMessages[j].role === "user") {
                        userContent = nonSystemMessages[j].content || "";
                    }
                }
                 var combinedUserMessage = userContent;
                if (systemMessage) {
                    combinedUserMessage = systemMessage + "\n" + userContent;
                }
 
                return {
                    orchestration_config: {
                        stream: stream,
                        module_configurations: {
                            llm_module_config: {
                                model_name: apiModelName,
                                model_params: modelParams
                            },
                            templating_module_config: {
                                template: [
                                    { role: "user", content: "{{?user_message}}" }
                                ]
                            }
                        }
                    },
                    input_params: {
                        user_message: combinedUserMessage
                    }
                };
            }

            if (isMultiTurn) {
                var conversationTemplate = aMessages.map(function (msg) {
                    return { role: msg.role, content: msg.content };
                });

                return {
                    orchestration_config: {
                        stream: stream,
                        module_configurations: {
                            llm_module_config: {
                                model_name: apiModelName,
                                model_params: modelParams
                            },
                            templating_module_config: {
                                template: conversationTemplate
                            }
                        }
                    }
                };
            }
            var extractedMessages = this._extractMessagesForTemplate(aMessages);

            // Image/multimodal case: build payload with image_url in template
            if (extractedMessages.imageData) {
                return {
                    orchestration_config: {
                        stream: stream,
                        module_configurations: {
                            llm_module_config: {
                                model_name: apiModelName,
                                model_params: modelParams
                            },
                            templating_module_config: {
                                template: [
                                    { role: "system", content: "{{?system_message}}" },
                                    {
                                        role: "user",
                                        content: [
                                            {
                                                type: "text",
                                                text: "{{?user_text}}"
                                            },
                                            {
                                                type: "image_url",
                                                image_url: {
                                                    url: extractedMessages.imageData.url
                                                }
                                            }
                                        ]
                                    }
                                ]
                            }
                        }
                    },
                    input_params: {
                        system_message: extractedMessages.systemMessage,
                        user_text: extractedMessages.userMessage
                    }
                };
            }

            return {
                orchestration_config: {
                    stream: stream,
                    module_configurations: {
                        llm_module_config: {
                            model_name: apiModelName,
                            model_params: modelParams
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
                    system_message: extractedMessages.systemMessage,
                    user_message: extractedMessages.userMessage
                }
            };
        },


    }

});