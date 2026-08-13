/**
 * CS-BUG-136 — `sense:*` named modifiers must be counted exactly ONCE.
 *
 * Two readers consumed a single write. `_recalculateCustomModifiers()` folded every
 * enabled `sense:X` named modifier into `customModifiers.senses[X]`, and `getSense()`
 * then read that fold INSIDE its `Math.max(...)` while ALSO re-deriving the very same
 * modifiers from `namedModifiers` and adding the result on top. Every named sense grant
 * therefore doubled: the Skulker (XPHB) feat rendered blindsight **20 ft** instead of 10,
 * and the Gae Bolg artifact rendered truesight **120 ft** instead of 60.
 *
 * The fold has been deleted; `getSense()` / `_getNamedSenseContribution()` is the sole
 * owner. Deleting the OTHER side would have been strictly worse: `customModifiers.senses`
 * carries only the four canonical keys and the fold was guarded by `!== undefined`, so a
 * homebrew sense name never folded and was already correct — removing the read path would
 * have traded a visible 2x for a silent 0x.
 *
 * EVERY assertion here reads the OBSERVABLE GETTER. The pre-existing Skulker test
 * asserted `senseMod.value === 10` on the modifier OBJECT and passed throughout the life
 * of the bug — it proved the modifier was written and said nothing about what the sheet
 * displayed. That anti-pattern is why a plainly visible 2x survived.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function makeState ({level = 5, con = 14} = {}) {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "PHB"});
	state.addClass({name: "Fighter", source: "PHB", level});
	state.setAbilityBase("str", 14);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", con);
	state.setAbilityBase("int", 10);
	state.setAbilityBase("wis", 10);
	state.setAbilityBase("cha", 10);
	return state;
}

describe("CS-BUG-136 — named sense modifiers are counted once", () => {
	describe("the double-count regression guards", () => {
		test("an additive sense modifier grants exactly its value (was 2x)", () => {
			const state = makeState();
			state.addNamedModifier({name: "Probe", type: "sense:darkvision", value: 60, sourceType: "classFeature"});
			// PREMISE: the modifier really is stored, so the assertion below cannot pass
			// vacuously against a fixture that never carried one.
			expect(state.getNamedModifiers().some(m => m.type === "sense:darkvision")).toBe(true);
			expect(state.getSense("darkvision")).toBe(60);
			expect(state.getSenses().darkvision).toBe(60);
		});

		test("a setValue sense modifier grants exactly its value (was 2x)", () => {
			const state = makeState();
			state.addNamedModifier({name: "Probe", type: "sense:blindsight", value: 10, setValue: true, sourceType: "classFeature"});
			expect(state.getNamedModifiers().some(m => m.type === "sense:blindsight")).toBe(true);
			expect(state.getSense("blindsight")).toBe(10);
			expect(state.getSenses().blindsight).toBe(10);
		});

		test("Skulker (XPHB) grants blindsight 10, not 20 — the reported bug, end to end", () => {
			const state = makeState();
			state.addFeat({name: "Skulker", source: "XPHB"});
			expect(state.getNamedModifiers().some(m => m.type === "sense:blindsight")).toBe(true);
			expect(state.getSense("blindsight")).toBe(10);
			expect(state.getSenses().blindsight).toBe(10);
		});
	});

	describe("non-canonical sense names", () => {
		// The fold's `if (cm.senses[sense] !== undefined)` guard meant homebrew sense names
		// never folded, so they were the ONE case that was already correct. Whichever side
		// survived had to keep them correct — this is the assertion that made "just delete
		// namedBonus" the wrong fix.
		test("a homebrew sense name resolves through getSense()", () => {
			const state = makeState();
			state.addNamedModifier({name: "Probe", type: "sense:echolocation", value: 30, sourceType: "classFeature"});
			expect(state.getSense("echolocation")).toBe(30);
		});

		test("a homebrew sense name surfaces in getSenses() alongside the canonical four", () => {
			const state = makeState();
			state.addNamedModifier({name: "Probe", type: "sense:echolocation", value: 30, sourceType: "classFeature"});
			const senses = state.getSenses();
			// Canonical keys always report, even at zero — callers index them directly.
			expect(senses.darkvision).toBe(0);
			expect(senses.blindsight).toBe(0);
			expect(senses.tremorsense).toBe(0);
			expect(senses.truesight).toBe(0);
			expect(senses.echolocation).toBe(30);
		});

		test("getSenses() does not invent keys for senses with no source", () => {
			const state = makeState();
			expect(Object.keys(state.getSenses()).sort()).toEqual(["blindsight", "darkvision", "tremorsense", "truesight"]);
		});
	});

	describe("additive vs set semantics", () => {
		test("an additive modifier stacks on top of a base sense", () => {
			const state = makeState();
			state.setSense("darkvision", 60);
			state.addNamedModifier({name: "Probe", type: "sense:darkvision", value: 60, sourceType: "classFeature"});
			expect(state.getSense("darkvision")).toBe(120);
		});

		test("two additive modifiers stack with each other", () => {
			const state = makeState();
			state.addNamedModifier({name: "A", type: "sense:darkvision", value: 30, sourceType: "classFeature"});
			state.addNamedModifier({name: "B", type: "sense:darkvision", value: 30, sourceType: "classFeature"});
			expect(state.getSense("darkvision")).toBe(60);
		});

		test("competing setValue grants take the best, not the sum", () => {
			const state = makeState();
			state.addNamedModifier({name: "A", type: "sense:truesight", value: 30, setValue: true, sourceType: "classFeature"});
			state.addNamedModifier({name: "B", type: "sense:truesight", value: 60, setValue: true, sourceType: "classFeature"});
			expect(state.getSense("truesight")).toBe(60);
		});

		test("a disabled modifier contributes nothing", () => {
			const state = makeState();
			state.addNamedModifier({name: "Probe", type: "sense:darkvision", value: 60, sourceType: "classFeature"});
			expect(state.getSense("darkvision")).toBe(60);
			const mod = state.getNamedModifiers().find(m => m.type === "sense:darkvision");
			state.updateNamedModifier(mod.id, {enabled: false});
			expect(state.getSense("darkvision")).toBe(0);
			expect(state.getSenses().darkvision).toBe(0);
		});
	});

	/**
	 * CS-BUG-137 — a SEPARATE behaviour change, shipped alongside the CS-BUG-136 fix but
	 * not caused by it.
	 *
	 * A `setValue` grant used to be ADDED on top of the `Math.max(...)` group, so "you gain
	 * blindsight 10 ft" extended an innate blindsight 30 ft to 40. It now joins the max
	 * group and competes instead. This is not the double-count: with base 30 and a set-10
	 * grant, fixing ONLY the duplication still yields 40 (`max(30, …) + 10`); reaching 30
	 * requires this change as well. The discriminator is a base sense LARGER than the
	 * grant — which is why Skulker (no innate blindsight) is unaffected by it.
	 *
	 * Max is the established semantics for this channel: the `sense:`+`setValue` intercept
	 * in the feature-effect applier writes only `if (mod.value > currentValue)`.
	 */
	describe("CS-BUG-137 — a setValue grant competes with an existing sense, not stacks", () => {
		test("a setValue grant cannot inflate a LARGER existing sense", () => {
			const state = makeState();
			state.setSense("blindsight", 30);
			state.addNamedModifier({name: "Probe", type: "sense:blindsight", value: 10, setValue: true, sourceType: "classFeature"});
			// Was 40 before this change, and would still be 40 after a duplication-only fix.
			expect(state.getSense("blindsight")).toBe(30);
			expect(state.getSenses().blindsight).toBe(30);
		});

		test("a setValue grant does raise a SMALLER existing sense", () => {
			const state = makeState();
			state.setSense("blindsight", 10);
			state.addNamedModifier({name: "Probe", type: "sense:blindsight", value: 30, setValue: true, sourceType: "classFeature"});
			expect(state.getSense("blindsight")).toBe(30);
		});

		test("a setValue grant competes with an item-granted sense, not just a base one", () => {
			// The max group covers every non-named channel. `itemSenses` is a separate
			// channel from base senses, so it needs its own guard.
			const state = makeState();
			state.setItemSenses({darkvision: 60, blindsight: 0, tremorsense: 0, truesight: 0});
			state.addNamedModifier({name: "Probe", type: "sense:darkvision", value: 30, setValue: true, sourceType: "classFeature"});
			// Was 90 before this change (60 + 30); the smaller grant now loses outright.
			expect(state.getSense("darkvision")).toBe(60);
		});

		test("an additive grant is unaffected — it still stacks on a larger base", () => {
			// Guards the boundary: only the `setValue` branch moved into the max group.
			const state = makeState();
			state.setSense("blindsight", 30);
			state.addNamedModifier({name: "Probe", type: "sense:blindsight", value: 10, sourceType: "classFeature"});
			expect(state.getSense("blindsight")).toBe(40);
		});
	});

	describe("value resolution parity", () => {
		// The deleted fold resolved through `_getNamedModifierEffectiveValue` (symbolic
		// tokens + perLevel + proficiencyBonus); the surviving read path used bare
		// `_resolveSymbolicModifierValue` and silently ignored the latter two. The fix had
		// to carry that capability across rather than lose it with the fold.
		test("a symbolic value resolves to a live number", () => {
			const state = makeState({con: 16}); // CON +3 → conModx2 = 6
			state.addNamedModifier({name: "Probe", type: "sense:darkvision", value: "conModx2", sourceType: "classFeature"});
			const value = state.getSense("darkvision");
			expect(Number.isFinite(value)).toBe(true);
			expect(value).toBe(6);
		});

		test("a perLevel modifier scales with total level", () => {
			const state = makeState({level: 5});
			state.addNamedModifier({name: "Probe", type: "sense:tremorsense", value: 5, perLevel: true, sourceType: "classFeature"});
			expect(state.getSense("tremorsense")).toBe(25);
		});

		test("a proficiencyBonus modifier adds the proficiency bonus", () => {
			const state = makeState({level: 5}); // PB +3
			state.addNamedModifier({name: "Probe", type: "sense:tremorsense", value: 10, proficiencyBonus: true, sourceType: "classFeature"});
			expect(state.getSense("tremorsense")).toBe(10 + state.getProficiencyBonus());
		});
	});

	describe("getSense() and getSenses() cannot drift", () => {
		test("every key reported by getSenses() equals getSense() for that key", () => {
			const state = makeState();
			state.setSense("darkvision", 60);
			state.addNamedModifier({name: "A", type: "sense:darkvision", value: 30, sourceType: "classFeature"});
			state.addNamedModifier({name: "B", type: "sense:blindsight", value: 10, setValue: true, sourceType: "classFeature"});
			state.addNamedModifier({name: "C", type: "sense:echolocation", value: 15, sourceType: "classFeature"});
			const senses = state.getSenses();
			expect(Object.keys(senses).length).toBeGreaterThan(4);
			for (const [key, value] of Object.entries(senses)) {
				expect([key, value]).toEqual([key, state.getSense(key)]);
			}
		});
	});

	describe("other sense channels are untouched by the fix", () => {
		// Locks in the finding that ONLY the named-modifier path moved: class features and
		// races write base senses, items write itemSenses / senseBonus:* effects, and none
		// of those ever reached the deleted fold.
		test("a base sense set by a class feature or race is unchanged", () => {
			const state = makeState();
			state.setSense("darkvision", 60);
			expect(state.getSense("darkvision")).toBe(60);
			expect(state.getSenses().darkvision).toBe(60);
		});

		test("an item senseBonus:* effect still stacks additively on the base sense", () => {
			const state = makeState();
			state.setSense("darkvision", 60);
			state.addItem({
				name: "Probe Goggles",
				source: "TGTT",
				equipped: true,
				quantity: 1,
				effects: [{type: "senseBonus:darkvision", value: 30, name: "Probe"}],
			});
			expect(state.getSense("darkvision")).toBe(90);
		});

		test("an item granting a sense via a setValue effect grants it exactly once", () => {
			// Gae Bolg's shape. Was 120 before the fix, masked by a
			// `toBeGreaterThanOrEqual(60)` assertion.
			const state = makeState();
			state.addItem({
				name: "Probe Spear",
				source: "TGTT",
				equipped: true,
				attuned: true,
				requiresAttunement: true,
				quantity: 1,
				effects: [{type: "sense:truesight", value: 60, setValue: true, name: "Probe"}],
				senses: {truesight: 60},
			});
			expect(state.getSense("truesight")).toBe(60);
			expect(state.getSenses().truesight).toBe(60);
		});
	});

	describe("customModifiers.senses is inert", () => {
		test("the vestigial fold target stays zeroed for every canonical sense", () => {
			const state = makeState();
			state.addNamedModifier({name: "A", type: "sense:darkvision", value: 60, sourceType: "classFeature"});
			state.addNamedModifier({name: "B", type: "sense:blindsight", value: 10, setValue: true, sourceType: "classFeature"});
			// If this ever goes non-zero the fold has been reintroduced and the 2x is back.
			expect(state._data.customModifiers.senses).toEqual({darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0});
		});

		test("getCustomModifier() still reports the named-sense contribution", () => {
			const state = makeState();
			state.addNamedModifier({name: "A", type: "sense:darkvision", value: 60, sourceType: "classFeature"});
			expect(state.getCustomModifier("sense:darkvision")).toBe(60);
		});

		test("getCustomModifier() reports non-canonical senses too, which the fold never could", () => {
			const state = makeState();
			state.addNamedModifier({name: "A", type: "sense:echolocation", value: 30, sourceType: "classFeature"});
			expect(state.getCustomModifier("sense:echolocation")).toBe(30);
		});
	});
});
