# Future Roadmap

This document outlines planned improvements and potential features for the character sheet system.

---

## Near-Term Goals (Current Sprint)

### Complete Subclass Implementations

**Status**: ✅ Complete

All core class subclasses now have full mechanical calculations in `getFeatureCalculations()`:

- ✅ Artificer subclasses (Alchemist, Armorer, Artillerist, Battle Smith)
- ✅ Druid circles (Moon, Land, Dreams, Spores, Stars, Wildfire, Shepherd)
- ✅ Cleric domains (all 14 domains)
- ✅ Bard colleges (all including TGTT: Conduction, Jesters, Surrealism)
- ✅ Ranger conclaves (all including TGTT: Primal Focus)
- ✅ All remaining official subclasses

### TGTT (Thelemar) Homebrew

**Status**: ✅ Complete (737 tests)

Full implementation of Traveler's Guide to Thelemar content:

- ✅ All variant rules (exhaustion, carry weight, linguistics, etc.)
- ✅ Dreamwalker prestige class (10 levels, 11 abilities)
- ✅ The Warder fighter variant
- ✅ Combat Methods system (17 traditions, 5 degrees each)
- ✅ Battle Tactics (13 tactics with prerequisites)
- ✅ All TGTT subclasses (Chained Fury, Sun Bloodline, Horror, etc.)
- ✅ Race features (Half-Ogre, Gnoll, Tiefling variants)
- ✅ TGTT feats (Lore Mastery, Spellsword Technique, Whip Master, Dreamer)
- ✅ Metamagic progression and costs

See [TGTT Documentation](./13-tgtt-thelemar-homebrew.md) for full details.

### Test Coverage Improvements

**Status**: ✅ Mostly Complete

- ✅ Converted `getTotalLevel()` patterns to `getFeatureCalculations()`
- ✅ Added edge case tests for multiclassing
- ✅ Improved toggle abilities test coverage
- ⚠️ XPHB 2024 feature parity tests (in progress)

### 2024 PHB Completion

**Status**: Partial

- Complete weapon mastery implementation
- Add all 2024 species
- Update backgrounds to 2024 structure
- Implement 2024 exhaustion rules

---

## Medium-Term Goals (Next Quarter)

### Code Modularization

Split `charactersheet-state.js` (~23,400 lines) into focused modules:

```
js/charactersheet/
├── state/
│   ├── CharacterSheetState.js        # Core state class
│   ├── AbilityScoreManager.js        # Ability score logic
│   ├── ClassFeatureCalculator.js     # getFeatureCalculations() 
│   ├── SpellSlotCalculator.js        # Spell slot logic
│   ├── CombatStatsCalculator.js      # AC, initiative, etc.
│   └── index.js                      # Re-export all
├── parsers/
│   ├── FeatureUsesParser.js
│   ├── NaturalWeaponParser.js
│   ├── SpellGrantParser.js
│   └── FeatureModifierParser.js
└── state-types/
    └── ActiveStateTypes.js           # ACTIVE_STATE_TYPES
```

Benefits:
- Easier navigation
- Better test isolation
- Improved maintainability
- Enable code splitting

### Performance Optimization

1. **Memoize `getFeatureCalculations()`**
   ```javascript
   _cachedCalculations = null;
   _cacheKey = null;
   
   getFeatureCalculations() {
       const key = this._computeCacheKey();
       if (this._cachedCalculations && this._cacheKey === key) {
           return this._cachedCalculations;
       }
       this._cachedCalculations = this._computeFeatureCalculations();
       this._cacheKey = key;
       return this._cachedCalculations;
   }
   ```

2. **Selective UI updates**
   - Only re-render changed sections
   - Use virtual DOM diffing pattern
   - Batch related updates

3. **IndexedDB for large saves**
   - Move from localStorage
   - Support larger character collections
   - Enable better backup/restore

### Enhanced Mobile Experience

- Touch-optimized controls
- Swipe navigation between tabs
- Collapsed sections by default
- Quick-action floating buttons

### Item Upgrade Combat Integration

Wire upgrade bonuses into combat attack/damage calculations:

- `getEffectiveItemBonuses()` already computes combined base + upgrade bonuses
- Combat module should call this instead of reading raw item properties
- Armor upgrades should auto-apply AC/stealth modifiers
- Gemstone effects should appear in the combat feature list
- Superior upgrade (die increase) should reflect in weapon damage display

---

## Long-Term Vision (Next Year)

### Cloud Sync (Optional)

Allow users to optionally sync characters:

```
Features:
- Cross-device access
- Automatic backup
- Share characters (read-only links)
- Campaign integration

Privacy:
- Opt-in only
- Local-first (sync is additive)
- Export/delete all data anytime
```

### Progressive Web App (PWA)

Full offline support with installation:

```javascript
// Service worker for offline caching
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open('5etools-charsheet-v1').then(cache => {
            return cache.addAll([
                '/charactersheet.html',
                '/js/charactersheet/*.js',
                '/css/charactersheet.css',
                // Critical data files
            ]);
        })
    );
});
```

### Advanced Combat Tracker

Integration with initiative tracker:

- Import character to combat
- Real-time HP/resource sync
- ✅ Active state duration tracking with round counter and auto-expire
- ~~Condition tracking with countdown~~ ✅ Implemented (states auto-deactivate when rounds expire)
- Turn order integration

### Character Generation Wizard

Guided character creation:

```
Step 1: Concept
- Name, backstory prompts
- Random name generation

Step 2: Species
- Visual species browser
- Trait explanations
- Ability score application

Step 3: Class
- Class comparison
- Subclass preview
- Equipment packages

Step 4: Background
- Background picker
- Skill/tool selection
- Personality generation

Step 5: Abilities
- Point buy calculator
- Standard array
- Rolled scores

Step 6: Details
- Equipment selection
- Spell selection
- Final review
```

### Print/Export Improvements

- **PDF export**: Native PDF generation
- **Form-fillable PDF**: Editable exports
- **VTT export**: Roll20, Foundry formats
- **D&D Beyond export**: One-way sync

### Homebrew Tools

Enhanced homebrew support:

- Visual feature builder
- Toggle ability creator
- Custom class wizard
- Spell creator with validation

---

## Community Wishlist

Features requested by users (not yet prioritized):

| Feature | Votes | Complexity |
|---------|-------|------------|
| Character portraits | High | Low |
| Dice roller integration | High | Medium |
| Session notes | Medium | Low |
| Magic item attunement tracking | Medium | Low |
| Companion/familiar sheet | Medium | High |
| Custom resources | Medium | Medium |
| Spell slot recovery tracking | Low | Low |
| Multi-character campaigns | Low | High |
| Character leveling automation | Low | High |

---

## Technical Investigations

Areas requiring research before implementation:

### WebWorkers for Calculations

Offload heavy calculations to background thread:

```javascript
// Main thread
const worker = new Worker('charactersheet-worker.js');
worker.postMessage({type: 'calculate', data: state.getData()});
worker.onmessage = (e) => {
    applyCalculations(e.data);
};
```

Challenges:
- State synchronization
- Worker initialization overhead
- Browser compatibility

### Real-time Collaboration

Multiple users editing same character:

- CRDT-based conflict resolution
- WebSocket sync
- Operational transformation

Challenges:
- Complex merge scenarios
- Server infrastructure
- User experience for conflicts

### Machine Learning for Character Optimization

AI-assisted character building:

- Suggest optimal ability scores
- Recommend spell selections
- Identify synergistic features

Challenges:
- Model training data
- Integration complexity
- Balancing guidance vs. player agency

---

## Contributing to Roadmap

### How to Propose Features

1. Open GitHub issue with `[Feature Request]` prefix
2. Describe use case and benefit
3. Include mockups/examples if applicable
4. Community discusses and votes

### How to Claim Work

1. Comment on issue to express interest
2. Discuss approach with maintainers
3. Submit PR following [Contributing Guide](./12-contributing-guide.md)
4. Iterate based on review feedback

### Prioritization Criteria

| Factor | Weight |
|--------|--------|
| User impact | High |
| Implementation effort | Medium |
| Test coverage | Medium |
| Code quality impact | Medium |
| Maintainability | Low |

---

*Previous: [Known Limitations](./10-known-limitations.md) | Next: [Contributing Guide](./12-contributing-guide.md)*
