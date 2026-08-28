/**
 * Utility Functions for Supply Chain Resilience Agents
 * 
 * Migrated from: supply-chain-agents/common/models.py (ID generators)
 * 
 * This module contains shared utility functions for:
 * - ID generation (case IDs, run IDs, event IDs)
 * - Date/time formatting
 * - JSON parsing helpers
 * - Logging utilities
 */

'use strict';

const { DataMode, DEFAULT_CONFIG } = require('./constants');

// ═══════════════════════════════════════════════════════════════════════════════
// ID GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a unique Case ID
 * Format: DC-YYYYMMDD-NNNN (Disruption Case)
 * Example: DC-20250515-0001
 * 
 * @returns {string} Unique case identifier
 */
function generateCaseId() {
    const now = new Date();
    const datePart = formatDateCompact(now);
    const randomPart = Math.floor(Math.random() * 9000) + 1000; // 4 digits
    return `DC-${datePart}-${randomPart}`;
}

/**
 * Generate a unique Impact Case ID
 * Format: SC-YYYY-NNN (Supply Chain case from impact analysis)
 * Example: SC-2026-613
 * 
 * @returns {string} Unique impact case identifier
 */
function generateImpactCaseId() {
    const now = new Date();
    const year = now.getFullYear();
    const randomPart = Math.floor(Math.random() * 900) + 100; // 3 digits (100-999)
    return `SC-${year}-${randomPart}`;
}

/**
 * Generate a unique Run ID
 * Format: RUN-YYYYMMDD-HHMMSS-NNNN
 * Example: RUN-20250515-083045-1234
 * 
 * @returns {string} Unique run identifier
 */
function generateRunId() {
    const now = new Date();
    const datePart = formatDateCompact(now);
    const timePart = formatTimeCompact(now);
    const randomPart = Math.floor(Math.random() * 9000) + 1000; // 4 digits
    return `RUN-${datePart}-${timePart}-${randomPart}`;
}

/**
 * Generate a unique Event ID
 * Format: EVT-YYYYMMDD-NNNN
 * Example: EVT-20250515-0001
 * 
 * @returns {string} Unique event identifier
 */
function generateEventId() {
    const now = new Date();
    const datePart = formatDateCompact(now);
    const randomPart = Math.floor(Math.random() * 9000) + 1000; // 4 digits
    return `EVT-${datePart}-${randomPart}`;
}

/**
 * Generate a UUID v4
 * 
 * @returns {string} UUID v4 string
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATE/TIME FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format date as YYYYMMDD
 * 
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
function formatDateCompact(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

/**
 * Format time as HHMMSS
 * 
 * @param {Date} date - Date object
 * @returns {string} Formatted time string
 */
function formatTimeCompact(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}${minutes}${seconds}`;
}

/**
 * Get current ISO timestamp
 * 
 * @returns {string} ISO 8601 formatted timestamp
 */
function getCurrentTimestamp() {
    return new Date().toISOString();
}

/**
 * Parse ISO timestamp to Date object
 * 
 * @param {string} isoString - ISO 8601 formatted string
 * @returns {Date|null} Date object or null if invalid
 */
function parseTimestamp(isoString) {
    if (!isoString) return null;
    const date = new Date(isoString);
    return isNaN(date.getTime()) ? null : date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Safely parse JSON string
 * 
 * @param {string} jsonString - JSON string to parse
 * @param {*} defaultValue - Default value if parsing fails
 * @returns {*} Parsed object or default value
 */
function safeJsonParse(jsonString, defaultValue = null) {
    if (!jsonString) return defaultValue;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        return defaultValue;
    }
}

/**
 * Safely stringify to JSON
 * 
 * @param {*} obj - Object to stringify
 * @param {string} defaultValue - Default value if stringify fails
 * @returns {string} JSON string or default value
 */
function safeJsonStringify(obj, defaultValue = '[]') {
    if (obj === null || obj === undefined) return defaultValue;
    try {
        return JSON.stringify(obj);
    } catch (e) {
        return defaultValue;
    }
}

/**
 * Parse array stored as JSON string in database
 * Used for fields like affectedPlants, affectedSkus, etc.
 * 
 * @param {string|Array} value - JSON string or array
 * @returns {Array} Parsed array
 */
function parseArrayField(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    return safeJsonParse(value, []);
}

// ═══════════════════════════════════════════════════════════════════════════════
// NUMBER HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Round number to specified decimal places
 * 
 * @param {number} num - Number to round
 * @param {number} decimals - Number of decimal places
 * @returns {number} Rounded number
 */
function roundTo(num, decimals = 2) {
    if (typeof num !== 'number' || isNaN(num)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
}

/**
 * Clamp value between min and max
 * 
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Safe division to avoid divide by zero
 * 
 * @param {number} numerator - Numerator
 * @param {number} denominator - Denominator
 * @param {number} defaultValue - Default if denominator is 0
 * @returns {number} Division result or default
 */
function safeDivide(numerator, denominator, defaultValue = 0) {
    if (!denominator || denominator === 0) return defaultValue;
    return numerator / denominator;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get current data mode from environment or default
 * 
 * @returns {string} Current data mode (MOCK or S4)
 */
function getDataMode() {
    return process.env.DATA_MODE || DEFAULT_CONFIG.dataMode;
}

/**
 * Check if running in mock mode
 * 
 * @returns {boolean} True if in mock mode
 */
function isMockMode() {
    return getDataMode() === DataMode.MOCK;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGGING HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a logger for an agent
 * 
 * @param {string} agentName - Name of the agent
 * @returns {object} Logger object with log methods
 */
function createLogger(agentName) {
    const prefix = `[${agentName}]`;
    
    return {
        info: (message, ...args) => console.log(`${prefix} INFO:`, message, ...args),
        warn: (message, ...args) => console.warn(`${prefix} WARN:`, message, ...args),
        error: (message, ...args) => console.error(`${prefix} ERROR:`, message, ...args),
        debug: (message, ...args) => {
            if (process.env.DEBUG) {
                console.log(`${prefix} DEBUG:`, message, ...args);
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if value is empty (null, undefined, empty string, empty array)
 * 
 * @param {*} value - Value to check
 * @returns {boolean} True if empty
 */
function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
}

/**
 * Check if value is a non-empty string
 * 
 * @param {*} value - Value to check
 * @returns {boolean} True if non-empty string
 */
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Check if value is a positive integer
 * 
 * @param {*} value - Value to check
 * @returns {boolean} True if positive integer
 */
function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

/**
 * Check if value is a non-negative number
 * 
 * @param {*} value - Value to check
 * @returns {boolean} True if non-negative number
 */
function isNonNegativeNumber(value) {
    return typeof value === 'number' && !isNaN(value) && value >= 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    // ID Generators
    generateCaseId,
    generateImpactCaseId,
    generateRunId,
    generateEventId,
    generateUUID,
    
    // Date/Time
    formatDateCompact,
    formatTimeCompact,
    getCurrentTimestamp,
    parseTimestamp,
    
    // JSON Helpers
    safeJsonParse,
    safeJsonStringify,
    parseArrayField,
    
    // Number Helpers
    roundTo,
    clamp,
    safeDivide,
    
    // Configuration
    getDataMode,
    isMockMode,
    
    // Logging
    createLogger,
    
    // Validation
    isEmpty,
    isNonEmptyString,
    isPositiveInteger,
    isNonNegativeNumber
};