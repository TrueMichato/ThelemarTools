import "./setup.js"; // Import first to set up mocks

/**
 * CS-BUG-088 -- Indomitable Might (Barbarian 18) rendered but did nothing.
 *
 * It was registered as `{type: "modifier", modType: "ability:str:minimum", value: "strScore"}`.
 * NO reader in the codebase consumed `ability:str:minimum`, so the modifier was created and
 * then ignored: `rollFloors` stayed empty, every aggregate reported 0, and the feature was
 * pure description -- the exact failure mode the subclass batch's acceptance bar forbids.
 *
 * The modType was ALSO the wrong model. RAW floors the TOTAL of a Strength check, not the
 * Strength SCORE, so implementing `ability:str:minimum` faithfully would have produced a
 * correct-looking number enforcing the wrong rule. The fix changes the model to a total floor.
 *
 * Three floors now coexist and must not be confused:
 *   - `skillMinimum`  -> floors the d20 DIE   (Reliable Talent)
 *   - `checkTotalFloor` -> floors the TOTAL   (Indomitable Might)  <-- this file
 *   - ability-score bonuses -> change the SCORE (what the old modType wrongly implied)
 */

let CharacterSheetState;
let registry;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	registry = globalThis.FeatureEffectRegistry;
});

/** Build a Barbarian carrying Indomitable Might from the given source book. */
function makeBarbarian ({strBase = 20, source = "XPHB", level = 18, withFeature = true} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", strBase);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 16);
	state.setAbilityBase("int", 8);
	state.setAbilityBase("wis", 10);
	state.setAbilityBase("cha", 8);
	state.addClass({name: "Barbarian", source: "PHB", level});
	if (withFeature) {
		state._data.features = [{
			id: "im-test",
			name: "Indomitable Might",
			className: "Barbarian",
			source,
			level: 18,
			entries: ["If your total for a Strength check is less than your Strength score, you can use that score in place of the total."],
		}];
	} else {
		state._data.features = [];
	}
	state.applyClassFeatureEffects();
	return state;
}

describe("CS-BUG-088 Indomitable Might total floor", () => {
	describe("registry models a TOTAL floor, not a score floor", () => {
		test("is registered as checkTotalFloor and NOT as the inert ability:str:minimum modType", () => {
			const effects = registry.getEffects("Indomitable Might");
			expect(effects.length).toBeGreaterThan(0);

			const floor = effects.find(e => e.type === "checkTotalFloor");
			expect(floor).toBeDefined();
			expect(floor.ability).toBe("str");
			// Floor value is derived live, never baked as a number at registration.
			expect(floor.floorFrom).toBe("abilityScore");
			expect(typeof floor.value).toBe("undefined");

			// The old broken model must be gone: nothing consumed this modType.
			const stale = effects.find(e => e.modType === "ability:str:minimum");
			expect(stale).toBeUndefined();
		});
	});

	describe("the floor reaches the aggregate the roll handlers actually read", () => {
		test("check:str carries totalMinimum equal to the live STR score, attributed to the feature", () => {
			const state = makeBarbarian({strBase: 20});
			const agg = state.aggregateModifiers("check:str");
			expect(agg.totalMinimum).toBe(20);
			expect(agg.sources).toContain("Indomitable Might");
		});

		test("the floor TRACKS the score rather than baking it (the CS-BUG-038 failure mode)", () => {
			const low = makeBarbarian({strBase: 12});
			expect(low.aggregateModifiers("check:str").totalMinimum).toBe(12);

			const high = makeBarbarian({strBase: 24});
			expect(high.aggregateModifiers("check:str").totalMinimum).toBe(24);
		});

		test("does not leak onto other abilities", () => {
			const state = makeBarbarian();
			expect(state.aggregateModifiers("check:dex").totalMinimum).toBeNull();
			expect(state.aggregateModifiers("check:cha").totalMinimum).toBeNull();
			expect(state.aggregateModifiers("save:dex").totalMinimum).toBeNull();
		});

		test("a Barbarian without the feature has no floor at all (control)", () => {
			const state = makeBarbarian({withFeature: false});
			expect(state.aggregateModifiers("check:str").totalMinimum).toBeNull();
			expect(state._data.rollFloors?.checkTotal).toBeUndefined();
		});
	});

	describe("edition divergence -- 2024 adds saving throws, 2014 does not", () => {
		test("XPHB (2024) floors Strength SAVING THROWS as well as checks", () => {
			const state = makeBarbarian({source: "XPHB", strBase: 20});
			expect(state.aggregateModifiers("check:str").totalMinimum).toBe(20);
			expect(state.aggregateModifiers("save:str").totalMinimum).toBe(20);
		});

		test("PHB (2014) floors checks ONLY -- Strength saves are untouched", () => {
			const state = makeBarbarian({source: "PHB", strBase: 20});
			expect(state.aggregateModifiers("check:str").totalMinimum).toBe(20);
			expect(state.aggregateModifiers("save:str").totalMinimum).toBeNull();
		});
	});

	describe("the floor is distinct from the existing d20 DIE floor", () => {
		test("checkTotalFloor does not set the die-floor `minimum`", () => {
			const state = makeBarbarian();
			// `minimum` is Reliable Talent's surface; Indomitable Might must not touch it,
			// or a 7 on the die would silently become a 20 on the die.
			expect(state.aggregateModifiers("check:str").minimum).toBeNull();
		});

		test("it does not change the Strength SCORE or modifier", () => {
			const withF = makeBarbarian({strBase: 12, source: "PHB"});
			const without = makeBarbarian({strBase: 12, source: "PHB", withFeature: false});
			expect(withF.getAbilityScore("str")).toBe(without.getAbilityScore("str"));
			expect(withF.getAbilityMod("str")).toBe(without.getAbilityMod("str"));
		});
	});
});
