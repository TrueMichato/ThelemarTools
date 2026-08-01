/**
 * CS-BUG-038 — symbolic named-modifier values must resolve to live NUMBERS.
 *
 * The feature/feat/racial effect registries express some modifier values symbolically
 * rather than numerically, because the number is not knowable when the feature is
 * granted:
 *   - Soul of Artifice (Artificer 20)  `save:all`            = "attunedItems"
 *   - Indomitable Might (Barbarian 18) `ability:str:minimum` = "strScore"
 *   - Durable, Great Weapon Master…    various               = "conModx2", "strMod"
 *
 * Historically ONLY the token "proficiency" was understood. Every other token survived
 * as a raw STRING into `_recalculateCustomModifiers`, whose `+=` then concatenated
 * instead of adding — the sheet rendered a literal `"200strScore00"` for a Barbarian 18+
 * and `"11attunedItems000000"` for all six saves of an Artificer 20.
 *
 * These tests drive the PUBLIC entry point (`addNamedModifier` → `getSaveMod` /
 * `getAbilityScore`) rather than the resolver in isolation, so they exercise the same
 * path the sheet does. Each one carries an explicit PREMISE guard asserting that the
 * symbolic token really is stored on the modifier — without it an `isFinite` assertion
 * would pass vacuously against a fixture that never carried a token at all.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function makeState ({str = 18, con = 14} = {}) {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "PHB"});
	state.addClass({name: "Barbarian", source: "PHB", level: 18});
	state.setAbilityBase("str", str);
	state.setAbilityBase("dex", 12);
	state.setAbilityBase("con", con);
	state.setAbilityBase("int", 10);
	state.setAbilityBase("wis", 10);
	state.setAbilityBase("cha", 8);
	return state;
}

/** Assert the fixture genuinely stores the symbolic token — otherwise the test is vacuous. */
function expectStoredValue (state, modName, expectedRawValue) {
	const stored = (state._data.namedModifiers || []).find(m => m.name === modName);
	expect(stored).toBeDefined();
	expect(stored.value).toBe(expectedRawValue);
	// And prove it WOULD concatenate if it reached arithmetic unresolved.
	expect(typeof stored.value).toBe("string");
	expect(0 + stored.value).toBe(`0${expectedRawValue}`);
}

describe("CS-BUG-038 — symbolic modifier values resolve to numbers", () => {
	describe("Soul of Artifice: save:all = \"attunedItems\"", () => {
		it("keeps every saving throw a finite number instead of a concatenated string", () => {
			const state = makeState();
			state.addNamedModifier({
				name: "Soul of Artifice",
				type: "save:all",
				value: "attunedItems",
				sourceType: "classFeature",
			});
			state._recalculateCustomModifiers();

			expectStoredValue(state, "Soul of Artifice", "attunedItems");

			["str", "dex", "con", "int", "wis", "cha"].forEach(abl => {
				const mod = state.getSaveMod(abl);
				expect(typeof mod).toBe("number");
				expect(Number.isFinite(mod)).toBe(true);
				expect(String(mod)).not.toMatch(/attunedItems/);
			});
		});

		it("tracks the LIVE attunement count rather than a value frozen at grant time", () => {
			const state = makeState();
			state.addNamedModifier({
				name: "Soul of Artifice",
				type: "save:all",
				value: "attunedItems",
				sourceType: "classFeature",
			});
			state._recalculateCustomModifiers();
			const baseline = state.getSaveMod("wis");
			expect(Number.isFinite(baseline)).toBe(true);

			// Resolution must happen at READ time: swapping the attuned-item count changes
			// the bonus without the modifier ever being re-added.
			const realGetAttuned = state.getAttunedItems.bind(state);
			state.getAttunedItems = () => [{name: "A"}, {name: "B"}, {name: "C"}];
			state._recalculateCustomModifiers();
			expect(state.getSaveMod("wis")).toBe(baseline + 3);

			state.getAttunedItems = realGetAttuned;
		});
	});

	describe("Indomitable Might: ability:str:minimum = \"strScore\"", () => {
		it("does not corrupt the Strength score", () => {
			const state = makeState({str: 18});
			const before = state.getAbilityScore("str");
			expect(before).toBe(18);

			state.addNamedModifier({
				name: "Indomitable Might",
				type: "ability:str:minimum",
				value: "strScore",
				sourceType: "classFeature",
			});
			state._recalculateCustomModifiers();

			expectStoredValue(state, "Indomitable Might", "strScore");

			const after = state.getAbilityScore("str");
			expect(typeof after).toBe("number");
			expect(Number.isFinite(after)).toBe(true);
			expect(String(after)).not.toMatch(/strScore/);
			// A *floor on Strength checks* is not a bonus to the score: the score is unchanged.
			expect(after).toBe(18);
		});

		it("keeps derived Strength values (save, skill, modifier) finite", () => {
			const state = makeState({str: 18});
			state.addNamedModifier({
				name: "Indomitable Might",
				type: "ability:str:minimum",
				value: "strScore",
				sourceType: "classFeature",
			});
			state._recalculateCustomModifiers();

			expectStoredValue(state, "Indomitable Might", "strScore");

			expect(Number.isFinite(state.getAbilityMod("str"))).toBe(true);
			expect(Number.isFinite(state.getSaveMod("str"))).toBe(true);
			expect(Number.isFinite(state.getSkillMod("athletics"))).toBe(true);
		});

		it("still applies a BARE ability:str modifier additively (no over-correction)", () => {
			const state = makeState({str: 18});
			state.addNamedModifier({
				name: "Belt of Giant Strength",
				type: "ability:str",
				value: 2,
				sourceType: "item",
			});
			state._recalculateCustomModifiers();
			expect(state.getAbilityScore("str")).toBe(20);
		});
	});

	describe("token vocabulary", () => {
		it("resolves each known token to the correct live number", () => {
			const state = makeState({str: 18, con: 14});
			expect(state._resolveSymbolicModifierValue("strScore")).toBe(18);
			expect(state._resolveSymbolicModifierValue("conModx2")).toBe(state.getAbilityMod("con") * 2);
			expect(state._resolveSymbolicModifierValue("strMod")).toBe(state.getAbilityMod("str"));
			expect(state._resolveSymbolicModifierValue("int")).toBe(state.getAbilityMod("int"));
			expect(state._resolveSymbolicModifierValue("level")).toBe(state.getTotalLevel());
			expect(state._resolveSymbolicModifierValue("attunedItems")).toBe(0);
			expect(state._resolveSymbolicModifierValue(7)).toBe(7);
			expect(state._resolveSymbolicModifierValue("-3")).toBe(-3);
		});

		it("returns null (not 0) for tokens it cannot resolve, so callers can warn", () => {
			const state = makeState();
			// Dice and semantic markers belong to other channels, never to a flat scalar.
			expect(state._resolveSymbolicModifierValue("1d8")).toBeNull();
			expect(state._resolveSymbolicModifierValue("all")).toBeNull();
			expect(state._resolveSymbolicModifierValue("totallyUnknownToken")).toBeNull();
		});

		it("treats an unresolvable token as 0 rather than letting it concatenate", () => {
			const state = makeState();
			const realWarn = console.warn;
			const warnings = [];
			console.warn = (...args) => warnings.push(args.join(" "));
			try {
				state.addNamedModifier({
					name: "Surprise Attack",
					type: "damage:bonus:surprised",
					value: "2d6",
					sourceType: "classFeature",
				});
				state._recalculateCustomModifiers();

				expectStoredValue(state, "Surprise Attack", "2d6");

				const dmg = state._data.customModifiers.damageBonus;
				expect(typeof dmg).toBe("number");
				expect(Number.isFinite(dmg)).toBe(true);
				expect(String(dmg)).not.toMatch(/2d6/);
				expect(warnings.some(w => /Surprise Attack/.test(w) && /unresolvable/.test(w))).toBe(true);
			} finally {
				console.warn = realWarn;
			}
		});
	});

	describe("no regression to the one token that already worked", () => {
		it("still converts \"proficiency\" into a proficiency-bonus flag", () => {
			const state = makeState();
			state.addNamedModifier({
				name: "Alert",
				type: "initiative",
				value: "proficiency",
				sourceType: "feat",
			});
			state._recalculateCustomModifiers();

			const stored = state._data.namedModifiers.find(m => m.name === "Alert");
			expect(stored.proficiencyBonus).toBe(true);
			expect(stored.value).toBe(0);
			expect(state._data.customModifiers.initiative).toBe(state.getProficiencyBonus());
		});
	});
});
