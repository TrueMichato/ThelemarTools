import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_MERCY_MONK_CHANGELING} from "../utils/characterBuilder";
import type {FeatureCheck} from "../utils/comprehensiveBuildHelpers";

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
	{level: 1,  name: /martial arts/i, kind: "passive"},
	{level: 1,  name: /unarmored defense/i, kind: "passive"},
	// Monk's Focus + Focus Points pool — XPHB grants the resource at
	// L2 (not L1) with max = monk level. Probed at the milestone
	// checkpoints; restoration semantics omitted (short-rest restore
	// is generally working for monks but resting is expensive).
	{level: 2,  name: /monk'?s focus/i, kind: "passive"},
	{level: 2,  name: /unarmored movement/i, kind: "passive"},
	{level: 2,  name: /uncanny metabolism/i, kind: "passive"},
	{level: 3,  name: "Focus Points", kind: "resource", resourceMax: 3},
	{level: 5,  name: "Focus Points", kind: "resource", resourceMax: 5},
	{level: 11, name: "Focus Points", kind: "resource", resourceMax: 11},
	{level: 17, name: "Focus Points", kind: "resource", resourceMax: 17},
	{level: 20, name: "Focus Points", kind: "resource", resourceMax: 20},
	// Deflect Attacks (XPHB L3 — replaces 2014 Deflect Missiles).
	{level: 3,  name: /deflect attacks/i, kind: "passive"},
	// ASIs at L4/8/12/16 + Epic Boon at L19.
	{level: 4,  name: /ability score improvement/i, kind: "passive"},
	{level: 4,  name: /slow fall/i, kind: "passive"},
	{level: 5,  name: /extra attack/i, kind: "passive"},
	// Stunning Strike — XPHB renders as a passive (no toggle, costs a
	// Focus Point on a hit). Treat as passive.
	{level: 5,  name: /stunning strike/i, kind: "passive"},
	{level: 6,  name: /empowered strikes/i, kind: "passive"},
	{level: 7,  name: /evasion/i, kind: "passive"},
	{level: 8,  name: /ability score improvement/i, kind: "passive"},
	{level: 9,  name: /acrobatic movement/i, kind: "passive"},
	{level: 10, name: /heightened focus/i, kind: "passive"},
	// Self-Restoration (XPHB L10) — replaces 2014 Stillness of Mind/
	// Purity of Body, lets the monk shake conditions on their turn.
	{level: 10, name: /self.restoration/i, kind: "passive"},
	{level: 12, name: /ability score improvement/i, kind: "passive"},
	{level: 13, name: /deflect energy/i, kind: "passive"},
	// Disciplined Survivor (XPHB L14) — XPHB rename of 2014 Diamond
	// Soul (proficiency in all saves + spend Focus Point to reroll).
	{level: 14, name: /disciplined survivor/i, kind: "passive"},
	{level: 15, name: /perfect focus/i, kind: "passive"},
	{level: 16, name: /ability score improvement/i, kind: "passive"},
	{level: 18, name: /superior defense/i, kind: "passive"},
	{level: 19, name: /ability score improvement|epic boon/i, kind: "passive"},
	// Body and Mind (XPHB L20) — XPHB rename of 2014 Perfect Self.
	{level: 20, name: /body and mind/i, kind: "passive"},

	// ── TGTT Monk additions ──────────────────────────────────────────
	// Specialties (TGTT) are a pick-list at L2/4/6/8/10/12/14/16/18/20;
	// list the L2 grant once as a passive marker. The L8 Unhindered
	// Flurry rider is also TGTT-specific.
	{level: 2,  name: /specialties/i, kind: "passive"},
	{level: 8,  name: /unhindered flurry/i, kind: "passive"},

	// ── Subclass — Warrior of Mercy (XPHB, exposed via TGTT) ─────────
	// L3 Warrior of Mercy umbrella + the three sub-features it gates.
	// Hand of Healing and Hand of Harm both spend Focus Points; the
	// sheet typically surfaces them as activatable (existing milestone
	// at L3 expects toggle /hand of (healing|harm)/i). Treat as
	// toggles with no required derived-stat delta — they consume
	// Focus Points / hit dice rather than buffing AC/DC directly.
	{level: 3,  name: /^hand of healing/i, kind: "toggle", toggleDelta: "none"},
	{level: 3,  name: /^hand of harm/i, kind: "toggle", toggleDelta: "none"},
	{level: 3,  name: /implements of mercy/i, kind: "passive"},
	// TGTT-specific Combat Methods (Mercy) grant.
	{level: 3,  name: /combat methods.*mercy/i, kind: "passive"},
	// L6 Physician's Touch — riders on Hand of Healing/Harm.
	{level: 6,  name: /physician'?s touch/i, kind: "passive"},
	// L11 Flurry of Healing and Harm — passive enhancement on
	// Flurry of Blows.
	{level: 11, name: /flurry of healing and harm/i, kind: "passive"},
	// L17 Hand of Ultimate Mercy — once-per-long-rest revive. Passive
	// listing on the feature panel (not a toggle in the active-state
	// sense).
	{level: 17, name: /hand of ultimate mercy/i, kind: "passive"},
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

