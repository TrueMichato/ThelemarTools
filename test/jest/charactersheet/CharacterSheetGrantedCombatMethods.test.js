/**
 * Granted Combat Methods — features that directly grant specific combat methods.
 *
 * Covers the `grantsCombatMethods` mechanism used by the TGTT Ranger's
 * "Primal Focus Upgrade" feature, which grants the Singular Focus (Predator)
 * and Groundshatter (Prey) combat methods rather than letting the player pick
 * them. Verifies:
 *   - CharacterSheetClassUtils.resolveGrantedCombatMethods resolves UIDs,
 *     attaches requiresFocus + _grantedBy, and ignores unknown entries.
 *   - state.addFeature() resolves grants against the catalog and surfaces the
 *     granted methods via getCombatMethods().
 *   - The parent feature is classified passive (no spurious activatable).
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const SINGULAR_FOCUS = {
	name: "Singular Focus",
	source: "TGTT",
	tradition: "Unerring Hawk",
	degree: 3,
	staminaCost: 2,
	actionType: "bonus action",
	_entityType: "combatMethod",
	entries: ["Choose a creature you can see; your attacks against it ignore disadvantage."],
};

const GROUNDSHATTER = {
	name: "Groundshatter",
	source: "TGTT",
	tradition: "Arcane Knight",
	degree: 3,
	staminaCost: 3,
	actionType: "action",
	_entityType: "combatMethod",
	entries: ["Strike a surface; a 50-foot line becomes difficult terrain."],
};

const CATALOG = [SINGULAR_FOCUS, GROUNDSHATTER];

const PRIMAL_FOCUS_UPGRADE = {
	name: "Primal Focus Upgrade",
	source: "TGTT",
	className: "Ranger",
	classSource: "TGTT",
	level: 6,
	grantsCombatMethods: [
		{method: "Singular Focus|TGTT", focus: "predator"},
		{method: "Groundshatter|TGTT", focus: "prey"},
	],
};

describe("CharacterSheetClassUtils.resolveGrantedCombatMethods", () => {
	it("resolves both granted UIDs and attaches requiresFocus + _grantedBy", () => {
		const resolved = CharacterSheetClassUtils.resolveGrantedCombatMethods(PRIMAL_FOCUS_UPGRADE, CATALOG);
		expect(resolved.length).toBe(2);

		const singular = resolved.find(m => m.name === "Singular Focus");
		expect(singular).toBeDefined();
		expect(singular.requiresFocus).toBe("predator");
		expect(singular._grantedBy).toBe("Primal Focus Upgrade");
		expect(singular._entityType).toBe("combatMethod");
		expect(singular.staminaCost).toBe(2);

		const ground = resolved.find(m => m.name === "Groundshatter");
		expect(ground.requiresFocus).toBe("prey");
		expect(ground.staminaCost).toBe(3);
	});

	it("matches UID case-insensitively", () => {
		const feature = {name: "X", grantsCombatMethods: [{method: "singular focus|tgtt", focus: "predator"}]};
		const resolved = CharacterSheetClassUtils.resolveGrantedCombatMethods(feature, CATALOG);
		expect(resolved.length).toBe(1);
		expect(resolved[0].name).toBe("Singular Focus");
	});

	it("ignores unknown UIDs", () => {
		const feature = {name: "X", grantsCombatMethods: [{method: "Nonexistent Method|TGTT", focus: "prey"}]};
		expect(CharacterSheetClassUtils.resolveGrantedCombatMethods(feature, CATALOG)).toEqual([]);
	});

	it("returns [] when no catalog is provided", () => {
		expect(CharacterSheetClassUtils.resolveGrantedCombatMethods(PRIMAL_FOCUS_UPGRADE, [])).toEqual([]);
		expect(CharacterSheetClassUtils.resolveGrantedCombatMethods(PRIMAL_FOCUS_UPGRADE, null)).toEqual([]);
	});

	it("returns [] when the feature has no grantsCombatMethods", () => {
		expect(CharacterSheetClassUtils.resolveGrantedCombatMethods({name: "X"}, CATALOG)).toEqual([]);
	});

	it("supports string-only grant entries (no focus)", () => {
		const feature = {name: "X", grantsCombatMethods: ["Groundshatter|TGTT"]};
		const resolved = CharacterSheetClassUtils.resolveGrantedCombatMethods(feature, CATALOG);
		expect(resolved.length).toBe(1);
		expect(resolved[0].requiresFocus).toBeNull();
	});
});

describe("CharacterSheetState addFeature with grantsCombatMethods", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setCombatMethodCatalog(CATALOG);
	});

	it("adds the granted combat methods when the feature is added", () => {
		state.addFeature(PRIMAL_FOCUS_UPGRADE);

		const methods = state.getCombatMethods();
		const names = methods.map(m => m.name).sort();
		expect(names).toContain("Singular Focus");
		expect(names).toContain("Groundshatter");

		const singular = methods.find(m => m.name === "Singular Focus");
		expect(singular.requiresFocus).toBe("predator");
		const ground = methods.find(m => m.name === "Groundshatter");
		expect(ground.requiresFocus).toBe("prey");
	});

	it("does not duplicate granted methods when the feature is added twice", () => {
		state.addFeature(PRIMAL_FOCUS_UPGRADE);
		state.addFeature(PRIMAL_FOCUS_UPGRADE);

		const methods = state.getCombatMethods();
		expect(methods.filter(m => m.name === "Singular Focus").length).toBe(1);
		expect(methods.filter(m => m.name === "Groundshatter").length).toBe(1);
	});

	it("does not grant methods when no catalog is set", () => {
		const fresh = new CharacterSheetState();
		fresh.addFeature(PRIMAL_FOCUS_UPGRADE);
		expect(fresh.getCombatMethods()).toEqual([]);
	});

	it("classifies the parent Primal Focus Upgrade feature as passive (no spurious activatable)", () => {
		// Description still references stamina costs in prose; without the override the
		// pattern detector would surface a spurious "Activate" state.
		const feature = {
			name: "Primal Focus Upgrade",
			source: "TGTT",
			description: "You gain the Singular Focus combat method (Bonus Action, 2 Stamina Points) while in Predator focus.",
		};
		expect(CharacterSheetState.detectActivatableFeature(feature)).toBeNull();
	});
});
