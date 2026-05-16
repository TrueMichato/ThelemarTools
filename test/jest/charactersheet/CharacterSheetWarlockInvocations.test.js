
import "./setup.js"; // Import first to set up mocks

let CharacterSheetState;
let CharacterSheetClassUtils;
let charState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetClassUtils = (await import("../../../js/charactersheet/charactersheet-class-utils.js")).CharacterSheetClassUtils;
});

/**
 * Build a minimal warlock character with the given level + optional invocations.
 * Invocations are inserted into `_data.features` with the same shape used by
 * `addOptionalFeature` when an EI is selected.
 */
function buildWarlock ({level = 5, edition = "phb", invocations = [], pact = null, tgtt = false} = {}) {
	const state = new CharacterSheetState();
	const classSource = edition === "xphb" ? "XPHB" : "PHB";

	state._data.classes = [{
		name: "Warlock",
		source: classSource,
		level,
	}];

	state._data.features = [];

	if (pact) {
		state._data.features.push({
			name: pact,
			source: classSource,
			featureType: "Class Feature",
		});
	}

	for (const inv of invocations) {
		state._data.features.push({
			name: inv,
			source: classSource,
			featureType: "Optional Feature",
			optionalFeatureTypes: ["EI"],
			description: `Invocation: ${inv}`,
		});
	}

	if (tgtt) {
		state._data.settings = {...(state._data.settings || {}), enableTgtt: true};
	}

	return state;
}

describe("Warlock Invocations — Registry contract", () => {
	test("WARLOCK_INVOCATION_REGISTRY is defined and keyed by lowercase names", () => {
		expect(CharacterSheetState.WARLOCK_INVOCATION_REGISTRY).toBeDefined();
		expect(typeof CharacterSheetState.WARLOCK_INVOCATION_REGISTRY).toBe("object");
		// Spot check several well-known entries
		expect(CharacterSheetState.WARLOCK_INVOCATION_REGISTRY["agonizing blast"]).toBeDefined();
		expect(CharacterSheetState.WARLOCK_INVOCATION_REGISTRY["devil's sight"]).toBeDefined();
		expect(CharacterSheetState.WARLOCK_INVOCATION_REGISTRY["thirsting blade"]).toBeDefined();
		expect(CharacterSheetState.WARLOCK_INVOCATION_REGISTRY["lifedrinker"]).toBeDefined();
	});

	test("getWarlockInvocationEntry is case-insensitive and trims whitespace", () => {
		const a = CharacterSheetState.getWarlockInvocationEntry("Agonizing Blast");
		const b = CharacterSheetState.getWarlockInvocationEntry("  agonizing blast  ");
		expect(a).toBe(b);
		expect(a.calcFlag).toBe("hasAgonizingBlast");
	});

	test("getWarlockInvocationEntry returns null for unknown / empty input", () => {
		expect(CharacterSheetState.getWarlockInvocationEntry("not a real invocation")).toBeNull();
		expect(CharacterSheetState.getWarlockInvocationEntry("")).toBeNull();
		expect(CharacterSheetState.getWarlockInvocationEntry(null)).toBeNull();
	});

	test("every registry entry has at least one of: calcFlag, calcValues, senses, skills, interactionMode, description", () => {
		for (const [name, entry] of Object.entries(CharacterSheetState.WARLOCK_INVOCATION_REGISTRY)) {
			const hasContent = !!(entry.calcFlag || entry.calcValues || entry.senses || entry.skills || entry.interactionMode || entry.description);
			expect(hasContent).toBe(true);
		}
	});
});

describe("Warlock Invocations — Calc flag emission", () => {
	test("Agonizing Blast emits hasAgonizingBlast flag", () => {
		const state = buildWarlock({invocations: ["Agonizing Blast"]});
		const calc = state.getFeatureCalculations();
		expect(calc.hasAgonizingBlast).toBe(true);
	});

	test("Repelling Blast emits hasRepellingBlast flag", () => {
		const state = buildWarlock({invocations: ["Repelling Blast"]});
		const calc = state.getFeatureCalculations();
		expect(calc.hasRepellingBlast).toBe(true);
	});

	test("Eldritch Spear emits hasEldritchSpear flag", () => {
		const state = buildWarlock({invocations: ["Eldritch Spear"]});
		const calc = state.getFeatureCalculations();
		expect(calc.hasEldritchSpear).toBe(true);
	});

	test("Lance of Lethargy and Grasp of Hadar emit their flags", () => {
		const state = buildWarlock({invocations: ["Lance of Lethargy", "Grasp of Hadar"]});
		const calc = state.getFeatureCalculations();
		expect(calc.hasLanceOfLethargy).toBe(true);
		expect(calc.hasGraspOfHadar).toBe(true);
	});

	test("Devil's Sight emits hasDevilsSight flag (regression for previously dead code path)", () => {
		const state = buildWarlock({invocations: ["Devil's Sight"]});
		const calc = state.getFeatureCalculations();
		expect(calc.hasDevilsSight).toBe(true);
	});

	test("Thirsting Blade and Lifedrinker emit their flags", () => {
		const state = buildWarlock({level: 17, invocations: ["Thirsting Blade", "Lifedrinker"]});
		const calc = state.getFeatureCalculations();
		expect(calc.hasThirstingBlade).toBe(true);
		expect(calc.hasLifedrinker).toBe(true);
	});

	test("Beguiling Influence emits hasBeguilingInfluence flag", () => {
		const state = buildWarlock({invocations: ["Beguiling Influence"]});
		const calc = state.getFeatureCalculations();
		expect(calc.hasBeguilingInfluence).toBe(true);
	});

	test("Aspect of the Moon sets immuneToSleep on calculations", () => {
		const state = buildWarlock({invocations: ["Aspect of the Moon"]});
		const calc = state.getFeatureCalculations();
		expect(calc.hasAspectOfTheMoon).toBe(true);
		expect(calc.immuneToSleep).toBe(true);
	});

	test("Eldritch Mind emits hasEldritchMind flag", () => {
		const state = buildWarlock({invocations: ["Eldritch Mind"]});
		const calc = state.getFeatureCalculations();
		expect(calc.hasEldritchMind).toBe(true);
	});

	test("Multiple invocations all emit their flags simultaneously", () => {
		const state = buildWarlock({
			level: 12,
			invocations: ["Agonizing Blast", "Repelling Blast", "Devil's Sight", "Eldritch Spear"],
		});
		const calc = state.getFeatureCalculations();
		expect(calc.hasAgonizingBlast).toBe(true);
		expect(calc.hasRepellingBlast).toBe(true);
		expect(calc.hasDevilsSight).toBe(true);
		expect(calc.hasEldritchSpear).toBe(true);
	});

	test("Unknown invocations do not crash or emit unexpected flags", () => {
		const state = buildWarlock({invocations: ["Made Up Invocation Name"]});
		expect(() => state.getFeatureCalculations()).not.toThrow();
		const calc = state.getFeatureCalculations();
		expect(calc.hasAgonizingBlast).toBeUndefined();
	});

	test("A non-warlock character does not get invocation flags even if features list contains EI entries", () => {
		const state = new CharacterSheetState();
		state._data.classes = [{name: "Fighter", source: "PHB", level: 5}];
		state._data.features = [{
			name: "Agonizing Blast",
			source: "PHB",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["EI"],
		}];
		const calc = state.getFeatureCalculations();
		expect(calc.hasAgonizingBlast).toBeUndefined();
	});
});

describe("Warlock Invocations — Active states regression guard", () => {
	test("Agonizing Blast is NOT detected as an activatable feature", () => {
		const feature = {
			name: "Agonizing Blast",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["EI"],
			description: "An eldritch invocation that adds your Charisma modifier to eldritch blast damage.",
		};
		const result = CharacterSheetState.detectActivatableFeature(feature);
		expect(result).toBeNull();
	});

	test("Devil's Sight is NOT detected as an activatable feature", () => {
		const feature = {
			name: "Devil's Sight",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["EI"],
			description: "You can see normally in darkness, both magical and nonmagical, to a distance of 120 ft. This eldritch invocation grants extraordinary sight.",
		};
		const result = CharacterSheetState.detectActivatableFeature(feature);
		expect(result).toBeNull();
	});

	test("Mask of Many Faces is NOT detected as an activatable feature", () => {
		const feature = {
			name: "Mask of Many Faces",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["EI"],
			description: "You can cast disguise self at will, without expending a spell slot. This eldritch invocation provides a useful tool.",
		};
		const result = CharacterSheetState.detectActivatableFeature(feature);
		expect(result).toBeNull();
	});

	test("The 'Eldritch Invocations' presenter feature itself is NOT activatable", () => {
		const feature = {
			name: "Eldritch Invocations",
			featureType: "Class Feature",
			description: "You have learned to invoke incantations of eldritch power.",
		};
		const result = CharacterSheetState.detectActivatableFeature(feature);
		expect(result).toBeNull();
	});

	test("The 'Eldritch Invocation Options' presenter feature is NOT activatable", () => {
		const feature = {
			name: "Eldritch Invocation Options",
			featureType: "Class Feature",
			description: "The following options are available for your Eldritch Invocation feature.",
		};
		const result = CharacterSheetState.detectActivatableFeature(feature);
		expect(result).toBeNull();
	});

	test("Unknown invocations (not in registry) are still treated as passive", () => {
		const feature = {
			name: "Hypothetical New Invocation",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["EI"],
			description: "You gain a bonus action ability with eldritch invocation flavor.",
		};
		const result = CharacterSheetState.detectActivatableFeature(feature);
		expect(result).toBeNull();
	});
});

describe("Warlock Invocations — Prereq matcher (class-utils)", () => {
	test("PHB short-form pact prereq matches existing feature ('Blade' matches 'Pact of the Blade')", () => {
		const result = CharacterSheetClassUtils.checkPrerequisites(
			[{pact: "Blade"}],
			{existingFeatures: [{name: "Pact of the Blade"}]},
		);
		expect(result.met).toBe(true);
		expect(result.reasons).toHaveLength(0);
	});

	test("PHB short-form pact prereq fails when feature absent", () => {
		const result = CharacterSheetClassUtils.checkPrerequisites(
			[{pact: "Chain"}],
			{existingFeatures: []},
		);
		expect(result.met).toBe(false);
		expect(result.reasons).toContain("Pact of the Chain");
	});

	test("Full-name pact prereq matches literal feature name (TGTT Pact of Transformation)", () => {
		const result = CharacterSheetClassUtils.checkPrerequisites(
			[{pact: "Pact of Transformation"}],
			{existingFeatures: [{name: "Pact of Transformation"}]},
		);
		expect(result.met).toBe(true);
		expect(result.reasons).toHaveLength(0);
	});

	test("Full-name pact prereq fails when feature absent (TGTT Pact of Transformation)", () => {
		const result = CharacterSheetClassUtils.checkPrerequisites(
			[{pact: "Pact of Transformation"}],
			{existingFeatures: [{name: "Pact of the Blade"}]},
		);
		expect(result.met).toBe(false);
		// Use the literal pact name for the reason rather than nonsense like "Pact of the Pact of Transformation"
		expect(result.reasons.some(r => r.toLowerCase() === "pact of transformation")).toBe(true);
		expect(result.reasons.some(r => r.toLowerCase().includes("pact of the pact"))).toBe(false);
	});

	test("Level prereq still works alongside pact prereq", () => {
		const result = CharacterSheetClassUtils.checkPrerequisites(
			[{level: {level: 5, class: {name: "Warlock"}}}, {pact: "Blade"}],
			{classes: [{name: "Warlock", level: 3}], totalLevel: 3, existingFeatures: []},
		);
		expect(result.met).toBe(false);
		// Both unmet reasons surface
		expect(result.reasons.some(r => r.includes("Level 5"))).toBe(true);
		expect(result.reasons.some(r => r === "Pact of the Blade")).toBe(true);
	});
});

describe("Warlock Invocations — TGTT (Pact of Transformation)", () => {
	test("Abomination's Physique gated by TGTT setting: OFF → no flags", () => {
		const state = buildWarlock({invocations: ["Abomination's Physique"], tgtt: false});
		const calc = state.getFeatureCalculations();
		expect(calc.hasAbominationsPhysique).toBeFalsy();
		expect(calc.bonusWalkSpeed).toBeFalsy();
	});

	test("Abomination's Physique with TGTT enabled → emits flags and speed/jump bonuses", () => {
		const state = buildWarlock({invocations: ["Abomination's Physique"], tgtt: true});
		const calc = state.getFeatureCalculations();
		expect(calc.hasAbominationsPhysique).toBe(true);
		expect(calc.bonusWalkSpeed).toBe(10);
		expect(calc.bonusJumpFeet).toBe(5);
		expect(calc.hasPowerfulBuild).toBe(true);
	});

	test("Gravity Defied with TGTT enabled emits hasGravityDefied", () => {
		const state = buildWarlock({level: 5, invocations: ["Gravity Defied"], tgtt: true});
		const calc = state.getFeatureCalculations();
		expect(calc.hasGravityDefied).toBe(true);
	});

	test("All six TGTT PoT invocations are recognised as known (registry entries exist)", () => {
		const potInvocations = [
			"abomination's physique",
			"leaper",
			"burrower",
			"gravity defied",
			"spiked carapace",
			"extra appendages",
		];
		for (const name of potInvocations) {
			expect(CharacterSheetState.WARLOCK_INVOCATION_REGISTRY[name]).toBeDefined();
			expect(CharacterSheetState.WARLOCK_INVOCATION_REGISTRY[name].tgtt).toBe(true);
		}
	});

	test("TGTT PoT invocations never appear as activatable features (Phase A regression guard)", () => {
		for (const name of ["Abomination's Physique", "Leaper", "Burrower", "Gravity Defied", "Spiked Carapace", "Extra Appendages"]) {
			const feature = {
				name,
				featureType: "Optional Feature",
				optionalFeatureTypes: ["EI"],
				description: "TGTT pact-of-transformation invocation body text.",
			};
			expect(CharacterSheetState.detectActivatableFeature(feature)).toBeNull();
		}
	});
});
