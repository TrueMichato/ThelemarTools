/**
 * R20 S3 — Level-up / QuickBuild picker fixes (bugs #9, #12, #18).
 *
 * Reference character: a Hochling Illrigger (Hellspeaker) on the MCDM
 * IllriggerRevised brew (surfaced through TGTT). IllriggerRevised is EXTERNAL
 * runtime homebrew — its class/feature JSON is not in the repo — so these tests
 * reconstruct the minimal data shapes the level-up flow consumes.
 *
 * #9  — Interdict Boons (ItdBoon) were greyed out at level-up because the prereq
 *       context was built from the PRE-increment character/class level. A boon
 *       whose real prerequisite is "Illrigger level 2", offered while leveling
 *       1→2, failed its own level prereq. Fixed by building the context against
 *       the POST-increment state.
 * #12 — The level-up flow rendered no weapon-mastery picker, so an Illrigger
 *       gaining 2 masteries at L2 could never choose them. Added a detection
 *       helper + a level-up picker that persists into state.
 * #18 — Moloch's Blessing (Hellspeaker L3) skill choice fired at the *next*
 *       level-up (L4) because single-class _applyLevelUp never flushed pending
 *       feature choices queued during its newFeatures add loop. Fixed by draining
 *       them at the end of the apply (single-class + multiclass paths).
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

import {readFileSync} from "fs";
import {fileURLToPath} from "url";
import {dirname, resolve} from "path";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const read = (/** @type {string} */ rel) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

// ==========================================================================
// BUG #9 — Interdict Boon eligibility uses the POST-increment level context
// ==========================================================================
describe("Bug #9 — Interdict Boon selectability at level-up", () => {
	// A boon with a generic level-2 prerequisite (the most common ItdBoon shape).
	const boonGenericL2 = {
		name: "Baleful Interdict",
		source: "IllriggerRevised",
		featureType: ["ItdBoon"],
		prerequisite: [{level: 2}],
	};
	// A boon whose prerequisite is class-scoped ("Illrigger level 2").
	const boonClassScopedL2 = {
		name: "Vengeful Interdict",
		source: "IllriggerRevised",
		featureType: ["ItdBoon"],
		prerequisite: [{level: {level: 2, class: {name: "Illrigger"}}}],
	};
	const allBoons = [boonGenericL2, boonClassScopedL2];

	it("greys out a level-2 boon under the PRE-increment context (reproduces the bug)", () => {
		// Leveling 1→2 but reading the still-committed level 1.
		const preIncrementContext = {
			classes: [{name: "Illrigger", source: "IllriggerRevised", level: 1}],
			totalLevel: 1,
			existingFeatures: [],
		};
		const eligible = CharacterSheetClassUtils.getEligibleOptionalFeatures(allBoons, {
			featureTypes: ["ItdBoon"],
			prereqContext: preIncrementContext,
			alreadyKnown: [],
		});
		expect(eligible.every((/** @type {*} */ o) => o._selectable)).toBe(false);
		expect(eligible.find((/** @type {*} */ o) => o.name === "Baleful Interdict")._selectable).toBe(false);
		expect(eligible.find((/** @type {*} */ o) => o.name === "Vengeful Interdict")._selectable).toBe(false);
	});

	it("makes both level-2 boon shapes selectable under the POST-increment context (the fix)", () => {
		// The context the corrected render method builds: total +1, leveling class bumped.
		const postIncrementContext = {
			classes: [{name: "Illrigger", source: "IllriggerRevised", level: 2}],
			totalLevel: 2,
			existingFeatures: [],
		};
		const eligible = CharacterSheetClassUtils.getEligibleOptionalFeatures(allBoons, {
			featureTypes: ["ItdBoon"],
			prereqContext: postIncrementContext,
			alreadyKnown: [],
		});
		expect(eligible.find((/** @type {*} */ o) => o.name === "Baleful Interdict")._selectable).toBe(true);
		expect(eligible.find((/** @type {*} */ o) => o.name === "Vengeful Interdict")._selectable).toBe(true);
	});

	it("still blocks a boon whose level prerequisite is genuinely unmet", () => {
		const boonL5 = {name: "Greater Interdict", source: "IllriggerRevised", featureType: ["ItdBoon"], prerequisite: [{level: 5}]};
		const postIncrementContext = {
			classes: [{name: "Illrigger", source: "IllriggerRevised", level: 2}],
			totalLevel: 2,
			existingFeatures: [],
		};
		const eligible = CharacterSheetClassUtils.getEligibleOptionalFeatures([boonL5], {
			featureTypes: ["ItdBoon"],
			prereqContext: postIncrementContext,
			alreadyKnown: [],
		});
		expect(eligible[0]._selectable).toBe(false);
		expect(eligible[0]._meetsPrereqs).toBe(false);
	});
});

describe("Bug #9 — level-up render wiring (source guards)", () => {
	const SRC = read("js/charactersheet/charactersheet-levelup.js");

	it("threads a levelContext from the modal call sites into the optional-features render", () => {
		// All Class Options render call sites carry the leveling class identity + new level.
		const matches = SRC.match(/levelContext:\s*\{className:\s*classEntry\.name,\s*classSource:\s*classEntry\.source,\s*newClassLevel:\s*newLevel\}/g) || [];
		expect(matches.length).toBeGreaterThanOrEqual(1);
		expect(SRC).toMatch(/_renderStandardOptionalFeaturesLevelUp \([^)]*levelContext\s*=\s*null\)/);
	});

	it("builds the prereq context from the POST-increment level (total +1, bumped class level)", () => {
		expect(SRC).toMatch(/\(this\._state\.getTotalLevel\(\)\s*\|\|\s*0\)\s*\+\s*1/);
		expect(SRC).toMatch(/level:\s*levelContext\.newClassLevel/);
	});
});

// ==========================================================================
// BUG #12 — weapon-mastery grant detection + level-up persistence
// ==========================================================================
describe("Bug #12 — getWeaponMasteryGainForLevelUp", () => {
	// Illrigger-style: no table column, a fixed-count "Weapon Mastery" feature at L2.
	const ILL_CLASS = {
		name: "Illrigger",
		source: "IllriggerRevised",
		classFeatures: [
			[], // L1
			[{name: "Weapon Mastery"}], // L2
			[], // L3
		],
	};
	const ILL_FEATURES = [
		{
			name: "Weapon Mastery",
			className: "Illrigger",
			source: "IllriggerRevised",
			level: 2,
			entries: ["You gain mastery with two kinds of weapons of your choice."],
		},
	];

	// Generic 2024 class: count scales via a classTableGroups "Weapon Mastery" column.
	const FIGHTER_CLASS = {
		name: "Fighter",
		source: "XPHB",
		classTableGroups: [{
			colLabels: ["Weapon Mastery"],
			// rows indexed by level-1: L1=3, L2=3, L3=3, L4=4
			rows: [[3], [3], [3], [4]],
		}],
	};

	it("returns {count: 2} for the Illrigger 1→2 crossing (first grant via feature prose)", () => {
		expect(CharacterSheetClassUtils.getWeaponMasteryGainForLevelUp(ILL_CLASS, 1, 2, ILL_FEATURES)).toEqual({count: 2});
	});

	it("returns null when the Illrigger crosses a level that grants no new masteries", () => {
		expect(CharacterSheetClassUtils.getWeaponMasteryGainForLevelUp(ILL_CLASS, 2, 3, ILL_FEATURES)).toBeNull();
		expect(CharacterSheetClassUtils.getWeaponMasteryGainForLevelUp(ILL_CLASS, 0, 1, ILL_FEATURES)).toBeNull();
	});

	it("detects a table-driven first grant and a later increase for a generic class", () => {
		expect(CharacterSheetClassUtils.getWeaponMasteryGainForLevelUp(FIGHTER_CLASS, 0, 1)).toEqual({count: 3});
		expect(CharacterSheetClassUtils.getWeaponMasteryGainForLevelUp(FIGHTER_CLASS, 3, 4)).toEqual({count: 4});
		expect(CharacterSheetClassUtils.getWeaponMasteryGainForLevelUp(FIGHTER_CLASS, 1, 2)).toBeNull();
	});

	it("parses the granted count from prose for varying wordings", () => {
		expect(CharacterSheetClassUtils.parseWeaponMasteryCountFromEntries(["mastery with three kinds of weapons"])).toBe(3);
		expect(CharacterSheetClassUtils.parseWeaponMasteryCountFromEntries(["one kind of weapon"])).toBe(1);
		expect(CharacterSheetClassUtils.parseWeaponMasteryCountFromEntries([])).toBe(2);
	});

	it("computes the cumulative count available at a level", () => {
		expect(CharacterSheetClassUtils.getWeaponMasteryCountAtLevel(ILL_CLASS, 1, ILL_FEATURES)).toBe(0);
		expect(CharacterSheetClassUtils.getWeaponMasteryCountAtLevel(ILL_CLASS, 2, ILL_FEATURES)).toBe(2);
		expect(CharacterSheetClassUtils.getWeaponMasteryCountAtLevel(ILL_CLASS, 3, ILL_FEATURES)).toBe(2);
	});
});

describe("Bug #12 — weapon-mastery state persistence round-trip", () => {
	it("persists selected masteries on the state and reads them back", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 2});
		const picks = ["Greataxe|XPHB", "Longsword|XPHB"];
		state.setWeaponMasteries(picks);
		expect(state.getWeaponMasteries()).toEqual(picks);
	});
});

describe("Bug #12 — level-up render + apply wiring (source guards)", () => {
	const SRC = read("js/charactersheet/charactersheet-levelup.js");

	it("detects the grant via the shared helper and seeds from existing masteries", () => {
		expect(SRC).toMatch(/getWeaponMasteryGainForLevelUp\(/);
		expect(SRC).toMatch(/selectedWeaponMasteries\s*=\s*\[\s*\.\.\.\(this\._state\.getWeaponMasteries\?\.\(\)\s*\|\|\s*\[\]\)\]/);
	});

	it("renders a dedicated level-up weapon-mastery picker accordion", () => {
		expect(SRC).toMatch(/_renderWeaponMasteryLevelUp \(/);
		expect(SRC).toMatch(/createAccordion\("weaponmastery"/);
		expect(SRC).toMatch(/createSummaryItem\("weaponmastery"/);
	});

	it("validates the required mastery count before finishing", () => {
		expect(SRC).toMatch(/selectedWeaponMasteries\.length\s*<\s*weaponMasteryGain\.count/);
	});

	it("persists the selection in _applyLevelUp via setWeaponMasteries", () => {
		expect(SRC).toMatch(/this\._state\.setWeaponMasteries\(\[\.\.\.selectedWeaponMasteries\]\)/);
	});

	it("uses a method name distinct from the S1 Forked-Tongue swap render", () => {
		// Guard against accidental collision with the sibling-owned function.
		expect(SRC).not.toMatch(/_renderWeaponMasteryLevelUp[\s\S]{0,40}ForkedTongue/);
	});
});

// ==========================================================================
// BUG #18 — Moloch's Blessing skill choice surfaces at L3, not L4
// ==========================================================================
describe("Bug #18 — Moloch's Blessing skill choice queues at the level it's gained", () => {
	const MOLOCH_DESC = "When Moloch accepts you as his illrigger, you gain proficiency in the {@skill Persuasion} or "
		+ "{@skill Deception} skill (your choice). If you already have proficiency in the skill of your choice, your "
		+ "proficiency bonus is doubled for any ability check you make with that skill.";

	function addHellspeaker (state, level) {
		state._data.abilities.cha = 16;
		state.addClass({
			name: "Illrigger",
			source: "IllriggerRevised",
			level,
			subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"},
		});
		state.applyClassFeatureEffects();
	}

	it("enqueues a pending skill choice the moment the L3 feature is added (the apply does this)", () => {
		const state = new CharacterSheetState();
		addHellspeaker(state, 3);
		// Mirrors what _applyLevelUp's newFeatures loop does when reaching Illrigger L3.
		state.addFeature({name: "Moloch's Blessing", classSource: "IllriggerRevised", description: MOLOCH_DESC});

		const choice = state.getPendingFeatureChoices().find((/** @type {*} */ c) => c.featureName === "Moloch's Blessing");
		expect(choice).toBeDefined();
		expect(choice.kind).toBe("skill");
		expect(choice.options.sort()).toEqual(["deception", "persuasion"]);
		// A pending choice EXISTS right after L3 — so flushing at the end of the L3 apply
		// surfaces it now rather than letting it slip to the next level-up.
		expect(state.hasPendingFeatureChoices()).toBe(true);
	});
});

describe("Bug #18 — apply flushes pending feature choices (source guards)", () => {
	const SRC = read("js/charactersheet/charactersheet-levelup.js");

	it("single-class _applyLevelUp drains pending feature choices before the final save", () => {
		// The flush must appear inside _applyLevelUp, before its saveCharacter() call,
		// so the Moloch's Blessing choice queued during the newFeatures loop surfaces at L3.
		const applyStart = SRC.indexOf("async _applyLevelUp (");
		expect(applyStart).toBeGreaterThan(-1);
		const applyBody = SRC.slice(applyStart, SRC.indexOf("async showMulticlass"));
		const flushIdx = applyBody.indexOf("await this._processFeatSpellChoices();");
		const saveIdx = applyBody.lastIndexOf("await this._page.saveCharacter();");
		expect(flushIdx).toBeGreaterThan(-1);
		// The last flush precedes the final save.
		expect(applyBody.lastIndexOf("await this._processFeatSpellChoices();")).toBeLessThan(saveIdx);
	});

	it("multiclass _applyMulticlass also drains pending feature choices before its save", () => {
		const mcStart = SRC.indexOf("async _applyMulticlass (");
		expect(mcStart).toBeGreaterThan(-1);
		const mcBody = SRC.slice(mcStart);
		const flushIdx = mcBody.indexOf("await this._processFeatSpellChoices();");
		const saveIdx = mcBody.indexOf("await this._page.saveCharacter();");
		expect(flushIdx).toBeGreaterThan(-1);
		expect(flushIdx).toBeLessThan(saveIdx);
	});
});

describe("Bug #18 — QuickBuild already flushes (no regression expected)", () => {
	const QB_SRC = read("js/charactersheet/charactersheet-quickbuild.js");

	it("processes pending feature choices at the end of its apply", () => {
		expect(QB_SRC).toMatch(/processPendingFeatureChoices\(\)/);
	});
});
