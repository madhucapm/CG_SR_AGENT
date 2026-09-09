/**
 * Survival Planner — S/4HANA-Integrated Service
 *
 * Replaces the mock-data-based Survival Agent with real-time
 * S/4HANA OData API calls via the BTP `S4R` destination.
 *
 * Implements the 10-step survival planning workflow:
 *   Step 3  — Fetch Open POs for Affected Supplier
 *   Step 4  — Fetch Inbound Deliveries for Affected Supplier
 *   Step 5  — Anti-Double-Count Reconciliation
 *   Step 6  — Compute Weekly Demand (from Demand bucket)
 *   Step 7  — Compute Eligible Supply (from Supply bucket)
 *   Step 8  — Derive TTR from Inbound Delivery
 *   Step 9  — Compute TTS, Gap, Shortfall (per Plant x Material)
 *   Step 10 — Aggregate KPIs
 */

'use strict';

const { createLogger, getCurrentTimestamp, roundTo } = require('../lib/utils');

const logger = createLogger('SurvivalPlanner');

const HORIZON_WEEKS = 12;
const HORIZON_DAYS  = HORIZON_WEEKS * 7;
const CRITICAL_TTS_THRESHOLD_WEEKS = 2;
const AGENT_ID = 'SVP';

// ═══════════════════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function parseODataDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === 'string') {
        const m = v.match(/\/Date\((-?\d+)\)\//);
        if (m) { const d = new Date(parseInt(m[1], 10)); return isNaN(d.getTime()) ? null : d; }
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

function daysBetween(d1, d2) {
    if (!d1 || !d2) return 0;
    return Math.round((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

const DESTINATION = { destinationName: 'S4R' };
const GET_OPTS    = { method: 'GET' };

function unwrapResults(resp) {
    const d = resp && resp.data ? resp.data : {};
    if (d.d && Array.isArray(d.d.results)) return d.d.results;
    if (Array.isArray(d.value)) return d.value;
    if (d.d && !Array.isArray(d.d.results)) return [d.d];
    return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Fetch Open POs for Affected Supplier
// ─────────────────────────────────────────────────────────────────────────────

async function fetchOpenPOs(supplier, horizonEnd, httpClient) {
    logger.info('[Step3] Fetching open POs for supplier ' + supplier);
    const url = '/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder' +
        '?$filter=' + encodeURIComponent("Supplier eq '" + supplier + "'") +
        '&$expand=to_PurchaseOrderItem/to_ScheduleLine&$format=json';

    let poResp;
    try { poResp = await httpClient(DESTINATION, { ...GET_OPTS, url }); }
    catch (err) { logger.error('[Step3] PO fetch failed for ' + supplier + ': ' + err.message); return []; }

    const rawPOs = unwrapResults(poResp);
    logger.info('[Step3] Received ' + rawPOs.length + ' POs for supplier ' + supplier);
    const schedLines = [];

    for (const po of rawPOs) {
        if ((po.PurchaseOrderType || '') !== 'NB') continue;
        if ((po.PurchasingProcessingStatus || '') !== '02') continue;
        const poNumber = po.PurchaseOrder || '';
        const items = (po.to_PurchaseOrderItem && po.to_PurchaseOrderItem.results)
            ? po.to_PurchaseOrderItem.results
            : (Array.isArray(po.to_PurchaseOrderItem) ? po.to_PurchaseOrderItem : []);

        for (const item of items) {
            const material = item.Material || '';
            const plant    = item.Plant || '';
            const uom      = item.PurchaseOrderQuantityUnit || item.OrderQuantityUnit || 'EA';
            const itemNo   = item.PurchaseOrderItem || '';
            const sls = (item.to_ScheduleLine && item.to_ScheduleLine.results)
                ? item.to_ScheduleLine.results
                : (Array.isArray(item.to_ScheduleLine) ? item.to_ScheduleLine : []);

            for (const sl of sls) {
                const delDate = parseODataDate(sl.ScheduleLineDeliveryDate);
                if (!delDate || delDate > horizonEnd) continue;
                const qty = parseFloat(sl.ScheduleLineOrderQuantity) || parseFloat(sl.OrderQuantity) || 0;
                schedLines.push({
                    po: poNumber, item: itemNo, schedLine: sl.ScheduleLine || '',
                    material, plant, orderQty: qty, uom, deliveryDate: delDate,
                    dedupKey: poNumber + '_' + itemNo + '_' + (sl.ScheduleLine || '')
                });
            }
        }
    }
    logger.info('[Step3] Extracted ' + schedLines.length + ' schedule lines within horizon');
    return schedLines;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Fetch Inbound Deliveries for Affected Supplier
// ─────────────────────────────────────────────────────────────────────────────

async function fetchInboundDeliveries(poNumbers, horizonEnd, httpClient) {
    logger.info('[Step4] Fetching inbound deliveries for ' + poNumbers.length + ' PO(s)');
    if (!poNumbers.length) return [];

    const allItems = [];
    for (const poNum of poNumbers) {
        const url = '/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV/A_InbDeliveryItem' +
            '?$filter=' + encodeURIComponent("ReferenceSDDocument eq '" + poNum + "'") + '&$format=json';
        try {
            const resp = await httpClient(DESTINATION, { ...GET_OPTS, url });
            const items = unwrapResults(resp);
            for (const it of items) {
                allItems.push({
                    deliveryDocument: it.DeliveryDocument || '',
                    deliveryItem: it.DeliveryDocumentItem || '',
                    referencePO: it.ReferenceSDDocument || poNum,
                    referencePOItem: it.ReferenceSDDocumentItem || '',
                    qty: parseFloat(it.ActualDeliveryQuantity) || 0,
                    goodsMovementStatus: it.GoodsMovementStatus || '',
                    material: it.Material || '', plant: it.Plant || ''
                });
            }
        } catch (err) { logger.warn('[Step4] Inbound items fetch failed for PO ' + poNum + ': ' + err.message); }
    }
    logger.info('[Step4] Fetched ' + allItems.length + ' inbound delivery items');

    // Filter: status A or B = In-Transit / Confirmed (C = GR posted, excluded)
    const eligibleItems = allItems.filter(function (it) {
        var st = (it.goodsMovementStatus || '').toUpperCase();
        return st === 'A' || st === 'B' || st === '';
    });

    // Fetch delivery headers for expected arrival date
    var uniqueDocs = [];
    var docSet = {};
    eligibleItems.forEach(function (it) {
        if (it.deliveryDocument && !docSet[it.deliveryDocument]) {
            docSet[it.deliveryDocument] = true;
            uniqueDocs.push(it.deliveryDocument);
        }
    });
    var headerMap = {};

    for (const doc of uniqueDocs) {
        const hUrl = '/sap/opu/odata/sap/API_INBOUND_DELIVERY_SRV/A_InbDeliveryHeader' +
            '?$filter=' + encodeURIComponent("DeliveryDocument eq '" + doc + "'") + '&$format=json';
        try {
            const hResp = await httpClient(DESTINATION, { ...GET_OPTS, url: hUrl });
            const hdr = unwrapResults(hResp)[0];
            if (hdr) { headerMap[doc] = { deliveryDate: parseODataDate(hdr.DeliveryDate) }; }
        } catch (err) { logger.warn('[Step4] Header fetch failed for delivery ' + doc + ': ' + err.message); }
    }

    const deliveries = [];
    for (const it of eligibleItems) {
        const hdr = headerMap[it.deliveryDocument] || {};
        const expectedArrival = hdr.deliveryDate || null;
        if (expectedArrival && expectedArrival > horizonEnd) continue;
        var confidence = 'LOW';
        if (it.goodsMovementStatus === 'B') confidence = 'HIGH';
        else if (it.deliveryDocument) confidence = 'MEDIUM';
        deliveries.push({
            ...it, expectedArrival, ttrConfidence: confidence,
            dedupKey: it.referencePO + '_' + it.referencePOItem + '_'
        });
    }
    logger.info('[Step4] ' + deliveries.length + ' eligible inbound deliveries within horizon');
    return deliveries;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — Anti-Double-Count Reconciliation
// ─────────────────────────────────────────────────────────────────────────────

function reconcile(poSchedLines, inboundDeliveries) {
    logger.info('[Step5] Reconciling ' + poSchedLines.length + ' PO lines vs ' + inboundDeliveries.length + ' deliveries');
    var inboundByPOItem = {};
    inboundDeliveries.forEach(function (del) {
        var key = del.referencePO + '_' + del.referencePOItem;
        if (!inboundByPOItem[key]) inboundByPOItem[key] = [];
        inboundByPOItem[key].push(del);
    });

    var supplyBucket = [], demandBucket = [], matchedKeys = {};

    poSchedLines.forEach(function (sl) {
        var key = sl.po + '_' + sl.item;
        var matched = inboundByPOItem[key];
        if (matched && matched.length > 0) {
            matched.forEach(function (del) {
                var dk = del.deliveryDocument + '_' + del.deliveryItem;
                if (matchedKeys[dk]) return;
                matchedKeys[dk] = true;
                supplyBucket.push({
                    po: sl.po, item: sl.item,
                    material: del.material || sl.material,
                    plant: del.plant || sl.plant,
                    qty: del.qty, uom: sl.uom,
                    expectedDate: del.expectedArrival || sl.deliveryDate,
                    source: 'INBOUND_DELIVERY',
                    ttrConfidence: del.ttrConfidence || 'MEDIUM',
                    goodsMovementStatus: del.goodsMovementStatus
                });
            });
        } else {
            demandBucket.push({
                po: sl.po, item: sl.item, material: sl.material, plant: sl.plant,
                qty: sl.orderQty, uom: sl.uom, expectedDate: sl.deliveryDate,
                source: 'PO_SCHEDULE_LINE'
            });
        }
    });

    // Unmatched inbound deliveries go to supply
    inboundDeliveries.forEach(function (del) {
        var dk = del.deliveryDocument + '_' + del.deliveryItem;
        if (!matchedKeys[dk]) {
            supplyBucket.push({
                po: del.referencePO, item: del.referencePOItem,
                material: del.material, plant: del.plant,
                qty: del.qty, uom: 'EA',
                expectedDate: del.expectedArrival,
                source: 'INBOUND_DELIVERY',
                ttrConfidence: del.ttrConfidence || 'MEDIUM',
                goodsMovementStatus: del.goodsMovementStatus
            });
        }
    });

    logger.info('[Step5] Supply: ' + supplyBucket.length + ', Demand: ' + demandBucket.length);
    return { supplyBucket: supplyBucket, demandBucket: demandBucket };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 — Compute Weekly Demand (from Demand bucket)
// ─────────────────────────────────────────────────────────────────────────────

async function computeWeeklyDemand(demandBucket, poNumbers, httpClient) {
    logger.info('[Step6] Computing weekly demand from ' + demandBucket.length + ' demand records');

    var poItemMap = {};
    for (const poNum of poNumbers) {
        var url = '/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrderItem' +
            '?$filter=' + encodeURIComponent("PurchaseOrder eq '" + poNum + "'") + '&$format=json';
        try {
            var resp = await httpClient(DESTINATION, { ...GET_OPTS, url: url });
            var items = unwrapResults(resp);
            items.forEach(function (it) {
                var key = poNum + '_' + (it.PurchaseOrderItem || '');
                poItemMap[key] = {
                    isComplete: it.IsCompletelyDelivered === true || it.IsCompletelyDelivered === 'true' || String(it.IsCompletelyDelivered).toLowerCase() === 'x',
                    orderQty: parseFloat(it.OrderQuantity) || 0,
                    uom: it.PurchaseOrderQuantityUnit || it.OrderQuantityUnit || 'EA'
                };
            });
        } catch (err) { logger.warn('[Step6] PO items fetch failed for ' + poNum + ': ' + err.message); }
    }

    var demandMap = new Map();
    demandBucket.forEach(function (rec) {
        var poItemKey = rec.po + '_' + rec.item;
        var poItem = poItemMap[poItemKey];
        if (poItem && poItem.isComplete) return;
        var qty = (poItem && poItem.orderQty > 0) ? poItem.orderQty : rec.qty;
        var uom = (poItem && poItem.uom) ? poItem.uom : rec.uom;
        var key = rec.plant + '_' + rec.material;
        if (!demandMap.has(key)) demandMap.set(key, { totalQty: 0, uom: uom, plant: rec.plant, material: rec.material });
        demandMap.get(key).totalQty += qty;
    });

    var result = new Map();
    demandMap.forEach(function (entry, key) {
        var dailyDemand = entry.totalQty / 7;
        result.set(key, {
            weeklyDemand: roundTo(dailyDemand * 7, 2),
            dailyDemand: roundTo(dailyDemand, 2),
            totalUnshippedQty: roundTo(entry.totalQty, 2),
            uom: entry.uom, plant: entry.plant, material: entry.material
        });
    });
    logger.info('[Step6] Demand for ' + result.size + ' plant x material combinations');
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7 — Compute Eligible Supply (from Supply bucket)
// ─────────────────────────────────────────────────────────────────────────────

function computeEligibleSupply(supplyBucket) {
    logger.info('[Step7] Computing eligible supply from ' + supplyBucket.length + ' supply records');
    var supplyMap = new Map();
    supplyBucket.forEach(function (rec) {
        var key = rec.plant + '_' + rec.material;
        if (!supplyMap.has(key)) supplyMap.set(key, { eligibleSupply: 0, uom: rec.uom, entries: [], plant: rec.plant, material: rec.material });
        var entry = supplyMap.get(key);
        entry.eligibleSupply += rec.qty;
        entry.entries.push(rec);
    });
    logger.info('[Step7] Supply for ' + supplyMap.size + ' plant x material combinations');
    return supplyMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 8 — Derive TTR from Inbound Delivery
// ─────────────────────────────────────────────────────────────────────────────

function deriveTTR(supplyBucket, disruptionDate) {
    logger.info('[Step8] Deriving TTR from ' + supplyBucket.length + ' supply entries');
    var ttrMap = new Map();

    supplyBucket.forEach(function (rec) {
        var key = rec.plant + '_' + rec.material;
        if (!rec.expectedDate) return;
        if (rec.expectedDate <= disruptionDate) return;

        var diffDays = daysBetween(rec.expectedDate, disruptionDate);
        var weeks = roundTo(Math.ceil(diffDays / 7), 2);

        var confidence = 'LOW';
        if (rec.source === 'INBOUND_DELIVERY') {
            confidence = ((rec.goodsMovementStatus || '').toUpperCase() === 'B') ? 'HIGH' : 'MEDIUM';
        }

        if (!ttrMap.has(key) || weeks < ttrMap.get(key).ttrWeeks) {
            ttrMap.set(key, { ttrWeeks: weeks, ttrDate: rec.expectedDate, ttrSource: rec.source, ttrConfidence: confidence });
        }
    });

    logger.info('[Step8] Derived TTR for ' + ttrMap.size + ' plant x material combinations');
    return ttrMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 9 — Compute TTS, Gap, Shortfall (per Plant x Material)
// ─────────────────────────────────────────────────────────────────────────────

function computeRecords(demandMap, supplyMap, ttrMap) {
    logger.info('[Step9] Computing TTS/Gap/Shortfall records');
    var allKeys = new Set();
    demandMap.forEach(function (v, k) { allKeys.add(k); });
    supplyMap.forEach(function (v, k) { allKeys.add(k); });

    var records = [];
    allKeys.forEach(function (key) {
        var demand = demandMap.get(key);
        var supply = supplyMap.get(key);
        var ttr    = ttrMap.get(key);

        var plant    = (demand && demand.plant) || (supply && supply.plant) || key.split('_')[0] || '';
        var material = (demand && demand.material) || (supply && supply.material) || key.split('_')[1] || '';
        var uom      = (demand && demand.uom) || (supply && supply.uom) || 'EA';
        var weeklyDemand   = demand ? demand.weeklyDemand : 0;
        var eligibleSupply = supply ? roundTo(supply.eligibleSupply, 2) : 0;
        var usableInventory = 0;
        var totalSupply = usableInventory + eligibleSupply;

        var dataFlags = [];
        var ttsWeeks = 0;
        if (weeklyDemand <= 0) {
            dataFlags.push('NO_DEMAND');
            ttsWeeks = totalSupply > 0 ? 999 : 0;
        } else {
            ttsWeeks = roundTo(totalSupply / weeklyDemand, 2);
        }
        if (usableInventory === 0) dataFlags.push('NO_INVENTORY_API');

        var ttrWeeks = 0, ttrSource = 'NOT_CALCULATED', ttrConfidence = 'LOW';
        if (ttr) { ttrWeeks = ttr.ttrWeeks; ttrSource = ttr.ttrSource; ttrConfidence = ttr.ttrConfidence; }

        var gapWeeks = 0, shortfallQty = 0;
        if (ttr) {
            gapWeeks = roundTo(Math.max(ttrWeeks - ttsWeeks, 0), 2);
            shortfallQty = roundTo(gapWeeks * weeklyDemand, 2);
        }

        var confidence = ttrConfidence;
        if (dataFlags.indexOf('NO_DEMAND') >= 0) confidence = 'LOW';
        if (supply && supply.entries) {
            var hasStale = supply.entries.some(function (e) {
                return e.expectedDate && daysBetween(new Date(), e.expectedDate) > 30;
            });
            if (hasStale) dataFlags.push('ASN_STALE');
        }

        records.push({
            plant: plant, material: material,
            ttsWeeks: ttsWeeks, ttrWeeks: ttrWeeks,
            ttrSource: ttrSource, ttrConfidence: ttrConfidence,
            gapWeeks: gapWeeks, shortfallQty: shortfallQty,
            shortfallUoM: uom, confidence: confidence,
            dataFlags: dataFlags, weeklyDemand: weeklyDemand,
            eligibleSupply: eligibleSupply,
            usableInventory: usableInventory,
            totalSupply: roundTo(totalSupply, 2)
        });
    });

    logger.info('[Step9] Computed ' + records.length + ' plant x material records');
    return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 10 — Aggregate KPIs
// ─────────────────────────────────────────────────────────────────────────────

function aggregateKPIs(records) {
    logger.info('[Step10] Aggregating KPIs from ' + records.length + ' records');
    var validRecords = records.filter(function (r) { return r.dataFlags.indexOf('NO_DEMAND') < 0; });

    var criticalCount = validRecords.filter(function (r) { return r.ttsWeeks < CRITICAL_TTS_THRESHOLD_WEEKS; }).length;

    var avgCoverage = validRecords.length > 0
        ? roundTo(validRecords.reduce(function (s, r) { return s + r.ttsWeeks; }, 0) / validRecords.length, 2)
        : 0;

    var worstGap = { weeks: 0, plant: '', material: '' };
    validRecords.forEach(function (r) {
        if (r.gapWeeks > worstGap.weeks) worstGap = { weeks: r.gapWeeks, plant: r.plant, material: r.material };
    });

    var shortfallByUoM = {};
    validRecords.forEach(function (r) {
        var u = r.shortfallUoM || 'EA';
        shortfallByUoM[u] = (shortfallByUoM[u] || 0) + r.shortfallQty;
    });
    var totalShortfall = Object.keys(shortfallByUoM).map(function (u) {
        return { uom: u, qty: roundTo(shortfallByUoM[u], 2) };
    });

    var portfolioTTS = validRecords.length > 0
        ? roundTo(Math.min.apply(null, validRecords.map(function (r) { return r.ttsWeeks; })), 2)
        : 0;

    return {
        criticalItems: { count: criticalCount, thresholdWeeks: CRITICAL_TTS_THRESHOLD_WEEKS },
        averageCoverageWeeks: avgCoverage,
        worstGap: worstGap,
        totalShortfall: totalShortfall,
        portfolioHeadlineTTS_Weeks: portfolioTTS
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// NARRATIVES
// ─────────────────────────────────────────────────────────────────────────────

function buildNarratives(records, kpis) {
    var cc = kpis.criticalItems.count;
    var ttsSummary = cc > 0
        ? cc + ' material(s) have coverage below ' + kpis.criticalItems.thresholdWeeks + ' weeks. ' +
          'Portfolio headline TTS is ' + kpis.portfolioHeadlineTTS_Weeks + ' weeks. ' +
          'Average coverage across ' + records.length + ' record(s) is ' + kpis.averageCoverageWeeks + ' weeks.'
        : 'All ' + records.length + ' material(s) have adequate coverage. Average TTS is ' + kpis.averageCoverageWeeks + ' weeks.';

    var wg = kpis.worstGap;
    var ttrAssumption = wg.weeks > 0
        ? 'Worst recovery gap is ' + wg.weeks + ' weeks for ' + wg.material + ' at ' + wg.plant + '. ' +
          'TTR is derived from the earliest confirmed inbound delivery date.'
        : 'No recovery gap detected. All materials have sufficient supply to cover until recovery.';

    var flagged = records.filter(function (r) { return r.dataFlags.length > 0; });
    var allFlags = {};
    flagged.forEach(function (r) { r.dataFlags.forEach(function (f) { allFlags[f] = true; }); });
    var dataGaps = flagged.length > 0
        ? flagged.length + ' record(s) have data quality flags: ' + Object.keys(allFlags).join(', ') +
          '. Inventory API data is not yet integrated (Usable_Inventory defaults to 0).'
        : 'All records have complete data. Note: Usable_Inventory defaults to 0 (inventory API not in scope).';

    return { ttsSummary: ttsSummary, ttrAssumption: ttrAssumption, dataGaps: dataGaps };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════

async function runSurvivalPlanner(params) {
    var caseId         = params.caseId;
    var suppliers      = params.suppliers;
    var purchaseOrders = params.purchaseOrders;
    var disruptionDate = params.disruptionDate;
    var httpClient     = params.httpClient;
    var timestamp      = new Date().toISOString();
    var horizonEnd     = addDays(disruptionDate, HORIZON_DAYS);

    logger.info('Running Survival Planner for case ' + caseId + ', ' + suppliers.length + ' supplier(s)');

    try {
        var allSchedLines = [];
        var allInbound    = [];

        for (var si = 0; si < suppliers.length; si++) {
            var supplierId = suppliers[si].supplierId || '';
            if (!supplierId) continue;

            // Step 3
            var schedLines = await fetchOpenPOs(supplierId, horizonEnd, httpClient);
            allSchedLines = allSchedLines.concat(schedLines);

            // Collect PO numbers for inbound lookup
            var poNumSet = {};
            schedLines.forEach(function (sl) { if (sl.po) poNumSet[sl.po] = true; });
            if (purchaseOrders) {
                purchaseOrders.forEach(function (cpo) {
                    if (cpo.supplierId === supplierId && cpo.poNumber) poNumSet[cpo.poNumber] = true;
                });
            }
            var poNums = Object.keys(poNumSet);

            // Step 4
            var deliveries = await fetchInboundDeliveries(poNums, horizonEnd, httpClient);
            allInbound = allInbound.concat(deliveries);
        }

        // Step 5
        var buckets = reconcile(allSchedLines, allInbound);

        // Step 6
        var uniquePOs = {};
        buckets.demandBucket.forEach(function (d) { if (d.po) uniquePOs[d.po] = true; });
        var demandMap = await computeWeeklyDemand(buckets.demandBucket, Object.keys(uniquePOs), httpClient);

        // Step 7
        var supplyMap = computeEligibleSupply(buckets.supplyBucket);

        // Step 8
        var ttrMap = deriveTTR(buckets.supplyBucket, disruptionDate);

        // Step 9
        var records = computeRecords(demandMap, supplyMap, ttrMap);

        // Step 10
        var kpis = aggregateKPIs(records);

        // Narratives
        var narratives = buildNarratives(records, kpis);

        logger.info('Survival Planner completed: ' + records.length + ' records, headline TTS=' + kpis.portfolioHeadlineTTS_Weeks + ' weeks');

        return {
            success: true,
            incidentId: caseId,
            agentId: AGENT_ID,
            timestamp: timestamp,
            portfolioHeadlineTTS_Weeks: kpis.portfolioHeadlineTTS_Weeks,
            kpis: {
                criticalItems:       kpis.criticalItems,
                averageCoverageWeeks: kpis.averageCoverageWeeks,
                worstGap:            kpis.worstGap,
                totalShortfall:      kpis.totalShortfall
            },
            records: records,
            narratives: narratives,
            dataSource: 'S4R',
            calculatedAt: timestamp,
            error: null
        };

    } catch (error) {
        logger.error('Survival Planner error: ' + error.message);
        return {
            success: false,
            incidentId: caseId,
            agentId: AGENT_ID,
            timestamp: timestamp,
            portfolioHeadlineTTS_Weeks: 0,
            kpis: {
                criticalItems:       { count: 0, thresholdWeeks: CRITICAL_TTS_THRESHOLD_WEEKS },
                averageCoverageWeeks: 0,
                worstGap:            { weeks: 0, plant: '', material: '' },
                totalShortfall:      []
            },
            records: [],
            narratives: { ttsSummary: '', ttrAssumption: '', dataGaps: '' },
            dataSource: 'S4R',
            calculatedAt: timestamp,
            error: error.message
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    runSurvivalPlanner: runSurvivalPlanner,
    fetchOpenPOs: fetchOpenPOs,
    fetchInboundDeliveries: fetchInboundDeliveries,
    reconcile: reconcile,
    computeWeeklyDemand: computeWeeklyDemand,
    computeEligibleSupply: computeEligibleSupply,
    deriveTTR: deriveTTR,
    computeRecords: computeRecords,
    aggregateKPIs: aggregateKPIs,
    buildNarratives: buildNarratives,
    parseODataDate: parseODataDate
};
