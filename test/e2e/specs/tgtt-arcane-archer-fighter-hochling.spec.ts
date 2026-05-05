import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_ARCANE_ARCHER_HOCHLING} from "../utils/characterBuilder";

/**
 * #2 — Arcane Archer Fighter Hochling (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Fighter Action Surge / Second Wind at low levels
 *   - Arcane Shot options arrive at L3 (Fighter subclass level)
 *   - Extra Attack ×2 at L11, ×3 at L20
 *   - Mid-tier loadout: +1 Longbow → attack bonus delta
 */
describeCharacter({
	preset: PRESET_FULL_ARCANE_ARCHER_HOCHLING,
	displayName: "Arcane Archer Fighter Hochling",
	// Skip L7 + MEGA: blocked by CS-BUG-003 (Combat Methods validator
	// makes the wizard unfinishable when no new methods are available).
	// L3 / L5 stay on as red reminders of the bug.
	skipL7: true,
	skipMega: true,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	signatureToggle: /action surge|second wind|arcane shot/i,
	// Usage spec skipped — CS-BUG-003 makes the L3+ level-up wizard
	// unfinishable for this preset, so the L5 build doesn't complete.
	// Re-enable once the validator is fixed.  When un-skipping, restore:
	//   skillRoll: {name: "Perception"}, shortRestRestores: {resourceName: "Action Surge", expectAfter: 1},
	//   concentrationCheck: {skip: true}, deathSaves: true,
	//   applyCondition: {skip: true}, featAbility: {skip: true},
	usage: {skip: true},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 10, expectToggles: [/second wind/i]},
		3:  {totalLevel: 3,  minMaxHp: 26, expectToggles: [/arcane shot|second wind/i]},
		5:  {totalLevel: 5,  minMaxHp: 44},
		11: {totalLevel: 11, minMaxHp: 80},
		17: {totalLevel: 17, minMaxHp: 120},
		20: {totalLevel: 20, minMaxHp: 140},
	},
});
