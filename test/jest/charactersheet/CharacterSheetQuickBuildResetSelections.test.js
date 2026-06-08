import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

/**
 * Bug 6 — QuickBuild a Fighter immediately AFTER using the Builder crashed:
 *   "Cannot read properties of undefined (reading 'Fighter_2')"
 *   at CharacterSheetQuickBuild._buildHistoryEntry (... `this._selections.classFeatProgression[levelKey]`).
 *
 * Root cause: `_resetSelections()` rebuilt `_selections` but omitted
 * `classFeatProgression: {}` (the constructor seeds it, but both entry points
 * call `_resetSelections()` so the constructor value is always overwritten).
 * A Fighter going to level 2 has no class-feat-progression (Fighting Style)
 * gain, so the lazy initializer is never hit and `_buildHistoryEntry` is the
 * first code to index the undefined container → throw before the `|| []`.
 */
describe("CharacterSheetQuickBuild — _resetSelections / _buildHistoryEntry (Bug 6)", () => {
	/** A bare QuickBuild instance with no page/state wiring. */
	function makeBareQuickBuild () {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._page = {getState: () => ({})};
		return qb;
	}

	beforeEach(() => {
		globalThis.JqueryUtil = {doToast: jest.fn()};
	});

	test("_resetSelections() seeds classFeatProgression as an object", () => {
		const qb = makeBareQuickBuild();
		qb._resetSelections();
		expect(qb._selections.classFeatProgression).toBeDefined();
		expect(typeof qb._selections.classFeatProgression).toBe("object");
		expect(Array.isArray(qb._selections.classFeatProgression)).toBe(false);
	});

	test("_resetSelections() seeds every selection key the constructor seeds (no drift)", () => {
		// Capture the constructor's selection shape.
		const constructed = new CharacterSheetQuickBuild({getState: () => ({})});
		const constructorKeys = Object.keys(constructed._selections);

		const qb = makeBareQuickBuild();
		qb._resetSelections();
		const resetKeys = new Set(Object.keys(qb._selections));

		const missing = constructorKeys.filter(k => !resetKeys.has(k));
		expect(missing).toEqual([]);
	});

	test("_buildHistoryEntry does not throw for a fresh-reset Fighter going to level 2", () => {
		// Reproduces the Builder→QuickBuild-Fighter sequence: showFromBuilder()
		// calls _resetSelections(), then _applyQuickBuild() calls _buildHistoryEntry
		// for "Fighter_2" — which used to crash on the undefined container.
		const qb = makeBareQuickBuild();
		qb._resetSelections();

		const analysis = {
			characterLevel: 2,
			className: "Fighter",
			classSource: "PHB",
			classLevel: 2,
			needsSubclass: false,
			optionalFeatureGains: [],
			featureOptions: [],
			expertiseGrants: [],
			languageGrants: [],
		};

		let entry;
		expect(() => { entry = qb._buildHistoryEntry(analysis, "Fighter_2"); }).not.toThrow();

		expect(entry).toBeDefined();
		expect(entry.level).toBe(2);
		expect(entry.class).toEqual({name: "Fighter", source: "PHB"});
		expect(entry.choices).toBeDefined();
		// No Fighting Style at L2 → no class-feat-progression feats recorded.
		expect(entry.choices.classFeatProgressionFeats).toBeUndefined();
		expect(entry.complete).toBe(true);
	});

	test("_buildHistoryEntry records class-feat-progression feats when present", () => {
		const qb = makeBareQuickBuild();
		qb._resetSelections();
		qb._selections.classFeatProgression["Fighter_1"] = [
			{progressionName: "Fighting Style", category: "FS:F", feat: {name: "Defense", source: "PHB"}},
		];

		const analysis = {
			characterLevel: 1,
			className: "Fighter",
			classSource: "PHB",
			classLevel: 1,
			needsSubclass: false,
			optionalFeatureGains: [],
			featureOptions: [],
			expertiseGrants: [],
			languageGrants: [],
		};

		const entry = qb._buildHistoryEntry(analysis, "Fighter_1");
		expect(entry.choices.classFeatProgressionFeats).toEqual([
			{progressionName: "Fighting Style", name: "Defense", source: "PHB", category: "FS:F"},
		]);
	});
});
