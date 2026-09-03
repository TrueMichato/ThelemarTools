# Overview and Goals

## Vision Statement

The 5etools Character Sheet aims to be the most comprehensive, accurate, and user-friendly digital character sheet for D&D 5th Edition, supporting both official and homebrew content while maintaining full mechanical accuracy.

## Design Philosophy

### 1. **Data-Driven Architecture**

The system is built on a principle of deriving mechanical effects from source data rather than hard-coding behavior. This means:

- Features are parsed from their text descriptions when possible
- New content can often work without code changes
- The same parsing logic handles official and homebrew content

```javascript
// Example: Feature effects are parsed from description text
static parseEffectsFromDescription(description) {
    // Parses "+2 to AC", "advantage on Strength saves", etc.
    // Works with any content source
}
```

### 2. **Separation of Concerns**

Each module handles a specific domain:

| Module | Responsibility |
|--------|----------------|
| `state.js` | Data storage and computation |
| `combat.js` | Combat actions and rolls |
| `spells.js` | Spellcasting mechanics |
| `inventory.js` | Items and equipment |
| `party-inventory.js` | Owner-only cloud campaign stash and authoritative transfer coordination |
| `features.js` | Feature display and tracking |

### 3. **Progressive Enhancement**

The system provides value at multiple levels:

1. **Basic**: Store character data, display stats
2. **Intermediate**: Calculate derived values, track resources
3. **Advanced**: Roll dice, apply effects, manage combat

Campaign-backed owner sheets progressively add a separate Party Stash inventory section. It refetches
server-authoritative stacks on open, reconnect, and relevant transfer events, and adopts authoritative character
changes through the cloud repository. Local, signed-out, detached, and non-owner sheets do not mount the section
or install its Hub listeners.

### 4. **Backward Compatibility**

New features should not break existing saved characters. The serialization format (`toJson()`/`loadFromJson()`) includes version markers and migration support.

## Goals

### Primary Goals

1. **Mechanical Accuracy**
   - All calculations match official rules
   - Edge cases handled correctly (multiclassing, optional rules)
   - Both PHB 2014 and XPHB 2024 rules supported

2. **Comprehensive Coverage**
   - All official classes, races, backgrounds
   - All subclasses with mechanical calculations
   - Feats, optional features, and variant rules

3. **Homebrew Support**
   - TGTT (Thelemar) homebrew integration
   - Level Up A5E combat maneuver system
   - Extensible for other homebrew

4. **User Experience**
   - Intuitive character creation wizard
   - Quick access to combat actions
   - Clear display of all character information

### Secondary Goals

1. **Performance**
   - Fast load times even with complex characters
   - Efficient recalculation on state changes
   - Minimal memory footprint

2. **Offline Support**
   - Characters saved locally
   - Works without internet after initial load

3. **Accessibility**
   - Keyboard navigation
   - Screen reader support
   - Mobile-responsive design

## Aspirations

### Short-Term (Current Development)

- [ ] Complete subclass mechanical implementations
- [ ] Improve toggle ability detection for homebrew
- [ ] Better multiclass spellcasting support
- [ ] Enhanced combat tracking

### Medium-Term

- [ ] Party management (multiple characters)
- [ ] DM tools integration
- [ ] Campaign note storage
- [ ] Encounter integration

### Long-Term Vision

- [ ] Real-time collaboration (shared party sheets)
- [ ] Integration with virtual tabletops
- [ ] AI-powered feature effect extraction
- [ ] Character art/portrait support

## What This System Is NOT

To set proper expectations:

1. **Not a Rules Reference**: It calculates stats but doesn't teach the rules
2. **Not a VTT**: Combat is tracked but not visualized on a map
3. **Not a Character Builder App**: No drag-and-drop point allocation UI (yet)
4. **Not Officially Licensed**: Community project, no WotC affiliation

## Success Metrics

The system is successful when:

1. **Tests Pass**: All ~3,200 tests pass consistently
2. **Calculations Correct**: Manual verification matches automated results
3. **Users Happy**: Positive feedback, active usage
4. **Maintainable**: New contributors can understand and extend
5. **Fast**: Character operations complete in under 100ms

## Guiding Principles

When making design decisions, prioritize in this order:

1. **Correctness** - Wrong calculations are worse than missing features
2. **Completeness** - More content support is better
3. **Performance** - Fast is better than slow
4. **Elegance** - Clean code is easier to maintain
5. **Features** - New capabilities expand usefulness

---

*Next: [Architecture](./02-architecture.md)*
