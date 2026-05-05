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
	},
	milestones: {
		1:  {totalLevel: 1,  expectToggles: [/rage/i], expectResources: {"Rage": 2}},
		3:  {totalLevel: 3,  expectResources: {"Rage": 3}},
		5:  {totalLevel: 5,  expectResources: {"Rage": 3}},
		11: {totalLevel: 11, expectResources: {"Rage": 4}},
		17: {totalLevel: 17, expectResources: {"Rage": 6}},
		20: {totalLevel: 20, expectToggles: [/primal champion|persistent rage|indomitable/i]},
	},
});
