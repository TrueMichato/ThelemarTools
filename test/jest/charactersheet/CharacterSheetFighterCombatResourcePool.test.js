/**
 * S3 #9/#10/#17 — Fighter limited-use abilities as real combat resources.
 *
 * Asserts REAL mechanics (not level counts):
 *  - Second Wind, Arcane Shot, and Indomitable surface in getSyntheticCombatResources()
 *    with max/current that match their canonical trackers.
 *  - The kind-routed setter (setSyntheticCombatResourceRemaining) spends/restores each
 *    pool and clamps to [0, max], staying in sync with the underlying API.
 *  - Long-rest reset restores Indomitable; pools are absent when the feature is absent.
 */

import "./setup.js";

let CharacterSheetState;
let CharacterSheetRest;
let CharacterSheetClassUtils;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetClassUtils = (await import("../../../js/charactersheet/charactersheet-class-utils.js")).CharacterSheetClassUtils;
	CharacterSheetRest = (await import("../../../js/charactersheet/charactersheet-rest.js")).CharacterSheetRest;
});

describe("Fighter combat-resource pool (synthetic)", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	function makeFighter (level, {source = "XPHB", subclass} = {}) {
		state.addClass({
			name: "Fighter",
			source,
			level,
			hitDice: "d10",
			subclass: subclass && level >= 3 ? {...subclass, source} : undefined,
		});
		// Class features are not auto-materialised on addClass in the test harness;
		// add the ones whose `uses` back the synthetic resources.
		state.addFeature({name: "Second Wind", source, className: "Fighter", level: 1, description: "<p>Second Wind.</p>"});
		state.ensureFighterFeatureUses();
		state.setAbilityBase("str", 16);
		state.setAbilityBase("dex", 18);
		state.setAbilityBase("con", 16);
		state.setAbilityBase("int", 14);
		state.setAbilityBase("wis", 12);
		state.setAbilityBase("cha", 8);
	}

	const find = (kind) => state.getSyntheticCombatResources().find(r => r.kind === kind);

	// -------------------------------------------------------------------------
	// #9 Second Wind
	// -------------------------------------------------------------------------
	describe("Second Wind", () => {
		it("appears in the synthetic pool with canonical max/remaining", () => {
			makeFighter(5);
			const res = find("secondWind");
			expect(res).toBeTruthy();
			expect(res.name).toBe("Second Wind");
			expect(res.max).toBe(state.getSecondWindUsesMax());
			expect(res.max).toBeGreaterThan(0);
			expect(res.current).toBe(state.getSecondWindUsesRemaining());
		});

		it("the kind-routed setter spends and restores, staying in sync", () => {
			makeFighter(5);
			const max = state.getSecondWindUsesMax();
			expect(state.setSyntheticCombatResourceRemaining("secondWind", max - 1)).toBe(true);
			expect(state.getSecondWindUsesRemaining()).toBe(max - 1);
			expect(find("secondWind").current).toBe(max - 1);

			// Restore back to max via the setter.
			state.setSyntheticCombatResourceRemaining("secondWind", max);
			expect(state.getSecondWindUsesRemaining()).toBe(max);
		});

		it("clamps the setter to [0, max]", () => {
			makeFighter(5);
			const max = state.getSecondWindUsesMax();
			state.setSecondWindUsesRemaining(999);
			expect(state.getSecondWindUsesRemaining()).toBe(max);
			state.setSecondWindUsesRemaining(-5);
			expect(state.getSecondWindUsesRemaining()).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// #10 Arcane Shot
	// -------------------------------------------------------------------------
	describe("Arcane Shot", () => {
		it("appears in the synthetic pool with canonical max/remaining", () => {
			makeFighter(7, {source: "TGTT", subclass: {name: "Arcane Archer", shortName: "Arcane Archer"}});
			const res = find("arcaneShot");
			expect(res).toBeTruthy();
			expect(res.name).toBe("Arcane Shot");
			expect(res.max).toBe(state.getArcaneShotMax());
			expect(res.max).toBeGreaterThan(0);
			expect(res.current).toBe(state.getArcaneShotRemaining());
		});

		it("the kind-routed setter mutates the canonical `used` counter", () => {
			makeFighter(7, {source: "TGTT", subclass: {name: "Arcane Archer", shortName: "Arcane Archer"}});
			const max = state.getArcaneShotMax();
			state.setSyntheticCombatResourceRemaining("arcaneShot", 0);
			expect(state.getArcaneShotRemaining()).toBe(0);
			expect(state.getArcaneShotUsed()).toBe(max);
			// API stability: useArcaneShot still returns false when empty.
			expect(state.useArcaneShot()).toBe(false);
			state.setSyntheticCombatResourceRemaining("arcaneShot", max);
			expect(state.getArcaneShotRemaining()).toBe(max);
		});

		it("is absent for a Fighter without the Arcane Archer subclass", () => {
			makeFighter(7);
			expect(find("arcaneShot")).toBeFalsy();
		});
	});

	// -------------------------------------------------------------------------
	// #17 Indomitable
	// -------------------------------------------------------------------------
	describe("Indomitable", () => {
		it("appears in the synthetic pool only at Fighter L9+", () => {
			makeFighter(8);
			expect(find("indomitable")).toBeFalsy();

			state = new CharacterSheetState();
			makeFighter(9);
			const res = find("indomitable");
			expect(res).toBeTruthy();
			expect(res.name).toBe("Indomitable");
			expect(res.recharge).toBe("long");
			expect(res.max).toBe(1);
			expect(res.current).toBe(1);
		});

		it("scales 1 / 2 / 3 at levels 9 / 13 / 17", () => {
			[[9, 1], [13, 2], [17, 3]].forEach(([level, expected]) => {
				state = new CharacterSheetState();
				makeFighter(level);
				expect(state.getIndomitableMax()).toBe(expected);
			});
		});

		it("the kind-routed setter spends and clamps", () => {
			makeFighter(17);
			expect(state.getIndomitableMax()).toBe(3);
			state.setSyntheticCombatResourceRemaining("indomitable", 1);
			expect(state.getIndomitableRemaining()).toBe(1);
			state.setIndomitableRemaining(999);
			expect(state.getIndomitableRemaining()).toBe(3);
			state.setIndomitableRemaining(-1);
			expect(state.getIndomitableRemaining()).toBe(0);
		});

		it("useIndomitable decrements; restoreIndomitable resets", () => {
			makeFighter(13);
			expect(state.getIndomitableRemaining()).toBe(2);
			expect(state.useIndomitable()).toBe(true);
			expect(state.getIndomitableRemaining()).toBe(1);
			expect(state.useIndomitable()).toBe(true);
			expect(state.getIndomitableRemaining()).toBe(0);
			expect(state.useIndomitable()).toBe(false);
			state.restoreIndomitable();
			expect(state.getIndomitableRemaining()).toBe(2);
		});

		it("recharges on a LONG rest only (not short)", () => {
			makeFighter(13);
			state.useIndomitable();
			expect(state.getIndomitableRemaining()).toBe(1);

			CharacterSheetRest.prototype._restoreResources.call({_state: state}, "short");
			expect(state.getIndomitableRemaining()).toBe(1);

			CharacterSheetRest.prototype._restoreResources.call({_state: state}, "long");
			expect(state.getIndomitableRemaining()).toBe(2);
		});

		it("2024 Fighter adds Fighter level to the reroll; 2014 adds nothing", () => {
			makeFighter(13, {source: "XPHB"});
			expect(state.getIndomitableRerollBonus()).toBe(13);

			state = new CharacterSheetState();
			makeFighter(13, {source: "PHB"});
			expect(state.getIndomitableRerollBonus()).toBe(0);
		});

		it("keys the reroll bonus off the Fighter CLASS source, not the subclass", () => {
			// XPHB Fighter wearing a legacy-sourced subclass still gets the 2024 bonus.
			state = new CharacterSheetState();
			state.addClass({
				name: "Fighter",
				source: "XPHB",
				level: 13,
				hitDice: "d10",
				subclass: {name: "Battle Master", shortName: "Battle Master", source: "PHB"},
			});
			expect(state.getIndomitableRerollBonus()).toBe(13);

			// PHB Fighter with a 2024-sourced subclass copy gets NO bonus.
			state = new CharacterSheetState();
			state.addClass({
				name: "Fighter",
				source: "PHB",
				level: 13,
				hitDice: "d10",
				subclass: {name: "Battle Master", shortName: "Battle Master", source: "XPHB"},
			});
			expect(state.getIndomitableRerollBonus()).toBe(0);
		});
	});

	it("unknown kind is a safe no-op", () => {
		makeFighter(9);
		expect(state.setSyntheticCombatResourceRemaining("nope", 0)).toBe(false);
	});
});
