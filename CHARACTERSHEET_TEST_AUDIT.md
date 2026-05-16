# Character Sheet Test Audit Report

## Executive Summary

**Last audit: July 2025**

The character sheet test suite is in **good overall health**: **86 test files, 7,105 tests, 100% pass rate** (3.8s runtime). Most class features have proper mechanical assertions. The remaining issues are:

1. **5 placeholder tests** using `expect(true).toBe(true)` (no-ops)
2. **~30 tests** that only assert `getTotalLevel()` instead of feature calculations
3. **~40% of feature calculation properties** (665 of 1,689) lack test assertions
4. **TGTT multiclass** tested in only 2 of ~15 possible combinations
5. **No systematic "wrong source" negative tests** (PHB vs TGTT feature gating)
6. **Infrastructure note**: `npm install` required before tests run — dependencies are not pre-installed in worktrees

### Previous Updates
- ✅ **(Feb 2025)** All core class subclasses now have full mechanical calculations
- ✅ **(Feb 2025)** TGTT (Thelemar) homebrew fully implemented (737+ tests)
- ✅ **(Feb 2025)** Weak test patterns largely converted to use `getFeatureCalculations()`
- ⚠️ XPHB 2024 features still in progress

## Suite Health Snapshot (July 2025)

```
Test Suites: 86 passed, 86 total
Tests:       7105 passed, 7105 total
Time:        3.835 s
```

No failures, no skipped tests, no `xit`/`xdescribe`/`test.skip` patterns found.

## Current State

### Well-Implemented Classes (with proper mechanical tests)
| Class | Tests | Implementation Quality |
|-------|-------|----------------------|
| Barbarian | 214 | ✅ Excellent - tests rage damage, brutal critical dice, AC formula |
| Monk | 225+ | ✅ Excellent - tests martial arts die, ki points, ki DC, unarmored movement, Implements of Mercy proficiencies |
| Fighter | 186 | ✅ Good - tests superiority dice, second wind healing, action surge |
| Rogue | 177 | ✅ Good - tests sneak attack dice, expertise |
| Wizard | 92 | ✅ Good - tests spell DC, prepared spells, arcane recovery |
| Sorcerer | 146 | ✅ Good - tests sorcery points, metamagic |
| Warlock | 153 | ✅ Good - tests pact slots, invocations count |
| Bard | 145 | ✅ Good - tests bardic inspiration die, jack of all trades |
| Cleric | 147 | ✅ Good - tests channel divinity, destroy undead CR |
| Paladin | 140 | ✅ Good - tests lay on hands, divine smite, auras |
| Ranger | 144 | ✅ Good - tests favored foe damage, spellcasting |

### Partially Implemented Classes (tests exist but some use weak patterns)
| Class | Issue |
|-------|-------|
| Druid | 3 placeholder `expect(true)` tests for edition-gated features |
| Ranger | 1 placeholder `expect(true)` test for multiclass requirements |

## Key Issues Identified

### Issue 1: Tests Using `getTotalLevel()` Instead of `getFeatureCalculations()`

Many subclass tests use this anti-pattern:
```javascript
// BAD: Tests nothing meaningful
it("should have feature at level 3", () => {
    state.addClass({name: "Artificer", level: 3, subclass: {name: "Alchemist"}});
    expect(state.getTotalLevel()).toBe(3);  // This always passes!
});
```

Should be:
```javascript
// GOOD: Tests actual mechanic
it("should produce 2 elixirs at level 6", () => {
    state.addClass({name: "Artificer", level: 6, subclass: {name: "Alchemist"}});
    const calculations = state.getFeatureCalculations();
    expect(calculations.experimentalElixirCount).toBe(2);
});
```

### Issue 2: Placeholder Tests (`expect(true).toBe(true)`)

5 tests pass unconditionally — they were written as stubs and never completed:

| File | Line | Test Name | Should Assert |
|------|------|-----------|---------------|
| CharacterSheetRanger.test.js | 1352 | "should require DEX 13 and WIS 13 for multiclassing" | Multiclass prereq validation |
| CharacterSheetRest.test.js | 120 | "should track short rest count" | Short rest count tracking |
| CharacterSheetDruid.test.js | 1631 | "should have PHB subclass at level 2, XPHB at level 3" | Edition-specific subclass levels |
| CharacterSheetDruid.test.js | 1664 | "should have Primal Order at level 1 only in XPHB" | `hasMagician` / `hasWarden` |
| CharacterSheetDruid.test.js | 1706 | "should have Epic Boon at level 19 only in XPHB" | `hasEpicBoon` at L19 |

### Issue 3: `getTotalLevel()` Anti-Pattern

~30 assertions only verify `getTotalLevel()` — a value that always equals what the test sets up. Most are in:
- `CharacterSheetMulticlassProgression.test.js` (15 occurrences) — acceptable here as these test level accounting
- `CharacterSheetIntegration.test.js` (5 occurrences)
- `CharacterSheetTGTTMulticlass.test.js` (4 occurrences)
- Various single occurrences

**Assessment:** The multiclass progression file legitimately tests level math. The others should add feature calculations alongside the level check.

### Issue 4: Feature Calculation Coverage Gap

Of ~1,689 properties returned by `getFeatureCalculations()`, approximately **665 (~40%) lack direct test assertions**. Notable untested categories:
- **Beast companion forms** (almiraj, aurochs, bat, beaver, bee, tiger, unicorn properties)
- **Combat stances/tactics** (activeStance, battleTactics, flankingBonus, highGroundBonus)
- **Druid wildshape** (circleForms, wildCompanionDuration, zodiacFormBrightLight/DimLight/Duration)
- **Dreamwalker exotic** (dreambendDc, dreamhavenBonus, lucidFocus, wakingDreamDc)
- **Gambler/Trickster** (gamblerCantripsKnown, gamblerModifierDice, gamblerSpellSlots, tricksterDiceCount)
- **Animal Accomplice** (canCastThroughFamiliar, familiarCanCastCantrips, sharedSenses, telepathicBond)

### Issue 5: TGTT Source Gating Not Systematically Tested

334+ "should NOT" test cases exist, but they test feature thresholds (wrong level), not **source gating** (wrong source). Missing:
- "PHB Fighter should NOT get Combat Methods/Stamina"
- "XGE Arcane Archer should NOT use TGTT L1 mechanics"
- Source priority fallback logic (TGTT > XPHB) not verified

### Issue 6: TGTT Multiclass Coverage Thin

Only **2 of ~15** possible TGTT multiclass combinations are tested:
- Fighter/Rogue TGTT multiclass
- Fighter/Wizard TGTT multiclass
- ❌ Missing: Dreamwalker multiclass, 3+ class combos, cross-edition multiclass

### Issue 7: Missing Mechanical Calculations

Features that have boolean flags but no actual calculations:

| Class | Feature | Has Boolean | Missing Calculation |
|-------|---------|-------------|---------------------|
| Cleric | Disciple of Life | ✅ | Healing bonus (2 + spell level) |
| Cleric | Divine Strike | ✅ | Damage (1d8 → 2d8) |
| Cleric | Warding Flare | ❌ | Uses (WIS mod per LR) |
| Fighter | Eldritch Knight | ✅ | Spell DC, bonded weapon features |
| Ranger | Beast Master | ✅ | Companion stats, companion HP |
| Paladin | Channel Divinity | ✅ | Sacred Weapon bonus |

## Recommendations

### Priority 1 (HIGH): Fix Placeholder Tests
Replace all 5 `expect(true).toBe(true)` stubs with real assertions. These are false-green tests.

### Priority 2 (HIGH): Add Source-Gating Negative Tests
Create systematic tests verifying PHB/XGE sources do NOT trigger TGTT features.

### Priority 3 (MEDIUM): Expand TGTT Multiclass Coverage
Add 5-10 more multiclass combinations including Dreamwalker and 3-class builds.

### Priority 4 (MEDIUM): Cover Untested Feature Properties
Focus on the highest-impact untested categories: combat stances, beast companion forms, gambler mechanics.

### Priority 5 (LOW): XPHB 2024 Feature Tests
Complete edition-gated feature tests (Druid Primal Order, Epic Boons, etc.).

## Test Infrastructure Assessment

### setup.js (201 lines)
- ✅ **Mocks are adequate** — `e_()`, `ee`, `CryptUtil`, `Parser`, `MiscUtil`, `StorageUtil`, `Renderer`, `UrlUtil` all stubbed
- ✅ **Parser.getAbilityModNumber** correctly implements floor((score-10)/2)
- ⚠️ **No global state reset** — no `afterEach`/`beforeEach` in setup.js. Tests handle isolation themselves (most files use `beforeEach` to create fresh state). This works but depends on each test file being disciplined.
- ⚠️ **querySelector returns null** — any test that accidentally relies on DOM queries will silently pass with null. This is a known tradeoff for unit testing without jsdom.
- ✅ **Renderer.monster.getTokenUrl** and **Renderer.spell.getCombinedClasses** mocked for companion/spell tests

### Test File Size Distribution
| Category | Files | Lines | Notes |
|----------|-------|-------|-------|
| Largest | CharacterSheetTGTT.test.js | 12,305 | Main TGTT omnibus — needs table of contents |
| Large (1K+) | 24 files | 1,000-3,847 | Class/feature files — well-structured |
| Medium (300-999) | 22 files | 300-999 | Focused subsystem tests |
| Small (<300) | 40 files | 100-300 | Targeted tests — appropriate size |

## Test File Status Summary

| Test File | Lines | Pass Rate | Notes |
|-----------|-------|-----------|-------|
| CharacterSheetTGTT.test.js | 12,305 | ✅ 100% | Needs TOC; 13 subclasses lack dedicated files |
| CharacterSheetMagicItems.test.js | 3,847 | ✅ 100% | — |
| CharacterSheetMonk.test.js | 3,833 | ✅ 100% | — |
| CharacterSheetCleric.test.js | 2,137 | ✅ 100% | — |
| CharacterSheetArtificer.test.js | 2,090 | ✅ 100% | — |
| CharacterSheetBard.test.js | 2,012 | ✅ 100% | — |
| CharacterSheetCustomAbilities.test.js | 2,003 | ✅ 100% | — |
| CharacterSheetFighter.test.js | 1,954 | ✅ 100% | — |
| CharacterSheetBarbarian.test.js | 1,933 | ✅ 100% | — |
| CharacterSheetDruid.test.js | 1,860 | ✅ 100% | 3 placeholder tests |
| CharacterSheetPaladin.test.js | 1,733 | ✅ 100% | — |
| CharacterSheetRanger.test.js | 1,546 | ✅ 100% | 1 placeholder test |
| CharacterSheetWarlock.test.js | 1,517 | ✅ 100% | — |
| CharacterSheetRogue.test.js | 1,504 | ✅ 100% | — |
| CharacterSheetSorcerer.test.js | 1,345 | ✅ 100% | — |
| CharacterSheetWizard.test.js | 1,088 | ✅ 100% | — |
| CharacterSheetPdf.test.js | 1,153 | ✅ 100% | — |
| CharacterSheetRest.test.js | ~500 | ✅ 100% | 1 placeholder test |

### TGTT Dedicated Test Files (8 + main)
| File | Lines | Subclass |
|------|-------|----------|
| CharacterSheetTGTTArcaneArcher.test.js | 657 | Fighter: Arcane Archer (TGTT) |
| CharacterSheetTGTTBladesinger.test.js | 542 | Wizard: Bladesinger (TGTT) |
| CharacterSheetTGTTDivineSoul.test.js | 890 | Sorcerer: Divine Soul (TGTT) |
| CharacterSheetTGTTGambler.test.js | 635 | Rogue: Gambler |
| CharacterSheetTGTTHexblade.test.js | 567 | Warlock: Hexblade (TGTT) |
| CharacterSheetTGTTHunterRanger.test.js | 582 | Ranger: Hunter (TGTT) |
| CharacterSheetTGTTMercyMonk.test.js | 660 | Monk: Way of Mercy (TGTT) |
| CharacterSheetTGTTZodiacDruid.test.js | 569 | Druid: Circle of Stars/Zodiac |
| CharacterSheetTGTTMulticlass.test.js | 453 | 2 multiclass scenarios |
| CharacterSheetTGTTAsiFeat.test.js | 100 | TGTT L4 ASI+Feat rule |

**13 TGTT subclasses are only covered in the main file** (brief/shallow):

- Way of Debilitation (6 Precise Strike methods with individual DCs)
- Path of Chained Fury (chain damage scaling)
- Oath of Bastion (extensive level-based progression)
- The Horror (unique warlock mechanics)
- 6 Cleric Domains (Beauty, Blood, Darkness, Madness, Time, Lust)
- 3 Bard Colleges (Jesters, Surrealism, Conduction)
- Order of the Animal Accomplice

## Conclusion

### ✅ Strengths
- **100% pass rate** — 7,105 tests, 86 suites, zero failures
- **All 33 TGTT subclasses** have at least basic coverage
- **Core class mechanics** thoroughly tested with `getFeatureCalculations()`
- **Good test isolation** — most files use `beforeEach` for fresh state
- **Fast runtime** — 3.8s for the full suite

### ⚠️ Remaining Work
1. **5 placeholder tests** need real assertions (Priority 1)
2. **Source-gating negative tests** need creation (Priority 2)
3. **TGTT multiclass expansion** — only 2 of ~15 combos tested (Priority 3)
4. **~40% feature property coverage gap** — 665 properties untested (Priority 4)
5. **XPHB 2024 edition-gated features** still incomplete (Priority 5)
6. **Main TGTT test file** (12K lines) needs a table-of-contents comment for navigation

## Recently Added Suites

| File | Tests | Coverage |
|---|---|---|
| CharacterSheetConditionalModifiers.test.js | 15 | Unified conditional-modifier pipeline: `_isConditionalSaveSubtype` / `_buildConditionalModId` helpers, aggregator gating, both encodings (text-parsed + registry sub-typed `save:advantage:<sub>`), opt-in via `appliedConditionalIds`, `getAdvantageState` / `getModifierBonus` opt forwarding |
