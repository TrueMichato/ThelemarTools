import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_WICKED_WITCH_SORCERER} from "../utils/characterBuilder";
import {buildMetamagicChecks, buildSpecialtyChecks, TGTT_METAMAGIC} from "../utils/tgttFeaturePools";

/**
 * Metamagic pick pool. The TGTT chassis serves its own "<X> Spell (Active|Passive)"
 * catalogue; the eight PHB spellings are accepted too so the row asserts "the picker
 * produced N real picks" without pinning which catalogue the sheet served.
 */
const METAMAGIC_POOL: RegExp[] = [
	...TGTT_METAMAGIC,
	/^careful spell$/i, /^distant spell$/i, /^empowered spell$/i, /^extended spell$/i,
	/^heightened spell$/i, /^quickened spell$/i, /^subtle spell$/i, /^twinned spell$/i,
];

/**
 * The Hag Ancestor pick. `LevelUpPage.resolvePendingFeatureChoices()` clicks the FIRST
 * option, so the build is deterministically a GREEN hag: illusion specialty, Sylvan,
 * Deception. The other two are listed to prove the picker offered a real choice.
 */
const HAG_ANCESTOR_POOL: RegExp[] = [
	/^green hag ancestor$/i,
	/^night hag ancestor$/i,
	/^sea hag ancestor$/i,
];

/**
 * Wicked Witch Sorcerer (Arcadia 8 origin on the TGTT Sorcerer chassis) — L1→20.
 *
 * The subclass reaches the sheet through a `_copy` in
 * `homebrew/TravelersGuidetoThelemar.json` (~line 18472) that re-parents
 * `Wicked Witch Sorcerous Origin|Ar8` — written for `classSource: "PHB"` — onto
 * `classSource: "TGTT"`. Two chassis consequences drive every number below:
 *
 *   - **Sorcerous Origin is a LEVEL 3 feature on TGTT**, not level 1, so the two
 *     "L1" Ar8 features (Granny's Gifts, Hag Ancestor) come online at character 3.
 *     The calculation block gates them on `subclassLevel = is2024 ? 3 : 1`.
 *   - **Sorcery Points are `level + 1` from L1** (`getSorceryPointsMaxForClass()`,
 *     charactersheet-state.js) because TGTT grants Font of Magic at 1st level —
 *     NOT `level` from L2 as on the PHB/XPHB chassis.
 *
 * Coverage focus — every feature must have an observable MECHANICAL effect. Before
 * this work the subclass produced ZERO feature calculations, no language, no skill,
 * no modifier and no activatable row: it rendered its description and did nothing.
 *
 *   - **Granny's Gifts** (L3) — half of it is the always-prepared spell ladder the
 *     GENERIC `additionalSpells` pipeline grants; the other half is a real long-rest
 *     choice. `setGrannysWardTarget()` installs two precisely-typed
 *     `save:advantage:<condition>` modifiers, so advantage lands on charm/fear saves
 *     and nowhere else — the negative on `save:dex` is the assertion a blanket
 *     `save:all` reading of the same prose would fail.
 *   - **Hag Ancestor** (L3) — a three-way pick that must reach the Builder AND drive
 *     three separate mechanics: a language, a skill proficiency and the "specialty"
 *     school that halves Clever Little Witch. Plus a gated CHA-check advantage when
 *     influencing hags, which must be offered to the opt-in picker and must NOT leak
 *     into the default roll.
 *   - **Clever Little Witch** (L6) — the specialty discount is the mechanic. A
 *     5th-level illusion costs 2 where a 5th-level evocation costs 5, and the floor
 *     makes a 1st-level specialty spell free. Spends through the same
 *     `useSorceryPoint()` the production cast path calls.
 *   - **Fly, My Pretty** (L14) — a real active state: 60 ft fly speed plus charm and
 *     fear immunity, both of which must appear and then DISAPPEAR around the toggle.
 *   - **Coven Calling** (L18) — 2 Sorcery Points for two duplicates, each of which
 *     spends its spell's level in points, capped at 3rd level; and the recall clause
 *     that unlocks a second mode of Clever Little Witch.
 */
describeCharacter({
	preset: PRESET_FULL_WICKED_WITCH_SORCERER,
	displayName: "Wicked Witch Sorcerer",
	// The subclass's only persistent toggle is Fly, My Pretty at L14 — long past the
	// L5/L7 signature-toggle checkpoints. It is probed directly in the matrix instead.
	signatureToggleSkip: {
		skip: true,
		reason:
			"Wicked Witch's only persistent toggle is Fly, My Pretty at L14, well past the L5/L7 signature-toggle "
			+ "checkpoints. Everything online at L5 is instant or long-rest-scoped: Granny's Gifts is a long-rest "
			+ "ward (asserted through setGrannysWardTarget → aggregateModifiers), Hag Ancestor is passive. The L14 "
			+ "toggle is asserted end to end at L17/L20 (fly speed 0 → 60 → 0, plus the two condition immunities).",
	},
	// CS-BUG-030: the wizard ships an unarmed caster, so equip something the USE
	// attack probe can actually roll.
	midTierLoadout: [
		{name: "Dagger", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Sorcery Points",
		expectLongRestRestores: true,
		attackName: /dagger|quarterstaff|crossbow/i,
		skillRoll: {name: "Arcana"},
		// Sorcerous Restoration (short-rest Sorcery Point recovery) is a L20 feature,
		// far past this L5 probe.
		shortRestRestores: {skip: true},
		concentrationCheck: {castSpell: "Shield of Faith", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, spellSlots: {1: 2}, expectResources: {"Sorcery Points": 2}},
		3: {totalLevel: 3, spellSlots: {2: 2}, expectResources: {"Sorcery Points": 4}},
		5: {totalLevel: 5, spellSlots: {3: 2}, expectResources: {"Sorcery Points": 6}},
		11: {totalLevel: 11, spellSlots: {6: 1}, expectResources: {"Sorcery Points": 12}},
		17: {totalLevel: 17, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 18}},
		20: {totalLevel: 20, spellSlots: {9: 1}, expectResources: {"Sorcery Points": 21}},
	},
	featuresMatrix: [
		// ══ TGTT Sorcerer chassis ════════════════════════════════════════
		// Font of Magic at L1 → Sorcery Points = sorcerer level + 1, growing at
		// EVERY level. `resourceMax` is an exact match and the matrix re-evaluates
		// every earlier row at each later checkpoint, so each tier is bounded with
		// `untilLevel`. Values are the CHECKPOINT values ([3, 5, 11, 17, 20]) —
		// a `{level: 1}` row would first be evaluated at L3.
		{
			level: 3,
			untilLevel: 4,
			name: "Sorcery Points",
			kind: "resource",
			resourceMax: 4,
			restoreOn: "long",
			effects: [{kind: "longRestRestores", resource: "Sorcery Points"}],
		},
		{level: 5, untilLevel: 10, name: "Sorcery Points", kind: "resource", resourceMax: 6},
		{level: 11, untilLevel: 16, name: "Sorcery Points", kind: "resource", resourceMax: 12},
		{level: 17, untilLevel: 19, name: "Sorcery Points", kind: "resource", resourceMax: 18},
		{level: 20, name: "Sorcery Points", kind: "resource", resourceMax: 21},

		// The pool is a real spend, not a display. Scoped to L3 ONLY because the
		// exact before/after numbers are only knowable when the max is exactly 4.
		// `useSorceryPoint()` is the method the production cast path calls
		// (charactersheet-spells.js:2180 / :2240 / :2354).
		{level: 3, untilLevel: 3, name: /font of magic/i, kind: "passive",
			effects: [
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 4},
				{kind: "stateCall", method: "useSorceryPoint", args: [2], exact: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 2},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 4},
			]},

		// Metamagic — TGTT progression is 2@L2, +1 at 3/6/10/13/17 (seven by L17),
		// which is NOT the XPHB 3/10/17 ladder the helper defaults to.
		//
		// ⚠️ Two traps, both inherited from sibling specs. (1) `getFeatures()` lists
		// metamagic options the character has NOT picked, so a name probe can pass on
		// a character that knows none of them. (2) Metamagic is deliberately excluded
		// from the activatable surface (charactersheet-combat.js:5806/:5827/:6048) —
		// the Metamagic Dashboard owns that UI and cost is resolved at CAST time — so
		// a `pickToggleable` probe can never pass at any level. The `pick` rows stay,
		// because "every CHOICE must be surfaced" is a requirement of this suite, and
		// each tier is BACKED by `getKnownMetamagicKeys()`, which only counts stored
		// picks.
		...buildMetamagicChecks([
			{level: 2, cum: 2}, {level: 3, cum: 3}, {level: 6, cum: 4},
			{level: 10, cum: 5}, {level: 13, cum: 6}, {level: 17, cum: 7},
		]),
		{level: 3, untilLevel: 5, name: /metamagic/i, kind: "pick", pickedCount: 3, pickedFrom: METAMAGIC_POOL,
			effects: [
				{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 3},
				{kind: "stateCall", method: "getKnownActiveMetamagics", path: "length", min: 1},
				// Cost table read through the production accessor: a flat cost, a
				// `"level"` cost and a `"halfLevel"` cost — the two computed branches
				// are exactly what a toggle-shaped model gets wrong.
				{kind: "stateCall", method: "getMetamagicCost", args: ["aimed", 3], exact: 2},
				{kind: "stateCall", method: "getMetamagicCost", args: ["twinned", 3], exact: 3},
				{kind: "stateCall", method: "getMetamagicCost", args: ["vampiric", 3], exact: 2},
				{kind: "stateCall", method: "getCastableActiveMetamagics", args: [{slotLevel: 3}], contains: "\"cost\":"},
			]},
		{level: 11, untilLevel: 16, name: /metamagic/i, kind: "pick", pickedCount: 5, pickedFrom: METAMAGIC_POOL,
			effects: [{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 5}]},
		{level: 17, name: /metamagic/i, kind: "pick", pickedCount: 7, pickedFrom: METAMAGIC_POOL,
			effects: [{kind: "stateCall", method: "getKnownMetamagicKeys", path: "length", exact: 7}]},
		{level: 20, name: /sorcerous restoration/i, kind: "passive"},

		// TGTT Specialties (L4/8/12/16/20) — a chassis-level CHOICE, so in scope for
		// "every choice must be surfaced" even though it is not a subclass feature.
		...buildSpecialtyChecks("Sorcerer"),

		// ══ Wicked Witch Sorcerous Origin (L3 on the TGTT chassis) ═══════
		{level: 3, name: /wicked witch sorcerous origin/i, kind: "passive"},

		// ── Granny's Gifts ───────────────────────────────────────────────
		{
			level: 3,
			name: /granny'?s gifts/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasGrannysGifts", exact: true},
				{kind: "featureCalculation", property: "grannysWardRange", exact: 30},
				// The replaceable-spell clause is a real, queryable descriptor rather
				// than prose the player has to read.
				{kind: "stateCall", method: "getFeatureCalculations", path: "grannysGiftsSwapSchools", contains: "illusion"},
				{kind: "stateCall", method: "getFeatureCalculations", path: "grannysGiftsSwapClasses", contains: "warlock"},
				// No ward chosen yet → no advantage anywhere.
				{kind: "stateCall", method: "aggregateModifiers", args: ["save:charmed"], path: "advantage", exact: false},
				// Choosing the ward installs it…
				{kind: "stateCall", method: "setGrannysWardTarget", args: ["self"], path: "ok", exact: true},
				{kind: "stateCall", method: "getGrannysWard", path: "target", exact: "self"},
				{kind: "stateCall", method: "aggregateModifiers", args: ["save:charmed"], path: "advantage", exact: true},
				{kind: "stateCall", method: "aggregateModifiers", args: ["save:charmed"], contains: "Granny's Gifts (Ancestral Ward)"},
				{kind: "stateCall", method: "aggregateModifiers", args: ["save:frightened"], path: "advantage", exact: true},
				// …precisely. A blanket `save:all` reading of the same prose — which is
				// what the generic text parser produces — would light this up too.
				{kind: "stateCall", method: "aggregateModifiers", args: ["save:dex"], path: "advantage", exact: false},
				// RAW re-chooses the ward every long rest, so it must not survive one.
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getGrannysWard", exact: null},
				{kind: "stateCall", method: "aggregateModifiers", args: ["save:charmed"], path: "advantage", exact: false},
				// An ally beyond 30 ft is out of reach.
				{kind: "stateCall", method: "setGrannysWardTarget", args: ["Morrigan", {distance: 45}], path: "ok", exact: false},
				// A Use affordance on the sheet, not just a rendered paragraph.
				{kind: "combatAction", feature: "Granny's Gifts", interactionMode: "limited"},
			],
		},
		// The always-prepared spell ladder, per tier. `spellInList` uses an exact name
		// lookup deliberately — `spellMatchMode: "any"` DROPS the name assertion.
		{
			level: 3,
			name: /wicked witch sorcerous origin/i,
			kind: "spells",
			grantsSpells: ["Bane", "Tasha's Hideous Laughter", "Animal Messenger", "Mirror Image"],
			effects: [
				{kind: "spellInList", spell: "Bane"},
				{kind: "spellInList", spell: "Tasha's Hideous Laughter"},
				{kind: "spellInList", spell: "Animal Messenger"},
				{kind: "spellInList", spell: "Mirror Image"},
			],
		},
		{
			level: 5,
			name: /wicked witch sorcerous origin/i,
			kind: "spells",
			grantsSpells: ["Fear", "Hypnotic Pattern"],
			effects: [
				{kind: "spellInList", spell: "Fear"},
				{kind: "spellInList", spell: "Hypnotic Pattern"},
			],
		},
		{
			level: 11,
			name: /wicked witch sorcerous origin/i,
			kind: "spells",
			grantsSpells: ["Confusion", "Greater Invisibility", "Dream", "Mislead"],
			effects: [
				{kind: "spellInList", spell: "Confusion"},
				{kind: "spellInList", spell: "Greater Invisibility"},
				{kind: "spellInList", spell: "Dream"},
				{kind: "spellInList", spell: "Mislead"},
			],
		},

		// ── Hag Ancestor ─────────────────────────────────────────────────
		// The CHOICE must surface in the wizard…
		{level: 3, name: /hag ancestor/i, kind: "pick", pickedCount: 1, pickedFrom: HAG_ANCESTOR_POOL},
		// …and the pick must drive four separate mechanics.
		{
			level: 3,
			name: /hag ancestor/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasHagAncestor", exact: true},
				{kind: "featureCalculation", property: "hagAncestorKind", exact: "Green"},
				{kind: "featureCalculation", property: "hagAncestorSpecialty", exact: "illusion"},
				{kind: "stateCall", method: "getHagAncestorKind", exact: "Green"},
				{kind: "stateCall", method: "getHagAncestorSpecialtySchool", exact: "illusion"},
				// 1. A real language on the sheet.
				{kind: "stateCall", method: "getLanguages", contains: "Sylvan"},
				// 2. A real skill proficiency (1 = proficient).
				{kind: "stateCall", method: "getSkillProficiency", args: ["deception"], exact: 1},
				// 3. The specialty school, accepted in both the full-name and the
				//    5etools single-letter form spell records actually carry.
				{kind: "stateCall", method: "isHagSpecialtySchool", args: ["illusion"], exact: true},
				{kind: "stateCall", method: "isHagSpecialtySchool", args: ["I"], exact: true},
				{kind: "stateCall", method: "isHagSpecialtySchool", args: ["evocation"], exact: false},
				// 4. A GATED advantage: offered to the opt-in picker, granting advantage
				//    when opted into, and never leaking into the default CHA check.
				{kind: "conditionalAdvantage", rollType: "check:cha", conditionalIncludes: "hag", sourceIncludes: "Hag Ancestor"},
			],
		},

		// ── Clever Little Witch (L6; first checkpoint L11) ───────────────
		{
			level: 6,
			name: /clever little witch/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasCleverLittleWitch", exact: true},
				{kind: "featureCalculation", property: "cleverLittleWitchRange", exact: 15},
				{kind: "featureCalculation", property: "cleverLittleWitchAction", exact: "reaction"},
				// The specialty discount IS the mechanic — a description-only
				// implementation cannot produce these three numbers.
				{kind: "stateCall", method: "getCleverLittleWitchCost", args: [5, "evocation"], exact: 5},
				{kind: "stateCall", method: "getCleverLittleWitchCost", args: [5, "illusion"], exact: 2},
				{kind: "stateCall", method: "getCleverLittleWitchCost", args: [5, "I"], exact: 2},
				// Floor of 1/2 → a 1st-level specialty spell is free.
				{kind: "stateCall", method: "getCleverLittleWitchCost", args: [1, "illusion"], exact: 0},
				// Cantrips are out of scope entirely.
				{kind: "stateCall", method: "getCleverLittleWitchCost", args: [0, "illusion"], exact: null},
				// A real spend against a full pool, and the DC used is YOURS.
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "useCleverLittleWitch", args: [{spellLevel: 5, school: "illusion"}], path: "cost", exact: 2},
				{kind: "stateCall", method: "useCleverLittleWitch", args: [{spellLevel: 5, school: "illusion"}], path: "discounted", exact: true},
				{kind: "stateCall", method: "useCleverLittleWitch", args: [{spellLevel: 1, school: "evocation"}], path: "spellSaveDc", min: 10},
				// Beyond 15 ft it protects nobody.
				{kind: "stateCall", method: "useCleverLittleWitch", args: [{spellLevel: 1, distance: 20}], path: "ok", exact: false},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "combatAction", feature: "Clever Little Witch", interactionMode: "limited"},
			],
		},
		// The Coven Calling recall clause is refused until L18 — asserted while it is
		// still unavailable, which is the half a text-only implementation cannot do.
		{
			level: 11,
			untilLevel: 17,
			name: /clever little witch/i,
			kind: "passive",
			effects: [
				{kind: "stateCall", method: "useCleverLittleWitch", args: [{spellLevel: 2, recalled: true}], path: "ok", exact: false},
			],
		},

		// ── Fly, My Pretty (L14; first checkpoint L17) ───────────────────
		{
			level: 14,
			name: /fly, my pretty/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasFlyMyPretty", exact: true},
				{kind: "featureCalculation", property: "flyMyPrettyFlySpeed", exact: 60},
				// Nothing enchanted, nothing ridden → no fly speed.
				{kind: "stateCall", method: "getSpeed", args: ["fly"], exact: 0},
				{kind: "stateCall", method: "enchantFlyingItem", args: [{item: "Broom", commandWord: "Zoom"}], path: "ok", exact: true},
				{kind: "stateCall", method: "getFlyingItem", path: "item", exact: "Broom"},
				// Riding it is the toggle. Both halves of the grant must appear…
				{kind: "stateCall", method: "activateState", args: ["flyMyPretty"], ignoreResult: true},
				{kind: "stateCall", method: "getSpeed", args: ["fly"], exact: 60},
				{kind: "stateCall", method: "getConditionImmunities", contains: "charmed"},
				{kind: "stateCall", method: "getConditionImmunities", contains: "frightened"},
				// …and disappear again when you dismount. An always-on grant would
				// pass the first half and fail here.
				{kind: "stateCall", method: "deactivateState", args: ["flyMyPretty"], ignoreResult: true},
				{kind: "stateCall", method: "getSpeed", args: ["fly"], exact: 0},
				// RAW: enchanting a new object un-enchants the old one.
				{kind: "stateCall", method: "enchantFlyingItem", args: [{item: "Cauldron"}], path: "replaced", exact: "Broom"},
				{kind: "stateCall", method: "getFlyingItem", path: "item", exact: "Cauldron"},
				{kind: "combatAction", feature: "Fly, My Pretty", interactionMode: "limited"},
			],
		},

		// ── Coven Calling (L18; first checkpoint L20) ────────────────────
		{
			level: 18,
			name: /coven calling/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasCovenCalling", exact: true},
				{kind: "featureCalculation", property: "covenDuplicateCost", exact: 2},
				{kind: "featureCalculation", property: "covenDuplicateCount", exact: 2},
				{kind: "featureCalculation", property: "covenDuplicateMaxSpellLevel", exact: 3},
				{kind: "featureCalculation", property: "covenCallingRecallMinutes", exact: 1},
				// Two duplicates for 2 Sorcery Points off a full 21-point pool. Every
				// probe below is a REAL spend against the production pool, so the
				// running totals are asserted rather than assumed.
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 21},
				{kind: "stateCall", method: "conjureCovenDuplicates", path: "count", exact: 2},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 19},
				{kind: "stateCall", method: "getCovenDuplicates", path: "remaining", exact: 2},
				// Each duplicate's cast spends its spell's level in points…
				{kind: "stateCall", method: "castCovenDuplicateSpell", args: [3], path: "cost", exact: 3},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 16},
				{kind: "stateCall", method: "castCovenDuplicateSpell", args: [1], path: "duplicatesRemaining", exact: 0},
				// …and there are only ever two of them.
				{kind: "stateCall", method: "castCovenDuplicateSpell", args: [1], path: "ok", exact: false},
				{kind: "stateCall", method: "getSorceryPoints", path: "current", exact: 15},
				// The 1st–3rd level ceiling is real.
				{kind: "stateCall", method: "conjureCovenDuplicates", path: "ok", exact: true},
				{kind: "stateCall", method: "castCovenDuplicateSpell", args: [9], path: "ok", exact: false},
				{kind: "stateCall", method: "dismissCovenDuplicates", exact: true},
				{kind: "stateCall", method: "getCovenDuplicates", exact: null},
				// Coven Calling also unlocks Clever Little Witch's recall mode, which
				// was refused at L11/L17 above.
				{kind: "stateCall", method: "useCleverLittleWitch", args: [{spellLevel: 2, recalled: true}], path: "recalled", exact: true},
				{kind: "stateCall", method: "onLongRest", ignoreResult: true},
				{kind: "combatAction", feature: "Coven Calling", interactionMode: "limited"},
			],
		},
	],
});
