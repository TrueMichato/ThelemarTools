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
 *  - applied-elsewhere features (Deft Explorer, Tireless) are EXCLUDED — their whole
 *    mechanical benefit is already shown on other panels (Skills/Languages/Spells,
 *    Resources, the Rest dialog), so a reminder would be redundant noise;
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

	test("Enduring Traveler splits its three mechanics into distinct notes bullets (BUG #11)", () => {
		// The three benefits used to cram into one paragraph; they now ship as a
		// structured `notes` array so the renderer can bullet them, while `note` stays
		// a non-empty joined string for at-a-glance/title text + backward compatibility.
		const entry = CharacterSheetClassUtils.getRangerPassiveReminders({hasEnduringTraveler: true})[0];
		expect(Array.isArray(entry.notes)).toBe(true);
		expect(entry.notes).toHaveLength(3);
		// Each bullet covers exactly one distinct mechanic.
		expect(entry.notes[0]).toMatch(/extreme cold/i);
		expect(entry.notes[0]).toMatch(/extreme heat/i);
		expect(entry.notes[1]).toMatch(/exhaustion/i);
		expect(entry.notes[2]).toMatch(/camp|journey/i);
		// No single bullet crams everything together.
		entry.notes.forEach(n => {
			expect(typeof n).toBe("string");
			expect(n.length).toBeGreaterThan(0);
		});
		// `note` remains a non-empty string covering the same ground (backward compat).
		expect(typeof entry.note).toBe("string");
		expect(entry.note).toMatch(/extreme cold/i);
		expect(entry.note).toMatch(/exhaustion/i);
	});

	test("excludes Deft Explorer — its whole benefit is applied/shown elsewhere", () => {
		// Expertise, languages, and the extra prepared spell are baked into state and
		// shown on the Skills / Languages / Spells panels, so it is not a reminder.
		const out = CharacterSheetClassUtils.getRangerPassiveReminders({hasDeftExplorer: true});
		expect(out.map(e => e.name)).not.toContain("Deft Explorer");
		expect(out).toEqual([]);
	});

	test("excludes Tireless regardless of source — exhaustion reduction is applied from the Rest dialog", () => {
		// Paired with Enduring Traveler (TGTT) the Enduring Traveler reminder still
		// surfaces, but Tireless itself never does.
		const tgtt = CharacterSheetClassUtils.getRangerPassiveReminders({hasEnduringTraveler: true, hasTireless: true});
		expect(tgtt.map(e => e.name)).not.toContain("Tireless");
		expect(tgtt.map(e => e.name)).toEqual(["Enduring Traveler"]);

		// XPHB-only Tireless (no Enduring Traveler) yields no reminders at all.
		const xphb = CharacterSheetClassUtils.getRangerPassiveReminders({hasTireless: true});
		expect(xphb).toEqual([]);
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

	test("multiple active flags surface together, but applied-elsewhere ones are excluded (Lunaria: Ranger 6 Hunter)", () => {
		// Lunaria has Deft Explorer + Enduring Traveler + Tireless active, but only the
		// situational Enduring Traveler should surface as a reminder.
		const calcs = {hasDeftExplorer: true, hasEnduringTraveler: true, hasTireless: true};
		const out = CharacterSheetClassUtils.getRangerPassiveReminders(calcs);
		expect(out.map(e => e.name).sort()).toEqual(["Enduring Traveler"]);
	});

	test("situational features still surface alongside excluded applied-elsewhere ones", () => {
		const calcs = {
			hasDeftExplorer: true, // excluded
			hasTireless: true, // excluded
			hasEnduringTraveler: true, // situational
			hasPenetratingSenses: true, // situational
			hasBattleInstincts: true, // situational
		};
		const names = CharacterSheetClassUtils.getRangerPassiveReminders(calcs).map(e => e.name);
		expect(names).toContain("Enduring Traveler");
		expect(names).toContain("Penetrating Senses");
		expect(names).toContain("Battle Instincts");
		expect(names).not.toContain("Deft Explorer");
		expect(names).not.toContain("Tireless");
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
		// Deft Explorer + Tireless are applied-elsewhere and excluded.
		const APPLIED_ELSEWHERE = 2;
		const out = CharacterSheetClassUtils.getRangerPassiveReminders(allFlags);
		expect(out.length).toBe(Object.keys(allFlags).length - APPLIED_ELSEWHERE);
		expect(out.map(e => e.name)).not.toContain("Deft Explorer");
		expect(out.map(e => e.name)).not.toContain("Tireless");
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
