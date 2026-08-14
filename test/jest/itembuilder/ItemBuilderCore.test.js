import "../charactersheet/setup.js";
import {ItemBuilderCore} from "../../../js/itembuilder/itembuilder-core.js";
import {
	getEligibleUpgrades,
	getGemstoneDescriptor,
	isArmor,
	isShield,
	isSocketable,
	isWeapon,
} from "../../../js/itembuilder/itembuilder-upgrade-rules.js";

const ITEMS = [{
	name: "Longsword",
	source: "PHB",
	type: "M",
	rarity: "none",
	weapon: true,
	dmg1: "1d8",
	dmg2: "1d10",
	dmgType: "S",
	weight: 3,
	value: 1500,
	entries: ["A martial melee weapon."],
}];

const MATERIALS = [{
	name: "Starsteel",
	source: "TGTT",
	appliesTo: ["weapon"],
	damage: 1,
	entries: ["Starsteel holds an impossibly keen edge."],
}];

const UPGRADES = [
	{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], entries: ["You gain a +1 bonus to attack rolls made with this weapon."]},
	{name: "Journey", source: "TGTT", upgradeType: ["GS:R"], entries: ["The gemstone hums on distant roads."]},
];

describe("ItemBuilderCore", () => {
	test("normalizes legacy canonical items into a versioned draft", () => {
		const draft = ItemBuilderCore.normalizeDraft({name: "Legacy", source: "HB", type: "W"});
		expect(draft.version).toBe(ItemBuilderCore.VERSION);
		expect(draft.item).toEqual(expect.objectContaining({name: "Legacy", source: "HB", type: "W"}));
		expect(draft.upgrades).toEqual([]);
	});

	test("deduplicates catalog entities by case-insensitive UID", () => {
		const entities = ItemBuilderCore.dedupeCatalog([
			{name: "Adamant", source: "TGTT", marker: "site"},
			{name: "adamant", source: "tgtt", marker: "brew"},
			{name: "Adamant", source: "ALT", marker: "other source"},
		]);

		expect(entities).toEqual([
			{name: "Adamant", source: "TGTT", marker: "site"},
			{name: "Adamant", source: "ALT", marker: "other source"},
		]);
	});

	test("materializes a preset, material, upgrade, and gemstone without mutating inputs", () => {
		const preset = structuredClone(ITEMS[0]);
		let draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), preset, {source: "HB"});
		draft.item.name = "Wayfarer's Starblade";
		draft.material = {name: "Starsteel", source: "TGTT"};
		draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		draft.gemstone = {name: "Journey", source: "TGTT"};

		const out = ItemBuilderCore.serialize(draft, {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES});

		expect(out).toEqual(expect.objectContaining({
			name: "Wayfarer's Starblade",
			source: "HB",
			baseItem: "Longsword|PHB",
			type: "M|PHB",
			dmg1: "1d10",
			bonusWeaponAttack: 1,
			material: {name: "Starsteel", source: "TGTT"},
		}));
		expect(out.appliedUpgrades[0]).toEqual(expect.objectContaining({name: "Balanced", source: "TCAH"}));
		expect(out.socketedGemstones[0]).toEqual(expect.objectContaining({name: "Journey", source: "TGTT"}));
		expect(out.effects).toContainEqual(expect.objectContaining({type: "speedBonus", value: 10}));
		expect(out.entries.map(it => it?.name).filter(Boolean)).toEqual(expect.arrayContaining([
			"Item Builder: Material - Starsteel",
			"Item Builder: Upgrade - Balanced",
			"Item Builder: Gem - Journey",
		]));
		expect(preset).toEqual(ITEMS[0]);
		expect(MATERIALS[0]).not.toHaveProperty("_materialEffects");
	});

	test("serializing the same draft is deterministic and does not compound bonuses", () => {
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), ITEMS[0], {source: "HB"});
		draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		const catalogs = {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES};
		expect(ItemBuilderCore.serialize(draft, catalogs)).toEqual(ItemBuilderCore.serialize(draft, catalogs));
		expect(ItemBuilderCore.serialize(draft, catalogs).bonusWeaponAttack).toBe(1);
	});

	test("re-importing a serialized item is idempotent", () => {
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), ITEMS[0], {source: "HB"});
		draft.material = {name: "Starsteel", source: "TGTT"};
		draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		draft.gemstone = {name: "Journey", source: "TGTT"};
		const catalogs = {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES};
		const first = ItemBuilderCore.serialize(draft, catalogs);

		expect(ItemBuilderCore.serialize(ItemBuilderCore.fromItem(first), catalogs)).toEqual(first);
	});

	test("changing a re-imported composition removes old projections", () => {
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), ITEMS[0], {source: "HB"});
		draft.material = {name: "Starsteel", source: "TGTT"};
		draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		draft.gemstone = {name: "Journey", source: "TGTT"};
		const catalogs = {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES};
		const reimported = ItemBuilderCore.fromItem(ItemBuilderCore.serialize(draft, catalogs));
		reimported.material = null;
		reimported.upgrades = [];
		reimported.gemstone = null;
		reimported.item.name = "Reworked Blade";

		const reworked = ItemBuilderCore.serialize(reimported, catalogs);

		expect(reworked).toEqual(expect.objectContaining({
			name: "Reworked Blade",
			weight: ITEMS[0].weight,
			value: ITEMS[0].value,
			dmg1: ITEMS[0].dmg1,
		}));
		expect(reworked).not.toHaveProperty("bonusWeaponAttack");
		expect(reworked).not.toHaveProperty("material");
		expect(reworked).not.toHaveProperty("appliedUpgrades");
		expect(reworked).not.toHaveProperty("socketedGemstones");
		expect(reworked).not.toHaveProperty("effects");
	});

	test("reports field errors and preserves unresolved references as warnings", () => {
		const draft = ItemBuilderCore.createDraft();
		draft.item.name = "";
		draft.material = {name: "Missing", source: "HB"};
		const result = ItemBuilderCore.validate(draft, {materials: []});
		expect(result.isValid).toBe(false);
		expect(result.errors).toContainEqual(expect.objectContaining({field: "name"}));
		expect(result.errors).toContainEqual(expect.objectContaining({field: "source"}));
		expect(result.warnings).toContainEqual(expect.objectContaining({field: "material"}));
	});

	test("restores provenance from an emitted item", () => {
		const item = {
			name: "Restored",
			source: "HB",
			type: "M|PHB",
			baseItem: "Longsword|PHB",
			material: {name: "Starsteel", source: "TGTT"},
			appliedUpgrades: [{name: "Balanced", source: "TCAH"}],
			socketedGemstones: [{name: "Journey", source: "TGTT"}],
		};
		const draft = ItemBuilderCore.fromItem(item);
		expect(draft.preset).toEqual({name: "Longsword", source: "PHB"});
		expect(draft.material).toEqual(item.material);
		expect(draft.upgrades).toEqual(item.appliedUpgrades);
		expect(draft.gemstone).toEqual(item.socketedGemstones[0]);
	});
});

describe("shared item upgrade rules", () => {
	test("recognizes canonical type codes with source suffixes", () => {
		expect(isWeapon({type: "M|PHB"})).toBe(true);
		expect(isArmor({type: "HA|PHB"})).toBe(true);
		expect(isShield({type: "S|PHB"})).toBe(true);
		expect(isSocketable({type: "R|PHB"})).toBe(true);
	});

	test("filters upgrade types and applied upgrades", () => {
		const eligible = getEligibleUpgrades({
			item: {type: "M|PHB", appliedUpgrades: [{name: "Balanced"}]},
			upgrades: [
				...UPGRADES,
				{name: "Superior", source: "TCAH", upgradeType: ["WU:2"]},
				{name: "Reinforced", source: "TCAH", upgradeType: ["AU"]},
			],
		});
		expect(eligible.map(it => it.name)).toEqual(["Superior"]);
	});

	test("returns defensive copies of gemstone descriptors", () => {
		const first = getGemstoneDescriptor({name: "Journey"});
		first.effects[0].value = 999;
		expect(getGemstoneDescriptor({name: "Journey"}).effects[0].value).toBe(10);
	});
});
