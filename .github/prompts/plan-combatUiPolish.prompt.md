# Plan: Combat UI Polish & Partial Bug Completion

## TL;DR

Complete 11 partial bugs + 1 open bug from the character sheet plan. The back-end (calculation flags, classification overrides, parsing) is done. The missing piece is **interactive modal UI**: combat actions that apply conditions when used, choice modals for multi-option abilities, dice roll prompts with advantage/DC display, and a full survey of 85 TGTT combat methods.

**Approach**: Enhance `_showCombatActionModal()` and `_useCombatAction()` with a generic **effect-application pipeline** and **dice roll integration**, then wire each partial bug's specific UI through that shared system. Survey all TGTT traditions for parsing gaps in parallel.
**One phase per implementation run, fully verified before moving on**.

---

## Phase A: Generic Combat Action Effect Pipeline (Foundation)

**Goal**: Make `_useCombatAction()` apply conditions, toggle states, and trigger dice rolls — not just deduct resources. This is the reusable system all subsequent fixes plug into.

**Steps**:
1. Define a `combatActionEffects` schema on feature objects: `{applyCondition?, activateState?, grantAdvantage?, grantTempHp?, rollDice?, choiceModal?, multiTarget?}`
2. Extend `_useCombatAction(feature)` in `charactersheet-combat.js` (~L2194) to process `feature.combatActionEffects` after resource deduction:
   - `applyCondition: {name, duration}` → call `state.addCondition()` + toast
   - `activateState: stateId` → call activatable feature activation flow
   - `grantTempHp: {formula}` → call `state.setTempHp()`
   - `rollDice: {formula, label, vsTarget?}` → call `_rollCombatActionDice()` (new)
3. Add `_rollCombatActionDice(feature, diceConfig)` to charactersheet-combat.js that:
   - Uses existing `_page.rollD20()` for attack/save rolls with advantage/disadvantage from states
   - Uses existing `_parseDamage()` for damage dice
   - Shows result via existing `_page._showDiceResult()` toast pattern
   - Supports comparison against DC: "DC 15 CON save — Target rolls: [Roll] → {Pass/Fail}"
4. Add `_showCombatActionChoiceModal(feature, choices)` for abilities with choices (Flurry of Healing/Harm):
   - Reuses `UiUtil.pGetShowModal()` pattern
   - Renders choice buttons → each resolves to a sub-action with its own effects
5. Extend `detectActivatableFeature()` in charactersheet-state.js (~L27175) to populate `combatActionEffects` from parsed feature descriptions

**Verification**: Unit tests for effect pipeline: mock state, call `_useCombatAction()` with `combatActionEffects`, verify `addCondition()`/`setTempHp()` called.

**Files**:
- `js/charactersheet/charactersheet-combat.js` — extend `_useCombatAction()`, add `_rollCombatActionDice()`, `_showCombatActionChoiceModal()`
- `js/charactersheet/charactersheet-state.js` — extend `detectActivatableFeature()` to populate `combatActionEffects`

---

## Phase B: Enhanced Combat Action Modal with Dice UI

**Goal**: Upgrade `_showCombatActionModal()` to show interactive dice rolling, DC/save prompts, and effect previews.

**Steps**:
1. Add a **"Roll" section** to the modal below the description when `feature.combatActionEffects.rollDice` exists:
   - **Attack roll**: "Roll to hit" button → uses `_page.rollD20()` with feature's attack bonus → shows result inline in modal + toast
   - **Save prompt**: "Target must make DC {X} {ability} save" display with "Roll Save" button
   - **Damage roll**: "Roll damage" button (chain after attack hit or standalone) → uses `_parseDamage()`
2. Add an **"Effects" section** showing what happens on use:
   - "Applies: Invisible (until start of next turn)"
   - "Grants: Temporary HP (1d8 + WIS mod)"
   - "Removes: 1 Exhaustion level"
3. Add **advantage/disadvantage indicator** in the roll section when active states grant it
4. Wire the modal's "Use" button to close modal → call `_useCombatAction()` with effects → show dice result toast

**Verification**: Manual — open Stunning Strike modal, see "Target must make DC 14 CON save" + Roll button. Open Wind Strike, see "Roll with advantage" indicator.

**Files**:
- `js/charactersheet/charactersheet-combat.js` — extend `_showCombatActionModal()` (~L2289)

---

## Phase C: Individual Feature Polish (11 Partial Bugs)

### C1: Flurry of Blows *(small)*
- **Current**: Combat card with Use button, deducts Ki
- **Add**: In modal, show "Make 2 unarmed strikes" (or 3 if Heightened Focus). Link to unarmed strike attack roll. Wire existing `_rollAttack()` for unarmed strikes.
- **Files**: charactersheet-combat.js (modal rendering)

### C2: Patient Defense *(small — keep as toggle)*
- **Current**: Toggle state with Activate/End, applies disadvantage on attacks + DEX save advantage
- **Add**: Better visual feedback — show active effects inline on the toggle row: "Attackers have disadvantage • Advantage on DEX saves". Show remaining Ki cost.
- **Files**: charactersheet.js (`_renderActiveStates()` toggle row rendering)

### C3: Step of the Wind *(small)*
- **Current**: Combat card with Use button, deducts Ki
- **Add**: In modal, show "Dash or Disengage as bonus action. Jump distance doubled." If Heightened Focus: show extra "Move one creature within 5 ft up to 20 ft" text.
- **Files**: charactersheet-combat.js (modal rendering)

### C4: Wall Walk *(medium)*
- **Current**: Calculation flags exist, classified as passive
- **Add**: Reclassify to dual — passive component (walk on walls/ceilings) + combat action component (cast Spider Climb as bonus action, 1 stamina). Add the combat action to overrides for the spider climb sub-ability. In getFeatureCalculations, populate `combatActionEffects: {applyCondition: {name: "Spider Climb (self)", duration: "concentration, up to 10 minutes"}}`.
- **Files**: charactersheet-state.js (overrides, feature calc), charactersheet-combat.js (renders via standard pipeline)

### C5: Agile Acrobat *(medium)*
- **Current**: Calculation flag only
- **Add**: In `_registerFeatures()` / effect pipeline, apply: (1) Acrobatics proficiency via `state.addSkillProficiency("acrobatics")`, (2) DEX +2 (max 20) via `abilityScoreBonus` effect `{type: "abilityScoreBonus", ability: "dex", value: 2, maxScore: 20}`. Remove text-parser dependency.
- **Files**: charactersheet-state.js (feature effect registration)

### C6: Flurry of Healing and Harm *(medium)*
- **Current**: Calculation flag correct at level 11
- **Add**: When Flurry of Blows is used, show choice modal: "Replace one unarmed strike with: [Hand of Healing] [Hand of Harm]". Each choice triggers the sub-ability's effects (healing dice or necrotic damage + condition). Uses Phase A's `_showCombatActionChoiceModal()`.
- **Files**: charactersheet-combat.js (wire choice modal into Flurry of Blows Use flow)

### C7: Instant Step *(medium)*
- **Current**: Combat action classification + flags (hasInstantStep, instantStepRange=60, instantStepCost=4 stamina)
- **Add**: Combat action modal shows "Teleport up to 60 ft to unoccupied space you can see. Invisible until start of next turn." Use button: deducts stamina, calls `state.addCondition({name: "invisible", duration: "start of next turn"})`, shows toast.
- **Files**: charactersheet-combat.js (renders via standard pipeline), charactersheet-state.js (populate combatActionEffects)

### C8: Religious Training *(small-medium)*
- **Current**: Combat action classification done
- **Add**: Combat action modal shows stamina cost spinner (1-5 points), "Spend stamina to gain temporary divine favor" description. Use button deducts chosen amount.
- **Files**: charactersheet-combat.js (modal with spinner input)

### C9: Disciplined Survivor *(medium)*
- **Current**: All 6 save proficiencies applied, reroll cost tracked
- **Add**: (a) Death save proficiency display — add a `hasDeathSaveProficiency` flag, wire into death save roll to add proficiency bonus. (b) Reroll tracker — add "Reroll Failed Save (1/long rest)" to saves section or combat tab. When used, deduct and show re-roll via existing dice toast.
- **Files**: charactersheet-state.js (death save proficiency in roll calc), charactersheet-combat.js (reroll UI button near saves)

### C10: Wind Strike *(medium)*
- **Current**: Parser extracts range (20/60 ft), grantsAdvantage, bonusDamage (weapon die on double hit)
- **Add**: Combat action modal shows: "Ranged weapon attack, 20/60 ft. Roll with advantage." Roll Attack button → rolls d20 with advantage via `_page.rollD20({mode: "advantage"})`. On hit: Roll Damage. "If you hit with both dice (20+target AC), add extra weapon damage die." Uses Phase B's dice roll section.
- **Files**: charactersheet-combat.js (modal dice UI)

### C11: Whirlpool Strike *(large)*
- **Current**: Multi-target flag parsed, excluded from attacks, classified as combat
- **Add**: Combat action modal workflow:
  1. "How many creatures?" → number input (1–N, capped at creatures in reach)
  2. "Choose weapon attack" → dropdown of available melee attacks
  3. "Roll attacks" → rolls N attack rolls using selected weapon's bonus
  4. Per-hit: "Add 1d6 bonus damage per subsequent hit" (2nd target +1d6, 3rd +2d6, etc.)
  5. Results summary table
- **Files**: charactersheet-combat.js (multi-target modal flow — use `_showCombatActionChoiceModal()` extended with multi-step)

### C12: Respec Race/Background *(mark complete)*
- **Current**: Read-only grants summary exists
- **Decision**: Editing race/background in respec is too complex (requires full rebuild). Read-only display is the intended final state. Mark as COMPLETE.
- **Files**: bugs.md (update status)

---

## Phase D: TGTT Combat Methods Full Survey (85 Methods)

**Goal**: Read all 85 combat methods across 17 traditions, verify parsing correctness, fix gaps, add missing effects.

**Steps**:
1. **Data extraction**: Read all CTM optional feature data from TGTT source files. List every method with: name, degree, tradition, action type, stamina cost, save type, expected effects.
2. **Parsing audit**: For each method, run through `_parseCombatMethodEffects()` and verify extracted data matches expected. Log discrepancies.
3. **Fix parser gaps**: Update regex/parsing in `_parseCombatMethodEffects()` for any missed patterns (e.g., unusual cost wording, conditional triggers, multi-step effects).
4. **Add stance effect application**: For stance methods, wire `_parseStanceEffects()` output into the active state system so stances actually apply their bonuses (AC, speed, skill bonuses).
5. **Tradition proficiency grant**: Wire the "combat methods" class feature to grant tradition proficiency and allow choosing another method during levelup. This is the remaining open `[]` bug.
6. **Regression tests**: Add tests per tradition for at least 1 method each (17 tests minimum) verifying parsed effects match expected.

**Verification**: Run full TGTT test suite + new per-tradition tests. Verify no regressions.

**Files**:
- `js/charactersheet/charactersheet-state.js` — parser fixes in `_parseCombatMethodEffects()` (~L20899), stance application in active state system
- `js/charactersheet/charactersheet-combat.js` — stance rendering, method rendering fixes
- `js/charactersheet/charactersheet-levelup.js` — tradition proficiency + method choice at appropriate levels
- Test files for each tradition

---

## Phase E: Tests & Documentation

**Steps**:
1. Add test file `CharacterSheetCombatActionEffects.test.js` — tests for generic effect pipeline (conditions, temp HP, dice rolls, choices)
2. Add test file `CharacterSheetCombatMethodsSurvey.test.js` — 17+ tests for tradition method parsing
3. Extend existing `CharacterSheetToggleAbilities.test.js` — Patient Defense visual feedback
4. Extend existing `CharacterSheetTGTTMercyMonk.test.js` — Flurry of Healing/Harm choice flow
5. Extend existing test files for Instant Step, Wind Strike, Whirlpool Strike
6. Update `bugs.md` — mark all 11 partials + 1 open as [x] FIXED
7. Update `docs/charactersheet/08-toggle-abilities.md` — Patient Defense display enhancements
8. Update `docs/charactersheet/10-known-limitations.md` — remove items that are now fixed
9. Update `.agents/skills/charactersheet-development/references/subsystem-details.md` — document combat action effect pipeline

---

## Dependencies

```
Phase A ──→ Phase B ──→ Phase C (all items use A+B infrastructure)
                    └──→ Phase C1-C3 can start parallel with B (simple — no dice needed)
Phase D ──→ independent of A/B/C (parsing + data, not modal UI)
Phase E ──→ after all other phases
```

## Key Files

- `js/charactersheet/charactersheet-combat.js` — `_useCombatAction()` ~L2194, `_showCombatActionModal()` ~L2289, `_parseResourceCost()` ~L2269, `renderCombatActions()` ~L1729, `_rollAttack()` ~L787
- `js/charactersheet/charactersheet-state.js` — `detectActivatableFeature()` ~L27175, `FEATURE_CLASSIFICATION_OVERRIDES` ~L27042, `_parseCombatMethodEffects()` ~L20899, `_parseStanceEffects()` ~L21038, `ACTIVE_STATE_TYPES` ~L26018, `addCondition()`, `getDeathSaves()`
- `js/charactersheet/charactersheet.js` — `_renderActiveStates()` ~L4961, `_rollD20()` ~L7053, `_showDiceResult()` ~L7770
- `js/charactersheet/charactersheet-levelup.js` — tradition proficiency/method choice rendering
- `js/charactersheet/charactersheet-respec.js` — race/background grants (mark complete)
- `bugs.md` — status updates
- `docs/charactersheet/` — limitation/toggle docs updates

## Verification

1. `NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetCombatActionEffects CharacterSheetCombatMethodsSurvey --no-coverage --forceExit` — new test suites pass
2. `NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetToggleAbilities CharacterSheetTGTTMercyMonk CharacterSheetMonk --no-coverage --forceExit` — existing suites + new tests pass
3. Full suite: `NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage --forceExit` — 71+ suites, 6200+ tests, 0 failures
4. Manual: Stunning Strike modal shows DC + save prompt + Roll button; Flurry of Blows shows strike count; Instant Step applies invisible condition on Use
5. Manual: TGTT stance activates with AC/speed effects; multi-target method shows selection flow

## Decisions

- **Patient Defense stays as toggle** — ongoing effects (disadvantage/advantage) suit toggle behavior. Polished with inline effect labels.
- **Respec race/background editing excluded** — read-only display is final state. Too complex for respec (requires full rebuild).
- **Full TGTT survey** — all 85 methods across 17 traditions audited and tested.
- **Generic effect pipeline first** — avoids per-feature hardcoding. All abilities plug into `combatActionEffects` schema.
- **Dice UI reuses existing infrastructure** — `rollD20()`, `showDiceResult()`, `_parseDamage()` already exist. No new dice library.
- **One phase at a time** — Phase A first (foundation), then B (modal), then C (features) + D (survey) in parallel, then E (tests/docs).
