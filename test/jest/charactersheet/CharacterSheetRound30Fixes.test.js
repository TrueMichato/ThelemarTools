/**
 * Round 30 — Character Sheet bug-fix regressions.
 *
 * Asserts REAL mechanics, not existence:
 *
 *  #2  Last Ditch Evasion (and all Battle Tactics) are NEVER surfaced as generic
 *      active-state toggles — they render only in the dedicated battle-tactics combat
 *      section (LDE is a one-shot reaction that avoids all damage + applies Slowed).
 *
 *  #5  The Combat Methods cap (`_getCharacterMaxMethods`) adds the subclass-granted bonus
 *      method count (e.g. Arcane Archer's Biting Zephyr = +1) on top of the class
 *      progression.
 *
 *  #10 Armor upgrades grant roll bonuses: Form Fitted = flat +3 Acrobatics (always-on
 *      while worn); Camouflaged = gated Stealth advantage (per-roll opt-in).
 *
 *  #13 TGTT Fighter's Indomitable adds the Fighter level to the reroll (the homebrew is
 *      built on the 2024 ruleset), and uses progress 1 / 2 / 3 at Fighter level 9 / 13 / 17.
 *
 *  #14 Doubleshot's pending weapon-die rider is resolved for a ranged weapon attack that
 *      carries only `isMelee:false` + a thrown/ranged `range` (no explicit `isRanged`),
 *      which is how stored auto-attacks are shaped — the previous `attack.isRanged` gate
 *      silently skipped them.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetUpgrades = globalThis.CharacterSheetUpgrades;

// =========================================================================================
// #2 — Battle Tactics are not generic active-states
// =========================================================================================
describe("#2 Last Ditch Evasion / Battle Tactics are not active-state toggles", () => {
	const LDE = {
		name: "Last Ditch Evasion",
		source: "TGTT",
		featureType: "Optional Feature",
		optionalFeatureTypes: ["BT"],
		description: "When you're hit by an attack, you can use your reaction to take no damage. You become Slowed until the end of your next turn.",
	};

	it("isBattleTactic recognises a BT optional feature", () => {
		expect(CharacterSheetClassUtils.isBattleTactic(LDE)).toBe(true);
		expect(CharacterSheetClassUtils.isBattleTactic({optionalFeatureTypes: ["EI"]})).toBe(false);
		expect(CharacterSheetClassUtils.isBattleTactic({featureType: ["BT"]})).toBe(true);
		expect(CharacterSheetClassUtils.isBattleTactic(null)).toBe(false);
	});

	it("a Battle Tactic never appears in the generic Available-to-Activate list", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 5});
		state.addFeature(LDE);
		const activatables = state.getActivatableFeatures();
		expect(activatables.some(a => /last ditch evasion/i.test(a.feature?.name || a.name || ""))).toBe(false);
	});

	it("applyLastDitchEvasion avoids ALL damage and applies the Slowed condition", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 5});
		state.addFeature(LDE);
		const res = state.applyLastDitchEvasion({damage: 18});
		expect(res.applied).toBe(true);
		expect(res.reduced).toBe(0); // avoid all damage
		expect(res.slowedApplied).toBe(true);
		// A Slowed condition (possibly the Thelemar variant) is now present.
		expect((state.getConditions() || []).length).toBeGreaterThan(0);
	});
});

// =========================================================================================
// #5 — Subclass bonus methods count toward the cap
// =========================================================================================
describe("#5 Combat Methods cap includes subclass bonus methods", () => {
	function makeCombat (state, classData) {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {getClasses: () => [classData]};
		return combat;
	}

	const FIGHTER_CLASS_DATA = {
		name: "Fighter",
		source: "TGTT",
		optionalfeatureProgression: [
			{
				name: "Combat Methods",
				featureType: ["CTM:AM"],
				progression: {3: 2, 7: 3, 10: 4, 15: 5, 18: 6},
			},
		],
	};

	it("getSubclassBonusMethodCount returns +1 for Arcane Archer", () => {
		const subclass = {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"};
		expect(CharacterSheetClassUtils.getSubclassBonusMethodCount(subclass, "TGTT")).toBe(1);
	});

	it("_getCharacterMaxMethods adds the Arcane Archer bonus on top of the progression", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 7});
		state.setSubclass("Fighter", {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"});

		const combat = makeCombat(state, FIGHTER_CLASS_DATA);
		// Progression at level 7 = 3, plus Arcane Archer's Biting Zephyr bonus = +1 → 4.
		expect(combat._getCharacterMaxMethods()).toBe(4);
	});

	it("a subclass with no bonus methods does not inflate the cap", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 7});
		// No subclass set.
		const combat = makeCombat(state, FIGHTER_CLASS_DATA);
		expect(combat._getCharacterMaxMethods()).toBe(3);
	});
});

// =========================================================================================
// #10 — Armor upgrade roll bonuses (Form Fitted, Camouflaged)
// =========================================================================================
describe("#10 Armor upgrades grant roll bonuses", () => {
	it("getArmorUpgradeEffects flags Form Fitted and Camouflaged", () => {
		const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
			appliedUpgrades: [{name: "Form Fitted"}, {name: "Camouflaged"}],
		});
		expect(effects.formFitted).toBe(true);
		expect(effects.camouflaged).toBe(true);
	});

	function buildArmoredState () {
		const state = new CharacterSheetState();
		state.addClass({name: "Rogue", source: "XPHB", level: 5});
		state._data.inventory = [{
			equipped: true,
			item: {
				name: "Leather Armor",
				armor: true,
				appliedUpgrades: [{name: "Form Fitted"}, {name: "Camouflaged"}],
			},
		}];
		state._recalculateItemUpgradeModifiers();
		return state;
	}

	it("Form Fitted registers a flat, always-on +3 Acrobatics named modifier", () => {
		const state = buildArmoredState();
		const ff = (state._data.namedModifiers || []).find(m => m.name === "Form Fitted");
		expect(ff).toBeTruthy();
		expect(ff.type).toBe("skill:acrobatics");
		expect(ff.value).toBe(3);
		expect(ff.enabled).toBe(true);
		expect(ff.conditional).toBeUndefined(); // always-on, not gated
		expect(ff.sourceType).toBe("itemUpgrade");
	});

	it("the +3 flows into the Acrobatics skill breakdown", () => {
		const state = buildArmoredState();
		const comps = state._getSkillNamedModifierComponents("acrobatics");
		expect(comps.some(c => c.name === "Form Fitted" && c.value === 3)).toBe(true);
	});

	it("Camouflaged registers a GATED (default-off) Stealth advantage modifier", () => {
		const state = buildArmoredState();
		const cam = (state._data.namedModifiers || []).find(m => m.name === "Camouflaged");
		expect(cam).toBeTruthy();
		expect(cam.type).toBe("skill:stealth");
		expect(cam.advantage).toBe(true);
		expect(cam.value).toBe(0);
		expect(typeof cam.conditional).toBe("string"); // gated by terrain condition
		expect(cam.sourceType).toBe("itemUpgrade");
	});

	it("removing the armor strips the upgrade modifiers (idempotent)", () => {
		const state = buildArmoredState();
		state._data.inventory = [];
		state._recalculateItemUpgradeModifiers();
		expect((state._data.namedModifiers || []).some(m => m.sourceType === "itemUpgrade")).toBe(false);
	});
});

// =========================================================================================
// #13 — Indomitable reroll bonus + uses progression
// =========================================================================================
describe("#13 Indomitable (TGTT)", () => {
	function buildFighter (level) {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level});
		return state;
	}

	it("uses scale 1 / 2 / 3 at Fighter level 9 / 13 / 17", () => {
		expect(buildFighter(9).getIndomitableMax()).toBe(1);
		expect(buildFighter(12).getIndomitableMax()).toBe(1); // still 1 BELOW 13
		expect(buildFighter(13).getIndomitableMax()).toBe(2);
		expect(buildFighter(17).getIndomitableMax()).toBe(3);
	});

	it("adds the Fighter level to the reroll for a TGTT Fighter", () => {
		const state = buildFighter(13);
		// TGTT is built on the 2024 ruleset → reroll adds the Fighter level (13).
		expect(state.getIndomitableRerollBonus()).toBe(13);
	});

	it("a classic (PHB) Fighter gets no reroll bonus", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 13});
		expect(state.getIndomitableRerollBonus()).toBe(0);
	});
});

// =========================================================================================
// #14 — Doubleshot consumes for ranged attacks lacking an explicit isRanged flag
// =========================================================================================
describe("#14 Doubleshot resolves for stored ranged auto-attacks", () => {
	function makeCombat () {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._page = {};
		return combat;
	}

	it("resolves a die for a ranged weapon attack carrying only isMelee:false + range", () => {
		const combat = makeCombat();
		combat._pendingDoubleshot = {name: "Doubleshot"};
		// Shape of a stored auto-attack for a shortbow: no `isRanged`, has `isMelee:false` + range.
		const attack = {isMelee: false, isSpell: false, range: "80/320 ft.", damage: "1d6+3"};
		expect(combat._consumePendingWeaponDamageDie(attack)).toBe("1d6");
		// One-shot: consumed.
		expect(combat._consumePendingWeaponDamageDie(attack)).toBeNull();
	});

	it("does NOT resolve for a melee weapon attack", () => {
		const combat = makeCombat();
		combat._pendingDoubleshot = {name: "Doubleshot"};
		const attack = {isMelee: true, isSpell: false, range: "5 ft.", damage: "1d8"};
		expect(combat._consumePendingWeaponDamageDie(attack)).toBeNull();
	});

	it("the damage-pipeline gate (_isMeleeWeaponAttack) treats a ranged auto-attack as non-melee", () => {
		const combat = makeCombat();
		// Stored shortbow auto-attack: no isRanged, range carries a "/" long/short band.
		expect(combat._isMeleeWeaponAttack({isMelee: false, isSpell: false, range: "80/320 ft."})).toBe(false);
		// A melee longsword auto-attack stays melee → Doubleshot gate excludes it.
		expect(combat._isMeleeWeaponAttack({isMelee: true, isSpell: false, range: "5 ft."})).toBe(true);
		// A spell attack is never a melee-weapon attack (and is separately excluded by !isSpell).
		expect(combat._isMeleeWeaponAttack({isSpell: true, range: "120 ft."})).toBe(false);
	});
});
