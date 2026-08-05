import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import {jest} from "@jest/globals";

import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";
import "../../../js/charactersheet/charactersheet-spells.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const items = JSON.parse(readFileSync(resolve(REPO_ROOT, "data/items.json"), "utf8")).item;
const magicVariants = JSON.parse(readFileSync(resolve(REPO_ROOT, "data/magicvariants.json"), "utf8")).magicvariant;
const brewItems = JSON.parse(readFileSync(resolve(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf8")).item;

function addActiveCatalogItem (state, item) {
	state.addItem({
		...item,
		id: `${item.name.toLowerCase().replace(/\W+/g, "-")}-${item.source.toLowerCase()}`,
		equipped: true,
		attuned: true,
		requiresAttunement: !!item.reqAttune,
		quantity: 1,
	});
	return state.getItems().find(it => it.name === item.name && it.source === item.source);
}

function makeInventory (state) {
	const inventory = new CharacterSheetInventory({
		getState: () => state,
		renderCharacter: () => {},
		saveCharacter: () => {},
	});
	inventory._renderItemList = () => {};
	inventory._updateEncumbrance = () => {};
	return inventory;
}

function addCatalogItemViaInventory (state, inventory, item) {
	inventory._addItem(item);
	const added = state.getItems().find(it => it.name === item.name && it.source === item.source);
	state.setItemEquipped(added.id, true);
	if (added.requiresAttunement) state.setItemAttuned(added.id, true);
	return added;
}

function getMagicVariant (name) {
	const variant = magicVariants.find(it => it.name === name && it.inherits?.source === "DMG");
	return {
		...variant.inherits,
		name,
		source: variant.inherits.source,
		type: "M",
		weapon: true,
	};
}

describe("Catalog magic-item powers and passive normalization", () => {
	it("normalizes Staff of Power spells, Power Strike, and Retributive Strike", () => {
		const state = new CharacterSheetState();
		const staff = items.find(it => it.name === "Staff of Power" && it.source === "DMG");
		const added = addActiveCatalogItem(state, staff);
		const powers = state.getItemPowers({activeOnly: true}).filter(power => power.itemId === added.id);

		expect(powers.filter(power => power.kind === "spell")).toHaveLength(9);
		expect(powers).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Fireball", chargesCost: 5, castLevel: 5, actionType: "action"}),
			expect.objectContaining({name: "Power Strike", chargesCost: 1, actionType: "onHit"}),
			expect.objectContaining({name: "Retributive Strike", actionType: "action", isDestructive: true}),
		]));
	});

	it("atomically spends Staff of Power charges and guards destructive use", () => {
		const state = new CharacterSheetState();
		const staff = items.find(it => it.name === "Staff of Power" && it.source === "DMG");
		const added = addActiveCatalogItem(state, staff);
		const fireball = state.getItemPowers({activeOnly: true}).find(power => power.itemId === added.id && power.name === "Fireball");
		const strike = state.getItemPowers({activeOnly: true}).find(power => power.itemId === added.id && power.name === "Retributive Strike");

		expect(state.invokeItemPower(added.id, fireball.id)).toEqual(expect.objectContaining({ok: true, chargesCurrent: 15}));
		expect(state.invokeItemPower(added.id, strike.id)).toEqual(expect.objectContaining({ok: false, needsConfirmation: true}));
		expect(state.getItems().some(item => item.id === added.id)).toBe(true);
		expect(state.invokeItemPower(added.id, strike.id, {confirmed: true})).toEqual(expect.objectContaining({ok: true, destroyed: true}));
		expect(state.getItems().some(item => item.id === added.id)).toBe(false);
	});

	it("normalizes Gae Bolg's bonus-action once-per-dawn power", () => {
		const state = new CharacterSheetState();
		const gaeBolg = brewItems.find(it => it.name === "Gae Bolg" && it.source === "TGTT");
		const added = addActiveCatalogItem(state, gaeBolg);
		const power = state.getItemPowers({activeOnly: true}).find(it => it.itemId === added.id && it.name === "Enemy-Blinding Radiance");

		expect(power).toEqual(expect.objectContaining({actionType: "bonus", chargesCost: 1, chargesCurrent: 1, recharge: "dawn"}));
		expect(state.invokeItemPower(added.id, power.id)).toEqual(expect.objectContaining({ok: true, chargesCurrent: 0}));
		expect(state.getItemPower(added.id, power.id)).toEqual(expect.objectContaining({isAvailable: false}));
	});

	it("derives Robe of the Archmagi's unarmored AC and magic-save advantage", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 14);
		const robe = items.find(it => it.name === "Robe of the Archmagi" && it.source === "DMG");
		const added = addActiveCatalogItem(state, robe);

		expect(state.getArmorClass()).toBe(17);
		expect(state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "save:advantage:magic", sourceFeatureId: `item:${added.id}`}),
		]));

		state.setItemEquipped(added.id, false);
		expect(state.getArmorClass()).not.toBe(17);
		expect(state.getNamedModifiers().some(mod => mod.sourceFeatureId === `item:${added.id}`)).toBe(false);
	});

	it("casts an item spell through the spell result pipeline without spending a spell slot", async () => {
		const state = new CharacterSheetState();
		const spells = new CharacterSheetSpells({getState: () => state});
		spells._allSpells = [{
			name: "Fireball",
			source: "PHB",
			level: 3,
			duration: [{type: "instant"}],
		}];
		spells._pHandleCastingConstraints = jest.fn().mockResolvedValue(true);
		spells._showCastResult = jest.fn().mockResolvedValue(undefined);
		const slotsBefore = JSON.stringify(state.getSpellSlots());

		await expect(spells.pCastItemSpell({
			id: "fireball",
			itemId: "staff",
			itemName: "Staff of Power",
			spellName: "Fireball",
			spellSource: "PHB",
			castLevel: 5,
		})).resolves.toBe(true);

		expect(spells._showCastResult).toHaveBeenCalledWith(
			expect.objectContaining({name: "Fireball", level: 5, sourceItem: "Staff of Power"}),
			5,
			false,
			false,
			{sourceItem: "Staff of Power"},
		);
		expect(JSON.stringify(state.getSpellSlots())).toBe(slotsBefore);
	});

	it("tracks shared daily attached-spell uses and restores them on a long rest", () => {
		const state = new CharacterSheetState();
		const adze = items.find(it => it.name === "Adze of Annam");
		const added = addActiveCatalogItem(state, adze);
		const fabricate = state.getItemPowers({activeOnly: true}).find(power => power.itemId === added.id && power.name === "Fabricate");
		const moveEarth = state.getItemPowers({activeOnly: true}).find(power => power.itemId === added.id && power.name === "Move Earth");

		expect(fabricate).toEqual(expect.objectContaining({usesCurrent: 1, usesMax: 1, usageType: "daily"}));
		expect(fabricate.usesKey).toBe(moveEarth.usesKey);
		expect(state.invokeItemPower(added.id, fabricate.id)).toEqual(expect.objectContaining({ok: true, usesCurrent: 0}));
		expect(state.getItemPower(added.id, moveEarth.id)).toEqual(expect.objectContaining({isAvailable: false, usesCurrent: 0}));

		expect(state.restoreItemPowerUses("short")).toBe(0);
		expect(state.getItemPower(added.id, fabricate.id).isAvailable).toBe(false);
		expect(state.restoreItemPowerUses("long")).toBe(1);
		expect(state.getItemPower(added.id, moveEarth.id)).toEqual(expect.objectContaining({isAvailable: true, usesCurrent: 1}));
	});

	it("surfaces limited attached spells without incorrectly restoring them on a rest", () => {
		const state = new CharacterSheetState();
		const balloon = items.find(it => it.name === "Balloon Pack");
		const added = addActiveCatalogItem(state, balloon);
		const levitate = state.getItemPowers({activeOnly: true}).find(power => power.itemId === added.id && power.name === "Levitate");

		expect(levitate).toEqual(expect.objectContaining({usageType: "limited", usesCurrent: 1, usesMax: 1}));
		expect(state.invokeItemPower(added.id, levitate.id)).toEqual(expect.objectContaining({ok: true, usesCurrent: 0}));
		state.restoreItemPowerUses("long");
		expect(state.getItemPower(added.id, levitate.id)).toEqual(expect.objectContaining({isAvailable: false, usesCurrent: 0}));
	});

	it("applies Bracers of Defense only while unarmored and without a shield", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 14);
		const inventory = makeInventory(state);
		const bracers = items.find(it => it.name === "Bracers of Defense" && it.source === "DMG");
		addActiveCatalogItem(state, bracers);
		inventory._updateArmorClass();

		expect(state.getAc()).toBe(14);

		state.setArmor({ac: 12, type: "light", name: "Leather Armor"});
		expect(state.getAc()).toBe(14);

		state.setArmor(null);
		state.setShield({equipped: true, ac: 2, bonus: 0, name: "Shield"});
		expect(state.getAc()).toBe(14);
	});

	it.each([
		["Amulet of Health", "con", 19],
		["Headband of Intellect", "int", 19],
		["Gauntlets of Ogre Power", "str", 19],
	])("applies the catalog ability setter from %s", (name, ability, expected) => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const item = items.find(it => it.name === name && it.source === "DMG");
		addCatalogItemViaInventory(state, inventory, item);
		inventory._updateItemBonuses(state.getItems());

		expect(state.getAbilityScore(ability)).toBe(expected);
	});

	it("applies every DMG Belt of Giant Strength tier", () => {
		const belts = items.filter(it => it.source === "DMG" && /^Belt of .* Giant Strength$/.test(it.name));
		expect(belts).toHaveLength(6);

		for (const belt of belts) {
			const state = new CharacterSheetState();
			const inventory = makeInventory(state);
			addCatalogItemViaInventory(state, inventory, belt);
			inventory._updateItemBonuses(state.getItems());
			expect(state.getAbilityScore("str")).toBe(belt.ability.static.str);
		}
	});

	it("applies protection, luck, poison-proof, and magic-resistance families", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		for (const name of [
			"Ring of Protection",
			"Stone of Good Luck",
			"Periapt of Proof against Poison",
			"Mantle of Spell Resistance",
		]) {
			const item = items.find(it => it.name === name && it.source === "DMG");
			addCatalogItemViaInventory(state, inventory, item);
		}
		inventory._updateArmorClass();

		expect(state.getAc()).toBe(11);
		expect(state.getItemBonuses()).toEqual(expect.objectContaining({savingThrow: 2, abilityCheck: 1}));
		expect(state.getImmunities()).toContain("poison");
		expect(state.getConditionImmunities()).toContain("poisoned");
		expect(state.getNamedModifiers().filter(mod => mod.type === "save:advantage:magic")).toHaveLength(1);
	});

	it("applies every DMG Ring of Resistance damage type", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const rings = items.filter(it => it.source === "DMG" && /^Ring of .* Resistance$/.test(it.name));
		expect(rings.length).toBeGreaterThanOrEqual(10);
		for (const ring of rings) addCatalogItemViaInventory(state, inventory, ring);
		inventory._updateItemBonuses(state.getItems());

		const expected = new Set(rings.flatMap(ring => ring.resist || []));
		expect(new Set(state.getResistances())).toEqual(expected);
	});

	it("applies structured speed and spell-focus bonus families", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		for (const name of ["Winged Boots", "+3 Wand of the War Mage", "+3 Rod of the Pact Keeper"]) {
			const item = items.find(it => it.name === name && it.source === "DMG");
			addCatalogItemViaInventory(state, inventory, item);
		}
		inventory._updateItemBonuses(state.getItems());

		expect(state.getSpeed("fly")).toBe(state.getSpeed("walk"));
		expect(state.getItemBonuses()).toEqual(expect.objectContaining({spellAttack: 6, spellSaveDc: 3}));
	});

	it("surfaces unresolved active prose as reference-only instead of a dead invoke control", () => {
		const state = new CharacterSheetState();
		const added = addActiveCatalogItem(state, {
			name: "Many-Choice Relic",
			source: "HB",
			entries: [{
				type: "entries",
				name: "Choose a Wonder",
				entries: ["As an action, choose one of the relic's wonders and resolve its rules."],
			}],
		});
		const power = state.getItemPowers().find(it => it.itemId === added.id);

		expect(power).toEqual(expect.objectContaining({
			name: "Choose a Wonder",
			isReferenceOnly: true,
			isAvailable: false,
			unavailableReason: "Rules reference only; resolve this effect manually.",
		}));
		expect(state.invokeItemPower(added.id, power.id)).toEqual(expect.objectContaining({ok: false}));
	});

	it("normalizes prose-only daily item powers without item-name adapters", () => {
		const state = new CharacterSheetState();
		const dagger = items.find(it => it.name === "Dagger of Venom" && it.source === "DMG");
		const bag = items.find(it => it.name === "Bag of Tricks, Gray" && it.source === "DMG");
		const addedDagger = addActiveCatalogItem(state, dagger);
		const addedBag = addActiveCatalogItem(state, bag);
		const daggerPower = state.getItemPowers().find(it => it.itemId === addedDagger.id);
		const bagPower = state.getItemPowers().find(it => it.itemId === addedBag.id);

		expect(daggerPower).toEqual(expect.objectContaining({actionType: "action", usageType: "daily", usesMax: 1}));
		expect(bagPower).toEqual(expect.objectContaining({actionType: "action", usageType: "daily", usesMax: 3}));
		expect(state.invokeItemPower(addedDagger.id, daggerPower.id)).toEqual(expect.objectContaining({ok: true, usesCurrent: 0}));
		expect(state.invokeItemPower(addedBag.id, bagPower.id)).toEqual(expect.objectContaining({ok: true, usesCurrent: 2}));
		expect(state.restoreItemPowerUses("long")).toBe(2);
		expect(state.getItemPower(addedDagger.id, daggerPower.id).usesCurrent).toBe(1);
		expect(state.getItemPower(addedBag.id, bagPower.id).usesCurrent).toBe(3);
	});

	it("activates and deactivates toggleable speed items instead of applying them passively", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const boots = items.find(it => it.name === "Boots of Speed" && it.source === "DMG");
		const added = addCatalogItemViaInventory(state, inventory, boots);
		inventory._updateItemBonuses(state.getItems());
		const power = state.getItemPowers().find(it => it.itemId === added.id);

		expect(power).toEqual(expect.objectContaining({kind: "toggle", actionType: "bonus", isActive: false}));
		expect(state.getSpeed("walk")).toBe(30);

		expect(state.invokeItemPower(added.id, power.id)).toEqual(expect.objectContaining({ok: true, isActive: true}));
		inventory._updateItemBonuses(state.getItems());
		expect(state.getSpeed("walk")).toBe(60);

		expect(state.invokeItemPower(added.id, power.id)).toEqual(expect.objectContaining({ok: true, isActive: false}));
		inventory._updateItemBonuses(state.getItems());
		expect(state.getSpeed("walk")).toBe(30);
	});

	it.each([
		["Wand of Magic Missiles", "Magic Missile", 1],
		["Wand of Fireballs", "Fireball", 3],
		["Wand of Lightning Bolts", "Lightning Bolt", 3],
	])("supports variable-charge upcasting for %s", (itemName, spellName, baseLevel) => {
		const state = new CharacterSheetState();
		const wand = items.find(it => it.name === itemName && it.source === "DMG");
		const added = addActiveCatalogItem(state, wand);
		const power = state.getItemPowers().find(it => it.itemId === added.id && it.name === spellName);

		expect(power).toEqual(expect.objectContaining({
			chargesCost: 1,
			chargesCostMax: 7,
			castLevel: baseLevel,
			isVariableChargeCast: true,
		}));
		expect(state.invokeItemPower(added.id, power.id, {chargesCost: 4})).toEqual(expect.objectContaining({
			ok: true,
			chargesCost: 4,
			chargesCurrent: 3,
		}));
	});

	it("derives standing, toggleable, conditional, and critical weapon riders from catalog data", () => {
		const state = new CharacterSheetState();
		const frostBrand = addActiveCatalogItem(state, getMagicVariant("Frost Brand"));
		const flameTongue = addActiveCatalogItem(state, getMagicVariant("Flame Tongue"));
		const dragonSlayer = addActiveCatalogItem(state, getMagicVariant("Dragon Slayer"));
		const vicious = addActiveCatalogItem(state, getMagicVariant("Vicious Weapon"));

		expect(state.getEffectiveItemBonuses(frostBrand.id).damageRiders).toEqual([
			expect.objectContaining({dice: "1d6", damageType: "cold"}),
		]);

		const flamePower = state.getItemPowers().find(it => it.itemId === flameTongue.id && it.kind === "toggle");
		expect(state.getEffectiveItemBonuses(flameTongue.id).damageRiders).toHaveLength(0);
		expect(state.invokeItemPower(flameTongue.id, flamePower.id)).toEqual(expect.objectContaining({ok: true, isActive: true}));
		expect(state.getEffectiveItemBonuses(flameTongue.id).damageRiders).toEqual([
			expect.objectContaining({dice: "2d6", damageType: "fire"}),
		]);

		const dragonPower = state.getItemPowers().find(it => it.itemId === dragonSlayer.id && it.actionType === "onHit");
		expect(dragonSlayer.conditionalBonuses).toEqual([
			expect.objectContaining({damage: "3d6", creatureTypes: ["dragon"]}),
		]);
		expect(dragonPower).toEqual(expect.objectContaining({isReferenceOnly: true, isAvailable: false}));

		expect(state.getCritWeaponRiders({name: vicious.name, damageType: "slashing", sourceItem: vicious})).toEqual([
			expect.objectContaining({trigger: "nat20", damageAmount: 7, damageType: "slashing"}),
		]);
	});

	it("keeps random-table and command items honest while tracking resolvable resources", () => {
		const state = new CharacterSheetState();
		const wonder = addActiveCatalogItem(state, items.find(it => it.name === "Wand of Wonder" && it.source === "DMG"));
		const horn = addActiveCatalogItem(state, items.find(it => it.name === "Horn of Blasting" && it.source === "DMG"));
		const broom = addActiveCatalogItem(state, items.find(it => it.name === "Broom of Flying" && it.source === "DMG"));
		const wonderPowers = state.getItemPowers().filter(it => it.itemId === wonder.id);
		const hornPower = state.getItemPowers().find(it => it.itemId === horn.id);
		const broomPower = state.getItemPowers().find(it => it.itemId === broom.id);

		expect(wonderPowers).toEqual([
			expect.objectContaining({name: "Wand of Wonder Random Effect", chargesCost: 1, isReferenceOnly: false}),
		]);
		expect(state.invokeItemPower(wonder.id, wonderPowers[0].id)).toEqual(expect.objectContaining({ok: true, chargesCurrent: 6}));
		expect(hornPower).toEqual(expect.objectContaining({actionType: "action", isReferenceOnly: true}));
		expect(broomPower).toEqual(expect.objectContaining({isReferenceOnly: true}));
	});

	it("normalizes major charged and stored-use catalog families", () => {
		const state = new CharacterSheetState();
		const staff = addActiveCatalogItem(state, items.find(it => it.name === "Staff of the Magi" && it.source === "DMG"));
		const necklace = addActiveCatalogItem(state, items.find(it => it.name === "Necklace of Fireballs" && it.source === "DMG"));
		const rod = addActiveCatalogItem(state, items.find(it => it.name === "+1 Rod of the Pact Keeper" && it.source === "DMG"));

		const staffPowers = state.getItemPowers().filter(it => it.itemId === staff.id);
		expect(staffPowers.some(it => it.kind === "spell" && it.chargesCost === 7)).toBe(true);
		expect(staffPowers.some(it => it.usageType === "will")).toBe(true);
		expect(state.getItemPowers().find(it => it.itemId === necklace.id && it.name === "Fireball")).toEqual(
			expect.objectContaining({usageType: "limited", usesMax: 9}),
		);
		expect(state.getItemPowers().find(it => it.itemId === rod.id)).toEqual(
			expect.objectContaining({usageType: "daily", usesMax: 1}),
		);
	});
});
