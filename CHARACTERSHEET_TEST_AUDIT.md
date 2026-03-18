# Character Sheet Test Audit Report

## Executive Summary

After a comprehensive audit of all class tests in `test/jest/charactersheet/`, I've identified significant gaps between what tests verify vs. what actually needs mechanical implementation. The core finding is that **many tests only check boolean existence (`hasFeature`) or level reached (`getTotalLevel()`), without verifying the actual mechanical calculations that make features useful**.

**Update (Feb 2025)**: Most issues have been resolved:
- ✅ All core class subclasses now have full mechanical calculations
- ✅ TGTT (Thelemar) homebrew fully implemented (737 tests)
- ✅ Weak test patterns largely converted to use `getFeatureCalculations()`
- ⚠️ XPHB 2024 features still in progress

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
| Druid | Core features good, but subclass features not implemented |
| Artificer | Core features now fixed, but subclass features not implemented |

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

### Issue 2: Missing Subclass Implementations in `getFeatureCalculations()`

~~The following subclasses have tests but NO implementation:~~ **RESOLVED**

**Artificer Subclasses:** ✅ All implemented
- ~~Alchemist (no experimental elixir count, alchemical savant bonus)~~
- ~~Armorer (no armor model features)~~
- ~~Artillerist (no cannon damage, cannon HP)~~
- ~~Battle Smith (no steel defender HP, arcane jolt damage)~~

**Druid Circles:** ✅ All implemented
- ~~Circle of the Moon (no combat wild shape CR)~~
- ~~Circle of the Land (no natural recovery)~~
- ~~Circle of Dreams (no balm of summer court healing)~~
- ~~Circle of Spores (no halo of spores damage)~~
- ~~Circle of Stars (no starry form features)~~
- ~~Circle of Wildfire (no wildfire spirit HP)~~

**TGTT (Thelemar) Homebrew:** ✅ Fully implemented (737 tests)
- All variant rules (exhaustion, carry weight, linguistics, jumping, etc.)
- Dreamwalker prestige class (10 levels)
- 11 Dreamwalker abilities
- 17 Combat Traditions with 5 degrees each
- 13 Battle Tactics
- All TGTT subclasses (Chained Fury, Sun Bloodline, Horror, etc.)
- Race features (Half-Ogre, Gnoll, Tiefling variants)
- Feats (Lore Mastery, Spellsword Technique, Whip Master, Dreamer)

See `docs/charactersheet/13-tgtt-thelemar-homebrew.md` for full details.

### Issue 3: Missing Mechanical Calculations

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

### Priority 1: Fix Anti-Pattern Tests
Convert all tests using `getTotalLevel()` to use `getFeatureCalculations()` where mechanical values exist.

### Priority 2: Implement Missing Subclass Features
Add to `getFeatureCalculations()`:
1. Artificer subclass calculations
2. Druid circle calculations  
3. Missing class domain/patron/tradition features

### Priority 3: Add Resource Tracking
Implement in `getFeatureCalculations()`:
- Uses per rest (Warding Flare, War Priest, etc.)
- Damage bonuses that scale with level
- Healing amounts

### Priority 4: Verify XPHB 2024 Coverage
Many classes have PHB tests but missing XPHB 2024 feature tests.

## Test File Status Summary

| Test File | Tests | Pass Rate | Needs Fix |
|-----------|-------|-----------|-----------|
| CharacterSheetArtificer.test.js | 203 | ✅ 100% | Subclass impl |
| CharacterSheetBarbarian.test.js | 214 | ✅ 100% | Minor |
| CharacterSheetBard.test.js | 145 | ✅ 100% | Minor |
| CharacterSheetCleric.test.js | 147 | ✅ 100% | Domain impl |
| CharacterSheetDruid.test.js | ~180 | ✅ 100% | Circle impl |
| CharacterSheetFighter.test.js | 186 | ✅ 100% | Archetype impl |
| CharacterSheetMonk.test.js | 339 | ✅ 100% | Minor |
| CharacterSheetPaladin.test.js | 140 | ✅ 100% | Oath impl |
| CharacterSheetRanger.test.js | 144 | ✅ 100% | Conclave impl |
| CharacterSheetRogue.test.js | 177 | ✅ 100% | Archetype impl |
| CharacterSheetSorcerer.test.js | 146 | ✅ 100% | Origin impl |
| CharacterSheetWarlock.test.js | 153 | ✅ 100% | Patron impl |
| CharacterSheetWizard.test.js | 92 | ✅ 100% | School impl |

## Implementation Pattern

When adding subclass features, follow this pattern:

```javascript
// In getFeatureCalculations() after core class features
const subclassName = cls.subclass?.name;
if (subclassName) {
    switch (subclassName) {
        case "Alchemist":
        case "alchemist": {
            // Experimental Elixir count: 1 at 3, 2 at 6, 3 at 15
            if (level >= 3) {
                calculations.experimentalElixirCount = level >= 15 ? 3 : level >= 6 ? 2 : 1;
            }
            // Alchemical Savant (level 5+): add INT mod to healing/damage
            if (level >= 5) {
                calculations.alchemicalSavantBonus = this.getAbilityMod("int");
            }
            // Restorative Reagents (level 9+): Lesser Restoration uses
            if (level >= 9) {
                calculations.restorativeReagentsUses = Math.max(1, this.getAbilityMod("int"));
            }
            break;
        }
        // ... more subclasses
    }
}
```

## Conclusion

The testing infrastructure is solid. ~~The main gaps are:~~ **Most gaps have been addressed:**

### ✅ Resolved
1. ~~Missing subclass feature implementations in `getFeatureCalculations()`~~ - All core subclasses implemented
2. ~~Some tests using weak patterns that don't verify calculations~~ - Largely converted
3. ~~TGTT homebrew coverage~~ - 737 tests covering all content

### ⚠️ Remaining Work
1. **XPHB 2024 coverage gaps** - Some 2024 PHB features still need work
2. **Minor edge cases** - Some unusual multiclass combinations
3. **Performance optimization** - Memoization of calculations

### Recommended Approach
1. ✅ ~~First add implementations to `getFeatureCalculations()`~~ Done
2. ✅ ~~Then update tests to verify those calculations~~ Done  
3. ⚠️ Continue XPHB 2024 feature completion
4. Consider code modularization of the 22,000+ line state file
