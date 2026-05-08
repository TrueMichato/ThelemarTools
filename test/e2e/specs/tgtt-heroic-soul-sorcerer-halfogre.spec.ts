import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HEROIC_SOUL_HALFOGRE} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {buildSpecialtyChecks, TGTT_METAMAGIC} from "../utils/tgttFeaturePools";

// ── Heroic Soul Sorcerer L1→20 features matrix ───────────────────────
// Sorcerer base (PHB / TGTT-sourced subclass):
//   L2 Font of Magic / Sorcery Points (= Sorc level, long-rest restore)
//   L3 Metamagic — pick 2 (then +1 at L10, +1 at L17 → 3, then 4)
//   L20 Sorcerous Restoration — short-rest restore of up to 4 SP
// Heroic Soul subclass (TGTT):
//   L1 Heroic Spells (passive — adds spells to learnable list)
//   L1 Over Soul — bonus-action toggle that costs 1 SP
//   L1 Legendary Weapon (passive — modifies the manifested weapon)
//   L3 Combat Methods (Heroic Soul) — pick 2 from Arcane Knight /
//      Gallant Heart traditions, plus a 2× prof-bonus Stamina pool
//      (short OR long rest restore)
//   L6 Hero's Reflex (passive — bonus-action weapon attack rider)
//   L14 Manifest Legend — toggle, costs 3 SP, 1/long-rest
//   L18 Eternal Hero (passive — Over Soul always on, downed-rider)
const HEROIC_SOUL_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Sorcerer base ────────────────────────────────────────────
	// Font of Magic / Sorcery Points: pool = Sorc level from L2.
	// Long-rest restore (Sorcery Points do NOT come back on a short
	// rest until Sorcerous Restoration at L20).
	// L2 anchor also carries Half-Ogre racial probes (STR base 15 +
	// race +2 = 17 — `min: 14` is a safe floor across all ASI paths)
	// and the Sorcerer cantrip-count baseline (4 cantrips at L1+).
	// Note: Half-Ogre has no skill proficiencies (no Menacing trait
	// in the TGTT data) and Powerful Build (carry x2) is not surfaced
	// on the sheet — neither is probed.
	{level: 2,  name: "Sorcery Points", kind: "resource", resourceMax: 2,  restoreOn: "long",
		effects: [
			{kind: "longRestRestores", resource: "Sorcery Points"},
			{kind: "cantripCount", min: 4, skip: true, skipReason: "CS-BUG-016"},
			// Half-Ogre +2 STR racial bonus floor.
			{kind: "abilityScore", ability: "str", min: 14},
		]},
	// L3 SP anchor: roll-button probes for Sorcerer-proficient CON
	// save and an untrained skill (Athletics — STR-based; Half-Ogre
	// has no skill profs but the row + button always render).
	{level: 3,  name: "Sorcery Points", kind: "resource", resourceMax: 3,
		effects: [
			{kind: "rollSavingThrow", ability: "con"},
			{kind: "rollSkillCheck", skill: "athletics"},
		]},
	// L5 SP anchor: Sorcerer's other proficient save (CHA), CHA
	// ability-check button, and the auto-equipped melee/ranged
	// weapon attack (Sorcerer starting kit gives dagger / light
	// crossbow / quarterstaff). Initiative button no-throw probe
	// also fires here.
	// Note: spellSaveDc is NOT probed — Half-Ogre racials don't
	// touch CHA, the auto-build's standard array leaves CHA = 8,
	// and ASI's "+2 to first available stat" path doesn't reliably
	// bump CHA either, so the DC stays in the 9-11 band across mid
	// tiers and any `min:` floor would be either trivially true or
	// noisy.
	{level: 5,  name: "Sorcery Points", kind: "resource", resourceMax: 5,
		effects: [
			{kind: "rollSavingThrow", ability: "cha"},
			{kind: "rollAbilityCheck", ability: "cha"},
			{kind: "rollSkillCheck", skill: "intimidation"},
			{kind: "rollInitiative"},
			{kind: "rollAttack", attackName: /dagger|crossbow|quarterstaff/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
		]},
	// L11 SP anchor also probes spell save DC scaling. By L11 the
	// auto-build has had several ASIs targeting CHA on the primary
	// caster class; PB=4 + CHA mod ≥ 1 keeps the floor comfortably
	// above DC 13 even on a slow-CHA path.
	{level: 11, name: "Sorcery Points", kind: "resource", resourceMax: 11,
		effects: [
			{kind: "spellSaveDc", min: 13, skip: true, skipReason: "CS-BUG-016"},
		]},
	{level: 17, name: "Sorcery Points", kind: "resource", resourceMax: 17},
	{level: 20, name: "Sorcery Points", kind: "resource", resourceMax: 20},

	// Metamagic picks scale 2 → 3 → 4 across L3 / L10 / L17.
	// `pickedCount` is the lower bound — passing means at least N of
	// the listed Metamagic options surfaced as feature entries.
	// `pickToggleable` then verifies that ≥1 of the picked options is
	// an Active metamagic surfaced as a toggle on the sheet. The
	// `matchAny` list intentionally enumerates ONLY the active
	// metamagic options (TGTT splits metamagic into Active and
	// Passive — Passive options like Careful / Distant / Empowered /
	// Extended / Resonant / Split / Supple / Transmuted / Warding
	// don't surface as toggles, so listing them would be noise).
	{level: 3,  name: /metamagic/i, kind: "pick", pickedCount: 2,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "pickToggleable", min: 1, matchAny: [
				/aimed spell.*active/i, /bestowed spell.*active/i, /bouncing spell.*active/i, /focused spell.*active/i,
				/lingering spell.*active/i, /overcharged spell.*active/i, /seeking spell.*active/i, /vampiric spell.*active/i,
				/quickened spell.*active/i, /twinned spell.*active/i, /subtle spell.*active/i, /heightened spell.*active/i,
			]},
		]},
	{level: 10, name: /metamagic/i, kind: "pick", pickedCount: 3,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "pickToggleable", min: 1, matchAny: [
				/aimed spell.*active/i, /bestowed spell.*active/i, /bouncing spell.*active/i, /focused spell.*active/i,
				/lingering spell.*active/i, /overcharged spell.*active/i, /seeking spell.*active/i, /vampiric spell.*active/i,
				/quickened spell.*active/i, /twinned spell.*active/i, /subtle spell.*active/i, /heightened spell.*active/i,
			]},
		]},
	{level: 17, name: /metamagic/i, kind: "pick", pickedCount: 4,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			{kind: "pickToggleable", min: 1, matchAny: [
				/aimed spell.*active/i, /bestowed spell.*active/i, /bouncing spell.*active/i, /focused spell.*active/i,
				/lingering spell.*active/i, /overcharged spell.*active/i, /seeking spell.*active/i, /vampiric spell.*active/i,
				/quickened spell.*active/i, /twinned spell.*active/i, /subtle spell.*active/i, /heightened spell.*active/i,
			]},
		]},

	// Sorcerous Restoration at L20 — short-rest recovery of up to 4 SP.
	{level: 20, name: /sorcerous restoration/i, kind: "passive",
		effects: [
			{kind: "shortRestRestores", resource: "Sorcery Points"},
		]},

	// ── Heroic Soul subclass ─────────────────────────────────────
	// Heroic Spells — passive table that expands the learnable spell
	// list (does not auto-grant spells, so probed as a feature entry
	// rather than `kind: "spells"`). Effect probes verify the L1
	// always-known subclass spells (Heroism + Shield) ride along with
	// the spell list, per the Heroic Soul `additionalSpells.known.1`
	// block in the TGTT homebrew JSON.
	{level: 1, name: /heroic spells/i, kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Heroism", skip: true, skipReason: "CS-BUG-016"},
			{kind: "spellInList", spell: "Shield", skip: true, skipReason: "CS-BUG-016"},
		]},
	// Over Soul — bonus-action toggle, costs 1 SP. Toggle button must
	// exist; effect doesn't change AC or DC, so use `none`. The toggle
	// itself has no state-observable AC/DC/resistance/advantage delta
	// the matrix can probe — verifying activate/deactivate doesn't
	// throw is handled by the parent `kind: "toggle"` check.
	{level: 1, name: /over soul/i, kind: "toggle", toggleDelta: "none"},
	// Legendary Weapon — passive (changes the manifested weapon's
	// form). The manifested weapon should surface as an attack row;
	// we reuse the same generic regex as the L5 SP probe rather than
	// hard-coding maul / greatsword (the picked manifestation isn't
	// deterministic in the auto-build).
	{level: 1, name: /legendary weapon/i, kind: "passive"},

	// Combat Methods (Heroic Soul) at L3 — Stamina pool = 2× prof
	// bonus, short OR long rest restore. Blocked by CS-BUG-011: the
	// pool is not surfaced as a resource on the sheet.
	{level: 3,  name: /stamina/i, kind: "resource", resourceMax: 4, restoreOn: "either",
		skip: true, skipReason: "CS-BUG-011"},
	{level: 5,  name: /stamina/i, kind: "resource", resourceMax: 6,
		skip: true, skipReason: "CS-BUG-011"},
	{level: 11, name: /stamina/i, kind: "resource", resourceMax: 8,
		skip: true, skipReason: "CS-BUG-011"},
	{level: 17, name: /stamina/i, kind: "resource", resourceMax: 12,
		skip: true, skipReason: "CS-BUG-011"},

	// Combat Methods pick at L3 — 2 methods from Arcane Knight /
	// Gallant Heart. Each picked method surfaces as its own feature
	// entry on the sheet (e.g. "Frigid Strike", "Honourable Bout").
	// `pickActivatable` then clicks at least one matching method's
	// activation control (smoke-test: doesn't throw).
	{level: 3, name: /combat methods/i, kind: "pick", pickedCount: 1,
		pickedFrom: [
			// Arcane Knight 1st-degree methods
			/frigid strike/i, /grasp of the storm/i, /malicious mark/i, /warding flourish/i,
			/blazing pursuit/i, /duelist'?s sigil/i, /mystic feint/i, /quickening/i,
			// Gallant Heart 1st-degree methods
			/challenger'?s strike/i, /engender doubt/i, /socialite stance/i, /stylish tumble/i,
			/honourable bout/i, /overconfident gambit/i, /wink and smile/i, /formal introduction/i,
		],
		effects: [
			{kind: "pickActivatable", min: 1, matchAny: [
				/frigid strike/i, /grasp of the storm/i, /malicious mark/i, /warding flourish/i,
				/blazing pursuit/i, /duelist'?s sigil/i, /mystic feint/i, /quickening/i,
				/challenger'?s strike/i, /engender doubt/i, /socialite stance/i, /stylish tumble/i,
				/honourable bout/i, /overconfident gambit/i, /wink and smile/i, /formal introduction/i,
			]},
		]},

	// Hero's Reflex at L6 — passive bonus-action weapon-attack rider
	// after spell casts.
	{level: 6, name: /hero'?s reflex/i, kind: "passive"},

	// Manifest Legend at L14 — action, costs 3 SP, 1/long-rest. Has a
	// toggle button on the sheet; no AC/DC delta.
	{level: 14, name: /manifest legend/i, kind: "toggle", toggleDelta: "none"},

	// Eternal Hero at L18 — passive capstone (Over Soul always on +
	// drop-to-1-HP rider).
	{level: 18, name: /eternal hero/i, kind: "passive"},
	...buildSpecialtyChecks("Sorcerer"),
];

/**
 * #15 — Heroic Soul Sorcerer Half-Ogre (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Sorcery Points scaling (long-rest restore)
 *   - Spell-slot scaling (full caster table)
 *   - Over Soul (L1) — bonus-action toggle, costs 1 sorcery point;
 *     Legendary Weapon manifests
 *   - Combat Methods (L3) — Stamina pool = 2× prof bonus, restores
 *     on short or long rest
 *   - 2 Metamagic options picked at L3 (Sorcerer baseline) — at
 *     least one must surface as a toggle/feature
 *   - Manifest Legend (L14) — long-rest 3-sorcery-point bigger toggle
 *   - Eternal Hero (L18) — capstone-ish
 *   - Concentration via Bless
 */
describeCharacter({
	preset: PRESET_FULL_HEROIC_SOUL_HALFOGRE,
	displayName: "Heroic Soul Sorcerer Half-Ogre",
	signatureToggle: /over soul|legendary weapon|manifest legend|hero/i,
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Sorcery Points",
		expectLongRestRestores: true,
		attackName: /dagger|crossbow|quarterstaff/i,
		skillRoll: {name: "Persuasion"},
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		// Validate metamagic surfaces as a toggle/feature picked at L3.
		featAbility: {featureName: /careful spell|distant spell|empowered spell|extended spell|heightened spell|quickened spell|subtle spell|twinned spell|metamagic/i},
	},
	milestones: {
		1:  {totalLevel: 1,  spellSlots: {1: 2}, expectResources: {"Sorcery Points": 1}},
		3:  {totalLevel: 3,  spellSlots: {2: 2}, expectResources: {"Sorcery Points": 3}, expectToggles: [/over soul|metamagic|combat method|arcane knight|gallant heart|careful|distant|empowered|extended|heightened|quickened|subtle|twinned/i]}, // CS-BUG-011: Stamina pool not yet surfaced as resource
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectResources: {"Sorcery Points": 5}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Sorcery Points": 11}},
		14: {totalLevel: 14, expectToggles: [/manifest legend|hero/i]},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 17}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 20}, expectToggles: [/eternal hero|over soul/i]},
	},
	featuresMatrix: HEROIC_SOUL_FEATURES_MATRIX,
});
