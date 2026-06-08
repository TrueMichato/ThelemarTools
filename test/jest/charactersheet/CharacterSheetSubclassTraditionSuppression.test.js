import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-levelup.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;

/**
 * Bug 5 — Fighter subclass combat-tradition choice DOUBLE-spawns.
 *
 * When a Fighter subclass grants a CHOICE of traditions (Champion, Battle
 * Master, Arcane Archer, Purple Dragon Knight), QuickBuild/LevelUp used to
 * render BOTH the base "Choose N Combat Traditions" picker (all 17) AND the
 * subclass-choice picker, offering the same picks twice. The subclass choice
 * should be the SINGLE tradition flow for those subclasses, while Monk-style
 * additive pools (Open Hand/Kensei) keep the base picker.
 */
describe("Bug 5 — subclass tradition picker suppression", () => {
	const sub = (shortName) => ({name: shortName, shortName, source: "TGTT", classSource: "TGTT"});

	describe("shouldSuppressBaseTraditionPicker resolver", () => {
		test.each([
			["Champion"],
			["Battle Master"],
			["Arcane Archer"],
			["Purple Dragon Knight (Banneret)"],
		])("suppresses base picker for Fighter %s (replacesBase)", (name) => {
			expect(CharacterSheetClassUtils.shouldSuppressBaseTraditionPicker(sub(name), "TGTT")).toBe(true);
		});

		test.each([
			["Open Hand"],
			["Debilitation"],
			["Kensei"],
		])("keeps base picker for additive Monk %s", (name) => {
			expect(CharacterSheetClassUtils.shouldSuppressBaseTraditionPicker(sub(name), "TGTT")).toBe(false);
		});

		test("keeps base picker for fixed-grant subclasses with no choice pool (Cavalier, Eldritch Knight)", () => {
			expect(CharacterSheetClassUtils.shouldSuppressBaseTraditionPicker(sub("Cavalier"), "TGTT")).toBe(false);
			expect(CharacterSheetClassUtils.shouldSuppressBaseTraditionPicker(sub("Eldritch Knight"), "TGTT")).toBe(false);
		});

		test("returns false when there is no subclass", () => {
			expect(CharacterSheetClassUtils.shouldSuppressBaseTraditionPicker(null, "TGTT")).toBe(false);
		});

		test("returns false for a non-TGTT subclass", () => {
			const phbChampion = {name: "Champion", shortName: "Champion", source: "PHB", classSource: "PHB"};
			expect(CharacterSheetClassUtils.shouldSuppressBaseTraditionPicker(phbChampion, "PHB")).toBe(false);
		});

		test("getSubclassTraditionChoicePool surfaces replacesBase only for Fighter pools", () => {
			expect(CharacterSheetClassUtils.getSubclassTraditionChoicePool(sub("Champion"), "TGTT").replacesBase).toBe(true);
			expect(CharacterSheetClassUtils.getSubclassTraditionChoicePool(sub("Open Hand"), "TGTT").replacesBase).toBe(false);
		});
	});

	// Verify the QuickBuild combat-methods step wires the resolver into a single
	// tradition flow: for a replacesBase subclass the base picker is never built
	// (its only data source — getAvailableTraditionsForClass — is not consulted)
	// while the subclass-choice picker still fires; for an additive subclass BOTH
	// flows run.
	describe("QuickBuild _renderCombatMethodsOptFeature wiring", () => {
		let getAvailSpy;

		function makeQuickBuildFor (subclass, {className, classSource}) {
			const qb = Object.create(CharacterSheetQuickBuild.prototype);
			qb._resetSelections();
			qb._state = {getSettings: () => ({}), getFeatures: () => []};
			qb._page = {
				getOptionalFeatures: () => [],
				filterByAllowedSources: (/** @type {*} */ x) => x,
				getClassFeatures: () => [],
				getCombatMethodEntities: () => [],
				resolveOptionalFeatureSource: (/** @type {*} */ n, /** @type {*} */ arr) => arr[0],
			};
			// Bypass state-based subclass resolution.
			qb._getSubclassForClass = () => subclass;
			// Stub the subclass-choice picker so we can assert it fires without
			// exercising its internal DOM queries (the test e_ stub has no real
			// querySelector).
			qb._renderQuickBuildSubclassTraditionPicker = jest.fn();

			const gain = {
				name: "Combat Methods",
				featureTypes: ["CTM:1", "CTM:2", "CTM:3"],
				totalNeeded: 2,
				className,
				classSource,
				classData: {name: className, source: classSource},
				maxClassLevel: 5,
			};
			const step = globalThis.e_({outer: `<div></div>`});
			qb._renderCombatMethodsOptFeature(step, gain.featureTypes.join("_"), gain);
			return qb;
		}

		beforeEach(() => {
			globalThis.JqueryUtil = {doToast: jest.fn()};
			globalThis.CharacterSheetPage = globalThis.CharacterSheetPage
				|| {getHoverLink: () => "<strong>trad</strong>"};
			// getAvailableTraditionsForClass is the SOLE data source for the base
			// picker; spying on it lets us assert whether the base flow ran without
			// depending on rendered DOM. Empty list keeps any base-picker loop inert.
			getAvailSpy = jest.spyOn(CharacterSheetClassUtils, "getAvailableTraditionsForClass").mockReturnValue([]);
		});

		afterEach(() => {
			getAvailSpy.mockRestore();
		});

		test("Fighter + Champion: base picker suppressed (single subclass flow)", () => {
			const qb = makeQuickBuildFor(sub("Champion"), {className: "Fighter", classSource: "TGTT"});
			// Base picker never consulted its tradition source...
			expect(getAvailSpy).not.toHaveBeenCalled();
			// ...but the subclass-choice picker still ran, with a replacesBase pool.
			expect(qb._renderQuickBuildSubclassTraditionPicker).toHaveBeenCalledTimes(1);
			const poolArg = qb._renderQuickBuildSubclassTraditionPicker.mock.calls[0][1];
			expect(poolArg.replacesBase).toBe(true);
			expect(poolArg.kind).not.toBe("none");
		});

		test("Monk + Open Hand: BOTH the base picker and the subclass picker run (additive)", () => {
			const qb = makeQuickBuildFor(sub("Open Hand"), {className: "Monk", classSource: "TGTT"});
			expect(getAvailSpy).toHaveBeenCalled();
			expect(qb._renderQuickBuildSubclassTraditionPicker).toHaveBeenCalledTimes(1);
			const poolArg = qb._renderQuickBuildSubclassTraditionPicker.mock.calls[0][1];
			expect(poolArg.replacesBase).toBe(false);
		});
	});

	// LevelUp shares the same resolver, and previously suffered the identical
	// double-offer (its "no traditions yet" branch rendered BOTH the base picker
	// and the subclass picker before returning). Same wiring assertions for parity.
	describe("LevelUp _renderCombatMethodsLevelUp wiring", () => {
		let getAvailSpy;

		function makeLevelUpFor (subclass, {className, classSource}) {
			const lu = Object.create(CharacterSheetLevelUp.prototype);
			lu._state = {getFeatures: () => []};
			lu._page = {getClassFeatures: () => []};
			// Stub the two renderers reached on the suppressed/normal path so we can
			// assert the subclass picker still fires without exercising real DOM queries.
			lu._renderSubclassTraditionChoicePickerLevelUp = jest.fn();
			lu._renderMethodsForLevelUp = jest.fn();

			const classData = {name: className, source: classSource};
			const gain = {name: "Combat Methods", featureTypes: ["CTM:1", "CTM:2", "CTM:3"]};
			const container = globalThis.e_({outer: `<div></div>`});
			lu._renderCombatMethodsLevelUp(
				container, classData, gain, 3, [], [], jest.fn(), "k",
				{subclassGrantedTraditionCodes: [], existingSelections: [], activeSubclass: subclass},
			);
			return lu;
		}

		beforeEach(() => {
			globalThis.JqueryUtil = {doToast: jest.fn()};
			globalThis.CharacterSheetPage = globalThis.CharacterSheetPage
				|| {getHoverLink: () => "<strong>trad</strong>"};
			getAvailSpy = jest.spyOn(CharacterSheetClassUtils, "getAvailableTraditionsForClass").mockReturnValue([]);
		});

		afterEach(() => {
			getAvailSpy.mockRestore();
		});

		test("Fighter + Champion: base picker suppressed, subclass picker still renders", () => {
			const lu = makeLevelUpFor(sub("Champion"), {className: "Fighter", classSource: "TGTT"});
			expect(getAvailSpy).not.toHaveBeenCalled();
			// Falls through to the normal flow, which renders only the subclass picker.
			expect(lu._renderSubclassTraditionChoicePickerLevelUp).toHaveBeenCalledTimes(1);
			const poolArg = lu._renderSubclassTraditionChoicePickerLevelUp.mock.calls[0][1];
			expect(poolArg.replacesBase).toBe(true);
		});

		test("Monk + Open Hand: base picker IS rendered (additive)", () => {
			const lu = makeLevelUpFor(sub("Open Hand"), {className: "Monk", classSource: "TGTT"});
			expect(getAvailSpy).toHaveBeenCalled();
			expect(lu._renderSubclassTraditionChoicePickerLevelUp).toHaveBeenCalledTimes(1);
			const poolArg = lu._renderSubclassTraditionChoicePickerLevelUp.mock.calls[0][1];
			expect(poolArg.replacesBase).toBe(false);
		});
	});
});
