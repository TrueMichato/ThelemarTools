# Character Sheet System Documentation

Welcome to the 5etools Character Sheet system documentation. This comprehensive guide is designed for developers who want to understand, maintain, or extend the character sheet functionality.

## Quick Navigation

| Document | Description |
|----------|-------------|
| [Overview & Goals](./01-overview-and-goals.md) | High-level vision, design philosophy, and system aspirations |
| [Architecture](./02-architecture.md) | System architecture, module relationships, and data flow |
| [Components Reference](./03-components-reference.md) | Detailed reference for each module and its responsibilities |
| [State Management](./04-state-management.md) | How character data is stored, computed, and synchronized |
| [Feature Calculations](./05-feature-calculations.md) | How class/race/subclass features are computed |
| [Combat System](./06-combat-system.md) | Combat mechanics, attacks, and conditions |
| [Spellcasting](./07-spellcasting.md) | Spell slots, preparation, and casting mechanics |
| [Toggle Abilities](./08-toggle-abilities.md) | Activatable abilities like Rage, Bladesong, and stances |
| [Testing Strategy](./09-testing-strategy.md) | Test organization, patterns, and best practices |
| [Known Limitations](./10-known-limitations.md) | Current shortcomings and technical debt |
| [Future Roadmap](./11-future-roadmap.md) | Planned improvements and enhancement opportunities |
| [Contributing Guide](./12-contributing-guide.md) | How to add features, tests, and documentation |
| [TGTT Homebrew](./13-tgtt-thelemar-homebrew.md) | Thelemar homebrew: rules, classes, methods, tactics |
| [Design System Overhaul](./14-design-system-overhaul.md) | Visual/UX redesign: token layer, the two surfaces, Combat Section Shell, governing rules |
| [Spawning Test Characters](./15-spawn-test-characters.md) | One-line character creation for manual testing and bug repros: spec DSL, seeds, the four surfaces |
| [Talent & Psionics](./17-talent-psionics.md) | MCDM Talent base class: psionic strain, manifestation tests, generic power/exertion pickers, Chronopath |
| [NPC Export](./18-npc-export.md) | Character → bestiary monster conversion, export options, CR, legendary framing, brew save |
| [Ioun Stones](./20-ioun-stones.md) | MECIounStones and official-stone parity: attunement exemption, orbit/bond manager, item conditional modifiers, effect-implementation audit |
| [Item Materials](./21-item-materials.md) | Thelemar item materials: the 72 `itemMaterial` entities, the six axes, the read-time projection, the damage die ladder, and the picker/custom-item/craft entry points |

## System at a Glance

The Character Sheet is a comprehensive D&D 5th Edition character management tool built as part of the 5etools ecosystem. It supports:

- **Official Content**: PHB, XPHB (2024), all supplements
- **Homebrew Content**: Including TGTT (Thelemar), Level Up A5E, Grim Hollow
- **Full Character Lifecycle**: Creation, leveling, combat, rest, import/export

### Key Statistics

| Metric | Value |
|--------|-------|
| Source Files | 11 modules (~53,000 lines) |
| Test Files | 37 test suites |
| Total Tests | 4,175+ tests |
| TGTT Tests | 737 tests |
| Test Coverage | High (core mechanics) |

## File Structure

```
5etools-src/
├── js/charactersheet/
│   ├── charactersheet.js           # Main controller (6,528 lines)
│   ├── charactersheet-state.js     # State management (23,436 lines)
│   ├── charactersheet-builder.js   # Character creation wizard (6,487 lines)
│   ├── charactersheet-combat.js    # Combat mechanics (3,934 lines)
│   ├── charactersheet-spells.js    # Spellcasting (3,288 lines)
│   ├── charactersheet-inventory.js # Items & equipment (2,315 lines)
│   ├── charactersheet-features.js  # Features & feats (1,586 lines)
│   ├── charactersheet-levelup.js   # Level progression (3,994 lines)
│   ├── charactersheet-rest.js      # Short/long rest (630 lines)
│   ├── charactersheet-export.js    # Import/export (321 lines)
│   └── charactersheet-layout.js    # UI customization (617 lines)
├── test/jest/charactersheet/
│   ├── CharacterSheetState.test.js
│   ├── CharacterSheet[Class].test.js  # Per-class tests
│   ├── CharacterSheetCombat.test.js
│   ├── CharacterSheetSpells.test.js
│   └── ... (37 test files total)
├── charactersheet.html             # Entry point
└── docs/charactersheet/            # This documentation
```

## Quick Start for Developers

### Running Tests

```bash
# All character sheet tests
NODE_OPTIONS='--experimental-vm-modules' npx jest test/jest/charactersheet/ --no-coverage

# Specific test file
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetState --no-coverage

# With verbose output
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetBarbarian --no-coverage --verbose
```

### Key Entry Points

1. **Main Page Controller**: `charactersheet.js` - Start here to understand how modules connect
2. **State Management**: `charactersheet-state.js` - Core data model and calculations
3. **Feature Calculations**: `getFeatureCalculations()` in state.js - Class/subclass mechanics

### Adding a New Feature

1. Add calculation logic to `getFeatureCalculations()` in `charactersheet-state.js`
2. Write tests in the appropriate `CharacterSheet[Class].test.js`
3. Update UI rendering in the relevant module (combat, spells, etc.)
4. Document any non-obvious behavior

## Support

- **Bug Reports**: See the main 5etools repository issues
- **Questions**: Check existing documentation first, then ask in discussions
- **Contributions**: Follow the contributing guide

---

*This documentation is maintained alongside the codebase. Last updated: February 2026*
