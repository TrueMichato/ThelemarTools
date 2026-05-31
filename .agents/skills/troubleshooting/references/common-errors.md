# Common Errors & Troubleshooting Reference

Comprehensive catalog of errors encountered across the 5etools project — site data/schema, character sheet, DM screen, and tests. Every entry is sourced from real bugs, investigations, and commit history.

---

## A. Test Errors

### A1. Import Order → ReferenceError

**Symptom**: `ReferenceError: CharacterSheetClassUtils is not defined` (or similar) when running Jest tests.

**Root Cause**: Character sheet modules assign to `globalThis`. If `charactersheet-state.js` calls `CharacterSheetClassUtils`, you must import `charactersheet-class-utils.js` **before** `charactersheet-state.js` in the test file.

**Fix**: Order imports by dependency chain:
```javascript
// CORRECT — deps first
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
const CharacterSheetState = globalThis.CharacterSheetState;

// WRONG — will crash
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
```

### A2. Weak Assertions (False-Green Tests)

**Symptom**: Tests pass but don't actually verify mechanics.

| Anti-Pattern | Why It Fails | Fix |
|-------------|-------------|-----|
| `expect(state.getTotalLevel()).toBe(3)` | Just echoes setup, tests nothing | Assert on `getFeatureCalculations()` properties |
| `expect(true).toBe(true)` placeholder | Always passes | Write real mechanical assertions |
| String-matching feature presence | Brittle, no mechanics check | Assert on computed values from `calculations` |

**Correct pattern**:
```javascript
it("should produce 2 elixirs at level 6", () => {
    state.addClass({name: "Artificer", level: 6, subclass: {name: "Alchemist"}});
    const calc = state.getFeatureCalculations();
    expect(calc.experimentalElixirCount).toBe(2);
});
```

### A3. DOM Queries Return null in Tests

**Symptom**: Code that uses `document.querySelector()` silently returns `null` in Jest — tests pass with wrong behavior.

**Root Cause**: No jsdom in test environment. `setup.js` provides minimal mocks but no real DOM.

**Fix**: Tests should verify state/calculations, not DOM output. If DOM testing is needed, mock the specific elements.

### A4. Missing Jest Flags

**Symptom**: Tests hang, crash, or fail with module errors.

**Required flags**:
```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest [tests] --no-coverage --forceExit
```

- `--experimental-vm-modules`: Required for ES module support
- `--forceExit`: Tests hang without it due to async cleanup
- `--no-coverage`: Speeds up test runs significantly

### A5. getFeatureCalculations() Called Per-Assertion

**Symptom**: Slow tests, redundant computation.

**Root Cause**: `getFeatureCalculations()` is not memoized — every call recomputes by traversing all classes.

**Fix**: Call once, assert on the returned object:
```javascript
// CORRECT
const calc = state.getFeatureCalculations();
expect(calc.rageDamage).toBe(2);
expect(calc.rageUses).toBe(3);

// SLOW — recomputes each time
expect(state.getFeatureCalculations().rageDamage).toBe(2);
expect(state.getFeatureCalculations().rageUses).toBe(3);
```

### A6. Missing setup.js Mocks

**Symptom**: `TypeError: Parser.X is not a function` or similar in tests.

**Root Cause**: `setup.js` provides `Parser`, `MiscUtil`, `CryptUtil`, `Renderer`, `StorageUtil`, `UrlUtil`, `RollerUtil` — but not every method.

**Fix**: Add missing mock methods to `test/jest/charactersheet/setup.js` rather than stubbing inline in each test.

---

## B. State Management Errors

### B1. Ability Score Base vs Total

**Symptom**: Wrong ability scores, modifier calculations off by racial/item bonuses.

**Root Cause**: Two separate fields:
- `_data.abilities.str` — **base** score (default 10)
- `_data.abilityBonuses.str` — racial/item bonuses

**Fix**: Never read `_data.abilities.str` for total. Always use:
- `getAbilityScore("str")` → base + bonus (total)
- `getAbilityMod("str")` → `Math.floor((total - 10) / 2)`

### B2. No Reactive UI — Stale Display

**Symptom**: State updated but UI doesn't change.

**Root Cause**: No data binding framework (no Vue/React). After `state.setX()`, modules must call `render()` or `updateDisplay()` manually.

**Fix**: After every state mutation, call the appropriate render method. Common methods:
- `_renderActiveStates()`, `_renderSpells()`, `_renderInventory()`
- `_refreshAll()` (Party Tracker)
- `_reRenderCurrentTab()` (Journey Tracker)

### B3. Save/Load Migration — New Fields Break Old Saves

**Symptom**: Old character saves crash or show incorrect data after code changes.

**Root Cause**: `loadFromJson()` runs three migrations (`_migrateFeatures()`, `_migrateModifiers()`, `_migrateSpells()`). New fields without defaults break old saves.

**Fix**: Always provide backward-compatible defaults in the load path:
```javascript
// In _getDefaultState() or loadFromJson()
this._data.newField = this._data.newField ?? defaultValue;
```

### B4. Spell Concentration Edition Mismatch

**Symptom**: PHB 2014 Blade Ward incorrectly marked as concentration, or XPHB 2024 version not marked.

**Root Cause**: Blade Ward (PHB 2014) is NOT concentration. Blade Ward (XPHB 2024) IS concentration. Migration must match **both name AND source**.

**Fix**: Always check name + source when migrating spell properties:
```javascript
if (spell.name === "Blade Ward" && spell.source === "XPHB") {
    spell.concentration = true;
}
```

### B5. Double-Counting Modifiers

**Symptom**: AC, saves, or skills are too high.

**Root Cause**: `baseMod` in various calculations already includes custom save modifiers. Adding them again in a different calculation path causes double-counting.

**Fix**: Audit the modifier aggregation chain. Comment: `"Note: baseMod already includes custom save modifiers, avoid double-counting"` exists in `charactersheet.js`.

### B6. Legacy Characters (No levelHistory)

**Symptom**: Edit buttons disabled, can't modify character.

**Root Cause**: Characters created before level-history tracking have no `levelHistory` array. Code treats them as read-only.

**Fix**: These characters can only be rebuilt via Quick Build. Migrations should initialize `levelHistory: []` for old saves.

### B7. Exhaustion — Canonical Bonus vs Effective Bonus

**Symptom**: Exhaustion penalty appears twice (visible in the displayed modifier AND subtracted again at roll), or the displayed modifier silently drifts (e.g. `+5` becomes `+3` on the sheet) so players can't tell the canonical value from the situational one.

**Root Cause**: Exhaustion (and other situational mods like custom buffs / item bonuses / spell effects) was being baked into a single number used for both display and rolling. Two failure modes:
1. Baked into the display value AND subtracted again in the roll handler → double penalty.
2. Baked into the display value but breakdowns showed canonical → the displayed number doesn't match the "calculation breakdown" players see.

**Fix**: Maintain a strict canonical/effective split.
- **Canonical** = ability + proficiency + permanent bonuses (race, items always-on). Stays stable, used for the "intrinsic" number on the sheet.
- **Effective** = canonical ± situational mods (exhaustion penalty, custom mods, active states, concentration buffs). Computed on demand by the breakdown methods (`getSaveBreakdown`, `getSkillBreakdown`, `getInitiativeBreakdown`, `getAbilityCheckBreakdown`, spell DC/attack).
- Roll handlers apply situational mods **once** at roll time, never pre-baked into stored fields.
- Surface both via `_formatModWithEffective(canonical, effective)` (see B8). The exhaustion subtraction must live inside the breakdown methods that compute `effective`, **never** in the field that produces `canonical`.

Regression smell: if `spellAttackBonus`/`spellSaveDc` calc fields contain an exhaustion delta, the display and the roll will fight each other.

### B8. Dual Canonical/Effective Modifier Display Contract

**Symptom**: Inconsistent display of buffed/nerfed bonuses across the sheet. Some surfaces show the situational total, others show the intrinsic value, no surface shows both.

**Root Cause**: No single helper to render the canonical+effective pair, so each call site invents its own format.

**Fix**: Use `_formatModWithEffective(canonical, effective, opts?)` (in `charactersheet.js`). It emits the canonical alone when the two are equal, and `${canonical}<span class="charsheet__mod-effective ${pos|neg}">(${effective})</span>` otherwise. Call sites that must agree on this contract:
- `charactersheet.js` L2825 (legacy ability mod), L2851 (hero ability mod), L2908 (skill mod), L3131 (initiative)
- `charactersheet-spells.js` L5950–5951 (spell DC, spell attack)
- Saves, breakdowns, anywhere a roll bonus is displayed alongside a roll button

Two-direction CSS coupling: if you add a new dual-display surface, check that its container has room for the parenthetical (`inline-flex; align-items: baseline; gap` on the pill) and that the parenthetical font scales sanely under `[data-textsize]` (see **E4**).

### B9. Custom Modifier Double-Count — Sub-Type Matching

**Symptom**: A custom modifier "+1 to all d20 rolls" applies as **+2** to ability checks (or saves, or attacks) — the general bucket is being counted once, the per-roll-type bucket is being counted again.

**Root Cause**: The modifier registry uses hierarchical sub-types — e.g. `check:str:athletics` is also matched by `check:str` and bare `check`. If `aggregateModifiers()` walks the chain naively and sums every bucket it touches, a single registered entry with target `check` gets summed once for `check`, again for `check:str`, again for `check:str:athletics`.

**Fix**: De-duplicate by modifier **id**, not by bucket. Each registered modifier has a unique id; `aggregateModifiers()` must collect ids across the matching chain and sum the value only once per id. See D5 for the sibling cascade pitfall.

Smell test: register a single `+1` to `check` and verify a Strength (Athletics) check rolls with `+1`, not `+3`.

---

## C. Data & Schema Errors

### C1. additionalProperties: false

**Symptom**: Schema validation fails with "additional properties not allowed".

**Root Cause**: All 5etools schemas use `additionalProperties: false`. Any unknown field fails validation.

**Fix**: Only use fields defined in the schema. Check `schema/site/<type>.json` before adding new properties.

### C2. Item Value in Copper Pieces

**Symptom**: Item prices look wrong (e.g., 1500 instead of 15 gp).

**Root Cause**: Item `value` field is in **copper pieces**. 1500 cp = 15 gp.

**Fix**: Convert: `gp = value / 100`. Display accordingly.

### C3. Monster Size is Array

**Symptom**: `TypeError: monster.size.includes is not a function` or similar.

**Root Cause**: Monster `size` is an **array**: `["M"]`, not a string `"M"`.

**Fix**: Always access as array: `monster.size[0]` or `monster.size.includes("M")`.

### C4. AC is Array of Objects

**Symptom**: `NaN` or `undefined` when reading AC.

**Root Cause**: AC is `[{"ac": 15, "from": ["natural armor"]}]`, not a number.

**Fix**: `monster.ac[0].ac` for numeric value, or check if entry is plain number (some are just `[15]`).

### C5. HP Needs Both Fields

**Symptom**: HP shows "undefined" or "NaN".

**Root Cause**: HP requires both: `{"average": 52, "formula": "8d8 + 16"}`.

**Fix**: Always provide both `average` and `formula`.

### C6. "entries" Not "entry"

**Symptom**: Content doesn't render, silently ignored.

**Root Cause**: The type is `"type": "entries"` (plural), NOT `"entry"`.

**Fix**: Use `"entries"` everywhere. This is the most common typo in data files.

### C7. Tag Syntax — Braces Required

**Symptom**: Tags render as literal text instead of links/dice.

**Root Cause**: Tags must be `{@tagName arg|arg}` — **braces required**.

**Fix**: Ensure proper format: `{@spell fireball|phb}`, `{@dice 2d6+3}`, `{@b bold text}`.

---

## D. Feature Calculation Errors

### D1. Class Level vs Character Level

**Symptom**: Features unlock at wrong level or don't appear for multiclass characters.

**Root Cause**: Feature level-gating must use **class level** (level in that specific class), not total character level.

**Fix**: Always use the class-specific level in `getFeatureCalculations()`:
```javascript
if (classLevel >= 3) { // NOT state.getTotalLevel()
    calc.hasSubclassFeature = true;
}
```

### D2. Case-Sensitive Subclass Comparison

**Symptom**: Subclass features don't trigger for some characters.

**Root Cause**: Subclass name comparison is case-sensitive by default.

**Fix**: Always use `.toLowerCase()`:
```javascript
if (subclass?.name?.toLowerCase() === "champion") { ... }
```

### D3. Wrong DC Formula Ability

**Symptom**: DCs are wrong for certain features.

**Root Cause**: Different features use different abilities for DC:
- Spell Save DC: spellcasting ability (INT/WIS/CHA)
- Ki/Focus Save DC: WIS
- Maneuver DC: higher of STR or DEX
- Breath Weapon DC: CON
- Method DC (TGTT): STR or DEX (player's choice)

**Fix**: Check the feature description for the correct ability. Formula is always `8 + proficiencyBonus + abilityMod`.

### D4. Property Naming Convention Violations

**Symptom**: Feature calculations don't appear in UI or downstream code.

**Root Cause**: Properties follow strict prefixes: `has{Feature}` (bool), `{feature}Damage`, `{feature}Dc`, `{feature}Uses`, `{feature}Bonus`, `{feature}Range`, `{feature}Count`, `{feature}Die`.

**Fix**: Follow the convention exactly. Downstream code depends on these naming patterns.

### D5. Hierarchical Effect Matching — Too-Broad Targets

**Symptom**: A state effect applies to more rolls than intended.

**Root Cause**: `"check:str:athletics"` also matches `"check:str"` and `"check"`. A state granting "advantage on Strength checks" applies to Athletics automatically.

**Fix**: Be specific with target strings. Test that broad effects correctly cascade AND don't over-apply.

---

## E. UI / DOM Errors

### E1. DM Screen: .text() Does NOT Work

**Symptom**: Text doesn't appear in DM Screen panels.

**Root Cause**: The vanilla DOM toolkit (`ee` templates) does NOT support `.text()`. This is a consistent trap because jQuery uses `.text()` but the DM Screen codebase doesn't.

**Fix**: Use `.textContent` or `.txt()` instead:
```javascript
// WRONG (DM Screen)
element.text("Hello");

// CORRECT
element.textContent = "Hello";
element.txt("Hello");  // toolkit method
```

### E2. jQuery vs Vanilla DOM Confusion

**Symptom**: DOM methods work in character sheet but not DM screen (or vice versa).

**Root Cause**: Character sheet uses **jQuery** (`$(...).on()`, `$(...).val()`). DM Screen uses **vanilla DOM toolkit** (`ee` templates, `.onn()`, `.appendTo()`).

**Fix**: Check which module you're in. Key differences:

| jQuery (Character Sheet) | Vanilla (DM Screen) |
|--------------------------|---------------------|
| `$(el).on("click", fn)` | `el.onn("click", fn)` |
| `$(el).val()` | `el.val()` |
| `$(el).text("x")` | `el.txt("x")` or `.textContent` |
| `$("<div>")` | `` ee`<div>` `` |

### E3. Section Re-Render Pattern

**Symptom**: Stale or duplicate content after updates.

**Root Cause**: Imperative rendering requires clearing before rebuilding.

**Fix**: Always `empty()` → rebuild → `appendTo()`:
```javascript
container.empty();
items.forEach(item => buildElement(item).appendTo(container));
```

### E4. Dual-Display CSS — Pill Overflow Under [data-textsize]

**Symptom**: An ability/skill/save/spell-DC pill overflows its grid cell or visibly bleeds past its background once the canonical+effective dual display kicks in (e.g. `-1 (-3)` instead of just `-1`). Often only visible at larger text-size settings.

**Root Cause**: `[data-textsize]` bumps a container's font-size for readability (e.g. legacy `.charsheet__ability-mod` jumps to `--cs-text-3xl` / 2rem). The dual-display parenthetical inherits via `em`, so a 0.6em–0.75em span attached to a 2rem parent renders at 1.2–1.5rem — almost as big as the canonical, and the combined token overflows the cell.

**Fix**: Three coordinated CSS rules whenever a pill carries dual content:
1. **Give the pill its own (smaller) bump under `[data-textsize]`** rather than sharing the score's 3xl rule. Example: `.charsheet__ability-mod` uses `--cs-text-xl` (1.25rem) while the score above it stays at 3xl.
2. **Use `inline-flex; align-items: baseline; gap: 0.15em; box-sizing: border-box; line-height: 1.15`** on the pill — `inline-block` mishandles baselines when canonical and parenthetical are different sizes, and `box-sizing: border-box` makes `max-width: 100%` actually constrain.
3. **Keep the parenthetical small enough to be subordinate**: global `.charsheet__mod-effective` at `0.75em` is comfortable in normal-text surfaces (skills, saves, spell DC); scope a tighter `0.6em` override (`.charsheet__ability-mod .charsheet__mod-effective`) only where the parent is bumped large.

Safe by inspection: `.charsheet__skill-mod` (has `max-width: 110px`, parent stays at base font), `.charsheet__save-row` (base font), `.charsheet__ability-hero-mod` (only bumped to 2xl), spell DC/atk cells (no fixed pill width). Re-audit any new pill that participates in dual-display.

---

## F. Parser / Feature Detection Errors

### F1. d100 Table Content Parsed as Effects

**Symptom**: Feature like "Gambler's Folly" incorrectly gives permanent negative initiative.

**Root Cause**: `FeatureModifierParser` parsed d100 **result table** content as permanent mechanical effects.

**Fix**: Strip table content (`"type": "table"` entries) before parsing feature text for modifiers.

### F2. "Minimum Roll" vs "+X Bonus"

**Symptom**: Reliable Talent adds +10 to ability mod instead of setting floor.

**Root Cause**: Implemented as `+10 bonus` instead of "treat roll below 10 as 10".

**Fix**: These are fundamentally different mechanics. "Minimum 10" affects the d20 roll, not the modifier.

### F3. Spell Choice Type Check Missing

**Symptom**: `TypeError: sp.choose.includes is not a function`.

**Root Cause**: `sp.choose` can be a string OR an object. Code called `.includes()` without checking type.

**Fix**: Always check type before string operations:
```javascript
if (typeof sp.choose === "string" && sp.choose.includes("level=0")) { ... }
```

### F4. Spell Class Availability — fromSubclass Not Checked

**Symptom**: Subclass spells (e.g., Gift of Alacrity for Chronurgy Magic) don't appear in spell picker.

**Root Cause**: `spellIsForClass()` and `_showSpellPicker()` only check `fromClassList`, never `fromSubclass`.

**Fix**: Also check `Renderer.spell.getCombinedClasses(spell, "fromSubclass")` and match against character's subclass.

### F5. Language Dialect Confusion (Ignan → Primordial)

**Symptom**: Selecting "Ignan" sometimes shows as "Primordial".

**Root Cause**: `Parser.LANGUAGES_EXOTIC` lists Ignan as standalone, but `data/languages.json` only defines it as a dialect of Primordial (no independent entry).

**Fix**: Either add Ignan to `data/languages.json` as independent entry, or handle dialect→parent mapping consistently.

### F6. Spell Picker — Source Filter Missing Subclass

**Symptom**: A subclass-only spell (e.g. Gift of Alacrity for a Chronurgy Wizard, Guidance for a Divine Soul Sorcerer) is missing from the picker even though the character is the right subclass. Adding the subclass source to the filter manually surfaces the spell.

**Root Cause**: The spell picker opens with a source filter pre-seeded from the character's classes, but the **subclass source** (e.g. `EGW` for Chronurgy, `XGE` for Divine Soul) isn't included. The class's own spell list, augmented with `additionalSpells` from the subclass, references spells in those sources — so the filter excludes them.

**Fix**: When seeding the picker's source filter, include every source referenced by:
- The character's class sources (already done)
- Every subclass on every class (the missing piece)
- The source of every spell granted via `additionalSpells` on those subclasses

Symptom-level test: a Divine Soul Sorcerer (TGTT class, XGE subclass) opening the picker should see Cleric spells like Guidance without manually adding XGE/PHB to the source pill.

### F7. Spell Picker — `[object Object]` in Default Filter Pill

**Symptom**: Picker opens with `[object Object]` showing in the source/subclass filter pill instead of a readable label.

**Root Cause**: Subclass filter entries are **objects** (`{class: "Wizard", source: "PHB", subclass: {name: "Chronurgy", source: "EGW"}}`), not bare strings. Code that stringifies the default filter with `String(value)` or template-literal coercion produces `[object Object]`.

**Fix**: Use the canonical display helper (`Parser.getFilterSubclassDisplay(...)` or the picker's `_renderFilterPillLabel`) — never coerce raw filter entries to string. When adding a new filter dimension, define the display helper at the same time.

### F8. Spell Picker — Missing `_copy` Subclass Augmentation

**Symptom**: Subclass spell list looks complete in the live character sheet, but the picker omits some entries that should be inherited via `_copy`.

**Root Cause**: Subclasses can use `_copy` to inherit `additionalSpells` from a sibling/parent subclass. The character-sheet render path lazy-merges `_copy` when displaying features, but the picker historically read raw subclass data and skipped the merge.

**Fix**: Defensive lazy-merge — when the picker pulls subclass data for filter/spell-list purposes, call the same `_copy` resolver the sheet uses. Cache the result on the subclass instance to avoid re-merging every picker open.

---

## G. Builder / LevelUp / QuickBuild Errors

### G1. Fix in One → Check All Three

**Symptom**: Bug fixed in LevelUp but still present in Builder or QuickBuild.

**Root Cause**: Builder, LevelUp, and QuickBuild share duplicated logic for class features, spell selection, and feature options.

**Fix**: When fixing a bug in any one module, check the other two for the same pattern. See `LEVELUP_REFACTOR_MAP.md` for extraction status.

### G2. Missing Spell Fields from Builder

**Symptom**: Spells added during character creation lack school, ritual, concentration, castingTime, range, duration, components.

**Root Cause**: Builder creates inline spell objects instead of using `CharacterSheetClassUtils.buildSpellStateObject()`.

**Fix**: Use the canonical helper that includes all fields:
```javascript
// CORRECT (LevelUp and QuickBuild use this)
CharacterSheetClassUtils.buildSpellStateObject(spell, {sourceFeature, sourceClass, prepared});

// WRONG (Builder uses inline objects with missing fields)
{name: spell.name, source: spell.source, level: spell.level}
```

### G3. QuickBuild _resetSelections() Missing Buckets

**Symptom**: Crash during QuickBuild before any UI selection.

**Root Cause**: `_resetSelections()` must recreate every selection bucket used later in `_buildWizardSteps()`, including `subclassChoices`. Missing buckets crash before UI renders.

**Fix**: Ensure all selection buckets exist after reset.

### G4. Race ASI Accumulation

**Symptom**: Ability scores incorrect after reassigning racial bonuses.

**Root Cause**: Builder wizard steps didn't clear bonuses properly when re-entering the abilities step.

**Fix**: Clear `abilityBonuses` before applying new racial ASIs.

### G5. Save Corruption — No Auto-Save

**Symptom**: Character data lost on page close/switch.

**Root Cause**: No `beforeunload`/`pagehide` event handler to auto-save.

**Fix**: Register save handlers:
```javascript
window.addEventListener("beforeunload", () => this._autoSave());
window.addEventListener("pagehide", () => this._autoSave());
```

### G6. Respec Shows Race Default ASI Instead of Tasha's Choice

**Symptom**: Opening Respec on a character built with Tasha's "Customizing Your Origin" rules shows the **race's default** ASI (e.g. Mountain Dwarf +2 STR / +2 CON) instead of the **user-chosen** ASI from the original build.

**Root Cause**: Respec was reading the race entry from the loaded data file (default ASIs) instead of from the character's `levelHistory[0]` / build snapshot (user-chosen ASIs under Tasha's rules).

**Fix**: When populating the Respec ASI step, prefer `levelHistory[0].raceAbilityChoices` (or the equivalent build snapshot field) over `race.ability`. Only fall back to `race.ability` for legacy characters with no snapshot.

### G7. Single-Class LevelUp Crash on Multiclass-Only Variable

**Symptom**: `ReferenceError: fullSubclassData is not defined` (or similar) when leveling up a **single-class** character. Multiclass level-ups work fine.

**Root Cause**: A helper added to the multiclass branch of `_pShowLevelUpModal` declared a `const`/`let` inside an `if (isMulticlass)` block, then referenced it from shared code below. Single-class flow skips the block, the var is undefined, the modal crashes.

**Fix**: Hoist any variable referenced from both branches to the top of the function with a safe default (`let fullSubclassData = null;`). Audit other recent multiclass-only additions for the same pattern.

### G8. Custom Background — Cap Not Enforced

**Symptom**: PHB+ "Custom Background" rule says "choose two from {2 languages, 2 tools, 1 of each}" but the UI lets the user check all three.

**Root Cause**: The checkbox group had no max-selection guard; backing logic accepted whatever was checked.

**Fix**: Add a cap counter to the choice group with an `onChange` that disables remaining checkboxes once the cap is hit (and re-enables when one is unchecked). Surface a small "(2 of 2 chosen)" counter so the constraint is visible.

---

## H. DM Screen Errors

### H1. Serialization Compressed Keys — Missing Defaults

**Symptom**: Old saved panels crash or show missing data after code changes.

**Root Cause**: Party Tracker and Journey Tracker use compressed keys (`n`=name, `cl`=classes, `ab`=abilities). New fields need defaults in `deserialize()`.

**Fix**: Always add defaults for new fields in the deserialization path.

### H2. Board Event Sync Issues

**Symptom**: Journey Tracker doesn't reflect Party Tracker changes.

**Root Cause**: Party Tracker fires `partyTrackerUpdate` board event. Journey Tracker listens and syncs. If the event isn't fired or the listener is broken, sync fails.

**Fix**: Verify `board.doSaveStateDebounced()` is called after changes, and that the event name matches exactly.

### H3. TGTT Feature Gating

**Symptom**: TGTT homebrew features appear when they shouldn't (or don't appear when they should).

**Root Cause**: TGTT is gated by `settings.enableTgtt` and sub-toggles (`thelemar_carryWeight`, `thelemar_linguistics`, etc.). Journey Tracker is system-neutral — no TGTT references.

**Fix**: Check `settings.enableTgtt` before rendering any TGTT-specific UI. Journey Tracker should never reference TGTT.

---

## I. TGTT Homebrew Errors

### I1. Source Gating — PHB Features Triggering TGTT

**Symptom**: Combat methods, stamina, or other TGTT mechanics appear for non-TGTT characters.

**Root Cause**: No systematic source-checking. PHB class features shouldn't trigger TGTT-specific mechanics.

**Fix**: Check `classSource === "TGTT"` before applying TGTT mechanics:
```javascript
if (cls.source === "TGTT" && featureName === "Combat Methods") { ... }
```

### I2. Combat Traditions — Migration-Sensitive

**Symptom**: Old saves with combat traditions crash or lose tradition data.

**Root Cause**: Combat traditions (TGTT homebrew) have complex resource system. Migrations must handle old data formats.

**Fix**: Add migration code in `loadFromJson()` for combat tradition data shape changes.

### I3. Stance → Skill Bonus Bridge Missing

**Symptom**: Combat stances activated but skill bonuses don't apply.

**Root Cause**: Missing connection between state activation system and skill calculation system.

**Fix**: Ensure `getBonusFromStates()` is called in skill calculation paths, not just attack/save paths.

### I4. Specialties Cross-References

**Symptom**: Higher-level Specialties (5th, 9th, 13th, 17th) don't offer choices.

**Root Cause**: Higher-level Specialty features reference the level 1 feature via `{@classFeature Specialties|Fighter|TGTT|1}`. The code must follow this reference to find the available options.

**Fix**: `_findFeatureOptions()` must detect `{@classFeature}` references in feature text and follow them to get option lists.

### I5. Combat Traditions — Builder vs LevelUp Pool Drift

**Symptom**: At Builder, a Fighter is offered only a small subset of combat traditions (instead of the full pool). At LevelUp, the subclass-granted extra tradition pick re-offers the **base Fighter** choice instead of the predetermined subclass option.

**Root Cause**: Two distinct shape bugs:
1. The Builder pool was being filtered by the *subclass's* extra-pick definition (a small list) instead of the *class's* full tradition pool.
2. The LevelUp extra-pick handler walked back up to the class definition for its options, ignoring the `featureSource: {subclass: ...}` hint that should pin it to the subclass's predetermined pool.

**Fix**: Route every tradition pick through a single resolver that takes `{class, subclass, level, pickSlot}` and returns the correct option list — base pool for the class slot, predetermined list for the subclass slot. Builder, LevelUp, and QuickBuild must all call this resolver (see G1).

### I6. Metamagic Filter Leaking 2024 Options into Thelemar Sorcerer

**Symptom**: Thelemar Sorcerer (TGTT) metamagic picker shows 2024 XPHB metamagic options alongside the homebrew TGTT-only list.

**Root Cause**: The metamagic option pool was filtered by `featureType === "MM"` only, with no source gate. XPHB metamagic optfeatures qualify by type.

**Fix**: When the class is `Sorcerer` from source `TGTT`, restrict the picker to optfeatures with `source: "TGTT"` (or the explicit Thelemar allowlist). Mirror the gating pattern used elsewhere for TGTT homebrew (see I1).

---

## J. Renderer / Site Code Errors

### J1. Unhandled @Tag Type

**Symptom**: `Unhandled tag "{tag}"` thrown during rendering.

**Root Cause**: The renderer encounters an `{@tagName}` it doesn't recognize. All tags must be registered — there's no fallback for unknown tags.

**Fix**: Check valid tag names in `js/render.js`. Common tags: `@spell`, `@item`, `@creature`, `@condition`, `@dice`, `@damage`, `@hit`, `@dc`, `@b`, `@i`, `@classFeature`, `@subclassFeature`, `@combatmethod`, `@filter`, `@variantrule`. Homebrew may add custom tags — ensure the renderer is aware.

### J2. Array Passed to Renderer

**Symptom**: `Array passed to renderer!` error in console (deferred via setTimeout).

**Root Cause**: Code passed an array directly to `Renderer.get().render()` instead of an object or string primitive.

**Fix**: Wrap arrays in an entries object:
```javascript
// WRONG
Renderer.get().render(entriesArray);
// CORRECT
Renderer.get().render({type: "entries", entries: entriesArray});
```

### J3. Entity Cross-Reference Not Found

**Symptom**: `Could not find tag: "{tag}"` or `Could not find entity for page`.

**Root Cause**: A `{@spell fireball|XPHB}` or similar cross-reference points to an entity that doesn't exist in loaded data. Common causes: wrong source code, typo in name, data not loaded yet.

**Fix**: Verify the entity exists in the relevant data file. Check name and source match exactly.

### J4. Race/Subrace Merge Failures

**Symptom**: `Could not find parent race for subrace` or `ability array lengths did not match!`.

**Root Cause**: Subrace references a non-existent base race, or ability arrays don't align between parent and child.

**Fix**: Ensure parent race is loaded. For ability merges, verify both arrays have the same structure. Character sheet wraps this in try-catch and falls back to base race only.

### J5. Dice Expression Syntax Errors

**Symptom**: `Syntax error: unexpected character`, `too many decimal separators`, or `Number of dice to roll was not an integer!`.

**Root Cause**: Malformed dice expression in `{@dice}` or `{@damage}` tags.

**Fix**: Validate dice expressions: `NdN+N` format (e.g., `2d6+3`). Dice count and face count must be positive integers.

### J6. Property Modifier Unhandled in _copy/_mod

**Symptom**: `Unhandled property modifier "{mod}"` during entity copy/inheritance.

**Root Cause**: Entity's `_mod` block uses an unknown mode name (likely a typo).

**Fix**: Valid modes: `replaceTxt`, `appendStr`, `replaceArr`, `removeArr`, `appendArr`, `prependArr`, `insertArr`, `renameArr`, `replaceOrAppendArr`, `appendIfNotExistsArr`, `setProp`, `calculateProp`, `scalarAddProp`, `scalarMultProp`, `prefixSuffixStringProp`.

### J7. Unhandled Style Hint

**Symptom**: `Unhandled style "{styleHint}"!` in type-specific renderers.

**Root Cause**: A `styleHint` value not recognized by the renderer. Present in ~10 renderer files.

**Fix**: Valid style hints are typically `"classic"` or `"one"`. Check the specific renderer's switch statement.

### J8. classFeature / subclassFeature Hover — Build the Hash via Canonical Helper

**Symptom**: Console errors like
```
Failed to load renderable content for: page="classfeatures.html" source="EGW" hash="chronal%20shift_wizard_tgtt_chronurgy_egw_2_egw"
Failed to load renderable content for: page="classes.html" source="TGTT-2014" hash="chronurgy%20magic_tgtt-2014"
```
when hovering a class/subclass feature link. Hover popup empty; nothing else broken.

**Root Cause**: Inline hover-routing code built the hash from local variables — picking up the *subclass* source (`EGW`) as the trailing source segment instead of the canonical *class* source (`TGTT`), or using a faked source like `TGTT-2014` that never appears in the data files. The hash assembly format for `classFeature` is `name_className_classSource_subclassShortName_subclassSource_level_classSource` — every segment must come from the canonical class/subclass record.

**Fix**: Route every class/subclass-feature hover through the same canonical helper the rest of the sheet uses (`Renderer.hover.pHandleLinkMouseOver` paired with `UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASS_SUBCLASS_FEATURES]({...})`). Never assemble these hashes inline.

Two regression smells:
- The trailing source segment doesn't match the leading `classSource` segment.
- A `-2014` / `-2024` suffix appears in a source — there's no such source code; this is fake-edition coercion that should be removed.

---

## K. Data Loading Errors

### K1. DataLoader Strategy Not Found

**Symptom**: `No loading strategy found for page "{pageClean}"!`.

**Root Cause**: `DataUtil` doesn't know how to load data for this page type.

**Fix**: Check `js/utils-dataloader.js` for registered page/prop mappings. Data loading uses `UrlUtil.PG_*` constants.

### K2. Silent Reference Resolution Failure

**Symptom**: Hover links show "Failed to load" or empty content. No visible crash.

**Root Cause**: Reference resolution fails during async data load. Error is deferred via `setTimeout`.

**Fix**: Check browser console for deferred errors. Ensure the referenced entity exists. Pre-caching via `DataLoader.pCacheAndGet()` helps.

### K3. Orphan Subrace Skipped

**Symptom**: Subrace doesn't appear in character builder's race selection.

**Root Cause**: Parent race not found in loaded data. Logged as: `"[CharSheet] Skipping orphan subrace"`.

**Fix**: Verify the parent race source is in allowed sources. Check that the base race entry exists.

---

## L. Degraded Mode / Silent Failure Patterns

### L1. Module Initialization Failure — Sheet Continues

**Symptom**: Part of character sheet doesn't work (no builder, no combat, no spells), but no crash.

**Root Cause**: Each sub-module is initialized in try-catch. If one fails, others still load. Error: `console.error("Failed to init {module}:", e)`.

**Fix**: Check browser console for `"Failed to init"` messages.

### L2. Renderer Unavailable Fallback

**Symptom**: Feature descriptions show raw JSON or flat text instead of formatted content.

**Root Cause**: `Renderer` global not available. Code falls back to `JSON.stringify()` or plain text join.

**Fix**: In tests, ensure `Renderer` mock in `setup.js`. In production, indicates load order issue.

### L3. Combat Action Silently Cancelled

**Symptom**: Clicking attack or combat method does nothing.

**Root Cause**: Attack ID stale/invalid, or method not found. Logged as `console.warn("[Combat] Attack not found:")`.

**Fix**: Check attack/method IDs match current state. Attacks removed when weapons unequipped.

### L4. Active State Type Not Recognized

**Symptom**: Trying to activate a state (Rage, Bladesong) does nothing.

**Root Cause**: State type ID not in `ACTIVE_STATE_TYPES`. Logged as `console.warn("Unknown active state type:")`.

**Fix**: Check type string matches exactly (case-sensitive). Valid: `rage`, `bladesong`, `wildShape`, `dodge`, `defensiveStance`, `concentration`.

### L5. Feat-Granted Cantrips Not Added

**Symptom**: Feat like Telekinetic doesn't add Mage Hand cantrip.

**Root Cause**: Feat→spell granting pipeline broken. `_processFeatureSpells()` not called or `additionalSpells` not parsed from feat data.

**Fix**: Verify feat data has `additionalSpells` field. Check `SpellGrantParser.parseAdditionalSpells()` handles the specific format.

### L6. Custom Background Tool Proficiency Missing

**Symptom**: Custom backgrounds don't grant tool proficiencies correctly.

**Root Cause**: Custom background creation skips `parseToolData()` that standard backgrounds use.

**Fix**: Call `parseToolData()` on custom backgrounds during creation.

### L7. Feat-Triggered Action — Modal Without Mutation Pipeline

**Symptom**: A feat-granted button (e.g. Spell Scribing Adept's "Scribe Spell") opens a modal, the user picks a spell / confirms cost, **and nothing happens to the sheet** — no spell added, no gold deducted, no inventory change. No console error.

**Root Cause**: Feat-driven actions need three pieces wired up:
1. **A trigger** (the feat button / action card)
2. **A picker** (modal that gathers choices)
3. **A mutation pipeline** (the picker's `onConfirm` writes to state, calls `render()`, persists via the auto-save handler)

It's easy to ship (1) + (2) and forget (3) — the modal becomes a no-op. Equally easy to ship (3) without the cost/resource enforcement.

**Fix**: For every feat-driven action, the picker's confirm handler must:
- Validate prerequisites (funds, slots, components) **before** mutation; surface a clear failure path
- Mutate state through the same path the sheet's other consumers use (e.g. `state.addSpell(...)`, `state.spendGold(amount)`) so calculations re-aggregate
- Call `render()` (or the relevant section re-render) so the UI reflects the mutation
- Trigger save (auto-save will catch it on next event, but explicit `_save()` is safer for paid actions)

UX bonus pattern: buttons, not a dropdown, for short option lists ("Pay 50gp ✓ / Skip cost"). Dropdowns hide options and require an extra click to confirm.

### L8. `featProgression` Ignored on Optional Features

**Symptom**: An invocation / maneuver / metamagic / similar optfeature that should let the player pick a feat (e.g. Lessons of the First Ones invocation) shows no feat-choice UI when selected.

**Root Cause**: The `featProgression` / `additionalFeats` hook was only honored on `class`/`subclass` entities, never on the `optfeature` type. Optfeatures that grant a feat were silently dropped.

**Fix**: When iterating optfeatures for grants, check for `featProgression` (or whatever field your data uses for "this grants a feat choice") and surface a feat-picker the same way class-level feat grants do. Wire it into Builder, LevelUp, and QuickBuild (see G1).

---

## M. Debugging Quick Reference

| Symptom | First Check |
|---------|-------------|
| Feature not appearing | Level-gating (`if (level >= N)`) and source gating (`cls.source`) |
| Wrong calculation | `getAbilityScore()` (total) vs `_data.abilities.x` (base only) |
| UI not updating | `render()` called after state mutation? |
| Test passes but shouldn't | Look for `getTotalLevel()` or `expect(true)` patterns |
| ReferenceError in test | Import dependencies BEFORE the module under test |
| DM Screen text missing | Replace `.text()` with `.textContent` or `.txt()` |
| Parser extracting garbage | Check for HTML tables or d100 tables in source text — strip first |
| Spell behaves wrong by edition | Check name AND source — PHB vs XPHB differ |
| Builder/QuickBuild bug | Check all three progression modules — duplicated logic |
| Save corruption | `beforeunload` handler registered? Migration functions in `loadFromJson()`? |
| Schema validation fails | `additionalProperties: false` — check for unknown fields |
| Item price wrong | Value is in copper pieces (divide by 100 for gp) |
| Modifier too high | Double-counting audit — `baseMod` already includes custom mods |
| TGTT feature leaking | Check `classSource === "TGTT"` and `settings.enableTgtt` |
| `Unhandled tag` error | Check tag name spelling — see valid tags in `js/render.js` |
| Hover link "Failed to load" | Entity not found or not pre-cached — check source + name |
| Dice expression error | Validate format: `NdN+N`, integers only for count/faces |
| Race version expansion crash | Try-catch wraps `_expandRaceVersion()` — check `_versions` data |
| Module partially broken | Check console for `"Failed to init"` — module init is isolated |
| Feat cantrips missing | Check feat `additionalSpells` field and spell granting pipeline |
| Active state does nothing | State type string must match `ACTIVE_STATE_TYPES` key exactly |
| Cross-edition multiclass wrong | Barely tested area — test with mixed sources (PHB + XPHB + TGTT) |
| Array to renderer error | Wrap in `{type: "entries", entries: [...]}` — don't pass arrays directly |
| Conditional advantage applied to every save/check | **Fixed.** Conditionals (`{conditional: "…"}` or `save:advantage:<sub>`) now gate off by default; players opt in via the pre-roll picker. If you see this regress, check `aggregateModifiers` no longer auto-folds entries with truthy `conditional`. |
| Favorite stars missing or stuck stale | After a save migration or data reload, call `state.cleanupOrphanedFavorites()` (or use the toast button surfaced by the Actions hub). Resolution lives in `_resolveFavorite`; check it returns `{found: true}` for the entity. |
| Apply Buff modal shows nothing / shows wrong effects | Effect application prefers `registryEffects` over parsed `buffs`. If a buff is missing, check the spell's registry entry; if effects are wrong, check the `buff.type → effect.type` mapping in `_applyBuffEffects` (`charactersheet-spells.js` ~L4444). |
| Lore skill renders in main skills table | Renderer filter is `skill.isLoreSkill` (charactersheet.js L2754–2755). Make sure the flag is set on the skill object before the table loop. |
| Exhaustion penalty doubled or display ≠ roll | **B7** — canonical bonus must stay clean; exhaustion only inside breakdown `effective` and at roll time. Don't bake into stored calc fields. |
| Want canonical and modified bonus side-by-side | **B8** — `_formatModWithEffective(canonical, effective)`. Surface contract is one helper; CSS coupling in **E4**. |
| Custom modifier "+1 to all" applies as +2 | **B9** — registry sub-types (`check`, `check:str`, `check:str:athletics`) — dedupe by modifier id, not bucket. |
| Dual-display pill overflows under [data-textsize] | **E4** — give pill its own smaller bump, `inline-flex; align-items: baseline; box-sizing: border-box`, scope `0.6em` parenthetical only where parent is bumped. |
| Subclass spell missing from picker | **F6** — picker source filter must include every subclass source on every class. |
| `[object Object]` in picker filter pill | **F7** — subclass filter entries are objects; use the canonical display helper, never `String(value)`. |
| Subclass `_copy` spells missing in picker | **F8** — picker must lazy-merge `_copy` the same way the sheet does. |
| Respec shows wrong race ASI (Tasha's) | **G6** — read `levelHistory[0].raceAbilityChoices`, not `race.ability`. |
| `ReferenceError` in single-class LevelUp after a multiclass change | **G7** — hoist multiclass-branch vars to function top with safe defaults. |
| Custom background lets you choose 3 of 3 | **G8** — checkbox group needs a max-selection guard plus a visible "(X of N chosen)" counter. |
| Fighter combat traditions look wrong at Builder / LevelUp | **I5** — route every pick through one resolver keyed on `{class, subclass, level, pickSlot}`. |
| Thelemar Sorcerer sees 2024 metamagic | **I6** — gate metamagic picker by `classSource === "TGTT"` (mirror I1). |
| `Failed to load renderable content for: page="classfeatures.html"` | **J8** — build the hash via `UrlUtil.URL_TO_HASH_BUILDER`, not inline. Watch for fake `-2014`/`-2024` source suffixes. |
| Feat button opens modal, sheet doesn't change | **L7** — picker confirm must validate → mutate via canonical state setter → render → save. Prefer buttons over dropdowns. |
| Invocation/maneuver grants no feat picker | **L8** — `featProgression` must be honored on optfeature, not just class/subclass. |

---

## N. Useful Commands

```bash
# Run specific character sheet test file
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheet{Name} --no-coverage --forceExit

# Run all character sheet tests with summary
NODE_OPTIONS='--experimental-vm-modules' npx jest test/jest/charactersheet/ --no-coverage --forceExit 2>&1 | tail -15

# Validate data against schema
node _node/validate-json.js

# Start local dev server
npx http-server -c-1 --cors --port 8080
```
