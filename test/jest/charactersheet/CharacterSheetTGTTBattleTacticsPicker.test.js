import "./setup.js";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

/**
 * Bug #3 — Fighter "Battle Tactics" picker (TGTT homebrew).
 *
 * Root cause was DATA: the TGTT Fighter Battle Tactics
 * `optionalfeatureProgression.progression` was authored incrementally
 * ({2:2,7:1,10:1,15:1}) while 5etools convention (and both picker readers) treat
 * object progressions as CUMULATIVE totals. The fix re-authors it cumulatively
 * ({2:2,7:3,10:4,15:5}). These tests pin the corrected counts in BOTH reader paths
 * (quickbuild `_getOptionalFeatureGains` and class-utils `getOptionalFeatureGains`,
 * the level-up source) and assert the level-locked tactics gate correctly.
 */
describe("Battle Tactics picker — count + level gating (Bug #3)", () => {
	const __dirname = dirname(fileURLToPath(import.meta.url));
	const tgtt = JSON.parse(readFileSync(join(__dirname, "../../../homebrew/TravelersGuidetoThelemar.json"), "utf8"));
	const fighter = tgtt.class.find(c => c.name === "Fighter" && c.source === "TGTT");
	const battleTactics = tgtt.optionalfeature.filter(o => (o.featureType || []).includes("BT"));

	const btProg = () => fighter.optionalfeatureProgression.find(p => (p.featureType || []).includes("BT"));

	/** Minimal QuickBuild with no DOM, empty feature state. */
	function makeQuickBuild () {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._state = {getFeatures: () => []};
		return qb;
	}

	it("data is authored as cumulative totals (not incremental)", () => {
		// Regression guard against re-introducing the incremental authoring bug.
		expect(btProg().progression).toEqual({2: 2, 7: 3, 10: 4, 15: 5});
	});

	it.each([
		[2, 2],
		[6, 2],
		[7, 3],
		[9, 3],
		[10, 4],
		[14, 4],
		[15, 5],
		[20, 5],
	])("quickbuild reader: total Battle Tactics at fighter L%i = %i", (level, expected) => {
		const qb = makeQuickBuild();
		const gains = qb._getOptionalFeatureGains(fighter, level, {}, null);
		const bt = gains.find(g => g.featureTypes.join("_") === "BT");
		// A jump-from-zero analysis should surface the full cumulative total at that level.
		if (expected > 0) {
			expect(bt).toBeTruthy();
			expect(bt.totalCount).toBe(expected);
		}
	});

	it.each([
		[2, 2],
		[7, 3],
		[10, 4],
		[15, 5],
	])("class-utils reader (level-up): cumulative total at fighter L%i = %i", (level, expected) => {
		const state = {getFeatures: () => []};
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(fighter, 0, level, state, null);
		const bt = gains.find(g => g.featureTypes.join("_") === "BT");
		expect(bt).toBeTruthy();
		expect(bt.totalCount).toBe(expected);
	});

	it("incremental single-level transitions accumulate to the right total", () => {
		// Walk 0->2->7->10->15 one threshold at a time, accumulating running counts
		// the way quickbuild does; newCount should sum to the cumulative total.
		const qb = makeQuickBuild();
		const runningCounts = {};
		let total = 0;
		for (const level of [2, 7, 10, 15]) {
			const gains = qb._getOptionalFeatureGains(fighter, level, runningCounts, null);
			const bt = gains.find(g => g.featureTypes.join("_") === "BT");
			if (bt) {
				total += bt.newCount;
				runningCounts.BT = (runningCounts.BT || 0) + bt.newCount;
			}
		}
		expect(total).toBe(5);
	});

	// ---- Level gating via getEligibleOptionalFeatures + prereq context ----

	const eligibleAt = (fighterLevel) => CharacterSheetClassUtils.getEligibleOptionalFeatures(
		battleTactics,
		{featureTypes: ["BT"], prereqContext: {classes: [{name: "Fighter", level: fighterLevel}]}},
	);
	const selectable = (list, name) => list.find(o => o.name === name)?._selectable;

	it("ungated tactics are selectable at every level", () => {
		expect(selectable(eligibleAt(2), "High Ground")).toBe(true);
		expect(selectable(eligibleAt(2), "Flanking")).toBe(true);
	});

	it("Dying Surge (L5) is gated below 5, selectable at 5+", () => {
		expect(selectable(eligibleAt(4), "Dying Surge")).toBe(false);
		expect(selectable(eligibleAt(5), "Dying Surge")).toBe(true);
	});

	it("Eye of the Storm / Back to the Wall (L7) are gated below 7, selectable at 7+", () => {
		expect(selectable(eligibleAt(6), "Eye of the Storm")).toBe(false);
		expect(selectable(eligibleAt(7), "Eye of the Storm")).toBe(true);
		expect(selectable(eligibleAt(6), "Back to the Wall")).toBe(false);
		expect(selectable(eligibleAt(7), "Back to the Wall")).toBe(true);
	});

	it("Daring Feint / Sheathing the Sword (L9) are gated below 9, selectable at 9+", () => {
		expect(selectable(eligibleAt(8), "Daring Feint")).toBe(false);
		expect(selectable(eligibleAt(9), "Daring Feint")).toBe(true);
		expect(selectable(eligibleAt(8), "Sheathing the Sword")).toBe(false);
		expect(selectable(eligibleAt(9), "Sheathing the Sword")).toBe(true);
	});
});
