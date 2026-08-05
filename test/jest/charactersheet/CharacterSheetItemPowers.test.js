import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import {jest} from "@jest/globals";

import "../../../js/charactersheet/charactersheet-class-utils.js";
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
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const items = JSON.parse(readFileSync(resolve(REPO_ROOT, "data/items.json"), "utf8")).item;
const magicVariants = JSON.parse(readFileSync(resolve(REPO_ROOT, "data/magicvariants.json"), "utf8")).magicvariant;
const brewItems = JSON.parse(readFileSync(resolve(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf8")).item;
const backupFixtures = {
	gutterang: {
		name: "Gutterang",
		source: "EdE",
		type: "RG|DMG",
		rarity: "artifact",
		reqAttune: true,
		attachedSpells: ["death ward", "far step", "fly", "mass cure wounds"],
		entries: [{
			type: "entries",
			name: "Spells",
			entries: ["Gutterang has 7 charges. You can expend charges to cast {@spell death ward} (2 charges), {@spell fly} (3 charges), {@spell mass cure wounds} (5 charges), or {@spell far step|XGE} (2 charges). Once you use the ring to cast a spell, you can't cast that spell again from it until the next dawn."],
		}],
	},
	batWings: {
		name: "Bat Wings of Flying",
		source: "GrimHollowMG24",
		rarity: "rare",
		reqAttune: true,
		wondrous: true,
		modifySpeed: {static: {fly: 40}},
		entries: ["These wings give you a fly speed of 40 feet, but they can be used once every {@dice 1d8} hours."],
	},
	arcaneMirror: {
		name: "Arcane Mirror",
		source: "24GriffonsSaddlebag1",
		type: "S|XPHB",
		rarity: "very rare",
		reqAttune: true,
		charges: 10,
		attachedSpells: ["shield|xphb"],
		entries: ["You can take a reaction when you're hit by an attack to cast {@spell Shield|XPHB} from it. You can't use this property again until you finish a short rest or long rest."],
	},
};

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

function makePreviewElement (tagName = "div") {
	const attributes = new Map();
	const listeners = new Map();
	const classes = new Set();
	return {
		tagName: tagName.toUpperCase(),
		attributes,
		listeners,
		classList: {add: className => classes.add(className), contains: className => classes.has(className)},
		setAttribute: (name, value) => attributes.set(name, String(value)),
		getAttribute: name => attributes.get(name),
		addEventListener: (name, handler) => listeners.set(name, handler),
	};
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

	it("rolls schema-valid formula charge maxima once and persists the numeric result", () => {
		const randomise = jest.fn().mockReturnValue(5);
		globalThis.RollerUtil.randomise = randomise;
		const state = new CharacterSheetState();
		const added = addActiveCatalogItem(state, {
			name: "Formula-Charged Weapon",
			source: "TST",
			charges: "{@dice 1d8 + 1}",
			recharge: "dawn",
			attachedSpells: {charges: {"1": ["magic missile"]}},
		});

		expect(added).toEqual(expect.objectContaining({
			charges: 6,
			chargesCurrent: 6,
			chargesFormula: "{@dice 1d8 + 1}",
			chargesMaxMode: "rolledFormula",
		}));
		expect(randomise).toHaveBeenCalledTimes(1);

		const restoredState = new CharacterSheetState();
		restoredState.loadFromJson(state.toJson());
		const restored = restoredState.getItems().find(it => it.id === added.id);
		expect(restored).toEqual(expect.objectContaining({charges: 6, chargesCurrent: 6}));
		expect(randomise).toHaveBeenCalledTimes(1);
		delete globalThis.RollerUtil.randomise;
	});

	it("uses the same formula-charge resolver for inventory catalog additions", () => {
		const randomise = jest.fn().mockReturnValue(3);
		globalThis.RollerUtil.randomise = randomise;
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const added = addCatalogItemViaInventory(state, inventory, {
			name: "Catalog Formula Wand",
			source: "TST",
			charges: "{@dice 1d4 - 1}",
			attachedSpells: {charges: {"1": ["magic missile"]}},
		});

		expect(added).toEqual(expect.objectContaining({
			charges: 2,
			chargesCurrent: 2,
			chargesFormula: "{@dice 1d4 - 1}",
			chargesMaxMode: "rolledFormula",
		}));
		expect(randomise).toHaveBeenCalledTimes(1);
		delete globalThis.RollerUtil.randomise;
	});

	it("derives proficiency-based charge maxima and resizes them safely", () => {
		const state = new CharacterSheetState();
		const added = addActiveCatalogItem(state, {
			name: "Proficiency-Charged Focus",
			source: "TST",
			charges: "equal to your proficiency bonus",
			attachedSpells: {charges: {"1": ["magic missile"]}},
		});

		expect(added).toEqual(expect.objectContaining({
			charges: 2,
			chargesCurrent: 2,
			chargesMaxMode: "proficiencyBonus",
		}));

		state._data.classes = [{name: "Wizard", level: 9}];
		state.syncDerivedResourceMaxes();
		expect(state.getItems().find(it => it.id === added.id)).toEqual(expect.objectContaining({charges: 4, chargesCurrent: 2}));
	});

	it("rejects invalid charge formulas instead of creating a truncated counter", () => {
		const state = new CharacterSheetState();
		const added = addActiveCatalogItem(state, {
			name: "Invalid-Charge Item",
			source: "TST",
			charges: "when the moon is full",
			attachedSpells: {charges: {"1": ["magic missile"]}},
		});

		expect(added).toEqual(expect.objectContaining({
			charges: null,
			chargesCurrent: null,
			chargesMaxMode: "invalid",
			chargesInvalidFormula: "when the moon is full",
		}));
		const power = state.getItemPowers().find(it => it.itemId === added.id);
		expect(power).toEqual(expect.objectContaining({isAvailable: false}));
	});

	it("binds resource-cast attached spells to a named resource atomically", () => {
		const state = new CharacterSheetState();
		state.addResource({name: "Arcane Battery", max: 3, current: 3, recharge: "long"});
		const added = addActiveCatalogItem(state, {
			name: "Battery Wand",
			source: "TST",
			attachedSpells: {
				resourceName: "Arcane Battery",
				resource: {"2": ["magic missile"]},
			},
		});
		const power = state.getItemPowers({activeOnly: true}).find(it => it.itemId === added.id);

		expect(power).toEqual(expect.objectContaining({
			usageType: "resource",
			resourceName: "Arcane Battery",
			resourceCost: 2,
			resourceCurrent: 3,
			isAvailable: true,
		}));
		expect(state.invokeItemPower(added.id, power.id)).toEqual(expect.objectContaining({ok: true, resourceCurrent: 1}));
		expect(state.getItemPower(added.id, power.id)).toEqual(expect.objectContaining({isAvailable: false, resourceCurrent: 1}));
		expect(state.invokeItemPower(added.id, power.id)).toEqual(expect.objectContaining({ok: false}));
		expect(state.getResource("Arcane Battery").current).toBe(1);
	});

	it("surfaces resource-cast spells as unavailable when resourceName is absent", () => {
		const state = new CharacterSheetState();
		const added = addActiveCatalogItem(state, {
			name: "Unbound Wand",
			source: "TST",
			attachedSpells: {resource: {"1": ["magic missile"]}},
		});
		const power = state.getItemPowers({activeOnly: true}).find(it => it.itemId === added.id);

		expect(power).toEqual(expect.objectContaining({
			usageType: "resource",
			isAvailable: false,
			unavailableReason: "This power has no resource name configured.",
		}));
	});

	it("normalizes a persisted spell-level item choice into a charged spell power", () => {
		const state = new CharacterSheetState();
		const added = addActiveCatalogItem(state, {
			name: "Enspelled Test Staff",
			source: "TST",
			type: "ST",
			rarity: "rare",
			charges: 6,
			spellScrollLevel: 3,
			selectedSpell: {name: "Fireball", source: "PHB", level: 3},
			entries: ["The staff has 6 charges. While holding it, you can expend 1 charge to cast its spell."],
		});
		const power = state.getItemPowers({activeOnly: true}).find(it => it.itemId === added.id);

		expect(power).toEqual(expect.objectContaining({
			kind: "spell",
			spellName: "Fireball",
			spellSource: "PHB",
			castLevel: 3,
			chargesCost: 1,
			usageType: "charges",
		}));
		expect(state.invokeItemPower(added.id, power.id)).toEqual(expect.objectContaining({ok: true, chargesCurrent: 5}));
	});

	it("keeps a selected spell-scroll choice finite and persists its identity", () => {
		const state = new CharacterSheetState();
		const selected = CharacterSheetInventory.getItemWithSelectedSpell({
			name: "Spell Scroll (Level 2)",
			source: "DMG",
			type: "SC",
			rarity: "uncommon",
			spellScrollLevel: 2,
		}, {name: "Misty Step", source: "PHB", level: 2});
		const added = addActiveCatalogItem(state, selected);
		state.setItemEquipped(added.id, false);
		const power = state.getItemPowers({activeOnly: true}).find(it => it.itemId === added.id);

		expect(added.selectedSpell).toEqual({name: "Misty Step", source: "PHB", level: 2});
		expect(power).toEqual(expect.objectContaining({
			spellName: "Misty Step",
			castLevel: 2,
			usageType: "limited",
			usesCurrent: 1,
			usesMax: 1,
		}));
		expect(state.invokeItemPower(added.id, power.id)).toEqual(expect.objectContaining({ok: true, usesCurrent: 0}));
		expect(state.getItemPower(added.id, power.id).isAvailable).toBe(false);
	});

	it("does not merge different selected spells on otherwise identical items", () => {
		const state = new CharacterSheetState();
		const base = {
			name: "Enspelled Test Staff",
			source: "TST",
			type: "ST",
			rarity: "rare",
			charges: 6,
			spellScrollLevel: 3,
		};

		state.addItem({...base, id: "fire", selectedSpell: {name: "Fireball", source: "PHB", level: 3}});
		state.addItem({...base, id: "fly", selectedSpell: {name: "Fly", source: "PHB", level: 3}});

		expect(state.getItems()).toHaveLength(2);
		expect(state.getItems().map(item => item.selectedSpell.name)).toEqual(["Fireball", "Fly"]);
	});

	it("turns structured item light into a persisted player-controlled light source", () => {
		const state = new CharacterSheetState();
		const added = addActiveCatalogItem(state, {
			name: "Test Lantern",
			source: "TST",
			light: [{bright: 20, dim: 40, shape: "cone"}],
		});
		const power = state.getItemPowers({activeOnly: true}).find(it => it.itemId === added.id && it.effectType === "light");

		expect(power).toEqual(expect.objectContaining({
			kind: "toggle",
			isToggle: true,
			light: {brightRange: 20, dimRange: 40, shape: "cone"},
		}));
		expect(state.getEmittedLight()).toEqual({brightRange: 0, dimRange: 0, sources: []});
		expect(state.invokeItemPower(added.id, power.id)).toEqual(expect.objectContaining({ok: true, isActive: true}));
		expect(state.getEmittedLight()).toEqual({brightRange: 20, dimRange: 40, sources: ["Test Lantern"]});

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getEmittedLight()).toEqual({brightRange: 20, dimRange: 40, sources: ["Test Lantern"]});
	});

	it("uses structured focus class lists in material-component validation", () => {
		const state = new CharacterSheetState();
		state._data.classes = [{name: "Wizard", level: 1}];
		addActiveCatalogItem(state, {
			name: "Wizard Orb",
			source: "TST",
			type: "OTH",
			focus: ["Wizard"],
		});

		expect(state.getSpellcastingFocusStatus()).toEqual(expect.objectContaining({
			ok: true,
			itemName: "Wizard Orb",
		}));

		const universalState = new CharacterSheetState();
		addActiveCatalogItem(universalState, {name: "Universal Focus", source: "TST", type: "OTH", focus: true});
		expect(universalState.getSpellcastingFocusStatus()).toEqual(expect.objectContaining({
			ok: true,
			itemName: "Universal Focus",
		}));
	});

	it("applies persisted structured ability choices and keeps different choices separate", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const base = {
			name: "Mutable Tome",
			source: "TST",
			ability: {choose: [{from: ["str", "wis"], count: 1, amount: 2}]},
		};
		addActiveCatalogItem(state, {...base, selectedAbilityChoices: [{ability: "wis", amount: 2}]});
		addActiveCatalogItem(state, {...base, selectedAbilityChoices: [{ability: "str", amount: 2}]});
		inventory._updateArmorClass();

		expect(state.getItems()).toHaveLength(2);
		expect(state.getAbilityScore("wis")).toBe(12);
		expect(state.getAbilityScore("str")).toBe(12);
	});

	it("derives fixed structured language grants and removes them when unequipped", () => {
		const state = new CharacterSheetState();
		const added = addActiveCatalogItem(state, {
			name: "Draconic Mask",
			source: "TST",
			grantsLanguage: true,
			entries: ["While wearing this mask, you can speak and understand Draconic."],
		});

		expect(state.getLanguages()).toContain("Draconic");
		state.setItemEquipped(added.id, false);
		expect(state.getLanguages()).not.toContain("Draconic");
	});

	it("uses structured weapon reach as the attack range", () => {
		const state = new CharacterSheetState();
		const attack = state.updateAttackFromWeapon({
			name: "Long Pike",
			source: "TST",
			type: "M",
			weaponCategory: "martial",
			dmg1: "1d10",
			dmgType: "P",
			reach: 15,
		});

		expect(attack.range).toBe("15 ft.");
		expect(state.getAttackReach(attack)).toBe(15);
	});

	it("persists catalog ability and language choices before adding an item", async () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		inventory._pChooseAbilitiesForItem = jest.fn().mockResolvedValue([{ability: "cha", amount: 2}]);
		inventory._pChooseLanguageForItem = jest.fn().mockResolvedValue("Celestial");

		await expect(inventory._pAddItemWithChoices({
			name: "Choice Relic",
			source: "TST",
			ability: {choose: [{from: ["int", "wis", "cha"], count: 1, amount: 2}]},
			grantsLanguage: true,
		})).resolves.toBe(true);

		expect(state.getItems()).toEqual([
			expect.objectContaining({
				selectedAbilityChoices: [{ability: "cha", amount: 2}],
				selectedLanguage: "Celestial",
				grantedLanguages: ["Celestial"],
			}),
		]);
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

	it("normalizes attached-spell resource prose from multiple backup homebrew documents", () => {
		const state = new CharacterSheetState();
		const gutterang = addActiveCatalogItem(state, backupFixtures.gutterang);
		const mirror = addActiveCatalogItem(state, backupFixtures.arcaneMirror);
		const deathWard = state.getItemPowers().find(it => it.itemId === gutterang.id && it.name === "Death Ward");
		const fly = state.getItemPowers().find(it => it.itemId === gutterang.id && it.name === "Fly");
		const shield = state.getItemPowers().find(it => it.itemId === mirror.id && it.name === "Shield");

		expect(deathWard).toEqual(expect.objectContaining({chargesCost: 2, usageType: "daily", usesMax: 1}));
		expect(fly).toEqual(expect.objectContaining({chargesCost: 3, usageType: "daily", usesMax: 1}));
		expect(deathWard.usesKey).not.toBe(fly.usesKey);
		expect(shield).toEqual(expect.objectContaining({actionType: "reaction", usageType: "rest", usesMax: 1}));
	});

	it("keeps cooldown-limited structured speed from becoming an always-on homebrew bonus", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const wings = addCatalogItemViaInventory(state, inventory, backupFixtures.batWings);
		inventory._updateItemBonuses(state.getItems());
		const power = state.getItemPowers().find(it => it.itemId === wings.id);

		expect(state.getSpeed("fly")).toBe(0);
		expect(power).toEqual(expect.objectContaining({effectType: "modifySpeed", isReferenceOnly: true}));
	});
});

describe("Item-power hover previews", () => {
	const originalHover = globalThis.Renderer.hover;
	const originalEncodeForHash = globalThis.UrlUtil.encodeForHash;
	const originalSpellsPage = globalThis.UrlUtil.PG_SPELLS;

	afterEach(() => {
		globalThis.Renderer.hover = originalHover;
		globalThis.UrlUtil.encodeForHash = originalEncodeForHash;
		globalThis.UrlUtil.PG_SPELLS = originalSpellsPage;
	});

	it("wires spell rows to the canonical spell hover with cast-level context", () => {
		const onMouseOver = jest.fn();
		globalThis.UrlUtil.PG_SPELLS = "spells.html";
		globalThis.UrlUtil.encodeForHash = jest.fn(value => String(value).toLowerCase().replace(/\s+/g, "-"));
		globalThis.Renderer.hover = {
			pHandleLinkMouseOver: onMouseOver,
			handleLinkMouseMove: jest.fn(),
			handleLinkMouseLeave: jest.fn(),
		};
		const element = makePreviewElement();
		const preview = CharacterSheetClassUtils.applyItemPowerPreview(element, {
			kind: "spell",
			name: "Fireball",
			spellName: "Fireball",
			spellSource: "PHB",
			castLevel: 5,
			description: "Cast Fireball from the staff.",
		});

		expect(preview).toMatchObject({isSpell: true, page: "spells.html", source: "PHB"});
		expect(element.getAttribute("data-vet-page")).toBe("spells.html");
		expect(element.getAttribute("data-vet-source")).toBe("PHB");
		expect(element.getAttribute("data-vet-hash")).toContain("fireball");
		expect(element.getAttribute("data-cast-level")).toBe("5");
		expect(element.getAttribute("aria-label")).toContain("Cast at level 5");
		expect(element.title).toContain("Cast Fireball from the staff.");
		element.listeners.get("mouseover")({type: "mouseover"});
		expect(onMouseOver).toHaveBeenCalledWith(expect.any(Object), element);
	});

	it("exposes the full ability/reference description without fake spell hover data", () => {
		const element = makePreviewElement("button");
		const description = "Choose a creature you can see; it must succeed on a DC 17 save or be blinded until the next dawn.";
		const preview = CharacterSheetClassUtils.applyItemPowerPreview(element, {
			kind: "ability",
			name: "Blinding Radiance",
			itemName: "Gae Bolg",
			description,
			isReferenceOnly: true,
		});

		expect(preview).toMatchObject({isSpell: false});
		expect(element.title).toContain(description);
		expect(element.getAttribute("aria-label")).toContain(description);
		expect(element.getAttribute("data-vet-page")).toBeUndefined();
		expect(element.classList.contains("charsheet__item-power--has-preview")).toBe(true);
	});

	it("applies the shared preview helper in Inventory, Combat, and Play Mode", () => {
		for (const file of [
			"js/charactersheet/charactersheet-inventory.js",
			"js/charactersheet/charactersheet-combat.js",
			"js/charactersheet/charactersheet-playmode.js",
		]) {
			const source = readFileSync(resolve(REPO_ROOT, file), "utf8");
			expect(source).toMatch(/CharacterSheetClassUtils\.applyItemPowerPreview\?\.\(row, power\)/);
		}
	});
});
