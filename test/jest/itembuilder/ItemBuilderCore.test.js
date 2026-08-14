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
	{name: "Superior", source: "TCAH", upgradeType: ["WU:2"], entries: ["Increase the weapon's damage die by one size."]},
	{name: "Journey", source: "TGTT", upgradeType: ["GS:R"], entries: ["The gemstone hums on distant roads."]},
	{name: "Arrow-Catcher", source: "TGTT", upgradeType: ["GS:R"], entries: ["The gemstone catches arrows."]},
];

describe("ItemBuilderCore", () => {
	test("normalizes legacy canonical items into a versioned draft", () => {
		const draft = ItemBuilderCore.normalizeDraft({name: "Legacy", source: "HB", type: "W"});
		expect(draft.version).toBe(ItemBuilderCore.VERSION);
		expect(draft.item).toEqual(expect.objectContaining({name: "Legacy", source: "HB", type: "W"}));
		expect(draft.upgrades).toEqual([]);
	});

	test("normalizes malformed restored collections before validation and serialization", () => {
		const malformed = {
			item: {
				name: "Restored",
				source: "HB",
				type: "W",
				entries: {},
				additionalEntries: "invalid",
				properties: null,
				property: 42,
				attachedSpells: {},
				focus: "wizard",
				effects: false,
				itemPowers: {},
				appliedUpgrades: "Balanced",
				socketedGemstones: {},
			},
			material: {name: "Malformed Material", entries: "invalid", appliesTo: "weapon"},
			upgrades: {name: "Balanced"},
			gemstone: {name: "Journey", upgradeType: "GS:R", entries: {}},
			materialized: {
				item: {entries: null, effects: "invalid", appliedUpgrades: {}, socketedGemstones: "invalid"},
				material: {name: "Old Material", entries: "invalid"},
				upgrades: "invalid",
				gemstone: {name: "Old Gem", effects: {}},
			},
		};

		const draft = ItemBuilderCore.normalizeDraft(malformed);

		for (const prop of ["entries", "additionalEntries", "properties", "property", "attachedSpells", "focus", "effects", "itemPowers", "appliedUpgrades", "socketedGemstones"]) {
			expect(draft.item[prop]).toEqual([]);
		}
		expect(draft.upgrades).toEqual([]);
		expect(draft.material).toEqual(expect.objectContaining({entries: [], appliesTo: []}));
		expect(draft.gemstone).toEqual(expect.objectContaining({upgradeType: [], entries: []}));
		expect(draft.materialized.item).toEqual(expect.objectContaining({entries: [], effects: [], appliedUpgrades: [], socketedGemstones: []}));
		expect(draft.materialized.upgrades).toEqual([]);
		expect(draft.materialized.gemstone.effects).toEqual([]);
		expect(() => ItemBuilderCore.validate(draft)).not.toThrow();
		expect(() => ItemBuilderCore.serialize(draft)).not.toThrow();
	});

	test("preserves canonical collection data while normalizing nested composition fields", () => {
		const saved = {
			item: {
				name: "Canonical",
				source: "HB",
				type: "M",
				entries: ["Description"],
				additionalEntries: [{type: "entries", entries: ["More"]}],
				property: ["F"],
				attachedSpells: ["fireball|phb"],
				focus: ["Wizard"],
				effects: [{type: "itemTag", tag: "Magical"}],
				itemPowers: [{id: "power", name: "Power"}],
			},
			upgrades: [{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], prerequisite: [{item: ["any weapon"]}], entries: ["Effect"]}],
			gemstone: {name: "Journey", source: "TGTT", upgradeType: ["GS:R"], effects: [{type: "speedBonus", value: 10}]},
		};

		const draft = ItemBuilderCore.normalizeDraft(saved);

		expect(draft.item.entries).toEqual(saved.item.entries);
		expect(draft.item.additionalEntries).toEqual(saved.item.additionalEntries);
		expect(draft.item.property).toEqual(saved.item.property);
		expect(draft.item.attachedSpells).toEqual(saved.item.attachedSpells);
		expect(draft.item.focus).toEqual(saved.item.focus);
		expect(draft.item.effects).toEqual(saved.item.effects);
		expect(draft.item.itemPowers).toEqual(saved.item.itemPowers);
		expect(draft.upgrades).toEqual(saved.upgrades);
		expect(draft.gemstone).toEqual(saved.gemstone);
	});

	test("preserves the canonical boolean spellcasting focus flag", () => {
		const draft = ItemBuilderCore.normalizeDraft({
			item: {name: "Focus", source: "HB", type: "SCF", focus: true},
		});

		expect(draft.item.focus).toBe(true);
		expect(ItemBuilderCore.serialize(draft).focus).toBe(true);
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

	test("keeps canonical composition reference-only and projects mechanics for previews", () => {
		const preset = structuredClone(ITEMS[0]);
		let draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), preset, {source: "HB"});
		draft.item.name = "Wayfarer's Starblade";
		draft.material = {name: "Starsteel", source: "TGTT"};
		draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		draft.gemstone = {name: "Journey", source: "TGTT"};

		const catalogs = {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES};
		const out = ItemBuilderCore.serialize(draft, catalogs);

		expect(out).toEqual(expect.objectContaining({
			name: "Wayfarer's Starblade",
			source: "HB",
			baseItem: "Longsword|PHB",
			type: "M|PHB",
			dmg1: "1d8",
			material: {name: "Starsteel", source: "TGTT"},
		}));
		expect(out.appliedUpgrades).toEqual([{name: "Balanced", source: "TCAH"}]);
		expect(out.socketedGemstones).toEqual([{name: "Journey", source: "TGTT"}]);
		expect(out).not.toHaveProperty("bonusWeaponAttack");
		expect(out).not.toHaveProperty("effects");
		expect(out.entries.map(it => it?.name).filter(Boolean)).not.toEqual(expect.arrayContaining([
			"Item Builder: Material - Starsteel",
			"Item Builder: Upgrade - Balanced",
			"Item Builder: Gem - Journey",
		]));

		const preview = ItemBuilderCore.projectForPreview(draft, catalogs);
		expect(preview).toEqual(expect.objectContaining({dmg1: "1d10", bonusWeaponAttack: 1}));
		expect(preview.effects).toContainEqual(expect.objectContaining({type: "speedBonus", value: 10}));
		expect(preview.entries.map(it => it?.name).filter(Boolean)).toEqual(expect.arrayContaining([
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
		expect(ItemBuilderCore.serialize(draft, catalogs)).not.toHaveProperty("bonusWeaponAttack");
		expect(ItemBuilderCore.projectForPreview(draft, catalogs).bonusWeaponAttack).toBe(1);
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

	test("normalizes an already-projected legacy builder item without cumulative drift", () => {
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), ITEMS[0], {source: "HB"});
		draft.material = {name: "Starsteel", source: "TGTT"};
		draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		draft.gemstone = {name: "Journey", source: "TGTT"};
		const catalogs = {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES};
		const legacyProjected = ItemBuilderCore.projectForPreview(draft, catalogs);

		const canonical = ItemBuilderCore.serialize(ItemBuilderCore.fromItem(legacyProjected), catalogs);

		expect(canonical.dmg1).toBe("1d8");
		expect(canonical).not.toHaveProperty("bonusWeaponAttack");
		expect(canonical).not.toHaveProperty("effects");
		expect(ItemBuilderCore.projectForPreview(ItemBuilderCore.fromItem(canonical), catalogs)).toEqual(legacyProjected);
	});

	test("deprojects additive authored overrides from legacy materialized items idempotently", () => {
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), ITEMS[0], {source: "HB"});
		draft.item.bonusWeaponAttack = 2;
		draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		const catalogs = {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES};
		const legacyProjected = ItemBuilderCore.projectForPreview(draft, catalogs);
		expect(legacyProjected.bonusWeaponAttack).toBe(3);

		const canonical = ItemBuilderCore.serialize(ItemBuilderCore.fromItem(legacyProjected), catalogs);
		expect(canonical.bonusWeaponAttack).toBe(2);
		expect(ItemBuilderCore.projectForPreview(ItemBuilderCore.fromItem(canonical), catalogs).bonusWeaponAttack).toBe(3);

		const secondCanonical = ItemBuilderCore.serialize(
			ItemBuilderCore.fromItem(ItemBuilderCore.projectForPreview(ItemBuilderCore.fromItem(canonical), catalogs)),
			catalogs,
		);
		expect(secondCanonical).toEqual(canonical);
	});

	test("deprojects material and upgrade damage-die overrides without repeated drift", () => {
		const preset = {...ITEMS[0]};
		delete preset.dmg2;
		const catalogs = {items: [preset], materials: MATERIALS, upgrades: UPGRADES};
		for (const composition of [
			{material: {name: "Starsteel", source: "TGTT"}},
			{upgrades: [{name: "Superior", source: "TCAH"}]},
		]) {
			const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), preset, {source: "HB"});
			draft.item.dmg1 = "1d8";
			Object.assign(draft, composition);
			const legacyProjected = ItemBuilderCore.projectForPreview(draft, catalogs);
			expect(legacyProjected.dmg1).toBe("1d10");

			const canonical = ItemBuilderCore.serialize(ItemBuilderCore.fromItem(legacyProjected), catalogs);
			expect(canonical.dmg1).toBe("1d8");
			expect(ItemBuilderCore.projectForPreview(ItemBuilderCore.fromItem(canonical), catalogs).dmg1).toBe("1d10");
			expect(ItemBuilderCore.serialize(ItemBuilderCore.fromItem(canonical), catalogs)).toEqual(canonical);
		}
	});

	test.each([
		{
			label: "a clamped Gold damage reduction",
			item: {dmg1: "1d4"},
			composition: {material: {name: "Gold", source: "TGTT"}},
			expectedProjected: {dmg1: "1d4"},
			expectedField: "dmg1",
		},
		{
			label: "a saturated Gold critical threshold",
			item: {critThreshold: 19},
			composition: {material: {name: "Gold", source: "TGTT"}},
			expectedProjected: {critThreshold: 20},
			expectedField: "critThreshold",
		},
		{
			label: "a clamped Superior damage increase",
			item: {dmg1: "1d12"},
			composition: {upgrades: [{name: "Superior", source: "TCAH"}]},
			expectedProjected: {dmg1: "1d12"},
			expectedField: "dmg1",
		},
	])("blocks legacy deprojection of $label without guessing an authored base", ({
		item,
		composition,
		expectedProjected,
		expectedField,
	}) => {
		const gold = {
			name: "Gold",
			source: "TGTT",
			appliesTo: ["weapon"],
			damage: -1,
			critical: -1,
			entries: ["Gold is soft."],
		};
		const catalogs = {items: ITEMS, materials: [...MATERIALS, gold], upgrades: UPGRADES};
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), ITEMS[0], {source: "HB"});
		Object.assign(draft.item, item);
		Object.assign(draft, composition);
		const legacyProjected = ItemBuilderCore.projectForPreview(draft, catalogs);
		expect(legacyProjected).toEqual(expect.objectContaining(expectedProjected));
		const restored = ItemBuilderCore.fromItem(legacyProjected);

		const validation = ItemBuilderCore.validate(restored, catalogs);
		expect(validation.isValid).toBe(false);
		expect(validation.errors).toContainEqual(expect.objectContaining({
			field: expectedField,
			message: expect.stringMatching(/cannot be uniquely reversed/i),
		}));

		const failSafe = ItemBuilderCore.serialize(restored, catalogs);
		expect(failSafe).toEqual(expect.objectContaining(expectedProjected));
		expect(failSafe.entries).toEqual(legacyProjected.entries);
		expect(failSafe).not.toHaveProperty("baseItem");
		expect(failSafe).not.toHaveProperty("material");
		expect(failSafe).not.toHaveProperty("appliedUpgrades");
		expect(failSafe).not.toHaveProperty("socketedGemstones");
	});

	test("deprojects an ordinary invertible legacy damage transformation exactly once", () => {
		const catalogs = {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES};
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), ITEMS[0], {source: "HB"});
		draft.material = {name: "Starsteel", source: "TGTT"};
		const legacyProjected = ItemBuilderCore.projectForPreview(draft, catalogs);
		expect(legacyProjected.dmg1).toBe("1d10");
		const restored = ItemBuilderCore.fromItem(legacyProjected);

		expect(ItemBuilderCore.validate(restored, catalogs).isValid).toBe(true);
		const canonical = ItemBuilderCore.serialize(restored, catalogs);
		expect(canonical.dmg1).toBe("1d8");
		expect(ItemBuilderCore.serialize(ItemBuilderCore.fromItem(canonical), catalogs)).toEqual(canonical);
	});

	test("blocks a saturated legacy gemstone charge maximum", () => {
		const catalogs = {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES};
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), ITEMS[0], {source: "HB"});
		draft.item.charges = 2;
		draft.gemstone = {name: "Arrow-Catcher", source: "TGTT"};
		const legacyProjected = ItemBuilderCore.projectForPreview(draft, catalogs);
		expect(legacyProjected.charges).toBe(3);
		const restored = ItemBuilderCore.fromItem(legacyProjected);

		const validation = ItemBuilderCore.validate(restored, catalogs);
		expect(validation.isValid).toBe(false);
		expect(validation.errors).toContainEqual(expect.objectContaining({
			field: "charges",
			message: expect.stringMatching(/cannot be uniquely reversed/i),
		}));
		expect(ItemBuilderCore.serialize(restored, catalogs)).toEqual(expect.objectContaining({charges: 3}));
	});

	test("deprojects invertible material properties while preserving authored bases", () => {
		const preset = {
			...ITEMS[0],
			type: "R",
			range: "80/320",
			property: ["A"],
			weight: 4,
			value: 100,
		};
		const material = {
			name: "Swiftglass",
			source: "HB",
			appliesTo: ["weapon"],
			weightMultiplier: 0.5,
			price: {unit: "lb", gp: 2},
			effects: [
				{type: "addProperty", properties: ["F"]},
				{type: "rangeMultiplier", value: 2},
				{type: "bonusWeaponDamage", value: 1},
			],
		};
		const catalogs = {items: [preset], materials: [material], upgrades: []};
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), preset, {source: "HB"});
		Object.assign(draft.item, {
			range: "100/400",
			property: ["A", "L"],
			weight: 6,
			value: 200,
			bonusWeaponDamage: 2,
		});
		draft.material = {name: material.name, source: material.source};
		const legacyProjected = ItemBuilderCore.projectForPreview(draft, catalogs);
		expect(legacyProjected).toEqual(expect.objectContaining({
			range: "200/800",
			property: ["A", "L", "F"],
			weight: 3,
			value: 800,
			bonusWeaponDamage: 3,
		}));

		const canonical = ItemBuilderCore.serialize(ItemBuilderCore.fromItem(legacyProjected), catalogs);
		expect(canonical).toEqual(expect.objectContaining({
			range: "100/400",
			property: ["A", "L"],
			weight: 6,
			value: 200,
			bonusWeaponDamage: 2,
		}));
		expect(ItemBuilderCore.projectForPreview(ItemBuilderCore.fromItem(canonical), catalogs)).toEqual(legacyProjected);
	});

	test("deprojects material property ladders to the authored property set", () => {
		const preset = {...ITEMS[0], property: ["2H"]};
		const material = {
			name: "Mithril",
			source: "HB",
			appliesTo: ["weapon"],
			effects: [
				{type: "removeProperty", properties: ["H"]},
				{type: "propertyLadder", ladder: {"2H": "V", "_": "L", "L": "F"}},
			],
		};
		const catalogs = {items: [preset], materials: [material], upgrades: []};
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), preset, {source: "HB"});
		draft.item.property = ["L"];
		draft.material = {name: material.name, source: material.source};
		const legacyProjected = ItemBuilderCore.projectForPreview(draft, catalogs);
		expect(legacyProjected.property).toEqual(["L", "F"]);

		const canonical = ItemBuilderCore.serialize(ItemBuilderCore.fromItem(legacyProjected), catalogs);
		expect(canonical.property).toEqual(["L"]);
		expect(ItemBuilderCore.projectForPreview(ItemBuilderCore.fromItem(canonical), catalogs).property).toEqual(["L", "F"]);
		expect(ItemBuilderCore.serialize(ItemBuilderCore.fromItem(canonical), catalogs)).toEqual(canonical);
	});

	test("deprojects generated gemstone resources without dropping authored maxima", () => {
		const catalogs = {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES};
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), ITEMS[0], {source: "HB"});
		draft.item.charges = 5;
		draft.gemstone = {name: "Arrow-Catcher", source: "TGTT"};
		const legacyProjected = ItemBuilderCore.projectForPreview(draft, catalogs);
		expect(legacyProjected).toEqual(expect.objectContaining({
			charges: 5,
			recharge: "dawn",
			rechargeAmount: "{@dice 1d3}",
		}));

		const canonical = ItemBuilderCore.serialize(ItemBuilderCore.fromItem(legacyProjected), catalogs);
		expect(canonical.charges).toBe(5);
		expect(canonical).not.toHaveProperty("recharge");
		expect(canonical).not.toHaveProperty("rechargeAmount");
		expect(ItemBuilderCore.projectForPreview(ItemBuilderCore.fromItem(canonical), catalogs)).toEqual(legacyProjected);
		expect(ItemBuilderCore.serialize(ItemBuilderCore.fromItem(canonical), catalogs)).toEqual(canonical);
	});

	test("preserves explicit authored mechanics while projecting composition around them", () => {
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), ITEMS[0], {source: "HB"});
		draft.item.bonusWeaponAttack = 2;
		draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		const catalogs = {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES};

		const canonical = ItemBuilderCore.serialize(draft, catalogs);

		expect(canonical.bonusWeaponAttack).toBe(2);
		expect(ItemBuilderCore.projectForPreview(draft, catalogs).bonusWeaponAttack).toBe(3);
		expect(ItemBuilderCore.serialize(ItemBuilderCore.fromItem(canonical), catalogs).bonusWeaponAttack).toBe(2);
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

	test("keeps unresolved non-legacy provenance as warnings and serialized references", () => {
		const item = {
			name: "Unavailable Composition",
			source: "HB",
			type: "M|PHB",
			baseItem: "Missing Blade|HB",
			material: {name: "Missing Material", source: "HB"},
			appliedUpgrades: [{name: "Missing Upgrade", source: "HB"}],
			socketedGemstones: [{name: "Missing Gem", source: "HB"}],
		};
		const draft = ItemBuilderCore.fromItem(item);
		const validation = ItemBuilderCore.validate(draft, {items: [], materials: [], upgrades: []});

		expect(validation.isValid).toBe(true);
		expect(validation.errors).toEqual([]);
		expect(validation.warnings.map(it => it.field)).toEqual(["preset", "material", "upgrades", "gemstone"]);
		expect(ItemBuilderCore.serialize(draft, {items: [], materials: [], upgrades: []})).toEqual(expect.objectContaining(item));
	});

	test("blocks unresolved legacy deprojection and serializes without active provenance", () => {
		const catalogs = {items: ITEMS, materials: MATERIALS, upgrades: UPGRADES};
		const draft = ItemBuilderCore.applyPreset(ItemBuilderCore.createDraft({source: "HB"}), ITEMS[0], {source: "HB"});
		draft.material = {name: "Starsteel", source: "TGTT"};
		draft.upgrades = [{name: "Balanced", source: "TCAH"}];
		draft.gemstone = {name: "Journey", source: "TGTT"};
		const legacyProjected = ItemBuilderCore.projectForPreview(draft, catalogs);
		const restored = ItemBuilderCore.fromItem(legacyProjected);
		const unresolvedCatalogs = {items: [], materials: [], upgrades: []};

		const validation = ItemBuilderCore.validate(restored, unresolvedCatalogs);
		expect(validation.isValid).toBe(false);
		expect(validation.errors).toEqual(expect.arrayContaining([
			expect.objectContaining({field: "preset", message: expect.stringMatching(/legacy projected item/i)}),
			expect.objectContaining({field: "material", message: expect.stringMatching(/legacy projected item/i)}),
			expect.objectContaining({field: "upgrades", message: expect.stringMatching(/legacy projected item/i)}),
			expect.objectContaining({field: "gemstone", message: expect.stringMatching(/legacy projected item/i)}),
		]));
		expect(restored.material).toEqual({name: "Starsteel", source: "TGTT"});
		expect(restored.upgrades).toEqual([{name: "Balanced", source: "TCAH"}]);
		expect(restored.gemstone).toEqual({name: "Journey", source: "TGTT"});

		const failSafe = ItemBuilderCore.serialize(restored, unresolvedCatalogs);
		expect(failSafe).toEqual(expect.objectContaining({
			dmg1: "1d10",
			bonusWeaponAttack: 1,
		}));
		expect(failSafe.effects).toContainEqual(expect.objectContaining({type: "speedBonus", value: 10}));
		expect(failSafe).not.toHaveProperty("baseItem");
		expect(failSafe).not.toHaveProperty("material");
		expect(failSafe).not.toHaveProperty("appliedUpgrades");
		expect(failSafe).not.toHaveProperty("socketedGemstones");
		expect(ItemBuilderCore.projectForPreview(restored, unresolvedCatalogs)).toEqual(failSafe);
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
