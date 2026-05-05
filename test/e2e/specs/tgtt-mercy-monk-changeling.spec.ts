import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_MERCY_MONK_CHANGELING} from "../utils/characterBuilder";

/**
 * #1 — Mercy Monk Changeling (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Monk martial-arts die scaling (D4→D6 by L5)
 *   - Ki/Discipline pool growth
 *   - Subclass: "Hand of Healing" / "Hand of Harm" toggles arrive at L3
 *   - Capstone Perfect Self at L20
 */
describeCharacter({
	preset: PRESET_FULL_MERCY_MONK_CHANGELING,
	displayName: "Mercy Monk Changeling",
	signatureToggle: /flurry|hand of (heal|harm)|patient defense/i,
	usage: {
		atLevel: 5,
		// Monks render Unarmed Strike via a dedicated panel, not the
		// auto-attack list, and TGTT Mercy Monks don't auto-equip a
		// weapon. Probe the resource pipeline (Focus Points) instead;
		// the attack lives in the spec separately if/when we add a
		// dedicated Monk-attack helper.
		useResourceName: "Focus Points",
		skillRoll: {name: "Insight"},
		// Monks regain Focus Points on a short rest.
		shortRestRestores: {resourceName: "Focus Points"},
		// Monks don't have a typical concentration spell; skip cleanly.
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {skip: true}, // blocked by CS-BUG-009 (addCondition hangs render at L5)
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 8,  acRange: [10, 20]},
		3:  {totalLevel: 3,  minMaxHp: 18, expectToggles: [/hand of (healing|harm)/i]},
		5:  {totalLevel: 5,  minMaxHp: 30},
		11: {totalLevel: 11, minMaxHp: 60},
		17: {totalLevel: 17, minMaxHp: 90},
		20: {totalLevel: 20, minMaxHp: 100, expectToggles: [/body and mind|superior defense|perfect self/i]},
	},
});
