/**
 * Bug #1 — Quick Build evaluates level-gated optional-feature prerequisites at
 * the WRONG class level.
 *
 * Root cause: `_renderStandardOptFeature` built its prerequisite context from
 * `gain.maxClassLevel` — the highest class level at which ANY gain of that
 * feature TYPE occurs across the level analysis (e.g. 7 for Battle Tactics on a
 * level-9 build, whose last pre-L9 gain is at L7). A Fighter-9 build therefore
 * evaluated a `prereq.level = {level: 9, class: Fighter}` against level 7 and
 * wrongly LOCKED the level-9 tactics. Level-up gates them correctly because it
 * passes the actual target `newLevel`.
 *
 * Fix: `_resolveBuildClassLevelForGain(gain)` resolves the class's FINAL target
 * class level from `_classAllocations` (matched by className/classSource →
 * `targetLevel`), falling back to the build's overall `_targetLevel`, NEVER to
 * `gain.maxClassLevel`. The prereq context now uses that level.
 *
 * These tests drive the REAL helper used by the runtime render path and assert
 * the corrected mechanic end-to-end through `checkPrerequisites` with the exact
 * prereq-context shape `_renderStandardOptFeature` constructs.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;
const ClassUtils = globalThis.CharacterSheetClassUtils;

function makeQuickBuild ({classAllocations = [], targetLevel = null} = {}) {
	const qb = Object.create(CharacterSheetQuickBuild.prototype);
	qb._classAllocations = classAllocations;
	qb._targetLevel = targetLevel;
	return qb;
}

// A Battle-Tactics-shaped gain on a single-class Fighter-9 build. `maxClassLevel`
// is 7 — the highest level a tactic gain occurs before L9 — which is exactly the
// stale value that caused the bug.
const battleTacticsGain = {
	name: "Battle Tactics",
	className: "Fighter",
	classSource: "TGTT",
	featureTypes: ["MV:B"],
	maxClassLevel: 7,
};

// A level-9, Fighter-gated optional feature prerequisite (the kind of tactic that
// was being wrongly locked).
const level9FighterPrereq = [{level: {level: 9, class: {name: "Fighter"}}}];

describe("Bug #1 — QuickBuild prereq level resolution", () => {
	it("resolves the FINAL target class level from _classAllocations, not gain.maxClassLevel", () => {
		const qb = makeQuickBuild({
			classAllocations: [{className: "Fighter", classSource: "TGTT", currentLevel: 0, targetLevel: 9}],
			targetLevel: 9,
		});
		expect(qb._resolveBuildClassLevelForGain(battleTacticsGain)).toBe(9);
		expect(qb._resolveBuildClassLevelForGain(battleTacticsGain)).not.toBe(battleTacticsGain.maxClassLevel);
	});

	it("falls back to the build target level when no allocation matches (never maxClassLevel)", () => {
		const qb = makeQuickBuild({
			// Allocation class/source intentionally does NOT match the gain.
			classAllocations: [{className: "Wizard", classSource: "PHB", targetLevel: 5}],
			targetLevel: 9,
		});
		expect(qb._resolveBuildClassLevelForGain(battleTacticsGain)).toBe(9);
	});

	it("uses the single allocation's targetLevel even if className/classSource differ subtly", () => {
		const qb = makeQuickBuild({
			classAllocations: [{className: "Fighter", classSource: "XPHB", targetLevel: 9}],
			targetLevel: null,
		});
		// Single-class build fallback path resolves to the lone allocation's target.
		expect(qb._resolveBuildClassLevelForGain(battleTacticsGain)).toBe(9);
	});

	it("a level-9 Fighter tactic IS offered at the resolved level but NOT at the stale maxClassLevel", () => {
		const qb = makeQuickBuild({
			classAllocations: [{className: "Fighter", classSource: "TGTT", targetLevel: 9}],
			targetLevel: 9,
		});
		const buildClassLevel = qb._resolveBuildClassLevelForGain(battleTacticsGain);

		// Exact prereq-context shape constructed by _renderStandardOptFeature.
		const fixedContext = {
			classes: [{name: battleTacticsGain.className, source: battleTacticsGain.classSource, level: buildClassLevel}],
			totalLevel: buildClassLevel,
			existingFeatures: [],
			cantrips: [],
			spells: [],
		};
		const staleContext = {
			classes: [{name: battleTacticsGain.className, source: battleTacticsGain.classSource, level: battleTacticsGain.maxClassLevel}],
			totalLevel: battleTacticsGain.maxClassLevel,
			existingFeatures: [],
			cantrips: [],
			spells: [],
		};

		// Demonstrates the bug (stale max gain level locks it) AND the fix.
		expect(ClassUtils.checkPrerequisites(level9FighterPrereq, staleContext).met).toBe(false);
		expect(ClassUtils.checkPrerequisites(level9FighterPrereq, fixedContext).met).toBe(true);
	});

	it("is general: a level-7 gated option remains UNLOCKED below its level on a lower build", () => {
		const qb = makeQuickBuild({
			classAllocations: [{className: "Illrigger", classSource: "MCDM", targetLevel: 5}],
			targetLevel: 5,
		});
		const gain = {name: "Interdict Boons", className: "Illrigger", classSource: "MCDM", featureTypes: ["IB"], maxClassLevel: 5};
		const level = qb._resolveBuildClassLevelForGain(gain);
		expect(level).toBe(5);
		const prereq = [{level: {level: 7, class: {name: "Illrigger"}}}];
		const context = {classes: [{name: "Illrigger", source: "MCDM", level}], totalLevel: level, existingFeatures: [], cantrips: [], spells: []};
		expect(ClassUtils.checkPrerequisites(prereq, context).met).toBe(false);
	});
});
