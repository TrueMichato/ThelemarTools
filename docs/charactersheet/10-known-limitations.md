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

#### Talent (TalPsi) and Chronopath ✅

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
- **Out of scope:** the other six Psionic Specializations (Cryokineticist,
  Metamorph, Nomad, Oracle, Psychic Warrior, Telekinetic) get the base class
  and its pickers but no specialization-specific calculations. The 103 psionic
  powers are pickable and activatable but their individual per-power effects
  (damage, saves, riders) are rendered from their source text rather than
  modelled.

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

## Technical Debt

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

- **Responsive**: Basic mobile support exists
- **Touch optimization**: Could be improved
- **Screen space**: Complex features cramped on small screens

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

---

*Previous: [Testing Strategy](./09-testing-strategy.md) | Next: [Future Roadmap](./11-future-roadmap.md)*
