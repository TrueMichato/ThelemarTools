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
 * Persisted fields that describe what a character is *doing right now* rather than what
 * it is. They are cleared before derivation so a projection reports the character's
 * baseline.
 *
 * `activeStates` also drives combat-stance bonuses and ability substitutions
 * (`getActiveAbilitySubstitution` reads `getActiveStateEffects()`), so clearing it and
 * `activeStance` removes every transient contribution at once.
 */
const TRANSIENT_FIELDS = Object.freeze({
	activeStates: () => [],
	activeStance: () => null,
});

/** Strip transient combat state, leaving the baseline document. */
function getBaselineDocument (characterData) {
	// A JSON round-trip rather than `structuredClone`: the document is JSON by definition,
	// and cloning across module realms produces arrays that fail `Array.isArray` inside
	// the sheet.
	const document = JSON.parse(JSON.stringify(characterData));
	for (const [field, getEmpty] of Object.entries(TRANSIENT_FIELDS)) {
		if (field in document) document[field] = getEmpty();
	}
	return document;
}

/**
 * Run one synchronous derivation with the console silenced.
 *
 * The sheet is browser code and warns through `console.*` about things like unresolvable
 * named modifiers — quoting the modifier's name and raw value, both of which are private
 * character data that has not passed the projection boundary. On a server those land in
 * operational logs. Derivation is fully synchronous, so nothing can interleave between
 * the swap and the restore.
 */
function withSilencedConsole (fn) {
	const original = globalThis.console;
	const noop = () => {};
	globalThis.console = new Proxy({}, {get: () => noop});
	try {
		return fn();
	} finally {
		globalThis.console = original;
	}
}

/**
 * Load one character document into the authority, at its baseline.
 * @returns {object|null} a loaded state, or `null` when the document cannot be read
 */
function getLoadedState (characterData) {
	if (!characterData || typeof characterData !== "object" || Array.isArray(characterData)) return null;
	try {
		const state = new CharacterSheetState();
		state.loadFromJson(getBaselineDocument(characterData));
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
	return withSilencedConsole(() => getDerivedStatsUnsafe({characterData, abilityKeys, skillKeys}));
}

function getDerivedStatsUnsafe ({characterData, abilityKeys, skillKeys}) {
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
