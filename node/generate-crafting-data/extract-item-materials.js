/**
 * Lifts the Thelemar homebrew's `itemMaterial` entities into the crafting dataset.
 *
 * Unlike every other extractor here, this one has no prose to parse — item materials are
 * already authored as structured entities in `homebrew/TravelersGuidetoThelemar.json`
 * (the character sheet reads the very same array through the brew merge). The extractor
 * exists so the crafting page gets them via the generated `data/crafting.json` without
 * anyone hand-editing that file, and so the authored source stays single.
 *
 * Nothing is reshaped: the entities are passed through as-is apart from an
 * `_isSrdMaterial`-style provenance stamp being deliberately omitted. If a material needs
 * a different shape on the crafting page, change the authored entity, not this file.
 */

/**
 * @param {object|null} thelemarBook The parsed TGTT brew file.
 * @param {object} ctx
 * @param {object} ctx.report Run report, for surfacing skipped entries.
 * @returns {Array<object>} `itemMaterial` entities.
 */
export function extractItemMaterials (thelemarBook, {report} = /** @type {*} */ ({})) {
	const raw = thelemarBook?.itemMaterial;
	if (!raw?.length) {
		report?.skippedRows?.push("itemMaterial: TGTT brew file has no `itemMaterial` array");
		return [];
	}

	const out = [];
	for (const mat of raw) {
		if (!mat?.name || !mat?.source) {
			report?.skippedRows?.push(`itemMaterial: skipped an entry missing name/source`);
			continue;
		}
		out.push({...mat});
	}
	return out;
}

/**
 * Lifts the Thelemar homebrew's `draconicResonance` entities across.
 *
 * These are reference data rather than a browsable entity: the crafting page renders them
 * inside the stat block of any material that grants a resonance slot, so a reader looking at
 * Dragon Bone can see what a resonance actually does without leaving the page.
 *
 * @param {object|null} thelemarBook The parsed TGTT brew file.
 * @returns {Array<object>} `draconicResonance` entities.
 */
export function extractDraconicResonances (thelemarBook) {
	const raw = thelemarBook?.draconicResonance;
	if (!raw?.length) return [];
	return raw.filter(r => r?.name && r?.source).map(r => ({...r}));
}
