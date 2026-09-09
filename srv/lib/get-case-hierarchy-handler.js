/**
 * get-case-hierarchy-handler.js
 *
 * Handler for the `getCaseHierarchy` CAP function.
 * Returns a single case with all CaseSupplier, CasePurchaseOrder
 * and CaseMaterial children — filtered by caseId.
 */
'use strict';
const cds = require('@sap/cds');

module.exports = function buildHandler(logger) {
    return async function getCaseHierarchy(req) {
        logger.info('getCaseHierarchy function called');
        const { caseId } = req.data || {};
        const E = { success: false, error: null, caseData: null, suppliers: [], purchaseOrders: [], materials: [] };
        if (!caseId) return { ...E, error: 'caseId is required' };

        try {
            const { Case: Cases, CaseSupplier: CS, CasePurchaseOrder: CPO, CaseMaterial: CM } = cds.entities('supplierresilience');
            const row = await SELECT.one.from(Cases).where({ caseId });
            if (!row) return { ...E, error: 'Case not found: ' + caseId };

            const suppliers = await SELECT.from(CS).where({ caseId });
            const pos       = await SELECT.from(CPO).where({ caseId });
            const mats      = await SELECT.from(CM).where({ caseId });

            return {
                success: true, error: null,
                caseData: {
                    caseId: row.caseId, eventTitle: row.eventTitle || '',
                    eventDescription: row.eventDescription || '',
                    severity: row.severity || row.priority || '',
                    classification: row.classification || '',
                    riskScore: row.riskScore || 0,
                    impactType: row.impactType || '',
                    estimatedImpact: row.estimatedImpact || '',
                    region: row.region || '', status: row.status || '',
                    priority: row.priority || '',
                    supplierCount: row.supplierCount || suppliers.length,
                    poCount: row.poCount || pos.length,
                    materialCount: row.materialCount || mats.length,
                    plantCount: row.plantCount || 0,
                    skuCount: row.skuCount || 0,
                    createdAt: row.createdAt || '',
                    createdBy: row.createdBy || ''
                },
                suppliers: suppliers.map(s => ({ supplierId: s.supplierId, name: s.name, address: s.address, distanceKm: s.distanceKm, poCount: s.poCount })),
                purchaseOrders: pos.map(p => ({ supplierId: p.supplierId, poNumber: p.poNumber })),
                materials: mats.map(m => ({ supplierId: m.supplierId, poNumber: m.poNumber, itemNo: m.itemNo, material: m.material, materialDescription: m.materialDescription || '', plant: m.plant, sku: m.sku }))
            };
        } catch (err) {
            logger.error('getCaseHierarchy error: ' + (err.message || err));
            return { ...E, error: 'Database error: ' + (err.message || String(err)) };
        }
    };
};
