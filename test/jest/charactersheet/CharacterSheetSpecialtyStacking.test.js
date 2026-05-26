/**
 * Regression suite for bugs.md "Adept Speed quickbuild stacking".
 *
 * Repeatable specialty picks (TGTT Monk's Adept Speed) are defined in data with
 * `level: 2` (the level at which the parent Specialties feature unlocks). The
 * apply paths previously spread the data-level into the stored feature, so every
 * pick — regardless of which Specialty level it was chosen at — landed with
 * `level: 2` and was collapsed by `addFeature`'s
 * (name, source, className, level) dedup. Only the first pick survived.
 *
 * Fix: strip `level` from the feature spread and pass the caller's character
 * level explicitly. Cross-level picks now produce distinct stored levels and
 * survive dedup. Same-pick re-application (respec replay, builder finalize)
 * still correctly collapses to one entry per (level, pick).
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

// Adept Speed as it appears in homebrew/TravelersGuidetoThelemar.json — note
// `level: 2` (the Specialties unlock level), not the level at which it was picked.
const ADEPT_SPEED_DEF = Object.freeze({
	name: "Adept Speed",
	source: "TGTT",
	className: "Monk",
	classSource: "TGTT",
	level: 2,
	entries: ["Your speed increases by 10 feet while you aren't wearing armor or wielding a shield. This feature can be chosen multiple times, and its effects stack."],
});

const MARATHON_RUNNER_DEF = Object.freeze({
	name: "Marathon Runner",
	source: "TGTT",
	className: "Monk",
	classSource: "TGTT",
	level: 2,
	entries: ["You ignore exhaustion from forced marches."],
});

function makeMockState () {
	/** @type {*[]} */
	const features = [];
	return {
		features,
		addFeature: jest.fn((/** @type {*} */ f) => {
			// Mirror the real addFeature dedup contract: collapse on
			// (name, source, className, level).
			const dup = features.find(x =>
				x.name === f.name
				&& x.source === f.source
				&& x.className === f.className
				&& x.level === f.level,
			);
			if (dup) return dup;
			features.push(f);
			return f;
		}),
	};
}

function makeQuickBuild ({classFeatures = [ADEPT_SPEED_DEF, MARATHON_RUNNER_DEF], state} = {}) {
	const qb = Object.create(CharacterSheetQuickBuild.prototype);
	qb._state = state;
	qb._page = {
		getClassFeatures: jest.fn(() => classFeatures),
		getOptionalFeatures: jest.fn(() => []),
		getSubclassFeatures: jest.fn(() => []),
	};
	qb._selections = {featureOptions: {}};
	qb._getSubclassForClass = jest.fn(() => null);
	return qb;
}

function makeAnalysis (classLevel) {
	return {
		className: "Monk",
		classSource: "TGTT",
		classLevel,
		featureOptions: [{featureName: "Specialties"}],
	};
}

describe("Repeatable specialty stacking — QuickBuild", () => {
	it("stores Adept Speed picks at distinct character levels (L2/L4/L6) and survives dedup", () => {
		const state = makeMockState();
		const qb = makeQuickBuild({state});

		const pick = {type: "classFeature", ref: "Adept Speed|Monk|TGTT|2", name: "Adept Speed", level: 2};

		[2, 4, 6].forEach(classLevel => {
			const analysis = makeAnalysis(classLevel);
			qb._selections.featureOptions[`Monk_${classLevel}_Specialties`] = [pick];
			qb._applyFeatureOptionsForLevel(analysis);
		});

		const adept = state.features.filter(f => f.name === "Adept Speed");
		expect(adept).toHaveLength(3);
		expect(adept.map(f => f.level).sort((a, b) => a - b)).toEqual([2, 4, 6]);
		// Sanity: all picks tagged as feature-options, parented correctly.
		adept.forEach(f => {
			expect(f.isFeatureOption).toBe(true);
			expect(f.parentFeature).toBe("Specialties");
			expect(f.className).toBe("Monk");
			expect(f.source).toBe("TGTT");
		});
	});

	it("does not duplicate when the same pick at the same level is applied twice (dedup preserved)", () => {
		const state = makeMockState();
		const qb = makeQuickBuild({state});

		const pick = {type: "classFeature", ref: "Adept Speed|Monk|TGTT|2", name: "Adept Speed", level: 2};
		qb._selections.featureOptions["Monk_2_Specialties"] = [pick];

		// Simulate a re-apply (e.g. wizard re-finalize) of the same selection
		// at the same character level.
		qb._applyFeatureOptionsForLevel(makeAnalysis(2));
		qb._applyFeatureOptionsForLevel(makeAnalysis(2));

		const adept = state.features.filter(f => f.name === "Adept Speed");
		expect(adept).toHaveLength(1);
		expect(adept[0].level).toBe(2);
	});

	it("stacks mixed repeatable + non-repeatable specialty picks correctly", () => {
		const state = makeMockState();
		const qb = makeQuickBuild({state});

		// L2: Adept Speed + Marathon Runner. L4: Adept Speed again.
		qb._selections.featureOptions["Monk_2_Specialties"] = [
			{type: "classFeature", ref: "Adept Speed|Monk|TGTT|2", name: "Adept Speed", level: 2},
			{type: "classFeature", ref: "Marathon Runner|Monk|TGTT|2", name: "Marathon Runner", level: 2},
		];
		qb._selections.featureOptions["Monk_4_Specialties"] = [
			{type: "classFeature", ref: "Adept Speed|Monk|TGTT|2", name: "Adept Speed", level: 2},
		];

		qb._applyFeatureOptionsForLevel(makeAnalysis(2));
		qb._applyFeatureOptionsForLevel(makeAnalysis(4));

		const adept = state.features.filter(f => f.name === "Adept Speed");
		const marathon = state.features.filter(f => f.name === "Marathon Runner");
		expect(adept).toHaveLength(2);
		expect(adept.map(f => f.level).sort((a, b) => a - b)).toEqual([2, 4]);
		expect(marathon).toHaveLength(1);
		expect(marathon[0].level).toBe(2);
	});
});

describe("Repeatable specialty stacking — buildFeatureStateObject contract", () => {
	it("uses caller-supplied level when feature object's level is undefined", () => {
		// The fix relies on apply paths spreading `level: undefined` so that
		// `buildFeatureStateObject`'s `outFeature.level || level` resolves to
		// the caller's level. Lock that contract here.
		const out = CharacterSheetClassUtils.buildFeatureStateObject(
			{
				name: "Adept Speed",
				source: "TGTT",
				className: "Monk",
				level: undefined,
				entries: ["..."],
			},
			{
				className: "Monk",
				classSource: "TGTT",
				level: 6,
				isFeatureOption: true,
				parentFeature: "Specialties",
			},
		);
		expect(out.level).toBe(6);
		expect(out.isFeatureOption).toBe(true);
		expect(out.parentFeature).toBe("Specialties");
	});

	it("still honours an explicit feature-defined level when present", () => {
		// Non-feature-option call sites continue to get data-level semantics.
		const out = CharacterSheetClassUtils.buildFeatureStateObject(
			{
				name: "Extra Attack",
				source: "PHB",
				className: "Fighter",
				level: 5,
				entries: ["..."],
			},
			{
				className: "Fighter",
				classSource: "PHB",
				level: 999,
			},
		);
		expect(out.level).toBe(5);
	});
});
