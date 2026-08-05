// One-off utility: prepend an "ID" column (deterministic UUID v5) as the first
// column of each CSV that seeds a cuid entity. Idempotent: skips files that
// already start with an "ID" header.
//
// Usage:  node scripts/add-ids-to-csv.js
//
// Deterministic UUIDs are generated from a stable per-row business key so
// re-runs (and subsequent HDI deployments) produce the same primary keys.

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

// A fixed namespace UUID (any valid v4 UUID works; keep this stable forever).
const NAMESPACE = '9f8d5b3c-6a2f-4b0d-9e1a-1c2b3d4e5f60';

function uuidv5(name, namespace) {
    const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
    const nameBytes = Buffer.from(name, 'utf8');
    const hash = crypto.createHash('sha1').update(Buffer.concat([nsBytes, nameBytes])).digest();
    const bytes = Buffer.from(hash.slice(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
    const hex = bytes.toString('hex');
    return `${hex.substr(0,8)}-${hex.substr(8,4)}-${hex.substr(12,4)}-${hex.substr(16,4)}-${hex.substr(20,12)}`;
}

// Which CSVs to fix, and which column(s) form the deterministic key.
const targets = [
    { file: 'db/data/supplierresilience-Supplier.csv',        keyCols: ['supplierId'] },
    { file: 'db/data/supplierresilience-Material.csv',        keyCols: ['materialId'] },
    { file: 'db/data/supplierresilience-Inventory.csv',       keyCols: ['materialId', 'plant'] },
    { file: 'db/data/supplierresilience-Demand.csv',          keyCols: ['materialId', 'plant'] },
    { file: 'db/data/supplierresilience-PurchaseOrder.csv',   keyCols: ['poNumber'] },
    { file: 'db/data/supplierresilience-DisruptionEvent.csv', keyCols: ['eventId'] },
    { file: 'db/data/supplierresilience-Case.csv',            keyCols: ['caseId'] },
];

const DELIM = ';';

function splitCsvLine(line) {
    // Handles quoted fields containing the delimiter.
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (ch === DELIM && !inQuotes) {
            result.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    result.push(cur);
    return result;
}

for (const t of targets) {
    const abs = path.resolve(t.file);
    if (!fs.existsSync(abs)) { console.warn(`SKIP (not found): ${t.file}`); continue; }

    const raw = fs.readFileSync(abs, 'utf8');
    // Preserve original newline style; work on lines but keep trailing newline info.
    const hadTrailingNewline = /\r?\n$/.test(raw);
    const lines = raw.split(/\r?\n/);
    // Drop trailing empty line for processing, we'll add it back.
    while (lines.length && lines[lines.length - 1] === '') lines.pop();

    if (lines.length === 0) { console.warn(`SKIP (empty): ${t.file}`); continue; }

    const header = splitCsvLine(lines[0]);
    if (header[0] === 'ID') {
        console.log(`OK   (already has ID): ${t.file}`);
        continue;
    }

    const keyIndexes = t.keyCols.map(c => {
        const idx = header.indexOf(c);
        if (idx < 0) throw new Error(`Key column '${c}' not found in header of ${t.file}`);
        return idx;
    });

    const newHeader = ['ID', ...header].join(DELIM);
    const newLines = [newHeader];
    const seen = new Set();

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') continue;
        const cols = splitCsvLine(line);
        const keyName = keyIndexes.map(k => cols[k]).join('||');
        const id = uuidv5(`${path.basename(t.file)}::${keyName}`, NAMESPACE);
        if (seen.has(id)) {
            console.warn(`WARN duplicate business key in ${t.file}: ${keyName}`);
        }
        seen.add(id);
        newLines.push([id, ...cols].join(DELIM));
    }

    let out = newLines.join('\n');
    if (hadTrailingNewline) out += '\n';
    fs.writeFileSync(abs, out, 'utf8');
    console.log(`DONE (added ID to ${lines.length - 1} rows): ${t.file}`);
}