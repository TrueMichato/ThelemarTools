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
- `selectRequiredEfaArtificerPlans()` — opens the shared Replicate
  Magic Item plan picker, selects every required addition deterministically,
  commits the draft, and deliberately leaves optional replacements unchanged.
- **`autoFillAllSelections()` — the critical one.**  Optimised
  state-stable polling sweep (per Phase 3): ASI stepper, counters, spell
  picks, optional features, and required EFA Artificer plans. Use after the
  spec sets explicit picks.
- `resolvePendingFeatureChoices()` — drains stacked production feature-choice
  modals, including multi-tool picks. If the renderer owns the choice lock but
  no modal becomes observable, it uses the production fulfillment API as the
  deterministic picker-bypass fallback and syncs the progression ledger. It
  then drains chained spell choices and fails with queue diagnostics if any
  required feature or spell choice remains unresolved.
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
- `hasClassFeatureUid(uid): boolean` — verifies an exact source-qualified
  class-feature identity instead of accepting a same-name feature from another
  source.

### Core stats

- `getAbilityScore(ab)` / `getCurrentHp()` / `getMaxHp()` /
  `getTempHp()` / `setCurrentHp(hp)` — `setCurrentHp()` switches to the
  Overview tab first (the HP input lives there and is hidden, not just
  non-interactive, on other tabs — `.fill()` requires visibility and will
  timeout otherwise); the getters use `.textContent()`/`.inputValue()`,
  which don't require visibility, so they don't need the same guard.
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
- `activateFeatureWithTargets(name, targetNames, {contestWon?})` — drives
  named-target capture and any follow-up contested-check confirmation through
  the real activation UI.
- `probeEfaArtilleristFlow(probe)` — drives source-specific EFA Artillerist
  mechanics through rendered sheet controls. The `baseCannon` probe creates,
  activates, damages, repairs, and cleans up a Force Ballista while asserting
  Action/Bonus Action and free-use costs. Higher-level probe variants cover
  Arcane Firearm, Explosive Cannon, and Fortified Position as those mechanics
  become available.

### Resources & slots

- `getResource(name): {current, max}`.
- `getResourceNames(): string[]`.
- `getSpellSlots(level): {current, max}`.
- `getPactSlots(): {current, max, level}`.
- `getInnateSpellNames(): string[]` — reads the separate innate-grant bucket.
- `getKnownSpellsByLevel()` includes ordinary, cantrip, and innate entries so
  cantrip-count probes measure the complete player spell surface.
- `castSpellAtSlot(level): {ok, remaining}`.
- `useResourceByName(name, amount = 1): {ok, remaining}`.
- `getMaxAttunement(): number` — reads the live attunement cap through the
  state API.

### Generic state transactions

- `runStateTransaction(steps, {restore = true})` — executes reusable state
  method descriptors, captures results for later `$ref` arguments, supports
  exact/min/contains/null/truthy/reference-delta expectations, and restores the
  pre-probe character snapshot by default. Use it for composed causal probes
  that have no stable UI boundary; descriptors must name methods and values,
  never branch on a class name in the dispatcher. Exact-source item probes
  must use the canonical item source expected by the runtime contract rather
  than a synthetic test source.

### Rests

- `triggerShortRest()` / `triggerLongRest()`.

### Combat

- `getAttackNames(): string[]`.
- `clickAttackRoll(name): boolean` — returns true if button found and
  clicked successfully.
- `getAttackBonus(name): string | null`.
- `getGrantedAttack(name)` — reads a feature-granted attack and its
  current Martial Arts die from state.
- `probeCombatFeatureAction(opts)` — exercises point spending, optional
  per-turn attack qualification, and attack/save output for a combat feature.
- `probeAttackQualification(attackName, sourceFeature?)` — rolls a rendered
  attack in combat and verifies the production roll path records Attack-action
  qualification metadata for the turn.
- `probeActiveStateTrigger(feature, stateTypeId)` — activates a state,
  resolves its trigger, and reports action use and damage.
- `probeActiveStateLight(feature, stateTypeId)` — verifies an activated
  state's light effect exists in state and renders its bright/dim ranges.

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
- `probeCartographerFlow(probe, spellThreshold?)` — source-isolated EFA
  Cartographer transactions for tools/crafting, exact XPHB spell tiers, Mapping
  Magic, Guided Precision, page-save-bounded Ingenious Movement, Superior
  Atlas, ASI/Epic Boon progression, and lifecycle teardown. Every state-driven
  branch restores the character afterward.
- The `atlas` Cartographer probe drives the real Long Rest modal for the
  exact-tools gate, optional-self/external-holder creation, recreation, rendered
  Atlas card, undo, ally-only Awareness negative, and save/load round-trip.

## When NOT to use a page object

If a probe touches state that has no public method:

1. Call `page.evaluate(() => globalThis.charSheet.someApi(...))`
   inline in a helper.
2. Wrap the result and add it to `CharacterSheetPage` as a method.
3. Document the new method in this file.

Spec files **never** call `page.evaluate` directly.
