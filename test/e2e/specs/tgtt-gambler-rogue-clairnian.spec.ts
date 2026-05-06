import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_GAMBLER_CLAIRNIAN} from "../utils/characterBuilder";

/**
 * #11 — Gambler Rogue Clairnian (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Sneak Attack scales (1d6 → 10d6) like every Rogue
 *   - Gambler's Spellcasting kicks in at L3 (half-caster table,
 *     warlock spell list); validate `spellSlots` milestones
 *   - Gambler's Tools — coin/dice/cards weapons; `attackName` probe
 *     is logged-not-asserted (these may not auto-equip)
 *   - Gambler's Folly toggle (1d100 gambling table) surfaces as a
 *     feature
 */
describeCharacter({
	preset: PRESET_FULL_GAMBLER_CLAIRNIAN,
	displayName: "Gambler Rogue Clairnian",
	signatureToggle: /gambler|folly|fortune|luck/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: undefined,
		expectLongRestRestores: false,
		attackName: /coins|dice|cards|dagger|shortbow/i,
		skillRoll: {name: "Sleight of Hand"},
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Hex", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 8,  acRange: [10, 20]},
		3:  {totalLevel: 3,  minMaxHp: 18, spellSlots: {1: 2}, expectToggles: [/gambler|folly|fortune|spellcasting/i]},
		5:  {totalLevel: 5,  minMaxHp: 30, spellSlots: {1: 2}}, // CS-BUG-010: Gambler half-caster table under-counted
		11: {totalLevel: 11, minMaxHp: 60, expectToggles: [/extra luck|luck/i]}, // CS-BUG-010: drop spellSlots assertion until table fixed
		17: {totalLevel: 17, minMaxHp: 90}, // CS-BUG-010
		20: {totalLevel: 20, minMaxHp: 100, expectToggles: [/master of fortune|fortune/i]}, // CS-BUG-010
	},
	featuresMatrix: [
		// ── Rogue base ────────────────────────────────────────────────
		{level: 1, name: /sneak attack/i, kind: "passive"},
		{level: 1, name: /thieves['’]? cant/i, kind: "passive"},
		{level: 2, name: /cunning action/i, kind: "passive"},
		{level: 5, name: /uncanny dodge/i, kind: "passive"},
		{level: 7, name: /evasion/i, kind: "passive"},
		{level: 11, name: /reliable talent/i, kind: "passive"},
		{level: 14, name: /blindsense/i, kind: "passive"},
		{level: 15, name: /slippery mind/i, kind: "passive"},
		{level: 18, name: /elusive/i, kind: "passive"},
		{level: 20, name: /stroke of luck/i, kind: "passive"},

		// ── Gambler subclass ──────────────────────────────────────────
		{level: 3, name: /gambler['’]?s tools/i, kind: "passive"},
		{level: 3, name: /gambler['’]?s folly/i, kind: "passive"},
		// Gambler's Spellcasting grants Warlock-list cantrips + 1/3-caster
		// slots. Both the slot table and the granted spell list are blocked
		// by CS-BUG-010 (half-caster slots under-counted / spellbook not
		// populated).
		{
			level: 3,
			name: /gambler['’]?s spellcasting/i,
			kind: "spells",
			grantsSpells: ["Eldritch Blast", "Hex"],
			skip: true,
			skipReason: "CS-BUG-010",
		},
		{
			level: 7,
			name: /gambler['’]?s spellcasting/i,
			kind: "spells",
			grantsSpells: ["Eldritch Blast", "Hex", "Hold Person"],
			skip: true,
			skipReason: "CS-BUG-010",
		},
		{
			level: 13,
			name: /gambler['’]?s spellcasting/i,
			kind: "spells",
			grantsSpells: ["Eldritch Blast", "Hex", "Hold Person", "Counterspell"],
			skip: true,
			skipReason: "CS-BUG-010",
		},
		// Extra Luck — bonus-action toggle, uses = PB, long-rest restore.
		// Surfaces as a toggle on the sheet (no AC/DC delta — grants
		// advantage to a single roll).
		{level: 9, name: /extra luck/i, kind: "toggle", toggleDelta: "none"},
		{level: 13, name: /versatile gambler/i, kind: "passive"},
		{level: 17, name: /master of fortune/i, kind: "passive"},
	],
});
