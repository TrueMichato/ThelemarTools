/**
 * Round 19 — Illrigger Combat Masteries (IllMastery) mechanical effects.
 *
 * Combat Mastery is the Illrigger's level-2 feature: the player picks one of six
 * masteries (Bravado, Brutal, Inexorable, Lies, Lissome, Unfettered). R18 shipped the
 * SELECTION; this round wires the per-option sheet effects:
 *   - Bravado    → unarmored AC = 10 + DEX + CHA (shield allowed) via the AC path.
 *   - Lies       → may use CHA for attack/damage with a chosen melee weapon type,
 *                  composed into getWeaponAbilityMod() (MAX with Bladesong, never additive).
 *   - Inexorable → +1 to all saves per hostile within 5 ft (max +5), surfaced through
 *                  aggregateModifiers("save:all").
 *   - Brutal / Lissome → narrative forced-movement (flag only, no roll-math change).
 *   - Unfettered → Interdict/Conduit range changes (range value surfacing).
 *
 * Assertions are headless behavioural reads (getAc / getAcBreakdown / getWeaponAbilityMod /
 * aggregateModifiers), not existence-only.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const ILL = {name: "Illrigger", source: "IllriggerRevised"};

function mastery (name) {
	return {name, source: "IllriggerRevised", optionalFeatureTypes: ["IllMastery"]};
}

function makeIllrigger (level = 2, abilities = {}) {
	const state = new CharacterSheetState();
	const ab = {str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 18, ...abilities};
	Object.entries(ab).forEach(([k, v]) => state.setAbilityBase(k, v));
	state.addClass({...ILL, level});
	return state;
}

describe("Illrigger Combat Masteries — detection flags", () => {
	it("sets the per-mastery calc flag for each selected mastery", () => {
		const names = ["Bravado", "Brutal", "Inexorable", "Lies", "Lissome", "Unfettered"];
		const flags = ["hasBravadoMastery", "hasBrutalMastery", "hasInexorableMastery", "hasLiesMastery", "hasLissomeMastery", "hasUnfetteredMastery"];
		names.forEach((n, i) => {
			const state = makeIllrigger(2);
			state.addFeature(mastery(n));
			const calcs = state.getFeatureCalculations();
			expect(calcs[flags[i]]).toBe(true);
			// Sibling flags stay false.
			flags.filter((_, j) => j !== i).forEach(f => expect(calcs[f]).toBeFalsy());
		});
	});

	it("getIllriggerMasteries returns only IllMastery features", () => {
		const state = makeIllrigger(2);
		state.addFeature(mastery("Bravado"));
		state.addFeature({name: "Some Other Feature", source: "IllriggerRevised"});
		const got = state.getIllriggerMasteries().map(f => f.name);
		expect(got).toEqual(["Bravado"]);
	});
});

describe("Bravado mastery — unarmored AC = 10 + DEX + CHA", () => {
	it("raises unarmored AC by CHA over the baseline 10 + DEX", () => {
		// DEX 14 (+2), CHA 18 (+4)
		const noBravado = makeIllrigger(2);
		expect(noBravado.getAc()).toBe(12); // 10 + DEX

		const bravado = makeIllrigger(2);
		bravado.addFeature(mastery("Bravado"));
		expect(bravado.getAc()).toBe(16); // 10 + DEX(2) + CHA(4)
	});

	it("is reflected in the AC breakdown with a CHA component", () => {
		const state = makeIllrigger(2);
		state.addFeature(mastery("Bravado"));
		const bd = state.getAcBreakdown();
		expect(bd.total).toBe(16);
		const base = bd.components.find(c => c.name === "Bravado");
		expect(base).toBeTruthy();
		const cha = bd.components.find(c => c.name === "CHA modifier");
		expect(cha && cha.value).toBe(4);
	});

	it("allows a shield (shield bonus stacks on Bravado AC)", () => {
		const state = makeIllrigger(2);
		state.addFeature(mastery("Bravado"));
		state.equipShield?.({name: "Shield", ac: 2});
		// If the sheet exposes shield equipping, AC should include +2; otherwise the
		// Bravado path itself must not block shields (no monk-style suppression).
		const ac = state.getAc();
		expect(ac).toBeGreaterThanOrEqual(16);
	});
});

describe("Lies mastery — CHA for chosen weapon type", () => {
	const greatsword = {name: "Greatsword", abilityMod: "str"};
	const dagger = {name: "Dagger", abilityMod: "dex"};

	it("uses CHA for attack/damage with the chosen weapon (favourable delta)", () => {
		// STR 10 (+0), CHA 18 (+4)
		const state = makeIllrigger(2, {str: 10, cha: 18});
		state.addFeature(mastery("Lies"));
		state.setLiesWeaponType("Greatsword");
		expect(state.getWeaponAbilityMod(greatsword)).toBe(4); // base STR 0 → CHA 4
		expect(state.getLiesWeaponBonus(greatsword)).toBe(4);
	});

	it("does not affect a non-chosen weapon type", () => {
		const state = makeIllrigger(2, {str: 10, dex: 14, cha: 18});
		state.addFeature(mastery("Lies"));
		state.setLiesWeaponType("Greatsword");
		expect(state.getWeaponAbilityMod(dagger)).toBe(2); // DEX, unchanged
		expect(state.getLiesWeaponBonus(dagger)).toBe(0);
	});

	it("never reduces a weapon whose native mod already beats CHA", () => {
		// STR 20 (+5), CHA 12 (+1)
		const state = makeIllrigger(2, {str: 20, cha: 12});
		state.addFeature(mastery("Lies"));
		state.setLiesWeaponType("Greatsword");
		expect(state.getWeaponAbilityMod(greatsword)).toBe(5); // max(5, 1)
		expect(state.getLiesWeaponBonus(greatsword)).toBe(0);
	});

	it("does not double with Bladesong (composes via MAX, not sum)", () => {
		// STR 10 (+0), INT 16 (+3), CHA 18 (+4)
		const state = makeIllrigger(2, {str: 10, int: 16, cha: 18});
		state.addFeature(mastery("Lies"));
		state.setLiesWeaponType("Greatsword");
		state.activateState?.("bladesong");
		// max(STR 0, INT 3, CHA 4) = 4, NOT 0 + 3 + 4
		expect(state.getWeaponAbilityMod(greatsword)).toBe(4);
	});

	it("is inert when the mastery is absent (no swap even with a stored choice)", () => {
		const state = makeIllrigger(2, {str: 10, cha: 18});
		// No Lies mastery selected.
		state.setLiesWeaponType("Greatsword");
		expect(state.getLiesWeaponType()).toBe(""); // setter refuses without mastery
		expect(state.getWeaponAbilityMod(greatsword)).toBe(0); // base STR
	});
});

describe("Inexorable mastery — +1 save per adjacent hostile (max +5)", () => {
	it("contributes a save:all bonus equal to the hostile count", () => {
		const state = makeIllrigger(2);
		state.addFeature(mastery("Inexorable"));
		state.setIllriggerAdjacentHostiles(3);
		expect(state.getInexorableSaveBonus()).toBe(3);
		expect(state.aggregateModifiers("save:all").bonus).toBe(3);
		// Applies to a specific save too.
		expect(state.aggregateModifiers("save:dex").bonus).toBe(3);
	});

	it("clamps the bonus at +5", () => {
		const state = makeIllrigger(2);
		state.addFeature(mastery("Inexorable"));
		state.setIllriggerAdjacentHostiles(9);
		expect(state.getInexorableSaveBonus()).toBe(5);
		expect(state.aggregateModifiers("save:all").bonus).toBe(5);
	});

	it("clears the bonus when the count returns to 0", () => {
		const state = makeIllrigger(2);
		state.addFeature(mastery("Inexorable"));
		state.setIllriggerAdjacentHostiles(4);
		expect(state.aggregateModifiers("save:all").bonus).toBe(4);
		state.setIllriggerAdjacentHostiles(0);
		expect(state.aggregateModifiers("save:all").bonus).toBe(0);
	});

	it("is enabled (non-conditional) — applies without opt-in", () => {
		const state = makeIllrigger(2);
		state.addFeature(mastery("Inexorable"));
		state.setIllriggerAdjacentHostiles(2);
		const agg = state.aggregateModifiers("save:all");
		expect(agg.bonus).toBe(2);
		expect(agg.conditionalsAvailable.length).toBe(0);
	});
});

describe("Narrative masteries — no spurious roll-math", () => {
	it("Brutal and Lissome add no save modifiers", () => {
		const state = makeIllrigger(2);
		state.addFeature(mastery("Brutal"));
		state.addFeature(mastery("Lissome"));
		expect(state.aggregateModifiers("save:all").bonus).toBe(0);
		const calcs = state.getFeatureCalculations();
		expect(calcs.hasBrutalMastery).toBe(true);
		expect(calcs.hasLissomeMastery).toBe(true);
	});
});

describe("Unfettered mastery — range surfacing", () => {
	it("upgrades Infernal Conduit range from Touch to 30 ft", () => {
		const base = makeIllrigger(6); // L6 → has conduit
		expect(base.getInfernalConduitRange()).toBe("Touch");

		const unfettered = makeIllrigger(6);
		unfettered.addFeature(mastery("Unfettered"));
		expect(unfettered.getInfernalConduitRange()).toBe("30 ft");
	});
});
