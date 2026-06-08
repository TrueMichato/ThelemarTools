import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/utils-ui.js";
import "../../../js/render.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

/**
 * Bug #7 — Eldritch Invocation feat-granting in QuickBuild.
 *
 * "Lessons of the First Ones" (XPHB) declares a `featProgression` that grants one
 * Origin feat. LevelUp already surfaces + applies that grant; QuickBuild used to
 * drop it silently. These tests cover the QuickBuild apply path (cascade-add the
 * granted feat, link it for clean teardown), the validation gate, and a regression
 * guard that non-feat (spell-granting) invocations keep working through the same
 * apply path.
 */
describe("CharacterSheetQuickBuild — optional-feature featProgression grants (Bug #7)", () => {
	/** Minimal QuickBuild instance wired to a real state, no DOM. */
	function makeQuickBuild (state, {selections} = {}) {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._state = state;
		qb._page = {getSpells: () => []};
		qb._levelAnalysis = [];
		qb._selections = selections || {optionalFeatures: {}};
		return qb;
	}

	const WARLOCK_L2 = {
		className: "Warlock",
		classSource: "XPHB",
		classLevel: 2,
		optionalFeatureGains: [
			{name: "Eldritch Invocations", featureTypes: ["EI"], newCount: 1},
		],
	};

	beforeEach(() => {
		globalThis.JqueryUtil = {doToast: jest.fn()};
	});

	it("applies the Origin feat picked for Lessons of the First Ones and links it for teardown", () => {
		const state = new CharacterSheetState();

		const grantedFeat = {
			name: "Test Origin Feat",
			source: "XPHB",
			category: "O",
			// Mirrors what the level-up picker stores once a sub-choice is made.
			_featChoices: {skills: ["Stealth"]},
		};
		const invocation = {
			name: "Lessons of the First Ones",
			source: "XPHB",
			featureType: ["EI"],
			entries: ["You have received knowledge from an elder entity of the multiverse."],
			_progressionFeats: [
				{progressionName: "Origin Feat", category: ["O"], feat: grantedFeat},
			],
		};

		const qb = makeQuickBuild(state, {selections: {optionalFeatures: {EI: [invocation]}}});
		qb._levelAnalysis = [WARLOCK_L2];

		qb._applyOptionalFeaturesForLevel(WARLOCK_L2, "Warlock_2");

		// The invocation itself is on the sheet.
		const feature = state.getFeatures().find(f => f.name === "Lessons of the First Ones");
		expect(feature).toBeTruthy();
		expect(feature.featureType).toBe("Optional Feature");

		// The granted feat is on the sheet and linked back to the invocation by id.
		const feat = state.getFeats().find(f => f.name === "Test Origin Feat");
		expect(feat).toBeTruthy();
		expect(feat.linkedToOptFeature).toBeTruthy();
		expect(feat.linkedToOptFeature.id).toBe(feature.id);

		// The feat's downstream effect (chosen skill proficiency) is applied.
		expect(state.getSkillProficiency("stealth")).toBeGreaterThanOrEqual(1);
	});

	it("tears the granted feat (and its effects) back out when the invocation is removed", () => {
		const state = new CharacterSheetState();
		const grantedFeat = {
			name: "Test Origin Feat",
			source: "XPHB",
			category: "O",
			_featChoices: {skills: ["Stealth"]},
		};
		const invocation = {
			name: "Lessons of the First Ones",
			source: "XPHB",
			featureType: ["EI"],
			entries: ["..."],
			_progressionFeats: [
				{progressionName: "Origin Feat", category: ["O"], feat: grantedFeat},
			],
		};
		const qb = makeQuickBuild(state, {selections: {optionalFeatures: {EI: [invocation]}}});
		qb._levelAnalysis = [WARLOCK_L2];
		qb._applyOptionalFeaturesForLevel(WARLOCK_L2, "Warlock_2");

		expect(state.getFeats().some(f => f.name === "Test Origin Feat")).toBe(true);
		expect(state.getSkillProficiency("stealth")).toBeGreaterThanOrEqual(1);

		// Removing the invocation cascades: feat removed and its effect reverted.
		state.removeFeature("Lessons of the First Ones", "XPHB");

		expect(state.getFeatures().some(f => f.name === "Lessons of the First Ones")).toBe(false);
		expect(state.getFeats().some(f => f.name === "Test Origin Feat")).toBe(false);
		expect(state.getSkillProficiency("stealth")).toBe(0);
	});

	it("validation blocks advancing when a granted feat slot is unfilled", () => {
		const validate = jest.fn(() => ({
			valid: false,
			missing: [{optName: "Lessons of the First Ones", slot: "Origin Feat"}],
		}));
		const qb = makeQuickBuild(null, {selections: {optionalFeatures: {EI: [{name: "Lessons of the First Ones", source: "XPHB"}]}}});
		qb._page = {getLevelUpHelper: () => ({_validateOptFeatureFeatProgressionPicks: validate})};

		const ok = qb._validateOptionalFeaturesStep([WARLOCK_L2]);

		expect(ok).toBe(false);
		expect(validate).toHaveBeenCalledWith(qb._selections.optionalFeatures);
		expect(globalThis.JqueryUtil.doToast).toHaveBeenCalled();
	});

	it("validation passes when all granted feat slots are filled", () => {
		const validate = jest.fn(() => ({valid: true, missing: []}));
		const qb = makeQuickBuild(null, {selections: {optionalFeatures: {EI: [{name: "Lessons of the First Ones", source: "XPHB"}]}}});
		qb._page = {getLevelUpHelper: () => ({_validateOptFeatureFeatProgressionPicks: validate})};

		expect(qb._validateOptionalFeaturesStep([WARLOCK_L2])).toBe(true);
		expect(globalThis.JqueryUtil.doToast).not.toHaveBeenCalled();
	});

	it("regression: a spell-granting invocation (no featProgression) still grants its spell and adds no feat", () => {
		const state = new CharacterSheetState();
		const invocation = {
			name: "Misty Visions Test",
			source: "XPHB",
			featureType: ["EI"],
			// At-will innate Silent Image, like Misty Visions.
			additionalSpells: [{innate: {_: ["silent image"]}}],
		};
		const qb = makeQuickBuild(state, {selections: {optionalFeatures: {EI: [invocation]}}});
		qb._levelAnalysis = [WARLOCK_L2];

		qb._applyOptionalFeaturesForLevel(WARLOCK_L2, "Warlock_2");

		expect(state.getFeatures().some(f => f.name === "Misty Visions Test")).toBe(true);
		expect(state.getInnateSpells().some(s => s.name.toLowerCase() === "silent image")).toBe(true);
		// No feat should be granted by a non-featProgression invocation.
		expect(state.getFeats().length).toBe(0);
	});
});
