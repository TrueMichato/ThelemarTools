/**
 * Combat — generic post-attack hook pipeline (#7) + Flanking modifier (#12).
 *
 * Asserts REAL mechanics on the combat `_rollAttack` extension points I own:
 *  - `_getPostAttackHooks` / `_runPostAttackHooks`: generic dispatcher, predicate
 *    gating, ranged-only Arcane Shot hook, error isolation.
 *  - `_isArcaneArcherWeapon`: bows qualify, crossbows excluded.
 *  - `_extractArcaneShotDamage`: parses the option's own {@damage}/{@dice} + type.
 *  - `_applyArcaneShot`: spends exactly one Arcane Shot use; control shots (no
 *    damage) still resolve without spending twice.
 *  - Flanking `_getCombatLocalAttackBonus` / `_isStrictMelee`: +2 on melee only,
 *    never on ranged, gated by the toggle.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;

function makeCombat (stateOverrides = {}) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._flankingEnabled = false;
	combat._state = {
		hasArcaneShot: () => false,
		getArcaneShotRemaining: () => 0,
		getKnownArcaneShots: () => [],
		useArcaneShot: () => false,
		getFeatureCalculations: () => ({}),
		...stateOverrides,
	};
	combat._page = {
		saveCharacter: () => {},
		renderCharacter: () => {},
		showDiceResult: () => {},
	};
	// `_applyArcaneShot` refreshes the Combat Resources panel (Arcane Shot was
	// folded in there), which touches the DOM; stub it out in the node test
	// environment (no jsdom). The legacy shim is also stubbed for safety.
	combat.renderCombatResources = () => {};
	combat.renderCombatArcaneArcher = () => {};
	return combat;
}

describe("_isArcaneArcherWeapon", () => {
	let combat;
	beforeEach(() => { combat = makeCombat(); });

	it("accepts a shortbow / longbow", () => {
		expect(combat._isArcaneArcherWeapon({name: "Longbow"})).toBe(true);
		expect(combat._isArcaneArcherWeapon({name: "Shortbow"})).toBe(true);
	});

	it("accepts a homebrew-named bow via sourceItem", () => {
		expect(combat._isArcaneArcherWeapon({name: "Starfall", sourceItem: {baseItem: "longbow"}})).toBe(true);
	});

	it("rejects crossbows", () => {
		expect(combat._isArcaneArcherWeapon({name: "Heavy Crossbow"})).toBe(false);
		expect(combat._isArcaneArcherWeapon({name: "Hand Crossbow"})).toBe(false);
	});

	it("rejects non-bow weapons and spells", () => {
		expect(combat._isArcaneArcherWeapon({name: "Longsword"})).toBe(false);
		expect(combat._isArcaneArcherWeapon({name: "Fire Bolt", isSpell: true})).toBe(false);
		expect(combat._isArcaneArcherWeapon(null)).toBe(false);
	});
});

describe("_getPostAttackHooks — Arcane Shot predicate gating", () => {
	const bow = {name: "Longbow", isRanged: true};

	function predicateFor (combat) {
		return combat._getPostAttackHooks().find(h => h.id === "arcaneShot").predicate;
	}

	it("fires for a ranged bow attack with uses + known shots", () => {
		const combat = makeCombat({
			hasArcaneShot: () => true,
			getArcaneShotRemaining: () => 2,
			getKnownArcaneShots: () => [{name: "Grasping Arrow", source: "XGE"}],
		});
		const predicate = predicateFor(combat);
		expect(predicate({isRanged: true, attack: bow})).toBe(true);
	});

	it("does NOT fire on a melee attack", () => {
		const combat = makeCombat({
			hasArcaneShot: () => true,
			getArcaneShotRemaining: () => 2,
			getKnownArcaneShots: () => [{name: "Grasping Arrow", source: "XGE"}],
		});
		const predicate = predicateFor(combat);
		expect(predicate({isRanged: false, attack: {name: "Longsword", isMelee: true}})).toBe(false);
	});

	it("does NOT fire when no uses remain", () => {
		const combat = makeCombat({
			hasArcaneShot: () => true,
			getArcaneShotRemaining: () => 0,
			getKnownArcaneShots: () => [{name: "Grasping Arrow", source: "XGE"}],
		});
		expect(predicateFor(combat)({isRanged: true, attack: bow})).toBe(false);
	});

	it("does NOT fire when no shots are known", () => {
		const combat = makeCombat({
			hasArcaneShot: () => true,
			getArcaneShotRemaining: () => 2,
			getKnownArcaneShots: () => [],
		});
		expect(predicateFor(combat)({isRanged: true, attack: bow})).toBe(false);
	});

	it("does NOT fire for a non-Arcane-Archer character", () => {
		const combat = makeCombat({hasArcaneShot: () => false, getArcaneShotRemaining: () => 2});
		expect(predicateFor(combat)({isRanged: true, attack: bow})).toBe(false);
	});

	it("does NOT fire with a ranged crossbow (wrong weapon)", () => {
		const combat = makeCombat({
			hasArcaneShot: () => true,
			getArcaneShotRemaining: () => 2,
			getKnownArcaneShots: () => [{name: "Grasping Arrow", source: "XGE"}],
		});
		expect(predicateFor(combat)({isRanged: true, attack: {name: "Hand Crossbow", isRanged: true}})).toBe(false);
	});
});

describe("_runPostAttackHooks — generic dispatch + isolation", () => {
	it("runs only hooks whose predicate passes, and isolates errors", async () => {
		const combat = makeCombat();
		const ran = [];
		combat._getPostAttackHooks = () => [
			{id: "a", predicate: () => true, handler: async () => { ran.push("a"); }},
			{id: "b", predicate: () => false, handler: async () => { ran.push("b"); }},
			{id: "c", predicate: () => true, handler: async () => { throw new Error("boom"); }},
			{id: "d", predicate: () => true, handler: async () => { ran.push("d"); }},
		];
		const origErr = console.error; console.error = () => {};
		await combat._runPostAttackHooks({});
		console.error = origErr;

		expect(ran).toEqual(["a", "d"]); // b skipped (predicate), c threw but didn't abort d
	});
});

describe("_extractArcaneShotDamage", () => {
	let combat;
	beforeEach(() => { combat = makeCombat(); });

	it("parses dice + damage type from a {@damage} entry", () => {
		const shot = {name: "Grasping Arrow", entries: ["The target takes {@damage 2d6} acid damage and..."]};
		expect(combat._extractArcaneShotDamage(shot)).toEqual({dice: "2d6", type: "acid"});
	});

	it("parses {@dice} with no trailing type", () => {
		const shot = {name: "Beguiling Arrow", entries: ["Deals {@dice 2d6} psychic damage."]};
		const out = combat._extractArcaneShotDamage(shot);
		expect(out.dice).toBe("2d6");
		expect(out.type).toBe("psychic");
	});

	it("returns null for a control-only shot with no damage", () => {
		const shot = {name: "Banishing Arrow", entries: ["The target is banished until the end of your next turn."]};
		expect(combat._extractArcaneShotDamage(shot)).toBeNull();
	});
});

describe("_applyArcaneShot spends exactly one use", () => {
	it("spends a use and resolves damage for a damaging shot", () => {
		let used = 0;
		const combat = makeCombat({
			useArcaneShot: () => { used += 1; return true; },
		});
		const shot = {name: "Grasping Arrow", entries: ["{@damage 2d6} acid damage"]};
		combat._applyArcaneShot(shot, {attack: {name: "Longbow"}}, {dc: 15, ability: "INT"});
		expect(used).toBe(1);
	});

	it("spends exactly one use for a control-only shot (no double-spend)", () => {
		let used = 0;
		const combat = makeCombat({
			useArcaneShot: () => { used += 1; return true; },
		});
		const shot = {name: "Banishing Arrow", entries: ["The target is banished."]};
		combat._applyArcaneShot(shot, {attack: {name: "Longbow"}}, {dc: 15, ability: "INT"});
		expect(used).toBe(1);
	});

	it("does not resolve damage when no uses remain", () => {
		const combat = makeCombat({useArcaneShot: () => false});
		let shown = false;
		combat._page.showDiceResult = () => { shown = true; };
		combat._applyArcaneShot({name: "Grasping Arrow", entries: ["{@damage 2d6} acid damage"]}, {attack: {}}, {});
		expect(shown).toBe(false);
	});
});

describe("Flanking — _getCombatLocalAttackBonus / _isStrictMelee (#12)", () => {
	it("adds +2 to a melee attack only when the toggle is on", () => {
		const combat = makeCombat();
		const melee = {name: "Longsword", isMelee: true};

		expect(combat._getCombatLocalAttackBonus({attack: melee}).bonus).toBe(0); // toggle off

		combat._flankingEnabled = true;
		const res = combat._getCombatLocalAttackBonus({attack: melee});
		expect(res.bonus).toBe(2);
		expect(res.parts).toEqual([{label: "Flanking", value: 2}]);
	});

	it("never applies flanking to a ranged attack, even with a numeric range", () => {
		const combat = makeCombat();
		combat._flankingEnabled = true;
		expect(combat._getCombatLocalAttackBonus({attack: {name: "Longbow", isRanged: true}}).bonus).toBe(0);
		expect(combat._getCombatLocalAttackBonus({attack: {name: "Dart", range: "20/60"}}).bonus).toBe(0);
		expect(combat._getCombatLocalAttackBonus({attack: {name: "Javelin", range: "30 ft."}}).bonus).toBe(0);
	});

	it("strict melee recognizes explicit melee signals only", () => {
		const combat = makeCombat();
		expect(combat._isStrictMelee({isMelee: true})).toBe(true);
		expect(combat._isStrictMelee({type: "melee"})).toBe(true);
		expect(combat._isStrictMelee({range: "melee"})).toBe(true);
		expect(combat._isStrictMelee({range: "reach 10 ft."})).toBe(true);
		// Loose / ranged signals are NOT melee
		expect(combat._isStrictMelee({range: "60 ft."})).toBe(false);
		expect(combat._isStrictMelee({isRanged: true})).toBe(false);
		expect(combat._isStrictMelee({isSpell: true, isMelee: true})).toBe(false);
		expect(combat._isStrictMelee(null)).toBe(false);
	});
});
