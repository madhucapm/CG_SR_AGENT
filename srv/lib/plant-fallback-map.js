/**
 * Plant Fallback Map
 *
 * Hard-coded mapping of affected plants to their fallback plant(s)
 * for the getAlternatePlantSource function (SCN agent data-fetch tool).
 *
 * MVP scope: DE01 → DE02 only.
 * Future: load from a HANA table or S/4HANA config.
 */

'use strict';

module.exports = Object.freeze({ DE01: ['DE02'] });
