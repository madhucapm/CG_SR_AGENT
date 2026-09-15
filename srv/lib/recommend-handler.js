/**
 * recommend-handler.js
 *
 * Backend proxy for the Python agent's /recommend-scenario endpoint.
 *
 * The UI previously called the Python agent directly via the managed
 * approuter's xs-app.json destination route.  The SAP Launchpad managed
 * approuter has a ~30-second internal HTTP-client timeout that cannot be
 * configured, which caused 504 Gateway Timeout errors whenever the Python
 * agent took longer than that threshold.
 *
 * By routing the call through the CAP backend (same pattern as
 * analyze-impact-handler.js), we use the @sap-cloud-sdk/http-client
 * which has a configurable timeout (default 5 minutes) and is a
 * server-to-server call that bypasses the managed approuter entirely.
 *
 * Usage in service.js:
 *
 *     this.on('runRecommendation',
 *         require('./lib/recommend-handler')(executeHttpRequest, logger));
 */

'use strict';

/**
 * Extract a human-readable error message from an SAP Cloud SDK / axios
 * error.  The SDK often nests the real cause several levels deep.
 */
function extractErrorDetail(error) {
    return (
        (error && error.rootCause && error.rootCause.message) ||
        (error && error.cause     && error.cause.message)     ||
        (error && error.response  && error.response.data && (
            (error.response.data.error && (
                (error.response.data.error.message && error.response.data.error.message.value) ||
                error.response.data.error.message
            )) ||
            (error.response.data.detail) ||
            (typeof error.response.data === 'string'
                ? error.response.data
                : JSON.stringify(error.response.data).substring(0, 500))
        )) ||
        (error && error.message) ||
        String(error)
    );
}

/**
 * Build the CAP handler bound to `executeHttpRequest` + `logger`.
 *
 * @param {Function} executeHttpRequest - @sap-cloud-sdk/http-client
 * @param {Object}   logger            - createLogger instance
 * @returns {Function} CAP action handler for `runRecommendation`
 */
module.exports = function buildHandler(executeHttpRequest, logger) {

    return async function runRecommendation(req) {
        logger.info('runRecommendation action called');

        // ── Parse the JSON payload string from the OData action ──────────
        const { payload } = req.data || {};

        if (!payload) {
            return {
                success: false,
                error: 'payload is required (JSON string with recommend-scenario fields)'
            };
        }

        let parsedPayload;
        try {
            parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
        } catch (parseErr) {
            logger.error(`runRecommendation: invalid JSON payload: ${parseErr.message}`);
            return {
                success: false,
                error: `Invalid JSON payload: ${parseErr.message}`
            };
        }

        // ── Validate required fields ─────────────────────────────────────
        if (!parsedPayload.incidentId) {
            return {
                success: false,
                error: 'incidentId is required in the payload'
            };
        }

        // ── Guard: SDK must be available ─────────────────────────────────
        if (!executeHttpRequest) {
            logger.error('runRecommendation: @sap-cloud-sdk/http-client not available');
            return {
                success: false,
                error: '@sap-cloud-sdk/http-client is not loaded — cannot call external agent'
            };
        }

        // ── POST /recommend-scenario on the Python agent ─────────────────
        let agentResponse;
        try {
            logger.info(
                `runRecommendation: POST /recommend-scenario to supplier_resilience_agent ` +
                `for incident ${parsedPayload.incidentId}`
            );

            const resp = await executeHttpRequest(
                { destinationName: 'supplier_resilience_agent' },
                {
                    method: 'POST',
                    url: '/recommend-scenario',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json'
                    },
                    data: parsedPayload,
                    // Allow up to 3 minutes for the Python agent to respond.
                    // The default SDK timeout is 5 min; we set an explicit
                    // ceiling to surface failures faster than the CAP request
                    // timeout (which is typically ~5 min in CF).
                    timeout: 180000
                }
            );

            agentResponse = (resp && resp.data) ? resp.data : null;
        } catch (err) {
            const detail = extractErrorDetail(err);
            logger.error(`runRecommendation: /recommend-scenario failed: ${detail}`);
            return {
                success: false,
                error: `supplier_resilience_agent /recommend-scenario failed: ${detail}`
            };
        }

        if (!agentResponse) {
            return {
                success: false,
                error: 'supplier_resilience_agent returned an empty or unparseable response'
            };
        }

        // ── Return the Python response as-is, wrapped in a success flag ──
        // The UI expects the raw recommend-scenario JSON shape
        // (rankedOptionList, topRecommendation, weightMatrix, etc.).
        // We stringify it so it fits the OData `returns String` type and
        // the UI can JSON.parse() it back.
        logger.info('runRecommendation: completed successfully');
        return {
            success: true,
            result: JSON.stringify(agentResponse),
            error: null
        };
    };
};

// Expose helper for unit tests
module.exports.extractErrorDetail = extractErrorDetail;
