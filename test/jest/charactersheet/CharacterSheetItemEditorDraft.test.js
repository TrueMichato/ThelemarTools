import {jest} from "@jest/globals";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const catalog = JSON.parse(readFileSync(resolve(root, "data/items.json"), "utf8")).item;
const boots = source => catalog.find(item => item.name === "Boots of Speed" && item.source === source);
const makeInventory = state => {
	const page = {getState: () => state, renderCharacter: jest.fn(), saveCharacter: jest.fn()};
	const inventory = new CharacterSheetInventory(page);
	inventory._renderItemList = () => {};
	inventory._updateEncumbrance = () => {};
	return inventory;
};
const editorSave = (inventory, draft, {editItemId = null, baseItem = null, baseline = null} = {}) =>
	inventory._saveCustomItem(draft.name, draft.quantity, draft.weight, draft.options, editItemId, {baseItem, baseline});

describe("Custom item editor draft fidelity", () => {
	test("an untouched raw item is a semantic no-op, including nested entries, unsupported fields and material bases", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		state.addItem({
			id: "editor-host",
			name: "Archive Sword",
			source: "TGTT",
			type: "M",
			weapon: true,
			dmg1: "1d8",
			dmgType: "S",
			bonusWeapon: 1,
			material: {name: "Steel", source: "TGTT"},
			entries: [{type: "table", colLabels: ["d6"], rows: [["1", "{@damage 1d6}"]]}],
			resist: ["fire"],
			attachedSpells: {ritual: ["identify|phb"]},
			arbitraryCatalogField: {nested: [1]},
		});
		const before = structuredClone(state.getItemRaw("editor-host"));
		const baseline = {
			name: before.name,
			quantity: before.quantity,
			weight: before.weight || 0,
			options: {...inventory._seedOptionsFromItem(before).options, entries: "1\n{@damage 1d6}"},
		};
		editorSave(inventory, baseline, {editItemId: "editor-host", baseline});
		expect(state.getItemRaw("editor-host")).toEqual(before);
		expect(inventory._page.saveCharacter).not.toHaveBeenCalled();

		editorSave(inventory, {...baseline, name: "Archive Blade"}, {editItemId: "editor-host", baseline});
		expect(state.getItemRaw("editor-host")).toMatchObject({
			id: "editor-host",
			name: "Archive Blade",
			source: "Custom",
			dmg1: "1d8",
			bonusWeapon: 1,
			material: {name: "Steel", source: "TGTT"},
			entries: before.entries,
			arbitraryCatalogField: before.arbitraryCatalogField,
			attachedSpells: before.attachedSpells,
		});
	});

	test("renaming a material-projected weapon edits its raw damage die, never the projected die", () => {
		const state = new CharacterSheetState();
		state.setItemMaterialCatalog([{
			name: "Test Metal",
			source: "TGTT",
			materialCategory: "constructed",
			density: 7.85,
			damage: 1,
			protection: 0,
			critical: 0,
			penetration: 1,
			magicCapacity: 3,
			rarity: "uncommon",
			price: {gp: 1, unit: "lb"},
			appliesTo: ["weapon"],
			effects: [],
		}]);
		const inventory = makeInventory(state);
		state.addItem({id: "material-blade",
			name: "Base Blade",
			source: "PHB",
			type: "M",
			weapon: true,
			dmg1: "1d8",
			dmgType: "S",
			weight: 3,
			material: {name: "Test Metal", source: "TGTT"}});
		const before = state.getItemRaw("material-blade");
		expect(state.getItems().find(item => item.id === "material-blade").dmg1).toBe("1d10");
		const baseline = {name: before.name,
			quantity: 1,
			weight: before.weight,
			options: inventory._seedOptionsFromItem(before).options};
		editorSave(inventory, {...baseline, name: "Retitled Blade"}, {editItemId: before.id, baseline});
		expect(state.getItemRaw(before.id).dmg1).toBe("1d8");
		expect(state.getItems().find(item => item.id === before.id).dmg1).toBe("1d10");
	});

	test("visible blank fields clear explicitly without dropping unrelated catalog data or wrapper identity", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		state.addItem({id: "held",
			name: "Kept Blade",
			source: "PHB",
			type: "M",
			weapon: true,
			bonusWeapon: 2,
			resist: ["fire"],
			material: {name: "Steel", source: "TGTT"},
			entries: ["Old text"],
			effects: [{type: "ac", value: 1}],
			itemPowers: [{id: "keep", name: "Unrelated", kind: "ability", isReferenceOnly: true}],
			charges: 4,
			chargesCurrent: 2,
			attachedSpells: {will: ["light|phb"]},
			containedItems: ["stored"],
			_efaArmorerWeaponId: "armor-weapon",
			quantity: 3,
			equipped: true,
			starred: true,
			note: "original"});
		state._data.inventory[0].starred = true;
		state._data.inventory[0].note = "original";
		const baseline = {
			name: "Kept Blade",
			quantity: 3,
			weight: 0,
			options: {type: "weapon",
				bonusWeapon: 2,
				resist: ["fire"],
				material: {name: "Steel", source: "TGTT"},
				entries: "Old text",
				effects: [{type: "ac", value: 1}],
				itemPowers: state.getItemRaw("held").itemPowers,
				attachedSpells: {will: ["light|phb"]}},
		};
		const edited = {...baseline,
			options: {...baseline.options,
				bonusWeapon: undefined,
				resist: undefined,
				material: null,
				entries: undefined,
				effects: [],
				itemPowers: [],
				attachedSpells: null}};
		editorSave(inventory, edited, {editItemId: "held", baseline});
		const row = state.getItemRaw("held");
		expect(row).toMatchObject({id: "held",
			quantity: 3,
			equipped: true,
			starred: true,
			_efaArmorerWeaponId: "armor-weapon",
			containedItems: ["stored"],
			charges: 4,
			chargesCurrent: 2,
			_baseSource: "PHB"});
		expect(state._data.inventory[0].note).toBe("original");
		expect(row.bonusWeapon).toBe(0);
		expect(row.resist).toBeNull();
		expect(row.material).toBeNull();
		expect(row.entries).toEqual([]);
		expect(row.effects).toEqual([]);
		expect(row.itemPowers).toEqual([]);
		expect(row.attachedSpells).toBeNull();
	});

	test("clearing the charge maximum clears the remaining-charge counter too", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		state.addItem({id: "wand",
			name: "Spent Wand",
			source: "Custom",
			_isCustom: true,
			type: "wand",
			charges: 4,
			chargesCurrent: 2,
			recharge: "dawn"});
		const baseline = {name: "Spent Wand",
			quantity: 1,
			weight: 0,
			options: {type: "wand", charges: 4, recharge: "dawn"}};
		editorSave(inventory, {...baseline, options: {type: "wand"}}, {editItemId: "wand", baseline});
		expect(state.getItemRaw("wand")).toMatchObject({charges: null, chargesCurrent: null, recharge: null});
	});

	test.each(["DMG", "XDMG"])("%s catalog clone retains a working Bonus Action speed toggle after save, load, edit and unequip", source => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const base = boots(source);
		const seed = inventory._seedOptionsFromItem(base);
		const draft = {name: `Copied ${source} Boots`, quantity: 1, weight: 0, options: seed.options};
		const id = editorSave(inventory, draft, {baseItem: base, baseline: {...draft, name: base.name}});
		const raw = state.getItemRaw(id);
		const speed = raw.itemPowers.find(power => power.effectType === "modifySpeed");
		expect(raw.itemPowers.filter(power => power.effectType === "modifySpeed")).toHaveLength(1);
		expect(raw).toMatchObject({source: "Custom", _baseSource: source, modifySpeed: {multiply: {walk: 2}}});
		expect(speed).toMatchObject({kind: "toggle",
			isToggle: true,
			effectType: "modifySpeed",
			actionType: "bonus",
			isReferenceOnly: false});
		expect(raw.entries).toEqual(base.entries);
		expect(base.itemPowers).toBeUndefined();
		state.setItemEquipped(id, true);
		state.setItemAttuned(id, true);
		inventory._updateItemBonuses(state.getItems());
		expect(state.getSpeed("walk")).toBe(30);
		expect(state.invokeItemPower(id, speed.id).ok).toBe(true);
		inventory._updateItemBonuses(state.getItems());
		expect(state.getSpeed("walk")).toBe(60);

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		const restoredInventory = makeInventory(restored);
		const baseline = {name: draft.name,
			quantity: 1,
			weight: 0,
			options: restoredInventory._seedOptionsFromItem(restored.getItemRaw(id)).options};
		editorSave(restoredInventory, {...baseline, name: `Retitled ${source} Boots`}, {editItemId: id, baseline});
		const after = restored.getItemRaw(id);
		expect(restored._normalizeItemPowers(after).filter(power => power.effectType === "modifySpeed")).toHaveLength(1);
		expect(restored._normalizeItemPowers(after).filter(power => power.name.endsWith("Power") && power.isReferenceOnly)).toHaveLength(0);
		expect(after.itemPowers.find(power => power.effectType === "modifySpeed")).toMatchObject({
			id: speed.id, kind: "toggle", isToggle: true, effectType: "modifySpeed", isReferenceOnly: false,
		});
		expect(after.itemPowerStates?.[speed.id]?.active).toBe(true);
		restored.setItemEquipped(id, false);
		restored.setItemEquipped(id, true);
		restoredInventory._updateItemBonuses(restored.getItems());
		expect(restored.getSpeed("walk")).toBe(30);
		expect(restored.getItemPower(id, speed.id).isActive).toBe(false);
	});

	test("a passive custom speed multiplier stays passive with an unrelated power", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const id = editorSave(inventory, {name: "Fast Soles",
			quantity: 1,
			weight: 0,
			options: {type: "wondrous",
				modifySpeed: {multiply: {walk: 2}},
				itemPowers: [{id: "unrelated", name: "Flavor", kind: "ability", isReferenceOnly: true}]}});
		state.setItemEquipped(id, true);
		inventory._updateItemBonuses(state.getItems());
		expect(state.getSpeed("walk")).toBe(60);
		expect(state.getItemRaw(id).itemPowers).not.toEqual(expect.arrayContaining([
			expect.objectContaining({effectType: "modifySpeed"}),
		]));
	});

	test.each(["DMG", "XDMG"])("%s saved Boots with unrelated powers or a legacy reference clone and edit without reverting the catalog repair", source => {
		const base = boots(source);
		const state = new CharacterSheetState();
		state.addItem({...base, id: `legacy-${source}`, equipped: true, attuned: true});
		const saved = state.toJson();
		saved.inventory[0].item.itemPowers = [
			{id: "unrelated", name: "Unrelated", kind: "ability", isReferenceOnly: true},
			...(source === "XDMG" ? [{
				id: "reference:boots-of-speed:bonus",
				name: "Boots of Speed Power",
				kind: "ability",
				actionType: "bonus",
				isReferenceOnly: true,
			}] : []),
		];
		const restored = new CharacterSheetState();
		restored.loadFromJson(saved);
		const inventory = makeInventory(restored);
		inventory.setItems([base]);
		const old = restored.getItemRaw(`legacy-${source}`);
		const speed = old.itemPowers.filter(power => power.effectType === "modifySpeed");
		expect(speed).toHaveLength(1);
		expect(old.itemPowers.map(power => power.id)).toContain("unrelated");
		expect(old.itemPowers.map(power => power.id)).not.toContain("reference:boots-of-speed:bonus");

		const baseline = {name: old.name, quantity: 1, weight: old.weight || 0, options: inventory._seedOptionsFromItem(old).options};
		editorSave(inventory, {...baseline, name: `${source} edited Boots`}, {editItemId: old.id, baseline});
		const edited = restored.getItemRaw(old.id);
		expect(edited.itemPowers.filter(power => power.effectType === "modifySpeed")).toEqual([
			expect.objectContaining({id: speed[0].id, kind: "toggle", isToggle: true, isReferenceOnly: false}),
		]);
		expect(edited.itemPowers.map(power => power.id)).toContain("unrelated");
		const copy = editorSave(inventory, {...baseline, name: `${source} clone`}, {baseItem: edited, baseline});
		expect(restored.getItemRaw(copy).itemPowers).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "unrelated"}),
			expect.objectContaining({id: speed[0].id, kind: "toggle", effectType: "modifySpeed"}),
		]));
	});

	test("editing away attunement deactivates an already-active cloned speed power", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const base = boots("DMG");
		const baseline = {name: base.name,
			quantity: 1,
			weight: 0,
			options: inventory._seedOptionsFromItem(base).options};
		const id = editorSave(inventory, {...baseline, name: "Attuned Soles"}, {baseItem: base, baseline});
		state.setItemEquipped(id, true);
		state.setItemAttuned(id, true);
		const speedId = state.getItemRaw(id).itemPowers.find(power => power.effectType === "modifySpeed").id;
		expect(state.invokeItemPower(id, speedId).isActive).toBe(true);
		const editBaseline = {name: "Attuned Soles",
			quantity: 1,
			weight: 0,
			options: inventory._seedOptionsFromItem(state.getItemRaw(id)).options};
		editorSave(inventory, {...editBaseline,
			options: {...editBaseline.options, requiresAttunement: false}}, {editItemId: id, baseline: editBaseline});
		expect(state.getItemRaw(id).attuned).toBe(false);
		expect(state.getItemRaw(id).itemPowerStates[speedId].active).toBe(false);
		inventory._updateItemBonuses(state.getItems());
		expect(state.getSpeed("walk")).toBe(30);
	});

	test("cloning a legacy catalog row without stored entries restores nested source content", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const base = boots("XDMG");
		state.addItem({id: "legacy",
			name: base.name,
			source: base.source,
			type: "wondrous",
			requiresAttunement: true,
			modifySpeed: {multiply: {walk: 2}},
			itemPowers: [{id: "unrelated", name: "Other", kind: "ability", isReferenceOnly: true}]});
		inventory.setItems([base]);
		const old = state.getItemRaw("legacy");
		expect(old.entries).toBeUndefined();
		const baseline = {name: old.name, quantity: 1, weight: 0, options: inventory._seedOptionsFromItem(old).options};
		const id = editorSave(inventory, {...baseline, name: "Legacy copy"}, {baseItem: old, baseline});
		expect(state.getItemRaw(id).entries).toEqual(base.entries);
		expect(state.getItemRaw(id).itemPowers.filter(power => power.effectType === "modifySpeed")).toHaveLength(1);
		expect(state.getItemRaw(id).itemPowers.map(power => power.id)).toContain("unrelated");
	});

	test("a removed speed power cannot silently make an active bonus passive; removing its multiplier prunes orphan state", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const id = editorSave(inventory, {name: "Active Soles",
			quantity: 1,
			weight: 0,
			options: {type: "wondrous",
				modifySpeed: {multiply: {walk: 2}},
				itemPowers: [
					{id: "speed",
						name: "Run",
						kind: "toggle",
						isToggle: true,
						effectType: "modifySpeed",
						actionType: "bonus",
						isReferenceOnly: false},
					{id: "other", name: "Lore", kind: "ability", isReferenceOnly: true},
				]}});
		state._data.inventory.find(row => row.id === id).item.itemPowerStates = {
			speed: {active: true},
			other: {active: false},
			stale: {active: true},
		};
		const baseline = {name: "Active Soles",
			quantity: 1,
			weight: 0,
			options: {type: "wondrous",
				modifySpeed: {multiply: {walk: 2}},
				itemPowers: state.getItemRaw(id).itemPowers}};
		const cleared = {...baseline,
			options: {...baseline.options,
				itemPowers: baseline.options.itemPowers.filter(power => power.id === "other")}};
		const before = structuredClone(state.getItemRaw(id));
		expect(() => editorSave(inventory, cleared, {editItemId: id, baseline})).toThrow(/speed bonus passive/);
		expect(state.getItemRaw(id)).toEqual(before);
		editorSave(inventory, {...cleared, options: {...cleared.options, modifySpeed: null}}, {editItemId: id, baseline});
		expect(state.getItemRaw(id).itemPowerStates).toEqual({other: {active: false}});
		expect(state.getItemRaw(id).modifySpeed).toBeNull();
	});

	test("a reused power ID loses active state when its operational toggle becomes reference-only", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		state.addItem({id: "toggle",
			name: "Lamp",
			source: "Custom",
			_isCustom: true,
			type: "wondrous",
			itemPowers: [{id: "lamp",
				name: "Light",
				kind: "toggle",
				isToggle: true,
				effectType: "light",
				isReferenceOnly: false}]});
		state._data.inventory[0].item.itemPowerStates = {lamp: {active: true}};
		const baseline = {name: "Lamp",
			quantity: 1,
			weight: 0,
			options: {type: "wondrous", itemPowers: state.getItemRaw("toggle").itemPowers}};
		const editedPowers = baseline.options.itemPowers.map(power => ({...power, isReferenceOnly: true}));
		editorSave(inventory, {...baseline, options: {...baseline.options, itemPowers: editedPowers}},
			{editItemId: "toggle", baseline});
		expect(state.getItemRaw("toggle").itemPowerStates.lamp.active).toBe(false);
	});

	test("catalog and generated identities are not reused by a new clone, but stay on an in-place edit", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		state.addItem({id: "original",
			name: "Source Bag",
			source: "PHB",
			type: "G",
			containerCapacity: {weight: 30},
			containedItems: ["child"],
			_efaArmorerWeaponId: "generated-weapon",
			_generatedItemId: "generated-weapon",
			_isGeneratedFeatureItem: true,
			iounSet: ["ioun-stone"]});
		const original = state.getItemRaw("original");
		const baseline = {name: original.name,
			quantity: 1,
			weight: 0,
			options: inventory._seedOptionsFromItem(original).options};
		const id = editorSave(inventory, {...baseline, name: "New Bag"}, {baseItem: original, baseline});
		const copy = state.getItemRaw(id);
		expect(id).not.toBe("original");
		expect(copy).toMatchObject({name: "New Bag",
			containerCapacity: {weight: 30},
			containedItems: [],
			iounSet: []});
		expect(copy._efaArmorerWeaponId).toBeUndefined();
		expect(copy._generatedItemId).toBeUndefined();
		expect(state.getItemRaw("original").containedItems).toEqual(["child"]);
	});

	test("cloning a loaded Ioun host takes its pristine base bonuses, not its currently socketed bonus", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		state.addItem({id: "ioun-host",
			name: "Socketed Blade",
			source: "Custom",
			_isCustom: true,
			type: "weapon",
			weapon: true,
			bonusWeapon: 1,
			iounSettings: 2});
		const host = state._data.inventory.find(row => row.id === "ioun-host").item;
		host.bonusWeapon = 3;
		host.iounSet = ["existing-stone"];
		host.iounBaseBonuses = {bonusWeapon: 1};
		const raw = state.getItemRaw("ioun-host");
		expect(raw.bonusWeapon).toBe(3);
		const baseline = {name: raw.name,
			quantity: 1,
			weight: 0,
			options: inventory._seedOptionsFromItem(raw).options};
		const copyId = editorSave(inventory, {...baseline, name: "Empty Copy"}, {baseItem: raw, baseline});
		expect(state.getItemRaw(copyId)).toMatchObject({
			bonusWeapon: 1, iounSet: [], iounBaseBonuses: {bonusWeapon: 1},
		});
		expect(raw.bonusWeapon).toBe(3);
	});

	test("type changes with unmodeled catalog mechanics reject before mutating the owned item", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		state.addItem({id: "catalog-weapon",
			name: "Relic",
			source: "PHB",
			type: "M",
			dmg1: "1d6",
			property: ["F"],
			damageRiders: [{damage: "1d4", damageType: "cold"}]});
		const before = structuredClone(state.getItemRaw("catalog-weapon"));
		const baseline = {name: "Relic",
			quantity: 1,
			weight: 0,
			options: {type: "weapon", dmg1: "1d6", property: ["F"]}};
		expect(() => editorSave(inventory, {...baseline, options: {type: "gear"}}, {
			editItemId: "catalog-weapon", baseline,
		})).toThrow(/Changing this item's type/);
		expect(state.getItemRaw("catalog-weapon")).toEqual(before);
	});

	test("the power serializer retains operational metadata, stable IDs and extension fields", () => {
		const inventory = makeInventory(new CharacterSheetState());
		const powers = [{id: "speed-id",
			name: "Click heels",
			kind: "toggle",
			isToggle: true,
			effectType: "modifySpeed",
			requiresEquipped: true,
			actionType: "bonus",
			chargesCost: 0,
			usesMax: 0,
			isReferenceOnly: false,
			activationFingerprint: "click",
			extension: {key: 1}}, {id: "other", name: "Other", kind: "ability", isReferenceOnly: true}];
		expect(inventory._serializeCustomItemPowers(powers)).toEqual(powers.map(power =>
			expect.objectContaining(power)));
	});
});
