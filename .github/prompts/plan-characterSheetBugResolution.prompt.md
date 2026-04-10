## Plan: Systematic Bug Resolution for Character Sheet

Fix 50+ bugs from bugs.md organized into **10 phases by root cause**, not individual symptoms. Each phase targets one architectural area so fixes are cohesive, testable, and don't regress. **One phase per implementation run, fully verified before moving on**.

---

### Bug Taxonomy — 5 Root Causes

| Root Cause | Bug Count | Example |
|---|---|---|
| Feature classification system too aggressive | 12+ | Stunning Strike as toggle, not combat action |
| Missing Monk feature effect implementations | 15+ | Empowered Strikes flag exists, no effect logic |
| Specialty system not implemented | 10+ | Adept Speed selectable but does nothing |
| No combat action UI/modal | 4+ | No action modal in combat/overview tab |
| General UX/calculation issues | 8+ | Speed breakdown, homebrew skills, modal sizing |

---

### Phase 1: Feature Classification Fix (Systemic — Foundation)

**Goal**: Fix the root cause of 12+ bugs: `detectActivatableFeature()` misclassifies passive features and instant combat actions as toggleable states.

**Steps**:
1. Add a `FEATURE_CLASSIFICATION_OVERRIDES` lookup in charactersheet-state.js (~L26575) — keyed by feature name, declares `interactionMode: "passive"|"combat"|"instant"|"reaction"`, overriding pattern-based detection
2. Populate overrides for all misclassified features:
   - **Passive**: Monks Focus, Wall Walk, Heightened Focus, Unhindered Flurry, Disciplined Survivor, Empowered Strikes
   - **Combat action**: Hands of Harm/Mercy, Stunning Strike, Instant Step, Religious Training, Hand of Ultimate Mercy, Instant Strike
   - **Reaction**: Deflect Attack
3. Update `renderActivatableFeatures()` in charactersheet.js (~L4820) to respect overrides — combat-classified features route to combat tab, passives skip active states entirely
4. Write regression tests for each override

**Verification**: Run `CharacterSheetToggleAbilities` + `CharacterSheetTGTTMercyMonk` — all pass, no feature appears in wrong section

---

### Phase 2: Combat Action UI System

**Goal**: Build the missing combat action modal so features classified as "combat action" have a rendering path.

**Steps**:
1. Add `renderCombatActionModal()` in charactersheet-combat.js — analogous to `CharacterSheetSpellPicker.showSpellInfoModal()`
2. Extend `renderCombatActions()` (~L1720) to include features from Phase 1's override map
3. Add "Actions" section to overview tab (charactersheet.js ~L4731) — race/feat/class actions with hover detail
4. Wire "Use" button to existing resource deduction (`useFocusForStamina`, ki point deduction)
5. Gate combat spells modal: only show if character actually has spells (fixes Monk having empty spell modal)

**Verification**: Manual verification — Monk with Stunning Strike/Deflect Attack visible in combat tab; overview tab shows actions section; non-caster has no spell modal

---

### Phase 3: Monk Core Feature Implementations

**Goal**: Implement missing effect logic for core Monk features (PHB/XPHB).

**Steps**:
1. **Ki/Focus Save DC** — Gate on `monkLevel >= 2` in `getFeatureCalculations()` (~L8443). Currently added at level 1.
2. **Deflect Attack** — Register as reaction, add damage reduction display, wire counterattack ki cost
3. **Stunning Strike** — Register as combat action (1 ki), show DC + save type via Phase 2 modal
4. **Evasion** — Verify levelup path sets `hasEvasion` (flag exists in `getFeatureCalculations()` ~L8503)
5. **Empowered Strikes** — Add `calculations.hasEmpoweredStrikes` at monk level 10, register force damage effect
6. **Flurry of Blows / Patient Defense / Step of the Wind** — Ensure they appear in combat tab via Phase 2's system
7. **Monk Weapons** — Fix `isMonkWeapon()` (~L18702): quarterstaff and spear should qualify (simple melee, no heavy/two-handed)

**Verification**: Run `CharacterSheetMonk` (2100+ tests) — no regressions. Add new tests for each fix.

---

### Phase 4: Monk TGTT Subclass Implementations

**Goal**: Complete missing TGTT Monk subclass features (Way of Mercy, etc.)

**Steps**: Implements of Mercy, Physician's Touch, Flurry of Healing/Harm, Hand of Ultimate Mercy, Focus→Stamina verification. Read TGTT data files for exact feature definitions.

**Verification**: Run `CharacterSheetTGTTMercyMonk` (500+ tests) — no regressions + new tests

---

### Phase 5: Monk Specialty System

**Goal**: Implement the monastery specialties that currently do nothing (Adept Speed, Wall Walk, Agile Acrobat, Perfect Flow, Instant Step, Sixth Sense, Religious Training, Shadow Walk).

**Steps**: Read TGTT data, register each specialty's effects in `_registerFeatures()`, fix Adept Speed stacking (allow multiple selections with cumulative +10 ft each)

**Verification**: Dedicated specialty tests — e.g., Adept Speed ×2 = +20 ft

---

### Phase 6: Monk High-Level Features (L13-20)

**Goal**: Heightened Focus (modify Flurry/Patient Defense/Step of the Wind), Self-Restoration, Disciplined Survivor (all-save proficiency + reroll), Perfect Focus (ki recovery on initiative), Body and Mind (+4 DEX/WIS max 25), Unhindered Flurry (0 ki Flurry), Superior Defense

**Verification**: Tests for each at correct level. Disciplined Survivor: all 6 saves show proficiency.

---

### Phase 7: Combat Methods Deep Implementation

**Goal**: Fix Whirlpool Strike (remove from attack list → multi-target flow), Wind Strike, Instant Strike reclassification, ensure all methods use Phase 2 modal

**Verification**: Run `CharacterSheetTGTT` combat method tests

---

### Phase 8: Standalone Simple Fixes

**Goal**: Changeling Shapechanger as action, Monk TGTT equipment choices, homebrew skill ability modifiers, edit attack modal undefined default, levelup modal sizing

**Verification**: Targeted tests per fix + manual verification

---

### Phase 9: Stat Breakdown Visibility

**Goal**: Show how each stat is calculated — speed breakdown (sources tooltip), AC breakdown tooltip (already has `getAcBreakdown()`), saving throw/skill/attack roll breakdowns

**Verification**: Manual — hover shows correct component list

---

### Phase 10: Epic Boons, Respec, Actions Modal Polish

**Goal**: Make epic boons hoverable with calculation effects, show race/background grants in respec, populate Abilities modal, gate combat spell modal on having spells

**Verification**: Epic boon calculations in tests, manual UX checks

---

### Dependencies

```
Phase 1 ──→ Phase 2 ──→ Phases 3-8 (any order, but 3 before 4-6)
                     └──→ Phase 9 (independent)
                     └──→ Phase 10 (independent)
```

Phases 1 and 2 are **foundational** — they fix the classification system and build the combat action UI that all subsequent Monk phases depend on. After those, phases 3-8 can proceed in the listed order (3 before 4-6 since core Monk features are prerequisites for TGTT variants). Phases 9-10 are independent UX work.

### Decisions
- **One phase per run** — fully verify before moving to next
- **No new modules** — all fixes extend existing architecture
- **Test-first** for Phases 3-7: write the failing test, then implement
- **Scope boundary**: covers all bugs in bugs.md. The "Unverified bugs" section is excluded.
