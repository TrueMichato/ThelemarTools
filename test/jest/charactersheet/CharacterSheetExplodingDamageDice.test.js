/**
 * Exploding weapon damage dice (Brutal).
 *
 * Brutal's rules text is genuine exploding dice — "roll the maximum result for the weapon's
 * damage dice, you can roll these dice again and add the new roll... you can repeat this
 * process until you don't" — but for a long time it existed only as a `notes` string, so the
 * upgrade cost gold and did nothing.
 *
 * Two halves are tested here:
 *   1. The EFFECT IS AUTHORED DATA. `explodingDamageDice` travels from the catalog entity
 *      through the descriptor / merge / aggregation chain and out of `getEffectiveItemBonuses`,
 *      so any homebrew upgrade can grant it without a code change. A name-keyed built-in
 *      survives only as a fallback for catalogs predating the field.
 *   2. The ROLL PATH APPLIES IT. `_explodeDamageDice` rerolls maxima in place, chains, is
 *      bounded, and touches only the dice it was handed.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {getUpgradeDescriptor, getAggregatedUpgradeEffects, setItemUpgradeCatalog} from "../../../js/itembuilder/itembuilder-upgrade-rules.js";
import {CharacterSheetCombat} from "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const BRUTAL = {name: "Brutal", source: "TCAH", upgradeType: ["WU:2"], explodingDamageDice: true};

describe("Exploding damage dice — the effect is authored data", () => {
	afterEach(() => setItemUpgradeCatalog([]));

	it("an authored `explodingDamageDice` reaches the descriptor", () => {
		setItemUpgradeCatalog([BRUTAL]);
		expect(getUpgradeDescriptor({name: "Brutal", source: "TCAH"}).explodingDamageDice).toBe(true);
	});

	it("a homebrew upgrade can grant it with no name match at all", () => {
		setItemUpgradeCatalog([{name: "Ravenous Edge", source: "HB", upgradeType: ["WU:2"], explodingDamageDice: true}]);
		expect(getUpgradeDescriptor({name: "Ravenous Edge", source: "HB"}).explodingDamageDice).toBe(true);
	});

	it("Brutal still resolves via the name-keyed fallback when the catalog predates the field", () => {
		setItemUpgradeCatalog([]);
		expect(getUpgradeDescriptor({name: "Brutal", source: "TCAH"}).explodingDamageDice).toBe(true);
	});

	it("an ordinary upgrade does not grant it", () => {
		setItemUpgradeCatalog([{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], bonusWeaponAttack: 1}]);
		expect(getUpgradeDescriptor({name: "Balanced", source: "TCAH"}).explodingDamageDice).toBeFalsy();
	});

	it("aggregation ORs the flag — a later plain upgrade cannot revoke it", () => {
		setItemUpgradeCatalog([BRUTAL, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], bonusWeaponAttack: 1}]);
		const effects = getAggregatedUpgradeEffects({
			appliedUpgrades: [{name: "Brutal", source: "TCAH"}, {name: "Balanced", source: "TCAH"}],
		});
		expect(effects.explodingDamageDice).toBe(true);
		expect(effects.bonusWeaponAttack).toBe(1);
	});

	it("aggregation defaults to false with no upgrades applied", () => {
		expect(getAggregatedUpgradeEffects({appliedUpgrades: []}).explodingDamageDice).toBe(false);
	});
});

describe("Exploding damage dice — it surfaces on the item derivation", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 16);
		state.setCurrency("gp", 5000);
	});

	function addWeapon () {
		state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true, dmg1: "1d8", dmgType: "S"});
		return state.getItems()[0].id;
	}

	it("is false on a plain weapon", () => {
		expect(state.getEffectiveItemBonuses(addWeapon()).explodingDamageDice).toBe(false);
	});

	it("becomes true once Brutal is applied, and reverts on removal", () => {
		const id = addWeapon();
		state.applyItemUpgrade(id, BRUTAL, 1000);
		expect(state.getEffectiveItemBonuses(id).explodingDamageDice).toBe(true);

		state.removeItemUpgrade(id, "Brutal", "TCAH");
		expect(state.getEffectiveItemBonuses(id).explodingDamageDice).toBe(false);
	});

	it("does not disturb the numeric bonuses alongside it", () => {
		const id = addWeapon();
		state.applyItemUpgrade(id, BRUTAL, 1000);
		state.applyItemUpgrade(id, {name: "Masterwork", source: "TCAH", upgradeType: ["WU:3"]}, 1000);
		const eff = state.getEffectiveItemBonuses(id);
		expect(eff.explodingDamageDice).toBe(true);
		expect(eff.totalAttackBonus).toBe(1);
		expect(eff.totalDamageBonus).toBe(1);
	});
});

describe("Exploding damage dice — the roll path", () => {
	let combat;
	let queue;

	function makeCombat (rolls) {
		queue = [...rolls];
		const page = {rollDice: () => (queue.length ? queue.shift() : 1)};
		const inst = Object.create(CharacterSheetCombat.prototype);
		inst._page = page;
		return inst;
	}

	beforeEach(() => { combat = makeCombat([]); });

	it("rerolls a maximum die and adds it to both rolls and total", () => {
		combat = makeCombat([4]);
		const roll = {rolls: [8], total: 8, sides: 8};
		expect(combat._explodeDamageDice(roll)).toEqual([4]);
		expect(roll.rolls).toEqual([8, 4]);
		expect(roll.total).toBe(12);
	});

	it("does nothing when no die came up maximum", () => {
		combat = makeCombat([8]);
		const roll = {rolls: [7, 3], total: 10, sides: 8};
		expect(combat._explodeDamageDice(roll)).toEqual([]);
		expect(roll.rolls).toEqual([7, 3]);
		expect(roll.total).toBe(10);
	});

	it("chains: a maximum reroll explodes again", () => {
		combat = makeCombat([8, 8, 2]);
		const roll = {rolls: [8], total: 8, sides: 8};
		expect(combat._explodeDamageDice(roll)).toEqual([8, 8, 2]);
		expect(roll.total).toBe(26);
	});

	it("explodes every maximum die independently", () => {
		combat = makeCombat([1, 2]);
		const roll = {rolls: [6, 6, 3], total: 15, sides: 6};
		expect(combat._explodeDamageDice(roll)).toEqual([1, 2]);
		expect(roll.total).toBe(18);
	});

	it("terminates on a pathological always-maximum die", () => {
		combat = makeCombat([]);
		combat._page.rollDice = () => 6;
		const roll = {rolls: [6], total: 6, sides: 6};
		const added = combat._explodeDamageDice(roll, {maxExplosions: 5});
		expect(added).toHaveLength(5);
		expect(roll.total).toBe(36);
	});

	it("refuses degenerate dice rather than looping — a d1 is always its own maximum", () => {
		combat._page.rollDice = () => { throw new Error("must not roll"); };
		const roll = {rolls: [1], total: 1, sides: 1};
		expect(combat._explodeDamageDice(roll)).toEqual([]);
		expect(roll.total).toBe(1);
	});

	it("is inert on a null or dice-less roll", () => {
		expect(combat._explodeDamageDice(null)).toEqual([]);
		expect(combat._explodeDamageDice({total: 3, rolls: [], modifier: 3})).toEqual([]);
	});

	it("explodes crit-doubled dice, since the crit is already resolved into rolls", () => {
		combat = makeCombat([5, 1]);
		// `_parseDamage` doubles numDice for a crit, so both 8s are present and both explode once.
		const roll = {rolls: [8, 8], total: 16, sides: 8};
		expect(combat._explodeDamageDice(roll)).toEqual([5, 1]);
		expect(roll.rolls).toEqual([8, 8, 5, 1]);
		expect(roll.total).toBe(22);
	});

	it("leaves a rider's separate roll untouched", () => {
		combat = makeCombat([2]);
		const weapon = {rolls: [8], total: 8, sides: 8};
		const rider = {rolls: [6, 6], total: 12, sides: 6};
		combat._explodeDamageDice(weapon);
		expect(rider.rolls).toEqual([6, 6]);
		expect(rider.total).toBe(12);
	});
});
