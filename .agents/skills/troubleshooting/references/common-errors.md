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
