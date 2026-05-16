/**
 * CharacterSheetConditionalModifiers — Phase A regression tests.
 *
 * Verifies the architectural fix for the "conditional advantage applies to
 * every roll" bug class (bugs.md: "Dauntless Heritage being applied to all
 * saves").
 *
 * Contract:
 *  - Modifiers with a truthy `conditional` text field are GATED OFF by
 *    default and surfaced in `result.conditionalsAvailable` for a pre-roll
 *    picker to opt in to per roll.
 *  - Registry sub-typed entries like `save:advantage:frightened` are
 *    normalized: they also surface on `save:<basic-ability>` queries with a
 *    synthesized `conditional` string, flowing through the same opt-in path.
 *  - Stable IDs (`_buildConditionalModId`) round-trip the same modifier
 *    across repeated aggregations within a roll cycle.
 *  - `getAdvantageState` and `getModifierBonus` honour the opt forwarding.
 */

import "./setup.js";

let CharacterSheetState;
let s;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

beforeEach(() => {
	s = new CharacterSheetState();
	s.setAbilityBase("str", 14);
	s.setAbilityBase("dex", 14);
	s.setAbilityBase("con", 14);
	s.setAbilityBase("int", 10);
	s.setAbilityBase("wis", 12);
	s.setAbilityBase("cha", 10);
});

describe("Conditional modifier helpers", () => {
	test("_isConditionalSaveSubtype: returns false for basic abilities and 'all'", () => {
		["str", "dex", "con", "int", "wis", "cha", "all"].forEach(k => {
			expect(CharacterSheetState._isConditionalSaveSubtype(k)).toBe(false);
		});
	});

	test("_isConditionalSaveSubtype: returns true for conditional sub-keys", () => {
		["frightened", "charmed", "poisoned", "magic", "disease", "spells", "fear"].forEach(k => {
			expect(CharacterSheetState._isConditionalSaveSubtype(k)).toBe(true);
		});
	});

	test("_isConditionalSaveSubtype: rejects standard skill names", () => {
		expect(CharacterSheetState._isConditionalSaveSubtype("stealth")).toBe(false);
		expect(CharacterSheetState._isConditionalSaveSubtype("perception")).toBe(false);
	});

	test("_buildConditionalModId: deterministic and round-trips identically", () => {
		const mod = {
			type: "save:all",
			name: "Dauntless Heritage",
			conditional: "against being frightened",
			advantage: true,
		};
		const id1 = CharacterSheetState._buildConditionalModId(mod);
		const id2 = CharacterSheetState._buildConditionalModId({...mod});
		expect(id1).toBe(id2);
		expect(id1).toContain("save:all");
		expect(id1).toContain("Dauntless Heritage");
		expect(id1).toContain("against being frightened");
	});

	test("_buildConditionalModId: strips advantage/disadvantage tokens from base type", () => {
		const id = CharacterSheetState._buildConditionalModId({
			type: "save:advantage:frightened",
			name: "Brave",
			conditional: "against being frightened",
		});
		expect(id).not.toContain(":advantage:");
		expect(id).toContain("save");
		expect(id).toContain("frightened");
	});
});

describe("aggregateModifiers — conditional gating", () => {
	test("text-parsed conditional save:all advantage does NOT apply by default to any ability save", () => {
		// Simulates Dauntless Heritage as the text parser would emit it.
		s._data.namedModifiers.push({
			enabled: true,
			type: "save:all",
			advantage: true,
			conditional: "against being frightened",
			name: "Dauntless Heritage",
		});

		["str", "dex", "con", "int", "wis", "cha"].forEach(abl => {
			const agg = s.aggregateModifiers(`save:${abl}`);
			expect(agg.advantage).toBe(false);
			expect(agg.conditionalsAvailable).toHaveLength(1);
			expect(agg.conditionalsAvailable[0].name).toBe("Dauntless Heritage");
			expect(agg.conditionalsAvailable[0].conditional).toBe("against being frightened");
			expect(agg.conditionalsAvailable[0].advantage).toBe(true);
		});
	});

	test("opting in via appliedConditionalIds DOES apply the advantage", () => {
		s._data.namedModifiers.push({
			enabled: true,
			type: "save:all",
			advantage: true,
			conditional: "against being frightened",
			name: "Dauntless Heritage",
		});
		const probe = s.aggregateModifiers("save:wis");
		const id = probe.conditionalsAvailable[0].id;
		const applied = s.aggregateModifiers("save:wis", {appliedConditionalIds: new Set([id])});
		expect(applied.advantage).toBe(true);
		expect(applied.conditionalsAvailable).toHaveLength(0);
		expect(applied.sources).toContain("Dauntless Heritage");
	});

	test("non-conditional modifiers continue to apply automatically", () => {
		s._data.namedModifiers.push({
			enabled: true,
			type: "save:all",
			advantage: true,
			name: "Aura of Protection",
		});
		const agg = s.aggregateModifiers("save:wis");
		expect(agg.advantage).toBe(true);
		expect(agg.conditionalsAvailable).toHaveLength(0);
	});

	test("registry sub-typed `save:advantage:frightened` is normalized as a conditional on save:<ability>", () => {
		// Pre-existing registry style — should now flow through the same picker.
		s._data.namedModifiers.push({
			enabled: true,
			type: "save:advantage:frightened",
			name: "Brave",
		});
		const agg = s.aggregateModifiers("save:wis");
		expect(agg.advantage).toBe(false); // gated by default
		expect(agg.conditionalsAvailable).toHaveLength(1);
		expect(agg.conditionalsAvailable[0].advantage).toBe(true);
		expect(agg.conditionalsAvailable[0].conditional).toBe("against being frightened");
	});

	test("registry sub-typed entries respect opt-in", () => {
		s._data.namedModifiers.push({
			enabled: true,
			type: "save:advantage:frightened",
			name: "Brave",
		});
		const probe = s.aggregateModifiers("save:dex");
		const id = probe.conditionalsAvailable[0].id;
		const applied = s.aggregateModifiers("save:dex", {appliedConditionalIds: new Set([id])});
		expect(applied.advantage).toBe(true);
	});

	test("conditional numeric bonus is gated and applied via opt-in", () => {
		s._data.namedModifiers.push({
			enabled: true,
			type: "save:all",
			value: 2,
			conditional: "against spells",
			name: "Gnomish Cunning",
		});
		const probe = s.aggregateModifiers("save:int");
		expect(probe.bonus).toBe(0);
		expect(probe.conditionalsAvailable).toHaveLength(1);
		expect(probe.conditionalsAvailable[0].bonus).toBe(2);
		const applied = s.aggregateModifiers("save:int", {
			appliedConditionalIds: new Set([probe.conditionalsAvailable[0].id]),
		});
		expect(applied.bonus).toBe(2);
	});

	test("deduplicates the same conditional surfaced multiple times", () => {
		// Both entries describe the same conditional advantage on int saves
		// against spells; they should collapse to one picker row by ID.
		const mod = {
			enabled: true,
			type: "save:int",
			advantage: true,
			conditional: "against spells",
			name: "Gnomish Cunning",
		};
		s._data.namedModifiers.push(mod, {...mod});
		const probe = s.aggregateModifiers("save:int");
		expect(probe.conditionalsAvailable).toHaveLength(1);
	});
});

describe("getAdvantageState / getModifierBonus opt forwarding", () => {
	beforeEach(() => {
		s._data.namedModifiers.push({
			enabled: true,
			type: "save:all",
			advantage: true,
			conditional: "against being frightened",
			name: "Dauntless Heritage",
		});
	});

	test("getAdvantageState reports no advantage by default", () => {
		const state = s.getAdvantageState("save:wis");
		expect(state.advantage).toBe(false);
	});

	test("getAdvantageState reports advantage when conditional is opted in", () => {
		const probe = s.aggregateModifiers("save:wis");
		const id = probe.conditionalsAvailable[0].id;
		const state = s.getAdvantageState("save:wis", {appliedConditionalIds: new Set([id])});
		expect(state.advantage).toBe(true);
	});

	test("getModifierBonus honours conditional opt-in for numeric bonuses", () => {
		s._data.namedModifiers.push({
			enabled: true,
			type: "save:all",
			value: 3,
			conditional: "against disease",
			name: "Hardy",
		});
		expect(s.getModifierBonus("save:con")).toBe(0);
		const probe = s.aggregateModifiers("save:con");
		const hardyEntry = probe.conditionalsAvailable.find(c => c.name === "Hardy");
		expect(hardyEntry).toBeDefined();
		const opted = s.getModifierBonus("save:con", {appliedConditionalIds: new Set([hardyEntry.id])});
		expect(opted).toBe(3);
	});
});
