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

#### Cleric Domains ✅
All 14 Cleric domains are fully implemented:
- **Life**: `discipleOfLifeBonus`, `preserveLifeHealing`, `blessedHealerBonus`, `divineStrikeDamage`
- **Light**: `wardingFlareUses`, `radianceOfTheDawnDamage`
- **War**: `warPriestUses`, `guidedStrikeBonus`, `avatarOfBattleResistance`
- **Knowledge**: `visionOfThePastUses`
- **Nature**: `dampenElementsUses`, `divineStrikeDamage`
- **Tempest**: `wrathOfTheStormUses`, `thunderboltStrikePushDistance`, `divineStrikeDamage`
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
- **Hunter**: `colossusSlayerDamage`, `multiattackDefenseBonus`, `hasSuperiorHuntersDefense`
- **Gloom Stalker**: `dreadAmbusherInitiativeBonus`, `umbralSightDarkvisionBonus`, `hasShadowyDodge`
- **Horizon Walker**: `planarWarriorDamage`, `distantStrikeTeleportRange`, `hasSpectralDefense`
- **Monster Slayer**: `huntersSenseUses`, `slayersPreyDamage`, `supernaturalDefenseBonus`
- **Fey Wanderer**: `dreadfulStrikesDamage`, `otherworldlyGlamourBonus`, `mistyWandererUses`
- **Swarmkeeper**: `gatheredSwarmDamage`, `writhingTideFlySpeed`, `swarmingDispersalUses`
- **Drakewarden**: `drakeProfBonus`, `drakesBreathDamage`, `drakesBreathDc`

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
| **Reaction tracking** | Missing | No per-round reaction usage tracking |

### Resource Management

| Feature | Status | Notes |
|---------|--------|-------|
| **Font of Magic** | ✅ Implemented | SP ↔ slot conversion with 2014/2024 rules |
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

*Previous: [Testing Strategy](./09-testing-strategy.md) | Next: [Future Roadmap](./11-future-roadmap.md)*
