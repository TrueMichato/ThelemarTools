/**
 * Character Sheet — Round 9 follow-up regressions
 *
 * Four bugs that survived the Round 8 fixes because the earlier patches landed on
 * sibling surfaces (pure parsers / play-mode) instead of the surfaces the user reads:
 *
 *  #1 Overview speed still showed the "ft." unit. The pure parser
 *     (parseSpeedString / buildSpeedDisplayParts) intentionally KEEPS the unit, so the
 *     strip now happens at the display layer via CharacterSheetClassUtils.stripSpeedUnit.
 *  #2 Spell source badge showed the generic pool label ("Spells Known" /
 *     "Prepared Spells" / "Spells Prepared") instead of the owning class. _getSpellSourceLabel
 *     now skips a generic PLAYER_CHOSEN_SPELL_FEATURES label and falls through to the class.
 *  #3 No way to manually correct the Primal Focus resources in play.
 *     setFocusSwitchesRemaining / setHuntersDodgeRemaining clamp to [0, max] and round-trip.
 *  #4 Druid's Magician (Primal Order) bonus cantrip never reached QuickBuild's prepared
 *     spell picker. _getMagicianBonusCantrips surfaces the +1 from the selected options.
 *
 * Assertions check actual helper / state output, not level counts.
 */

import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

describe("Round 9 follow-up — #1 stripSpeedUnit (overview display)", () => {
	test("drops a plain 'ft.' unit but keeps the value", () => {
		expect(CharacterSheetClassUtils.stripSpeedUnit("40 ft.")).toBe("40");
		expect(CharacterSheetClassUtils.stripSpeedUnit("30 ft")).toBe("30");
	});

	test("drops the unit from every segment of a multi-speed string", () => {
		expect(CharacterSheetClassUtils.stripSpeedUnit("40 ft., fly 60 ft.")).toBe("40, fly 60");
		expect(CharacterSheetClassUtils.stripSpeedUnit("30 ft., swim 30 ft., climb 30 ft.")).toBe("30, swim 30, climb 30");
	});

	test("preserves a trailing annotation (exhaustion / halved)", () => {
		expect(CharacterSheetClassUtils.stripSpeedUnit("35 ft. (-5)")).toBe("35 (-5)");
		expect(CharacterSheetClassUtils.stripSpeedUnit("15 feet (halved)")).toBe("15 (halved)");
	});

	test("handles 0 and empty / nullish input without throwing", () => {
		expect(CharacterSheetClassUtils.stripSpeedUnit("0 ft.")).toBe("0");
		expect(CharacterSheetClassUtils.stripSpeedUnit("")).toBe("");
		expect(CharacterSheetClassUtils.stripSpeedUnit(null)).toBe("");
		expect(CharacterSheetClassUtils.stripSpeedUnit(undefined)).toBe("");
	});

	test("does NOT leave a stray dot or double space behind", () => {
		const out = CharacterSheetClassUtils.stripSpeedUnit("40 ft. (-5)");
		expect(out).not.toMatch(/\.$/);
		expect(out).not.toMatch(/ {2,}/);
		expect(out).toBe("40 (-5)");
	});

	test("the pure parser is unchanged — buildSpeedDisplayParts still carries the unit", () => {
		// The strip is a display-layer concern only; the canonical parser keeps "ft."
		// so state.getSpeed() and the exhaustion regex that reads it stay intact.
		const parts = CharacterSheetClassUtils.buildSpeedDisplayParts("40 ft.", {useEmoji: true});
		const joined = JSON.stringify(parts);
		expect(joined).toContain("ft");
	});
});

describe("Round 9 follow-up — #2 spell source badge shows the class, not the pool label", () => {
	let spells;
	beforeEach(() => {
		spells = Object.create(CharacterSheetSpells.prototype);
	});

	test("a generic 'Spells Known' label is skipped in favour of the owning class", () => {
		expect(spells._getSpellSourceLabel({sourceFeature: "Spells Known", sourceClass: "Ranger"})).toBe("Ranger");
	});

	test("the 2024 'Prepared Spells' / 'Spells Prepared' labels are skipped too", () => {
		expect(spells._getSpellSourceLabel({sourceFeature: "Prepared Spells", sourceClass: "Druid"})).toBe("Druid");
		expect(spells._getSpellSourceLabel({sourceFeature: "Spells Prepared", sourceClass: "Cleric"})).toBe("Cleric");
	});

	test("a generic label falls through to the subclass when there is no class", () => {
		expect(spells._getSpellSourceLabel({sourceFeature: "Spells Known", sourceSubclass: "Gambler"})).toBe("Gambler");
	});

	test("a SPECIFIC feature label is still preferred (not a generic pool name)", () => {
		expect(spells._getSpellSourceLabel({sourceFeature: "Circle of the Zodiac Spells", sourceClass: "Druid"})).toBe("Circle of the Zodiac Spells");
	});

	test("feat attribution still wins over class (precedence preserved)", () => {
		expect(spells._getSpellSourceLabel({fromFeat: "Magic Initiate", sourceClass: "Wizard"})).toBe("Magic Initiate");
	});
});

describe("Round 9 follow-up — #3 manual Primal Focus resource edits", () => {
	function buildTgttRanger (level = 6) {
		const s = new CharacterSheetState();
		s.addClass({name: "Ranger", source: "TGTT", level});
		s.applyClassFeatureEffects();
		return s;
	}

	test("setFocusSwitchesRemaining round-trips through getFocusSwitchesRemaining", () => {
		const s = buildTgttRanger(6); // level 6 → 2 switches
		expect(s.getFocusSwitchesRemaining()).toBe(2);

		expect(s.setFocusSwitchesRemaining(1)).toBe(true);
		expect(s.getFocusSwitchesRemaining()).toBe(1);

		expect(s.setFocusSwitchesRemaining(0)).toBe(true);
		expect(s.getFocusSwitchesRemaining()).toBe(0);
	});

	test("setFocusSwitchesRemaining clamps above max and below 0", () => {
		const s = buildTgttRanger(6);
		s.setFocusSwitchesRemaining(99);
		expect(s.getFocusSwitchesRemaining()).toBe(2);
		s.setFocusSwitchesRemaining(-5);
		expect(s.getFocusSwitchesRemaining()).toBe(0);
	});

	test("setHuntersDodgeRemaining round-trips and clamps to [0, max]", () => {
		const s = buildTgttRanger(6); // dodge uses = proficiency bonus (3 at L6)
		const max = s.getFeatureCalculations().huntersDodgeUses;
		expect(max).toBeGreaterThan(0);

		expect(s.setHuntersDodgeRemaining(1)).toBe(true);
		expect(s.getHuntersDodgeRemaining()).toBe(1);

		s.setHuntersDodgeRemaining(999);
		expect(s.getHuntersDodgeRemaining()).toBe(max);

		s.setHuntersDodgeRemaining(-3);
		expect(s.getHuntersDodgeRemaining()).toBe(0);
	});

	test("setFocusSwitchesRemaining no-ops on a level-20 Ranger (Unlimited switches)", () => {
		const s = buildTgttRanger(20);
		expect(s.getFeatureCalculations().focusSwitchesMax).toBe("Unlimited");
		expect(s.setFocusSwitchesRemaining(0)).toBe(false);
	});

	test("setHuntersDodgeRemaining no-ops when the feature grants no uses (non-Ranger)", () => {
		const s = new CharacterSheetState();
		s.addClass({name: "Fighter", source: "PHB", level: 5});
		s.applyClassFeatureEffects();
		expect(s.setHuntersDodgeRemaining(2)).toBe(false);
	});
});

describe("Round 9 follow-up — #4 Magician bonus cantrip reaches QuickBuild", () => {
	function makeBareQuickBuild () {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._selections = {featureOptions: {}};
		return qb;
	}

	beforeEach(() => {
		globalThis.JqueryUtil = globalThis.JqueryUtil || {doToast: jest.fn()};
	});

	test("_getMagicianBonusCantrips returns 1 when Magician is a selected option", () => {
		const qb = makeBareQuickBuild();
		qb._selections.featureOptions = {Druid_1: [{name: "Magician"}]};
		expect(qb._getMagicianBonusCantrips()).toBe(1);
	});

	test("_getMagicianBonusCantrips returns 0 when Warden is chosen instead", () => {
		const qb = makeBareQuickBuild();
		qb._selections.featureOptions = {Druid_1: [{name: "Warden"}]};
		expect(qb._getMagicianBonusCantrips()).toBe(0);
	});

	test("_getMagicianBonusCantrips returns 0 with no Primal Order selection", () => {
		const qb = makeBareQuickBuild();
		qb._selections.featureOptions = {};
		expect(qb._getMagicianBonusCantrips()).toBe(0);
	});

	test("finds Magician even when options are spread across multiple level keys", () => {
		const qb = makeBareQuickBuild();
		qb._selections.featureOptions = {
			Druid_1: [{name: "Some Other Option"}],
			Druid_3: [{name: "Magician"}],
		};
		expect(qb._getMagicianBonusCantrips()).toBe(1);
	});
});
