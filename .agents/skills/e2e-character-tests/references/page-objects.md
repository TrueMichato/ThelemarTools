# Page Object API Reference

Three page objects encapsulate all DOM interactions for the
character-sheet flow.  Test code should call **only** these methods —
never raw locators in spec files.

## `BuilderWizardPage` (`test/e2e/pages/BuilderWizardPage.ts`)

The L1 character creation wizard.  Most specs invoke this only via
`buildL1FromPreset()` from `comprehensiveBuildHelpers.ts`; direct use is
for edge cases.

### Step navigation

- `getCurrentStep(): Promise<number>` — current wizard step (0-based).
- `clickNext()` / `clickPrev()` — step controls.

### Race / class / subclass

- `selectRace(name)` — picks first matching name.
- `selectRaceExact(name, sourceAbbv)` — disambiguates by source (e.g.
  `"Hochling", "TGTT-2024"`).
- `selectSubrace(name)` / `hasSubraceSelection(): boolean`.
- `selectAllRacialChoices()` — auto-fills ability / language / skill
  pickers granted by race.
- `selectClass(name)` / `selectClassExact(name, sourceAbbv)`.
- `selectSubclass(name)` — for classes with L1 subclass picks (Cleric,
  Sorcerer, Warlock).
- `hasSubclassSelection(): boolean`.
- `expectDivineSoulAffinityModalVisible()` /
  `selectDivineSoulAffinity(name)` — Divine Soul-specific.

### Class / level features

- `selectSkillProficiency(name)` / `selectFirstAvailableSkills(count)`.
- `selectCombatTraditionsAndMethods()` — TGTT-only; auto-fills.
- `selectAllClassFeatureLanguages()`.
- `selectFirstAvailableExpertise(count)` /
  `selectFirstAvailableWeaponMasteries(count)` /
  `selectFirstAvailableOptionalFeatures(count)` /
  `selectFirstAvailableFeatureOptions(count)`.
- `autoFillRemainingSelections()` — generic counter sweeper.
- `autoFillStartingSpells({divineSoulAffinity?})` — handles cantrip +
  spell pickers.

### Abilities

- `selectAbilityMethod("standard-array" | "point-buy" | "roll")`.
- `assignAbilityScore(ability, value)`.
- `assignStandardArrayDefaults()` — 15/14/13/12/10/8 to STR/DEX/CON/INT/WIS/CHA.

### Background, equipment, identity

- `selectBackground(name)` / `selectBackgroundExact(name, src)`.
- `selectEquipmentOption("equipment" | "gold")`.
- `fillName(name)` / `fillDetails({name, alignment, …})`.

### Finishing

- `setQuickBuildTargetLevel(level)` — only on Quick-Build path.
- `finishWizard()` — closes wizard and returns to character sheet.
- `acceptSkipSpellsDialog()` — call inside loop after `finishWizard` if
  the build still has unfilled spell picks (defensive).
- `expectWizardComplete()`.

## `LevelUpPage` (`test/e2e/pages/LevelUpPage.ts`)

Drives the level-up wizard for L2+ (and multiclass entries).

- `waitForModal()` — wait for modal to appear (10s timeout). On timeout
  dumps diagnostic state.
- `isVisible(): boolean`.
- `expandAccordion(id)` / `isAccordionVisible(id)` /
  `isAccordionCompleted(id)`.
- `selectHpOption("average" | "roll")`.
- `selectAsi(ability)` / `selectAsiScore(first, second?)`.
- `selectFeat(name)`.
- `selectSubclass(name, sourceAbbv?)` — disambiguated by source if
  provided; falls back to first-match if not.
- `addKnownSpell(name)` / `addFirstAvailableKnownSpells(count)`.
- `selectOptionalFeature(name)` / `selectFirstAvailableOptions()`.
- **`autoFillAllSelections()` — the critical one.**  Optimised
  state-stable polling sweep (per Phase 3): ASI stepper, counters, spell
  picks, optional features.  Use after the spec sets explicit picks.
- `finish()` — closes the wizard.  Polls modal-visible @ 100ms, max 2s.
- `cancel()` / `expectModalClosed()`.
- `expectDivineSoulAffinityModalVisible()` /
  `selectDivineSoulAffinity(name)`.
- `getProgressPercentage(): number`.

## `CharacterSheetPage` (`test/e2e/pages/CharacterSheetPage.ts`)

The sheet itself.  Most probes go through this.

### Identity & navigation

- `goto()` — opens `charactersheet.html`.
- `switchToTab(tab)` — pass one of the locators (`tabFeatures`,
  `tabSpells`, `tabInventory`, etc.) defined as fields.
- `expectCharacterName(name)` / `expectLevel(level)`.

### Core stats

- `getAbilityScore(ab)` / `getCurrentHp()` / `getMaxHp()` /
  `getTempHp()` / `setCurrentHp(hp)`.
- `getAC()` / `getInitiative()` / `getSpeed()`.
- `getCombatStat("ac" | "spellSaveDc" | "speed" | "initiative")` —
  preferred for delta probes.
- `getSpellSaveDC()` / `getCombatMethodDC()` — TGTT-aware.

### Conditions & exhaustion

- `getConditionBadges(): string[]`.
- `removeCondition(text)`.
- `getExhaustionLevel(): number`.

### Features & toggles

- `getActivatableFeatureNames(): string[]`.
- `getToggleableFeatureNames(): string[]`.
- `activateFeature(name)` / `deactivateFeature(name)` /
  `isFeatureActive(name): boolean`.

### Resources & slots

- `getResource(name): {current, max}`.
- `getResourceNames(): string[]`.
- `getSpellSlots(level): {current, max}`.
- `getPactSlots(): {current, max, level}`.
- `castSpellAtSlot(level): {ok, remaining}`.
- `useResourceByName(name, amount = 1): {ok, remaining}`.

### Rests

- `triggerShortRest()` / `triggerLongRest()`.

### Combat

- `getAttackNames(): string[]`.
- `clickAttackRoll(name): boolean` — returns true if button found and
  clicked successfully.
- `getAttackBonus(name): string | null`.

### Skills (new in Phase 4)

- `getSkillBonus(skill): number`.
- `rollSkill(skill): {bonus, clicked}` — does NOT assert dice result;
  asserts the button is wired and bonus is finite.

### Death saves (new in Phase 4)

- `getDeathSaves(): {successes, failures, stabilized, dead}`.
- `markDeathSave("success" | "failure"): {successes, failures}`.
- `resetDeathSaves()`.

### Conditions (new in Phase 4)

- `applyCondition(name)`.
- `hasCondition(name): boolean`.

### Concentration (new in Phase 4)

- `getConcentrationStatus(): {active, spell, level}`.
- `startConcentration(name, level)`.
- `dealDamage(amount): {currentHp}` — auto-removes concentration if
  state pipeline intact.

### Subclass / spells

- `getSubclassChoice(className): {key, name} | null`.
- `getKnownSpellNames(): string[]`.

## When NOT to use a page object

If a probe touches state that has no public method:

1. Call `page.evaluate(() => globalThis.charSheet.someApi(...))`
   inline in a helper.
2. Wrap the result and add it to `CharacterSheetPage` as a method.
3. Document the new method in this file.

Spec files **never** call `page.evaluate` directly.
