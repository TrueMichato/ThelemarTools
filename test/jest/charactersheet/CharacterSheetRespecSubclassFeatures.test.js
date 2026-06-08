/**
 * Bug #2 — Changing a subclass via respec must grant the NEW subclass's features.
 *
 * The old `_applySubclassChange` filtered the flat `getSubclassFeatures()` catalog
 * directly by shortName/source/className/level. That missed every subclass whose
 * features are expressed as 7-part `refSubclassFeature` strings (level encoded in the
 * ref), so a respec to e.g. the FRHoF Bladesinger granted ZERO features, and never ran
 * the choice pipeline. The fix routes acquisition through
 * `CharacterSheetClassUtils.getLevelFeatures()` + `addFeature()` (same as Level-Up).
 *
 * Asserts REAL mechanics:
 *  - NEW subclass features up to the current class level are added (via string refs
 *    resolved by getSubclassFeatureRefLevel + the catalog).
 *  - OLD subclass features are removed.
 *  - No duplicate features.
 *  - Prose choices on the new features reach pendingFeatureChoices (player is prompted).
 *  - Multiclass safety: swapping one class's subclass does NOT touch another class's
 *    features even when shortNames could collide.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-respec.js";

let CharacterSheetState;
let CharacterSheetRespec;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetRespec = globalThis.CharacterSheetRespec;
});

// Flat subclassFeature catalog (what _page.getSubclassFeatures() returns) — full
// objects with entries, looked up by the string refs below.
const SUBCLASS_FEATURE_CATALOG = [
	{
		name: "Training in War and Song",
		className: "Wizard",
		subclassShortName: "Bladesinger",
		subclassSource: "FRHoF",
		source: "FRHoF",
		level: 3,
		entries: [
			"You gain proficiency with all Melee Martial weapons that don't have the {@itemProperty 2H|XPHB|Two-Handed} or {@itemProperty H|XPHB|Heavy} property.",
			"You also gain proficiency in one of the following skills of your choice: {@skill Acrobatics|XPHB}, {@skill Athletics|XPHB}, {@skill Performance|XPHB}, or {@skill Persuasion|XPHB}.",
		],
	},
	{
		name: "Extra Attack",
		className: "Wizard",
		subclassShortName: "Bladesinger",
		subclassSource: "FRHoF",
		source: "FRHoF",
		level: 6,
		entries: ["You can attack twice, instead of once, whenever you take the Attack action on your turn."],
	},
];

// New subclass uses 7-part refs (canonical level at parts[5], with a trailing display
// source as parts[6]) — the exact shape modern reprints like FRHoF Bladesinger use, and
// the shape the old code resolved to NaN level (granting zero features).
function bladesingerSubclass () {
	return {
		name: "Bladesinger",
		shortName: "Bladesinger",
		source: "FRHoF",
		subclassFeatures: [
			"Training in War and Song|Wizard|XPHB|Bladesinger|FRHoF|3|FRHoF",
			"Extra Attack|Wizard|XPHB|Bladesinger|FRHoF|6|FRHoF",
		],
	};
}

function makeRespec (state, catalog = SUBCLASS_FEATURE_CATALOG) {
	const respec = Object.create(CharacterSheetRespec.prototype);
	respec._state = state;
	respec._page = {
		getSubclassFeatures: () => catalog,
		getClassFeatures: () => [],
		getClasses: () => state.getClasses(),
		filterByAllowedSources: (arr) => arr,
	};
	respec._$timeline = null;
	respec._$legacyBadge = null;
	return respec;
}

// A stand-in OLD subclass feature already on the sheet.
function addOldEvocationFeature (state) {
	state.addFeature({
		name: "Sculpt Spells",
		source: "PHB",
		level: 2,
		className: "Wizard",
		classSource: "PHB",
		subclassName: "School of Evocation",
		subclassShortName: "Evocation",
		subclassSource: "PHB",
		featureType: "Subclass",
		isSubclassFeature: true,
		entries: ["You can create pockets of relative safety within the effects of your evocation spells."],
	});
}

describe("CharacterSheetRespec subclass change — feature acquisition (Bug #2)", () => {
	let state;
	let respec;
	const history = {level: 3, class: {name: "Wizard", source: "XPHB"}};
	const oldSubclass = {name: "School of Evocation", shortName: "Evocation", source: "PHB"};

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({
			name: "Wizard",
			source: "XPHB",
			level: 6,
			subclass: {name: "School of Evocation", shortName: "Evocation", source: "PHB"},
		});
		addOldEvocationFeature(state);
		respec = makeRespec(state);
	});

	test("adds the NEW subclass features up to the current class level", async () => {
		await respec._applySubclassChange(3, history, oldSubclass, bladesingerSubclass());

		const names = state.getFeatures().map(f => f.name);
		expect(names).toContain("Training in War and Song"); // level 3
		expect(names).toContain("Extra Attack"); // level 6 (≤ class level 6)
	});

	test("removes the OLD subclass features", async () => {
		expect(state.getFeatures().some(f => f.name === "Sculpt Spells")).toBe(true);
		await respec._applySubclassChange(3, history, oldSubclass, bladesingerSubclass());
		expect(state.getFeatures().some(f => f.name === "Sculpt Spells")).toBe(false);
	});

	test("produces NO duplicate features", async () => {
		await respec._applySubclassChange(3, history, oldSubclass, bladesingerSubclass());
		const counts = {};
		state.getFeatures().forEach(f => { counts[f.name] = (counts[f.name] || 0) + 1; });
		Object.values(counts).forEach(c => expect(c).toBe(1));
	});

	test("queues the new feature's prose skill choice (player is prompted)", async () => {
		await respec._applySubclassChange(3, history, oldSubclass, bladesingerSubclass());
		const skillChoices = state.getPendingFeatureChoices().filter(c => c.kind === "skill");
		expect(skillChoices).toHaveLength(1);
		expect(skillChoices[0].featureName).toBe("Training in War and Song");
		expect(skillChoices[0].options.sort()).toEqual(["acrobatics", "athletics", "performance", "persuasion"]);
	});

	test("points the class entry at the new subclass", async () => {
		await respec._applySubclassChange(3, history, oldSubclass, bladesingerSubclass());
		const cls = state.getClasses().find(c => c.name === "Wizard");
		expect(cls.subclass.name).toBe("Bladesinger");
		expect(cls.subclass.shortName).toBe("Bladesinger");
	});

	test("does not add features above the current class level", async () => {
		// Drop the Wizard to level 3 — Extra Attack (level 6) must NOT be granted.
		state.getClasses().find(c => c.name === "Wizard").level = 3;
		await respec._applySubclassChange(3, history, oldSubclass, bladesingerSubclass());
		const names = state.getFeatures().map(f => f.name);
		expect(names).toContain("Training in War and Song");
		expect(names).not.toContain("Extra Attack");
	});
});

describe("CharacterSheetRespec subclass change — multiclass safety (Bug #2)", () => {
	test("swapping the Wizard subclass leaves another class's subclass features intact", async () => {
		const state = new CharacterSheetState();
		state.addClass({
			name: "Wizard",
			source: "XPHB",
			level: 6,
			subclass: {name: "School of Evocation", shortName: "Evocation", source: "PHB"},
		});
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 3,
			subclass: {name: "Champion", shortName: "Champion", source: "PHB"},
		});
		addOldEvocationFeature(state);
		// A Fighter subclass feature that must survive a Wizard-subclass respec.
		state.addFeature({
			name: "Improved Critical",
			source: "PHB",
			level: 3,
			className: "Fighter",
			classSource: "PHB",
			subclassName: "Champion",
			subclassShortName: "Champion",
			subclassSource: "PHB",
			featureType: "Subclass",
			isSubclassFeature: true,
			entries: ["Your weapon attacks score a critical hit on a roll of 19 or 20."],
		});

		const respec = makeRespec(state);
		const history = {level: 3, class: {name: "Wizard", source: "XPHB"}};
		const oldSubclass = {name: "School of Evocation", shortName: "Evocation", source: "PHB"};

		await respec._applySubclassChange(3, history, oldSubclass, bladesingerSubclass());

		// Fighter feature untouched.
		expect(state.getFeatures().some(f => f.name === "Improved Critical")).toBe(true);
		// Wizard subclass swapped correctly.
		expect(state.getFeatures().some(f => f.name === "Sculpt Spells")).toBe(false);
		expect(state.getFeatures().some(f => f.name === "Training in War and Song")).toBe(true);
	});
});
