# Known Limitations & Shortcomings

This document honestly assesses the current limitations and areas for improvement in the character sheet system.

## Overview

While the character sheet has extensive functionality and test coverage, several areas need additional work. This document catalogs these gaps to help contributors prioritize improvements.

---

## Implementation Status

### Fully Implemented Subclasses ✅

The following classes have **complete** mechanical calculations for all subclasses:

#### Artificer Subclasses ✅
All Artificer subclasses are fully implemented with mechanical calculations:
- **Alchemist**: `experimentalElixirCount`, `alchemicalSavantBonus`, `restorativeReagentsUses`, `restorativeReagentsTempHp`
- **Armorer**: `thunderGauntletsDamage`, `defensiveFieldTempHp`, `lightningLauncherDamage`, `infiltratorSpeedBonus`
- **Artillerist**: `eldritchCannonHp`, `flamethrowerDamage`, `forceBallistaDamage`, `protectorTempHp`, `maxCannons`, `arcaneFirearmDamage`
- **Battle Smith**: `steelDefenderHp`, `arcaneJoltDamage`, `arcaneJoltUses`, `deflectAttackDamage`

#### Druid Circles ✅
All Druid circles are fully implemented:
- **Moon**: `combatWildShape`, `moonFormsCr`, `wildShapeHealPerSlotLevel`, `primalStrike`
- **Land**: `naturalRecoverySlots`
- **Dreams**: `balmOfSummerCourtDice`, `balmOfSummerCourtPool`, `hiddenPathsUses`
- **Shepherd**: `spiritTotemHp`, `mightySwarmHealingBonus`
- **Spores**: `haloOfSporesDamage`, `symbioticEntityTempHp`, `fungalInfestationUses`
- **Stars**: `starryFormUses`, `cosmicOmenUses`, `archerFormDamage`, `chaliceFormHealing`
- **Wildfire**: `wildfireSpiritHp`, `cauterizingFlamesUses`, `blazingRevivalHp`
- **Sea (XPHB 2024)**: Wrath of the Sea is a real Wild-Shape-fuelled Emanation —
  a `wrathOfTheSea` active state costing 1 use (2 to cover both the druid and an
  ally), whose Ocean Spray bonus-action trigger resolves a Constitution save
  against the druid's own spell save DC for `max(1, WIS mod)`d6 Cold damage and a
  15-foot push of a Large-or-smaller target. Aquatic Affinity emits a computed
  swim speed equal to the walking speed and widens the Emanation from 5 ft to
  10 ft. Stormborn (`hasSeaStormborn`, deliberately NOT the Tempest Cleric's
  `hasStormborn`) attaches Cold/Lightning/Thunder resistance and a fly speed
  equal to the walking speed **to the active state**, so both vanish the moment
  the Emanation ends. Oceanic Gift adds the `self` / `ally` / `both` placement
  prompt at activation; an ally placement keeps the druid's DC and dice but
  moves Stormborn's benefits off the druid.
  *Deliberate scope limit*: the sheet models one character, so an ally-placed
  Emanation cannot show the resistances and fly speed on the ally — it correctly
  withholds them from the druid, and the placement plus its Wild Shape cost are
  observable through `getWrathOfTheSeaAction(placement)`.

#### Cleric Domains ✅
All 14 Cleric domains are fully implemented:
- **Life**: `discipleOfLifeBonus`, `preserveLifeHealing`, `blessedHealerBonus`, `divineStrikeDamage`
- **Light (PHB/XPHB edition-aware)**: PHB progression remains unchanged. XPHB
  starts at Cleric 3, grants its ten always-prepared domain spells at levels
  3/5/7/9, and mechanically supports Radiance of the Dawn through the shared
  Channel Divinity pool, Warding Flare as a Wisdom-sized reaction pool,
  Improved Warding Flare short-rest recovery and temporary HP, and Corona of
  Light activation plus Fire/Radiant enemy-save disadvantage.
- **War**: `warPriestUses`, `guidedStrikeBonus`, `avatarOfBattleResistance`
- **Knowledge**: `visionOfThePastUses`
- **Nature**: `dampenElementsUses`, `divineStrikeDamage`

#### Wizard Traditions ✅
- **School of Necromancy (PHB, L2 / XPHB L3)**: Necromancy Savant halves the
  spellbook scribe cost for Necromancy spells (surfaced as a toast with a
  working "Pay N gp" button); Grim Harvest is an activatable ability that
  prompts for slot level + school and actually restores HP; Undead Thralls
  grants *animate dead* into the spellbook, adds one extra target to the raise,
  and buffs every created undead companion (+wizard level HP, +proficiency
  bonus weapon damage); Inured to Undeath applies necrotic resistance **and**
  real immunity to hit-point-maximum reduction; Command Undead surfaces the
  live CHA save DC at 60 ft.
  *Deliberate scope limit*: Grim Harvest's "once per turn" cap is not enforced
  — the sheet has no combat tracker with enemy hit points, so there is no
  reliable "you killed a creature" signal to hang a lockout on. It is a manual
  Use action, matching how every other kill-triggered feature is handled.
- **Daemonologist (Grim Hollow Player's Guide 2024)**: Persists and gates the
  Arch Daemon/Arch Seraph path across Builder, Level-Up, and Quick Build;
  grants its path-specific spells; supports Wizard-owned Eldritch Invocation
  picks at levels 3, 6, and 14 with Intelligence casting; and implements
  Borrowed Tongues and Hides, Unearthly Countenance, and Eternal War Eruption
  through the shared resource, active-state, spell-slot, and optional-feature
  systems.
- **Tempest**: WIS-based Wrath reaction pool with per-use damage choice, deferred Destructive
  Wrath maximization using Channel Divinity, Thunderbolt Strike forced-movement results,
  `divineStrikeDamage`, martial/heavy proficiencies, and Stormborn fly speed
- **Trickery**: `invokeDeplicityUses`, `divineStrikeDamage`
- **Forge**: `blessingOfTheForgeBonusAc`, `soulOfTheForgeResistances`, `divineStrikeDamage`
- **Grave**: `sentinelAtDeathsDoorUses`, `eyesOfTheGraveUses`, `potentSpellcastingBonus`
- **Twilight**: `eyesOfNightDarkvisionBonus`, `twilightSanctuaryTempHp`, `stepsOfNightUses`
- **Peace**: `emboldingBondRange`, `protectiveBondRange`, `balm`
- **Order**: `voiceOfAuthorityDamage`, `ordersWrath`, `divineStrikeDamage`
- **Death**: `reaper`, `deathTouchDamage`, `divineStrikeDamage`
- **Arcana**: `arcaneAburationUses`, `potentSpellcastingBonus`

#### Bard Colleges ✅
All Bard colleges are fully implemented:
- **Lore**: `cuttingWordsDie`, `additionalMagicalSecretsCount`, `peerlessSkillDie`
- **Valor**: `combatInspirationDie`, `attacksPerAction`, `hasBattleMagic`
- **Glamour**: `mantleOfInspirationTempHp`, `enthrallingPerformanceDc`, `mantleOfMajestyDc`
- **Swords**: `bladeFlourish` (with die, AC bonus, damage), `hasMastersFlourish`
- **Whispers**: `psychicBladesDamage`, `wordsOfTerrorDc`, `shadowLoreDc`
- **Creation**: `moteOfPotentialDie`, `createdItemMaxGp`, `dancingItemHp`
- **Eloquence**: `silverTongueMinimum`, `unsettlingWordsDie`, `infectiousInspirationUses`
- **Spirits**: `spiritTaleDie`, `spiritSessionMaxSpellLevel`, `spiritualFocusBonus`
- **Dance**: `danceUnarmoredDefense`, `leadingEvasionDie`, `irresistibleDanceDamage`

#### Ranger Conclaves ✅
All Ranger subclasses are fully implemented:
- **Beast Master**: `companionProfBonus`, `companionAttacks`, `hasShareSpells`
- **Hunter**: `colossusSlayerDamage`, `multiattackDefenseBonus`, `hasSuperiorHuntersDefense` — Hunter's Prey is option-gated (Colossus Slayer / Horde Breaker / Giant Killer) and surfaces as an interactive weapon-damage rider in combat (TGTT). TGTT Primal Focus (Predator/Prey modes + upgrades) and the level 1–20 TGTT Ranger feature line (Tireless, Enduring Traveler, Unrivaled Pioneer, Penetrating Senses, Apex Sentinel, Battle Instincts, Apex Focus, …) are mechanically wired and displayed via a dedicated overview Ranger panel.
  - **Limitation — Hunter's Prey is swapped from the rest flow only.** `setHuntersPreyOption` has exactly one caller, in `charactersheet-rest.js`, so the option can be changed during a Short or Long Rest but not from the overview Ranger panel, which is read-only for that choice. The panel copy points at the rest dialog. An in-panel selector is a logged follow-up.
- **Gloom Stalker**: `dreadAmbusherInitiativeBonus`, `umbralSightDarkvisionBonus`, `hasShadowyDodge`
- **Horizon Walker**: `planarWarriorDamage`, `distantStrikeTeleportRange`, `hasSpectralDefense`
- **Monster Slayer**: `huntersSenseUses`, `slayersPreyDamage`, `supernaturalDefenseBonus`
- **Fey Wanderer**: `dreadfulStrikesDamage`, `otherworldlyGlamourBonus`, `mistyWandererUses`
- **Swarmkeeper**: `gatheredSwarmDamage`, `writhingTideFlySpeed`, `swarmingDispersalUses`
- **Drakewarden**: `drakeProfBonus`, `drakesBreathDamage`, `drakesBreathDc`

#### Talent (TalPsi) — all seven Psionic Specializations ✅

- The whole base class is supported: the class table (manifestation die, max
  power order, both power-pool sizes, strain maximum, power save DC / attack
  bonus), Psionic Exertion, Psychic Boost, Psionic Bastion, Shielded Mind and
  Ignore Strain.
- **Psionic strain is a real subsystem**, not a display. All twelve threshold
  penalties are applied by the same getters every other mechanic uses — AC,
  speed, hit point maximum, skill proficiency, save proficiency, the advantage
  funnel, death saves and supernatural healing. See
  [17-talent-psionics.md](17-talent-psionics.md).
- Strain refuses to exceed the maximum; the RAW "manifest and die / decline and
  drop to 0 hp" choice is a real API (`resolveStrainOverflow`).
- Every Talent choice — 1st-order powers, higher-order powers and Psionic
  Exertions — is surfaced in Builder, Level-Up and Quick Build through
  **generic** engines (`deriveOptionalFeatureProgressions` and the
  `PSIONIC_MANIFESTERS` republishing layer), with no per-class picker UI.
- Psionic powers and any feature whose text charges strain are activatable
  through a generic detector, so Chronopath's Decay, Time Pocket and Fickle
  Readiness are Use-button actions rather than paragraphs.
- **All seven specializations** — Chronopath, Maverick, Metamorph, Pyrokinetic,
  Resopath, Telekinetic, Telepath — have real feature calculations at 2/6/10/14.
  The six shared "Adept" features are one generic mechanism keyed by the
  `_psionicPowerType` discipline code, not six copies.
- Three specialization toggles (`psionicToughness`, `flameOn`,
  `manipulateTerrain`) go through `ACTIVE_STATE_TYPES`, documented in
  [08-toggle-abilities.md](08-toggle-abilities.md).
- **Powers are first-class entities.** A dedicated `🧠 Powers` tab carries the
  manifesting stats, the strain tracker, running manifestations and the powers
  list grouped by order. Each power's manifestation time, range and duration are
  parsed out of its prose, and its `modes[]` are classified into order bands,
  character-level scaling bands, the `Increased Order` upcast rule and variant
  effects.
- **Increased order is supported**, with a live-updating order stepper in the
  manifest dialog.
- **Concentration is a list, not a slot.** A manifester holds up to their
  proficiency bonus in powers, never a power and a spell together, and the
  manifestation score is derived from that automatically instead of being typed
  in by the player.
- **Psionic Exertions apply.** At-manifestation options are offered in the
  dialog; outcome-triggered ones are an **Exert** button on the running
  manifestation. One per manifestation, per RAW.
- **Strain to Maintain** derives its cost from the powers actually running.
- Powers reach play mode and the favourites bar, and per-level replacement plus
  a lightweight learning-from-others tracker are supported.

**Honestly out of scope for the Talent:**

- **Per-power effects.** The 103 psionic powers are pickable, order-gated,
  manifestable and fully described — their metadata is parsed and the mode that
  applies at the character's level is the one shown — but each power's
  individual damage roll and save rider are still rendered from its source text
  rather than modelled as calculations. This is the same treatment spells get:
  the sheet resolves the *cost*, the *save DC* and the *attack bonus*, and the
  player reads the effect. Modelling 103 bespoke powers is a separate body of
  work from supporting the class.
- **Splitting one manifestation's strain across several tracks.** Strain is paid
  from a single chosen track per manifestation. RAW permits a split; the tracks
  and their penalties are fully modelled, so this is an input affordance rather
  than a missing subsystem.
- **The multi-day learning period is a counter, not a calendar.** "Learning from
  Others" tracks the roll, the required days and the days logged, but the sheet
  has no clock, so advancing a day is a button rather than something a long rest
  infers.
- **Encounter-side clauses.** Resopath's terrain shaping and Telepath's
  telepathy-range features change what *other* creatures may do. As with every
  such feature on the sheet, the self-facing half is mechanical and the
  opponent-facing half is a rules note. See the "one creature" section below.

#### Blood Hunter (BH2022) and Order of the Lycan ✅
- Hunter's Bane records the Intelligence/Wisdom Hemocraft choice through the generic multi-attribute `abilityDc` feature-option path. Blood Curse, Crimson Rite, and Fighting Style selections use the generic optional-feature progression shared by Builder, Level-Up, and Quick Build.
- Blood Maledict, Brand of Castigation, and Hybrid Transformation have synchronized rest resources. Amplification and Crimson Rite activation pay their Hemocraft Die HP costs.
- Hybrid Transformation changes AC, Strength rolls, qualified defenses, attacks, damage, speed/jumps, regeneration, and Bloodlust saves; its level 18 mastery is unlimited and grants Blood Curse of the Howl.
- Sanguine Mastery rerolls automated Hemocraft costs or Crimson Rite damage once per combat round and keeps the player-favorable result; qualifying Crimson Rite criticals restore and persist one Blood Maledict use.
- The sheet has no enemy stat model, so target-side Blood Curse debuffs are resolved from the surfaced curse text and Hemocraft save DC rather than persisted on an enemy record.

#### Monk: Way of the Astral Self (TCE) ✅
- Arms, Visage, Body, and Awakened are mechanically complete active states with
  shared Ki/Focus spending, prerequisites, cascading teardown, duration, and
  incapacitation/0-HP expiry.
- Astral Arms is a feature-owned force attack using the best permitted
  Strength, Dexterity, or Wisdom modifier and the current Martial Arts die. Its
  reach is increased by 5 feet only on the Monk's turn.
- Astral Sight, Wisdom of the Spirit, both Word of the Spirit modes, Deflect
  Energy, Empowered Arms, Armor of the Spirit, and Astral Barrage are wired to
  senses, roll modes, trigger controls, damage riders, AC, reaction tracking,
  and Attack-action qualification.
- The former `2d10` Awakened bonus-damage calculation was removed because no
  such damage exists in the TCE feature.

#### Barbarian: Path of the Juggernaut (TDCSR) ✅

- Thunderous Blows resolves push use, distance, direction, and Huge+ Strength
  saves in the melee-hit damage flow; its range scales from 5 to 10 feet.
- Demolishing Might applies crit-compatible construct damage and doubles the
  final damage total against objects and structures.
- Resolute Stance is a tracked start-of-turn state with Grappled immunity and
  both outgoing weapon-attack and incoming-attack disadvantage.
- Hurricane Strike spends the Juggernaut's reaction, resolves its Prone save,
  and surfaces the ally reaction attack opportunity after a qualifying push.
- Spirit of the Mountain and Unstoppable augment canonical Rage with
  non-destructive condition suppression, forced-movement protection, and
  speed-reduction immunity.

---

## Remaining Implementation Gaps

### Classes with Partial Subclass Support

All core classes (Artificer, Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard) now have **comprehensive mechanical calculations** for their subclasses.

The following edge cases may need additional work:

| Class | Note |
|-------|------|
| **Monk** | Some XPHB 2024-specific subclasses may need verification |
| **Sorcerer** | Advanced metamagic effects are still partial; cast-time selection and costs are supported, and runtime support now covers `quickened`, `subtle`, `bestowed`, `heightened`, `seeking`, `focused`, `lingering`, `aimed`, `overcharged`, and `vampiric` |
| **Warlock** | Pact Boon interactions with invocations not tracked |

### Blood Hunter (BH2022) — effects that resolve on *other* creatures

The Blood Hunter's brands and blood curses are unusual among class features in
that most of what they do happens to a creature that is not the character. A
single-character sheet has no model of the target, so these are surfaced
honestly — with their save ability, DC and rider — rather than silently
dropped or faked.

| Feature | What the sheet does | What the DM still resolves |
|---|---|---|
| **Brand of Castigation / Tethering / Axiom / Sapping Scar** | Tracks the use, tracks *that* a creature is branded via the shared `brandedTarget` state, and states each rider's real damage and DC on that state | The retaliation damage, the forced revert, the teleport denial, and the saving-throw disadvantage all land on the target |
| **Brand of Sundering** (Ghostslayer 11) | **Half fully modelled:** the additional hemocraft die rides the character's crimson rite damage for real (`2dN`), including on rites already lit | Only the Incorporeal Movement denial, which lands on the target |
| **Brand of the Voracious** (Lycan 15) | Fully modelled — its advantage lands on the *character*, so it is gated on `brandedTarget` and applies for real | — |
| **Blood curses** | Surfaces each curse's own action cost, save ability, DC, base effect and amplified rider at the moment of invocation; charges the amplification HP cost for real | The target's saving throw and resulting condition |
| **Blood Curse of the Eyeless / Fallen Puppet** | Surfaces the reaction timing and the hemocraft die to subtract | The affected creature's attack roll |

Target-side riders are surfaced as `info` effects **on the `brandedTarget`
state**, via its `effectsBuilder`, not in `FeatureEffectRegistry`. That is not a
stylistic choice: registry `info` effects are aggregated and then rendered
nowhere, whereas state `info` effects appear in the active-states tooltip. A
rider registered in the registry would look declared and be invisible — the
exact defect CS-BUG-125 and CS-BUG-150 were filed for.

The amplification cost is *not* in this category and is fully modelled: it is
unavoidable necrotic damage to the Blood Hunter, and `useBloodMaledict({amplify: true})`
reduces current HP by a real hemocraft die roll.

**The Onus of Lycanthropy** (Lycan 3) is deliberately registered as an `info`
effect rather than a mechanical one. Its content — that you cannot spread the
curse unwillingly, that being cured against your will is a mark of shame undone
by a renewed Taming, and that your beast-strain sets your hybrid form's
appearance — is narrative and DM-facing, with no derived number to compute.

**Caveat, disclosed rather than buried:** that entry sits in
`FeatureEffectRegistry`, and registry `info` effects are currently rendered
nowhere. So the Onus is *recorded* but not *shown*. It is the least costly
instance of the pattern — purely narrative text with no number — which is why it
is noted here rather than filed as a bug, but it is the same gap that made
CS-BUG-150 invisible. Rendering registry `info` effects would fix both at once,
and is the right general fix if that surface is ever built.

### Anti-Pattern in Tests (Mostly Resolved)
Previous tests used weak verification patterns. These have been largely corrected:

```javascript
// PROBLEMATIC: This always passes regardless of implementation
it("should have feature at level 3", () => {
    state.addClass({name: "Artificer", level: 3, subclass: {name: "Alchemist"}});
    expect(state.getTotalLevel()).toBe(3);  // Tests nothing!
});

// CORRECT: Tests actual mechanical calculation
it("should produce 2 elixirs at level 6", () => {
    state.addClass({name: "Artificer", level: 6, subclass: {name: "Alchemist"}});
    const calc = state.getFeatureCalculations();
    expect(calc.experimentalElixirCount).toBe(2);
});
```

---

## Missing Features

### Core Functionality

| Feature | Status | Notes |
|---------|--------|-------|
| **Multiclass spell slots UI** | Partial | Calculation exists, UI incomplete |
| **Ritual casting** | ✅ Implemented | Full system: class-specific modes (spellbook/prepared/known), filter + cast-as-ritual UI |
| **Optional class features** | Partial | Not all TCE optional features supported |
| **Custom lineages** | Missing | Tasha's custom lineage not fully supported |
| **Sidekick classes** | Missing | Warrior/Expert/Spellcaster sidekick classes |
| **Epic Boon picker** | ✅ Implemented | XPHB level 19 Epic Boon section with ability score max 30 |

### Item Upgrades & Gemstones

| Feature | Status | Notes |
|---------|--------|-------|
| **Upgrade picker/application** | ✅ Implemented | Browse, prerequisite check, gold deduction |
| **Gemstone empowerment** | ✅ Implemented | Crafting roll modal with DC/bonus |
| **Gemstone socketing** | ✅ Implemented | Socket/unsocket, 1-per-item limit |
| **Charge tracking** | ✅ Implemented | Use/restore, dawn recharge on long rest |
| **Upgrade badges on items** | ✅ Implemented | Tags and gem names shown on item rows |
| **Combat stat integration** | Partial | `getEffectiveItemBonuses()` exists but not yet wired into combat attack/damage display |
| **Armor upgrade effects** | Partial | State tracked; AC/stealth effects not auto-applied |

### Combat Features

| Feature | Status | Notes |
|---------|--------|-------|
| **Cover bonuses** | Missing | No tracking for half/three-quarters cover |
| **Flanking** | Missing | Optional rule not implemented |
| **Multi-target attacks** | ✅ Implemented | Whirlpool Strike multi-target modal (`_showWhirlpoolStrikeModal`) with creature count → per-hit damage. Generic AoE distribution not yet supported for other features. |
| **Reaction tracking** | ✅ Implemented | Shared per-turn action economy enforces reaction costs for active-state triggers such as Deflect Energy and Sun Shield |
| **Damage transfer to self** | ✅ Implemented | `state.useDivineAllegiance(damage)` + `takeDamage(dmg, {unpreventable: true})`. Powers Crown Paladin's Divine Allegiance; reusable by any "you take the damage instead" feature. |
| **Zero-HP interventions** | ✅ Implemented | Declarative `ZERO_HP_INTERVENTIONS` registry on `takeDamage()`: Death Ward plus Strength of the Grave (CHA save DC 5 + damage, not vs radiant or a crit, use spent only on success). Add a registry entry rather than a new branch. Note CS-BUG-081 — the sheet's Damage button now routes through `takeDamage()`, so these actually fire from the UI. |
| **Ally-facing aura riders** | Partial | Self-facing aura effects apply; effects the character grants to *other* creatures (e.g. Exalted Champion's "allies within 30 ft have advantage on death saves and Wisdom saves against your Channel Divinity") are descriptive only — the sheet models one character, so there is no ally to apply them to. |
| **Conditions imposed on enemies** | By design | Same root cause as the row above. A feature that blinds, frightens, or restrains a *target* — Child of the Sun Bloodline's Glimpse of the Sun flare, for instance — resolves as a toast plus a roll-history entry naming the target and the DC. The sheet tracks the PC's own conditions only, so the outcome is honour-system at the table. The flare's save DC, range, duration, and target count are all computed and shown; only the enemy's condition is untracked. |
| **Prerequisites the sheet cannot observe** | By design | Where a feature requires an ongoing effect the sheet has no way to observe — Glimpse of the Sun needs an ongoing *Light* cantrip, which is a spell with no tracked instance — the requirement is shown as a reminder in the prompt and never enforced. **Fail-soft is deliberate**: a hard gate on an unobservable condition blocks legal play, which is worse than trusting the player. |

### Resource Management

| Feature | Status | Notes |
|---------|--------|-------|
| **Font of Magic** | ✅ Implemented | SP ↔ slot conversion with 2014/2024 rules. Pool size has one source of truth, `CharacterSheetState.getSorceryPointsMaxForClass()` (CS-BUG-080/084); `_ensureSorceryPoints()` is create-only so it never fights `setSorceryPoints()` or TGTT metamagic tuning. |
| **Mystic Arcanum** | ✅ Implemented | Per-level usage tracking, long rest recovery |
| **Natural Recovery** | ✅ Implemented | Land Druid slot recovery (mirrors Arcane Recovery) |
| **Concentration saves** | ✅ Implemented | DC calc, bonus aggregation, advantage detection |
| **Sorcerous Restoration** | ✅ Implemented | SP recovery on short rest at level 20 |
| **Combat round tracking** | ✅ Implemented | Start/end combat, round counter, auto-expire states |
| **Dawn/dusk recharge** | Partial | Items recharge; gemstones recharge at dawn on long rest |
| **Per-encounter resources** | Missing | No concept of encounter-based recovery |
| **Lair/Legendary actions** | Missing | Not applicable to PCs, but could be useful |

---

## 2024 PHB (XPHB) Coverage Gaps

The 2024 revision introduced significant changes. Current coverage:

### Implemented

- ✅ Weapon Mastery slots and tracking
- ✅ Weapon Mastery property effects (all 8: Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex)
- ✅ Weapon Mastery for all XPHB classes (Fighter, Barbarian, Rogue, Monk, Paladin, Ranger)
- ✅ Updated class features (most)
- ✅ New subclasses
- ✅ Updated spell slot progression
- ✅ Revised ability score improvements
- ✅ Fighter XPHB Weapon Mastery slots + Tactical Master swap
- ✅ Fighter XPHB Battle Master maneuver picks/swaps, scalable Superiority Dice pool, per-use STR/DEX DCs, maneuver Use controls, Know Your Enemy, and Relentless
- ✅ Fighter XPHB Champion: Improved/Superior Critical (weapon/Unarmed Strike-scoped 19-20 → 18-20, never spell attacks), Remarkable Athlete (L3 Initiative + Athletics advantage, post-crit half-Speed move affordance), Additional Fighting Style (L7 second Fighting Style feat pick via the shared subclass `featProgression` pipeline), Heroic Warrior (L10 turn-start Heroic Inspiration grant), Survivor (L18 Defy Death death-save advantage + 18-20 nat-20 range, Heroic Rally turn-start healing while Bloodied) — all via the generic `getTurnStartEffects()`/`applyTurnStartEffects()` turn-start resolver
- ✅ Active state mutual exclusivity (Rage/Bladesong)
- ✅ Rage breaks concentration on activation
- ✅ Active state duration tracking with round counter + auto-expire
- ✅ Epic Boon picker at level 19 with ability score max 30 override

### Partially Implemented

- ⚠️ Species (formerly races) - structure supported, not all species complete
- ⚠️ Background updates - 2024 backgrounds need work
- ⚠️ Updated feats - some 2024 feats missing

### Not Implemented

- ❌ Crafting rules
- ❌ Updated tool proficiencies
- ❌ Revised conditions (exhaustion changes)
- ❌ Bastions (new subsystem)

---

## NPC Export

Full upgrade pass landed (attack polish, spell DC/innate/pact, Multiattack, AC `from`, hit-die HP, staged CR, optional legendary, dialog options/feature picker/Copy JSON), plus a correctness-and-prose pass driven by running the exporter against complete real saves: third-person bestiary voice, conditional defenses annotated rather than stated flatly, uses printed on ability names, feats/magic-item entries as real action economy, and opt-in Level Signal. A subsequent **fidelity pass** made every number effective rather than canonical (saves, skills, initiative), added homebrew and non-proficient skills, replaced feature truncation with structure-aware section splitting, put conditional damage riders on attacks, made stances first-class active effects, guaranteed every toggle annotation has a defining ability, attributed feature-granted spells inline, gave swappable subclass spell lists their own block, and turned feature-conjured weapons into real attacks. See [18-npc-export.md](./18-npc-export.md). An **attribution and compaction pass** then credited each folded defence to the feature that grants it (hoverable where a real tag exists) and stripped the now-duplicated sentence, exported every mode of a form-gated defence rather than only the active one, unified the two divergent activation classifiers so item-granted reactions file as reactions, stopped suppressing features whose only effect is advantage (Reckless Attack, Danger Sense, Brutal Strike), added a compaction pass that removes recharge restatements, leading flavour, repeated boilerplate and build-time spellcasting bookkeeping, promoted inline option menus to bold sub-labels, and made caster CR spell-aware via an optional `spellIndex`. A **correctness, grammar and verbosity pass** (v7), driven by four newly added saves (multiclass casters, paladin auras, cleric channel divinity, wild shape), then replaced substring name matching with token-subset matching — one bug that had put barbarian resistance on a Paladin and Rage's uses on two passives — derived spellcasting ability from the caster class instead of an `int` fallback that exported DC 12 for a level-13 Bard, pointed Multiattack at the highest-damage attack, validated every emitted damage type and condition against the schema enums, collapsed level-progression tables to the row that applies, made compaction clause-level and paren-aware, split multi-benefit feats by action economy (including moving a feat's standing benefits out of its activation section), and dropped the remaining restatement: the build-rules `Spellcasting` trait, form-change boilerplate, and resource pools naming spells the spellcasting block already prints. An **inference, consolidation and item-fidelity pass** (v8) then stopped gating Special Equipment on `equipped` (a Driftglobe, Pearl of Power and Javelin of Lightning were silently dropped from every export), made an item's trait its benefit rather than its shared item-class lore and suppressed it entirely when the only benefit is an ability increase already folded in, dropped numeric restatements after verifying the value matches what was folded onto the block, moved Divine Strike and Improved Divine Smite onto the attack line with the character's own text outranking a conflicting derived `divineStrikeType`, merged scattered single-clause standing defences into one attributed `Resilience` trait, gave the high-traffic feats terse statblock templates, kept a `{@b Label.}` welded to the body it introduces, printed stance bodies exactly once, named the equipped weapon an item ability applies to, built Divine Favor from the homebrew tier catalog instead of scavenging garbled residual modifiers, consolidated Wild Shape's five scattered entries into one ability with its formulas resolved to numbers, and required a check context before tagging a common noun such as "nature" as a skill. A **new-class coverage, resolved-numbers and statblock-discipline pass** (v9), driven by four further saves (blood hunter, monk, battle master, champion), stopped a target-facing conditional ("the creature is immune to this curse if it is immune to the blinded condition") from becoming the NPC's own condition immunity, made active-state name matching one-directional so a level-13 Champion no longer inherits a level-18 resistance, added the ability modifier back to every feature-derived attack (a monk's Unarmed Strike had exported as a bare `1d10`), minted real attack entries for features that grant an attack option, resolved every scaling die and class-level reference, required an explicit third-party subject before injecting a save DC — and injected one wherever a forced save lacked it, consolidated maneuvers into a single roster, folded use-count improvements and hybrid-form riders into their parents, suppressed item rules written about the object rather than its bearer, normalized gendered pronouns and legacy resource names, title-cased lower-case spell tags, named a home-less resource pool after itself instead of a generic `Class Resources` row, and taught the CR heuristic to count per-hit damage riders and Bonus Action attack routines. A **runnability pass** (v10) then put the number the DM needs in the sentence and a hover on the term. A **resolved-numbers, honest-tags and one-home-per-feature pass** (v11), driven by five further saves (Aldor, Boti, Fili, Nessa, Tikal), stopped an ability modifier going unresolved whenever a `(minimum …)` clause followed it, refused to emit a homebrew tag with no source or a spell tag fabricated from a sentence fragment, resolved level-gated upgrades to the level actually exported and dropped the build-time scaffolding around them (level labels, option menus for choices already made, flattened progression tables), carried supersession and improvement riders *across* entries so `Improved X` folds into `X` and "the damage of Y increases to 1d8" edits Y rather than contradicting it, collapsed Jack of All Trades' 25 skill rows into one line, replaced six loose metamagic traits with a roster that groups Active, Passive and currently-tuned options and states each one's cost and affected spells, refiled entries under the economy their own text names, dropped item entries that are appearance text or dead-end stubs, inverted the prose trim so only positively identified description is cut, let a monk's Unarmed Strike win Multiattack when it out-damages every weapon carried, and closed the remaining agreement gaps (adverb-separated coordinate verbs, already-inflected verbs, singular "or dies", leftover imperatives). A **level-20, psionics and item-bank pass** (v12), driven by five further saves (Arthur, Juen, Mikase, Octavius, Phirse — all level 20, one of them a psionic class with no spellcasting at all), then read `modes[]` so seven psionic powers stopped exporting as bare Manifestation Time/Range/Duration headers and gave every power a compact home with its strain cost on the name and the power save DC on every save it forces, replaced a 28KB class-rules dump with a six-value `Psionics` trait, resolved level-scaled feature dice from the sheet so a level-20 rogue's Sneak Attack reads 10d6 rather than the book's 1d6, exported item powers from homebrew items typed as weapons (a nine-stone Ioun bank that had produced nothing) and grouped stones under one Special Equipment heading while suppressing stat-only stones entirely, dropped item entries that merely restate a resistance already on the block once the inherent "while wearing it" gate is stripped, stopped attributing a spell to a feature that only mentions it and dropped `5e `-prefixed edition duplicates, folded once-per-turn Sneak Attack, base Divine Smite and psionic damage into the CR estimate so non-martial level-20 builds stopped landing three to eight CR below a level-17 barbarian, split any entry paragraph over ~620 characters at a sentence boundary, restored the antecedent when a trim left an entry opening on "To do so", and repaired the doubled words and padded thousands separators that subject substitution creates. A **rollable-numbers, grammar and honest-filing pass** (v13), driven by a full re-audit of all twenty-one saves, then tagged the 42 bare dice that had been rendering as inert prose across eighteen of them so every `NdX` rolls from the block, resolved the class-level formulas that never substituted (`half its Wizard level (round up)`, `equal to its level + its Charisma modifier`) and dropped a maximum-level cap the resolved value already clears, restated a summed formula so it leads with its answer rather than appending the total to the last operand — `its AC equals 18 (13 plus its Wisdom modifier)`, which had been asserting a Wisdom modifier of +18 — refiled entries on the economy stated anywhere in their body while explicitly excluding "take a Bonus Action" from the action branch, demoted economy-less feat and item entries out of Bonus Actions and Reactions, stripped an item entry's leading self-name echo while promoting the tag to the entry heading so the hover survives, replaced the generic roster condenser for stance bodies with mechanical-sentence selection (six of thirteen corpus stances had been printing only flavour) and stated the shared stance duration once in a block header, repaired the grammar that subject substitution leaves behind (coordinated verbs, plural subjects read through a closing tag brace, `it can use it to X`, and a surname deleted by the doubled-word collapse), and dropped a duplicated Fey Ancestry sleep clause and three entries opening on a dangling `In addition,`. A **one-printing-per-spell, honest-tags and readable-voice pass** (v14), driven by three further saves (Elizabeth, Missy, Nagara) and a re-audit of all twenty-four, then deduped spells by name within their level rather than by `name|source` so eight characters stopped printing the same spell twice on one line where a class list and a subclass grant carried different editions, remapped or stripped every tag whose kind contradicts its referent (`{@condition Dash}`, `{@action Bonus Action}`, and the `surprised`/`concentration` pair that 5etools files as `{@status}` rather than conditions), required an exact catalogue match before emitting `{@spell}` after a capitalisation heuristic invented `{@spell Magic of the}` out of the Staff of Power's prose, collapsed scaling ladders to the row that applies instead of substituting the character's value into the ladder's own condition ("the damage increases to 2d6 when its proficiency bonus (+5) is +3"), propagated a conditional feature's gate to every defence it grants and restored a resistance that had been dropped outright, carried tables through as tables after Font of Magic exported as a bare header row with its sorcery-point costs missing entirely, turned a stated die count into a roll (`a number of d8s equal to its Wisdom modifier (5)` → `{@damage 5d8}`) and resolved derived speeds to distances, generalised verb conjugation to coordinated lists of any length and supplied the subject a subordinate clause drops ("If it hits, add the Superiority Die" → "it adds") while refusing to fire under a governing modal or inside a comma-separated noun list, tagged every bare DC and every coordinated action list, and used the character's short name in the body so a surname stops repeating up to 49 times in one block. An **information-placement pass** (v15) then routed every rider onto the line it modifies rather than a trait three screens away: a reference graph identifies anchor features that other entries key off (Sneak Attack, Rage, Focus Points and eleven more, present in fourteen of twenty-four characters) so a rider may compress its source but never orphan its dependents, dice-valued riders reach the attack line scoped to the weapons that can carry them (Missy's Ninjato gains Sneak Attack, her Claws do not), item `damageRiders`/`conditionalBonuses` and on-hit damage stated only in item prose are exported at all for the first time (a Sun Staff's 1d8 fire, a Silver Dragon Katana's 1d4 cold, a Sun Blade's 1d8 against Undead and a Fang of the Whale Eater's cold had all been silently dropped), Charger's bonus-action-only +5 stopped advertising itself as `plus 5 damage after Dash + bonus action attack` on a base weapon line it can never apply to, a rider now shrinks its source to the residue clause-by-clause while a decapitated residue retires the entry instead, an `Additional Effects` bullet whose bonus is provably inside a printed number is suppressed via the fighting style's unconditional twin, a number whose *only* source is a conditional modifier carries its gate on the number itself (`AC 15, or 14 when not dual wielding`), and Wild Shape's boolean config columns render as prose rather than the sheet's form-field labels. A **placement-and-lore follow-on** to the same pass then dropped subclass lore that states no mechanic (Elizabeth's 2,853 characters of elven school history, matched by a ratio test because two flavour sentences read as mechanical to an absolute one), split a form block into an activation and an alternate-form trait so Dzeiy's 2,531-character Hybrid Transformation stopped describing a different creature inside a Bonus Action, deleted the shared maneuver damage rule from the two maneuvers that restated it while joining Trip Attack's on-hit trigger to the clause that depends on it, pointed Nessa's class spellcasting header at the Metamagic trait that alters those spells, and folded Reggu's Radiant Sun Bolt trailer onto its own attack line as `1 Focus Point: make this attack twice as a Bonus Action`. A **numbers-and-subsystems pass** (v16) then finished the same doctrine on the two surfaces v15 did not reach: every standing advantage or disadvantage claim leaves the trait list for one pinned `Resilience` entry (37 entries across the corpus; `Dauntless Heritage` alone had stood as its own trait on eight characters), with a trait that mixes a roll claim and a real mechanic split rather than swallowed, a save bonus the sheet applies but never names (Dark Augmentation) stated where the other roll modifiers live, generic derived values resolved to the character's own number, mastery names made hoverable and inherited from the 2024 twin of a 2014 base weapon, a dependent feature folded into its anchor at final form (Brand of Tethering, Improved Shadowcasting, the three Aura traits collapsing to one `Auras (10-ft. Emanation)`), Blood Maledict rostering the curses it actually knows, an ASI-and-spells-only feat dropped in favour of an attribution in the spell block, Mac Lir's on-hit power routed onto the sword's own line, carried poisons exported for the first time with their save DC and damage (they are `type: "gear"`, so the magic-item gate had filtered every one out), Dzeiy's Hybrid Form decomposed onto the lines that carry it — a conditional AC line, a `while in Hybrid Form` resistance, a real `Unarmed Strike (Hybrid Form)` action and a roll-modifier clause, leaving only Bloodlust behind — and the CR model taught to price a rogue's defence (Uncanny Dodge, Evasion, Elusive) and burst (Assassinate, Death Strike, Cunning Strike), which moved Juen from CR 11 to 15 and Missy from 7 to 9 without moving any non-rogue. A further **placement** round then promoted Mikase's Starlight Arc from a 754-character trait to a real `Starlight Arc (Replaces One Attack)` entry carrying the parent weapon's own to-hit and damage, wrote Reggu's Eldritch Maul onto every melee line it modifies (`While Eldritch Maul is active, reach 15 ft. and plus 1d6 force damage`) while shrinking the toggle to its activation, and applied `Improved Cunning Strike`'s count upgrade at Cunning Strike itself so the block stopped saying "add one of the following" and contradicting itself an entry later. A **modifier-on-its-roll pass** (v17) then closed the last four places a modifier sat away from the roll it changes: a rider that fires off another feature's activation folds into that feature, keeping its name and its own uses while losing the self-reference its position already states (Tactical Shift into Second Wind on four characters, and unprompted, Sear Undead into Turn Undead, Mote of Potential into Bardic Inspiration and Empowered Strikes onto Unarmed Strike); a situational to-hit bonus is written onto the roll already added up (`+6 to hit (+8 when standing 5 feet or more above an enemy)`), with a second conditional joining the same parenthetical, a gate too long for a line referenced by name and keeping its trait, and the trait retired only when every attack *in scope* was annotated; Umbral Coating's converted weapon is minted as its own attack beside the weapon it converts, carrying the thrown range and naming what the conversion unlocks, which retires both the paragraph and the "can instead convert…" cross-reference; two riders of the same damage type, die size and gate state one merged number with both sources credited, where "on every melee weapon hit" and no condition at all are recognised as the same gate; and a standing defence that appeared both in `Resilience` and in its own item trait now has exactly one home, with the inverted claim shape ("Spell attack rolls against it have Disadvantage") recognised for the first time.

### Remaining limitations

| Item | Notes |
|------|-------|
| CR is advisory | DMG-inspired tables + level anchor; not a full monster redesign |
| A rider's residue is clause-matched, not paraphrase-matched | The strip removes exactly the damage the attack line emitted. `Brutal Strike` states `1d10` (per die) while the line carries `2d10`, so its clause survives; loosening the match to any `NdX` breaks sentences whose subject precedes the clause |
| Feature prose is best-effort | Cleaned, conjugated and tagged, not full NLG. The conjugation engine is rule-based, so unusual source phrasing can still slip through; leftover modifiers default on for unrepresented riders |
| Source-data typos pass through | Corrected at the source when they are in this repo's own homebrew — TGTT's "methoding" (a botched maneuver→method rename) was fixed in `homebrew/TravelersGuidetoThelemar.json`; typos in third-party brew still reach the block |
| `Additional Effects` can restate a folded-in bonus | v15 suppresses the provable cases — a modifier sharing a `sourceFeatureId` with an enabled unconditional twin, and any unconditional numeric bonus to a number the block already prints. A bonus with neither signature is still printed, because removing a live one costs correctness |
| An item-granted spell stated only in prose never reaches a spellcasting block | Wisp's Moonlit Aegis grants *Moonbeam* in free text with no structural record on the sheet, so extraction would be a guess. The grant stays where it is written, where it is at least hoverable |
| Real-save regression fixtures untracked | `npc-exports/*.json` are personal character data; `CharacterSheetNpcExporter.realsaves.test.js` skips when absent, so CI covers less than local. The local corpus is twenty-four characters (Aldor, Arthur, Boti, Dauk, Dranan, Duralin, Dzeiy, Elizabeth, Fili, Juen, Lorian, Mikase, Missy, Nagara, Nessa, Octavius, Onger, Phirse, Reggu, Talna, Tignor, Tikal, Vern, Wisp) |
| Wild Shape known forms are not recoverable | The sheet stores the count, max CR and fly eligibility but not which beasts were chosen, so the block prints the capability (`8 known forms, max CR 3`) rather than a form list |
| Lore suppression is a ratio, not a rule | An entry is dropped only when it is ≥ 250 chars, has ≤ 2 mechanical sentences **and** a mechanical ratio below 0.25. Flavour containing a stray hover or modal (`{@skill Stealth}`, "which can keep many foes at bay") reads as mechanical, so an absolute test flagged 16 legitimate entries. Short lore under 250 characters is kept |
| Only one form block is recognised | `_splitFormBlocksIntoAlternateForm` needs an explicit "while transformed"-style connector followed by ≥ 2 labelled paragraphs. Dzeiy's Hybrid Transformation matches; Mikase's Angelic Avatar states its deltas without a connector and is left whole |
| A replacement attack is synthesised only when three things parse | `_promoteReplacementAttacks` needs the parent attack, the area and the extra damage. Any power missing one keeps its prose, because a guessed attack line is worse than a paragraph |
| A toggle rider needs a stated damage die | `_annotateToggledAttackRiders` will not write a reach-only or advantage-only toggle onto an attack line — there is no number for the line to carry, so it stays in prose |
| A form fold places only what it can parse | `_foldFormTraitOntoLines` moves an AC bonus, a resistance, an advantage claim and an unarmed strike. A clause it cannot confidently place stays in the trait, so an unusual form still reads as a paragraph |
| A poison without a `_POISON_FACTS` entry prints bare | Naga Venom (TGTT) is named and counted but carries no DC or damage, because inventing either would be worse than omitting both |
| Rogue CR multipliers are estimates | Uncanny Dodge, Evasion and Elusive are priced below the physical-resistance fold since each covers a narrower slice of incoming damage; the burst credit is a fraction of once-per-turn rider damage |
| Always-on auras exceed the sheet's displayed save bonus | A Paladin's Aura of Protection is in `getSaveMod` but not `getSaveBreakdown`, so the block prints the higher roll-time value; the aura trait on the block explains it |
| A sourceless `@spell` tag is deliberate | 5etools resolves a spell tag by name against the core list, so a spell the character does not itself know ("the darkness spell") is tagged without a source rather than guessed at. Homebrew tags (`@item`, `@optfeature`, `@combatmethod`) always carry one or stay plain |
| The uniform-skill collapse needs a uniform bonus | Jack of All Trades collapses into one line only when the same delta applies to every non-proficient skill; a build that breaks that uniformity keeps the individual rows |
| Metamagic tuning is read, not inferred | The Active/Passive/tuned grouping comes from `tunedMetamagics`; a homebrew metamagic system that does not populate it lists its options without the grouping |
| No lair / regional / mythic auto-gen | Legendary actions optional; lair out of scope |
| Structural validation only | No full browser-side `monster.json` schema run |
| Homebrew skill keys deviate from schema | `"endurance|TGTT"` violates `additionalProperties: false` on `skill`, but renders and hovers via `Renderer.monster.getSkillsString`; a deliberate trade to avoid dropping proficient homebrew skills |
| Prose-derived mechanics | Stance effects and feature-conjured weapon statistics are parsed from description text because the structured payloads are empty; unusual phrasings may be missed, though the prose is always exported in full |
| Some player choices are unrecoverable | Signature Spells and Spell Mastery keep no marker on the chosen spells, and `{@feat Resilient}` stores `choices.ability === null`. The export drops the "Choose two level 3 spells…" scaffolding rather than inventing a pick |
| Psionic powers need `modes[]` | Effect text is read from the mode matching the power's order; a homebrew psionic feature that leaves `modes[]` empty exports as headers only |
| Homebrew class rules dumps are handled case by case | A `description` HTML blob that flattens a rules table is special-cased (psionics has a purpose-built compact home). No general size cap is applied — it would trim legitimate content |
| Damage riders are text only | Appended to the attack line, not folded into the CR damage heuristic |
| Defence attribution hovers only for feats | Class, subclass and species features are keyed by tuples the exporter cannot reconstruct from export state, so their attribution renders as a bare name rather than a dead link |
| Spell-aware CR needs the site's spell data | The dialog builds `spellIndex` from `DataUtil.spell.pLoadAll()`. In tests, Node harnesses, or when the load fails, CR degrades to a school-weighted heuristic; homebrew spells always use that path |
| Compaction is rule-based | Dead-sentence detection is pattern-driven and conservative (a mechanical sentence must survive). Unusual phrasing can leave redundancy in place, but never removes mechanics |
| Multiclass spell presentation | Pact-preferring when no normal slots; mixed casters may need manual cleanup |
| Divine Favor needs the homebrew catalog | `_getDivineFavorBlock` resolves the god against whatever `setDivineFavorCatalog()` supplied; without it the trait is omitted rather than guessed |
| Shape-shift consolidation is name-keyed | Recognises `Circle Forms`, `Improved Circle Forms`, `Elemental Wild Shape`, `Thousand Forms`; a differently-named homebrew rider stays a separate trait |
| Held-weapon resolution needs one weapon | `_resolveHeldWeaponReferences` only names a weapon when exactly one is equipped, rather than guessing between two |
| Ambiguous skill tagging can under-tag | `Nature`/`Insight`/`Perception`… tag only next to a check cue, a paren, or an adjacent skill tag — a missing hover is preferred to a wrong one |
| VTT-native formats | 5etools homebrew monster JSON only (no Foundry/Roll20 packagers) |

---

## Technical Debt

### ⚠️ Named architectural seam: the two effect vocabularies

**This is the single most expensive recurring defect in the sheet. Read this before
adding any effect to a feature or an active state.**

The sheet describes "what an ability does" in **two independent paths** whose
vocabularies were developed separately and never reconciled. Both are alive, both
are correct on their own side, and **they use different key names for the same
concept**. At least one concept (`sense`) has *three* spellings, because the
registry side also disagrees with itself:

| Concept | `FeatureEffectRegistry` shape | `ACTIVE_STATE_TYPES` / supplemental shape |
|---|---|---|
| Speed | `{type:"speed", speedType:"fly", value:60}` | `{type:"bonus", target:"speed:walk", value:10}` |
| Advantage | `{type:"modifier", modType:"deathSave:advantage"}` | `{type:"advantage", target:"deathSave"}` |
| Damage immunity | `{type:"immunity", damageType:"poison"}` | `{type:"immunity", target:"poison"}` |
| Sense | `{sense, range}` *(class-feature applier)* **or** `{senseType, value}` *(feat applier)* — dispatched by `_fromFeatRegistry`, both correct | `{type:"sense", target:"darkvision", value:60}` |
| Max HP | *(not expressible)* | `{type:"hpMaxIncrease", value:N}` |
| Read by | `aggregateModifiers(type)` | `getAdvantageState()`, `getSenses()`, the `*FromStates` collectors |

Treat this table as the shape of the problem, not an inventory — the `sense` row
shows the registry column can itself hold more than one spelling, and other rows
may yet prove to do the same.

#### Why it costs so much

The readers are **strict and silent**. A reader that doesn't recognise the shape it
was handed does not throw, does not warn, and does not log — it hits a bare
`continue` or `return null` and moves on. The effect is computed perfectly, carried
most of the way to the getter, and then dropped one line short.

The resulting bug is **indistinguishable from an unimplemented feature**. The
ability appears in the feature list, its toggle activates, its tooltip renders its
numbers — and nothing happens. Every session that has hit this has diagnosed it by
writing throwaway probes and bisecting the pipeline layer by layer, because there is
no signal pointing at the seam.

#### Known instances

| # | Where | Symptom | Status |
|---|---|---|---|
| [CS-BUG-130](known-bugs.md) | `_getGrantedSpeedFromFeatures` | Feature-granted fly/climb/swim speed discarded by the movement-type guard | Fixed (opt-in `grantsMovementType`) |
| [CS-BUG-131](known-bugs.md) | `activateState` / `_stateContributesHpMaxIncrease` | A `useFeatureDescription` state's `hpMaxIncrease` never synced to max HP | Fixed |
| [CS-BUG-134](known-bugs.md) | `_getDamageDefenceFromStates` | Read `target` only, so a registry-shaped `damageType` immunity was dropped | Fixed (tolerant read) |
| Sun Bloodline session | active-state `sense` effects | Registry's `{sense, range}` written into a state, which wants `{target, value}` → activates, renders, grants nothing | See [13-tgtt-thelemar-homebrew.md](13-tgtt-thelemar-homebrew.md) |
| ~~Blood Hunter session~~ | ~~`FeatureEffectRegistry` `sense` entries~~ | **Retracted — not a defect.** The registry's two spellings are dispatched to two different appliers on purpose; both have working readers. See "The worked example" below | **Not a bug** |

Three confirmed instances, found by three independent sessions working on
unrelated classes, none aware of the others' findings until afterwards.

> **A fourth claim was investigated and withdrawn.** It is kept above, struck
> through, deliberately: the retraction is more instructive than the claim was.
> See "Three sessions, three false positives" below before adding a row here.

#### The worked example: `sense` is **three-way**, across **two paths** — and it works

Senses are the clearest specimen, and the one to study before attempting anything
here. There are **two independent paths** and **three spellings**. Every one of
them has a working writer *and* a matching reader:

| Spelling | Path | Writer → reader | Status |
|---|---|---|---|
| `{type:"sense", target:"darkvision", value:60}` | Active state | `getSenseBonusFromStates()` | ✅ works |
| `{type:"sense", sense:"blindsight", range:30}` | Registry → class feature | `_applyFeatureEffect` → `_setClassFeatureSense(effect.sense, effect.range)` | ✅ works |
| `{type:"sense", senseType:"blindsight", value:10}` | Registry → **feat** | `_processFeatRegistryEffects` → `addNamedModifier({type: "sense:X", value})` → `getSense()`'s `_getNamedSenseContribution()` | ✅ works |

> **Correction (CS-BUG-136).** This row originally read "→ `getSense()`'s
> `namedBonus` ✅ works". The claim that the effect *arrives* was right; the
> implication that it arrives **once** was not. A second aggregation of the same
> named modifiers in `_recalculateCustomModifiers()` folded them into
> `customModifiers.senses`, which `getSense()` also read — so every named sense
> grant doubled (Skulker rendered blindsight 20 ft). The fold has been deleted
> and `getSense()` / `_getNamedSenseContribution()` is now the sole owner, which
> is what this row always described. **No registry spelling changed**, and the
> `_fromFeatRegistry` guard below is untouched: the duplication was downstream of
> both paths, in the aggregation, not in the dispatch. See
> [known-bugs.md](known-bugs.md) → CS-BUG-136.
>
> The lesson generalises to this table. Tracing a spelling to its reader proves
> the writer→reader link exists; it does not prove the reader is the *only* one.
> Where a derived value is exactly knowable, assert it exactly —
> `getSense("blindsight") === 10`, not `>= 10` and not `senseMod.value === 10`.

**The separation is deliberate, not drift.** `_applyFeatureEffect` opens with a
guard:

```js
if (effect._fromFeatRegistry) {
    const FEAT_NAMEDMOD_TYPES = new Set(["hpBonus", "modifier", "speed", "sense", ...]);
    if (FEAT_NAMEDMOD_TYPES.has(effect.type)) return null;   // "would double-count them"
}
```

`"sense"` is in that set **by name**. Entries tagged `_fromFeatRegistry` are
routed *away* from the class-feature applier on purpose, because the feat path
already applied them via `addNamedModifier` at `addFeat` time.

So this is **not** three rival spellings of which two are wrong, and it is **not**
an intra-registry defect. It is two paths, each with its own writer and its own
matching reader, doing what they were designed to do.

> **⚠️ Do not "reconcile" the registry's two spellings.** The `_fromFeatRegistry`
> guard exists specifically to keep those paths apart. Normalising them into one
> applier risks reintroducing the double-count the guard was written to prevent.

#### Three sessions, three false positives — the durable lesson

Three separate sessions independently reported a bug here. **All three were
wrong**, in the same way:

| Session | Claimed | Reality |
|---|---|---|
| Talent (this one) | `{senseType, value}` "survives no reader" | Reaches `getSense()` via the named-modifier path |
| Blood Hunter | registry `sense` split is a latent defect | Deliberate, guarded dispatch |
| Beastheart | registry `damageType` resistances discarded | `_applyFeatureEffect` reads `effect.damageType` straight into `_addClassFeatureResistance` |

The shared error: **each of us traced writer → one reader, found no match, and
stopped.** Stopping one call short of the applier produces a specific, confident,
*false* bug report — which is more damaging than no report, because it lands in
the debt register as an instruction to "fix" working code.

**The rule this yields:** before filing a divergence as a defect, trace to the
**observable getter** and assert on it. `getSense("blindsight") === 10` is
evidence. "I grepped the reader and it doesn't mention `senseType`" is not. Note
that this is the same doctrine as the testing rule below — assert the derived
value, never the shape of the effect object — applied to diagnosis rather than to
tests.

> **The rule works — it produced a real bug the same day.** Applying it to
> `{senseType, value}` is exactly what surfaced **CS-BUG-136**: `getSense()` did
> read the modifier, and returned **20** for a value of 10. Three false positives
> and one true one, from the same trace, distinguished only by whether the
> reporter looked at the number the getter returned. The discipline was sound; the
> retracted reports stopped one call short of the applier, and the accepted one
> stopped one assertion short of the value. Go all the way to the number.

#### The residue that IS real: an authoring hazard

What survives the retraction is smaller but genuine. `FeatureEffectRegistry` is
**one structure whose entries are dispatched to different appliers** by the
`_fromFeatRegistry` tag. Which spelling is correct therefore depends on *which
path an entry will take* — and **nothing at the registration site says which**:

```js
this.register("Feral Senses", [{type: "sense", sense: "blindsight",     range: 30}]);  // class feature
this.register("Skulker|XPHB", [{type: "sense", senseType: "blindsight", value: 10}]);  // feat
```

Same file, five lines apart, same effect type, different required spelling, and no
local signal distinguishing them. An author adding a new `sense` effect has to
already know which applier will receive it. That is a **latent authoring hazard,
not an active bug** — and it is the honest version of what was originally
documented here.

Deliberately not pinning spelling counts: branches are unmerged as this is
written, so any number would be stale on arrival. Grep for all three keys and
trust the result over this table.

> **This seam has a sibling in a different field.** [CS-BUG-113](known-bugs.md)
> documents `featureType` carrying **three** vocabularies — authored code arrays,
> sheet display buckets, and DM-grant UI labels written straight into the
> discriminator — of which only two are quarantined. Different field, same family:
> one slot, several vocabularies, dispatched by path. If you are reconciling one of
> these, read the other first; the shape of the fix is likely to rhyme.

#### The remedy: tolerant readers, where a spelling can genuinely arrive

Three confirmed instances (CS-BUG-130/131/134) were fixed by making the **reader
tolerant** — falling back to the other vocabulary's key when the expected one
yields nothing:

```js
// The established pattern — additive, fallback only fires when the primary is absent.
const sense = effect.sense || effect.target;
const range = effect.range ?? effect.value;
```

This is *not* a proposal; the class-feature sense normalizer already does exactly
this. It is the right fix **where a reader can genuinely receive both spellings** —
which is what made those three real: an author reached for the registry vocabulary
in a place that only understood the state vocabulary, and the effect was dropped.

**It is not a licence to normalise everything.** Where dispatch is deliberate — as
with `_fromFeatRegistry` — the paths are separate *by design*, and broadening a
reader to accept the other path's spelling would make it apply effects that
another applier has already applied. Tolerance fixes a reader that is missing
input it should have had; it is not a substitute for knowing which applier owns an
effect.

**When adding a reader, accept every spelling it can plausibly be handed. When
adding an effect, match the vocabulary of the path you are in and verify it
arrives** — assert the *derived getter output* (`getSense("darkvision") === 60`),
never that the effect object exists.

#### Not attempted

Full reconciliation of the two vocabularies into one is a **real refactor touching
every reader and every registered effect**. It is deliberately out of scope for
feature and class work, and is tracked separately. Do not attempt it as a ride-along.

### Code Organization

| Issue | Impact | Suggested Fix |
|-------|--------|---------------|
| **23,000+ line state file** | Hard to navigate | Split into focused modules |
| **Inconsistent naming** | Confusing | Establish naming conventions |
| **Magic numbers** | Fragile | Extract to constants |
| **Limited JSDoc** | Learning curve | Add comprehensive documentation |

### Performance

| Issue | Impact | Suggested Fix |
|-------|--------|---------------|
| **`getFeatureCalculations()` not cached** | Redundant computation | Add memoization |
| **Full re-render on changes** | UI lag | Implement selective updates |
| **Large state serialization** | Slow save/load | Consider IndexedDB for large saves |

### Testing

| Issue | Impact | Suggested Fix |
|-------|--------|---------------|
| **Weak test patterns** | False confidence | Audit and strengthen tests |
| **Missing edge cases** | Undiscovered bugs | Add boundary tests |
| **Limited integration tests** | Integration bugs | Add more E2E tests |

---

## Browser/Environment Limitations

### Local Storage

- **5MB limit**: Large character collections may hit storage limits
- **No cross-device sync**: Characters are browser-specific
- **Data loss risk**: Clearing browser data loses characters

### Offline Support

- **Partial**: Core functionality works offline
- **Data loading**: Requires cached 5etools data files
- **No PWA**: Not installable as progressive web app

### Mobile Experience

The sheet reclaims its first viewport on phones and keeps the play loop
reachable, but the information architecture below the fold is still the desktop
one.

**Fixed (mobile viewport reclamation pass):**

- **First viewport**: the marketing hero is hidden and the character-management
  toolbar folds behind the 🔧 toggle, so the character's name now lands at
  ~284px instead of ~1085px. Nothing is removed — expanding the header restores
  every management control, unclipped.
- **Tab bar**: five play tabs (Overview, Combat, Spells, Inventory, Features)
  stay in the bar; Abilities, Notes, Companions, Builder and Respec move into a
  **More** bottom sheet. The strip no longer overflows at 390px or 320px, and
  "More" mirrors the active state when an overflow tab is open.
- **Modals**: the tab bar is demoted to `--cs-z-sticky` and the FAB is hidden
  while a modal is open, so modal footers — and their primary action — are no
  longer covered.
- **iOS auto-zoom**: every input, select and textarea now has a 16px *floor*
  (`max(16px, …)`), which keeps the page's text-size feature working while
  staying above Safari's one-way zoom threshold.
- **Landscape**: the mobile layer used to switch itself off on rotation, because
  a phone in landscape is 844px wide — outside the `max-width: 768px` gate. It
  now also activates on `(max-height: 480px) and (orientation: landscape) and
  (pointer: coarse)`.
- **Status strip**: a persistent, *interactive* bar sits above the tab bar and
  mirrors HP, AC, the next spendable spell slot and the next available class
  resource. Tapping a slot or resource spends it; tapping HP opens a two-button
  Heal / Damage tray; tapping AC opens the existing breakdown. Every segment is
  a mirror — it reads the real controls and clicks them, so `CharacterSheetState`
  remains the single source of truth and no resource logic is duplicated.
  Segments are self-hiding, which is why a Champion Fighter simply shows no
  Slots segment and a Warlock shows `Pact` — from the same scan, with no
  per-class branch.
- **Silent content clipping**: collapsible sections pinned `max-height` to the
  height they measured during init, and only released it after a *manual*
  expand. Anything that rendered later — favourite spells, proficiencies, an
  added item — was clipped with no scrollbar and no affordance, hiding up to
  176px in a single section. `max-height` is now treated as a transition
  device rather than a resting state: an expanded section rests at
  `max-height: none`, and `_releaseMaxHeight()` returns it there after a
  toggle, with a timeout fallback because `transitionend` never fires under
  `prefers-reduced-motion`. This also removed a whole class of timing bug —
  inactive tab panes are `display: none` at init, so their measured
  `scrollHeight` was 0.
- **Overview length**: sections that are reference material, or that another
  tab owns (Proficiencies, Specialties & Feats, Principles of Devotion, Active
  Features), now start collapsed. Overview went from 4,787px to 4,247px
  (5.67 → 5.03 screens) with nothing removed — every collapsed section is one
  tap from open.
- **Touch targets**: hit areas are expanded via `::after` (glyphicons own
  `::before`) to clear the WCAG 2.5.8 24px floor. The expansion is sized by
  distance to the nearest neighbour, not by preference — spell-slot pips sit on
  a 25.6px pitch so they take 24px, while a section-edit pencil sits alone and
  goes from 14×13 to 44×44. Verified with `elementFromPoint` across all five
  tabs: **zero misfires**, i.e. no control captures a neighbour's tap.

**Fixed (mobile interactivity pass):**

- **Spell upcasting had no route on mobile.** `charactersheet-mobile.js` read
  `window._charsheetPage`, which nothing ever assigns — the real global is
  `window.charSheet`. The spell branch of the long-press menu therefore never
  ran, and since the Cast button is hardcoded to `autoSlot: true`, upcasting was
  unreachable for every class except Sorcerers. A rename alone would not have
  worked: the mobile module constructs on `DOMContentLoaded`, but `charSheet` is
  assigned ~10–25s later, after `pInit()`. Resolved with a lazy `get _page()`.
  Long-press on a levelled spell now offers each affordable higher slot with a
  "N slots remaining" sublabel, and unaffordable levels render disabled.
- **The long-press menu named DOM that did not exist.** Two of its branches were
  hardcoded selector lists; four of the names (`__resource-reset`,
  `__resource-edit`, `__resource-decrement`, `__inventory-name`) had no real
  counterpart at all. Replaced with discovery over the row's own buttons, which
  now surfaces the full capability of a row — a Wizard item yields ten real
  actions, and *Toggle Prepared* gained a mobile route it never had.
- **Spells with no cast options opened an empty menu**, which `_showContextMenu`
  discards — so long-press was a dead gesture on innate and at-will grants even
  though the row advertised a menu. Discovery now supplements the cast options.
- **The first tap after a long press was swallowed.** The blocker that suppresses
  the synthetic post-`touchend` click was global and `once: true`, so for 500ms
  it ate whichever click arrived first — usually the user's immediate tap on the
  menu the press had just opened. It is now scoped to the pressed row and always
  lets the context menu through.
- **The mobile roll toolbar is gone.** It duplicated the long-press menu, with
  advantage/disadvantage reachable two ways and consistent nowhere. Long-press
  is now the single path, and rows where it is the *only* route to a capability
  carry a quiet right-edge marker plus hold-progress feedback, so the gesture is
  discoverable rather than assumed. The marker is a 2px bar, not a `⋯` glyph:
  the glyph was measured to overlap the row's own trailing value (the passive
  score, the ability modifier) on 12 of 15 sampled rows, and a hint that
  obscures the number beside it is worse than no hint.
- **Destructive actions confirm** (shared with desktop): removing an item or a
  spell now asks first. The confirm lives in the click handler, not in
  `_removeItem`/`_removeSpell`, so programmatic removal — e.g. quantity
  decremented to zero — stays silent, as it should.
- **Death saves are guarded** (shared with desktop): rolling one above 0 HP was
  possible, and a natural 20 called `setCurrentHp(1)` — silently dropping a
  healthy character to 1 HP with no undo. The whole handler now returns early
  with a warning toast.
- **Numeric fields raise a numeric keypad**: `pGetUserNumber` accepts an opt-in
  `inputMode`, applied to the 19 character-sheet call sites (all of which have
  `min: 0` or `min: 1`, so the absent iOS minus key costs nothing). The 32
  call sites elsewhere — dice roller, DM Screen, homebrew builder — are
  untouched.

**Still open:**

- **Overview's four largest blocks cannot collapse**: the HP, combat-stats,
  survival and core-stats sections (~1,170px combined, ~28% of the tab) have no
  `.charsheet__section-title`, and the collapse mechanism needs one to hang the
  toggle on. Reducing them further means adding a heading to shared desktop
  markup, which is out of scope for a mobile pass.
- **Lineage-granted spells do not spend a slot when upcast** (e.g. a Druid's
  Thorn Whip from Elven Lineage). The mobile menu drives the same `onSelect` the
  desktop menu does, and a normally-prepared spell spends the correct slot, so
  this is a spells-controller behaviour shared with desktop, not a mobile defect.
- **`#charsheet-roll-initiative` is read but never created**
  (`charactersheet-combat.js:485`, `charactersheet-mobile.js:972`). Not a live
  bug — the FAB falls back to `#charsheet-box-initiative` and combat.js uses
  optional chaining — but the id is dead.
- **Landscape depth**: ~9.7 screens — better than before, but the layout is not
  yet reauthored for a short viewport.
- **Hover-only affordances**: `:focus-visible` and `:active` equivalents are in
  place for the pips, chips and section-edit controls; the remaining ~150
  hover-only rules across the sheet have not been swept.
- **Play Mode**: a separate, largely non-functional surface; the Manager view is
  the supported mobile experience.

---

## Data Accuracy

### Official Content

Most official content is accurate, but edge cases exist:

- Some errata not applied
- Print vs. D&D Beyond differences
- Conflicting interpretations of rules

### Homebrew

Homebrew content quality varies:

- Schema validation doesn't catch all issues
- Feature parsing may fail on unusual text
- Some homebrew sources incompatible

**Well-Supported Homebrew:**
- **TGTT (Thelemar)**: Comprehensive support - 818+ tests (737 core + 81 combat methods survey), all variant rules, classes, subclasses, combat methods (17 traditions parsed, stance speed bonuses, subclass auto-grants), and battle tactics. See [TGTT Documentation](./13-tgtt-thelemar-homebrew.md).

---

## Improvement Priorities

### High Priority

1. ~~**Complete subclass calculations**~~ ✅ Done - All core subclasses implemented
2. ~~**Fix weak test patterns**~~ ✅ Mostly done - Converted to `getFeatureCalculations()`
3. **XPHB 2024 completion** - Full support for revised rules (in progress)
4. ~~**TGTT Homebrew**~~ ✅ Done - 818+ tests, comprehensive coverage (incl. 81-test combat methods survey)

### Medium Priority

5. **Code modularization** - Break up large files
6. **Performance optimization** - Cache computations
7. **Mobile improvements** - Better touch experience
8. **Remaining XPHB species** - Complete 2024 species support

### Low Priority

9. **PWA support** - Offline installation
10. **Cloud sync** - Cross-device characters
11. **Advanced combat** - Cover, flanking, etc.

---

## How to Contribute

See [Contributing Guide](./12-contributing-guide.md) for:
- How to identify issues to work on
- Implementation patterns to follow
- Test requirements for new features
- Code review process

### Quick Wins for New Contributors

1. Add missing subclass calculations (follow existing patterns)
2. Convert weak tests to use `getFeatureCalculations()`
3. Add missing XPHB feature flags
4. Improve JSDoc comments

---

## UX Behaviours Worth Knowing

### Conditional Modifier Picker is Opt-In Per Roll

Deliberate design: conditional advantage/disadvantage/bonus modifiers (e.g. Dauntless Heritage "against being frightened") do **not** auto-apply. They surface as a pre-roll picker so the player decides per roll whether the condition is actually met. Players who find the prompt repetitive can toggle **"Skip conditional prompts"** in the dice settings dropdown (persists via `settings.skipConditionalPrompt`); with the toggle on, conditionals are simply ignored — there is no "always apply" mode by design (it would re-introduce the original bug class).

See [Combat System → Conditional Modifier Picker](./06-combat-system.md#conditional-modifier-picker-pre-roll-flow).

### Favorites Cap = 8, Orphans Are Manual

`_data.favorites` is capped at 8 entries. When a favourited entity disappears (renamed feature, removed item, source migration), the favourite becomes an "orphan" — still in state, but `_resolveFavorite` returns `{found: false}`. The Actions hub surfaces a "Remove N orphans" toast button rather than auto-pruning, to protect against transient data-load failures where the entity may reappear.

See [Components Reference → Favorites System](./03-components-reference.md#favorites-system).

### No Ally-Targeting Machinery Anywhere on the Sheet

The character sheet models exactly one creature. There is no ally roster, no
targeting API, and no way to push a modifier onto another player's sheet. Features
that let you buff *another creature* therefore land in one of two buckets:

- **Self-target** — real modifiers registered on this sheet.
- **Ally-target** — a *displayed designation* plus its lifecycle (who was chosen,
  when it expires), with no numeric effect anywhere.

Granny's Gifts (Wicked Witch Sorcerer) is the worked example: warding yourself
registers real gated `save:advantage:charmed|frightened` conditionals, while
warding an ally records the name and clears on the next long rest — and
deliberately grants the witch nothing. Prose describing the ally case must not be
parsed onto the character; see CS-BUG-092 and the third-party subject guard.

### No Enemy Action Economy Either

The same one-creature limit cuts the other way: a feature that *constrains an
opponent's options* has nothing on the sheet to change. There is no enemy turn,
no enemy action selection, and no opportunity-attack tracker, so a clause like
Fluid Step's "other creatures can't gain the benefit of Disengaging from you
while you are Dancing" (Belly Dancer Rogue 13, TGTT) can only be **surfaced as a
rules note** — as an active-state note and a Combat-tab feature line. Its
self-facing half ("you gain the benefit of Disengage while Dancing") *is* a real
mechanic, via the generic `grantsActionBenefit` state effect. See CS-BUG-115.

Encounter-side rules of this shape belong on the DM Screen, not the sheet.

---

## Beastheart (MCDM, `BST`) — positional and enemy-facing clauses

Beastheart ships with every countable effect real, but six clauses are
inherently positional or land on another creature's dice, which the sheet does
not own. Each is surfaced as `info` with its countable half still live:

| Feature | What is real | What is narrated |
|---|---|---|
| Frenzied Charge (Ferocious 3) | — | A reaction move-and-attack; the sheet models neither movement nor reaction ordering |
| Pack Phalanx (Protector 3) | — | Disadvantage on **enemy** attack rolls against third parties |
| Allied Earth (Primordial 7) | `getAlliedEarthAura()` reports whether the aura is live (≥1 ferocity) and its 10-ft radius | The difficult terrain itself |
| Primal Warding (Hunter 7) | Uses, `4d8` force, exploit DC, CON save | Where the ward is placed |
| Summon the Wilds (18) | A real 1-use short-rest pool | The summoned swarm's behaviour |
| Natural Language (1), Faithful Companion (6) | — | Purely narrative |

This is the same boundary as the Fluid Step case above: encounter-side rules
belong on the DM Screen, not the sheet.

### An unproven reentrancy risk, defended rather than asserted safe

`_applyBeastheartCompanionBonuses()` reads `getFeatureCalculations()`, a broad
derivation. No path from that derivation back into companion recalculation was
observed across the full suite, but it could not be **proven** impossible, so
the honest position is "unproven", not "safe".

Rather than leave it at that, the method carries a reentrancy guard: a nested
call is refused, logs a named warning, and returns — converting a hypothetical
stack overflow into a diagnosable no-op. The guard releases in a `finally`, so a
throw inside the body cannot wedge it permanently. Both behaviours are pinned by
tests in `CharacterSheetBeastheartCompanion.test.js`, so the insurance has been
fired at least once rather than merely written.

**If that warning ever appears in the wild, the cycle is real** and the offending
calculation should stop reaching into companions.

Additionally, **Mystic Connection (`BST:MC`) is not offered as a pick.** The 15
MC optional features map 1:1 to the 15 companions and each carries a
prerequisite naming its companion, so choosing a companion already determines
the connection. Surfacing it as a chooser would invite an invalid selection.

## Blood Hunter — Order of the Profane Soul (`BH2022`) patron-specific text

The order's **Otherworldly Patron** choice is a real, persisted decision: it is
offered at level 3, stored, and read back by the `profaneSoulPatron`
calculation, so later features can key off it. That was **not** true until
`CS-BUG-160` was fixed — the source states the nine patrons as prose inside a
`type: "list"`, which the option resolver could not see, so the choice was never
offered and `profaneSoulPatron` was permanently `null`. See
[`known-bugs.md`](./known-bugs.md).

What is **not** implemented is the patron-specific *body* of three features:

| Feature | Level | What is implemented | What is not |
|---|---|---|---|
| Rite Focus | 3 | the flag, and the patron name | the per-patron benefit clause |
| Revealed Arcana | 7 | the feature is listed | the per-patron spell grant |
| Unsealed Arcana | 15 | the feature is listed | the per-patron spell grant |

Each of the nine patrons supplies a different clause, and several are
enemy-facing or DM-adjudicated ("the target takes…", "the creature must…") — the
same boundary described for brands and curse saves above: a single-character
sheet cannot resolve an effect that lands on someone else.

The two spell-granting features are, by contrast, mechanically expressible and
are simply not done yet; they are a candidate for the `additionalSpells` path
rather than new machinery.

The E2E spec declares this gap explicitly rather than asserting around it, so the
missing coverage is visible in the spec file instead of only in this document.

---

---

*Previous: [Testing Strategy](./09-testing-strategy.md) | Next: [Future Roadmap](./11-future-roadmap.md)*
