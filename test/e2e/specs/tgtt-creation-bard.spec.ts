import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_CREATION_BARD_CHANGELING} from "../utils/characterBuilder";
import {buildSpecialtyChecks} from "../utils/tgttFeaturePools";

/**
 * College of Creation Bard (TCE subclass on the TGTT Bard chassis) — L1→20.
 *
 * Coverage focus — every subclass feature must have an observable
 * MECHANICAL effect, not just a rendered description:
 *
 *   - **Mote of Potential** (L3) — three branching riders on Bardic
 *     Inspiration.  Probed via `moteOfPotentialDc` (= CHA spell save DC,
 *     scales with prof + CHA), `moteAttackDamage` / `moteAbilityCheckBonus`
 *     (= the BI die), and `moteSavingThrowTempHpBonus` (= CHA mod).
 *     Critically: using a mote must NOT spend an extra Bardic Inspiration
 *     die — that's pinned by the Jest unit suite and by the fact that BI
 *     retains its own `resource` rows here.
 *   - **Performance of Creation** (L3) — creates a real inventory item
 *     under a gp/size cap that scales with bard level.  Probed with the
 *     generic `createsInventoryItem` effect: invoke the creator, assert
 *     an item landed under the cap, then dismiss it.
 *     Also carries the "or expend a spell slot of 2nd level or higher"
 *     alternative, pinned by `restoreFeatureUseWithSpellSlot`.
 *   - **Animating Performance** (L6) — summons a scaling Dancing Item
 *     through the GENERIC `COMPANION_TYPES.CLASS_SUMMON` machinery.
 *     Probed with the generic `classSummon` effect (HP = 10 + 5×level,
 *     AC 16, Force-Empowered Slam at the CHA spell-attack bonus for
 *     1d10 + PB force), then dismissed.
 *   - **Creative Crescendo** (L14) — raises the simultaneous item count
 *     to max(2, CHA mod) AND removes the gp cap entirely.  The cap
 *     removal is the easy thing to fake with a description, so it is
 *     asserted explicitly with `isNull: true` (a null sentinel that is
 *     distinguishable from an absent property).
 *
 * Scaling caveat: `createdItemMaxGp` is `20 × bard level`, i.e. it
 * changes at EVERY level.  The matrix re-evaluates every earlier entry
 * at each later checkpoint ([3, 5, 11, 17, 20]), so each tier needs its
 * own row with `untilLevel`.
 */
describeCharacter({
	preset: PRESET_FULL_CREATION_BARD_CHANGELING,
	displayName: "College of Creation Bard",
	// Performance of Creation is the subclass's signature "Use" ability.
	signatureToggle: /performance of creation|mote of potential|animating performance/i,
	signatureToggleNoDerivedEffect:
		"All three Creation features are instant 'Use' abilities (create an item / augment a BI die / summon the Dancing Item), not persistent toggles — "
		+ "their derived effects are asserted directly via featureCalculation, createsInventoryItem and classSummon probes below.",
	// CS-BUG-030: TGTT presets deliberately ship unarmed, so equip a weapon
	// the USE attack probe can actually roll.
	midTierLoadout: [
		{name: "Rapier", equipped: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,
		useResourceName: "Bardic Inspiration",
		expectLongRestRestores: true,
		attackName: /rapier|dagger|crossbow/i,
		skillRoll: {name: "Performance"},
		shortRestRestores: {skip: true}, // blocked by CS-BUG-008 (Bardic Inspiration not restored on short rest)
		concentrationCheck: {castSpell: "Bless", thenAction: "damage", expectActive: false},
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1: {totalLevel: 1, spellSlots: {1: 2}, expectResources: {"Bardic Inspiration": 1}},
		3: {totalLevel: 3, spellSlots: {2: 2}, expectResources: {"Performance of Creation": 1}},
		5: {totalLevel: 5, spellSlots: {3: 2}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, spellSlots: {9: 1}},
	},
	featuresMatrix: [
		// ── Bard base ─────────────────────────────────────────────────
		{
			level: 1,
			name: /bardic inspiration/i,
			kind: "resource",
			resourceMax: [1, 5],
			effects: [
				{kind: "longRestRestores", resource: "Bardic Inspiration"},
				{kind: "bardicInspirationDie", minFaces: 6},
				{kind: "rollInitiative"},
				{kind: "rollSavingThrow", ability: "dex"},
				{kind: "rollSavingThrow", ability: "cha"},
				{kind: "rollAbilityCheck", ability: "cha"},
			],
		},
		// Font of Inspiration (L5+) → BI restores on short OR long rest.
		// Blocked by CS-BUG-008 (short-rest restore not wired).
		{level: 5, name: /bardic inspiration/i, kind: "resource", resourceMax: [1, 5], restoreOn: "short", skip: true, skipReason: "CS-BUG-008"},
		{
			level: 5,
			name: /bardic inspiration/i,
			kind: "passive",
			effects: [{kind: "bardicInspirationDie", minFaces: 8}],
		},
		{
			level: 10,
			name: /bardic inspiration/i,
			kind: "passive",
			effects: [
				{kind: "bardicInspirationDie", minFaces: 10},
				{kind: "shortRestRestores", resource: "Bardic Inspiration", skip: true, skipReason: "CS-BUG-008"},
			],
		},
		{
			level: 15,
			name: /bardic inspiration/i,
			kind: "passive",
			effects: [{kind: "bardicInspirationDie", minFaces: 12}],
		},
		{level: 2, name: /song of rest/i, kind: "passive", skip: true, skipReason: "CS-BUG-017"},
		{level: 3, name: /expertise/i, kind: "passive"},
		{level: 9, name: /expertise/i, kind: "passive"},
		{level: 10, name: /magical secrets/i, kind: "passive"},
		{level: 14, name: /magical secrets/i, kind: "passive"},
		{level: 18, name: /magical secrets/i, kind: "passive"},
		{level: 20, name: /superior inspiration/i, kind: "passive"},

		// ── Mote of Potential (L3) ────────────────────────────────────
		// Three modes ride on the SAME Bardic Inspiration die that was
		// already handed out, so the feature costs nothing extra. What
		// it *does* is entirely numeric, so probe the numbers:
		//   • ability check  → the target also adds the BI die again
		//   • attack roll    → +BI-die thunder damage on the hit
		//   • saving throw   → creatures within 5 ft. gain temp HP
		//     equal to the BI roll + CHA mod (CON save, CHA spell DC)
		{
			level: 3,
			untilLevel: 4,
			name: /mote of potential/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasMoteOfPotential", exact: true},
				// L3-4: BI die is a d6 → all three riders are d6-based.
				{kind: "featureCalculation", property: "moteAttackDamage", exact: "1d6"},
				{kind: "featureCalculation", property: "moteAbilityCheckBonus", exact: "1d6"},
				{kind: "featureCalculation", property: "moteOfPotentialDie", exact: "1d6"},
				{kind: "featureCalculation", property: "moteAttackDamageType", exact: "thunder"},
				{kind: "featureCalculation", property: "moteOfPotentialSave", exact: "con"},
				// Save DC = 8 + prof + CHA mod. Asserted as DERIVED from the
				// live CHA spell save DC rather than a floor, because the
				// wizard's auto-fill doesn't pin ability scores.
				{kind: "featureCalculationDerivedFrom", property: "moteOfPotentialDc", equals: "spellSaveDc", ability: "cha"},
				// Temp-HP rider adds the caster's CHA modifier.
				{kind: "featureCalculationDerivedFrom", property: "moteSavingThrowTempHpBonus", equals: "abilityMod", ability: "cha"},
			],
		},
		// The BI die (and therefore every mote rider) grows with level.
		// One row per tier with `untilLevel` so an earlier row is never
		// re-evaluated against a later, larger die.
		{
			level: 5,
			untilLevel: 9,
			name: /mote of potential/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "moteAttackDamage", exact: "1d8"},
				{kind: "featureCalculation", property: "moteAbilityCheckBonus", exact: "1d8"},
			],
		},
		{
			level: 10,
			untilLevel: 14,
			name: /mote of potential/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "moteAttackDamage", exact: "1d10"},
				{kind: "featureCalculation", property: "moteAbilityCheckBonus", exact: "1d10"},
			],
		},
		{
			level: 15,
			name: /mote of potential/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "moteAttackDamage", exact: "1d12"},
				{kind: "featureCalculation", property: "moteAbilityCheckBonus", exact: "1d12"},
				// DC keeps tracking the live CHA spell save DC as prof grows.
				{kind: "featureCalculationDerivedFrom", property: "moteOfPotentialDc", equals: "spellSaveDc", ability: "cha"},
			],
		},

		// ── Performance of Creation (L3) ──────────────────────────────
		// A once-per-long-rest "Use" ability that puts a REAL item into
		// inventory, under a value cap of 20 × bard level and a size cap
		// that steps Medium → Large (L6) → Huge (L14).
		{
			level: 3,
			untilLevel: 3,
			name: /performance of creation/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasPerformanceOfCreation", exact: true},
				// REGRESSION GUARD: the shared FeatureUsesParser used to
				// read "20 times your bard level" as a use COUNT and
				// hand out 20 uses. It's 1 use per long rest.
				{kind: "longRestRestoresFeatureUses", feature: "Performance of Creation"},
				{kind: "featureCalculation", property: "createdItemMaxGp", exact: 60},
				{kind: "featureCalculation", property: "createdItemMaxSize", exact: "Medium"},
				{kind: "featureCalculation", property: "createdItemMaxCount", exact: 1},
				{kind: "featureCalculation", property: "createdItemDurationHours", min: 2},
				// Actually create the item and verify it lands in
				// inventory under the cap, then clean up.
				{
					kind: "createsInventoryItem",
					method: "createPerformanceOfCreationItem",
					restFirst: "long",
					args: [{name: "Conjured Ladder", valueGp: 25, size: "Medium"}],
					cleanupMethod: "dismissPerformanceOfCreationItems",
					namePattern: "Conjured Ladder",
					maxValueGp: 60,
				},
			],
		},
		{
			level: 5,
			untilLevel: 5,
			name: /performance of creation/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "createdItemMaxGp", exact: 100},
				{kind: "featureCalculation", property: "createdItemMaxSize", exact: "Medium"},
				// "unless you expend a spell slot of 2nd level or
				// higher" — the generic slot-for-a-use exchange.
				{kind: "restoreFeatureUseWithSpellSlot", feature: "Performance of Creation", slotLevel: 2},
			],
		},
		{
			level: 11,
			untilLevel: 11,
			name: /performance of creation/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "createdItemMaxGp", exact: 220},
				// Large from L6.
				{kind: "featureCalculation", property: "createdItemMaxSize", exact: "Large"},
				{kind: "featureCalculation", property: "createdItemMaxCount", exact: 1},
			],
		},

		// ── Animating Performance (L6) ────────────────────────────────
		// Summons a Dancing Item through the generic CLASS_SUMMON
		// companion machinery. HP = 10 + 5 × bard level, AC 16, a
		// Force-Empowered Slam at the CHA spell attack bonus dealing
		// 1d10 + PB force.
		{
			level: 6,
			untilLevel: 11,
			name: /animating performance/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasAnimatingPerformance", exact: true},
				{kind: "featureCalculation", property: "dancingItemAc", exact: 16},
				{kind: "featureCalculation", property: "dancingItemDamageType", exact: "force"},
				{kind: "featureCalculation", property: "dancingItemHp", min: 40},
				{kind: "featureCalculationDerivedFrom", property: "dancingItemAttackBonus", equals: "spellAttackBonus", ability: "cha"},
				{kind: "longRestRestoresFeatureUses", feature: "Animating Performance"},
				{
					kind: "classSummon",
					method: "animateDancingItem",
					restFirst: "long",
					dismissMethod: "dismissDancingItem",
					namePattern: "dancing item",
					ac: 16,
					hpMin: 40,
					attackNamePattern: "force-empowered slam|slam",
					damageContains: "force",
				},
			],
		},
		{
			level: 17,
			name: /animating performance/i,
			kind: "passive",
			effects: [
				// HP = 10 + 5 × 17 = 95 (and 110 at L20 — use a floor so
				// the row survives re-evaluation at the L20 checkpoint).
				{kind: "featureCalculation", property: "dancingItemHp", min: 95},
				{kind: "featureCalculationDerivedFrom", property: "dancingItemAttackBonus", equals: "spellAttackBonus", ability: "cha"},
				{
					kind: "classSummon",
					method: "animateDancingItem",
					restFirst: "long",
					dismissMethod: "dismissDancingItem",
					namePattern: "dancing item",
					ac: 16,
					hpMin: 95,
					attackNamePattern: "force-empowered slam|slam",
					damageContains: "force",
				},
			],
		},

		// ── Creative Crescendo (L14) ──────────────────────────────────
		// Raises the simultaneous item count to max(2, CHA mod) and
		// REMOVES the gp cap entirely. `isNull: true` distinguishes the
		// explicit "no cap" sentinel from a property the calculation
		// simply forgot to emit — the exact failure mode a
		// description-only implementation would produce.
		{
			level: 14,
			name: /creative crescendo/i,
			kind: "passive",
			effects: [
				{kind: "featureCalculation", property: "hasCreativeCrescendo", exact: true},
				{kind: "featureCalculation", property: "createdItemMaxGp", isNull: true},
				{kind: "featureCalculation", property: "createdItemMaxCount", min: 2},
				{kind: "featureCalculation", property: "createdItemMaxSize", exact: "Huge"},
				// With the cap gone, an item well beyond 20 × level gp
				// must now be creatable.
				{
					kind: "createsInventoryItem",
					method: "createPerformanceOfCreationItem",
					restFirst: "long",
					args: [{name: "Crescendo Colossus", valueGp: 5000, size: "Large"}],
					cleanupMethod: "dismissPerformanceOfCreationItems",
					namePattern: "Crescendo Colossus",
				},
			],
		},

		// ── TGTT chassis: Bard Specialties ────────────────────────────
		...buildSpecialtyChecks("Bard"),
	],
});
