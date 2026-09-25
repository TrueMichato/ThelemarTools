import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

const power = (id, overrides = {}) => ({
	id,
	name: id,
	kind: "toggle",
	isToggle: true,
	effectType: "damageRiders",
	isReferenceOnly: false,
	...overrides,
});
const rider = (id, damageType, conditions = {}) => ({
	id,
	dice: "1d6",
	damageType,
	conditions,
});

function makeWeapon (state, overrides = {}) {
	state.addItem({
		name: "Test Blade",
		source: "Custom",
		type: "M",
		weapon: true,
		dmg1: "1d8",
		dmgType: "S",
		_isCustom: true,
		...overrides,
	}, 1, true, !!overrides.requiresAttunement);
	return state.getItems().at(-1).id;
}

function makeCombat (state, id) {
	const attack = {
		id: `attack:${id}`,
		name: "Test Blade",
		damage: "1d8",
		damageType: "slashing",
		isMelee: true,
		abilityMod: "str",
		sourceItem: {id},
	};
	state.getAttacks = () => [attack];
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._page = {
		rollDice: jest.fn(() => 1),
		pAnimateDamageDice: jest.fn(async () => {}),
		showDiceResult: jest.fn(),
		saveCharacter: jest.fn(),
	};
	combat._weaponRiderEnabled = {};
	combat._lastRiderRoundUsed = {};
	combat._canApplySneakAttack = () => false;
	combat._renderWeaponDamageRiders = () => {};
	combat._resolveChannelRiderDamage = () => ({
		channelSpell: null,
		channelSpellRoll: null,
		channelSpellDamage: 0,
		riderMatched: false,
	});
	combat._promptUseCombatMethod = async () => null;
	return combat;
}

describe("Typed item damage riders", () => {
	let state;
	let originalInputUiUtil;

	beforeEach(() => {
		originalInputUiUtil = globalThis.InputUiUtil;
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 1});
	});

	afterEach(() => {
		globalThis.InputUiUtil = originalInputUiUtil;
		jest.restoreAllMocks();
	});

	it("previews applicable typed dice beside base damage on the Combat attack row without duplicating the legacy alias", () => {
		const id = makeWeapon(state, {
			damageRiders: [rider("acid", "acid"), rider("fire", "fire", {criticalOnly: true, targetCreatureType: "dragon"})],
			bonusDamageDice: "1d6",
			bonusDamageType: "acid",
		});
		const combat = makeCombat(state, id);
		const html = combat._renderAttackItem(state.getAttacks()[0]).outerHTML;
		expect(html).toContain("1d8");
		const extras = [...html.matchAll(/class="[^"]*charsheet__attack-extra-damage[^"]*"[^>]*>([^<]+)<\/span>/g)]
			.map(match => match[1].trim());
		expect(extras).toEqual(["+1d6 acid", "+1d6 fire (crit only, vs dragon)"]);
	});

	it("shows power-gated dice only while the named item power is active", () => {
		const id = makeWeapon(state, {
			itemPowers: [power("ignite", {name: "Ignite"})],
			damageRiders: [rider("flame", "fire", {powerId: "ignite", oncePerTurn: true})],
		});
		const combat = makeCombat(state, id);
		const preview = () => combat._renderAttackItem(state.getAttacks()[0]).outerHTML;
		expect(preview()).not.toContain("charsheet__attack-extra-damage");
		state._data.inventory.find(row => row.id === id).item.itemPowerStates = {ignite: {active: true}};
		expect(preview()).toContain("+1d6 fire (while Ignite is active, once/turn)");
		state.setItemEquipped(id, false);
		expect(preview()).not.toContain("charsheet__attack-extra-damage");
	});

	it("rolls two authored damage types once each on a hit and doubles their dice on a crit", async () => {
		const id = makeWeapon(state, {
			damageRiders: [rider("acid", "acid"), rider("fire", "fire")],
			bonusDamageDice: "1d6",
			bonusDamageType: "acid",
		});
		const combat = makeCombat(state, id);
		const effective = state.getEffectiveItemBonuses(id).damageRiders;
		expect(effective).toEqual([
			expect.objectContaining({id: `item:${id}:rider:acid`, dice: "1d6", damageType: "acid"}),
			expect.objectContaining({id: `item:${id}:rider:fire`, dice: "1d6", damageType: "fire"}),
		]);
		await combat._rollDamage(`attack:${id}`);
		expect(combat._page.showDiceResult).toHaveBeenLastCalledWith(expect.objectContaining({
			total: "1 slashing + 1 acid + 1 fire = 3",
		}));
		expect(combat._page.rollDice).toHaveBeenCalledTimes(3);

		await combat._rollDamage(`attack:${id}`, true);
		expect(combat._page.showDiceResult).toHaveBeenLastCalledWith(expect.objectContaining({
			total: "2 slashing + 2 acid + 2 fire = 6",
		}));
		expect(combat._page.rollDice).toHaveBeenCalledTimes(9);
	});

	it("requires the exact live power on the exact equipped/attuned wrapper, never another toggle", () => {
		const id = makeWeapon(state, {
			requiresAttunement: true,
			itemPowers: [power("flames"), power("frost")],
			damageRiders: [rider("burn", "fire", {powerId: "flames"})],
		});
		const other = makeWeapon(state, {
			name: "Other Blade",
			itemPowers: [power("flames")],
			damageRiders: [rider("burn", "fire", {powerId: "flames"})],
		});
		const item = state._data.inventory.find(row => row.id === id).item;
		item.itemPowerStates = {frost: {active: true}};
		expect(state.getEffectiveItemBonuses(id).damageRiders).toEqual([]);
		expect(state.getEffectiveItemBonuses(other).damageRiders).toHaveLength(0);

		item.itemPowerStates.flames = {active: true};
		expect(state.getEffectiveItemBonuses(id).damageRiders).toHaveLength(1);
		expect(state.getEffectiveItemBonuses(other).damageRiders).toHaveLength(0);
		state.setItemEquipped(id, false);
		expect(state.getEffectiveItemBonuses(id).damageRiders).toEqual([]);
		state.setItemEquipped(id, true);
		item.itemPowerStates.flames = {active: true};
		state.setItemAttuned(id, false);
		expect(state.getEffectiveItemBonuses(id).damageRiders).toEqual([]);
	});

	it("surfaces deleted, reference-only, and malformed power references without paying them out", () => {
		const id = makeWeapon(state, {
			itemPowers: [power("reference", {isReferenceOnly: true}), power("unrelated")],
			damageRiders: [
				rider("lost", "acid", {powerId: "removed"}),
				rider("manual", "fire", {powerId: "reference"}),
				rider("bad-type", "not-a-type"),
			],
		});
		state._data.inventory.find(row => row.id === id).item.itemPowerStates = {unrelated: {active: true}, reference: {active: true}};
		const effective = state.getEffectiveItemBonuses(id);
		expect(effective.damageRiders).toEqual([]);
		expect(effective.unresolvedDamageRiders).toEqual([
			expect.objectContaining({id: `item:${id}:rider:lost`, powerId: "removed", reason: "missingPower"}),
			expect.objectContaining({id: `item:${id}:rider:manual`, powerId: "reference", reason: "referenceOnlyPower"}),
			expect.objectContaining({id: `item:${id}:rider:bad-type`, reason: "invalidDamageType"}),
		]);
	});

	it("rejects invalid descriptors and duplicate IDs instead of silently rolling ambiguous dice", () => {
		const id = makeWeapon(state, {
			damageRiders: [
				rider("repeated", "acid"),
				rider("repeated", "fire"),
				{id: "formula", dice: "1d6 + 2d4", damageType: "cold", conditions: {}},
				{id: "missing-dice", damageType: "cold", conditions: {}},
				rider("invalid-gate", "cold", {criticalOnly: "false"}),
				rider("unknown-gate", "cold", {power: "some-toggle"}),
			],
		});
		const effective = state.getEffectiveItemBonuses(id);
		expect(effective.damageRiders).toEqual([]);
		expect(effective.unresolvedDamageRiders.map(({reason}) => reason)).toEqual([
			"duplicateRiderId", "duplicateRiderId", "invalidDice", "invalidDice",
			"invalidConditions", "invalidConditions",
		]);
	});

	it("preserves line IDs through replace/load while scoping equal IDs to different owned copies", async () => {
		const id = makeWeapon(state, {
			damageRiders: [{dice: "1d6", damageType: "fire", conditions: {oncePerTurn: true}}],
		});
		const savedLineId = state.getItemRaw(id).damageRiders[0].id;
		const {id: _id, ...clone} = state.getItemRaw(id);
		const second = makeWeapon(state, {...clone, name: "Second Blade"});
		expect(state.getItemRaw(second).damageRiders[0].id).toBe(savedLineId);
		expect(state.getEffectiveItemBonuses(id).damageRiders[0].id).toBe(`item:${id}:rider:${savedLineId}`);
		expect(state.getEffectiveItemBonuses(second).damageRiders[0].id).toBe(`item:${second}:rider:${savedLineId}`);

		state.replaceItem(id, {...state.getItemRaw(id), name: "Renamed Blade"});
		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getItemRaw(id).damageRiders[0].id).toBe(savedLineId);
		const firstCombat = makeCombat(restored, id);
		restored.startCombat();
		await firstCombat._rollDamage(`attack:${id}`);
		const secondCombat = makeCombat(restored, second);
		await secondCombat._rollDamage(`attack:${second}`);
		expect(firstCombat._page.showDiceResult.mock.lastCall[0].total).toBe("1 slashing + 1 fire = 2");
		expect(secondCombat._page.showDiceResult.mock.lastCall[0].total).toBe("1 slashing + 1 fire = 2");
		expect(restored.queryTurnReceipt(`item:${id}:rider:${savedLineId}`).used).toBe(true);
		expect(restored.queryTurnReceipt(`item:${second}:rider:${savedLineId}`).used).toBe(true);
	});

	it("assigns a persistent line identity when catalog rehydration restores a missing rider", () => {
		state.addItem({name: "Rehydrated Blade", source: "DMG", type: "M", weapon: true}, 1, true);
		const id = state.getItems()[0].id;
		const inventory = Object.create(CharacterSheetInventory.prototype);
		inventory._state = state;
		inventory._allItems = [{
			name: "Rehydrated Blade",
			source: "DMG",
			damageRiders: [{dice: "1d6", damageType: "acid"}],
		}];
		inventory._updateItemBonuses = jest.fn();
		inventory._rehydrateInventoryItemEffects();
		const idFromCatalog = state.getItemRaw(id).damageRiders[0].id;
		expect(idFromCatalog).toMatch(/^rider-/);
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getEffectiveItemBonuses(id).damageRiders[0].id).toBe(`item:${id}:rider:${idFromCatalog}`);
	});

	it("gates combined critical, target, named power, and once-per-turn conditions independently", async () => {
		const id = makeWeapon(state, {
			itemPowers: [power("ember")],
			damageRiders: [
				rider("combined", "fire", {
					powerId: "ember",
					criticalOnly: true,
					oncePerTurn: true,
					targetCreatureType: "dragon",
				}),
				rider("always", "acid"),
			],
		});
		state._data.inventory.find(row => row.id === id).item.itemPowerStates = {ember: {active: true}};
		state.startCombat();
		const combat = makeCombat(state, id);
		globalThis.InputUiUtil = {pGetUserEnum: jest.fn(async () => "dragon")};
		const key = `item:${id}:rider:combined`;

		await combat._rollDamage(`attack:${id}`);
		expect(combat._page.showDiceResult.mock.lastCall[0].total).toBe("1 slashing + 1 acid = 2");
		expect(state.queryTurnReceipt(key).used).toBe(false);
		expect(combat._page.rollDice).toHaveBeenCalledTimes(2);

		await combat._rollDamage(`attack:${id}`, true);
		expect(combat._page.showDiceResult.mock.lastCall[0].total).toBe("2 slashing + 1 fire + 2 acid = 5");
		expect(state.queryTurnReceipt(key).used).toBe(true);
		expect(combat._page.rollDice).toHaveBeenCalledTimes(7);
		expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getItemRaw(id).damageRiders).toEqual(state.getItemRaw(id).damageRiders);
		expect(loaded.queryTurnReceipt(key).used).toBe(true);
		loaded.getAttacks = state.getAttacks;
		const restoredCombat = makeCombat(loaded, id);
		await restoredCombat._rollDamage(`attack:${id}`, true);
		expect(restoredCombat._page.showDiceResult.mock.lastCall[0].total).toBe("2 slashing + 2 acid = 4");

		loaded.advanceRound();
		await restoredCombat._rollDamage(`attack:${id}`, true);
		expect(restoredCombat._page.showDiceResult.mock.lastCall[0].total).toBe("2 slashing + 1 fire + 2 acid = 5");
	});

	it("does not track once-per-turn lines outside combat", async () => {
		const id = makeWeapon(state, {damageRiders: [rider("once", "acid", {oncePerTurn: true})]});
		const combat = makeCombat(state, id);
		await combat._rollDamage(`attack:${id}`);
		await combat._rollDamage(`attack:${id}`);
		expect(combat._page.showDiceResult.mock.calls.map(([result]) => result.total)).toEqual([
			"1 slashing + 1 acid = 2",
			"1 slashing + 1 acid = 2",
		]);
		expect(state.queryTurnReceipt(`item:${id}:rider:once`).used).toBe(false);
	});

	it("rollbacks all committed rider receipts when showing the result fails, then permits a retry", async () => {
		const id = makeWeapon(state, {
			damageRiders: [
				rider("acid", "acid", {oncePerTurn: true}),
				rider("fire", "fire", {oncePerTurn: true}),
			],
		});
		state.startCombat();
		const combat = makeCombat(state, id);
		combat._page.showDiceResult.mockImplementationOnce(() => { throw new Error("Result unavailable"); });
		await expect(combat._rollDamage(`attack:${id}`)).rejects.toThrow("Result unavailable");
		expect(state.queryTurnReceipt(`item:${id}:rider:acid`).used).toBe(false);
		expect(state.queryTurnReceipt(`item:${id}:rider:fire`).used).toBe(false);
		expect(combat._page.saveCharacter).not.toHaveBeenCalled();

		await combat._rollDamage(`attack:${id}`);
		expect(combat._page.showDiceResult.mock.lastCall[0].total).toBe("1 slashing + 1 acid + 1 fire = 3");
		expect(state.queryTurnReceipt(`item:${id}:rider:acid`).used).toBe(true);
		expect(state.queryTurnReceipt(`item:${id}:rider:fire`).used).toBe(true);
	});

	it("retains the legacy requiresToggle and single bonus-die contract", async () => {
		const id = makeWeapon(state, {
			itemPowers: [power("legacy-damage")],
			damageRiders: [{dice: "1d6", damageType: "fire", requiresToggle: true}],
			bonusDamageDice: "1d6",
			bonusDamageType: "fire",
		});
		const combat = makeCombat(state, id);
		await combat._rollDamage(`attack:${id}`);
		expect(combat._page.showDiceResult.mock.lastCall[0].total).toBe(1);
		state._data.inventory.find(row => row.id === id).item.itemPowerStates = {"legacy-damage": {active: true}};
		await combat._rollDamage(`attack:${id}`);
		expect(combat._page.showDiceResult.mock.lastCall[0].total).toBe("1 slashing + 1 fire = 2");
		expect(combat._page.rollDice).toHaveBeenCalledTimes(3);
	});

	it("loads an old save with no damageRiders field and rolls its legacy damage exactly once", async () => {
		const id = makeWeapon(state, {bonusDamageDice: "1d6", bonusDamageType: "acid"});
		const saved = state.toJson();
		delete saved.inventory.find(row => row.id === id).item.damageRiders;
		const restored = new CharacterSheetState();
		restored.loadFromJson(saved);
		const combat = makeCombat(restored, id);

		await combat._rollDamage(`attack:${id}`);
		expect(combat._page.showDiceResult.mock.lastCall[0].total).toBe("1 slashing + 1 acid = 2");
		expect(combat._page.rollDice).toHaveBeenCalledTimes(2);
		await combat._rollDamage(`attack:${id}`, true);
		expect(combat._page.showDiceResult.mock.lastCall[0].total).toBe("2 slashing + 2 acid = 4");
		expect(combat._page.rollDice).toHaveBeenCalledTimes(6);
	});

	it("pools authored, material, and gemstone target types into one question and keeps upgrades", async () => {
		state.setItemMaterialCatalog([{
			name: "Dragon Iron",
			source: "TGTT",
			materialCategory: "metal",
			density: 7,
			magicCapacity: 2,
			appliesTo: ["weapon"],
			effects: [{type: "extraDamageDiceVsType", dice: 1, creatureType: "dragon"}],
		}]);
		const id = makeWeapon(state, {
			damageRiders: [rider("dragon", "fire", {targetCreatureType: "dragon"})],
		});
		state.setItemMaterial(id, state.getItemMaterialCatalog()[0]);
		state.socketGemstone(id, {name: "Dragonbane", source: "TGTT"});
		state.setCurrency("gp", 5000);
		state.applyItemUpgrade(id, {name: "Saw-toothed", source: "TCAH", upgradeType: ["WU:2"]}, 500);
		const combat = makeCombat(state, id);
		const choose = jest.fn(async () => "dragon");
		globalThis.InputUiUtil = {pGetUserEnum: choose};
		await combat._rollDamage(`attack:${id}`);
		expect(choose).toHaveBeenCalledTimes(1);
		expect(choose.mock.calls[0][0].values).toEqual(["none", "dragon"]);
		expect(combat._page.showDiceResult.mock.lastCall[0].total).toBe("5 slashing + 1 fire = 6");
		expect(combat._page.rollDice).toHaveBeenCalledTimes(6);
		expect(combat._page.showDiceResult.mock.lastCall[0].subtitle).toContain("Test Blade 1d6 fire");
		expect(combat._page.showDiceResult.mock.lastCall[0].subtitle).toContain("Weapon Upgrade 1d4 slashing");
		expect(combat._page.showDiceResult.mock.lastCall[0].subtitle).toContain("Dragon Iron");
		expect(combat._page.showDiceResult.mock.lastCall[0].subtitle).toContain("Dragonbane");

		choose.mockResolvedValue("none");
		await combat._rollDamage(`attack:${id}`);
		expect(combat._page.showDiceResult.mock.lastCall[0].total).toBe(2);
		expect(combat._page.rollDice).toHaveBeenCalledTimes(8);
		const subtitle = combat._page.showDiceResult.mock.lastCall[0].subtitle;
		expect(subtitle).not.toContain("Test Blade 1d6 fire");
		expect(subtitle).not.toContain("Dragon Iron");
		expect(subtitle).not.toContain("Dragonbane");
		expect(subtitle).toContain("Weapon Upgrade 1d4 slashing");
	});

	it("aborts a dismissed target question before another prompt can spend resources or show a partial result", async () => {
		const id = makeWeapon(state, {
			charges: 3,
			chargesCurrent: 3,
			damageRiders: [rider("once", "acid", {oncePerTurn: true, targetCreatureType: "dragon"})],
		});
		state.startCombat();
		const combat = makeCombat(state, id);
		const spendMethod = jest.fn(async () => { state._data.inventory.find(row => row.id === id).item.chargesCurrent--; });
		combat._promptUseCombatMethod = spendMethod;
		globalThis.InputUiUtil = {pGetUserEnum: jest.fn(async () => null)};
		await combat._rollDamage(`attack:${id}`);
		expect(spendMethod).not.toHaveBeenCalled();
		expect(state.getItemRaw(id).chargesCurrent).toBe(3);
		expect(state.queryTurnReceipt(`item:${id}:rider:once`).used).toBe(false);
		expect(combat._page.rollDice).not.toHaveBeenCalled();
		expect(combat._page.showDiceResult).not.toHaveBeenCalled();
	});
});
