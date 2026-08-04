# Architecture Reference

## Contents
- Module Map
- Data Flow (Initialization, Update Cycle, Event Communication, Module Init Order)
- CSS Conventions
- Modals
- Data Validation Patterns
- State Serialization
- Key Integration Points
- Parsers
- FeatureEffectRegistry
- Global Dependencies
- Console Logging Convention

## Module Map

```
CharacterSheetPage (charactersheet.js, ~6,500 lines)
│   Entry point & orchestrator. Loads all data, initializes modules,
│   manages save/load, routes events.
│
├── CharacterSheetState (charactersheet-state.js, ~23,400 lines)
│   Single source of truth. All character data + computed values.
│   Contains: parsers, FeatureEffectRegistry, ACTIVE_STATE_TYPES,
│   getFeatureCalculations(), all getter/setter pairs.
│
├── CharacterSheetBuilder (charactersheet-builder.js, ~6,500 lines)
│   Character creation wizard (multi-step): race, class, abilities,
│   background, feats, proficiencies, spells.
│   Uses: ClassUtils, SpellPicker
│
├── CharacterSheetLevelUp (charactersheet-levelup.js, ~4,000 lines)
│   Single-level advancement. HP, ASI/feat, subclass, spells,
│   optional features, expertise, languages.
│   Uses: ClassUtils, SpellPicker
│   NOTE: Active refactor — helpers being extracted to ClassUtils.
│
├── CharacterSheetQuickBuild (charactersheet-quickbuild.js, ~3,000 lines)
│   Multi-level build (1→N). Batch collects all decisions then applies
│   them at once. Entry from Builder or header button.
│   Uses: ClassUtils, SpellPicker
│
├── CharacterSheetCombat (charactersheet-combat.js, ~3,900 lines)
│   Attacks, damage, initiative, death saves, conditions,
│   concentration, combat methods (Thelemar), turn action tracking.
│
├── CharacterSheetSpells (charactersheet-spells.js, ~3,300 lines)
│   Spell slots, known/prepared/cantrip tracking, casting,
│   ritual casting, spell rarity (Thelemar).
│
├── CharacterSheetInventory (charactersheet-inventory.js, ~2,300 lines)
│   Items, equipment, attunement (max 3), encumbrance, currency,
│   charges, consumables, pagination.
│
├── CharacterSheetFeatures (charactersheet-features.js, ~1,600 lines)
│   Feature display, resource pip tracking, feat picker,
│   description lookup.
│
├── CharacterSheetRest (charactersheet-rest.js, ~630 lines)
│   Short rest (hit dice spending), long rest (full recovery),
│   condition removal, spell slot restoration.
│
├── CharacterSheetCustomAbilities (charactersheet-customabilities.js, ~800 lines)
│   Custom homebrew abilities with icons, categories, effects.
│
├── CharacterSheetNpcExporter (charactersheet-npc-exporter.js, ~1,500 lines, all static)
│   Convert character to 5etools monster statblock JSON.
│
├── CharacterSheetExport (charactersheet-export.js, ~320 lines)
│   JSON import/export, print/PDF entry points, delegates to NpcExporter.
│
├── CharacterSheetPdf (charactersheet-pdf.js)
│   Print-optimized self-contained HTML (browser Save as PDF). Notes,
│   appearance/portrait, resources, custom abilities, TGTT, companions.
│
├── CharacterSheetRespec (charactersheet-respec.js, ~600 lines)
│   Level history timeline display. Edit functionality planned.
│
├── CharacterSheetLayout (charactersheet-layout.js, ~800 lines)
│   Drag-drop section reordering, layout persistence.
│
├── CharacterSheetNotes (charactersheet-notes.js, ~500 lines)
│   Sticky notes per entity and per tab (5 colors).
│
├── CharacterSheetPlayMode (charactersheet-playmode.js, ~1,860 lines)
│   Intent-based alternative UI for gameplay. Togglable view mode.
│   Status bar, character panel, actions hub, 6 drawers,
│   favorites, action economy, smart damage flow, upcast picker,
│   rest preview, activity feed, combat tracker, concentration checks.
│   Reads from same state, delegates all mutations to existing modules.
│
├── CharacterSheetSpellPicker (charactersheet-spell-picker.js, ~1,200 lines, all static)
│   Reusable spell selection UI for Builder, LevelUp, QuickBuild.
│
├── Spawner (charactersheet-spawn.js / -prompts.js / -autofill.js / -drivers.js)
│   Builds a complete character from a spec string ("cleric/tempest/9/dwarf")
│   by driving the REAL Builder + Quick Build engines — no parallel build path.
│   Surfaces: right-click New Character, ?spawn= URL, charSheet.spawn(),
│   `npm run spawn`. See docs/charactersheet/15-spawn-test-characters.md.
│
├── charactersheet-buffpicker-helpers.js (~170 lines, pure functions)
│   No-DOM helpers backing the Apply Buff modal: categorise, chip,
│   duration format, active-detection. Imported by charactersheet.js.
│
└── CharacterSheetClassUtils (charactersheet-class-utils.js, ~1,800 lines, all static)
    Shared helpers: ASI levels, subclass levels, hit die, spell ability,
    feature options, expertise parsing, language grants.
    Growing as methods are extracted from LevelUp.
```

## Data Flow

### Initialization
1. `charactersheet.html` loaded
2. `CharacterSheetPage.pInit()` fires
3. Parallel data load from 12+ JSON sources (races, classes, spells, items, feats, backgrounds, optional features, etc.)
4. Brew data merged into `this._classes` / `this._subclasses` / etc. (`_mergeBrewData`)
5. **`_copy` resolution**: every entry in `this._subclasses` and `this._classes` that carries a `_copy` block is merged in place via `DataUtil.subclass.pMergeCopy` / `DataUtil.class.pMergeCopy`. This is what gives TGTT subclasses like Chronurgy Magic and Divine Soul their inherited `additionalSpells` blocks — without this step, every spell picker would silently miss subclass-granted spells (Gift of Alacrity, Guidance, etc.). Runs AFTER brew merge so brew-added entities are included, BEFORE state setup so the picker code sees fully-merged data. As defense-in-depth, `globalThis._charSheetSubclassMergePool` is set to `this._subclasses` immediately after the eager merge so `CharacterSheetClassUtils.resolveFullSubclass` can lazy-merge any entry that still arrives with an unresolved `_copy` at picker call time; the recovery is announced via a single `[CharSheet][Phase7]` console.warn so the silent failure surfaces.
6. Sub-modules instantiated with error isolation (try/catch per module)
7. Saved characters loaded from IndexedDB
8. UI rendered

### Update Cycle
```
User action → Module event handler → state.setX() → module.render() → page.saveCharacter()
```

No reactive system — renders are explicit. Related modules re-render together (e.g., adding a feature triggers combat + features re-render).

### Event Communication

- **Vanilla DOM events**: Handlers bound via `element.addEventListener("click", handler)`. Event delegation uses `e.target.closest(".selector")` pattern.
- **No pub-sub or custom events**: State changes are direct method calls (`this._state.setName(x)`)
- **Manual re-renders**: Modules call `_renderXxx()` — forgetting is a common source of stale UI bugs
- **Toast notifications**: `JqueryUtil.doToast({type: "success", content: "..."})` for user feedback (site-wide utility, not jQuery-dependent despite the name)
- **HTML generation**: `e_({outer: \`<button class="btn">...</button>\`})` for single elements, `ee\`<div>...</div>\`` tagged template for complex HTML. `insertAdjacentHTML()` for appending HTML strings.

### Module Init Order

Modules are initialized sequentially with try/catch isolation (one failing doesn't break others):
1. Builder (first — needs class/race data)
2. LevelUp
3. Spells (needs DataUtil for spell filtering)
4. Combat
5. Features (needs class data loaded)
6. Inventory
7. Rest
8. Custom Abilities
9. Layout, Export, Notes, Respec

### CSS Conventions

BEM-like naming: `.charsheet__element--modifier`
- Layout: `.charsheet__main-header`, `.charsheet__tab-content`
- Buttons: `.charsheet__icon-btn--danger`, `.charsheet__toggle-btn--active`
- Utility classes from 5etools: `.ve-flex-col`, `.w-100`, `.no-wrap`, `.my-0`
- Four stylesheets: `charactersheet.css` (layout/main sheet), `charactersheet-modern.css`
  (design tokens + aesthetics), `charactersheet-playmode.css` (Alt View / `pm-*`),
  `charactersheet-mobile.css` (`<768px`).

#### Design tokens & light mode (Day Mode)

- All colours flow through `--cs-*` design tokens defined in `charactersheet-modern.css`.
  `:root` holds the **dark-mode** values; the sheet was originally dark-only.
- **The sheet follows the site's Day/Night toggle automatically** — there is no
  separate character-sheet theme switch. `StyleSwitcher` (`js/styleswitch.js`) adds
  `.ve-night-mode` to `<html>` for night themes; **Day mode carries no class**. So
  `:root:not(.ve-night-mode)` / `html:not(.ve-night-mode)` reliably means "site is in
  day mode" (it also resolves the "auto" theme against the OS).
- **Light mode is purely additive** — night mode must stay byte-for-byte unchanged.
  The day-mode layer lives in a `:root:not(.ve-night-mode) { … }` token block in
  `charactersheet-modern.css` (overrides `--cs-bg-*`, `--cs-text-*`, `--cs-border`,
  shadows, tints, and *deepens* solid accent tokens like `--cs-warning`/`--cs-success`
  so coloured text stays legible on a white canvas). It also defines the ~35 tokens
  that were referenced via `var(--token, fallback)` but never actually defined, so day
  mode resolves them instead of falling back to a dark-oriented colour.
- **Adding new styles:** prefer `var(--cs-*)` tokens — they get light mode for free.
  When a component hardcodes a dark-oriented value (white text on a transparent/pale
  badge, bright `#f59e0b`/`#10b981`-style accent text on a tint, a `rgba(255,255,255,…)`
  inset/border, etc.), add a **day-mode-only** override scoped with
  `:root:not(.ve-night-mode) …` rather than changing the base rule. These overrides are
  grouped in a "Light mode (Day Mode)" section at the end of each of the three
  component stylesheets. Watch specificity: `:root:not(.ve-night-mode) .x` = (0,3,0),
  and scope button-vs-text carefully when a class is reused (e.g.
  `.ve-btn.charsheet__attack-damage` for the red button, but not the damage-value text
  label that shares `.charsheet__attack-damage`).
- Verify both themes after colour changes: toggle Day/Night via the site's style switcher
  (`styleSwitcher._setActiveStyleTheme('day'|'night')`) and confirm night mode is visually
  identical to before.

#### CSS traps that fail silently

Three failure modes in this codebase produce **no console warning and no visual error** —
the rule simply does nothing. Check for them before debugging further:

1. **`var(--rgb-…)` is almost always dead.** The site defines exactly six `--rgb-*`
   custom properties, all with *double-hyphen* modifiers: `--rgb-bg`, `--rgb-bg--alt`,
   `--rgb-font`, `--rgb-font--muted`, `--rgb-name`, `--rgb-border--statblock`. Every
   single-hyphen spelling used across the character sheet (`--rgb-bg-alt`,
   `--rgb-text-dim`, `--rgb-text-muted`, `--rgb-border`, `--rgb-border-grey`,
   `--rgb-link`, …) is **undefined**, and per spec a `var()` on an undefined property
   with no fallback makes the whole declaration invalid at computed-value time — it is
   silently dropped. ~540 such references exist; ~100 were the *only* source for their
   declaration, i.e. those rules never did anything. A scoped compatibility alias block
   on `body.is-charsheet-page` in `charactersheet-modern.css` now maps every dead name
   onto its `--cs-*` equivalent. **Write `--cs-*` in new code; do not extend the alias
   block.** To check a token is live: `getComputedStyle(document.documentElement)
   .getPropertyValue('--token')` — an empty string means undefined.

2. **`.ve-flex-h-between` does not exist.** Only `.ve-flex-h-center` and
   `.ve-flex-h-right` are defined (`scss/includes/util.scss`). The `-between` variant is
   a plausible-looking invention that appears in JS-authored markup and is a pure no-op,
   collapsing "Wild Shape · 2 / 2" into "Wild Shape2 / 2". **Use `ve-split-v-center`**
   for a space-between row (it is what the modal header uses).

3. **Layered `!important` beats unlayered `!important`.** The compiled site CSS wraps
   everything in `@layer vetools`, and utilities like `.ve-muted` / `.ve-flex-col` are
   `!important` inside it. An unlayered override — even with higher specificity and its
   own `!important` — **loses**. Either wrap the override in `@layer vetools { … }` or,
   usually cleaner, stop applying the utility class in the JS that builds the markup.

#### Multi-host panels

A panel rendered into more than one column (e.g. the Metamagic dashboard, which the
Combat, Spells *and* Overview tabs all render from one code path) must adapt to its
**container**, not to its host tab. Add `.cs-adaptive-panel` to the panel root
(`container-type: inline-size; container-name: cs-panel`, defined near the top of
`charactersheet.css`) and put the narrow layout in
`@container cs-panel (max-width: 380px)`. Never branch on the tab name, and never put
`text-overflow: ellipsis` on an element that is allowed to wrap — it can't fire, and the
`overflow: hidden` it drags along will clip the content instead. See
[DESIGN.md](../../../../DESIGN.md) §5 "The Container-Adaptive Rule".

`z-index` reads from the semantic `--cs-z-*` scale in `charactersheet-modern.css`
(`base` 0 → `raised` 10 → `sticky` 100 → `overlay`/`modal` 1000/1001 → `scrim` 1039 →
`panel` 1040 → `banner` 1045 → `tabbar` 1050 → `toast` 1060 → `tooltip` 1070). A fixed
layer also owes clearance to what it covers: the mobile tab bar publishes
`--cs-tabbar-height` (with `env(safe-area-inset-bottom)`), and scrollers it can occlude
pad by that value rather than re-stacking shared site chrome.

## Modals

**Never call `UiUtil.pGetShowModal` from character-sheet code.** Use
`CharacterSheetModal.pGetShow` (`js/charactersheet/charactersheet-modal.js`) — identical signature
and return shape, so migrating a call site is a rename and nothing else.

The wrapper adds what no individual dialog should have to remember:

| Adds | Why |
|---|---|
| `role="dialog"`, `aria-modal="true"`, `aria-labelledby` on the header | Otherwise a screen reader reads the page behind the modal |
| A close **X** in the header, via `eleTitleSplit` | `UiUtil` only renders one under `isFullscreenModal`, which *also* swaps in an overlay blind and fullscreen header/footer variants — far too much to opt into for a button |
| Escape that works **from inside an input** | `UiUtil`'s document-level handler bails on `EventUtil.isInInput`, and several sheet modals autofocus a search field on open |
| A Tab focus trap scoped to `eleModal` | |
| Focus restored to the element that opened the modal | Without it focus lands on `<body>` and keyboard users restart from the top of the page |
| `.cs-modal` on `eleModal` | The styling hook that gives modals the sheet's font and muted-text token — modals are portalled to `document.body`, outside `.charsheet-page` |

Escape hatch: `opts.isSkipCharacterSheetEnhancements` behaves exactly like the raw `UiUtil` call.

### Four things about it are load-bearing

1. **`UiUtil.pGetShowModal` is resolved at call time, never captured at module load.**
   `CharacterSheetSpawnPrompts` monkey-patches that method to auto-answer dialogs during `?spawn=`
   builds and E2E runs; a captured reference silently bypasses the patch and hangs the harness.
2. **`eleModal` may be absent.** The spawn harness's fallback stub returns only `eleModalInner`,
   `doClose`, `pGetResolved` and `doAutoResize`, so every enhancement is guarded by an early return.
3. **A caller's `cbClose` is composed with, never replaced** — dozens of sites use it to persist
   state. Focus restore runs *after* the caller's callback, so a follow-up modal's own trigger
   capture wins.
4. **`.cs-modal` is not `.cs-adaptive-panel`.** `container-type: inline-size` implies inline-size
   containment, and most sheet modals size to their content, so containerising the shell collapses
   it to zero width. A content root **inside** an `isWidth100` modal may opt in individually.

`CharacterSheetModal.test.js` locks the whole contract, including the missing-`eleModal` guard and
the `cbClose` composition.

### Data Validation Patterns

- **Defensive nullish coalescing everywhere**: `spell?.name?.toLowerCase()`, `Math.max(0, Math.floor(Number(x) || 0))`
- **Guard clauses for arrays**: `if (!Array.isArray(x) || !x.length)` before accessing
- **NPC exporter validates heavily**: Type checks, array validation, regex for dice notation
- **Missing field handling in load**: Deep merge with defaults ensures all nested objects exist

### State Serialization
- `toJson()`: Deep copy of `_data` via `MiscUtil.copyFast()`
- `loadFromJson(json)`: Deep merge with defaults + migration steps + effect re-application
- Migration handles: legacy features, combat traditions, custom ability effects, unarmed strike

## Key Integration Points

| Module A | Module B | Relationship |
|----------|----------|-------------|
| Builder | ClassUtils | Static data queries (ASI levels, hit die, etc.) |
| Builder | SpellPicker | Known spell / cantrip selection |
| LevelUp | ClassUtils | Feature extraction, expertise, languages |
| LevelUp | SpellPicker | Spell selection at level up |
| QuickBuild | ClassUtils + SpellPicker | Same as above, batched |
| Combat | State | getBonusFromStates(), conditions, AC |
| Rest | State | HP recovery, slot restoration, hit dice |
| NpcExporter | State | Read-only conversion to monster format |
| Features | State | getFeatureCalculations(), resource tracking |

## Parsers (in charactersheet-state.js)

Four parser classes extract mechanical data from feature description text:

| Parser | Purpose | Output |
|--------|---------|--------|
| `FeatureUsesParser` | "X times per long rest" | `{uses, per, rechargeOn}` |
| `NaturalWeaponParser` | Natural weapon stats | `{damage, type, ability, range}` |
| `SpellGrantParser` | Spells granted by features | `{spells[], level, castingAbility}` |
| `FeatureModifierParser` | Stat modifications | `{modifiers[{type, target, value}]}` |

## FeatureEffectRegistry (in charactersheet-state.js)

Maps ~150+ feature names to standardized effect objects. Used to auto-detect effects when features are added:

```javascript
FeatureEffectRegistry.getEffects("Rage") 
// → [{type: "resistance", target: "bludgeoning"}, ...]
```

Effect types: `resistance`, `immunity`, `conditionImmunity`, `saveProficiency`, `skillProficiency`, `sense`, `speed`, `language`, `acBonus`, `damageBonus`, `advantage`, `disadvantage`.

## Global Dependencies

The character sheet modules depend on these 5etools globals (mocked in tests):
- `Parser` — ability abbreviations, spell levels, source constants
- `MiscUtil` — deep copy, property access
- `CryptUtil` — UID generation
- `Renderer` — entry rendering to HTML
- `StorageUtil` — local storage access
- `UrlUtil` — URL construction
- `RollerUtil` — crypto detection
- `e_()` / `ee` / `es()` / `em()` — vanilla DOM helpers from `js/utils.js` (element creation, querySelector wrappers)
- `JqueryUtil` — toast notifications (`doToast`) — site-wide utility, not jQuery-dependent despite the name
- `DataUtil` — async data loading for spells, items, races, classes

## Console Logging Convention

All modules use a consistent prefix pattern:
```
[CharSheet State] message
[LevelUp] Leveling Fighter from 4 to 5
[Combat] Applying sneak attack damage
```
- `console.warn()` = non-fatal (fallback works, data missing)
- `console.error()` = module-breaking failure
