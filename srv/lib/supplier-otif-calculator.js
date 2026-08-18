/**
 * Supplier OTIF Calculator
 * 
 * Calculates historical OTIF (On-Time In-Full) metrics for a supplier
 * based on multiple Purchase Orders and their delivery data.
 * 
 * OTIF Formula:
 *   - isOnTime = actualDeliveryDate <= plannedDeliveryDate
 *   - isInFull = deliveredQuantity >= orderedQuantity
 *   - isOTIF = isOnTime AND isInFull
 *   - OTIF% = (Count of OTIF POs / Count of Delivered POs) × 100
 */

'use strict';

const { createLogger } = require('./utils');
const logger = createLogger('SupplierOtifCalculator');

// ═══════════════════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Parse date string to Date object (handles OData V2 format) */
function parseDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;
    if (typeof dateStr === 'string') {
        const odataMatch = dateStr.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
        if (odataMatch) {
            const d = new Date(parseInt(odataMatch[1], 10));
            return isNaN(d.getTime()) ? null : d;
        }
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

/** Calculate days between two dates (date1 - date2) */
function daysBetween(date1, date2) {
    const d1 = parseDate(date1), d2 = parseDate(date2);
    if (!d1 || !d2) return 0;
    const d1N = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const d2N = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return Math.round((d1N.getTime() - d2N.getTime()) / (1000 * 60 * 60 * 24));
}

/** Get today's date normalized to start of day */
function getToday() {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

/** Format date to ISO string (YYYY-MM-DD) */
function formatDateISO(date) {
    const d = parseDate(date);
    return d ? d.toISOString().split('T')[0] : null;
}

/** Get date N months ago in ISO format */
function getDateMonthsAgo(months) {
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date.toISOString().split('T')[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PO DATA EXTRACTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Get the earliest planned delivery date from schedule lines */
function getEarliestPlannedDate(scheduleLines) {
    if (!scheduleLines || scheduleLines.length === 0) return null;
    let earliest = null;
    for (const sl of scheduleLines) {
        const dateStr = sl.ScheduleLineDeliveryDate || sl.SchedLineStscDeliveryDate;
        const date = parseDate(dateStr);
        if (date && (!earliest || date < earliest)) earliest = date;
    }
    return earliest ? formatDateISO(earliest) : null;
}

/** Aggregate goods receipts to get actual delivery date and total delivered quantity */
function aggregateGoodsReceipts(materialDocuments) {
    if (!materialDocuments || materialDocuments.length === 0) {
        return { actualDate: null, deliveredQty: 0 };
    }
    let earliestDate = null, totalQty = 0;
    for (const doc of materialDocuments) {
        const movementType = doc.GoodsMovementType;
        const qty = parseFloat(doc.QuantityInEntryUnit) || 0;
        if (movementType === '101') totalQty += qty;
        else if (movementType === '102' || movementType === '122') totalQty -= qty;
        const dateStr = doc.PostingDate || doc.DocumentDate;
        const date = parseDate(dateStr);
        if (date && (!earliestDate || date < earliestDate)) earliestDate = date;
    }
    return { actualDate: earliestDate ? formatDateISO(earliestDate) : null, deliveredQty: Math.max(0, totalQty) };
}

/** Sum ordered quantity from PO items */
function sumOrderedQuantity(poItems) {
    if (!poItems || poItems.length === 0) return 0;
    return poItems.reduce((sum, item) => sum + (parseFloat(item.OrderQuantity) || 0), 0);
}

/** Check if a PO is overdue (planned date has passed with no delivery) */
function isOverdue(plannedDate) {
    const planned = parseDate(plannedDate);
    return planned ? planned < getToday() : false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OTIF CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Compute OTIF status for a single Purchase Order */
function computePoOtifStatus(poData) {
    const { poNumber, orderDate, scheduleLines = [], materialDocuments = [], items = [] } = poData;
    const plannedDeliveryDate = getEarliestPlannedDate(scheduleLines);
    const { actualDate: actualDeliveryDate, deliveredQty } = aggregateGoodsReceipts(materialDocuments);
    const orderedQty = sumOrderedQuantity(items);
    const hasGoodsReceipt = deliveredQty > 0;

    const result = {
        poNumber, orderDate: formatDateISO(orderDate), plannedDeliveryDate, actualDeliveryDate,
        orderedQuantity: orderedQty, deliveredQuantity: deliveredQty,
        isOnTime: null, isInFull: null, isOtif: null, delayDays: 0, status: 'UNKNOWN', reason: null
    };

    // If no delivery yet
    if (!hasGoodsReceipt) {
        if (!plannedDeliveryDate) {
            result.status = 'NO_SCHEDULE'; result.reason = 'No schedule line with delivery date';
        } else if (isOverdue(plannedDeliveryDate)) {
            result.status = 'OVERDUE';
            result.delayDays = daysBetween(getToday(), parseDate(plannedDeliveryDate));
            result.reason = `Overdue by ${result.delayDays} day(s) - no goods receipt yet`;
        } else {
            result.status = 'PENDING'; result.reason = 'Delivery not yet due';
        }
        return result;
    }

    // Delivery exists - calculate OTIF
    result.status = 'DELIVERED';

    // Check On-Time
    if (plannedDeliveryDate && actualDeliveryDate) {
        const planned = parseDate(plannedDeliveryDate), actual = parseDate(actualDeliveryDate);
        if (planned && actual) {
            result.isOnTime = actual <= planned;
            result.delayDays = Math.max(0, daysBetween(actual, planned));
        }
    } else if (!plannedDeliveryDate) {
        result.reason = 'Cannot determine on-time: no planned delivery date';
    }

    // Check In-Full
    if (orderedQty > 0) {
        result.isInFull = deliveredQty >= orderedQty;
        if (!result.isInFull) {
            result.status = 'PARTIALLY_DELIVERED';
            result.reason = (result.reason ? result.reason + '; ' : '') + `Short by ${(orderedQty - deliveredQty).toFixed(2)} units`;
        }
    } else {
        result.isInFull = true;
    }

    // Calculate OTIF
    if (result.isOnTime !== null && result.isInFull !== null) {
        result.isOtif = result.isOnTime && result.isInFull;
        if (result.isOtif) {
            result.reason = 'Delivered on-time and in-full';
        } else {
            const reasons = [];
            if (!result.isOnTime) reasons.push(`Late by ${result.delayDays} day(s)`);
            if (!result.isInFull) reasons.push('Short delivery');
            result.reason = reasons.join('; ');
        }
    }
    return result;
}

/** Calculate aggregate OTIF metrics for a supplier based on multiple POs */
function calculateSupplierOtif(poDataList) {
    logger.info(`Calculating OTIF for ${poDataList.length} POs`);
    
    let totalPOs = poDataList.length, deliveredPOs = 0, otifPOs = 0, onTimePOs = 0, inFullPOs = 0;
    let pendingPOs = 0, overduePOs = 0, partialPOs = 0;

    const poDetails = poDataList.map(po => {
        const result = computePoOtifStatus(po);
        switch (result.status) {
            case 'DELIVERED':
                deliveredPOs++;
                if (result.isOnTime === true) onTimePOs++;
                if (result.isInFull === true) inFullPOs++;
                if (result.isOtif === true) otifPOs++;
                break;
            case 'PARTIALLY_DELIVERED':
                deliveredPOs++; partialPOs++;
                if (result.isOnTime === true) onTimePOs++;
                break;
            case 'PENDING': pendingPOs++; break;
            case 'OVERDUE': overduePOs++; break;
        }
        return result;
    });

    const otifPercentage = deliveredPOs > 0 ? Math.round((otifPOs / deliveredPOs) * 100) : null;
    const onTimePercentage = deliveredPOs > 0 ? Math.round((onTimePOs / deliveredPOs) * 100) : null;
    const inFullPercentage = deliveredPOs > 0 ? Math.round((inFullPOs / deliveredPOs) * 100) : null;

    logger.info(`OTIF calculation complete: ${otifPOs}/${deliveredPOs} OTIF (${otifPercentage}%)`);

    return {
        otifPercentage, totalPOs, deliveredPOs, otifPOs, onTimePOs, inFullPOs,
        pendingPOs, overduePOs, partiallyDeliveredPOs: partialPOs,
        onTimePercentage, inFullPercentage, poDetails
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    calculateSupplierOtif, computePoOtifStatus,
    getEarliestPlannedDate, aggregateGoodsReceipts, sumOrderedQuantity, isOverdue,
    parseDate, daysBetween, formatDateISO, getDateMonthsAgo, getToday
};

