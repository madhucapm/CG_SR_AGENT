/**
 * Event Validator for Coordinator Agent
 * 
 * Migrated from: supply-chain-agents/agents/coordinator/validator.py
 * 
 * Per Initial Development Guidelines - Task 2: Validate the event
 * Validates incoming disruption events before processing.
 * 
 * Validation includes:
 * - Required fields presence
 * - Field types and formats
 * - Value ranges
 * - Event type validation
 */

'use strict';

const {
    EventType,
    REQUIRED_EVENT_FIELDS,
    FIELD_MAX_LENGTHS
} = require('../lib/constants');

const { 
    isEmpty, 
    isNonEmptyString, 
    isNonNegativeNumber,
    createLogger 
} = require('../lib/utils');

const logger = createLogger('Validator');

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION ERROR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validation Error
 * Represents a single validation error with field and message
 */
class ValidationError {
    /**
     * Create a validation error
     * 
     * @param {string} field - Field that failed validation
     * @param {string} message - Error message
     * @param {string} code - Error code (optional)
     */
    constructor(field, message, code = 'INVALID') {
        this.field = field;
        this.message = message;
        this.code = code;
    }
    
    /**
     * Convert to plain object
     * @returns {Object}
     */
    toObject() {
        return {
            field: this.field,
            message: this.message,
            code: this.code
        };
    }
    
    /**
     * Convert to string
     * @returns {string}
     */
    toString() {
        return `${this.field}: ${this.message}`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION RESULT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validation Result
 * Contains validation status and any errors found
 */
class ValidationResult {
    /**
     * Create a validation result
     * 
     * @param {boolean} isValid - Whether validation passed
     * @param {ValidationError[]} errors - List of validation errors
     * @param {Object} validatedData - Validated and normalized data
     */
    constructor(isValid = true, errors = [], validatedData = null) {
        this.isValid = isValid;
        this.errors = errors;
        this.validatedData = validatedData;
    }
    
    /**
     * Add an error to the result
     * @param {ValidationError} error
     */
    addError(error) {
        this.errors.push(error);
        this.isValid = false;
    }
    
    /**
     * Get error messages as array of strings
     * @returns {string[]}
     */
    getErrorMessages() {
        return this.errors.map(e => e.toString());
    }
    
    /**
     * Convert to plain object
     * @returns {Object}
     */
    toObject() {
        return {
            isValid: this.isValid,
            errors: this.errors.map(e => e.toObject()),
            validatedData: this.validatedData
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT VALIDATOR CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Event Validator
 * Validates incoming disruption events
 */
class EventValidator {
    /**
     * Create an EventValidator instance
     * 
     * @param {Object} options - Validation options
     * @param {string[]} options.requiredFields - Required field names
     * @param {Object} options.maxLengths - Maximum field lengths
     */
    constructor(options = {}) {
        this.requiredFields = options.requiredFields || REQUIRED_EVENT_FIELDS;
        this.maxLengths = options.maxLengths || FIELD_MAX_LENGTHS;
        this.validEventTypes = Object.values(EventType);
    }
    
    /**
     * Validate an event
     * 
     * @param {Object} eventData - Raw event data
     * @returns {ValidationResult} Validation result
     */
    validate(eventData) {
        const result = new ValidationResult();
        
        // Check if event data exists
        if (!eventData || typeof eventData !== 'object') {
            result.addError(new ValidationError(
                'event',
                'Event data is required and must be an object',
                'MISSING_DATA'
            ));
            return result;
        }
        
        // Validate required fields
        this._validateRequiredFields(eventData, result);
        
        // If required fields are missing, skip further validation
        if (!result.isValid) {
            return result;
        }
        
        // Validate field types
        this._validateFieldTypes(eventData, result);
        
        // Validate field lengths
        this._validateFieldLengths(eventData, result);
        
        // Validate event type
        this._validateEventType(eventData, result);
        
        // Validate delay days
        this._validateDelayDays(eventData, result);
        
        // Validate event time if provided
        if (eventData.eventTime) {
            this._validateEventTime(eventData, result);
        }
        
        // If validation passed, include normalized data
        if (result.isValid) {
            result.validatedData = this._normalizeEventData(eventData);
        }
        
        logger.debug(`Validation result: isValid=${result.isValid}, errors=${result.errors.length}`);
        
        return result;
    }
    
    /**
     * Validate required fields are present
     * 
     * @param {Object} eventData - Event data
     * @param {ValidationResult} result - Validation result to update
     */
    _validateRequiredFields(eventData, result) {
        for (const field of this.requiredFields) {
            if (isEmpty(eventData[field])) {
                result.addError(new ValidationError(
                    field,
                    `${field} is required`,
                    'REQUIRED_FIELD'
                ));
            }
        }
    }
    
    /**
     * Validate field types
     * 
     * @param {Object} eventData - Event data
     * @param {ValidationResult} result - Validation result to update
     */
    _validateFieldTypes(eventData, result) {
        const stringFields = ['eventId', 'eventType', 'supplier', 'material', 'plant', 'po'];
        
        for (const field of stringFields) {
            if (eventData[field] !== undefined && eventData[field] !== null) {
                if (typeof eventData[field] !== 'string') {
                    result.addError(new ValidationError(
                        field,
                        `${field} must be a string`,
                        'INVALID_TYPE'
                    ));
                }
            }
        }
        
        // delayDays should be a number
        if (eventData.delayDays !== undefined && eventData.delayDays !== null) {
            if (typeof eventData.delayDays !== 'number' || isNaN(eventData.delayDays)) {
                result.addError(new ValidationError(
                    'delayDays',
                    'delayDays must be a number',
                    'INVALID_TYPE'
                ));
            }
        }
    }
    
    /**
     * Validate field lengths
     * 
     * @param {Object} eventData - Event data
     * @param {ValidationResult} result - Validation result to update
     */
    _validateFieldLengths(eventData, result) {
        for (const [field, maxLength] of Object.entries(this.maxLengths)) {
            if (eventData[field] && typeof eventData[field] === 'string') {
                if (eventData[field].length > maxLength) {
                    result.addError(new ValidationError(
                        field,
                        `${field} exceeds maximum length of ${maxLength} characters`,
                        'FIELD_TOO_LONG'
                    ));
                }
            }
        }
    }
    
    /**
     * Validate event type
     * 
     * @param {Object} eventData - Event data
     * @param {ValidationResult} result - Validation result to update
     */
    _validateEventType(eventData, result) {
        const eventType = eventData.eventType;
        
        if (eventType && !this.validEventTypes.includes(eventType)) {
            // Log warning but don't fail - allow unknown event types
            logger.warn(`Unknown event type: ${eventType}. Valid types: ${this.validEventTypes.join(', ')}`);
        }
    }
    
    /**
     * Validate delay days
     * 
     * @param {Object} eventData - Event data
     * @param {ValidationResult} result - Validation result to update
     */
    _validateDelayDays(eventData, result) {
        const delayDays = eventData.delayDays;
        
        if (delayDays !== undefined && delayDays !== null) {
            if (typeof delayDays === 'number' && delayDays < 0) {
                result.addError(new ValidationError(
                    'delayDays',
                    'delayDays cannot be negative',
                    'INVALID_VALUE'
                ));
            }
            
            // Warn for unusually large delay
            if (typeof delayDays === 'number' && delayDays > 365) {
                logger.warn(`Unusually large delay: ${delayDays} days`);
            }
        }
    }
    
    /**
     * Validate event time
     * 
     * @param {Object} eventData - Event data
     * @param {ValidationResult} result - Validation result to update
     */
    _validateEventTime(eventData, result) {
        const eventTime = eventData.eventTime;
        
        if (eventTime) {
            const parsed = new Date(eventTime);
            
            if (isNaN(parsed.getTime())) {
                result.addError(new ValidationError(
                    'eventTime',
                    'eventTime must be a valid ISO 8601 timestamp',
                    'INVALID_FORMAT'
                ));
            }
        }
    }
    
    /**
     * Normalize event data
     * Ensures consistent format for downstream processing
     * 
     * @param {Object} eventData - Raw event data
     * @returns {Object} Normalized event data
     */
    _normalizeEventData(eventData) {
        return {
            eventId: String(eventData.eventId || '').trim(),
            eventType: String(eventData.eventType || 'PO_DELAY').trim().toUpperCase(),
            eventTime: eventData.eventTime ? new Date(eventData.eventTime).toISOString() : new Date().toISOString(),
            po: String(eventData.po || '').trim(),
            supplier: String(eventData.supplier || '').trim(),
            material: String(eventData.material || '').trim(),
            plant: String(eventData.plant || '').trim(),
            delayDays: parseInt(eventData.delayDays, 10) || 0,
            description: String(eventData.description || '').trim(),
            source: String(eventData.source || 'MANUAL').trim()
        };
    }
    
    /**
     * Quick validation check (returns boolean only)
     * 
     * @param {Object} eventData - Event data to validate
     * @returns {boolean} True if valid
     */
    isValid(eventData) {
        return this.validate(eventData).isValid;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVENIENCE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate event data (convenience function)
 * 
 * @param {Object} eventData - Event data to validate
 * @returns {ValidationResult} Validation result
 */
function validateEvent(eventData) {
    const validator = new EventValidator();
    return validator.validate(eventData);
}

/**
 * Check if event is valid (convenience function)
 * 
 * @param {Object} eventData - Event data to validate
 * @returns {boolean} True if valid
 */
function isValidEvent(eventData) {
    const validator = new EventValidator();
    return validator.isValid(eventData);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    EventValidator,
    ValidationError,
    ValidationResult,
    validateEvent,
    isValidEvent
};