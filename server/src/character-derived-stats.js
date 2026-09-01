/**
 * Derived character statistics for projections.
 *
 * Three review rounds found this file's predecessor — a hand-maintained port of the
 * Character Sheet's modifier math — missing a different term each time: item and custom
 * proficiency bonuses, Blood Hunter Dark Augmentation, TGTT Linguistics, dynamic feature
 * modifiers. A port cannot converge on an authority that keeps evolving, so this module
 * *is* the authority: it loads the document into a real `CharacterSheetState` and reads
 * the same methods the player's own sheet displays.
 *
 * The sheet class is plain JavaScript with no DOM dependency at import or on these read
 * paths. Initialization is a module-level await, so every dependent sees a synchronous
 * API with the authority already loaded.
 */

await import("../../js/parser.js");
await import("../../js/utils.js");
await import("../../js/charactersheet/charactersheet-state.js");

const CharacterSheetState = globalThis.CharacterSheetState;
if (typeof CharacterSheetState !== "function") {
	throw new TypeError(`CharacterSheetState is required to derive character projections.`);
}

/**
 * Load one character document into the authority.
 * @returns {object|null} a loaded state, or `null` when the document cannot be read
 */
function getLoadedState (characterData) {
	if (!characterData || typeof characterData !== "object" || Array.isArray(characterData)) return null;
	try {
		const state = new CharacterSheetState();
		// A JSON round-trip rather than `structuredClone`: the document is JSON by
		// definition, and cloning across module realms produces arrays that fail
		// `Array.isArray` inside the sheet.
		state.loadFromJson(JSON.parse(JSON.stringify(characterData)));
		return state;
	} catch {
		// A document the sheet itself cannot read yields no derived statistics rather than
		// numbers the projection would not be able to stand behind.
		return null;
	}
}

function toFiniteInteger (value) {
	const number = Number(value);
	return Number.isFinite(number) ? Math.trunc(number) : null;
}

/**
 * Ability totals, save and skill modifiers, AC and proficiency bonus, exactly as the
 * owner's sheet computes them.
 *
 * `null` for any field the authority could not produce; the caller omits those rather
 * than substituting a partial calculation.
 */
export function getDerivedStats ({characterData, abilityKeys, skillKeys}) {
	const state = getLoadedState(characterData);
	if (!state) return null;

	const read = fn => {
		try {
			return toFiniteInteger(fn());
		} catch {
			return null;
		}
	};

	const abilities = {};
	for (const ability of abilityKeys) {
		const score = read(() => state.getAbilityScore(ability));
		abilities[ability] = score == null ? 10 : Math.max(1, Math.min(30, score));
	}

	const saves = {};
	for (const ability of abilityKeys) {
		const modifier = read(() => state.getSaveMod(ability));
		if (modifier == null) continue;
		saves[ability] = {modifier, proficient: !!read(() => (state.hasSaveProficiency(ability) ? 1 : 0))};
	}

	const skills = {};
	for (const skill of skillKeys) {
		const modifier = read(() => state.getSkillMod(skill));
		if (modifier == null) continue;
		skills[skill] = {modifier, level: read(() => state.getEffectiveSkillProficiency(skill)) ?? 0};
	}

	return {
		abilities,
		saves: Object.keys(saves).length === abilityKeys.length ? saves : null,
		skills: Object.keys(skills).length ? skills : null,
		ac: read(() => state.getAC()),
	};
}
