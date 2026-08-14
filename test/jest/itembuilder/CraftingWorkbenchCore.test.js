import {CraftingWorkbenchCore} from "../../../js/itembuilder/crafting-workbench-core.js";
import {readFileSync} from "fs";

describe("CraftingWorkbenchCore", () => {
	test.each([
		["itemMaterial", {name: "Darkmetal", source: "TGTT", materialCategory: "metal"}],
		["craftingMaterial", {name: "Aboleth Eye", source: "Ar8", materialCategory: "spell component"}],
		["craftingRecipe", {name: "Basilisk Burgers", source: "Arcadia11", recipeCategory: "dish"}],
	])("normalizes, validates, and serializes %s", (prop, entity) => {
		const draft = CraftingWorkbenchCore.createDraft(prop, {entity: {...entity, uniqueId: "stable-id", expertField: {kept: true}}});
		const validation = CraftingWorkbenchCore.validate(prop, draft);
		const serialized = CraftingWorkbenchCore.serialize(prop, draft);

		expect(validation.isValid).toBe(true);
		expect(serialized).toEqual(expect.objectContaining({
			...entity,
			uniqueId: "stable-id",
			expertField: {kept: true},
		}));
	});

	test.each([
		["itemMaterial", {effects: "bad", magicCapacityRules: {}, entries: false, degradation: []}, ["effects", "magicCapacityRules", "entries"]],
		["craftingMaterial", {entries: {}, spells: false, variantComponent: {spellEffects: "bad", uses: {}}}, ["entries", "spells"]],
		["craftingRecipe", {ingredients: "bad", outcomes: [{tier: "success", entries: {}}], componentGroups: null}, ["ingredients"]],
	])("normalizes malformed %s collections safely", (prop, malformed, emptyProps) => {
		const draft = CraftingWorkbenchCore.createDraft(prop, {source: "HB", entity: malformed});
		for (const emptyProp of emptyProps) expect(draft[emptyProp]).toEqual([]);
		expect(() => CraftingWorkbenchCore.validate(prop, draft)).not.toThrow();
		expect(() => CraftingWorkbenchCore.serialize(prop, draft)).not.toThrow();
	});

	test("deduplicates case-insensitive name/source identities", () => {
		expect(CraftingWorkbenchCore.dedupe([
			{name: "Mithril", source: "TGTT", marker: 1},
			{name: "mithril", source: "tgtt", marker: 2},
			{name: "Mithril", source: "ALT", marker: 3},
		])).toEqual([
			{name: "Mithril", source: "TGTT", marker: 1},
			{name: "Mithril", source: "ALT", marker: 3},
		]);
	});

	test("preserves copper-piece values without conversion", () => {
		const material = CraftingWorkbenchCore.createDraft("craftingMaterial", {
			entity: {name: "Ore", source: "HB", materialCategory: "mineral", value: 1500},
		});
		const recipe = CraftingWorkbenchCore.createDraft("craftingRecipe", {
			entity: {name: "Blade", source: "HB", recipeCategory: "item", value: 875},
		});
		expect(CraftingWorkbenchCore.serialize("craftingMaterial", material).value).toBe(1500);
		expect(CraftingWorkbenchCore.serialize("craftingRecipe", recipe).value).toBe(875);
	});

	test("derives deterministic ingredient alternatives and strips stale generated metadata", () => {
		const entity = {
			name: "Hide Armor",
			source: "HB",
			recipeCategory: "item",
			ingredients: [
				{name: "Copper", quantity: 1, isAlternative: false, alternativeGroup: "stale", alternativeIndex: 12, isInferred: true},
				{name: "Ghast Hide", quantity: 1, _alternativeSet: "HIDE", _alternativeOrder: 20},
				{name: "Wolf Hide", quantity: 1, _alternativeSet: "2", _alternativeOrder: 1},
				{name: "Ghoul Hide", quantity: 1, _alternativeSet: "Hide", _alternativeOrder: 10, expert: "kept"},
				{name: "Bear Hide", quantity: 1, _alternativeSet: "2", _alternativeOrder: 2},
				{name: "Thread", quantity: 1, _alternativeSet: "single"},
			],
		};
		expect(CraftingWorkbenchCore.serialize("craftingRecipe", entity).ingredients).toEqual([
			{name: "Copper", quantity: 1},
			{name: "Ghoul Hide", quantity: 1, expert: "kept", isAlternative: true, alternativeGroup: "alt-1", alternativeIndex: 0},
			{name: "Ghast Hide", quantity: 1, isAlternative: true, alternativeGroup: "alt-1", alternativeIndex: 1},
			{name: "Wolf Hide", quantity: 1, isAlternative: true, alternativeGroup: "alt-0", alternativeIndex: 0},
			{name: "Bear Hide", quantity: 1, isAlternative: true, alternativeGroup: "alt-0", alternativeIndex: 1},
			{name: "Thread", quantity: 1},
		]);
	});

	test("round-trips authored recipe fields and preserves copper pieces", () => {
		const entity = {
			name: "Perfect Roast",
			source: "HB",
			page: 42,
			recipeCategory: "dish",
			crafter: "Cook",
			craftDC: 17,
			complexity: "special",
			rarity: "rare",
			reqAttune: false,
			itemUid: "perfect roast|hb",
			value: 4321,
			ingredients: [{name: "Herb", quantity: 2, unit: "sprigs", group: "Seasoning", _materialRef: "HERB|HB"}],
			outcomes: [{tier: "success", entries: ["Gain {@dice 1d4} temporary hit points."]}],
			entries: ["A carefully prepared meal."],
			expertCanonical: {kept: true},
		};

		expect(CraftingWorkbenchCore.serialize("craftingRecipe", entity)).toEqual({
			...entity,
			ingredients: [{name: "Herb", quantity: 2, unit: "sprigs", group: "Seasoning", uid: "herb|hb"}],
		});
	});

	test("uses selected material references only for UIDs and warns without losing authored names", () => {
		const materialCatalog = [
			{name: "Mithril", source: "TGTT"},
			{name: "mithril", source: "tgtt"},
		];
		const entity = {
			name: "Blade",
			source: "HB",
			recipeCategory: "item",
			ingredients: [
				{name: "wrong display", quantity: 1, _materialRef: "MITHRIL|tgtt"},
				{name: "Moonwater", quantity: 3},
			],
		};
		const serialized = CraftingWorkbenchCore.serialize("craftingRecipe", entity, {materialCatalog});
		const validation = CraftingWorkbenchCore.validate("craftingRecipe", entity, {materialCatalog});

		expect(serialized.ingredients).toEqual([
			{name: "wrong display", quantity: 1, uid: "mithril|tgtt"},
			{name: "Moonwater", quantity: 3},
		]);
		expect(validation.warnings).toEqual(expect.arrayContaining([
			expect.objectContaining({field: "ingredients.1.name", message: expect.stringContaining("Moonwater")}),
		]));
	});

	test("round-trips the real Abyssal Oil display label without replacing it with packaging text", () => {
		const data = JSON.parse(readFileSync("data/crafting.json", "utf8"));
		const recipe = data.craftingRecipe.find(it => it.name === "Abyssal Oil");
		const material = data.craftingMaterial.find(it => it.name === "Abyssal Weapon Ichor (6 vials)");

		const serialized = CraftingWorkbenchCore.serialize(
			"craftingRecipe",
			CraftingWorkbenchCore.normalize("craftingRecipe", recipe),
			{materialCatalog: [material]},
		);

		expect(serialized.ingredients).toContainEqual({
			name: "Abyssal Weapon Ichor",
			quantity: 1,
			unit: "vial",
			uid: "abyssal weapon ichor (6 vials)|hhhviii",
		});
	});

	test("round-trips canonical custom attunement and varies rarity from real recipe data", () => {
		const data = JSON.parse(readFileSync("data/crafting.json", "utf8"));
		const recipe = data.craftingRecipe.find(it => it.name === "Dragon Wand");

		const serialized = CraftingWorkbenchCore.serialize("craftingRecipe", CraftingWorkbenchCore.normalize("craftingRecipe", recipe));

		expect(serialized.reqAttune).toBe("by a spellcaster");
		expect(serialized.rarity).toBe("varies");
		expect(CraftingWorkbenchCore.validate("craftingRecipe", serialized).isValid).toBe(true);
	});

	test("retains validation errors for malformed recipe category, rarity, and attunement scalars", () => {
		const validation = CraftingWorkbenchCore.validate("craftingRecipe", {
			name: "Malformed Tonic",
			source: "HB",
			recipeCategory: {value: "potion"},
			rarity: ["rare"],
			reqAttune: {value: true},
		});

		expect(validation).toEqual(expect.objectContaining({
			isValid: false,
			errors: expect.arrayContaining([
				expect.objectContaining({field: "recipeCategory"}),
				expect.objectContaining({field: "rarity"}),
				expect.objectContaining({field: "reqAttune"}),
			]),
		}));
		expect(() => CraftingWorkbenchCore.serialize("craftingRecipe", validation.entity)).not.toThrow();
	});

	test("derives component groups in ingredient order without duplicates", () => {
		const serialized = CraftingWorkbenchCore.serialize("craftingRecipe", {
			name: "Pie",
			source: "HB",
			recipeCategory: "dish",
			componentGroups: ["stale"],
			ingredients: [
				{name: "Flour", group: "Crust"},
				{name: "Butter", group: "crust"},
				{name: "Apple", group: "Filling"},
				{name: "Sugar", group: "Topping"},
			],
		});
		expect(serialized.componentGroups).toEqual(["Crust", "Filling", "Topping"]);
	});

	test("normalizes dish outcome tiers and nested entries", () => {
		const normalized = CraftingWorkbenchCore.normalize("craftingRecipe", {
			name: "Pie",
			source: "HB",
			recipeCategory: "dish",
			outcomes: [
				{tier: "success", entries: ["Text", {type: "entries", name: "Nested", entries: [{type: "list", items: ["One"]}]}]},
				{tier: "delicious", entries: null},
				{tier: "extraDelicious", entries: "bad"},
				null,
			],
		});
		expect(normalized.outcomes).toEqual([
			{tier: "success", entries: ["Text", {type: "entries", name: "Nested", entries: [{type: "list", items: ["One"]}]}]},
			{tier: "delicious", entries: []},
			{tier: "extraDelicious", entries: []},
		]);
		expect(CraftingWorkbenchCore.validate("craftingRecipe", normalized).isValid).toBe(true);
	});

	test("strips recipe generator output while preserving unrelated expert fields", () => {
		const serialized = CraftingWorkbenchCore.serialize("craftingRecipe", {
			name: "Tonic",
			source: "HB",
			recipeCategory: "potion",
			effectTags: ["healing"],
			hasMechanicalEffect: true,
			componentGroups: ["stale"],
			ingredients: [{name: "Herb", uid: "herb|hb", isInferred: true}],
			expertCanonical: {kept: true},
		});
		expect(serialized).not.toHaveProperty("effectTags");
		expect(serialized).not.toHaveProperty("hasMechanicalEffect");
		expect(serialized).not.toHaveProperty("componentGroups");
		expect(serialized.ingredients).toEqual([{name: "Herb", uid: "herb|hb"}]);
		expect(serialized.expertCanonical).toEqual({kept: true});
	});

	test("round-trips nested variant component matches and effects", () => {
		const variantComponent = {
			harvestDC: 17,
			spellEffects: [{
				match: {damageType: "psychic", expertMatch: {level: 3}},
				description: "Strengthens the spell.",
				effects: [
					{type: "dieSizeIncrease", steps: 1, maxDie: "d12"},
					{type: "bonusDice", count: 3, expertEffect: true},
				],
				expertSpellEffect: "kept",
			}],
		};
		const entity = {
			name: "Aboleth Eye",
			source: "Ar8",
			materialCategory: "spell component",
			variantComponent,
		};
		expect(CraftingWorkbenchCore.serialize("craftingMaterial", entity).variantComponent).toEqual(variantComponent);
	});

	test("round-trips every runtime variant-component predicate and effect type", () => {
		const predicates = [
			{spell: "fireball|phb"},
			{damageType: "fire"},
			{spellTag: "restoration"},
			{any: true},
		];
		const effectTypes = [
			"text", "dieSizeIncrease", "bonusDice", "additionalTargets", "acOverride",
			"bonusDamage", "condition", "noSlot", "rangeChange", "areaChange",
			"resistance", "saveDcMod", "saveDisadvantage", "speedFallRate",
			"speedOverride", "lowerSlot", "removeConcentration", "immunity",
		];
		const entity = {
			name: "Complete Component",
			source: "HB",
			materialCategory: "spell component",
			variantComponent: {
				harvestDC: 12,
				harvestQuantity: 2,
				harvestSource: "Dragon",
				harvestTime: "15 minutes",
				usesPerCasting: 2,
				uses: [{name: "Searing", key: "searing", entry: "Deal more damage.", expertUse: true}],
				spellEffects: predicates.map((match, ix) => ({
					match,
					description: `Match ${ix + 1}`,
					effects: effectTypes
						.filter((_, effectIx) => effectIx % predicates.length === ix)
						.map(type => ({type, expertDetails: {preserved: true}})),
				})),
			},
		};

		const serialized = CraftingWorkbenchCore.serialize("craftingMaterial", entity);
		expect(CraftingWorkbenchCore.validate("craftingMaterial", serialized).isValid).toBe(true);
		expect(serialized).toEqual(expect.objectContaining(entity));
		expect(serialized.variantComponent).toEqual(entity.variantComponent);
		expect(new Set(serialized.variantComponent.spellEffects.flatMap(it => it.effects).map(it => it.type))).toEqual(new Set(effectTypes));
	});

	test("covers every predicate and effect type in the read-only Arcadia 8 catalog", () => {
		const data = JSON.parse(readFileSync("data/items-variant-components-ar8.json", "utf8"));
		const predicates = new Set();
		const effectTypes = new Set();
		data.item.forEach(item => item.variantComponent?.spellEffects?.forEach(spellEffect => {
			Object.keys(spellEffect.match || {}).forEach(prop => predicates.add(prop));
			spellEffect.effects?.forEach(effect => effectTypes.add(effect.type));
		}));

		expect([...predicates].every(prop => CraftingWorkbenchCore.VOCABULARY.craftingMaterial.matchPredicates.includes(prop))).toBe(true);
		expect([...effectTypes].every(type => CraftingWorkbenchCore.VOCABULARY.craftingMaterial.effectTypes.includes(type))).toBe(true);
		expect(CraftingWorkbenchCore.VOCABULARY.craftingMaterial.matchPredicates).toEqual(["spell", "damageType", "spellTag", "any"]);
	});

	test("normalizes malformed nested variant arrays and enforces one supported predicate", () => {
		const normalized = CraftingWorkbenchCore.normalize("craftingMaterial", {
			name: "Component",
			source: "HB",
			materialCategory: "spell component",
			variantComponent: {
				uses: ["bad", {name: "Kept"}],
				spellEffects: [
					{
						match: {damageType: "cold", spell: "cone of cold|phb", expertMatch: true},
						effects: ["bad", {type: "bonusDice", count: 2}],
					},
					{match: "bad", effects: {}},
					"bad",
				],
			},
		});

		expect(normalized.variantComponent.uses).toEqual([{name: "Kept"}]);
		expect(normalized.variantComponent.spellEffects).toHaveLength(2);
		expect(normalized.variantComponent.spellEffects[0].match).toEqual({spell: "cone of cold|phb", expertMatch: true});
		expect(normalized.variantComponent.spellEffects[0].effects).toEqual([{type: "bonusDice", count: 2}]);
		expect(normalized.variantComponent.spellEffects[1]).toEqual({match: {}, effects: []});
		expect(CraftingWorkbenchCore.validate("craftingMaterial", normalized)).toEqual(expect.objectContaining({
			isValid: false,
			errors: expect.arrayContaining([expect.objectContaining({field: "variantComponent.spellEffects.1.match"})]),
		}));
	});

	test("keeps fixed and rolled harvest quantities mutually exclusive", () => {
		const normalized = CraftingWorkbenchCore.normalize("craftingMaterial", {
			harvest: {quantity: 2, quantityRoll: "1d4"},
		});
		expect(normalized.harvest).toEqual({quantityRoll: "1d4"});
	});

	test("requires a canonical crafting material category", () => {
		expect(CraftingWorkbenchCore.validate("craftingMaterial", {name: "Ore", source: "HB"})).toEqual(expect.objectContaining({
			isValid: false,
			errors: expect.arrayContaining([expect.objectContaining({field: "materialCategory"})]),
		}));
	});

	test("strips generated crafting-material fields but preserves expert fields and cp", () => {
		const serialized = CraftingWorkbenchCore.serialize("craftingMaterial", {
			name: "Aboleth Eye",
			source: "HB",
			materialCategory: "spell component",
			value: 37500,
			usedInRecipes: [{name: "Lens"}],
			alsoIn: [{name: "Eye", source: "Ar8"}],
			hasMechanicalEffect: true,
			hasUseEffect: true,
			effectTags: ["generated"],
			ingredientGraph: {generated: true},
			harvest: {
				dc: 17,
				creature: {name: "Aboleth", source: "MM", label: "Aboleths"},
				creatureType: "aberration",
				cr: 10,
			},
			expertField: {kept: true},
		});

		expect(serialized.value).toBe(37500);
		expect(serialized).not.toHaveProperty("usedInRecipes");
		expect(serialized).not.toHaveProperty("alsoIn");
		expect(serialized).not.toHaveProperty("hasMechanicalEffect");
		expect(serialized).not.toHaveProperty("hasUseEffect");
		expect(serialized).not.toHaveProperty("effectTags");
		expect(serialized).not.toHaveProperty("ingredientGraph");
		expect(serialized.harvest).toEqual({dc: 17, creature: {name: "Aboleth", source: "MM"}});
		expect(serialized.expertField).toEqual({kept: true});
	});

	test("round-trips item material sentinels, effects, Magic Capacity rules, and degradation", () => {
		const entity = {
			name: "Rimeglass",
			source: "TGTT",
			materialCategory: "crystal",
			density: null,
			densityVaries: true,
			damage: "na",
			protection: 14,
			critical: 0,
			penetration: null,
			magicCapacity: "-infinity",
			effects: [{
				type: "bonusCritDamage",
				appliesTo: ["weapon"],
				dice: "1d6",
				damageType: "cold",
				note: "A specialized effect.",
				specializedUnknown: {kept: true},
			}],
			magicCapacityRules: [{
				type: "freeEffect",
				theme: "frost",
				appliesTo: "fragment",
				note: "The first frost effect is free.",
				expertRule: true,
			}],
			degradation: {
				trigger: {on: "damageTaken", damageType: "fire", natural: []},
				effect: {type: "zeroAxes", axes: ["protection", "critical"], expertEffect: true},
				stacking: false,
				destroys: false,
				repair: {method: "shortRest", tool: "glassblower's tools", expertRepair: true},
				note: "Fire softens it.",
				expertDegradation: true,
			},
		};

		const serialized = CraftingWorkbenchCore.serialize("itemMaterial", entity);
		expect(CraftingWorkbenchCore.validate("itemMaterial", serialized).isValid).toBe(true);
		expect(serialized).toEqual(expect.objectContaining(entity));
		expect(serialized.effects).toEqual(entity.effects);
		expect(serialized.magicCapacityRules).toEqual(entity.magicCapacityRules);
		expect(serialized.degradation).toEqual(entity.degradation);
	});

	test("omits workbench-only state and preview prop while preserving canonical unknowns", () => {
		const serialized = CraftingWorkbenchCore.serialize("itemMaterial", {
			name: "Test",
			source: "HB",
			materialCategory: "metal",
			uniqueId: "uid",
			__prop: "itemMaterial",
			_ui: {tab: 2},
			unknownCanonical: {nested: true},
		});
		expect(serialized).toEqual(expect.objectContaining({uniqueId: "uid", unknownCanonical: {nested: true}}));
		expect(serialized).not.toHaveProperty("__prop");
		expect(serialized).not.toHaveProperty("_ui");
	});

	test("row helpers are pure and preserve unknown row fields", () => {
		const rows = [{type: "note", text: "One", unknown: true}];
		const added = CraftingWorkbenchCore.addRow(rows, {type: "bonusAc", value: 1});
		const updated = CraftingWorkbenchCore.updateRow(added, 0, {text: "Updated"});
		const moved = CraftingWorkbenchCore.moveRow(updated, 0, 1);
		const removed = CraftingWorkbenchCore.removeRow(moved, 0);

		expect(rows).toEqual([{type: "note", text: "One", unknown: true}]);
		expect(removed).toEqual([{type: "note", text: "Updated", unknown: true}]);
	});
});
