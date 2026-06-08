/**
 * Ranger passive / situational feature reminders (round 4, BUG 9).
 *
 * Covers the pure catalog helper `CharacterSheetClassUtils.getRangerPassiveReminders(calcs)`
 * that turns the flat `getFeatureCalculations()` output into an at-a-glance list of
 * always-on / situational Ranger features (Enduring Traveler, Tireless, Unrivaled
 * Pioneer, Penetrating Senses, …) that previously had no reminder on a play surface.
 *
 * The function is pure (flag-in → entry-list-out, no DOM), so we assert:
 *  - empty when no flags are set (low-level / non-Ranger);
 *  - each gating flag surfaces exactly its entry;
 *  - Enduring Traveler (the called-out feature) is present at L4;
 *  - Tireless source/level disambiguates TGTT (paired w/ Enduring Traveler) vs XPHB;
 *  - dynamic range/uses substitution falls back cleanly;
 *  - every returned entry carries name/note/source for attribution.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

describe("getRangerPassiveReminders", () => {
	test("returns an empty array when no passive flags are set", () => {
		expect(CharacterSheetClassUtils.getRangerPassiveReminders({})).toEqual([]);
		expect(CharacterSheetClassUtils.getRangerPassiveReminders()).toEqual([]);
		expect(CharacterSheetClassUtils.getRangerPassiveReminders(null)).toEqual([]);
	});

	test("ignores non-Ranger calc flags (no false positives)", () => {
		const calcs = {hasRage: true, hasSneakAttack: true, sneakAttackDice: 3};
		expect(CharacterSheetClassUtils.getRangerPassiveReminders(calcs)).toEqual([]);
	});

	test("surfaces Enduring Traveler as a reminder when its flag is active (BUG 9 focus)", () => {
		const out = CharacterSheetClassUtils.getRangerPassiveReminders({hasEnduringTraveler: true});
		expect(out).toHaveLength(1);
		const entry = out[0];
		expect(entry.name).toBe("Enduring Traveler");
		expect(entry.source).toBe("TGTT");
		expect(entry.level).toBe(4);
		expect(entry.note).toMatch(/extreme cold/i);
		expect(entry.note).toMatch(/exhaustion/i);
	});

	test("surfaces Deft Explorer", () => {
		const out = CharacterSheetClassUtils.getRangerPassiveReminders({hasDeftExplorer: true});
		expect(out.map(e => e.name)).toEqual(["Deft Explorer"]);
		expect(out[0].source).toBe("TGTT");
	});

	test("Tireless paired with Enduring Traveler is attributed to TGTT at L5", () => {
		const out = CharacterSheetClassUtils.getRangerPassiveReminders({hasEnduringTraveler: true, hasTireless: true});
		const tireless = out.find(e => e.name === "Tireless");
		expect(tireless).toBeTruthy();
		expect(tireless.source).toBe("TGTT");
		expect(tireless.level).toBe(5);
		// passive exhaustion-reduction reminder, not the temp-HP grant (tracked in Resources)
		expect(tireless.note).toMatch(/exhaustion level decreases/i);
		expect(tireless.note).toMatch(/Resources/i);
	});

	test("Tireless without Enduring Traveler is attributed to XPHB at L10", () => {
		const out = CharacterSheetClassUtils.getRangerPassiveReminders({hasTireless: true});
		const tireless = out.find(e => e.name === "Tireless");
		expect(tireless).toBeTruthy();
		expect(tireless.source).toBe("XPHB");
		expect(tireless.level).toBe(10);
	});

	test("Penetrating Senses substitutes a dynamic range and falls back to 60", () => {
		const withRange = CharacterSheetClassUtils.getRangerPassiveReminders({hasPenetratingSenses: true, penetratingSensesRange: 90});
		expect(withRange[0].note).toMatch(/90 feet/);

		const noRange = CharacterSheetClassUtils.getRangerPassiveReminders({hasPenetratingSenses: true});
		expect(noRange[0].note).toMatch(/60 feet/);
	});

	test("classic / XPHB-only passives surface with the right source", () => {
		const cases = [
			["hasRelentlessHunter", "Relentless Hunter", "XPHB"],
			["hasNaturesVeil", "Nature's Veil", "XPHB"],
			["hasPreciseHunter", "Precise Hunter", "XPHB"],
			["hasHideInPlainSight", "Hide in Plain Sight", "PHB"],
			["hasVanish", "Vanish", "PHB"],
			["hasFeralSenses", "Feral Senses", "PHB"],
			["hasFoeSlayer", "Foe Slayer", "PHB"],
		];
		cases.forEach(([flag, name, source]) => {
			const out = CharacterSheetClassUtils.getRangerPassiveReminders({[flag]: true});
			expect(out.map(e => e.name)).toContain(name);
			expect(out.find(e => e.name === name).source).toBe(source);
		});
	});

	test("multiple active flags surface together (Lunaria: Ranger 6 Hunter)", () => {
		// Lunaria has Deft Explorer + Enduring Traveler + Tireless active.
		const calcs = {hasDeftExplorer: true, hasEnduringTraveler: true, hasTireless: true};
		const out = CharacterSheetClassUtils.getRangerPassiveReminders(calcs);
		expect(out.map(e => e.name).sort()).toEqual(["Deft Explorer", "Enduring Traveler", "Tireless"]);
	});

	test("every returned entry has name, note, and source for attribution", () => {
		const allFlags = {
			hasDeftExplorer: true,
			hasEnduringTraveler: true,
			hasTireless: true,
			hasEphemeralInsight: true,
			hasUnrivaledPioneer: true,
			hasInfallibleBearing: true,
			hasPenetratingSenses: true,
			hasApexSentinel: true,
			hasBattleInstincts: true,
			hasApexFocus: true,
			hasHideInPlainSight: true,
			hasRelentlessHunter: true,
			hasVanish: true,
			hasNaturesVeil: true,
			hasPreciseHunter: true,
			hasFeralSenses: true,
			hasFoeSlayer: true,
		};
		const out = CharacterSheetClassUtils.getRangerPassiveReminders(allFlags);
		expect(out.length).toBeGreaterThanOrEqual(Object.keys(allFlags).length);
		out.forEach(entry => {
			expect(typeof entry.name).toBe("string");
			expect(entry.name.length).toBeGreaterThan(0);
			expect(typeof entry.note).toBe("string");
			expect(entry.note.length).toBeGreaterThan(0);
			expect(typeof entry.source).toBe("string");
			expect(entry.source.length).toBeGreaterThan(0);
		});
	});
});
