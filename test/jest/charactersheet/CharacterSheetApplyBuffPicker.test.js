/**
 * Apply-Buff picker helpers — categorisation, chips, duration formatting,
 * and active-state detection.
 *
 * These tests exercise the pure module so the picker's UX contract is locked
 * in without rendering the DOM. They cover the bug fix for "buffs window need
 * some UI and UX improvements, and also to be discoverable in the combat tab"
 * (bugs.md): grouped categorisation, per-row effect chips with overflow
 * folding, standardised concentration/duration text, and the ✓ Active
 * detection used to swap Apply for Unapply.
 */

import "./setup.js";
import {
	BUFF_CATEGORY_ORDER,
	BUFF_CATEGORY_META,
	categoriseBuffEntry,
	buildBuffEffectChip,
	getBuffEffectChips,
	formatBuffDuration,
	isBuffSpellActive,
} from "../../../js/charactersheet/charactersheet-buffpicker-helpers.js";

describe("CharacterSheetApplyBuffPicker — categorisation", () => {
	it("places +AC bonuses (Shield of Faith) in defense", () => {
		expect(categoriseBuffEntry({selfEffects: [{type: "bonus", target: "ac", value: 2}]})).toBe("defense");
	});

	it("places attack-roll bonuses (Bless) in offense", () => {
		expect(categoriseBuffEntry({selfEffects: [
			{type: "rollBonus", target: "attack", dice: "1d4"},
			{type: "rollBonus", target: "savingThrow", dice: "1d4"},
		]})).toBe("offense");
	});

	it("places hpMaxIncrease (Aid) in healing — wins over the defense fallback", () => {
		expect(categoriseBuffEntry({selfEffects: [{type: "hpMaxIncrease", value: 5}]})).toBe("healing");
	});

	it("places speedMultiplier (Longstrider/Haste) in movement", () => {
		expect(categoriseBuffEntry({selfEffects: [{type: "speedMultiplier", value: 2}]})).toBe("movement");
	});

	it("falls back to utility for sense / note-only buffs (Darkvision, See Invisibility)", () => {
		expect(categoriseBuffEntry({selfEffects: [{type: "sense", target: "darkvision", value: 60}]})).toBe("utility");
		expect(categoriseBuffEntry({selfEffects: [{type: "note", value: "Detects illusions"}]})).toBe("utility");
		expect(categoriseBuffEntry({selfEffects: []})).toBe("utility");
	});

	it("first-match-wins for tie-break (Haste: defense+offense+movement → defense)", () => {
		// Haste-style mixed entry. Healing is the only bucket that wins over
		// defense; otherwise defense takes precedence (it's checked second).
		const haste = {selfEffects: [
			{type: "bonus", target: "ac", value: 2},
			{type: "advantage", target: "saveDex"},
			{type: "speedMultiplier", value: 2},
		]};
		expect(categoriseBuffEntry(haste)).toBe("defense");
	});

	it("honours an explicit `category` field if ever added to the registry", () => {
		expect(categoriseBuffEntry({category: "movement", selfEffects: [{type: "bonus", target: "ac", value: 2}]})).toBe("movement");
		// Unknown category falls back to derivation
		expect(categoriseBuffEntry({category: "bogus", selfEffects: [{type: "bonus", target: "ac", value: 2}]})).toBe("defense");
	});

	it("exposes BUFF_CATEGORY_ORDER and BUFF_CATEGORY_META covering every category", () => {
		expect(BUFF_CATEGORY_ORDER).toEqual(["defense", "offense", "healing", "movement", "utility"]);
		BUFF_CATEGORY_ORDER.forEach(cat => {
			expect(BUFF_CATEGORY_META[cat]).toBeDefined();
			expect(typeof BUFF_CATEGORY_META[cat].label).toBe("string");
			expect(typeof BUFF_CATEGORY_META[cat].icon).toBe("string");
		});
	});
});

describe("CharacterSheetApplyBuffPicker — effect chips", () => {
	it("maps numeric AC bonus to a defense-toned 🛡️ chip", () => {
		const chip = buildBuffEffectChip({type: "bonus", target: "ac", value: 2});
		expect(chip).toEqual({icon: "🛡️", label: "+2 AC", tone: "defense"});
	});

	it("maps Bless attack/save dice to offense and utility chips respectively", () => {
		expect(buildBuffEffectChip({type: "rollBonus", target: "attack", dice: "1d4"}))
			.toEqual({icon: "⚔️", label: "+1d4 atk", tone: "offense"});
		expect(buildBuffEffectChip({type: "rollBonus", target: "savingThrow", dice: "1d4"}))
			.toMatchObject({tone: "utility"});
	});

	it("maps Aid hpMaxIncrease to a healing-toned ❤️ chip", () => {
		expect(buildBuffEffectChip({type: "hpMaxIncrease", value: 5}))
			.toEqual({icon: "❤️", label: "+5 max HP", tone: "healing"});
	});

	it("maps speedMultiplier to a movement-toned 🏃 chip", () => {
		expect(buildBuffEffectChip({type: "speedMultiplier", value: 2}))
			.toEqual({icon: "🏃", label: "Speed ×2", tone: "movement"});
	});

	it("returns null for an empty note (avoids rendering blank chips)", () => {
		expect(buildBuffEffectChip({type: "note", value: ""})).toBeNull();
	});

	it("returns null when given a falsy or type-less effect", () => {
		expect(buildBuffEffectChip(null)).toBeNull();
		expect(buildBuffEffectChip({})).toBeNull();
	});
});

describe("CharacterSheetApplyBuffPicker — chip overflow folding", () => {
	it("returns chips as-is when there are 3 or fewer", () => {
		const chips = getBuffEffectChips({selfEffects: [
			{type: "bonus", target: "ac", value: 2},
			{type: "advantage", target: "saveStr"},
		]});
		expect(chips).toHaveLength(2);
	});

	it("caps visible chips at 3 and adds a '+N more' overflow chip with a hover title", () => {
		const chips = getBuffEffectChips({selfEffects: [
			{type: "bonus", target: "ac", value: 2},
			{type: "rollBonus", target: "attack", dice: "1d4"},
			{type: "rollBonus", target: "damage", dice: "1d4"},
			{type: "speedMultiplier", value: 2},
			{type: "advantage", target: "saveDex"},
		]});
		expect(chips).toHaveLength(4);
		const overflow = chips[3];
		expect(overflow.label).toBe("2 more");
		expect(overflow.tone).toBe("utility");
		// Hover surface lists the hidden chips, one per line
		expect(overflow.title).toMatch(/Speed ×2/);
		expect(overflow.title).toMatch(/Adv saveDex|Adv save/);
	});

	it("ignores effects that produce no chip when counting", () => {
		const chips = getBuffEffectChips({selfEffects: [
			{type: "bonus", target: "ac", value: 2},
			{type: "note", value: ""}, // nullable
		]});
		expect(chips).toHaveLength(1);
	});
});

describe("CharacterSheetApplyBuffPicker — duration formatting", () => {
	it("returns '—' for missing duration on non-concentration buffs", () => {
		expect(formatBuffDuration(undefined, false)).toBe("—");
		expect(formatBuffDuration(null, false)).toBe("—");
	});

	it("returns 'Concentration' alone when duration is missing but concentration is set", () => {
		expect(formatBuffDuration(undefined, true)).toBe("Concentration");
	});

	it("formats fixed-amount durations (Aid: 8 hours)", () => {
		expect(formatBuffDuration({amount: 8, unit: "hour"}, false)).toBe("8 hours");
		expect(formatBuffDuration({amount: 1, unit: "hour"}, false)).toBe("1 hour");
	});

	it("prefixes 'Conc., up to' when the buff also requires concentration (Bless: 1 minute, conc.)", () => {
		expect(formatBuffDuration({amount: 1, unit: "minute"}, true)).toBe("Conc., up to 1 minute");
		expect(formatBuffDuration({amount: 10, unit: "minute"}, true)).toBe("Conc., up to 10 minutes");
	});

	it("falls back to a stringified non-object duration", () => {
		expect(formatBuffDuration("Instantaneous", false)).toBe("Instantaneous");
		expect(formatBuffDuration("Instantaneous", true)).toBe("Conc., Instantaneous");
	});
});

describe("CharacterSheetApplyBuffPicker — active-state detection", () => {
	const baseStates = [
		{active: true, isSpellEffect: true, name: "Aid"},
		{active: true, isSpellEffect: false, name: "Rage"}, // class state, not a spell
		{active: false, isSpellEffect: true, name: "Bless"}, // dismissed
	];

	it("matches active spell-effect states by name (case-insensitive)", () => {
		expect(isBuffSpellActive("Aid", baseStates)).toBe(true);
		expect(isBuffSpellActive("aid", baseStates)).toBe(true);
		expect(isBuffSpellActive("AID", baseStates)).toBe(true);
	});

	it("ignores non-spell-effect states with matching names (no false positives for class states)", () => {
		expect(isBuffSpellActive("Rage", baseStates)).toBe(false);
	});

	it("ignores deactivated spell-effect states", () => {
		expect(isBuffSpellActive("Bless", baseStates)).toBe(false);
	});

	it("returns false for unknown names, missing input, or empty arrays", () => {
		expect(isBuffSpellActive("Heroes' Feast", baseStates)).toBe(false);
		expect(isBuffSpellActive("", baseStates)).toBe(false);
		expect(isBuffSpellActive(null, baseStates)).toBe(false);
		expect(isBuffSpellActive("Aid", null)).toBe(false);
		expect(isBuffSpellActive("Aid", [])).toBe(false);
	});
});
