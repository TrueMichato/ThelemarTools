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
globalThis.Parser.MON_TYPES = ["aberration", "beast", "dragon", "fiend", "giant", "humanoid", "undead"];
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
	test("two typed rider lines serialize independently, preserve stable IDs, and clear deliberately", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const riders = [
			{id: "acid-edge", dice: "1d6", damageType: "acid", conditions: {}},
			{id: "dragon-flame",
				dice: "2d4",
				damageType: "fire",
				conditions: {powerId: "ignite", criticalOnly: true, oncePerTurn: true, targetCreatureType: "dragon"}},
		];
		const power = {id: "ignite",
			name: "Ignite",
			kind: "toggle",
			isToggle: true,
			effectType: "damageRiders",
			actionType: "bonus",
			isReferenceOnly: false};
		const baseline = {name: "Blade",
			quantity: 1,
			weight: 2,
			options: {type: "weapon", dmg1: "1d8", dmgType: "S", damageRiders: riders, itemPowers: [power]}};
		const validation = inventory._validateCustomItemDraft(baseline);
		expect(validation).toEqual([]);
		expect(inventory._buildCustomItem("Blade", 1, 2, baseline.options).damageRiders).toEqual(riders);
		expect(inventory._getCustomItemDraftPatch(baseline, {...baseline, name: "Renamed"})).not.toHaveProperty("damageRiders");
		const cleared = {...baseline, options: {...baseline.options, damageRiders: []}};
		expect(inventory._getCustomItemDraftPatch(baseline, cleared)).toMatchObject({damageRiders: []});
	});

	test("draft validation rejects malformed dice, damage types, duplicate IDs and unresolved powers", () => {
		const inventory = makeInventory(new CharacterSheetState());
		const base = {name: "Blade",
			options: {type: "weapon",
				dmg1: "1d8",
				dmgType: "S",
				damageRiders: [
					{id: "same", dice: "1d6", damageType: "acid", conditions: {}},
					{id: "same", dice: "wrong", damageType: "mystery", conditions: {powerId: "missing"}},
				]}};
		expect(inventory._validateCustomItemDraft(base).map(error => error.code)).toEqual(expect.arrayContaining([
			"duplicateRiderId", "invalidDice", "invalidDamageType", "missingPower",
		]));
	});

	test.each(["DMG", "XDMG"])("%s speed clone keeps activation and rejects an invalid action or ambiguous speed power", source => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const base = inventory._getCustomItemBase(boots(source));
		const speed = base.itemPowers.find(power => power.effectType === "modifySpeed");
		const draft = {name: base.name,
			options: {
				type: "wondrous", modifySpeed: base.modifySpeed, itemPowers: [speed],
			}};
		expect(inventory._validateCustomItemDraft(draft)).toEqual([]);
		expect(inventory._validateCustomItemDraft({...draft,
			options: {...draft.options,
				itemPowers: [{...speed, actionType: "invalid"}]}}).map(error => error.code)).toContain("invalidSpeedAction");
		expect(inventory._validateCustomItemDraft({...draft,
			options: {...draft.options,
				itemPowers: [speed, {...speed, id: "second"}]}}).map(error => error.code)).toContain("ambiguousSpeedPower");
	});

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

	test.each([
		["charged", {chargesCost: 1}, {charges: 4, chargesCurrent: 3}],
		["limited", {usesMax: 2, usageType: "daily", usesKey: "daily:reference"}, {}],
	])("an explicit reference-only %s power stays inert through form serialization, edit, clone and reload", (_label, resource, itemFields) => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const originalPower = {
			id: "manual-resolution",
			name: "Resolve manually",
			kind: "ability",
			actionType: "bonus",
			isReferenceOnly: true,
			...resource,
		};
		state.addItem({
			id: "reference-item",
			name: "Mystery Relic",
			source: "Custom",
			_isCustom: true,
			type: "wondrous",
			equipped: true,
			itemPowers: [originalPower],
			...itemFields,
		});
		const seed = inventory._seedOptionsFromItem(state.getItemRaw("reference-item"));
		const collectedPowers = inventory._serializeCustomItemPowers(seed.options.itemPowers);
		expect(collectedPowers).toEqual([expect.objectContaining(originalPower)]);
		const baseline = {
			name: seed.name,
			quantity: seed.quantity,
			weight: seed.weight,
			options: {...seed.options, itemPowers: collectedPowers},
		};
		editorSave(inventory, {...baseline, name: "Retitled Relic"}, {editItemId: "reference-item", baseline});
		const edited = state.getItemRaw("reference-item");
		expect(edited.itemPowers).toEqual([expect.objectContaining(originalPower)]);
		expect(state.getItemPower("reference-item", originalPower.id)).toMatchObject({
			isReferenceOnly: true,
			isAvailable: false,
			unavailableReason: "Rules reference only; resolve this effect manually.",
		});
		expect(state.invokeItemPower("reference-item", originalPower.id).ok).toBe(false);

		const cloneId = editorSave(inventory, {...baseline, name: "Copied Relic"}, {
			baseItem: edited,
			baseline,
		});
		expect(state.getItemRaw(cloneId).itemPowers).toEqual([expect.objectContaining(originalPower)]);
		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getItemPower(cloneId, originalPower.id)).toMatchObject({
			isReferenceOnly: true,
			isAvailable: false,
		});
		expect(restored.invokeItemPower(cloneId, originalPower.id).ok).toBe(false);
		expect(restored.getItemRaw("reference-item").chargesCurrent).toBe(itemFields.chargesCurrent);
	});

	test("explicit reference-only and missing flags remain distinct when switching or clearing powers", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const reference = {
			id: "manual",
			name: "Manual effect",
			kind: "ability",
			chargesCost: 1,
			isReferenceOnly: true,
		};
		state.addItem({
			id: "flagged",
			name: "Charged Relic",
			source: "Custom",
			_isCustom: true,
			type: "wondrous",
			charges: 4,
			chargesCurrent: 4,
			equipped: true,
			itemPowers: [reference],
		});
		const baseline = {
			name: "Charged Relic",
			quantity: 1,
			weight: 0,
			options: {...inventory._seedOptionsFromItem(state.getItemRaw("flagged")).options,
				itemPowers: inventory._serializeCustomItemPowers([reference])},
		};
		const operational = {...reference, isReferenceOnly: false};
		editorSave(inventory, {...baseline,
			options: {...baseline.options, itemPowers: inventory._serializeCustomItemPowers([operational])}},
		{editItemId: "flagged", baseline});
		expect(state.getItemPower("flagged", reference.id)).toMatchObject({
			isReferenceOnly: false, isAvailable: true,
		});
		expect(state.invokeItemPower("flagged", reference.id).ok).toBe(true);
		expect(state.getItemRaw("flagged").chargesCurrent).toBe(3);

		const operationalBaseline = {...baseline,
			options: {...baseline.options, itemPowers: inventory._serializeCustomItemPowers([operational])}};
		editorSave(inventory, baseline, {editItemId: "flagged", baseline: operationalBaseline});
		expect(state.getItemPower("flagged", reference.id)).toMatchObject({
			isReferenceOnly: true, isAvailable: false,
		});
		expect(state.invokeItemPower("flagged", reference.id).ok).toBe(false);
		expect(state.getItemRaw("flagged").chargesCurrent).toBe(3);

		editorSave(inventory, {...baseline, options: {...baseline.options, itemPowers: []}},
			{editItemId: "flagged", baseline});
		expect(state.getItemRaw("flagged").itemPowers).toEqual([]);

		const legacyPower = {id: "legacy", name: "Legacy charged effect", kind: "ability", chargesCost: 1};
		expect(inventory._serializeCustomItemPowers([legacyPower])).toEqual([
			expect.objectContaining({id: "legacy", isReferenceOnly: false}),
		]);
	});

	test("a failed replacement restores the Ioun host before its base bonuses were dematerialised", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		state.addItem({id: "ioun-host",
			name: "Ioun Blade",
			source: "Custom",
			type: "M",
			weapon: true,
			dmg1: "1d8",
			bonusWeapon: 1});
		const host = state._data.inventory[0].item;
		host.bonusWeapon = 3;
		host.iounBaseBonuses = {bonusWeapon: 1};
		const before = state.toJson();
		const baseline = {name: "Ioun Blade",
			quantity: 1,
			weight: 0,
			options: {type: "weapon", dmg1: "1d8", bonusWeapon: 1}};
		jest.spyOn(state, "replaceItem").mockReturnValue(false);

		expect(() => editorSave(inventory, {...baseline, name: "Renamed Ioun Blade"},
			{editItemId: "ioun-host", baseline})).toThrow(/could not be updated/);
		expect(state.toJson()).toEqual(before);
		expect(inventory._page.renderCharacter).not.toHaveBeenCalled();
		expect(inventory._page.saveCharacter).not.toHaveBeenCalled();
	});

	test("a failed upgrade application restores the item, quantity, and derived character state", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		state.addItem({id: "upgraded",
			name: "Old Armor",
			source: "Custom",
			type: "HA",
			armor: true,
			armorType: "heavy",
			ac: 16,
			equipped: true,
			quantity: 2});
		const before = state.toJson();
		const baseline = {name: "Old Armor",
			quantity: 2,
			weight: 0,
			options: {type: "armor", ac: 16, _pendingUpgrades: []}};
		jest.spyOn(inventory, "_applyEditUpgrades").mockImplementation(() => {
			state.setItemQuantity("upgraded", 5);
			throw new Error("Upgrade application failed");
		});

		expect(() => editorSave(inventory, {...baseline, name: "New Armor"},
			{editItemId: "upgraded", baseline})).toThrow("Upgrade application failed");
		expect(state.toJson()).toEqual(before);
		expect(inventory._page.renderCharacter).not.toHaveBeenCalled();
		expect(inventory._page.saveCharacter).not.toHaveBeenCalled();
	});

	test("a failed creation upgrade does not leave an orphan item in the inventory", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const before = state.toJson();
		jest.spyOn(inventory, "_applyCreationUpgrades").mockImplementation(() => {
			throw new Error("Gemstone application failed");
		});

		expect(() => editorSave(inventory, {name: "Failed Blade",
			quantity: 1,
			weight: 1,
			options: {type: "weapon", dmg1: "1d8", _pendingGemstone: {name: "Ruby", source: "TGTT"}}}))
			.toThrow("Gemstone application failed");
		expect(state.toJson()).toEqual(before);
		expect(inventory._page.renderCharacter).not.toHaveBeenCalled();
		expect(inventory._page.saveCharacter).not.toHaveBeenCalled();
	});

	test("a rejected persisted save restores the original item and the previous rescue mirror", async () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		state.addItem({id: "saved",
			name: "Original Blade",
			source: "Custom",
			_isCustom: true,
			type: "M",
			weapon: true,
			dmg1: "1d8",
			equipped: true});
		const baseline = {name: "Original Blade",
			quantity: 1,
			weight: 0,
			options: inventory._seedOptionsFromItem(state.getItemRaw("saved")).options};
		const before = state.toJson();
		const previousMirror = {id: "current", _savedAt: 123, inventory: before.inventory};
		inventory._page._currentCharacterId = "current";
		inventory._page._readActiveCharacterMirror = jest.fn(() => previousMirror);
		inventory._page._writeActiveCharacterMirror = jest.fn();
		inventory._page.saveCharacter.mockResolvedValue(false);
		const toast = jest.spyOn(JqueryUtil, "doToast");

		await expect(inventory._pSaveCustomItem("Changed Blade", 1, 0, baseline.options, "saved",
			{baseline})).rejects.toThrow(/could not be saved/);
		expect(state.toJson()).toEqual(before);
		expect(inventory._page._writeActiveCharacterMirror).toHaveBeenCalledWith(previousMirror);
		expect(inventory._page.renderCharacter).toHaveBeenCalledTimes(2);
		expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({type: "success"}));
		toast.mockRestore();
	});

	test("a successful in-place edit retains live wrapper links, material base, resources, and active power ID", () => {
		const state = new CharacterSheetState();
		const inventory = makeInventory(state);
		const speed = {
			id: "swift-step",
			name: "Swift Step",
			kind: "toggle",
			isToggle: true,
			effectType: "modifySpeed",
			actionType: "bonus",
			isReferenceOnly: false,
		};
		state.addItem({
			id: "held",
			name: "Swift Blade",
			source: "Custom",
			_isCustom: true,
			type: "M",
			weapon: true,
			dmg1: "1d8",
			dmgType: "S",
			bonusAc: 1,
			weight: 2,
			requiresAttunement: true,
			modifySpeed: {multiply: {walk: 2}},
			itemPowers: [speed],
			charges: 5,
			chargesCurrent: 2,
			material: {name: "Steel", source: "TGTT"},
		}, 3, true, true);
		state.addItem({id: "nested", name: "Gem", source: "Custom", type: "G"});
		const wrapper = state._data.inventory.find(row => row.id === "held");
		wrapper.starred = true;
		wrapper.note = "belongs to the party";
		wrapper.item.containedItems = ["nested"];
		wrapper.item.appliedUpgrades = [{name: "Keen", source: "TGTT"}];
		wrapper.item.socketedGemstones = [{name: "Ruby", source: "TGTT"}];
		wrapper.item.itemPowerStates = {"swift-step": {active: true}};
		inventory._updateItemBonuses(state.getItems());
		const before = state.getItemRaw("held");
		expect(state.getSpeed("walk")).toBe(60);
		const baseline = {name: before.name,
			quantity: 3,
			weight: 2,
			options: inventory._seedOptionsFromItem(before).options};

		editorSave(inventory, {...baseline, name: "Renamed Swift Blade"},
			{editItemId: "held", baseline});
		const after = state.getItemRaw("held");
		expect(after).toMatchObject({
			id: "held",
			name: "Renamed Swift Blade",
			quantity: 3,
			equipped: true,
			attuned: true,
			starred: true,
			containedItems: ["nested"],
			appliedUpgrades: [{name: "Keen", source: "TGTT"}],
			socketedGemstones: [{name: "Ruby", source: "TGTT"}],
			material: {name: "Steel", source: "TGTT"},
			itemPowerStates: {"swift-step": {active: true}},
			chargesCurrent: 2,
		});
		expect(state.getItemNote("held")).toBe("belongs to the party");
		expect(state.getSpeed("walk")).toBe(60);
		expect(state.getTotalWeight()).toBeGreaterThan(0);
		expect(state.getItemRaw("held").bonusAc).toBe(1);
		expect(state.getAC()).toBe(11);
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getItemRaw("held").itemPowerStates["swift-step"].active).toBe(true);
		expect(loaded.getItemNote("held")).toBe("belongs to the party");
	});
});
