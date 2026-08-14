const _VERSION = 2;

const _copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const _key = value => String(value ?? "").trim().toLowerCase();
const _isObject = value => value != null && typeof value === "object" && !Array.isArray(value);
const _asArray = value => Array.isArray(value) ? value : [];
const _asObject = value => _isObject(value) ? value : {};

const _PROPS = ["itemMaterial", "craftingMaterial", "craftingRecipe"];
const _UI_ONLY_PROPS = new Set(["__prop", "_ui", "_validation", "_saveStatus", "_derived", "_draft"]);

const _ITEM_MATERIAL_EFFECT_TYPES = [
	"addProperty",
	"removeProperty",
	"propertyLadder",
	"armorForceHeavy",
	"armorStealthDisadvantage",
	"armorNoStealthDisadvantage",
	"armorNoStrengthRequirement",
	"armorStrengthRequirementDelta",
	"armorDexCapDelta",
	"armorWearableUnderClothing",
	"bonusAc",
	"bonusWeaponAttack",
	"bonusWeaponDamage",
	"bonusInitiative",
	"bonusCritDamage",
	"speedDelta",
	"rangeMultiplier",
	"thrownRangeDelta",
	"damageReduction",
	"extraDamageDiceVsType",
	"overrideDamageType",
	"resistance",
	"immunity",
	"countsAsMagical",
	"countsAsSilvered",
	"indestructible",
	"spellcastingFocus",
	"saveAdvantage",
	"checkAdvantage",
	"perceptionPenaltyToNotice",
	"noRangedDisadvantageInMelee",
	"penetrationIgnoresMagicalAc",
	"grantsAction",
	"condensateAffinity",
	"condensateInstability",
	"draconicResonanceSlot",
	"doubleNumericProperties",
	"note",
];

const _CRAFTING_MATERIAL_MATCH_PREDICATES = ["spell", "damageType", "spellTag", "any"];
const _CRAFTING_MATERIAL_EFFECT_TYPES = [
	"text",
	"dieSizeIncrease",
	"bonusDice",
	"additionalTargets",
	"acOverride",
	"bonusDamage",
	"condition",
	"noSlot",
	"rangeChange",
	"areaChange",
	"resistance",
	"saveDcMod",
	"saveDisadvantage",
	"speedFallRate",
	"speedOverride",
	"lowerSlot",
	"removeConcentration",
	"immunity",
];
const _RARITIES = ["none", "common", "uncommon", "rare", "very rare", "legendary", "artifact", "varies", "unknown"];
const _CRAFTING_MATERIAL_DERIVED_PROPS = new Set([
	"usedInRecipes",
	"alsoIn",
	"hasMechanicalEffect",
	"hasUseEffect",
	"effectTags",
	"ingredientGraph",
	"ingredientGraphMeta",
	"ingredientMetadata",
]);
const _CRAFTING_RECIPE_DERIVED_PROPS = new Set([
	"componentGroups",
	"effectTags",
	"hasMechanicalEffect",
]);
const _CRAFTING_RECIPE_INGREDIENT_DERIVED_PROPS = new Set([
	"uid",
	"isAlternative",
	"alternativeGroup",
	"alternativeIndex",
	"isInferred",
]);

export const CRAFTING_WORKBENCH_VOCABULARY = Object.freeze({
	props: Object.freeze([..._PROPS]),
	itemMaterial: Object.freeze({
		categories: Object.freeze(["metal", "wood", "stone", "crystal", "cloth", "organic", "constructed", "condensate"]),
		axes: Object.freeze(["damage", "protection", "critical", "penetration", "magicCapacity"]),
		axisSentinels: Object.freeze(["na", null]),
		magicCapacitySentinels: Object.freeze(["na", null, "infinity", "-infinity"]),
		appliesTo: Object.freeze(["weapon", "armor", "shield", "other"]),
		roles: Object.freeze(["strikingSurface", "protectiveLayer", "focus"]),
		effectTypes: Object.freeze(_ITEM_MATERIAL_EFFECT_TYPES),
		magicCapacityRuleTypes: Object.freeze(["opposedStatesCountAsOne", "makerForeknowledge", "dcRiseThreshold", "freeEffect"]),
		degradationTriggerTypes: Object.freeze(["attackRoll", "damageTaken", "critReceived", "damaged"]),
		degradationEffectTypes: Object.freeze(["damageStepDelta", "zeroAxes", "destroy"]),
		degradationRepairMethods: Object.freeze(["manual", "shortRest", "tool", "none"]),
		priceUnits: Object.freeze(["lb", "vial", "stone", "matrix", "sqYard", "scale", "tooth", "heart", "sqFoot", "none"]),
	}),
	craftingMaterial: Object.freeze({
		categories: Object.freeze(["creature part", "herb", "mineral", "food ingredient", "spell component", "other"]),
		matchPredicates: Object.freeze(_CRAFTING_MATERIAL_MATCH_PREDICATES),
		effectTypes: Object.freeze(_CRAFTING_MATERIAL_EFFECT_TYPES),
	}),
	craftingRecipe: Object.freeze({
		categories: Object.freeze(["item", "potion", "scroll", "dish", "curse"]),
		crafters: Object.freeze(["Alchemist", "Artificer", "Blacksmith", "Cook", "Leatherworker", "Thaumaturge", "Tinker"]),
		complexities: Object.freeze(["simple", "special"]),
		outcomeTiers: Object.freeze(["success", "delicious", "extraDelicious"]),
	}),
	rarities: Object.freeze(_RARITIES),
});

function _getProp (prop) {
	if (!_PROPS.includes(prop)) throw new TypeError(`Unsupported crafting workbench prop "${prop}".`);
	return prop;
}

function _normalizeObjectRows (value, fnNormalize = it => it) {
	return _asArray(value)
		.filter(_isObject)
		.map(it => fnNormalize(_copy(it)));
}

function _normalizeItemMaterial (entity) {
	const out = _copy(_asObject(entity));
	for (const prop of ["appliesTo", "roles", "entries"]) out[prop] = _asArray(out[prop]);
	out.effects = _normalizeObjectRows(out.effects);
	out.magicCapacityRules = _normalizeObjectRows(out.magicCapacityRules);

	if (Object.hasOwn(out, "color")) out.color = _asObject(out.color);
	if (Object.hasOwn(out, "price")) {
		out.price = _asObject(out.price);
		if (Object.hasOwn(out.price, "range") && !_isObject(out.price.range) && !Array.isArray(out.price.range)) delete out.price.range;
	}

	if (Object.hasOwn(out, "degradation")) {
		if (!_isObject(out.degradation)) delete out.degradation;
		else {
			out.degradation = _copy(out.degradation);
			out.degradation.trigger = _asObject(out.degradation.trigger);
			out.degradation.trigger.natural = _asArray(out.degradation.trigger.natural);
			out.degradation.effect = _asObject(out.degradation.effect);
			if (Object.hasOwn(out.degradation.effect, "axes")) out.degradation.effect.axes = _asArray(out.degradation.effect.axes);
			if (Object.hasOwn(out.degradation, "repair") && out.degradation.repair != null) out.degradation.repair = _asObject(out.degradation.repair);
		}
	}

	return out;
}

function _normalizeCraftingMaterial (entity) {
	const out = _copy(_asObject(entity));
	for (const prop of _CRAFTING_MATERIAL_DERIVED_PROPS) delete out[prop];
	out.entries = _asArray(out.entries);
	out.spells = _normalizeObjectRows(out.spells);

	if (Object.hasOwn(out, "harvest")) {
		if (!_isObject(out.harvest)) delete out.harvest;
		else {
			out.harvest = _copy(out.harvest);
			delete out.harvest.creatureType;
			delete out.harvest.cr;
			if (Object.hasOwn(out.harvest, "creature")) {
				out.harvest.creature = _asObject(out.harvest.creature);
				delete out.harvest.creature.label;
				if (!Object.keys(out.harvest.creature).length) delete out.harvest.creature;
			}
			if (_key(out.harvest.quantityRoll)) delete out.harvest.quantity;
			else delete out.harvest.quantityRoll;
			if (!Object.keys(out.harvest).length) delete out.harvest;
		}
	}

	if (Object.hasOwn(out, "variantComponent")) {
		if (!_isObject(out.variantComponent)) delete out.variantComponent;
		else {
			out.variantComponent = _copy(out.variantComponent);
			if (Object.hasOwn(out.variantComponent, "uses")) out.variantComponent.uses = _normalizeObjectRows(out.variantComponent.uses);
			out.variantComponent.spellEffects = _normalizeObjectRows(
				out.variantComponent.spellEffects,
				spellEffect => {
					const match = _asObject(spellEffect.match);
					const predicates = _CRAFTING_MATERIAL_MATCH_PREDICATES
						.filter(prop => prop === "any" ? match[prop] === true : _key(match[prop]));
					for (const prop of _CRAFTING_MATERIAL_MATCH_PREDICATES) {
						if (prop !== predicates[0]) delete match[prop];
					}
					return {
						...spellEffect,
						match,
						effects: _normalizeObjectRows(spellEffect.effects),
					};
				},
			);
		}
	}

	return out;
}

function _normalizeCraftingRecipe (entity) {
	const out = _copy(_asObject(entity));
	for (const prop of _CRAFTING_RECIPE_DERIVED_PROPS) delete out[prop];
	out.entries = _asArray(out.entries);
	out.ingredients = _normalizeObjectRows(out.ingredients, ingredient => {
		const ref = _key(ingredient._materialRef || ingredient.uid);
		const alternativeSet = String(ingredient._alternativeSet ?? (ingredient.isAlternative ? ingredient.alternativeGroup : "")).trim();
		const alternativeOrderRaw = ingredient._alternativeOrder ?? ingredient.alternativeIndex;
		const alternativeOrder = Number.isFinite(Number(alternativeOrderRaw)) ? Number(alternativeOrderRaw) : null;
		for (const prop of _CRAFTING_RECIPE_INGREDIENT_DERIVED_PROPS) delete ingredient[prop];
		if (ref) ingredient._materialRef = ref;
		else delete ingredient._materialRef;
		if (alternativeSet) ingredient._alternativeSet = alternativeSet;
		else {
			delete ingredient._alternativeSet;
			delete ingredient._alternativeOrder;
		}
		if (alternativeSet && alternativeOrder != null) ingredient._alternativeOrder = alternativeOrder;
		return ingredient;
	});
	out.outcomes = _normalizeObjectRows(out.outcomes, outcome => ({
		...outcome,
		entries: _asArray(outcome.entries),
	}));
	return out;
}

function _getRecipeMaterialLookup (materialCatalog) {
	return new Map(
		CraftingWorkbenchCore.dedupe(materialCatalog)
			.map(material => [CraftingWorkbenchCore.getIdentity(material), material]),
	);
}

function _serializeCraftingRecipe (entity, {materialCatalog = null} = {}) {
	const out = _normalizeCraftingRecipe(entity);
	const materialLookup = materialCatalog == null ? null : _getRecipeMaterialLookup(materialCatalog);
	const alternativeRows = new Map();
	const alternativeSetLabels = new Map();

	out.ingredients.forEach((ingredient, ix) => {
		const set = _key(ingredient._alternativeSet);
		if (!set) return;
		if (!alternativeSetLabels.has(set)) alternativeSetLabels.set(set, String(ingredient._alternativeSet).trim());
		if (!alternativeRows.has(set)) alternativeRows.set(set, []);
		alternativeRows.get(set).push({
			ingredient,
			ix,
			order: Number.isFinite(Number(ingredient._alternativeOrder)) ? Number(ingredient._alternativeOrder) : Number.MAX_SAFE_INTEGER,
		});
	});
	for (const rows of alternativeRows.values()) rows.sort((a, b) => a.order - b.order || a.ix - b.ix);
	const alternativeSets = [...alternativeRows]
		.filter(([, rows]) => rows.length > 1)
		.map(([set]) => set)
		.sort((a, b) => alternativeSetLabels.get(a).localeCompare(alternativeSetLabels.get(b), undefined, {numeric: true, sensitivity: "base"}));
	const alternativeSetToGroup = new Map(alternativeSets.map((set, ix) => [set, `alt-${ix}`]));
	const alternativeSetAnchors = new Map(
		alternativeSets.map(set => [Math.min(...alternativeRows.get(set).map(it => it.ix)), set]),
	);
	const ingredientsOrdered = [];
	out.ingredients.forEach((ingredient, ix) => {
		const set = _key(ingredient._alternativeSet);
		if (!alternativeSetToGroup.has(set)) {
			ingredientsOrdered.push(ingredient);
			return;
		}
		if (alternativeSetAnchors.get(ix) !== set) return;
		ingredientsOrdered.push(...alternativeRows.get(set).map(it => it.ingredient));
	});
	const alternativeSetIndices = new Map();

	out.ingredients = ingredientsOrdered.map(ingredient => {
		const serialized = _copy(ingredient);
		const materialRef = _key(serialized._materialRef);
		const material = materialRef && materialLookup ? materialLookup.get(materialRef) : null;
		for (const prop of _CRAFTING_RECIPE_INGREDIENT_DERIVED_PROPS) delete serialized[prop];
		delete serialized._materialRef;
		delete serialized._alternativeSet;
		delete serialized._alternativeOrder;
		if (materialRef) serialized.uid = material ? CraftingWorkbenchCore.getIdentity(material) : materialRef;

		const set = _key(ingredient._alternativeSet);
		if (alternativeSetToGroup.has(set)) {
			serialized.isAlternative = true;
			serialized.alternativeGroup = alternativeSetToGroup.get(set);
			serialized.alternativeIndex = alternativeSetIndices.get(set) || 0;
			alternativeSetIndices.set(set, serialized.alternativeIndex + 1);
		}
		return serialized;
	});

	const componentGroupLookup = new Map();
	out.ingredients.forEach(ingredient => {
		const group = String(ingredient.group || "").trim();
		if (group && !componentGroupLookup.has(_key(group))) componentGroupLookup.set(_key(group), group);
	});
	const componentGroups = [...componentGroupLookup.values()];
	if (componentGroups.length > 1) out.componentGroups = componentGroups;
	else delete out.componentGroups;
	for (const prop of ["effectTags", "hasMechanicalEffect"]) delete out[prop];
	return out;
}

const _NORMALIZERS = {
	itemMaterial: _normalizeItemMaterial,
	craftingMaterial: _normalizeCraftingMaterial,
	craftingRecipe: _normalizeCraftingRecipe,
};

function _stripWorkbenchState (value) {
	if (Array.isArray(value)) return value.map(_stripWorkbenchState);
	if (!_isObject(value)) return value;
	return Object.entries(value).reduce((out, [key, child]) => {
		if (_UI_ONLY_PROPS.has(key)) return out;
		out[key] = _stripWorkbenchState(child);
		return out;
	}, {});
}

function _validateCommon (entity) {
	const errors = [];
	const warnings = [];
	if (!_key(entity.name)) errors.push({field: "name", message: "Enter a name."});
	if (!_key(entity.source)) errors.push({field: "source", message: "Choose a homebrew source."});
	if (entity.page != null && (!Number.isFinite(Number(entity.page)) || Number(entity.page) < 0)) {
		errors.push({field: "page", message: "Page must be zero or greater."});
	}
	if (entity.rarity != null && !_RARITIES.includes(entity.rarity)) errors.push({field: "rarity", message: "Rarity is not recognized."});
	return {errors, warnings};
}

function _validateEnum ({entity, prop, values, errors, label = prop}) {
	if (entity[prop] != null && !values.includes(entity[prop])) errors.push({field: prop, message: `${label} is not recognized.`});
}

function _validateAxis ({entity, prop, sentinels, errors}) {
	const value = entity[prop];
	if (value == null || sentinels.includes(value)) return;
	if (!Number.isFinite(Number(value))) errors.push({field: prop, message: `${prop} must be a number or supported sentinel.`});
}

function _validateItemMaterial (entity, out) {
	const vocab = CRAFTING_WORKBENCH_VOCABULARY.itemMaterial;
	_validateEnum({entity, prop: "materialCategory", values: vocab.categories, errors: out.errors, label: "Material category"});
	for (const prop of vocab.axes) {
		_validateAxis({
			entity,
			prop,
			sentinels: prop === "magicCapacity" ? vocab.magicCapacitySentinels : vocab.axisSentinels,
			errors: out.errors,
		});
	}
	if (entity.density != null && (!Number.isFinite(Number(entity.density)) || Number(entity.density) < 0)) {
		out.errors.push({field: "density", message: "Density must be zero or greater, or Varies."});
	}
	if (entity.objectAc != null && (!Number.isFinite(Number(entity.objectAc)) || Number(entity.objectAc) < 0)) {
		out.errors.push({field: "objectAc", message: "Object AC must be zero or greater."});
	}
	if (entity.price && entity.price.gp != null && (!Number.isFinite(Number(entity.price.gp)) || Number(entity.price.gp) < 0)) {
		out.errors.push({field: "price.gp", message: "Price must be zero or greater."});
	}
	if (entity.primaryRole && !entity.roles.includes(entity.primaryRole)) {
		out.errors.push({field: "primaryRole", message: "Primary role must be one of the selected roles."});
	}
	entity.effects.forEach((effect, ix) => {
		if (!_key(effect.type)) out.errors.push({field: `effects.${ix}.type`, message: `Effect ${ix + 1} needs a type.`});
		else if (!vocab.effectTypes.includes(effect.type)) out.warnings.push({field: `effects.${ix}.type`, message: `Effect type "${effect.type}" is not in the current vocabulary; it will be preserved.`});
	});
	entity.magicCapacityRules.forEach((rule, ix) => {
		if (!_key(rule.type)) out.errors.push({field: `magicCapacityRules.${ix}.type`, message: `Magic Capacity rule ${ix + 1} needs a type.`});
	});
	if (entity.degradation && (!_key(entity.degradation.trigger?.on) || !_key(entity.degradation.effect?.type))) {
		out.errors.push({field: "degradation", message: "Degradation needs both a trigger and an effect type."});
	}
}

function _validateCraftingMaterial (entity, out) {
	if (!_key(entity.materialCategory)) out.errors.push({field: "materialCategory", message: "Choose a material category."});
	_validateEnum({
		entity,
		prop: "materialCategory",
		values: CRAFTING_WORKBENCH_VOCABULARY.craftingMaterial.categories,
		errors: out.errors,
		label: "Material category",
	});
	for (const prop of ["value", "weight"]) {
		if (entity[prop] != null && (!Number.isFinite(Number(entity[prop])) || Number(entity[prop]) < 0)) {
			out.errors.push({field: prop, message: `${prop === "value" ? "Value (cp)" : "Weight"} must be zero or greater.`});
		}
	}
	if (entity.harvest) {
		for (const prop of ["dc", "quantity"]) {
			if (entity.harvest[prop] != null && (!Number.isFinite(Number(entity.harvest[prop])) || Number(entity.harvest[prop]) < 0)) {
				out.errors.push({field: `harvest.${prop}`, message: `Harvest ${prop === "dc" ? "DC" : "quantity"} must be zero or greater.`});
			}
		}
	}
	entity.spells.forEach((spell, ix) => {
		if (!_key(spell.name)) out.errors.push({field: `spells.${ix}.name`, message: `Spell reference ${ix + 1} needs a name.`});
	});
	entity.variantComponent?.spellEffects.forEach((spellEffect, ix) => {
		const predicates = _CRAFTING_MATERIAL_MATCH_PREDICATES
			.filter(prop => prop === "any" ? spellEffect.match[prop] === true : _key(spellEffect.match[prop]));
		if (predicates.length !== 1) {
			out.errors.push({field: `variantComponent.spellEffects.${ix}.match`, message: `Variant spell effect ${ix + 1} needs exactly one match predicate.`});
		}
		spellEffect.effects.forEach((effect, effectIx) => {
			if (!_key(effect.type)) {
				out.errors.push({field: `variantComponent.spellEffects.${ix}.effects.${effectIx}.type`, message: `Effect ${effectIx + 1} in variant spell effect ${ix + 1} needs a type.`});
			} else if (!_CRAFTING_MATERIAL_EFFECT_TYPES.includes(effect.type)) {
				out.warnings.push({field: `variantComponent.spellEffects.${ix}.effects.${effectIx}.type`, message: `Effect type "${effect.type}" is not in the current vocabulary; it will be preserved.`});
			}
		});
	});
}

function _validateCraftingRecipe (entity, out) {
	if (!_key(entity.recipeCategory)) out.errors.push({field: "recipeCategory", message: "Choose a recipe category."});
	_validateEnum({
		entity,
		prop: "recipeCategory",
		values: CRAFTING_WORKBENCH_VOCABULARY.craftingRecipe.categories,
		errors: out.errors,
		label: "Recipe category",
	});
	if (entity.crafter != null && !CRAFTING_WORKBENCH_VOCABULARY.craftingRecipe.crafters.includes(entity.crafter)) {
		out.warnings.push({field: "crafter", message: `Crafter "${entity.crafter}" is custom and will be preserved.`});
	}
	_validateEnum({
		entity,
		prop: "complexity",
		values: CRAFTING_WORKBENCH_VOCABULARY.craftingRecipe.complexities,
		errors: out.errors,
		label: "Complexity",
	});
	if (entity.reqAttune != null && typeof entity.reqAttune !== "boolean" && typeof entity.reqAttune !== "string") {
		out.errors.push({field: "reqAttune", message: "Attunement must be Yes, No, or custom text."});
	} else if (typeof entity.reqAttune === "string" && !_key(entity.reqAttune)) {
		out.errors.push({field: "reqAttune", message: "Enter custom attunement text."});
	}
	for (const prop of ["craftDC", "value"]) {
		if (entity[prop] != null && (!Number.isFinite(Number(entity[prop])) || Number(entity[prop]) < 0)) {
			out.errors.push({field: prop, message: `${prop === "value" ? "Value (cp)" : "Craft DC"} must be zero or greater.`});
		}
	}
	entity.ingredients.forEach((ingredient, ix) => {
		if (!_key(ingredient.name)) out.errors.push({field: `ingredients.${ix}.name`, message: `Ingredient ${ix + 1} needs a name.`});
		if (ingredient.quantity != null && (!Number.isFinite(Number(ingredient.quantity)) || Number(ingredient.quantity) < 0)) {
			out.errors.push({field: `ingredients.${ix}.quantity`, message: `Ingredient ${ix + 1} quantity must be zero or greater.`});
		}
		if (!_key(ingredient._materialRef)) out.warnings.push({field: `ingredients.${ix}.name`, message: `Ingredient "${ingredient.name || ix + 1}" has no resolved crafting material; its authored name will be preserved.`});
	});
	const alternativeSetCounts = entity.ingredients.reduce((counts, ingredient) => {
		const set = _key(ingredient._alternativeSet);
		if (set) counts.set(set, (counts.get(set) || 0) + 1);
		return counts;
	}, new Map());
	entity.ingredients.forEach((ingredient, ix) => {
		const set = _key(ingredient._alternativeSet);
		if (set && alternativeSetCounts.get(set) < 2) out.warnings.push({field: `ingredients.${ix}._alternativeSet`, message: `Alternative set "${ingredient._alternativeSet}" needs at least two ingredients; this ingredient will be saved as non-alternative.`});
	});
	const outcomeTiers = new Set();
	entity.outcomes.forEach((outcome, ix) => {
		if (!CRAFTING_WORKBENCH_VOCABULARY.craftingRecipe.outcomeTiers.includes(outcome.tier)) {
			out.errors.push({field: `outcomes.${ix}.tier`, message: `Outcome ${ix + 1} needs a supported dish tier.`});
		} else if (outcomeTiers.has(outcome.tier)) {
			out.errors.push({field: `outcomes.${ix}.tier`, message: `Dish outcome tier "${outcome.tier}" is duplicated.`});
		}
		outcomeTiers.add(outcome.tier);
	});
	if (entity.recipeCategory !== "dish" && entity.outcomes.length) out.warnings.push({field: "outcomes", message: "Outcomes are normally used only for dish recipes; they will be preserved."});
}

const _VALIDATORS = {
	itemMaterial: _validateItemMaterial,
	craftingMaterial: _validateCraftingMaterial,
	craftingRecipe: _validateCraftingRecipe,
};

export class CraftingWorkbenchCore {
	static VERSION = _VERSION;
	static VOCABULARY = CRAFTING_WORKBENCH_VOCABULARY;

	static getIdentity (entity) {
		return `${_key(entity?.name)}|${_key(entity?.source)}`;
	}

	static dedupe (entities) {
		const seen = new Set();
		return _asArray(entities).filter(entity => {
			if (!_isObject(entity)) return false;
			const identity = this.getIdentity(entity);
			if (seen.has(identity)) return false;
			seen.add(identity);
			return true;
		}).map(_copy);
	}

	static createDraft (prop, {source = "", entity = null} = {}) {
		_getProp(prop);
		const defaults = {
			itemMaterial: {
				name: "New Item Material",
				source,
				materialCategory: "metal",
				density: null,
				damage: null,
				protection: null,
				critical: null,
				penetration: null,
				magicCapacity: null,
				rarity: "none",
				price: {gp: 0, unit: "lb", display: "", isPriceless: false},
				color: {css: ""},
				appliesTo: [],
				roles: [],
				effects: [],
				magicCapacityRules: [],
				entries: [],
			},
			craftingMaterial: {
				name: "New Crafting Material",
				source,
				materialCategory: "other",
				entries: [],
				spells: [],
			},
			craftingRecipe: {
				name: "New Crafting Recipe",
				source,
				recipeCategory: "item",
				ingredients: [],
				componentGroups: [],
				outcomes: [],
				entries: [],
				effectTags: [],
			},
		};
		return this.normalize(prop, entity ? {...defaults[prop], ..._copy(entity)} : defaults[prop]);
	}

	static normalize (prop, entity) {
		return _NORMALIZERS[_getProp(prop)](entity);
	}

	static validate (prop, entity, opts = {}) {
		const normalized = this.normalize(prop, entity);
		const out = _validateCommon(normalized);
		_VALIDATORS[prop](normalized, out);
		if (prop === "craftingRecipe" && opts.materialCatalog != null) {
			const materialLookup = _getRecipeMaterialLookup(opts.materialCatalog);
			normalized.ingredients.forEach((ingredient, ix) => {
				if (_key(ingredient._materialRef) && !materialLookup.has(_key(ingredient._materialRef))) {
					out.warnings.push({field: `ingredients.${ix}.name`, message: `Ingredient "${ingredient.name || ix + 1}" references a material which is not currently installed; its authored name will be preserved.`});
				}
			});
		}
		return {...out, isValid: !out.errors.length, entity: normalized};
	}

	static serialize (prop, entity, opts = {}) {
		if (_getProp(prop) === "craftingRecipe") return _stripWorkbenchState(_serializeCraftingRecipe(entity, opts));
		const normalized = this.normalize(prop, entity);
		return _stripWorkbenchState(normalized);
	}

	static addRow (rows, row, {index = null} = {}) {
		const out = _copy(_asArray(rows));
		const ix = index == null ? out.length : Math.max(0, Math.min(out.length, index));
		out.splice(ix, 0, _copy(row));
		return out;
	}

	static updateRow (rows, index, update) {
		const out = _copy(_asArray(rows));
		if (index < 0 || index >= out.length) return out;
		out[index] = typeof update === "function"
			? update(_copy(out[index]))
			: {..._asObject(out[index]), ..._copy(_asObject(update))};
		return out;
	}

	static removeRow (rows, index) {
		const out = _copy(_asArray(rows));
		if (index >= 0 && index < out.length) out.splice(index, 1);
		return out;
	}

	static moveRow (rows, index, indexNext) {
		const out = _copy(_asArray(rows));
		if (index < 0 || index >= out.length || indexNext < 0 || indexNext >= out.length || index === indexNext) return out;
		const [row] = out.splice(index, 1);
		out.splice(indexNext, 0, row);
		return out;
	}
}
