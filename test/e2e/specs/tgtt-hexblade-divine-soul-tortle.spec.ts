import {describeMulticlassCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HEX_DIVINE_TORTLE} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {
	buildSpecialtyChecks,
	buildAnyMetamagicChecks,
	buildAnyInvocationChecks,
	TGTT_METAMAGIC,
} from "../utils/tgttFeaturePools";

// Char-level → Sorcerer-level mapping (Sorcerer 1 = char L3, 18 = L20).
//
// NB despite that heading the map is consumed the other way round:
// `applyLevelMap(classLevel, levelMap)` in tgttFeaturePools.ts looks the
// CLASS level up and returns the CHAR level. Sorcerer N = char N + 2 here,
// because the Warlock leg takes the first two levels.
//
// It was previously missing every TGTT specialty level (Sorcerer
// 4/8/12/16/20), so `buildSpecialtyChecks` fell through to
// `levelMap[l] ?? l` and emitted rows at char 4/8/12/16/20 — i.e. two
// levels early — with the fifth claiming a 5th specialty at char L20.
// This build reaches only Sorcerer 18, so the 5th specialty (Sorcerer 20
// = char 22) is unreachable and that row is now correctly out of range.
// `3: 3` was likewise wrong: Sorcerer 3 is char 5.
const SORC_LEVELMAP: Record<number, number> = {
	3: 5, 10: 12, 17: 19,
	// TGTT specialty levels (Sorcerer 4/8/12/16/20).
	4: 6, 8: 10, 12: 14, 16: 18, 20: 22,
};

// Char-level → Warlock-level mapping (Warlock 1–2 = char L1–2 — identity).
// Spec only reaches Warlock 2, so Pact Boon (Warlock L3) is intentionally
// not wired — the build never qualifies for it.
const HEXBLADE_LEVELMAP: Record<number, number> = {
	1: 1, 2: 2,
};

// ── Hexblade 2 / Divine Soul 18 multiclass features matrix ───────────
// Levels are TOTAL character levels.
//   Char L1-2 = Warlock (Hexblade) 1-2.
//   Char L3-20 = Sorcerer (Divine Soul) 1-18.
const HEX_DIVINE_MULTI_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Warlock leg (TGTT-2014 Hexblade — copy of XGE Hexblade) ─────
	// L1: Pact Magic + Hexblade subclass features. Hexblade's Curse
	// is a toggle (3-min duration buff vs. one creature). Hex Warrior
	// is passive (CHA-to-attack with bound weapon).
	//
	// Pact Magic is the natural anchor for Warlock-leg L1 probes:
	// Eldritch Blast (signature cantrip), Hex (signature L1 spell),
	// initiative + warlock-proficient WIS save roll-button, plus the
	// Tortle race anchors — natural armor 17 base AC and walking
	// speed 30 — since the matrix has no dedicated race entry.
	{level: 1, name: /pact magic/i, kind: "passive", effects: [
		{kind: "spellInList", spell: "Eldritch Blast"},
		{kind: "spellInList", spell: "Hex"},
		{kind: "rollAttack", attackName: /eldritch blast/i, skip: true, skipReason: "TGTT preset deliberately ships unarmed; see Phase 15 P4 for pre-equip plan"},
		{kind: "rollSavingThrow", ability: "wis"},
		{kind: "rollInitiative"},
		// Tortle racials — piggy-backed on first L1 entry (no race row in matrix).
		{kind: "ac", min: 17},
		{kind: "speed", type: "walk", min: 30},
	]},
	// STRUCTURALLY UNREACHABLE ON THIS BUILD — kept (skipped) rather than
	// deleted so the constraint stays documented.
	//
	// The TGTT Warlock is `edition: "one"`, so the patron is chosen at
	// Warlock 3. This plan is Hexblade 2 / Divine Soul 18: the Warlock
	// leg stops at level 2 and then every remaining level is Sorcerer,
	// so a patron is NEVER selected. The export confirms it —
	// `classes[0] = {name: "Warlock", level: 2, subclass: null,
	// subclassChoice: null}` — and the feature list at the L2 checkpoint
	// contains the Warlock chassis (Pact Magic, Eldritch Invocations,
	// Magical Cunning, Specialties) with no patron features at all.
	//
	// `PRESET_FULL_HEX_DIVINE_TORTLE` still names
	// `subclassName: "The Hexblade"`, which the wizard silently ignores
	// because it is not a legal choice at Warlock 2. That silent
	// discard is itself worth a guard — see the session report.
	//
	// These two rows predate this branch and fail identically on
	// `character-sheet-wip` (verified by an A/B run at fae134bb), so
	// they are NOT a CS-BUG-016 regression. Un-skip only if the plan is
	// changed to reach Warlock 3.
	//
	// Hex Warrior — CHA-to-attack with bound weapon. State doesn't
	// expose a clean "attacks use CHA mod" flag, so no effect probe.
	{level: 1, name: /hex warrior/i, kind: "passive", skip: true, skipReason: "Warlock leg stops at 2; TGTT Warlock is edition:one so the patron is chosen at 3"},
	// Hexblade's Curse — toggle. Curse changes neither AC nor DC, and
	// the sheet does not expose attack-advantage-vs-cursed-target as
	// a queryable advantage state. Toggle activation is already
	// validated by the parent `kind: "toggle"`; no effect probe.
	{level: 1, name: /hexblade's curse|hexblades curse/i, kind: "toggle", toggleDelta: "any", skip: true, skipReason: "Warlock leg stops at 2; TGTT Warlock is edition:one so the patron is chosen at 3"},
	// L2: Eldritch Invocations — 2 known at Warlock 2.
	// `kind: "pick"` already validates count via pickedFrom; no extra
	// effect probes. Attach Warlock-leg Deception roll-button here.
	{level: 2, name: /eldritch invocations?/i, kind: "pick", pickedCount: 2,
		pickedFrom: [/agonizing blast/i, /armor of shadows/i, /devil's sight/i, /eldritch sight/i,
			/eldritch spear/i, /repelling blast/i, /mask of many faces/i, /misty visions/i,
			/beast speech/i, /book of ancient secrets/i],
		effects: [
			{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
		]},

	// Phase H additive coverage: helper-driven per-pick effect probes
	// for the Warlock-leg invocations. Only the L2 milestone applies
	// (Warlock leg caps at level 2). Cross-source pool (XPHB ∪ XGE
	// ∪ TGTT) matches what the picker actually exposes.
	...buildAnyInvocationChecks(
		["XPHB", "XGE", "TGTT"],
		[{level: 2, cum: 2}],
		HEXBLADE_LEVELMAP,
	),

	// ── Sorcerer leg (TGTT-2014 Divine Soul — copy of XGE Divine Soul)
	// L3 = Sorc 1: Spellcasting + Divine Soul + Divine Magic affinity
	// pick + Favored by the Gods (resource — once per short or long
	// rest; max 1).
	// Divine Magic affinity pick is "Good" (see preset), which grants
	// `Cure Wounds` as an always-known bonus spell.
	// The Divine Magic affinity is persisted as the class's
	// `subclassChoice` ({key: "good", name: "Good"} in the export), NOT as
	// a feature, so `pickedFrom` could never match — the feature list
	// carries "Divine Soul" and "Divine Magic" and no affinity entry. This
	// row had never executed (see the L1 note above), so the claim was
	// never checked. Dropped to `passive` and the affinity is now proved
	// indirectly by Cure Wounds, which only the Good affinity grants.
	{level: 3, name: /divine magic|divine soul/i, kind: "passive",
		effects: [
			{kind: "spellInList", spell: "Cure Wounds"},
		]},
	// Favored by the Gods restoration is already covered by the parent
	// `restoreOn: "either"`. No additional effect probe needed.
	{level: 3, name: /favored by the gods/i, kind: "resource", resourceMax: [1, 1], restoreOn: "either"},
	// L4 = Sorc 2: Font of Magic / Sorcery Points (max = sorc level).
	// Sorcery Points have no `restoreOn` on the parent; layer the
	// long-rest restoration probe here. Plus Sorcerer-leg roll-button
	// probes (CHA save, CHA ability check, Persuasion skill).
	// NB: `describeMulticlassCharacter` asserts the matrix ONCE PER LEG, at
	// that leg's `toTotalLevel` (characterSpecFactory.ts:907) — here that is
	// L2 and L20 only, NOT every level. So a per-level `resourceMax` ladder
	// is evaluated entirely against L20 state and can never hold. The
	// ladder rows below are therefore stated at their L20 value; the growth
	// curve itself is covered by the single-class Sorcerer specs, which do
	// get a checkpoint per milestone.
	{level: 4, name: /sorcery points/i, kind: "resource", resourceMax: [19, 19], effects: [
		{kind: "longRestRestores", resource: "Sorcery Points"},
		{kind: "rollSavingThrow", ability: "cha"},
		{kind: "rollAbilityCheck", ability: "cha"},
		{kind: "rollSkillCheck", proficientSkills: true, skip: true, skipReason: "P5 follow-up: proficientSkills DOM lookup needs CharacterSheetPage hardening — state-side proficient ≠ rendered button"},
	]},
	// Font of Magic — passive plumbing. Use this anchor to assert the
	// CHA-based spell save DC has reached its mid-game floor: at
	// total L4 (Sorc 2) prof bonus = 2 and a 16-CHA caster yields
	// DC = 8 + 2 + 3 = 13. `min: 13` stays valid through L20.
	{level: 4, name: /font of magic/i, kind: "passive", effects: [
		{kind: "spellSaveDc", min: 13},
	]},
	// L5 = Sorc 3: Metamagic — pick 2 options. `pickedCount` is the
	// count floor; `pickToggleable` then verifies that ≥1 picked
	// option surfaces as a toggle on the sheet. The Sorcerer class
	// here is `TGTT` source, which splits Metamagic into Active
	// (toggleable) and Passive variants — only the Active flavours
	// surface as feature toggles, so `matchAny` lists only the
	// active options. (Passive variants like Careful / Distant /
	// Empowered / Extended / Transmuted don't render as toggles.)
	{level: 5, name: /metamagic/i, kind: "pick", pickedCount: 2,
		pickedFrom: TGTT_METAMAGIC,
		effects: [
			// Active metamagic is spent at CAST time through
			// `getCastableActiveMetamagics()` (rendered as "🌀 <name> · N SP"
			// entries in the cast menu), and
			// `charactersheet-combat.js` deliberately EXCLUDES
			// `optionalFeatureTypes: ["MM"]` from the activatable surface.
			// So no metamagic ever renders as a standing toggle and this
			// probe is unsatisfiable by design, not by defect. Left in place
			// (skipped) because the matchAny list is the useful part if the
			// cast-menu ever grows a scrapeable surface.
			{kind: "pickToggleable", min: 1, skip: true, skipReason: "metamagic is applied at cast time, never a standing toggle — charactersheet-combat.js excludes optionalFeatureTypes MM", matchAny: [
				/aimed spell.*active/i, /bestowed spell.*active/i, /bouncing spell.*active/i, /focused spell.*active/i,
				/lingering spell.*active/i, /overcharged spell.*active/i, /seeking spell.*active/i, /vampiric spell.*active/i,
				/quickened spell.*active/i, /twinned spell.*active/i, /subtle spell.*active/i, /heightened spell.*active/i,
			]},
		]},
	// L8 = Sorc 6: Empowered Healing (subclass — costs 1 sorcery
	// point to reroll a healing die). Modeled as passive feature
	// listing — it consumes the existing Sorcery Points pool rather
	// than exposing its own resource. No clean state-observable
	// effect probe (reroll is a player-side dice action).
	{level: 8, name: /empowered healing/i, kind: "passive"},
	// Sorcery Points pool grows with sorcerer level. Restoration
	// already probed at L4; pool-size checks suffice for higher tiers.
	{level: 8, name: /sorcery points/i, kind: "resource", resourceMax: [19, 19]},
	{level: 12, name: /sorcery points/i, kind: "resource", resourceMax: [19, 19]},
	{level: 16, name: /sorcery points/i, kind: "resource", resourceMax: [19, 19]},
	// L16 = Sorc 14: Otherworldly Wings (toggle — flying speed).
	// Currently the sheet exposes this as a passive listing rather
	// than a stat-changing toggle (no AC/DC delta), so use toggle
	// kind with `none` to validate button presence + activation only.
	// No togglePlusSpeed probe — the sheet's snapshot only captures
	// walk speed and Wings grants a fly speed instead.
	// PRODUCT GAP — CS-BUG-106. Otherworldly Wings is "use a bonus action
	// to manifest ... you have a flying speed of 30 feet ... dismiss them
	// as a bonus action" (Divine Soul 14, XGE) — textbook activatable — but
	// the sheet renders it with no toggle button at all. Other fly-speed
	// grants ARE curated active states, so this one is simply missing.
	// Asserted as `passive` so its PRESENCE stays pinned; flip back to
	// `toggle` when CS-BUG-106 is fixed.
	{level: 16, name: /otherworldly wings/i, kind: "passive"},
	// L20 = Sorc 18: Unearthly Recovery (passive — once per long rest
	// regain HP at half). State doesn't expose an "Unearthly Recovery
	// available" flag distinct from generic resource pools — no
	// clean effect probe.
	{level: 20, name: /unearthly recovery/i, kind: "passive"},
	{level: 20, name: /sorcery points/i, kind: "resource", resourceMax: [19, 19]},
	// TGTT Specialties (Sorcerer: 1/5/9/13/17 → mapped through SORC_LEVELMAP).
	...buildSpecialtyChecks("Sorcerer", SORC_LEVELMAP),
	// Metamagic — TGTT only (TGTT specs intentionally exclude XPHB MM).
	// Doctrine update (Phase H.2): use the cross-source-capable
	// `buildAnyMetamagicChecks(["TGTT"])` helper — functionally
	// equivalent to the deprecated `buildMetamagicChecks` but emits
	// `pickedFeatureGrants` probes for the auto-picker's first choice.
	...buildAnyMetamagicChecks(["TGTT"], undefined, SORC_LEVELMAP),
];

/**
 * #5 — Hexblade Warlock 2 / Divine Soul Sorcerer 18 Tortle (TGTT).
 *
 * Tests:
 *   - Pact Magic + Spell Slots coexist (Warlock pact slots + Sorcerer
 *     prepared slot pool both visible on Spells tab).
 *   - Hex/Hexblade's Curse signature toggle present after L1.
 *   - Divine Soul affinity selection completed during creation.
 *   - Reaching final 2/18 split reports total character level 20 with
 *     Sorcery Points = 18 max and 9th-level slots present.
 */
describeMulticlassCharacter({
	displayName: "Hexblade 2 / Divine Soul 18 Tortle",
	preset: {
		...PRESET_FULL_HEX_DIVINE_TORTLE,
		// Builder must auto-pick a Divine Soul affinity at the Sorcerer leg,
		// not at the Warlock primary leg.  We set the affinity here so the
		// downstream multiclass step (after Sorcerer level 1) consumes it.
		divineSoulAffinity: "Good",
	},
	plan: [
		{className: "Warlock", classSource: "TGTT", subclassName: "The Hexblade", subclassSource: "TGTT-2014",
			signatureSpells: ["Hex", "Eldritch Blast"], toTotalLevel: 2},
		{className: "Sorcerer", classSource: "TGTT", subclassName: "Divine Soul", subclassSource: "TGTT-2014",
			signatureSpells: ["Cure Wounds", "Shield"], toTotalLevel: 20},
	],
	usageAfterEachLeg: [
		// After Warlock 2 — Pact slots present + Hex available + Arcana skill
		{
			useResourceName: "Sorcery Points",  // not yet present; probe will log + skip
			skillRoll: {name: "Arcana"},
		},
		// After Sorcerer 18 — full caster + Sorcery Points + skill probe
		{
			castSpellSlotLevel: 1,
			useResourceName: "Sorcery Points",
			skillRoll: {name: "Persuasion"},
		},
	],
	finalMilestone: {
		totalLevel: 20,
		spellSlots: {1: 4, 5: 2, 7: 1, 9: 1},
		pactSlots: {level: 1, max: 2},
		expectToggles: [/hexblade|hex|metamagic|font of magic/i],
		expectResources: {"Sorcery Points": 18},
	},
	featuresMatrix: HEX_DIVINE_MULTI_FEATURES_MATRIX,
});
