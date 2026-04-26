/**
 * Combat Method Migration Tests
 *
 * Tests the adapter layer in ClassUtils and state migration for the
 * optionalfeature → combatMethod entity transition.
 *
 * Covers:
 * - ClassUtils adapter helpers (isCombatMethod, getMethodDegree, etc.)
 * - State migration (_migrateFeatures converts legacy CTM → new shape)
 * - getCombatMethods() detecting both legacy and new entity formats
 * - _parseCombatMethodEffects() using structured fields for new entities
 * - normalizeMethodToCommon() producing consistent output for both formats
 */

import "./setup.js";

let CharacterSheetState;
let CharacterSheetClassUtils;

beforeAll(async () => {
	const classUtilsModule = await import("../../../js/charactersheet/charactersheet-class-utils.js");
	CharacterSheetClassUtils = classUtilsModule.CharacterSheetClassUtils || globalThis.CharacterSheetClassUtils;

	const stateModule = await import("../../../js/charactersheet/charactersheet-state.js");
	CharacterSheetState = stateModule.CharacterSheetState || globalThis.CharacterSheetState;
});

// =========================================================================
// Test Data Factories
// =========================================================================

function makeLegacyCTM (name, tradition, degree, description) {
	return {
		name,
		source: "TGTT",
		featureType: "Optional Feature",
		optionalFeatureTypes: [`CTM:${degree}${tradition}`, `CTM:${tradition}`, "CTM"],
		description,
	};
}

function makeNewCombatMethod (name, tradition, degree, {staminaCost = 1, actionType = "bonus action", description = ""} = {}) {
	return {
		name,
		source: "TGTT",
		_entityType: "combatMethod",
		tradition,
		degree,
		staminaCost,
		actionType,
		entries: description ? [description] : [],
		description,
	};
}

// =========================================================================
// ClassUtils Adapter Helpers
// =========================================================================

describe("ClassUtils Adapter — isCombatMethod", () => {
	it("detects legacy CTM optionalfeature", () => {
		const legacy = makeLegacyCTM("Heavy Stance", "AM", 1, "...");
		expect(CharacterSheetClassUtils.isCombatMethod(legacy)).toBe(true);
	});

	it("detects new combatMethod entity by _entityType", () => {
		const newEntity = makeNewCombatMethod("Heavy Stance", "Adamant Mountain", 1);
		expect(CharacterSheetClassUtils.isCombatMethod(newEntity)).toBe(true);
	});

	it("detects new combatMethod entity by structured fields (no _entityType)", () => {
		const entity = {
			name: "Heavy Stance",
			source: "TGTT",
			tradition: "Adamant Mountain",
			degree: 1,
			staminaCost: 1,
		};
		expect(CharacterSheetClassUtils.isCombatMethod(entity)).toBe(true);
	});

	it("rejects non-combat features", () => {
		const invocation = {
			name: "Agonizing Blast",
			source: "PHB",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["EI"],
		};
		expect(CharacterSheetClassUtils.isCombatMethod(invocation)).toBe(false);
	});

	it("rejects plain class features", () => {
		const feature = {
			name: "Extra Attack",
			source: "PHB",
			featureType: "Class",
			className: "Fighter",
		};
		expect(CharacterSheetClassUtils.isCombatMethod(feature)).toBe(false);
	});
});

describe("ClassUtils Adapter — getMethodDegree", () => {
	it("extracts degree from legacy CTM feature type", () => {
		const legacy = makeLegacyCTM("Lean Into It", "AM", 1, "...");
		expect(CharacterSheetClassUtils.getMethodDegree(legacy)).toBe(1);
	});

	it("extracts degree from legacy 3rd degree", () => {
		const legacy = makeLegacyCTM("Unbreakable", "AM", 3, "...");
		expect(CharacterSheetClassUtils.getMethodDegree(legacy)).toBe(3);
	});

	it("reads degree field from new entity", () => {
		const newEntity = makeNewCombatMethod("Unbreakable", "Adamant Mountain", 3);
		expect(CharacterSheetClassUtils.getMethodDegree(newEntity)).toBe(3);
	});

	it("returns 0 for non-combat features", () => {
		expect(CharacterSheetClassUtils.getMethodDegree({name: "foo"})).toBe(0);
	});
});

describe("ClassUtils Adapter — getMethodTraditionCode", () => {
	it("extracts tradition code from legacy CTM feature type", () => {
		const legacy = makeLegacyCTM("Swift Stance", "RC", 1, "...");
		expect(CharacterSheetClassUtils.getMethodTraditionCode(legacy)).toBe("RC");
	});

	it("converts full tradition name to code from new entity", () => {
		const newEntity = makeNewCombatMethod("Swift Stance", "Rapid Current", 1);
		expect(CharacterSheetClassUtils.getMethodTraditionCode(newEntity)).toBe("RC");
	});

	it("returns null for non-combat features", () => {
		expect(CharacterSheetClassUtils.getMethodTraditionCode({name: "foo"})).toBeNull();
	});
});

describe("ClassUtils Adapter — getMethodTraditionName", () => {
	it("maps legacy code to full name", () => {
		const legacy = makeLegacyCTM("Feral Stance", "BU", 1, "...");
		expect(CharacterSheetClassUtils.getMethodTraditionName(legacy)).toBe("Beast Unity");
	});

	it("reads tradition field from new entity", () => {
		const newEntity = makeNewCombatMethod("Feral Stance", "Beast Unity", 1);
		expect(CharacterSheetClassUtils.getMethodTraditionName(newEntity)).toBe("Beast Unity");
	});
});

describe("ClassUtils Adapter — getMethodStaminaCost", () => {
	it("reads staminaCost from new entity", () => {
		const newEntity = makeNewCombatMethod("Unbreakable", "Adamant Mountain", 3, {staminaCost: 3});
		expect(CharacterSheetClassUtils.getMethodStaminaCost(newEntity)).toBe(3);
	});

	it("reads consumes.amount from legacy entity", () => {
		const legacy = {
			...makeLegacyCTM("Unbreakable", "AM", 3, "..."),
			consumes: {name: "Stamina", amount: 3},
		};
		expect(CharacterSheetClassUtils.getMethodStaminaCost(legacy)).toBe(3);
	});
});

describe("ClassUtils Adapter — getMethodActionType", () => {
	it("reads actionType from new entity", () => {
		const newEntity = makeNewCombatMethod("Swift Stance", "Rapid Current", 1, {actionType: "bonus action"});
		expect(CharacterSheetClassUtils.getMethodActionType(newEntity)).toBe("bonus action");
	});
});

describe("ClassUtils Adapter — tradition maps", () => {
	it("TRADITION_CODE_TO_NAME has all 18 traditions", () => {
		const map = CharacterSheetClassUtils.TRADITION_CODE_TO_NAME;
		expect(Object.keys(map).length).toBe(18);
		expect(map.AM).toBe("Adamant Mountain");
		expect(map.RC).toBe("Rapid Current");
		expect(map.AS).toBe("Ace Starfighter");
	});

	it("getTraditionName maps codes to full names", () => {
		expect(CharacterSheetClassUtils.getTraditionName("BZ")).toBe("Biting Zephyr");
		expect(CharacterSheetClassUtils.getTraditionName("XX")).toBe("XX");
	});

	it("getTraditionCode maps names to codes", () => {
		expect(CharacterSheetClassUtils.getTraditionCode("Biting Zephyr")).toBe("BZ");
		expect(CharacterSheetClassUtils.getTraditionCode("Unknown")).toBeNull();
	});
});

describe("ClassUtils Adapter — normalizeMethodToCommon", () => {
	it("normalizes legacy CTM to common shape", () => {
		const legacy = makeLegacyCTM("Heavy Stance", "AM", 1, "Bonus Action (1 Stamina Point). You enter a heavy stance.");
		const normalized = CharacterSheetClassUtils.normalizeMethodToCommon(legacy);

		expect(normalized.name).toBe("Heavy Stance");
		expect(normalized.tradition).toBe("Adamant Mountain");
		expect(normalized.traditionCode).toBe("AM");
		expect(normalized.degree).toBe(1);
		expect(normalized._isLegacyCTM).toBe(true);
	});

	it("normalizes new entity to common shape", () => {
		const newEntity = makeNewCombatMethod("Heavy Stance", "Adamant Mountain", 1, {staminaCost: 1, actionType: "bonus action"});
		const normalized = CharacterSheetClassUtils.normalizeMethodToCommon(newEntity);

		expect(normalized.name).toBe("Heavy Stance");
		expect(normalized.tradition).toBe("Adamant Mountain");
		expect(normalized.traditionCode).toBe("AM");
		expect(normalized.degree).toBe(1);
		expect(normalized.staminaCost).toBe(1);
		expect(normalized.actionType).toBe("bonus action");
		expect(normalized._isLegacyCTM).toBe(false);
	});
});

// =========================================================================
// State: getCombatMethods() detects both formats
// =========================================================================

describe("State — getCombatMethods with dual format", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 5, hitDice: "d10"});
		state.addCombatTradition("AM");
	});

	it("detects legacy CTM features", () => {
		state.addFeature(makeLegacyCTM("Heavy Stance", "AM", 1, "Bonus Action (1 Stamina Point). This stance lasts until you end it."));

		const methods = state.getCombatMethods();
		expect(methods.length).toBe(1);
		expect(methods[0].name).toBe("Heavy Stance");
		expect(methods[0].degree).toBe(1);
		expect(methods[0].tradition).toBe("AM");
	});

	it("detects new combatMethod entities", () => {
		state.addFeature({
			...makeNewCombatMethod("Heavy Stance", "Adamant Mountain", 1, {staminaCost: 1, actionType: "bonus action"}),
			description: "Bonus Action (1 Stamina Point). This stance lasts until you end it.",
		});

		const methods = state.getCombatMethods();
		expect(methods.length).toBe(1);
		expect(methods[0].name).toBe("Heavy Stance");
		expect(methods[0].degree).toBe(1);
		expect(methods[0].tradition).toBe("AM");
	});

	it("new entity uses structured fields for stamina/action, skips text parsing", () => {
		state.addFeature({
			...makeNewCombatMethod("Custom Method", "Adamant Mountain", 2, {staminaCost: 2, actionType: "reaction"}),
			// Description intentionally says "Bonus Action" but structured field says "reaction"
			description: "Bonus Action (1 Stamina Point). Some text.",
		});

		const methods = state.getCombatMethods();
		const m = methods.find(x => x.name === "Custom Method");
		expect(m.staminaCost).toBe(2); // From structured field, not text
		expect(m.actionType).toBe("Reaction"); // From structured field (title-cased), not text
		expect(m.degree).toBe(2);
	});

	it("detects both legacy and new entities in same character", () => {
		state.addFeature(makeLegacyCTM("Heavy Stance", "AM", 1, "Bonus Action (1 Stamina Point). This stance lasts."));
		state.addFeature({
			...makeNewCombatMethod("Lean Into It", "Adamant Mountain", 1, {staminaCost: 2, actionType: "action"}),
			description: "Action (2 Stamina Points). When you hit, knock prone.",
		});

		const methods = state.getCombatMethods();
		expect(methods.length).toBe(2);
		expect(methods.map(m => m.name).sort()).toEqual(["Heavy Stance", "Lean Into It"]);
	});
});

// =========================================================================
// State: _migrateFeatures converts legacy CTM on load
// =========================================================================

describe("State — _migrateFeatures legacy CTM conversion", () => {
	it("converts legacy CTM features to combatMethod shape on load", () => {
		const state = new CharacterSheetState();
		const saveData = {
			id: "test-migration",
			name: "Test Fighter",
			classes: [{name: "Fighter", source: "TGTT", level: 5, hitDice: "d10"}],
			features: [
				{
					name: "Heavy Stance",
					source: "TGTT",
					featureType: "Optional Feature",
					optionalFeatureTypes: ["CTM:1AM", "CTM:AM", "CTM"],
					description: "Bonus Action (1 Stamina Point).",
				},
			],
			abilities: {str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8},
		};

		state.loadFromJson(saveData);

		const features = state.getFeatures();
		const heavy = features.find(f => f.name === "Heavy Stance");
		expect(heavy._entityType).toBe("combatMethod");
		expect(heavy.tradition).toBe("Adamant Mountain");
		expect(heavy.degree).toBe(1);
	});

	it("does not double-migrate features that already have _entityType", () => {
		const state = new CharacterSheetState();
		const saveData = {
			id: "test-migration-2",
			name: "Test Fighter",
			classes: [{name: "Fighter", source: "TGTT", level: 5, hitDice: "d10"}],
			features: [
				{
					name: "Heavy Stance",
					source: "TGTT",
					_entityType: "combatMethod",
					tradition: "Adamant Mountain",
					degree: 1,
					staminaCost: 1,
					featureType: "Optional Feature",
					optionalFeatureTypes: ["CTM:1AM", "CTM:AM", "CTM"],
					description: "Bonus Action (1 Stamina Point).",
				},
			],
			abilities: {str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8},
		};

		state.loadFromJson(saveData);

		const features = state.getFeatures();
		const heavy = features.find(f => f.name === "Heavy Stance");
		expect(heavy._entityType).toBe("combatMethod");
		expect(heavy.tradition).toBe("Adamant Mountain");
	});

	it("does not migrate non-CTM optional features", () => {
		const state = new CharacterSheetState();
		const saveData = {
			id: "test-migration-3",
			name: "Test Warlock",
			classes: [{name: "Warlock", source: "PHB", level: 5, hitDice: "d8"}],
			features: [
				{
					name: "Agonizing Blast",
					source: "PHB",
					featureType: "Optional Feature",
					optionalFeatureTypes: ["EI"],
					description: "Add CHA to eldritch blast damage.",
				},
			],
			abilities: {str: 10, dex: 14, con: 14, int: 10, wis: 12, cha: 16},
		};

		state.loadFromJson(saveData);

		const features = state.getFeatures();
		const agonizing = features.find(f => f.name === "Agonizing Blast");
		expect(agonizing._entityType).toBeUndefined();
		expect(agonizing.featureType).toBe("Optional Feature");
	});
});

// =========================================================================
// State: usesCombatSystem detects both formats
// =========================================================================

describe("State — usesCombatSystem with both formats", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 5, hitDice: "d10"});
	});

	it("returns true with legacy CTM features", () => {
		state.addFeature(makeLegacyCTM("Heavy Stance", "AM", 1, "..."));
		expect(state.usesCombatSystem()).toBe(true);
	});

	it("returns true with new combatMethod entities", () => {
		state.addFeature(makeNewCombatMethod("Heavy Stance", "Adamant Mountain", 1));
		expect(state.usesCombatSystem()).toBe(true);
	});

	it("returns true with combat traditions set (no methods)", () => {
		state.addCombatTradition("AM");
		expect(state.usesCombatSystem()).toBe(true);
	});

	it("returns false with no combat features or traditions", () => {
		expect(state.usesCombatSystem()).toBe(false);
	});
});
