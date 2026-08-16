import "./setup.js";

// The action-economy aggregation reads two read-only hooks off the state class
// (classification overrides + the activatable detector). Provide a minimal stub
// BEFORE importing the combat module so its class-body references resolve.
globalThis.CharacterSheetState = globalThis.CharacterSheetState || {};
globalThis.CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES =
	globalThis.CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES || {};
globalThis.CharacterSheetState.detectActivatableFeature =
	globalThis.CharacterSheetState.detectActivatableFeature || (() => null);

import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;

/**
 * Build a combat instance whose `_state` returns exactly the supplied sources.
 * Everything defaults to empty so each test declares only what it exercises.
 */
function makeCombat ({attacks = [], items = [], temporaryAttacks = [], activeStateAttacks = [], spells = [], features = [], customAbilities = []} = {}) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = {
		getAttacks: () => attacks,
		getItems: () => items,
		getWeaponDamageDie: item => item.handsUsed >= 2 && item.dmg2 ? item.dmg2 : (item.dmg1 || item.damage),
		getTemporaryAttacks: () => temporaryAttacks,
		getActiveStateAttacks: () => activeStateAttacks,
		getSpells: () => spells,
		getFeatures: () => features,
		getCustomAbilities: () => customAbilities,
	};
	combat._page = {};
	combat._getStandardActionEconomyEntities = () => [];
	return combat;
}

/** Collect the names in a bucket for order-independent assertions. */
const names = (bucket) => bucket.map(e => e.name);

beforeEach(() => {
	// Reset overrides between tests so one test's override does not leak.
	globalThis.CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES = {};
	globalThis.CharacterSheetState.detectActivatableFeature = () => null;
});

describe("getCombatActionEconomy — aggregation & bucketing", () => {
	test("empty character yields three empty buckets", () => {
		const buckets = makeCombat().getCombatActionEconomy();
		expect(buckets.action).toEqual([]);
		expect(buckets.bonus).toEqual([]);
		expect(buckets.reaction).toEqual([]);
	});

	test("weapon attacks bucket to Action by default", () => {
		const buckets = makeCombat({
			attacks: [{name: "Longsword", damage: "1d8", damageType: "slashing"}],
		}).getCombatActionEconomy();
		expect(names(buckets.action)).toContain("Longsword");
		expect(names(buckets.bonus)).not.toContain("Longsword");
		expect(names(buckets.reaction)).not.toContain("Longsword");
		const entry = buckets.action.find(e => e.name === "Longsword");
		expect(entry.kind).toBe("attack");
	});

	test("attack with explicit bonus actionType buckets to Bonus Action", () => {
		const buckets = makeCombat({
			activeStateAttacks: [{name: "Sting", actionType: "bonus", damage: "1d6"}],
		}).getCombatActionEconomy();
		expect(names(buckets.bonus)).toContain("Sting");
		expect(names(buckets.action)).not.toContain("Sting");
		expect(names(buckets.reaction)).not.toContain("Sting");
	});

	test("equipped weapons not already configured are added once (deduped by name)", () => {
		const buckets = makeCombat({
			attacks: [{name: "Longsword", damage: "1d8"}],
			items: [
				{name: "Longsword", weapon: true, equipped: true, dmg1: "1d8"},
				{name: "Dagger", weapon: true, equipped: true, dmg1: "1d4", dmgType: "piercing"},
				{name: "Shortbow", weapon: true, equipped: false},
			],
		}).getCombatActionEconomy();
		expect(names(buckets.action).filter(n => n === "Longsword")).toHaveLength(1);
		expect(names(buckets.action)).toContain("Dagger");
		expect(names(buckets.action)).not.toContain("Shortbow");
		// Equipped-weapon subtitle reads the real `dmgType` field.
		expect(buckets.action.find(e => e.name === "Dagger").subtitle).toBe("1d4 piercing");
	});

	test("spells bucket by casting time; longer-than-turn casts are excluded", () => {
		const buckets = makeCombat({
			spells: [
				{name: "Fire Bolt", level: 0, castingTime: "1 action"},
				{name: "Healing Word", level: 1, prepared: true, castingTime: "1 bonus"},
				{name: "Shield", level: 1, prepared: true, castingTime: "1 reaction"},
				{name: "Find Familiar", level: 1, prepared: true, castingTime: "1 hour"},
				{name: "Detect Magic", level: 1, prepared: true, castingTime: "1 minute"},
			],
		}).getCombatActionEconomy();
		expect(names(buckets.action)).toContain("Fire Bolt");
		expect(names(buckets.bonus)).toContain("Healing Word");
		expect(names(buckets.reaction)).toContain("Shield");
		// Excluded from every bucket — not turn action economy.
		for (const b of ["action", "bonus", "reaction"]) {
			expect(names(buckets[b])).not.toContain("Find Familiar");
			expect(names(buckets[b])).not.toContain("Detect Magic");
		}
	});

	test("unprepared leveled spells are excluded but cantrips are always included", () => {
		const buckets = makeCombat({
			spells: [
				{name: "Ray of Frost", level: 0, prepared: false, castingTime: "1 action"},
				{name: "Fireball", level: 3, prepared: false, castingTime: "1 action"},
			],
		}).getCombatActionEconomy();
		expect(names(buckets.action)).toContain("Ray of Frost");
		expect(names(buckets.action)).not.toContain("Fireball");
	});

	test("a spell prepared in both editions (same name, PHB + XPHB) is shown only once", () => {
		const buckets = makeCombat({
			spells: [
				{name: "Guidance", level: 0, source: "PHB", castingTime: "1 action"},
				{name: "Guidance", level: 0, source: "XPHB", castingTime: "1 action"},
			],
		}).getCombatActionEconomy();
		expect(names(buckets.action).filter(n => n === "Guidance")).toHaveLength(1);
	});

	test("features are bucketed by action-economy phrasing; passives are excluded", () => {
		const buckets = makeCombat({
			features: [
				{name: "Second Wind", description: "You can use a bonus action to regain hit points.", uses: {max: 1, current: 1}},
				{name: "Riposte", description: "As a reaction you make a melee attack."},
				{name: "Cunning Action", description: "You can take a bonus action to Dash, Disengage, or Hide."},
				{name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light."},
			],
		}).getCombatActionEconomy();
		expect(names(buckets.bonus)).toEqual(expect.arrayContaining(["Second Wind", "Cunning Action"]));
		expect(names(buckets.reaction)).toContain("Riposte");
		// Passive trait: no action-economy verb → excluded everywhere.
		for (const b of ["action", "bonus", "reaction"]) {
			expect(names(buckets[b])).not.toContain("Darkvision");
		}
		// Bonus-action features must not leak into the other two buckets.
		for (const b of ["action", "reaction"]) {
			expect(names(buckets[b])).not.toContain("Second Wind");
			expect(names(buckets[b])).not.toContain("Cunning Action");
		}
	});

	test("a reaction-classified toggle feature (entries-only) buckets to Reaction", () => {
		globalThis.CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES = {"protective ward": "reaction"};
		const buckets = makeCombat({
			features: [
				{name: "Protective Ward", entries: ["When a creature you can see hits a target with an attack, you can use your reaction to grant resistance."]},
			],
		}).getCombatActionEconomy();
		expect(names(buckets.reaction)).toContain("Protective Ward");
		expect(names(buckets.action)).not.toContain("Protective Ward");
		expect(names(buckets.bonus)).not.toContain("Protective Ward");
	});

	test("an activatable toggle (e.g. Bladesong) is included even without explicit verb text", () => {
		globalThis.CharacterSheetState.detectActivatableFeature = (f) => (f.name === "Bladesong" ? {stateTypeId: "bladesong"} : null);
		const buckets = makeCombat({
			features: [
				{name: "Bladesong", description: "You can invoke an elven magic called the Bladesong.", uses: {max: 2, current: 2}},
			],
		}).getCombatActionEconomy();
		// No "bonus action" phrasing → defaults to Action, but it IS surfaced.
		expect(names(buckets.action)).toContain("Bladesong");
		expect(names(buckets.bonus)).not.toContain("Bladesong");
		expect(names(buckets.reaction)).not.toContain("Bladesong");
	});

	test("metamagic optional features are never surfaced in the economy view", () => {
		const buckets = makeCombat({
			features: [
				{name: "Quickened Spell", optionalFeatureTypes: ["MM"], description: "When you cast a spell that has a casting time of 1 action, you can use a bonus action to cast it."},
			],
		}).getCombatActionEconomy();
		for (const b of ["action", "bonus", "reaction"]) {
			expect(names(buckets[b])).not.toContain("Quickened Spell");
		}
	});

	test("custom abilities bucket by activationAction; free is excluded", () => {
		const buckets = makeCombat({
			customAbilities: [
				{name: "Battle Cry", activationAction: "action", mode: "limited"},
				{name: "Quick Feint", activationAction: "bonus", mode: "toggleable"},
				{name: "Parry", activationAction: "reaction", mode: "limited"},
				{name: "Focus Breath", activationAction: "free"},
			],
		}).getCombatActionEconomy();
		expect(names(buckets.action)).toContain("Battle Cry");
		expect(names(buckets.bonus)).toContain("Quick Feint");
		expect(names(buckets.reaction)).toContain("Parry");
		for (const b of ["action", "bonus", "reaction"]) {
			expect(names(buckets[b])).not.toContain("Focus Breath");
		}
		// No custom ability lands in more than one bucket.
		expect(names(buckets.bonus)).not.toContain("Battle Cry");
		expect(names(buckets.reaction)).not.toContain("Battle Cry");
		expect(names(buckets.action)).not.toContain("Parry");
	});

	test("all four sources aggregate together under the correct headers", () => {
		const buckets = makeCombat({
			attacks: [{name: "Rapier", damage: "1d8"}],
			spells: [{name: "Misty Step", level: 2, prepared: true, castingTime: "1 bonus"}],
			features: [{name: "Uncanny Dodge", description: "You can use your reaction to halve the damage."}],
			customAbilities: [{name: "Inspiring Word", activationAction: "bonus", mode: "limited"}],
		}).getCombatActionEconomy();

		expect(names(buckets.action)).toContain("Rapier");
		expect(names(buckets.bonus)).toEqual(expect.arrayContaining(["Misty Step", "Inspiring Word"]));
		expect(names(buckets.reaction)).toContain("Uncanny Dodge");

		// Each entry carries its source kind for the badge rendering.
		const kinds = {};
		for (const b of ["action", "bonus", "reaction"]) for (const e of buckets[b]) kinds[e.name] = e.kind;
		expect(kinds["Rapier"]).toBe("attack");
		expect(kinds["Misty Step"]).toBe("spell");
		expect(kinds["Uncanny Dodge"]).toBe("feature");
		expect(kinds["Inspiring Word"]).toBe("custom");
	});
});
