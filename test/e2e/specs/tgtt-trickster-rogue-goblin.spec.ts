import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_TRICKSTER_GOBLIN} from "../utils/characterBuilder";

/**
 * #16 — Trickster Rogue Goblin (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Sneak Attack scales like every Rogue
 *   - Trickster Dice (L3) — pool of 4 d8 dice, restores on short
 *     OR long rest; pool grows at L9/L13/L17
 *   - 3 *Tricks* (TT optional features) picked at L3, scaling to 7
 *     by L19 — at least one of the picked Tricks must surface as a
 *     feature on the sheet
 *   - No spellcasting / no concentration
 */
describeCharacter({
	preset: PRESET_FULL_TRICKSTER_GOBLIN,
	displayName: "Trickster Rogue Goblin",
	signatureToggle: /disarming strike|trip attack|swing away|deafening strike|blinding strike|noise maker|rebounding throw|weaponized debris|rapid deployment|trick/i,
	usage: {
		atLevel: 5,
		// CS-BUG-012: Trickster Dice resource not surfaced; useResourceName + shortRest skipped
		expectLongRestRestores: false,
		attackName: /dagger|shortsword|shortbow|hand crossbow/i,
		skillRoll: {name: "Sleight of Hand"},
		shortRestRestores: {skip: true}, // CS-BUG-012
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 8,  acRange: [10, 20]},
		3:  {totalLevel: 3,  minMaxHp: 18, expectToggles: [/disarming|trip attack|swing|deafening|blinding|noise|rebounding|weaponized|rapid|trick/i]}, // CS-BUG-012: drop expectResources
		5:  {totalLevel: 5,  minMaxHp: 30},
		9:  {totalLevel: 9,  expectToggles: [/sticky hands/i]},
		11: {totalLevel: 11, minMaxHp: 60},
		13: {totalLevel: 13, expectToggles: [/the switch|switch/i]},
		17: {totalLevel: 17, minMaxHp: 90}, // L17 "Master of Mischief" not always exposed as activatable feature
		20: {totalLevel: 20, minMaxHp: 100},
	},
	featuresMatrix: [
		// ── Rogue base ────────────────────────────────────────────────
		{level: 1, name: /sneak attack/i, kind: "passive"},
		{level: 2, name: /cunning action/i, kind: "passive"},
		{level: 5, name: /uncanny dodge/i, kind: "passive"},
		{level: 7, name: /evasion/i, kind: "passive"},
		{level: 11, name: /reliable talent/i, kind: "passive"},
		{level: 20, name: /stroke of luck/i, kind: "passive"},

		// ── Trickster subclass ───────────────────────────────────────
		// Trickster Dice pool — 4 @ L3, +1 at L9/L13/L17 (max 7).
		// Blocked by CS-BUG-012 (resource not surfaced on the sheet).
		{level: 3, name: /trickster dice/i, kind: "resource", resourceMax: 4, restoreOn: "either", skip: true, skipReason: "CS-BUG-012"},
		{level: 9, name: /trickster dice/i, kind: "resource", resourceMax: 5, restoreOn: "either", skip: true, skipReason: "CS-BUG-012"},
		{level: 13, name: /trickster dice/i, kind: "resource", resourceMax: 6, restoreOn: "either", skip: true, skipReason: "CS-BUG-012"},
		{level: 17, name: /trickster dice/i, kind: "resource", resourceMax: 7, restoreOn: "either", skip: true, skipReason: "CS-BUG-012"},

		// Tricks (TT optional features) — 3 picked at L3, +1 at L7/L10/L15/L19.
		// Candidate names sourced from `featureType: ["TT"]` in
		// homebrew/TravelersGuidetoThelemar.json.
		{
			level: 3,
			name: /tricks?/i,
			kind: "pick",
			pickedCount: 3,
			pickedFrom: [
				/disarming strike/i,
				/trip attack/i,
				/swing away/i,
				/deafening strike/i,
				/blinding strike/i,
				/noise maker/i,
				/rebounding throw/i,
				/weaponized debris/i,
				/rapid deployment/i,
				/explosive flask/i,
				/instant barrier/i,
			],
		},
		{
			level: 7,
			name: /tricks?/i,
			kind: "pick",
			pickedCount: 4,
			pickedFrom: [
				/disarming strike/i, /trip attack/i, /swing away/i,
				/deafening strike/i, /blinding strike/i, /noise maker/i,
				/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
				/explosive flask/i, /instant barrier/i,
			],
		},
		{
			level: 10,
			name: /tricks?/i,
			kind: "pick",
			pickedCount: 5,
			pickedFrom: [
				/disarming strike/i, /trip attack/i, /swing away/i,
				/deafening strike/i, /blinding strike/i, /noise maker/i,
				/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
				/explosive flask/i, /instant barrier/i,
			],
		},
		{
			level: 15,
			name: /tricks?/i,
			kind: "pick",
			pickedCount: 6,
			pickedFrom: [
				/disarming strike/i, /trip attack/i, /swing away/i,
				/deafening strike/i, /blinding strike/i, /noise maker/i,
				/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
				/explosive flask/i, /instant barrier/i,
			],
		},
		{
			level: 19,
			name: /tricks?/i,
			kind: "pick",
			pickedCount: 7,
			pickedFrom: [
				/disarming strike/i, /trip attack/i, /swing away/i,
				/deafening strike/i, /blinding strike/i, /noise maker/i,
				/rebounding throw/i, /weaponized debris/i, /rapid deployment/i,
				/explosive flask/i, /instant barrier/i,
			],
		},

		// Other Trickster passives / scaling features.
		{level: 9, name: /sticky hands/i, kind: "passive"},
		{level: 13, name: /the switch|switch/i, kind: "passive"},
		{level: 17, name: /master of mischief/i, kind: "passive"},
	],
});
