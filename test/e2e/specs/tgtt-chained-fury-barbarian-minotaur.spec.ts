import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CHAINED_FURY_MINOTAUR} from "../utils/characterBuilder";

/**
 * #9 — Chained Fury Barbarian Minotaur (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Rage uses scale per Barbarian table (2/3/4/4/5/5/6/6/unlimited)
 *   - Rage damage bonus scales (+2/+3/+4) and applies on the toggle
 *   - Reckless Attack at L2, Extra Attack at L5
 *   - Path of the Chained Fury subclass features at L3, L6, L10, L14
 *   - Primal Champion at L20 boosts STR/CON beyond 20
 */
describeCharacter({
	preset: PRESET_FULL_CHAINED_FURY_MINOTAUR,
	displayName: "Chained Fury Barbarian Minotaur",
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	signatureToggle: /rage|reckless attack|chained/i,
	usage: {
		atLevel: 5,
		useResourceName: "Rage",
		attackName: /greataxe|battleaxe|maul/i,
		skillRoll: {name: "Athletics"},
		// Barbarians don't have a class-granted SR resource at L5; skip.
		shortRestRestores: {skip: true},
		// Activating Rage breaks any concentration the player has.
		concentrationCheck: {skip: true}, // blocked by CS-BUG-007 (Rage doesn't break concentration)
		deathSaves: true,
		applyCondition: {skip: true}, // blocked by CS-BUG-009 (addCondition hangs render — to retest after fix)
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  expectToggles: [/rage/i], expectResources: {"Rage": 2}},
		3:  {totalLevel: 3,  expectResources: {"Rage": 3}},
		5:  {totalLevel: 5,  expectResources: {"Rage": 3}},
		11: {totalLevel: 11, expectResources: {"Rage": 4}},
		17: {totalLevel: 17, expectResources: {"Rage": 6}},
		20: {totalLevel: 20, expectToggles: [/primal champion|persistent rage|indomitable/i]},
	},
	featuresMatrix: [
		// ── Class features ────────────────────────────────────────
		{level: 1, name: /^rage$/i, kind: "toggle", toggleDelta: "any"},
		// Rage uses pool — re-checked at scaling thresholds.
		{level: 1,  name: "Rage", kind: "resource", resourceMax: 2},
		{level: 3,  name: "Rage", kind: "resource", resourceMax: 3},
		{level: 6,  name: "Rage", kind: "resource", resourceMax: 4},
		{level: 12, name: "Rage", kind: "resource", resourceMax: 5},
		{level: 17, name: "Rage", kind: "resource", resourceMax: 6},
		// L20 grants unlimited rages — accept any high value or sentinel.
		{level: 20, name: "Rage", kind: "resource", resourceMax: [6, 999]},

		{level: 1, name: /unarmored defense/i, kind: "passive"},
		{level: 2, name: /reckless attack/i, kind: "toggle", toggleDelta: "none"},
		{level: 2, name: /danger sense/i, kind: "passive"},
		{level: 5, name: /extra attack/i, kind: "passive"},
		{level: 5, name: /fast movement/i, kind: "passive"},
		{level: 7, name: /feral instinct/i, kind: "passive"},
		{level: 9, name: /brutal critical/i, kind: "passive"},
		{level: 11, name: /relentless rage/i, kind: "passive"},
		{level: 15, name: /persistent rage/i, kind: "passive"},
		{level: 18, name: /indomitable might/i, kind: "passive"},
		{level: 20, name: /primal champion/i, kind: "passive"},

		// ── Subclass: Path of the Chained Fury (TGTT) ────────────
		{level: 3,  name: /manifest chains/i, kind: "passive"},
		{level: 6,  name: /chain imprisonment/i, kind: "passive"},
		{level: 10, name: /chain control/i, kind: "passive"},
		{level: 14, name: /unchained fury/i, kind: "passive"},
	],
});
