/**
 * Druid Resource Modal (Bug #5) — MECHANICS.
 *
 * Covers the purpose-built Druid Resources surface that replaces the generic
 * "Available to Activate" treatment of Wild Shape, Wild Companion, and Zodiac
 * Form. These assertions exercise the additive STATE primitives the modal is
 * built on (DOM-free), not level counts:
 *  - getWildShapeResource resolution (featureId first, then name).
 *  - canSpend / spend / restore Wild Shape uses (floor/ceiling, sync to feature).
 *  - Wild Companion consumption model (spends exactly 1 Wild Shape use, blocked at 0).
 *  - activateZodiacFormUsingWildShape: atomic spend + activate, blocked at 0,
 *    sets the chosen formId, hover entity resolves, form-switch costs another use.
 *  - isDruidResourceActivatable predicate (narrow, no over-filtering).
 *  - Save/load round-trip + backward-compat (old saves with no resource/zodiac).
 *  - Guard: plain activateZodiacForm is unchanged (no auto-spend).
 */

import "./setup.js";

let CharacterSheetState;
let CharacterSheetClassUtils;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetClassUtils = (await import("../../../js/charactersheet/charactersheet-class-utils.js")).CharacterSheetClassUtils;
});

/** Druid with a Wild Shape feature (auto-creates a featureId-linked resource). */
function makeWildShapeDruid (level = 3, {current = 2, max = 2, recharge = "short"} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Druid",
		source: "TGTT",
		level,
		subclass: level >= 3 ? {name: "Circle of the Stars", shortName: "Stars", source: "TGTT"} : undefined,
	});
	state.setAbilityBase("wis", 16);
	state.addFeature({name: "Wild Shape", source: "XPHB", uses: {current, max, recharge}});
	return state;
}

describe("Druid Resources — Wild Shape uses resource", () => {
	it("resolves the Wild Shape resource by linked featureId", () => {
		const state = makeWildShapeDruid(3);
		const wsFeature = state.getFeatures().find(f => f.name === "Wild Shape");
		const res = state.getWildShapeResource();
		expect(res).toBeTruthy();
		expect(res.featureId).toBe(wsFeature.id);
		expect(res.current).toBe(2);
		expect(res.max).toBe(2);
		expect(res.recharge).toBe("short");
	});

	it("resolves by normalized name when no featureId link exists", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Druid", source: "PHB", level: 2});
		state.addResource({name: "Wild Shape", max: 2, current: 2, recharge: "short"});
		const res = state.getWildShapeResource();
		expect(res).toBeTruthy();
		expect(res.name).toBe("Wild Shape");
	});

	it("prefers the featureId-linked resource over a stale same-named one", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		const wsFeature = state.getFeatures().find(f => f.name === "Wild Shape");
		// Inject a stale, UNLINKED resource that also happens to be named "Wild Shape".
		state.addResource({name: "Wild Shape", max: 2, current: 0});
		const res = state.getWildShapeResource();
		expect(res.featureId).toBe(wsFeature.id);
		expect(res.current).toBe(2); // the linked one, NOT the stale current-0 duplicate
	});

	it("falls back to name when the Wild Shape feature has no linked resource", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Druid", source: "PHB", level: 2});
		// Feature present, but the only resource is name-matched (not featureId-linked).
		state.addFeature({name: "Wild Shape", source: "PHB"});
		state.addResource({name: "Wild Shape", max: 2, current: 1, recharge: "short"});
		const res = state.getWildShapeResource();
		expect(res).toBeTruthy();
		expect(res.current).toBe(1);
	});

	it("returns null when there is no Wild Shape resource", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		expect(state.getWildShapeResource()).toBeNull();
	});
});

describe("Druid Resources — spend / restore", () => {
	it("canSpendWildShapeUse reflects availability", () => {
		const state = makeWildShapeDruid(3, {current: 1, max: 2});
		expect(state.canSpendWildShapeUse(1)).toBe(true);
		expect(state.canSpendWildShapeUse(2)).toBe(false);
	});

	it("spends a use and keeps the linked feature in sync", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		expect(state.spendWildShapeUse(1)).toBe(true);
		expect(state.getWildShapeResource().current).toBe(1);
		const wsFeature = state.getFeatures().find(f => f.name === "Wild Shape");
		expect(wsFeature.uses.current).toBe(1);
	});

	it("refuses to spend more uses than remain (no underflow)", () => {
		const state = makeWildShapeDruid(3, {current: 1, max: 2});
		expect(state.spendWildShapeUse(2)).toBe(false);
		expect(state.getWildShapeResource().current).toBe(1);
		expect(state.spendWildShapeUse(1)).toBe(true);
		expect(state.spendWildShapeUse(1)).toBe(false);
		expect(state.getWildShapeResource().current).toBe(0);
	});

	it("restores a use but never above max", () => {
		const state = makeWildShapeDruid(3, {current: 0, max: 2});
		expect(state.restoreWildShapeUse(1)).toBe(true);
		expect(state.getWildShapeResource().current).toBe(1);
		state.restoreWildShapeUse(5);
		expect(state.getWildShapeResource().current).toBe(2);
	});

	it("restore keeps the linked feature in sync", () => {
		const state = makeWildShapeDruid(3, {current: 0, max: 2});
		state.restoreWildShapeUse(1);
		const wsFeature = state.getFeatures().find(f => f.name === "Wild Shape");
		expect(wsFeature.uses.current).toBe(1);
	});

	it("restore returns false when no resource exists", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		expect(state.restoreWildShapeUse(1)).toBe(false);
	});
});

describe("Druid Resources — Wild Companion consumption model", () => {
	// Wild Companion summons a Fey familiar by consuming exactly one Wild Shape
	// use. The familiar summon UI is controller-owned; the consumption is the
	// Wild Shape spend primitive, which the modal calls only after a familiar
	// is actually chosen.
	it("consumes exactly one Wild Shape use", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		expect(state.canSpendWildShapeUse(1)).toBe(true);
		expect(state.spendWildShapeUse(1)).toBe(true);
		expect(state.getWildShapeResource().current).toBe(1);
	});

	it("is blocked when no Wild Shape uses remain", () => {
		const state = makeWildShapeDruid(3, {current: 0, max: 2});
		expect(state.canSpendWildShapeUse(1)).toBe(false);
		expect(state.spendWildShapeUse(1)).toBe(false);
		expect(state.getWildShapeResource().current).toBe(0);
	});
});

describe("Druid Resources — Zodiac Form via Wild Shape", () => {
	function getActiveZodiacRecord (state) {
		return state._data.activeStates.find(s => s.stateTypeId === "zodiacForm" && s.active);
	}

	it("spends one use, activates the chosen form, and resolves the specific hover", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		const def = state.activateZodiacFormUsingWildShape("octopus");
		expect(def).toBeTruthy();
		expect(def.id).toBe("octopus");
		expect(state.getWildShapeResource().current).toBe(1);

		const active = state.getActiveZodiacForm();
		expect(active.formId).toBe("octopus");

		// The spend stays in sync with the linked Wild Shape feature.
		const wsFeature = state.getFeatures().find(f => f.name === "Wild Shape");
		expect(wsFeature.uses.current).toBe(1);

		// The active record links back to the Wild Shape resource it spent.
		const rec = getActiveZodiacRecord(state);
		expect(rec.resourceId).toBe(state.getWildShapeResource().id);

		// The active record's hover resolves to the SPECIFIC constellation entry.
		const hoverEntity = CharacterSheetClassUtils.getZodiacFormHoverEntity(rec);
		expect(hoverEntity).toBeTruthy();
		expect(hoverEntity.name).toBe("Octopus");
		expect(Array.isArray(hoverEntity.entries)).toBe(true);
		expect(hoverEntity.entries.length).toBeGreaterThan(0);
	});

	it("passes options through to the underlying activation", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		state.activateZodiacFormUsingWildShape("cat", {sourceFeatureId: "feat-zodiac", description: "Zodiac Form"});
		const rec = getActiveZodiacRecord(state);
		expect(rec.sourceFeatureId).toBe("feat-zodiac");
		expect(rec.description).toBe("Zodiac Form");
	});

	it("returns null and spends nothing when no Wild Shape use is available", () => {
		const state = makeWildShapeDruid(3, {current: 0, max: 2});
		const def = state.activateZodiacFormUsingWildShape("cat");
		expect(def).toBeNull();
		expect(state.getActiveZodiacForm()).toBeNull();
		expect(state.getWildShapeResource().current).toBe(0);
	});

	it("returns null for an unknown form id without spending", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		expect(state.activateZodiacFormUsingWildShape("not-a-form")).toBeNull();
		expect(state.getWildShapeResource().current).toBe(2);
	});

	it("switching forms spends another use and replaces the active form", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		state.activateZodiacFormUsingWildShape("cat");
		expect(state.getActiveZodiacForm().formId).toBe("cat");
		expect(state.getWildShapeResource().current).toBe(1);

		state.activateZodiacFormUsingWildShape("horse");
		expect(state.getActiveZodiacForm().formId).toBe("horse");
		expect(state.getWildShapeResource().current).toBe(0);

		// Only one zodiac form is active at a time.
		const activeZodiac = state._data.activeStates.filter(s => s.stateTypeId === "zodiacForm" && s.active);
		expect(activeZodiac.length).toBe(1);
	});
});

describe("Druid Resources — isDruidResourceActivatable predicate", () => {
	it("matches Wild Shape and Wild Companion (wildShape state type, by name)", () => {
		expect(CharacterSheetState.isDruidResourceActivatable({stateTypeId: "wildShape", feature: {name: "Wild Shape"}})).toBe(true);
		expect(CharacterSheetState.isDruidResourceActivatable({stateTypeId: "wildShape", feature: {name: "Wild Companion"}})).toBe(true);
	});

	it("matches any Zodiac Form activatable", () => {
		expect(CharacterSheetState.isDruidResourceActivatable({stateTypeId: "zodiacForm", feature: {name: "Zodiac Form: Month"}})).toBe(true);
	});

	it("does NOT over-filter unrelated states", () => {
		expect(CharacterSheetState.isDruidResourceActivatable({stateTypeId: "rage", feature: {name: "Rage"}})).toBe(false);
		expect(CharacterSheetState.isDruidResourceActivatable({stateTypeId: "bladesong", feature: {name: "Bladesong"}})).toBe(false);
		expect(CharacterSheetState.isDruidResourceActivatable({stateTypeId: "combatStance", feature: {name: "Heavy Stance"}})).toBe(false);
		// A homebrew feature mis-detected as wildShape but NOT Wild Shape/Companion stays visible.
		expect(CharacterSheetState.isDruidResourceActivatable({stateTypeId: "wildShape", feature: {name: "Primal Beast Toggle"}})).toBe(false);
		expect(CharacterSheetState.isDruidResourceActivatable(null)).toBe(false);
	});

	it("is false when the activatable has no feature / no name", () => {
		expect(CharacterSheetState.isDruidResourceActivatable({stateTypeId: "wildShape"})).toBe(false);
		expect(CharacterSheetState.isDruidResourceActivatable({stateTypeId: "wildShape", feature: {}})).toBe(false);
		expect(CharacterSheetState.isDruidResourceActivatable({})).toBe(false);
		// Zodiac qualifies regardless of feature/name (a Circle-of-the-Zodiac-only state type).
		expect(CharacterSheetState.isDruidResourceActivatable({stateTypeId: "zodiacForm"})).toBe(true);
	});
});

describe("Druid Resources — generic list filtering (integration)", () => {
	it("flags exactly the Druid rows out of real getActivatableFeatures() output", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Druid", source: "TGTT", level: 3, subclass: {name: "Circle of the Stars", shortName: "Stars", source: "TGTT"}});
		state.setAbilityBase("wis", 16);
		state.addFeature({name: "Wild Shape", source: "XPHB", uses: {current: 2, max: 2, recharge: "short"}, description: "As a bonus action, you can magically assume the shape of a beast that you have seen before."});
		state.addFeature({name: "Wild Companion", source: "XPHB", description: "As an action, you can expend a use of Wild Shape to cast Find Familiar."});
		state.addFeature({name: "Zodiac Form: Month", source: "TGTT", description: "As a bonus action, choose a constellation form."});
		// An unrelated homebrew feature that detection may classify as wildShape.
		state.addFeature({name: "Primal Beast Toggle", source: "TGTT", description: "As a bonus action, take on the form of a wild shape beast."});

		const activatables = state.getActivatableFeatures();
		const filteredOut = activatables.filter(af => CharacterSheetState.isDruidResourceActivatable(af)).map(af => af.feature.name);
		const remaining = activatables.filter(af => !CharacterSheetState.isDruidResourceActivatable(af)).map(af => af.feature.name);

		expect(filteredOut).toEqual(expect.arrayContaining(["Wild Shape", "Wild Companion", "Zodiac Form: Month"]));
		expect(filteredOut).not.toContain("Primal Beast Toggle");
		expect(remaining).toContain("Primal Beast Toggle");
	});
});

describe("Druid Resources — save/load round-trip & backward-compat", () => {
	it("round-trips Wild Shape uses and the active Zodiac Form", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		state.setSpeed("walk", 30);
		state.activateZodiacFormUsingWildShape("octopus");
		expect(state.getWildShapeResource().current).toBe(1);

		const json = state.toJson();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);

		expect(reloaded.getWildShapeResource().current).toBe(1);
		expect(reloaded.getActiveZodiacForm().formId).toBe("octopus");
	});

	it("loads an older save with no Wild Shape resource and no zodiac form cleanly", () => {
		const seed = new CharacterSheetState();
		seed.addClass({name: "Druid", source: "PHB", level: 1});
		const json = seed.toJson();
		delete json.activeStates; // simulate a pre-feature save shape

		const reloaded = new CharacterSheetState();
		expect(() => reloaded.loadFromJson(json)).not.toThrow();
		expect(reloaded.getWildShapeResource()).toBeNull();
		expect(reloaded.getActiveZodiacForm()).toBeNull();
	});
});

describe("Druid Resources — guard: plain activateZodiacForm is unchanged", () => {
	it("activates with NO Wild Shape resource and does not touch resources", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Druid", source: "TGTT", level: 3, subclass: {name: "Circle of the Stars", shortName: "Stars", source: "TGTT"}});
		state.setAbilityBase("wis", 16);

		// No Wild Shape resource present.
		expect(state.getWildShapeResource()).toBeNull();
		const id = state.activateZodiacForm("cat");
		expect(id).toBeTruthy();
		expect(state.getActiveZodiacForm().formId).toBe("cat");
	});

	it("does not decrement an existing Wild Shape resource", () => {
		const state = makeWildShapeDruid(3, {current: 2, max: 2});
		state.activateZodiacForm("cat");
		expect(state.getWildShapeResource().current).toBe(2);
	});
});
