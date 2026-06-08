/**
 * Character Sheet — TGTT Ranger Primal Focus (round 2)
 *
 * Covers the Primal Focus bug group:
 *  1. getPrimalFocusModeAbilities — declarative mode-ability catalog, gated by the
 *     unlocked upgrade flags (levels 6/10/14), pure UI metadata.
 *  2. Level-6 combat-method grant lifecycle through reconcileGrantedCombatMethods:
 *     - both catalogs ready → Singular Focus + Groundshatter granted, tagged
 *       _autoGranted + requiresFocus (predator/prey)
 *     - old save missing grantsCombatMethods → re-hydrated from the class-feature catalog
 *     - granter removed (level-down) → ONLY auto-granted methods torn down
 *     - a manually-learned method of the same name is preserved through teardown
 *     - reconciliation is idempotent (no duplicates)
 *
 * Assertions check actual state / helper output, not level counts.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

function buildTgttRanger (level, {wis = 16, subclass = "Hunter"} = {}) {
	const s = new CharacterSheetState();
	s.setRace({name: "Human", source: "PHB"});
	s.addClass({name: "Ranger", source: "TGTT", level, subclass: level >= 3 ? {name: subclass} : undefined});
	s.setAbilityBase("str", 14);
	s.setAbilityBase("dex", 16);
	s.setAbilityBase("con", 14);
	s.setAbilityBase("int", 10);
	s.setAbilityBase("wis", wis);
	s.setAbilityBase("cha", 10);
	return s;
}

const PRIMAL_FOCUS_UPGRADE_L6 = {
	name: "Primal Focus Upgrade",
	className: "Ranger",
	classSource: "TGTT",
	level: 6,
	source: "TGTT",
	grantsCombatMethods: [
		{method: "Singular Focus|TGTT", focus: "predator"},
		{method: "Groundshatter|TGTT", focus: "prey"},
	],
};

const COMBAT_METHOD_CATALOG = [
	{name: "Singular Focus", source: "TGTT", _entityType: "combatMethod", degree: 2, staminaCost: 2, actionType: "Bonus Action", tradition: "Predator's Pursuit", entries: ["Lock onto a single foe."]},
	{name: "Groundshatter", source: "TGTT", _entityType: "combatMethod", degree: 2, staminaCost: 2, actionType: "Action", tradition: "Bulwark", entries: ["Shatter the ground around you."]},
];

function methodsNamed (s, name) {
	return s._data.features.filter(f => (f.name || "").toLowerCase() === name.toLowerCase());
}

// ==========================================================================
// PART 1: getPrimalFocusModeAbilities helper (declarative, gated)
// ==========================================================================
describe("getPrimalFocusModeAbilities — mode-gated ability catalog", () => {
	it("predator base (no upgrades) exposes Focused Quarry (usable) + Hunter's Insight (passive), no upgrade abilities", () => {
		const abilities = CharacterSheetClassUtils.getPrimalFocusModeAbilities("predator", {});
		const names = abilities.map(a => a.name);
		expect(names).toContain("Focused Quarry");
		expect(names).toContain("Hunter's Insight");
		expect(names).not.toContain("Singular Focus");
		expect(names).not.toContain("Predator Eye");

		const fq = abilities.find(a => a.name === "Focused Quarry");
		expect(fq.kind).toBe("usable");
		expect(fq.actionType).toBe("bonus");
		const hi = abilities.find(a => a.name === "Hunter's Insight");
		expect(hi.kind).toBe("passive");
	});

	it("predator upgrade1 (level 6) unlocks Singular Focus method + Pursuit/Intimidating Foe/Predator Eye", () => {
		const abilities = CharacterSheetClassUtils.getPrimalFocusModeAbilities("predator", {upgrade1: true});
		const names = abilities.map(a => a.name);
		expect(names).toContain("Singular Focus");
		expect(names).toContain("Pursuit");
		expect(names).toContain("Intimidating Foe");
		expect(names).toContain("Predator Eye");

		const sf = abilities.find(a => a.name === "Singular Focus");
		expect(sf.kind).toBe("method");
		const pe = abilities.find(a => a.name === "Predator Eye");
		expect(pe.kind).toBe("usable");
		expect(pe.actionType).toBe("bonus");
	});

	it("prey base exposes Hunter's Dodge (reaction); upgrade1 unlocks Groundshatter + Terrain Defense + Improvised Sanctuary", () => {
		const base = CharacterSheetClassUtils.getPrimalFocusModeAbilities("prey", {});
		const baseNames = base.map(a => a.name);
		expect(baseNames).toContain("Hunter's Dodge");
		expect(baseNames).not.toContain("Groundshatter");
		const hd = base.find(a => a.name === "Hunter's Dodge");
		expect(hd.kind).toBe("usable");
		expect(hd.actionType).toBe("reaction");

		const up = CharacterSheetClassUtils.getPrimalFocusModeAbilities("prey", {upgrade1: true});
		const upNames = up.map(a => a.name);
		expect(upNames).toContain("Groundshatter");
		expect(upNames).toContain("Terrain Defense");
		expect(upNames).toContain("Improvised Sanctuary");
		const is = up.find(a => a.name === "Improvised Sanctuary");
		expect(is.kind).toBe("usable");
		expect(is.actionType).toBe("action");
	});

	it("upgrade3 (level 14) adds Blood Scent (predator) / Inescapable Sight (prey)", () => {
		const pred = CharacterSheetClassUtils.getPrimalFocusModeAbilities("predator", {upgrade1: true, upgrade2: true, upgrade3: true});
		expect(pred.map(a => a.name)).toContain("Blood Scent");

		const prey = CharacterSheetClassUtils.getPrimalFocusModeAbilities("prey", {upgrade1: true, upgrade2: true, upgrade3: true});
		const is = prey.find(a => a.name === "Inescapable Sight");
		expect(is).toBeTruthy();
		expect(is.actionType).toBe("bonus");
	});

	it("UI gating: a non-TGTT Ranger has no Primal Focus, so the panel never renders these abilities", () => {
		const s = new CharacterSheetState();
		s.setRace({name: "Human", source: "PHB"});
		s.addClass({name: "Ranger", source: "PHB", level: 6, subclass: {name: "Hunter"}});
		const calc = s.getFeatureCalculations();
		expect(calc.hasPrimalFocus).toBeFalsy();
	});
});

// ==========================================================================
// PART 1b: reminder classification (BUG #11 — methods + applied-elsewhere are
// filtered out of the at-a-glance reminder surfaces generically, by kind/flag)
// ==========================================================================
describe("isPrimalFocusReminderAbility — generic reminder classification", () => {
	it("excludes combat methods (kind: method) — they live in the Combat Methods section", () => {
		expect(CharacterSheetClassUtils.isPrimalFocusReminderAbility({name: "Singular Focus", kind: "method"})).toBe(false);
		expect(CharacterSheetClassUtils.isPrimalFocusReminderAbility({name: "Groundshatter", kind: "method"})).toBe(false);
	});

	it("excludes applied-elsewhere passives (their whole effect is already applied/shown)", () => {
		expect(CharacterSheetClassUtils.isPrimalFocusReminderAbility({name: "Pursuit", kind: "passive", appliedElsewhere: true})).toBe(false);
	});

	it("includes genuine usable controls and watch-for passives", () => {
		expect(CharacterSheetClassUtils.isPrimalFocusReminderAbility({name: "Focused Quarry", kind: "usable", actionType: "bonus"})).toBe(true);
		expect(CharacterSheetClassUtils.isPrimalFocusReminderAbility({name: "Hunter's Insight", kind: "passive"})).toBe(true);
		expect(CharacterSheetClassUtils.isPrimalFocusReminderAbility({name: "Hunter's Dodge", kind: "usable", actionType: "reaction"})).toBe(true);
	});

	it("is a positive whitelist — null / unknown future kinds are excluded by default", () => {
		expect(CharacterSheetClassUtils.isPrimalFocusReminderAbility(null)).toBe(false);
		expect(CharacterSheetClassUtils.isPrimalFocusReminderAbility(undefined)).toBe(false);
		expect(CharacterSheetClassUtils.isPrimalFocusReminderAbility({name: "X", kind: "resource"})).toBe(false);
	});

	it("Pursuit is tagged appliedElsewhere in the catalog (its +10 ft is a real speed modifier)", () => {
		const predator = CharacterSheetClassUtils.getPrimalFocusModeAbilities("predator", {upgrade1: true});
		const pursuit = predator.find(a => a.name === "Pursuit");
		expect(pursuit).toBeTruthy();
		expect(pursuit.kind).toBe("passive");
		expect(pursuit.appliedElsewhere).toBe(true);
	});

	it("filtering the predator catalog drops Singular Focus + Pursuit but keeps usables/passives", () => {
		const filtered = CharacterSheetClassUtils.getPrimalFocusModeAbilities("predator", {upgrade1: true})
			.filter(a => CharacterSheetClassUtils.isPrimalFocusReminderAbility(a));
		const names = filtered.map(a => a.name);
		expect(names).not.toContain("Singular Focus"); // method
		expect(names).not.toContain("Pursuit"); // applied elsewhere
		expect(names).toContain("Focused Quarry");
		expect(names).toContain("Hunter's Insight");
		expect(names).toContain("Intimidating Foe");
		expect(names).toContain("Predator Eye");
	});

	it("filtering the prey catalog drops Groundshatter but keeps Hunter's Dodge + Terrain Defense", () => {
		const filtered = CharacterSheetClassUtils.getPrimalFocusModeAbilities("prey", {upgrade1: true})
			.filter(a => CharacterSheetClassUtils.isPrimalFocusReminderAbility(a));
		const names = filtered.map(a => a.name);
		expect(names).not.toContain("Groundshatter"); // method
		expect(names).toContain("Hunter's Dodge");
		expect(names).toContain("Terrain Defense");
		expect(names).toContain("Improvised Sanctuary");
	});
});

// ==========================================================================
// PART 2: Level-6 combat-method grant lifecycle
// ==========================================================================
describe("reconcileGrantedCombatMethods — Primal Focus Upgrade lifecycle", () => {
	it("grants Singular Focus + Groundshatter, tagged _autoGranted + requiresFocus, when both catalogs are ready", () => {
		const s = buildTgttRanger(6);
		s.addFeature({...PRIMAL_FOCUS_UPGRADE_L6});
		s.setCombatMethodCatalog(COMBAT_METHOD_CATALOG);
		s.reconcileGrantedCombatMethods();

		const sf = methodsNamed(s, "Singular Focus");
		const gs = methodsNamed(s, "Groundshatter");
		expect(sf).toHaveLength(1);
		expect(gs).toHaveLength(1);
		expect(sf[0]._autoGranted).toBe(true);
		expect(sf[0].requiresFocus).toBe("predator");
		expect(gs[0]._autoGranted).toBe(true);
		expect(gs[0].requiresFocus).toBe("prey");
		expect(sf[0]._grantedByFeatureUid).toBe("Primal Focus Upgrade|Ranger|TGTT|6|TGTT");
		// Real combat-method fields survive the grant pipeline (not just name/source).
		expect(sf[0].degree).toBe(2);
		expect(sf[0].staminaCost).toBe(2);
		expect(sf[0].actionType).toBe("Bonus Action");
		expect(sf[0].tradition).toBe("Predator's Pursuit");
		expect(sf[0].entries).toEqual(["Lock onto a single foe."]);
	});

	it("no-ops gracefully until the combat-method catalog is set", () => {
		const s = buildTgttRanger(6);
		s.addFeature({...PRIMAL_FOCUS_UPGRADE_L6});
		s.reconcileGrantedCombatMethods(); // catalog not set yet
		expect(methodsNamed(s, "Singular Focus")).toHaveLength(0);

		s.setCombatMethodCatalog(COMBAT_METHOD_CATALOG);
		s.reconcileGrantedCombatMethods();
		expect(methodsNamed(s, "Singular Focus")).toHaveLength(1);
	});

	it("re-hydrates grantsCombatMethods from the class-feature catalog for an old save that dropped the field", () => {
		const s = buildTgttRanger(6);
		// Old save: feature stored WITHOUT grantsCombatMethods.
		const {grantsCombatMethods, ...legacyFeature} = PRIMAL_FOCUS_UPGRADE_L6;
		s.addFeature(legacyFeature);
		s.setClassFeatureCatalog([{...PRIMAL_FOCUS_UPGRADE_L6}], []);
		s.setCombatMethodCatalog(COMBAT_METHOD_CATALOG);
		s.reconcileGrantedCombatMethods();

		expect(methodsNamed(s, "Singular Focus")).toHaveLength(1);
		expect(methodsNamed(s, "Groundshatter")).toHaveLength(1);
		// The stored feature should be re-hydrated in place.
		const stored = s._data.features.find(f => f.name === "Primal Focus Upgrade");
		expect(Array.isArray(stored.grantsCombatMethods)).toBe(true);
		expect(stored.grantsCombatMethods).toHaveLength(2);
	});

	it("tears down ONLY auto-granted methods when the granting feature is removed (level-down)", () => {
		const s = buildTgttRanger(6);
		s.addFeature({...PRIMAL_FOCUS_UPGRADE_L6});
		s.setCombatMethodCatalog(COMBAT_METHOD_CATALOG);
		s.reconcileGrantedCombatMethods();
		expect(methodsNamed(s, "Singular Focus")).toHaveLength(1);

		// Simulate dropping below level 6: granting feature is gone.
		const granter = s._data.features.find(f => f.name === "Primal Focus Upgrade");
		s.removeFeature(granter.id);
		s.reconcileGrantedCombatMethods();

		expect(methodsNamed(s, "Singular Focus")).toHaveLength(0);
		expect(methodsNamed(s, "Groundshatter")).toHaveLength(0);
	});

	it("preserves a manually-learned method of the same name through teardown", () => {
		const s = buildTgttRanger(6);
		// Player manually learned Singular Focus (no _autoGranted ownership tag).
		s.addFeature({name: "Singular Focus", source: "TGTT", _entityType: "combatMethod"});
		s.addFeature({...PRIMAL_FOCUS_UPGRADE_L6});
		s.setCombatMethodCatalog(COMBAT_METHOD_CATALOG);
		s.reconcileGrantedCombatMethods();

		// Still exactly one Singular Focus, and it's the manual one (no auto tag).
		let sf = methodsNamed(s, "Singular Focus");
		expect(sf).toHaveLength(1);
		expect(sf[0]._autoGranted).toBeFalsy();
		// Groundshatter was auto-granted.
		expect(methodsNamed(s, "Groundshatter")).toHaveLength(1);

		// Remove granter → auto Groundshatter torn down, manual Singular Focus preserved.
		const granter = s._data.features.find(f => f.name === "Primal Focus Upgrade");
		s.removeFeature(granter.id);
		s.reconcileGrantedCombatMethods();

		sf = methodsNamed(s, "Singular Focus");
		expect(sf).toHaveLength(1);
		expect(sf[0]._autoGranted).toBeFalsy();
		expect(methodsNamed(s, "Groundshatter")).toHaveLength(0);
	});

	it("is idempotent — repeated reconciliation never duplicates granted methods", () => {
		const s = buildTgttRanger(6);
		s.addFeature({...PRIMAL_FOCUS_UPGRADE_L6});
		s.setCombatMethodCatalog(COMBAT_METHOD_CATALOG);
		s.reconcileGrantedCombatMethods();
		s.reconcileGrantedCombatMethods();
		s.reconcileGrantedCombatMethods();

		expect(methodsNamed(s, "Singular Focus")).toHaveLength(1);
		expect(methodsNamed(s, "Groundshatter")).toHaveLength(1);
	});

	it("preserves a method that was auto-granted FIRST and then manually learned, through teardown", () => {
		const s = buildTgttRanger(6);
		s.addFeature({...PRIMAL_FOCUS_UPGRADE_L6});
		s.setCombatMethodCatalog(COMBAT_METHOD_CATALOG);
		s.reconcileGrantedCombatMethods();
		// Auto-granted now exists. Player then manually learns the same method.
		s.addFeature({name: "Singular Focus", source: "TGTT", _entityType: "combatMethod"});
		const sf = methodsNamed(s, "Singular Focus");
		expect(sf).toHaveLength(1);
		expect(sf[0]._manualGranted).toBe(true); // co-owned now

		// Remove the granter → co-owned Singular Focus survives, pure-auto Groundshatter removed.
		const granter = s._data.features.find(f => f.name === "Primal Focus Upgrade");
		s.removeFeature(granter.id);
		s.reconcileGrantedCombatMethods();
		expect(methodsNamed(s, "Singular Focus")).toHaveLength(1);
		expect(methodsNamed(s, "Groundshatter")).toHaveLength(0);
	});

	it("removes a stale auto-granted method when the granter's grants list changes (content migration)", () => {
		const s = buildTgttRanger(6);
		s.addFeature({...PRIMAL_FOCUS_UPGRADE_L6});
		s.setCombatMethodCatalog(COMBAT_METHOD_CATALOG);
		s.reconcileGrantedCombatMethods();
		expect(methodsNamed(s, "Groundshatter")).toHaveLength(1);

		// The granter still exists, but now only grants Singular Focus.
		const granter = s._data.features.find(f => f.name === "Primal Focus Upgrade");
		granter.grantsCombatMethods = [{method: "Singular Focus|TGTT", focus: "predator"}];
		s.reconcileGrantedCombatMethods();

		expect(methodsNamed(s, "Singular Focus")).toHaveLength(1);
		expect(methodsNamed(s, "Groundshatter")).toHaveLength(0);
	});

	it("isCombatMethodFocusBlocked gates by the active focus (and ignores unfocused methods)", () => {
		const s = buildTgttRanger(6);
		s.addFeature({...PRIMAL_FOCUS_UPGRADE_L6});
		s.setCombatMethodCatalog(COMBAT_METHOD_CATALOG);
		s.reconcileGrantedCombatMethods();
		const singularFocus = methodsNamed(s, "Singular Focus")[0]; // requiresFocus predator
		const groundshatter = methodsNamed(s, "Groundshatter")[0]; // requiresFocus prey

		s.setPrimalFocusMode("predator");
		expect(s.isCombatMethodFocusBlocked(singularFocus)).toBe(false);
		expect(s.isCombatMethodFocusBlocked(groundshatter)).toBe(true);

		s.setPrimalFocusMode("prey");
		expect(s.isCombatMethodFocusBlocked(singularFocus)).toBe(true);
		expect(s.isCombatMethodFocusBlocked(groundshatter)).toBe(false);

		// A method with no focus requirement is never blocked.
		expect(s.isCombatMethodFocusBlocked({name: "Generic", requiresFocus: null})).toBe(false);
	});
});
