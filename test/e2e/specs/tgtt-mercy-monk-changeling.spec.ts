import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_MERCY_MONK_CHANGELING} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";
import {TGTT_SPECIALTIES} from "../utils/tgttFeaturePools";

/**
 * #1 — Mercy Monk Changeling (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Monk martial-arts die scaling (D4→D6 by L5)
 *   - Ki/Discipline pool growth
 *   - Subclass: "Hand of Healing" / "Hand of Harm" toggles arrive at L3
 *   - Capstone Perfect Self at L20
 */
// ── Warrior of Mercy Monk L1→20 features matrix ────────────────────────
// TGTT Monk uses XPHB Monk chassis. The 2014→XPHB rename swept some
// names: Ki → Focus Points, Diamond Soul → Disciplined Survivor (L14),
// Empty Body → (no direct counterpart; Self-Restoration L10 + Perfect
// Focus L15 cover regen), Perfect Self → Body and Mind (L20). The user
// brief listed 2014 names; we test against the XPHB names the sheet
// actually renders.
//
// Subclass — Warrior of Mercy (XPHB, source-shimmed in via TGTT Monk):
// L3 grants Hand of Healing + Hand of Harm + Implements of Mercy via
// the Warrior of Mercy umbrella feature, plus TGTT's Combat Methods
// (Mercy). L6 Physician's Touch, L11 Flurry of Healing and Harm, L17
// Hand of Ultimate Mercy.
const MERCY_MONK_FEATURES_MATRIX: FeatureCheck[] = [
	// ── Class — Monk (TGTT/XPHB) ─────────────────────────────────────
	// Martial Arts: STR is one of the monk's two L1 proficient saves;
	// use it as the home for the rollSavingThrow:str probe.
	{
		level: 1,  name: /martial arts/i, kind: "passive",
		effects: [
			{kind: "rollSavingThrow", ability: "str"},
			// XPHB Monk MA progression: d6 (L1) → d8 (L5) → d10
			// (L11) → d12 (L17). minFaces: 6 holds at every
			// milestone (the floor only grows from here).
			{kind: "martialArtsDie", minFaces: 6},
			// Monks render Unarmed Strike via a dedicated panel,
			// not as a `.charsheet__attack-item` row, and TGTT
			// Mercy Monks don't auto-equip a weapon. Skipped to
			// avoid a guaranteed false negative; revisit if the
			// monk panel ever surfaces unarmed strikes through
			// the standard attack list.
			{
				kind: "attackPresent",
				namePattern: /unarmed strike|martial arts/i,
				skip: true,
				skipReason: "monk unarmed strike lives in dedicated panel, not .charsheet__attack-item",
			},
		],
	},
	// Unarmored Defense: DEX is the other L1 proficient save; also
	// host the rollInitiative probe here (initiative = DEX).
	{
		level: 1,  name: /unarmored defense/i, kind: "passive",
		effects: [
			{kind: "rollSavingThrow", ability: "dex"},
		],
	},
	// Monk's Focus + Focus Points pool — XPHB grants the resource at
	// L2 (not L1) with max = monk level. Probed at the milestone
	// checkpoints; restoration semantics moved onto the L3 Focus
	// Points resource entry below via shortRestRestores.
	// WIS-check probe lives here because Monk's Focus is the WIS-
	// flavored umbrella feature for the Discipline pool.
	{
		level: 2,  name: /monk'?s focus/i, kind: "passive",
		effects: [
			{kind: "rollAbilityCheck", ability: "wis"},
		],
	},
	// Unarmored Movement L2 — +10 ft speed (monk base 30 + UM 10).
	// `min: 40` floor holds at L2 and only grows at L6/10/14/18.
	{
		level: 2,  name: /unarmored movement/i, kind: "passive",
		effects: [
			{kind: "speed", type: "walk", min: 40},
		],
	},
	{level: 2,  name: /uncanny metabolism/i, kind: "passive"},
	// Focus Points resource — also the home of the short-rest restore
	// probe (monks regain all Focus Points on a short rest per XPHB).
	{
		level: 3,  name: "Focus Points", kind: "resource", resourceMax: 3,
		effects: [
			{kind: "shortRestRestores", resource: "Focus Points"},
		],
	},
	{level: 5,  name: "Focus Points", kind: "resource", resourceMax: 5},
	{level: 11, name: "Focus Points", kind: "resource", resourceMax: 11},
	{level: 17, name: "Focus Points", kind: "resource", resourceMax: 17},
	{level: 20, name: "Focus Points", kind: "resource", resourceMax: 20},
	// Deflect Attacks (XPHB L3 — replaces 2014 Deflect Missiles).
	// No clean state probe (it's a reaction-time rider, not a passive
	// stat or toggle).
	{level: 3,  name: /deflect attacks/i, kind: "passive"},
	// ASIs at L4/8/12/16 + Epic Boon at L19.
	{level: 4,  name: /ability score improvement/i, kind: "passive"},
	// Slow Fall — reaction that reduces fall damage; no easy state
	// probe (no resistance/toggle/derived stat exposed).
	{level: 4,  name: /slow fall/i, kind: "passive"},
	// Extra Attack — host the rollInitiative probe here (the L5
	// "combat-readiness" milestone is a natural home). Also host
	// the L5 MA-die bump (d8); minFaces:8 holds at L5/L11/L17/L20.
	{
		level: 5,  name: /extra attack/i, kind: "passive",
		effects: [
			{kind: "rollInitiative"},
			{kind: "martialArtsDie", minFaces: 8},
		],
	},
	// Stunning Strike — XPHB renders as a passive (no toggle, costs a
	// Focus Point on a hit). No clean state probe (the stun is rolled
	// reactively by the target, not a passive bonus on the monk).
	{level: 5,  name: /stunning strike/i, kind: "passive"},
	{level: 6,  name: /empowered strikes/i, kind: "passive"},
	// Evasion L7 — DEX-save success-on-half rider; no easy state
	// probe (no resistance/advantage/derived stat exposed).
	{level: 7,  name: /evasion/i, kind: "passive"},
	{level: 8,  name: /ability score improvement/i, kind: "passive"},
	// Acrobatic Movement L9 — climbing/jumping rider. Host the
	// rollSkillCheck:acrobatics probe (signature monk skill).
	{
		level: 9,  name: /acrobatic movement/i, kind: "passive",
		effects: [
			{kind: "rollSkillCheck", skill: "acrobatics"},
		],
	},
	{level: 10, name: /heightened focus/i, kind: "passive"},
	// Self-Restoration (XPHB L10) — replaces 2014 Stillness of Mind/
	// Purity of Body, lets the monk shake conditions on their turn.
	// Auto-end-condition behavior is not a probeable passive state;
	// leave passive without effects.
	{level: 10, name: /self.restoration/i, kind: "passive"},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{level: 13, name: /deflect energy/i, kind: "passive"},
	// Disciplined Survivor (XPHB L14) — XPHB rename of 2014 Diamond
	// Soul (proficiency in all saves + spend Focus Point to reroll).
	// At L14 monk PB is +5; bumping the three previously unproficient
	// saves (INT/WIS/CHA) to proficient guarantees a non-trivial total
	// even with negative ability mods. `min: 1` is conservative.
	{
		level: 14, name: /disciplined survivor/i, kind: "passive",
		effects: [
			{kind: "saveBonus", ability: "int", min: 1},
			{kind: "saveBonus", ability: "wis", min: 1},
			{kind: "saveBonus", ability: "cha", min: 1},
		],
	},
	{level: 15, name: /perfect focus/i, kind: "passive"},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	// Superior Defense L18 (XPHB) — closest analog to 2014 Empty Body
	// (resistance to all damage except force while spending focus).
	// Not exposed as a toggle/state on the sheet, so no probe.
	{level: 18, name: /superior defense/i, kind: "passive"},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	// Body and Mind (XPHB L20) — XPHB rename of 2014 Perfect Self.
	// +4 to DEX & WIS at L20; conservatively not probed because the
	// spec doesn't pin starting ability scores (preset uses defaults)
	// and `abilityScore` exact/min would be brittle across builds.
	{level: 20, name: /body and mind/i, kind: "passive"},

	// ── TGTT Monk additions ──────────────────────────────────────────
	// Specialties (TGTT) — Monk gains a pick at L2 then +1 each at
	// L4/6/8/10/12/14/16/18/20 (cumulative 1→10) from a 17-option pool.
	{level: 2,  name: /specialties/i, kind: "pick", pickedCount: 1,  pickedFrom: TGTT_SPECIALTIES.Monk},
	{level: 4,  name: /specialties/i, kind: "pick", pickedCount: 2,  pickedFrom: TGTT_SPECIALTIES.Monk},
	{level: 6,  name: /specialties/i, kind: "pick", pickedCount: 3,  pickedFrom: TGTT_SPECIALTIES.Monk},
	{level: 8,  name: /specialties/i, kind: "pick", pickedCount: 4,  pickedFrom: TGTT_SPECIALTIES.Monk},
	{level: 10, name: /specialties/i, kind: "pick", pickedCount: 5,  pickedFrom: TGTT_SPECIALTIES.Monk},
	{level: 12, name: /specialties/i, kind: "pick", pickedCount: 6,  pickedFrom: TGTT_SPECIALTIES.Monk},
	{level: 14, name: /specialties/i, kind: "pick", pickedCount: 7,  pickedFrom: TGTT_SPECIALTIES.Monk},
	{level: 16, name: /specialties/i, kind: "pick", pickedCount: 8,  pickedFrom: TGTT_SPECIALTIES.Monk},
	{level: 18, name: /specialties/i, kind: "pick", pickedCount: 9,  pickedFrom: TGTT_SPECIALTIES.Monk},
	{level: 20, name: /specialties/i, kind: "pick", pickedCount: 10, pickedFrom: TGTT_SPECIALTIES.Monk},
	{level: 8,  name: /unhindered flurry/i, kind: "passive"},

	// ── Subclass — Warrior of Mercy (XPHB, exposed via TGTT) ─────────
	// L3 Warrior of Mercy umbrella + the three sub-features it gates.
	// Hand of Healing and Hand of Harm both spend Focus Points; the
	// sheet typically surfaces them as activatable (existing milestone
	// at L3 expects toggle /hand of (healing|harm)/i). Treat as
	// toggles with no required derived-stat delta — they consume
	// Focus Points / hit dice rather than buffing AC/DC directly.
	{level: 3,  name: /^hand of healing/i, kind: "toggle", toggleDelta: "none"},
	// Hand of Harm rides on a successful unarmed strike — host the
	// rollAttack probe targeting the unarmed-strike / martial-arts
	// attack row.
	{
		level: 3,  name: /^hand of harm/i, kind: "toggle", toggleDelta: "none",
		effects: [
			{kind: "rollAttack", attackName: /unarmed|martial arts/i},
		],
	},
	// Implements of Mercy L3 — grants Insight + Medicine proficiency
	// + a Herbalism Kit. Probe the two skill bonuses (PB +2 at L3,
	// scaling with PB at L5+/L9+/L13+/L17+) and host the
	// rollSkillCheck:medicine probe (mercy-themed).
	{
		level: 3,  name: /implements of mercy/i, kind: "passive",
		effects: [
			{kind: "skillBonus", skill: "medicine", min: 2},
			{kind: "skillBonus", skill: "insight",  min: 2},
			{kind: "rollSkillCheck", skill: "medicine"},
		],
	},
	// TGTT-specific Combat Methods (Mercy) grant.
	{level: 3,  name: /combat methods.*mercy/i, kind: "passive"},
	// L6 Physician's Touch — riders on Hand of Healing/Harm (e.g.
	// Hand of Healing also ends a condition; Hand of Harm poisons).
	// Effect is gated by the parent toggles, not a separate probe.
	{level: 6,  name: /physician'?s touch/i, kind: "passive"},
	// L11 Flurry of Healing and Harm — passive enhancement on
	// Flurry of Blows. Also the natural home for the L11 MA-die
	// bump (d10); minFaces:10 holds at L11/L17/L20.
	{
		level: 11, name: /flurry of healing and harm/i, kind: "passive",
		effects: [
			{kind: "martialArtsDie", minFaces: 10},
		],
	},
	// L17 Hand of Ultimate Mercy — once-per-long-rest revive. Passive
	// listing on the feature panel (not a toggle in the active-state
	// sense). Also the natural home for the L17 MA-die bump (d12).
	{
		level: 17, name: /hand of ultimate mercy/i, kind: "passive",
		effects: [
			{kind: "martialArtsDie", minFaces: 12},
		],
	},
];

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
	featuresMatrix: MERCY_MONK_FEATURES_MATRIX,
});

