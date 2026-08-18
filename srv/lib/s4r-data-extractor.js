/**
 * S4R Data Extractor for Early Warning Agent
 * 
 * Extracts and computes metrics from getPurchaseOrderDetails response
 * for use by the Early Warning Agent.
 */

'use strict';

const { createLogger } = require('./utils');
const logger = createLogger('S4RDataExtractor');

// ═══════════════════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse date string to Date object
 */
function parseDate(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) {
        return isNaN(dateStr.getTime()) ? null : dateStr;
    }
    // Handle OData V2 format: /Date(1234567890000)/
    if (typeof dateStr === 'string') {
        const odataMatch = dateStr.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
        if (odataMatch) {
            const timestamp = parseInt(odataMatch[1], 10);
            const d = new Date(timestamp);
            return isNaN(d.getTime()) ? null : d;
        }
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1, date2) {
    const d1 = parseDate(date1);
    const d2 = parseDate(date2);
    if (!d1 || !d2) return 0;
    const d1Normalized = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const d2Normalized = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    const diffTime = d1Normalized.getTime() - d2Normalized.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get today's date normalized to start of day
 */
function getToday() {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract and compute all Early Warning metrics from S4R PO data
 */
function extractEarlyWarningData(s4rResponse) {
    logger.info('Extracting Early Warning data from S4R response');
    
    const { purchaseOrder, purchaseOrderItems = [], scheduleLines = [], materialDocuments = [] } = s4rResponse || {};
    
    // Initialize result structure
    const result = {
        poNumber: null, poType: null, orderDate: null, currency: null, poNetAmount: null,
        supplierId: null, supplierName: null, supplierOtif: null, supplierTrend: null, previousDelays: null,
        materialId: null, materialDescription: null, materialCriticality: null,
        plant: null, affectedPlants: [], affectedSkus: null,
        expectedDeliveryDate: null, actualDeliveryDate: null, delayDays: 0, deliveryStatus: 'UNKNOWN',
        isOnTime: null, isInFull: null, otifForThisPO: null, otifReason: null,
        orderedQuantity: 0, deliveredQuantity: 0, quantityUnit: null, deliveryCompletion: 0,
        estimatedRevenueImpact: 0,
        dataAvailability: { poHeader: false, poItems: false, scheduleLines: false, goodsReceipts: false }
    };
    
    // STEP 1: Extract PO Header Data
    if (purchaseOrder && Object.keys(purchaseOrder).length > 0) {
        result.dataAvailability.poHeader = true;
        result.poNumber = purchaseOrder.PurchaseOrder || null;
        result.poType = purchaseOrder.PurchaseOrderType || null;
        result.orderDate = purchaseOrder.PurchaseOrderDate || null;
        result.currency = purchaseOrder.DocumentCurrency || null;
        result.supplierId = purchaseOrder.Supplier || null;
        result.supplierName = purchaseOrder.AddressName || purchaseOrder.SupplierName || purchaseOrder.Supplier || null;
        const netAmount = parseFloat(purchaseOrder.PurchaseOrderNetAmount);
        if (!isNaN(netAmount) && netAmount > 0) {
            result.poNetAmount = netAmount;
            result.estimatedRevenueImpact = netAmount;
        }
    }
    
    // STEP 2: Extract PO Items Data
    if (purchaseOrderItems && purchaseOrderItems.length > 0) {
        result.dataAvailability.poItems = true;
        const firstItem = purchaseOrderItems[0];
        result.materialId = firstItem.Material || null;
        result.materialDescription = firstItem.PurchaseOrderItemText || firstItem.MaterialName || null;
        result.plant = firstItem.Plant || null;
        result.quantityUnit = firstItem.PurchaseOrderQuantityUnit || firstItem.OrderQuantityUnit || null;
        result.affectedPlants = [...new Set(purchaseOrderItems.map(item => item.Plant).filter(p => p && String(p).trim() !== ''))];
        result.orderedQuantity = purchaseOrderItems.reduce((sum, item) => sum + (parseFloat(item.OrderQuantity) || 0), 0);
        const hasDeliveryFlag = purchaseOrderItems.some(item => item.IsCompletelyDelivered !== undefined);
        if (hasDeliveryFlag) {
            result.isInFull = purchaseOrderItems.every(item => item.IsCompletelyDelivered === true || item.IsCompletelyDelivered === 'X');
        }
    }
    
    // STEP 3: Extract Schedule Lines (Planned Delivery Date)
    if (scheduleLines && scheduleLines.length > 0) {
        result.dataAvailability.scheduleLines = true;
        const firstLine = scheduleLines[0];
        result.expectedDeliveryDate = firstLine.SchedLineStscDeliveryDate || firstLine.ScheduleLineDeliveryDate || null;
    }
    
    // STEP 4: Extract Goods Receipts
    const goodsReceipts = (materialDocuments || []).filter(md => md.GoodsMovementType === '101' || md.GoodsMovementType === 101);
    if (goodsReceipts.length > 0) {
        result.dataAvailability.goodsReceipts = true;
        const sortedGRs = [...goodsReceipts].sort((a, b) => {
            const dateA = parseDate(a.PostingDate), dateB = parseDate(b.PostingDate);
            if (!dateA && !dateB) return 0;
            if (!dateA) return 1;
            if (!dateB) return -1;
            return dateB.getTime() - dateA.getTime();
        });
        result.actualDeliveryDate = sortedGRs[0].PostingDate || null;
        result.deliveredQuantity = goodsReceipts.reduce((sum, gr) => sum + (parseFloat(gr.QuantityInEntryUnit || gr.Quantity) || 0), 0);
        if (result.orderedQuantity > 0) result.isInFull = result.deliveredQuantity >= result.orderedQuantity;
    }
    
    // STEP 5-8: Compute derived fields
    result.delayDays = computeDelayDays(result.expectedDeliveryDate, result.actualDeliveryDate, goodsReceipts.length > 0);
    result.deliveryStatus = computeDeliveryStatus(goodsReceipts.length > 0, result.isInFull, result.expectedDeliveryDate, result.deliveredQuantity, result.orderedQuantity);
    const otifResult = computeOtifForPO(result.expectedDeliveryDate, result.actualDeliveryDate, result.orderedQuantity, result.deliveredQuantity, goodsReceipts.length > 0);
    Object.assign(result, { isOnTime: otifResult.isOnTime, isInFull: otifResult.isInFull, otifForThisPO: otifResult.otif, otifReason: otifResult.reason });
    if (result.orderedQuantity > 0) result.deliveryCompletion = Math.min(100, Math.round((result.deliveredQuantity / result.orderedQuantity) * 100));
    
    logger.info(`S4R extraction complete: PO=${result.poNumber}, delayDays=${result.delayDays}, OTIF=${result.otifForThisPO}%`);
    return result;
}



// ═══════════════════════════════════════════════════════════════════════════════
// COMPUTATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute delay days from planned and actual delivery dates
 */
function computeDelayDays(plannedDate, actualDate, hasGoodsReceipt) {
    const planned = parseDate(plannedDate);
    if (!planned) return 0;
    const today = getToday();
    
    if (hasGoodsReceipt && actualDate) {
        const actual = parseDate(actualDate);
        if (actual) return daysBetween(actual, planned);
    }
    // Not delivered yet - check if overdue
    if (planned < today) return daysBetween(today, planned);
    return 0; // Not yet due
}

/**
 * Compute delivery status based on GR existence and dates
 */
function computeDeliveryStatus(hasGoodsReceipt, isInFull, plannedDate, deliveredQty, orderedQty) {
    if (hasGoodsReceipt) {
        if (isInFull) return 'DELIVERED';
        if (deliveredQty > 0) return 'PARTIALLY_DELIVERED';
    }
    const planned = parseDate(plannedDate);
    if (!planned) return 'UNKNOWN';
    const today = getToday();
    return planned < today ? 'OVERDUE' : 'PENDING';
}

/**
 * Compute OTIF (On-Time In-Full) for a single Purchase Order
 * OTIF = 100% if (On-Time AND In-Full), else 0%
 */
function computeOtifForPO(plannedDate, actualDate, orderedQty, deliveredQty, hasGoodsReceipt) {
    const result = { isOnTime: null, isInFull: null, otif: null, reason: null };
    
    if (!hasGoodsReceipt) {
        result.reason = 'Delivery not yet completed - OTIF cannot be determined';
        return result;
    }
    
    const planned = parseDate(plannedDate);
    const actual = parseDate(actualDate);
    
    if (!planned) { result.reason = 'No planned delivery date available'; return result; }
    if (!actual) { result.reason = 'No actual delivery date available'; return result; }
    
    result.isOnTime = actual <= planned;
    result.isInFull = orderedQty > 0 ? deliveredQty >= orderedQty : true;
    
    result.otif = (result.isOnTime && result.isInFull) ? 100 : 0;
    
    // Build reason
    const reasons = [];
    if (!result.isOnTime) {
        const delayDays = daysBetween(actual, planned);
        reasons.push(`Late by ${delayDays} day${delayDays !== 1 ? 's' : ''}`);
    } else { reasons.push('On-time'); }
    if (!result.isInFull) {
        const shortfall = orderedQty - deliveredQty;
        reasons.push(`Short by ${shortfall} unit${shortfall !== 1 ? 's' : ''}`);
    } else { reasons.push('In-full'); }
    
    result.reason = (result.isOnTime && result.isInFull) ? 'Delivered on-time and in-full' : reasons.join('; ');
    return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    extractEarlyWarningData,
    computeDelayDays,
    computeDeliveryStatus,
    computeOtifForPO,
    parseDate,
    daysBetween,
    getToday
};
