/**
 * Alternate BOM Handler (Slim v2)
 *
 * Given a disrupted SKU/component/plant, returns:
 *   - `affectedBom` — the BOM for the affected SKU with its components
 *   - `alternativeMaterials[]` — OTHER finished-goods materials at the same
 *     plant whose BOM does NOT contain the affected component, each with
 *     its full component list.
 *
 * The Python/LLM caller uses this simple payload to decide substitutions.
 *
 * Strategy (two S/4 calls):
 *   1. Fetch ALL BOM headers for the plant from `A_BillOfMaterial`.
 *   2. Fetch ALL items for those BOMs in ONE call to `A_BillOfMaterialItem`
 *      filtered by `BillOfMaterialHeaderUUID in (...)`. The flat item
 *      collection returns rows for every BOM, unlike the per-header
 *      navigation-property endpoint which is empty for many BOMs in this
 *      tenant.
 *   3. Group items in memory by their `BillOfMaterialHeaderUUID`, attach
 *      to their BOM, then split into affectedBom + alternativeMaterials.
 *
 * Notes:
 *   - Some S/4 responses arrive as a raw JSON string; `coerceJsonBody`
 *     handles that transparently.
 *   - `normalizeCode` treats hyphen/underscore/space variants of a code
 *     as equivalent, so `RM_AL-CAN` ≡ `RM_AL_CAN` and
 *     `FG_COKE_500ML-CAN` ≡ `FG_COKE_500ML_CAN`.
 *   - If the OData `$filter` gets too long (>2000 UUIDs, unlikely), we
 *     batch the item call into groups of 40 UUIDs.
 */

'use strict';

const S4R = { destinationName: 'S4R' };
const OPTS = { method: 'GET', headers: { Accept: 'application/json' } };
const BOM_API_BASE = '/sap/opu/odata/sap/API_BILL_OF_MATERIAL_SRV';
const ITEM_BATCH_SIZE = 40; // Max UUIDs per items query — safe for OData URL length

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function coerceJsonBody(data) {
    if (data === null || data === undefined) return null;
    if (typeof data === 'object') return data;
    if (typeof data === 'string') {
        const trimmed = data.trim();
        if (!trimmed) return null;
        try { return JSON.parse(trimmed); } catch { return null; }
    }
    return null;
}

function extractRecords(resp) {
    const data = coerceJsonBody(resp?.data);
    if (!data) return [];
    if (Array.isArray(data?.d?.results)) return data.d.results;
    if (Array.isArray(data?.value)) return data.value;
    if (Array.isArray(data?.d)) return data.d;
    if (data?.d && typeof data.d === 'object' && !data.d.results) return [data.d];
    return [];
}

/**
 * Normalize a material/component code so that hyphen/underscore/space
 * differences don't create false negatives during comparison.
 */
function normalizeCode(s) {
    if (!s || typeof s !== 'string') return '';
    return s.trim().toUpperCase().replace(/[\s_-]+/g, '_');
}

function extractErrorDetail(err) {
    if (!err) return 'Unknown error';
    return (
        err?.rootCause?.message ||
        err?.cause?.message ||
        err?.response?.data?.error?.message?.value ||
        err?.response?.data?.error?.message ||
        (typeof err?.response?.data === 'string' ? err.response.data.substring(0, 200) : null) ||
        err?.message ||
        String(err)
    );
}

function mapItem(rawItem) {
    return {
        component:
            rawItem?.BillOfMaterialComponent ||
            rawItem?.Component ||
            null,
        description:
            rawItem?.ComponentDescription ||
            rawItem?.BillOfMaterialItemText ||
            rawItem?.MaterialDescription ||
            ''
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// S/4 calls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all BOM headers at a plant.
 */
async function fetchBomHeadersAtPlant(plant, executeHttpRequest, logger) {
    const filter = encodeURIComponent(`Plant eq '${plant}'`);
    const url = `${BOM_API_BASE}/A_BillOfMaterial?$filter=${filter}&$format=json`;
    logger.info(`[alt-bom] Fetching BOM headers: ${url}`);
    const resp = await executeHttpRequest(S4R, { ...OPTS, url });
    const rows = extractRecords(resp);
    logger.info(`[alt-bom] Received ${rows.length} BOM headers for plant ${plant}`);
    return rows;
}

/**
 * Fetch ALL items for the given BOM UUIDs in ONE call (or batched calls
 * if the UUID list is very large).
 *
 * Uses the flat `A_BillOfMaterialItem` collection with a filter on
 * `BillOfMaterialHeaderUUID`. This is far more reliable than the
 * per-header `/to_BillOfMaterialItem` navigation property, which returns
 * empty for many BOMs in this tenant.
 *
 * Returns a Map<uuid, mappedComponent[]>.
 */
async function fetchItemsForBoms(uuids, executeHttpRequest, logger) {
    const itemsByUuid = new Map();
    if (!uuids || uuids.length === 0) return itemsByUuid;

    // Deduplicate UUIDs
    const uniqueUuids = Array.from(new Set(uuids.filter(Boolean)));

    // Batch to keep URL length safe
    const batches = [];
    for (let i = 0; i < uniqueUuids.length; i += ITEM_BATCH_SIZE) {
        batches.push(uniqueUuids.slice(i, i + ITEM_BATCH_SIZE));
    }
    logger.info(`[alt-bom] Fetching items for ${uniqueUuids.length} BOM(s) in ${batches.length} batch(es)`);

    for (const batch of batches) {
        const filterExpr = batch
            .map(u => `BillOfMaterialHeaderUUID eq guid'${u}'`)
            .join(' or ');
        const url =
            `${BOM_API_BASE}/A_BillOfMaterialItem` +
            `?$filter=${encodeURIComponent(filterExpr)}` +
            `&$format=json`;

        try {
            const resp = await executeHttpRequest(S4R, { ...OPTS, url });
            const rows = extractRecords(resp);
            logger.info(`[alt-bom] Batch of ${batch.length} UUID(s) returned ${rows.length} item(s)`);
            for (const raw of rows) {
                const uuid = raw.BillOfMaterialHeaderUUID;
                if (!uuid) continue;
                if (!itemsByUuid.has(uuid)) itemsByUuid.set(uuid, []);
                itemsByUuid.get(uuid).push(mapItem(raw));
            }
        } catch (err) {
            logger.warn(`[alt-bom] Batch item fetch failed: ${extractErrorDetail(err)}`);
        }
    }

    return itemsByUuid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envelope helper
// ─────────────────────────────────────────────────────────────────────────────

function buildEnvelope({ affectedSku, affectedComponent, plant, affectedBom, alternativeMaterials, error }) {
    return {
        success: !error,
        affectedSku: affectedSku || null,
        affectedComponent: affectedComponent || null,
        plant: plant || null,
        affectedBom: affectedBom || null,
        alternativeMaterials: alternativeMaterials || [],
        error: error || null
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleGetAlternateBom(executeHttpRequest, getCurrentTimestamp, logger, req) {
    void getCurrentTimestamp; // kept for handler-signature compatibility

    // Trim inputs
    const rawSku = req.data?.affectedSku;
    const rawComp = req.data?.affectedComponent;
    const rawPlant = req.data?.plant;

    const affectedSku = typeof rawSku === 'string' ? rawSku.trim() : rawSku;
    const affectedComponent = typeof rawComp === 'string' ? rawComp.trim() : rawComp;
    const plant = typeof rawPlant === 'string' ? rawPlant.trim() : rawPlant;

    logger.info(`[alt-bom] request: sku="${affectedSku}", component="${affectedComponent}", plant="${plant || ''}"`);

    if (!affectedSku || !affectedComponent || !plant) {
        return buildEnvelope({
            affectedSku, affectedComponent, plant,
            error: 'affectedSku, affectedComponent and plant are all required'
        });
    }
    if (!executeHttpRequest) {
        return buildEnvelope({
            affectedSku, affectedComponent, plant,
            error: '@sap-cloud-sdk/http-client is not available on the server'
        });
    }

    try {
        // Step 1: fetch BOM headers at the plant
        const headers = await fetchBomHeadersAtPlant(plant, executeHttpRequest, logger);

        if (!headers.length) {
            return buildEnvelope({
                affectedSku, affectedComponent, plant,
                error: `No BOMs found at plant '${plant}'`
            });
        }

        // Step 2: single call (or batches) to A_BillOfMaterialItem for ALL BOMs
        const uuids = headers.map(h => h.BillOfMaterialHeaderUUID);
        const itemsByUuid = await fetchItemsForBoms(uuids, executeHttpRequest, logger);

        // Step 3: attach items to each BOM
        const bomsWithItems = headers.map(h => ({
            billOfMaterial: h.BillOfMaterial || null,
            material: (h.Material || '').trim(),
            plant: h.Plant || null,
            components: itemsByUuid.get(h.BillOfMaterialHeaderUUID) || []
        }));

        // Precompute normalized keys
        const affectedSkuNorm = normalizeCode(affectedSku);
        const affectedComponentNorm = normalizeCode(affectedComponent);

        // Step 4: identify affected BOM (Material ≡ affectedSku, normalized)
        const affectedBomEntry = bomsWithItems.find(
            b => normalizeCode(b.material) === affectedSkuNorm
        );
        const affectedBom = affectedBomEntry ? {
            billOfMaterial: affectedBomEntry.billOfMaterial,
            material: affectedBomEntry.material,
            components: affectedBomEntry.components
        } : null;

        // Step 5: alternative materials = other BOMs at this plant whose
        // components do NOT contain the affected component (normalized).
        const alternativeMaterials = bomsWithItems
            .filter(b => b.material && normalizeCode(b.material) !== affectedSkuNorm)
            .filter(b => !b.components.some(
                c => normalizeCode(c.component) === affectedComponentNorm
            ))
            .map(b => ({
                material: b.material,
                billOfMaterial: b.billOfMaterial,
                plant: b.plant,
                components: b.components
            }));

        logger.info(
            `[alt-bom] affectedBom found=${!!affectedBom}, ` +
            `alternativeMaterials=${alternativeMaterials.length}`
        );

        return buildEnvelope({
            affectedSku, affectedComponent, plant,
            affectedBom,
            alternativeMaterials
        });

    } catch (err) {
        const detail = extractErrorDetail(err);
        logger.error(`[alt-bom] error: ${detail}`);
        return buildEnvelope({
            affectedSku, affectedComponent, plant,
            error: detail
        });
    }
}

module.exports = handleGetAlternateBom;