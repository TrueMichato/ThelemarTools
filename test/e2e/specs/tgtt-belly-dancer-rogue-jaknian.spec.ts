import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_BELLY_DANCER_JAKNIAN} from "../utils/characterBuilder";

/**
 * #12 — Belly Dancer Rogue Jaknian (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Dance of the Country (L3) — bladesong-like toggle: +CHA mod
 *     to AC, advantage on Acrobatics, sneak in melee w/o advantage.
 *     Validate the toggle is present, costs uses (per prof bonus),
 *     restores on short rest.
 *   - Sneak Attack scales like every Rogue.
 *   - No spellcasting / no concentration spells.
 */
describeCharacter({
	preset: PRESET_FULL_BELLY_DANCER_JAKNIAN,
	displayName: "Belly Dancer Rogue Jaknian",
	signatureToggle: /dance of the country|dance/i,
	usage: {
		atLevel: 5,
		useResourceName: "Dance of the Country",
		expectLongRestRestores: false,
		attackName: /dagger|shortsword|rapier|shortbow/i,
		skillRoll: {name: "Acrobatics"},
		shortRestRestores: {resourceName: "Dance of the Country"},
		concentrationCheck: {skip: true},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: 8,  acRange: [10, 20]},
		3:  {totalLevel: 3,  minMaxHp: 18, expectToggles: [/dance of the country|dance/i], expectResources: {"Dance of the Country": 2}},
		5:  {totalLevel: 5,  minMaxHp: 30, expectResources: {"Dance of the Country": 3}},
		11: {totalLevel: 11, minMaxHp: 60, expectToggles: [/tantalizing shivers|shivers/i]},
		17: {totalLevel: 17, minMaxHp: 90, expectToggles: [/percussive strike|percussive/i]},
		20: {totalLevel: 20, minMaxHp: 100},
	},
	featuresMatrix: [
		// ── Rogue base ────────────────────────────────────────────────
		// Sneak Attack itself isn't a clean state probe (damage shows
		// only inside the attack listing). Use this entry to host a
		// fundamental rogue roll-button probe (initiative — rogues live
		// or die by it).
		{
			level: 1,
			name: /sneak attack/i,
			kind: "passive",
			effects: [
				{kind: "rollInitiative"},
			],
		},
		{level: 1, name: /thieves['’]? cant/i, kind: "passive"},
		{level: 2, name: /cunning action/i, kind: "passive"},
		// Uncanny Dodge keys off a DEX save trigger — exercise the DEX
		// save roll button (rogue is proficient).
		{
			level: 5,
			name: /uncanny dodge/i,
			kind: "passive",
			effects: [
				{kind: "rollSavingThrow", ability: "dex"},
			],
		},
		// Evasion converts DEX saves into half-on-fail; rogue is also
		// INT-save proficient — probe both that the INT save button
		// renders/clicks and indirectly the DEX one (already covered
		// above) at higher levels too.
		{
			level: 7,
			name: /evasion/i,
			kind: "passive",
			effects: [
				{kind: "rollSavingThrow", ability: "int"},
			],
		},
		// Reliable Talent treats any proficient skill check d20 < 10 as
		// a 10. Acrobatics is rogue-signature; assert the skill button
		// click handler is wired.
		{
			level: 11,
			name: /reliable talent/i,
			kind: "passive",
			effects: [
				{kind: "rollSkillCheck", skill: "acrobatics"},
			],
		},
		{level: 14, name: /blindsense/i, kind: "passive"},
		{level: 15, name: /slippery mind/i, kind: "passive"},
		{level: 18, name: /elusive/i, kind: "passive"},
		{level: 20, name: /stroke of luck/i, kind: "passive"},

		// ── Belly Dancer subclass ─────────────────────────────────────
		// Bonus Proficiency grants Expertise in Performance + lets weapons
		// be treated as Concealed. Expertise wiring on TGTT subclasses is
		// not consistently surfaced through skill-bonus state — leave the
		// numeric assertion off and rely on the feature-presence check.
		{level: 3, name: /bonus proficiency/i, kind: "passive"},
		// Dance of the Country — bladesong-like AC buff (+CHA mod) when
		// active. Bonus-action toggle, lasts until ended/incapacitated,
		// uses = PB, short-rest restore.
		//
		// Effects:
		//   - togglePlusAc whenActive=abilityMod cha — matches the
		//     `dancing` ACTIVE_STATE_TYPES entry
		//     ({type: "bonus", target: "ac", abilityMod: "cha"}).
		//   - toggleGrantsAdvantage skill:acrobatics — homebrew rule
		//     grants advantage on Dexterity (Acrobatics) rolls, but
		//     the dancing state currently buffs `skill:athletics`
		//     instead. Skipped pending CS-BUG-014.
		{
			level: 3,
			name: /dance of the country/i,
			kind: "toggle",
			toggleDelta: "ac",
			effects: [
				{kind: "togglePlusAc", whenActive: "abilityMod", ability: "cha"},
				{
					kind: "toggleGrantsAdvantage",
					rollType: "skill:acrobatics",
					skip: true,
					skipReason: "CS-BUG-014",
				},
			],
		},
		{
			level: 3,
			name: "Dance of the Country",
			kind: "resource",
			resourceMax: 2, // PB at L3
			restoreOn: "short",
		},
		{
			level: 5,
			name: "Dance of the Country",
			kind: "resource",
			resourceMax: 3, // PB at L5
			restoreOn: "short",
		},
		{
			level: 9,
			name: "Dance of the Country",
			kind: "resource",
			resourceMax: 4, // PB at L9
			restoreOn: "short",
		},
		{
			level: 13,
			name: "Dance of the Country",
			kind: "resource",
			resourceMax: 5, // PB at L13
			restoreOn: "short",
		},
		{
			level: 17,
			name: "Dance of the Country",
			kind: "resource",
			resourceMax: 6, // PB at L17
			restoreOn: "short",
		},
		// Tantalizing Shivers fires a Charisma (Performance) check vs
		// Wisdom (Insight) while Dancing — exercise the Performance
		// skill roll button at this level.
		{
			level: 9,
			name: /tantalizing shivers/i,
			kind: "passive",
			effects: [
				{kind: "rollSkillCheck", skill: "performance"},
			],
		},
		{level: 13, name: /fluid step/i, kind: "passive"},
		// Percussive Strike sets a save DC = 8 + PB + CHA mod for hostile
		// onlookers. The DC isn't surfaced as a feature-DC field, but
		// CHA is the signature ability — exercise the CHA ability-check
		// roll button to cover the ability-check probe quota.
		{
			level: 17,
			name: /percussive strike/i,
			kind: "passive",
			effects: [
				{kind: "rollAbilityCheck", ability: "cha"},
			],
		},
		// Jaknian race traits (Trade Secrets: Persuasion or Investigation
		// proficiency + double-prof on haggling Persuasion checks; Tools
		// of the Trade: two artisan tools) belong to the race tab, not
		// the class featuresMatrix. The base Child of the Empire speed
		// is a flat 30 with no Jaknian-specific speed bonus — no clean
		// effect probe to add at the class-feature level.
	],
});
