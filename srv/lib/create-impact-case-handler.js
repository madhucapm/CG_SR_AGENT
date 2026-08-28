/**
 * create-impact-case-handler.js
 *
 * Handler for the `createImpactCase` CAP action.
 * Creates a Case + CaseSupplier + CasePurchaseOrder + CaseMaterial
 * rows in a single CAP-managed transaction.
 */
'use strict';
const cds = require('@sap/cds');
const { generateImpactCaseId, generateUUID } = require('./utils');

const EMPTY = {
    success: false, caseId: null, message: null, error: null,
    caseData: null, suppliers: [], purchaseOrders: [], materials: []
};

module.exports = function buildHandler(logger) {
    return async function createImpactCase(req) {
        logger.info('createImpactCase action called');
        const d = req.data || {};
        if (!d.affectedSuppliers)
            return { ...EMPTY, error: 'affectedSuppliers payload is required' };

        let aff;
        try { aff = typeof d.affectedSuppliers === 'string' ? JSON.parse(d.affectedSuppliers) : d.affectedSuppliers; }
        catch (e) { return { ...EMPTY, error: 'Failed to parse affectedSuppliers: ' + e.message }; }
        if (!Array.isArray(aff) || !aff.length)
            return { ...EMPTY, error: 'affectedSuppliers must be a non-empty array' };

        const { Case: Cases, CaseSupplier: CS, CasePurchaseOrder: CPO, CaseMaterial: CM } = cds.entities('supplierresilience');
        let caseId;
        for (let i = 0; i < 5; i++) {
            caseId = generateImpactCaseId();
            if (!(await SELECT.one.from(Cases).where({ caseId }))) break;
            if (i === 4) return { ...EMPTY, error: 'Unique case ID generation failed' };
        }

        const now = new Date().toISOString();
        const sR = [], pR = [], mR = [];
        const plantSet = {}, skuSet = {};
        let poTotal = 0;

        aff.forEach(s => {
            const sid = s.supplier_id || s.supplierId || '';
            const pos = Array.isArray(s.purchase_orders) ? s.purchase_orders : [];
            sR.push({ ID: generateUUID(), caseId, supplierId: sid, name: s.name || '',
                address: s.address || '', distanceKm: s.distance_km != null ? s.distance_km : null,
                poCount: s.po_count || pos.length });
            poTotal += pos.length;
            pos.forEach(po => {
                const pn = po.po_number || po.poNumber || '';
                pR.push({ ID: generateUUID(), caseId, supplierId: sid, poNumber: pn });
                (Array.isArray(po.materials) ? po.materials : []).forEach(m => {
                    mR.push({ ID: generateUUID(), caseId, supplierId: sid, poNumber: pn,
                        itemNo: m.item_no || m.itemNo || '', material: m.material || '',
                        plant: m.plant || '', sku: m.sku || '' });
                    if (m.plant) plantSet[m.plant] = true;
                    if (m.sku)   skuSet[m.sku]     = true;
                });
            });
        });

        const c = { supplierCount: sR.length, poCount: poTotal, materialCount: mR.length,
            plantCount: Object.keys(plantSet).length, skuCount: Object.keys(skuSet).length };
        const iScore = d.riskScore || 0;
        const pri = iScore >= 80 ? 'CRITICAL' : iScore >= 60 ? 'HIGH' : iScore >= 40 ? 'MEDIUM' : 'LOW';

        try {
            await INSERT.into(Cases).entries({
                ID: generateUUID(), caseId, eventId: 'IMP-' + caseId,
                status: 'Open', priority: pri, eventType: 'IMPACT_ANALYSIS',
                eventTitle: d.eventTitle || '', eventDescription: d.eventDescription || '',
                severity: d.severity || pri, classification: d.classification || '',
                riskScore: iScore, impactType: d.impactType || '',
                estimatedImpact: d.estimatedImpact || '', region: d.region || '',
                ...c, supplier: sR.length > 0 ? sR[0].name : '',
                createdBy: 'Impact Analysis', eventTime: now, dataSource: 'IMPACT'
            });
            if (sR.length) await INSERT.into(CS).entries(sR);
            if (pR.length) await INSERT.into(CPO).entries(pR);
            if (mR.length) await INSERT.into(CM).entries(mR);

            logger.info(`Impact case ${caseId}: ${c.supplierCount}S ${c.poCount}PO ${c.materialCount}M`);
            return {
                success: true, caseId, message: 'Case ' + caseId + ' created', error: null,
                caseData: { caseId, eventTitle: d.eventTitle || '', severity: d.severity || pri,
                    classification: d.classification || '', riskScore: iScore,
                    impactType: d.impactType || '', estimatedImpact: d.estimatedImpact || '',
                    region: d.region || '', ...c, status: 'Open', createdAt: now },
                suppliers: sR.map(r => ({ supplierId: r.supplierId, name: r.name, address: r.address, distanceKm: r.distanceKm, poCount: r.poCount })),
                purchaseOrders: pR.map(r => ({ supplierId: r.supplierId, poNumber: r.poNumber })),
                materials: mR.map(r => ({ supplierId: r.supplierId, poNumber: r.poNumber, itemNo: r.itemNo, material: r.material, plant: r.plant, sku: r.sku }))
            };
        } catch (err) {
            logger.error('createImpactCase DB error: ' + (err.message || err));
            return { ...EMPTY, error: 'Database error: ' + (err.message || String(err)) };
        }
    };
};

