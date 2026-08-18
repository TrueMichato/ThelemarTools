# The Talent & Psionics (MCDM, `TalPsi`)

The Talent is a **full homebrew base class**, not a subclass bolt-on. It has no
spellcasting at all: instead of slots it spends **psionic strain**, a
three-track damage economy that degrades the character as it fills. This
document describes the strain subsystem, the **power model** (powers are
first-class entities, not list entries), the generic machinery that surfaces the
Talent's many choices, and the seven specializations.

The brew is auto-imported — `homebrew/index.json` lists
`MCDM Productions; The Talent and Psionics.json` in its `toImport` array, so
`BrewUtil2.pGetBrewProcessed()` surfaces it without a manual upload.

> The source's JSON `source` key is `TalPsi`, but its `_meta.sources[0].abbreviation`
> — the string the Builder's class list actually renders and matches on — is **`TAP`**.
> E2E presets must use `TAP` for `classSource`/`subclassSource` and `TalPsi` for
> `prioritySources`.

---

## Class table

| Level | Manifestation die | Max order | 1st-order known | Higher-order known | Strain max |
|---|---|---|---|---|---|
| 1-3 | 1d4 | 2 | 4 | level + 1 | 4 + level |
| 4 | 1d4 | 2 | 5 | level + 1 | 8 |
| 5-8 | 1d6 | 3 | 5 | level + 1 | 4 + level |
| 9 | 1d6 | 4 | 5 | level + 1 | 13 |
| 10-12 | 1d6 | 4 | 6 | level + 1 | 4 + level |
| 13-16 | 1d8 | 5 | 6 | level + 1 | 4 + level |
| 17-20 | 1d8 | 6 | 6 | level + 1 | 4 + level |

Hit die d6, saving throws CON/INT, light armor, two skills, multiclass
requirement INT 13, `subclassTitle` "Psionic Specializations".

---

## Psionic strain

`_data.psionicStrain = {body, mind, soul}` plus `_data.psionicStrainIgnored`
(the level-20 Ignore Strain choice).

Strain is **not** a status effect and **not** an active state. It is plumbed
exactly like exhaustion: a small numeric helper per affected getter, so there is
exactly one place per mechanic that knows about it and no parallel effect
system to keep in sync.

Each track imposes cumulative penalties at 1 / 3 / 5 / 7 strain (tiers 1-4):

| Tier | Body | Mind | Soul |
|---|---|---|---|
| 1 (1+) | disadvantage on Str/Dex checks | can't Dash, Disengage or Dodge | disadvantage on Wis/Cha checks |
| 2 (3+) | speed halved | lose skill proficiencies | disadvantage on death saves |
| 3 (5+) | disadvantage on Str/Dex saves | −5 AC | disadvantage on Wis/Cha saves |
| 4 (7+) | hit point maximum halved | lose saving throw proficiencies | supernatural healing halved |

### Where each penalty is actually applied

| Penalty | Hook |
|---|---|
| −5 AC | `getAc()` via `_getStrainAcPenalty()` |
| Speed halved | `getSpeedMultiplierFromConditions()` — the single shared speed hook |
| HP max halved | `getMaxHp()` (deliberately **not** `_calculateMaxHp()`, so an explicitly-set `hp.max` is halved too, without double-halving) |
| Lose skill proficiencies | `getEffectiveSkillProficiency()` — a new roll/display-time reader. Raw `getSkillProficiency()` is untouched so level-up, expertise and respec still see the real proficiency |
| Lose save proficiencies | `hasSaveProficiency()` |
| All disadvantage families | `getAdvantageState()` — the single funnel for adv/dis; initiative and death saves delegate to it. Strain folds in *before* the `removeDisadvantage` pass |
| Supernatural healing halved | `heal(amount, {supernatural: true})` |

### Limits and recovery

- `addStrain()` **refuses** to push past the maximum rather than clamping
  silently; it returns `{applied, overflow}`.
- When strain would exceed the maximum, RAW offers a choice. That choice is a
  real API: `resolveStrainOverflow({manifest, strain, track})` either applies
  the strain and kills the character (0 hp, three death-save failures) or
  declines the power and drops them to 0 hp.
- Short rest: `spendHitDieToRemoveStrain(track)` — one Hit Die removes one strain.
- Long rest: `onLongRest()` calls `clearStrain()`.
- Level 20 Ignore Strain: `setIgnoredStrainTrack(track)` suppresses one track's
  *effects*. The strain is still counted against the maximum.

`getStrainState()` returns the whole picture (per-track values, tiers, and one
boolean per penalty); `getStrainTrackEffects(track)` returns the human-readable
list of live penalties, which is what the sheet's strain tracker renders.

---

## Powers as first-class entities

A power is not a row in a list. It has metadata, per-order bodies, variant modes, an
upcast rule and a concentration requirement that depends on *how* it is manifested —
all of which the source data states as prose or as an overloaded `modes[]` array.

### The parser

`CharacterSheetClassUtils.parsePsionicPower(power)` is the single place that turns a
`psionic` entity into data. It is pure, and cached on the power object (a `WeakMap`, so
a re-parse can never go stale), which is why rendering a list re-parses nothing.

It lifts the three bolded header strings that open every power's `entries[]` —
`Manifestation Time`, `Range` and, for 64 of the 103 in `TalPsi`, `Duration` — out of
the body, and normalizes the manifestation time into an
`actionType` of `action` | `bonus` | `reaction` | `long` (86 / 6 / 5 / 6 in `TalPsi`),
capturing the reaction's trigger text where there is one.

It then classifies every `modes[]` entry, because that one array does four unrelated
jobs distinguishable only by the mode's `name`:

| `kind` | Name shape | Meaning |
|---|---|---|
| `orderBand` | `2nd-Order` | The power's body when manifested at that order |
| `levelBand` | `5th-10th Level` | Cantrip-style scaling for a 1st-order power |
| `increasedOrder` | `Increased Order` | The upcast rule |
| `variant` | anything else | A player choice at manifest time (Aura Projection's *Inspired* / *Sorrow* / *Terror*) |

**Concentration is a property of the manifestation, not of the power.** It is stated on
46 individual modes (`modes[].concentration`), never in a `TalPsi` Duration header, so
`getPsionicPowerConcentration(power, {order, modeName, characterLevel})` resolves it for
one specific manifestation. The parsed `concentrates` flag is display-only ("could this
tie up concentration at all?"). A Duration header that *does* state concentration is
handled defensively for future data.

Note that a 1st-order power can still require concentration — *Apparition* does. That is
not a contradiction: 1st-order powers skip the manifestation test, not the duration
rules, and it is exactly why *Strain to Maintain* exists.

### The projection

`getKnownPowers({order, discipline, firstOrderOnly, higherOrderOnly})` is a
**projection, not a store**. The authoritative record of which powers are known stays in
`_data.features`, written by the shared optional-feature picker — which is why the
Builder, Level-Up and Quick Build flows needed *no changes at all*. The getter selects
features by the same predicate activation uses (`_psionicOrder` plus a `PsiP*` optional
feature type), joins each to the catalog and the parser, and returns one ready-to-render
shape.

> The catalog is installed with `setPsionicCatalog()` from `_mergeBrewData()`. It is
> reference data, not saved state. The state getter is `getKnownPowers()` and **not**
> `getPsionicPowers()`, which already exists on the *page* and returns the raw catalog.

A parallel `_data.psionics.powersKnown` would have been a second source of truth for the
same fact, and is deliberately absent. `_data.psionics` holds runtime state only:
`{activeManifestations, learning, replacementUsedAtLevel, learnLockedOut}`.

---

## Concentration is a list, not a slot

RAW: *"you can simultaneously maintain concentration on a number of powers equal to your
proficiency bonus"* — and never on a power and a spell at once. The sheet's
`_data.concentrating` was a single object, which is why the manifest dialog used to ask
the player to **type in** their own manifestation score.

`_data.concentrations[]` is now the store. Each entry is
`{id, kind: "spell" | "power" | "ability", name, order, modeName, …}`.

| API | Behaviour |
|---|---|
| `getConcentration()` | **Back-compat shim** — the first entry. Every pre-existing caller reads `.spellName` / `.spellLevel` off it and is untouched |
| `getConcentrations()` / `getConcentrationCount()` / `isConcentratingOn(id)` | The list |
| `getPowerConcentrations()` / `getSpellConcentration()` | The two halves |
| `setConcentration(...)` | Unchanged spell semantics: replaces the whole list |
| `addConcentration(entry, {replaceId})` | Enforces the rules centrally (below) |
| `breakConcentration(id?)` | One entry, or everything |

`addConcentration` is where the rules live, so no call site can get them wrong:

- adding a **spell** or an **ability** clears everything else;
- adding a **power** clears any spell, then respects `getPowerConcentrationMax()`
  (= proficiency bonus), dropping the oldest power — or `replaceId` — when full;
- re-adding the same id replaces its own entry, which is what implements *"you can't
  have multiple manifestations of the same power active at once"*.

Two subtleties worth keeping:

- `_teardownConcentration()` removes the matching **active manifestation** when the entry
  is a power. Putting it there rather than at each call site means the invariant holds
  however the entry was dropped — ended by hand, replaced, or evicted by the cap.
- `breakConcentration()` with no id still performs an unconditional **sweep** (dismiss
  companions, clear the legacy singleton state) even when nothing was being concentrated
  on. Callers have always relied on that defensively; skipping it silently orphaned
  summons. The sweep is skipped when Lingering Spell converted the effects instead.

Saved characters migrate in `loadFromJson()`: `concentrating` → `concentrations[0]`.

---

## Manifestation test

1st-order powers manifest automatically. For order ≥ 2:

```
score = order + 1 per OTHER power you are concentrating on
roll the manifestation die
  roll  > score → no strain
  roll === score → 1 strain
  roll  < score → strain equal to the power's order
```

`rollManifestationTest(order, {roll, concentratingOn, track, apply})` returns
`{score, roll, strain, applied, outcome, overflow}` where `outcome` is
`"automatic" | "clean" | "grazed" | "strained"`.

---

## `manifestPower()` — the one pipeline

Every surface — the Powers tab, play mode, the tests — goes through
`manifestPower(powerId, opts)`, so none of them can disagree about what manifesting
costs. In one ordered pass it:

1. validates the order (never below the power's own, never above `getMaxPowerOrder()`,
   never above 6);
2. **derives** `concentratingOn` from `getPowerConcentrations()` — the number is no
   longer typed in by the player;
3. rolls the manifestation test (Adept reroll and Reduce Stress included);
4. charges an at-manifestation Psionic Exertion;
5. registers concentration when the chosen order/mode requires it;
6. records the running manifestation.

On overflow **nothing is committed beyond the roll** — the caller resolves the RAW
"manifest and die / decline and drop to 0 hp" choice through `resolveStrainOverflow()`.

`endManifestation(id)` is free and takes no action, per RAW. `endAllManifestations()` is
wired to incapacitation, death and the long rest, because *"if you become incapacitated
or die, all of your current active powers end immediately"* covers powers that never
required concentration in the first place.

### Psionic Exertion

`CharacterSheetClassUtils.PSIONIC_EXERTIONS` records the two things about an Exertion
that are not derivable from its name — **when** it can be spent and **what** it costs:

- `timing: "manifestation"` (Expanded, Magnified, Shared) → a dropdown in the manifest
  dialog;
- `timing: "outcome"` (Destructive, Dynamic, Fascinating, Halting, Overwhelming,
  Terrifying) → an **Exert** button on the active-manifestation row, since they trigger
  on a hit or a save after the dice have landed.

Costs reuse the existing `resolvePsionicStrainCost()` vocabulary (`powerOrder`,
`halfPowerOrder`, a flat number), and `costOptions` carries the size-scaled alternatives
(Dynamic Power: 2 / 3 / 4 by target size). RAW allows only one Exertion per
manifestation, enforced in state.

> Exertions are **priced before they are charged**. `addStrain()` fills to the maximum
> and reports the overflow rather than refusing, so calling it first would leave the
> character having part-paid for a benefit they cannot afford.

### Strain to Maintain

`payStrainToMaintain({track, apply})` derives the cost from what is *actually* being
concentrated on (the summed order), and `apply: false` quotes it so the prompt can state
the price before the player commits. The original numeric signature —
`payStrainToMaintain(3, "soul")` — still works and takes precedence when supplied.

---

## Acquiring powers

- **Per level**: the `level + 1` budget comes from the generic progression. The swap is
  `replacePsionicPower(outgoingId, incoming)`, guarded by
  `_data.psionics.replacementUsedAtLevel`, restricted to a power of equal or lower order,
  minimum 2nd. 1st-order powers are a separate fixed pool and are not swapped this way.
- **Learning from others**: `rollLearnFromOthers(power)` rolls the manifestation die
  against the power's **baseline** order (never the order it was manifested at). Beating
  it opens a study period sized by the RAW table (2nd → 1 day … 6th → 16 days);
  `advancePowerLearning()` logs a day and teaches the power on completion. A roll equal
  to or below the order locks the character out until a long rest.

---

## How the Talent's choices reach all three build flows

The class JSON has **no `optionalfeatureProgression`**, and the 103 psionic
powers live in a `psionic` prop that the character sheet had never consumed.
Rather than write three bespoke pickers, two generic engines were added.

### 1. Derived optional-feature progressions

`CharacterSheetClassUtils.deriveOptionalFeatureProgressions(classData, classFeatures, optionalFeatures)`
walks a class's own features looking for inline `refOptionalfeature`
enumerations. When it finds one it synthesises an `optionalfeatureProgression`
entry at that feature's level, then scans sibling features for back-references
of the form "you gain another `{@classFeature Psionic Exertion|Talent|TalPsi|3}`
option" to grow the count. It **never** shadows a hand-authored progression.

This is what turns the Talent's L3 Psionic Exertion feature (plus its L7/L11/L15
improvements) into a real "choose N" pick in Builder, Level-Up and Quick Build.

### 2. Psionic powers republished as optional features

`PSIONIC_MANIFESTERS` is a small config table (currently one entry, `Talent`).
`buildPsionicOptionalFeatures(powers, config)` republishes each `psionic` entry
as an optional feature:

- `featureType` is `PsiP1` for 1st-order powers and `PsiPH` for everything else.
  The codes are deliberately disjoint prefixes — optional-feature type matching
  uses `startsWith`, so a `PsiPow:1` would collide with `PsiPow`.
- The original discipline code (`TK`, `TP`, …) is moved to `_psionicPowerType`
  and `type` is cleared, because a discipline code in the `type` slot would be
  misread as an optional-feature type code.
- `_psionicOrder` is recorded and a `{level: {level, class}}` prerequisite is
  attached so a 5th-order power cannot be picked before Talent 13.

`buildPsionicProgressions(config)` then emits the two growing pools (4/5/6
1st-order, level + 1 higher-order).

Both engines run from `charactersheet.js._mergeBrewData()`, so they apply to any
future class that declares itself in `PSIONIC_MANIFESTERS`.

---

## Activation

`CharacterSheetState._detectPsionicActivation()` runs inside the normal
`detectActivatableFeature()` pipeline and fires generically for:

1. any feature carrying `_psionicOrder` and a `PsiP*` optional-feature type, and
2. **any** feature whose text matches `gain (up to )?(N|your proficiency bonus) strain`.

Rule 2 is what makes Chronopath's Decay ("gain up to your proficiency bonus
strain") and Time Pocket ("you gain 3 strain") genuine Use-button actions rather
than paragraphs of text — with no Chronopath-specific code.

Activation opens a modal that rolls the manifestation test, shows the score, the
strain charged and the resulting live penalties, and — on overflow — offers the
two `resolveStrainOverflow` buttons.

The Resources tab renders a **strain tracker** with +/− controls per track, the
running total against the maximum, and the live penalty list.

---

## Chronopath

| Level | Feature | Mechanical effect |
|---|---|---|
| 2 | Chronopathy Adept | Long-rest resource, INT modifier uses (min 1) |
| 2 | Rapid Manifestation | Long-rest resource, INT modifier uses (min 1) |
| 6 | Decay | `useDecay(strain, track)` — 2d10 necrotic per strain spent, capped at the proficiency bonus, Wis save vs the power save DC |
| 10 | Fickle Readiness | Activatable; charges 1 strain |
| 14 | Time Pocket | `useTimePocket(track)` — 3 strain, 6d10 psychic, Cha save vs the power save DC, 1d4 + 1 rounds |

Chronopath calculations are gated on both the subclass and the level, and are
verified not to leak into the other six Psionic Specializations.

---

## The generic discipline mechanism

The seven specializations are not seven implementations. Every psionic power in
the source data carries a `_psionicPowerType` discipline code
(`CP` Chronopathy · `MM` Metamorphosis · `PK` Pyrokinesis · `RP` Resopathy ·
`TK` Telekinesis · `TP` Telepathy), and
`PSIONIC_MANIFESTERS["talent|talpsi"].disciplines` maps each code to its
subclass and its discipline noun. `getPsionicDisciplineForSubclass()` resolves
in the other direction.

That map is what lets the shared rules be written once:

**The Adept reroll.** All six disciplines grant a "*<Discipline>* Adept" feature
— reroll the manifestation die, use either result. `rollManifestationTest(order,
{allowAdeptReroll, powerType})` implements it once: it rerolls, takes
`Math.max(first, reroll)`, spends a use, and does **not** spend one when the
first roll already succeeded. `hasChronopathyAdept` survives as an alias of the
generic `hasDisciplineAdept` so the pre-existing Chronopath tests and E2E spec
keep passing unchanged.

Note the feature name is the **discipline noun**, not the subclass adjective:
`Telekinesis Adept`, not `Telekinetic Adept`. The resource pool is minted by
`_resizeFeatureBackedResource`, which mints nothing unless a matching entry
exists in `_data.features` — so a test that never adds the feature will see an
empty resource list and conclude, wrongly, that the mechanism is broken.

**Strain cost detection.** `_detectPsionicStrainCost()` runs an ordered pattern
table (`PSIONIC_STRAIN_COST_PATTERNS`) and yields a derived cost of
`"powerOrder" | "halfPowerOrder" | "proficiencyBonus" | "any" | <number>`,
resolved at use time by `resolvePsionicStrainCost()`. Extending the table is how
a new strain-priced feature becomes activatable; writing per-feature code is not.
See CS-BUG-132 for what the previous single-regex version silently swallowed.

**Strain reduction.** Maverick's *Reduce Stress* halves strain gained *from
manifesting only* (minimum 1), and is not spent when the manifestation cost no
strain. It is implemented as an opt-in flag on the strain-gain path rather than
a Maverick special case, so any future "reduce the strain you gain" feature
reuses it.

---

## The other six specializations

All calculations are gated on subclass **and** level, and leak tests assert each
is absent from the other six.

### Maverick

| Level | Feature | Mechanical effect |
|---|---|---|
| 2 | Raw Power | INT modifier added to one 1st-order damage roll |
| 2 | Reduce Stress | Halves manifesting strain, min 1; generic strain-reduction hook |
| 6 | Energy Unleashed | 1d6 psychic per strain spent, Wis save vs the power save DC |
| 10 | Shock Absorption | Reaction, 1 strain, halves incoming damage |
| 14 | Full Force | Maximizes a power's damage, once per short rest |

### Metamorph

| Level | Feature | Mechanical effect |
|---|---|---|
| 2 | Psionic Toughness | Toggle: max **and** current HP + `max(1, INT + level)`, death-save advantage |
| 6 | Mind Surgeon | Variable strain → 1d10 each |
| 6 | Super Senses | INT modifier added to Perception checks (and thus to passive Perception) |
| 10 | Death Foiled | 8 strain; resurrection, once per long rest |
| 14 | Psionic Evolution | While Psionic Toughness is up: +10 walking speed, immunity to poison damage, the poisoned condition and disease |

`Super Senses` emits a `skill:perception` modifier and **not** a
`passive:perception` one. `getPassiveScore()` already derives from
`getSkillMod()`, so emitting both double-counts. Observant emits only the
passive because it is a passive-*only* bonus; Super Senses is a check bonus.

### Pyrokinetic

| Level | Feature | Mechanical effect |
|---|---|---|
| 2 | Flame On | Toggle; 1/2/3/4 flames at L2/5/11/17, `1d6`→`1d8` and 60→120 ft at 10 |
| 6 | Bend Flame | Three options (`pGetUserEnum`) |
| 10 | Heat Seeking | Range 120, ignores cover, damage die → 1d8 |
| 14 | Immolate | 2 × proficiency bonus fire damage at the start of the turn |

### Resopath

| Level | Feature | Mechanical effect |
|---|---|---|
| 2 | Manipulate Terrain | Toggle marking the shaped area |
| 6 | Manifest Ally | Variable strain; summon CR = `floor(level / 3)`, strain equal, min 1 |
| 10 | Imagination Creation | Activatable, strain-priced |
| 14 | Nightmare Terrain | Damage equal to the flat talent level |

### Telekinetic

| Level | Feature | Mechanical effect |
|---|---|---|
| 2 | Invisible Armor | Reaction; AC bonus equal to the INT modifier |
| 6 | Strong Mind | 1 strain to swap a Str/Dex save to Int; +10 ft forced movement |
| 10 | Reflective Armor | Activatable, strain-priced |
| 14 | Mind Wings | A **real** 60 ft flying speed via the shared speed path (CS-BUG-130) |

### Telepath

| Level | Feature | Mechanical effect |
|---|---|---|
| 2 | Greater Telepathy | Range and reach extension |
| 6 | Emotional Intelligence | INT modifier added to Deception, Insight, Intimidation, Persuasion |
| 6 | Not in the Face | Activatable, strain-priced |
| 10 | Shared Connection | Activatable, strain-priced |
| 14 | Truth Hurts | 2d8 per strain spent |

---

## Class capstones

| Level | Feature | Mechanical effect |
|---|---|---|
| 11 | Psionic Bastion | Psychic resistance; immune to charmed, frightened, **and being magically put to sleep** |
| 18 | Shielded Mind | Advantage on Int/Wis/Cha saves; immune to having thoughts read, alignment detected, creature type detected, and to unwanted telepathy |
| 20 | Ignore Strain | One track is ignored; the track is re-chosen when a long rest ends |

Registry effects (`conditionImmunity`, `resistance`, `modifier`) only reach the
getters after `applyClassFeatureEffects()` — this is true of every class, not a
Talent quirk, and a probe that skips that call will wrongly report them missing.

---

## The Powers tab

`charactersheet-powers.js` renders a dedicated `🧠 Powers` tab, shown only when
`isPsionicManifester()` resolves — the same conditional-visibility mechanism
`_updateTabVisibility()` already uses for Builder and Respec. It deliberately reuses the
spell tab's visual language rather than inventing a second one: a power *is* the psion's
spell, and a player who knows one panel already knows this one.

| Section | Contents |
|---|---|
| Manifesting | Manifestation die, power save DC, power attack bonus, max order, both powers-known budgets, and the concentration meter *n / PB* |
| Strain | A gradient meter, the three tracks with ± controls and their live penalties, plus *Psychic Boost* and *Strain to Maintain* buttons when they apply |
| Active manifestations | One row per running power — order, mode, concentration, an **Exert** button for outcome-timed options, and **End** |
| Learning from others | The in-progress study with its day counter, or the long-rest lockout notice |
| Powers | Grouped by order, 1st-order first and badged **At will · no test · no strain**, with discipline chips, parsed metadata, a favourite star, expandable bodies and **Manifest** |

The only new visual idiom is the strain meter, because strain has no spell analogue: it
is a cost that *accumulates* rather than a slot that empties.

Expanding a power renders its parsed body plus the modes that actually apply — the
character's own level band, not all four — with the `Increased Order` rule highlighted.

Powers also reach:

- **Play mode**, as a Powers card mirroring `_renderSpellsQuick()`: DC, attack bonus,
  manifestation die, strain, concentration count, running manifestations with an End
  button, then the at-will pool. Its Manifest button opens **the same dialog** the tab
  does, so the two surfaces cannot drift.
- **Favourites**, as a `power` type resolved through `getKnownPower()` rather than by
  reaching into `features`, so a favourited power reports whether it is currently running.

### The manifest dialog

One bespoke modal, and it is earned: manifesting is a genuinely multi-field decision
(which power · at what order · in which mode · with which Exertion · paid from which
track) whose *combination* determines the cost. Chaining sequential `pGetUserEnum`
prompts would hide the one thing that makes the decision legible — the running strain
total updating as the player pushes harder.

It shows a context line (order, discipline, save DC, attack bonus, manifestation time,
range), and then:

- an **order stepper** from the power's own order up to `getMaxPowerOrder()`, printing
  the power's `Increased Order` rule and updating the score live. It is absent when the
  power cannot be increased — a 4th-order power at Talent 9 is already at the cap;
- a **mode selector** when the power offers variant effects;
- an **Exertion dropdown** of the at-manifestation options the character actually knows;
- an **auto-derived, read-only** manifestation score reading
  *"4 + 1 for the power you are already concentrating on"* — replacing the number the
  player used to type;
- a strain-track selector, and the Adept-reroll / Reduce-Stress checkboxes;
- a live projection strip (`role="group"`, `aria-live="polite"`) giving worst-case strain,
  the projected total, whether it would exceed the maximum, whether concentration will
  evict an older power, and whether a concentrated spell is about to end.

After the roll it shows the result lines plus the **penalty deltas** the new strain just
switched on, so the cost is visible where it lands, and — on overflow — the two
`resolveStrainOverflow` buttons.

Everything else uses the sheet's existing prompt vocabulary and does **not** get a modal:
the Ignore Strain track choice, the strain-track pick for an outcome Exertion and the
Strain-to-Maintain confirmation are all `InputUiUtil.pGetUserEnum`. The class adds
exactly one dialog.

---

## Tests

- `test/jest/charactersheet/CharacterSheetTalent.test.js` — the class table, every strain
  penalty against the *real* getters, overflow, rest behaviour, the manifestation test,
  every Chronopath ability, generic activation detection, and both derivation engines.
- `test/jest/charactersheet/CharacterSheetTalentSpecializations.test.js` — behavioural
  tests across all seven specializations, the generic Adept reroll, Reduce Stress, the
  class capstones, strain-cost detection and cross-class leak guards. Every assertion is
  on a derived effect (the fly speed that appears, the hit points that move, the
  Persuasion modifier that rises), never on a `has*` flag.
- `test/jest/charactersheet/CharacterSheetPowers.test.js` — the parser (all four mode
  kinds, both concentration sources, level bands, action-economy buckets), the
  projection, both budgets, order validation, increased order, auto-derived scores,
  active manifestations and the no-multiples rule, Exertion timing and pricing, Strain to
  Maintain, per-level replacement and learning-from-others. Backed by
  `fixtures/psionic-powers-talpsi.json`, five real powers chosen to cover every mode kind
  — including *Apparition*, a 1st-order power that still ties up concentration.
- `test/jest/charactersheet/CharacterSheetConcentration.test.js` — the multi-slot model:
  unchanged single-spell behaviour, the proficiency-bonus cap, power/spell mutual
  exclusion, ending one without ending the rest, and the `concentrating` → `concentrations`
  migration.
- `test/e2e/specs/tgtt-talent-chronopath.spec.ts` — full L1→20 comprehensive build with a
  `featuresMatrix` entry per feature per tier, plus the shared `EffectCheck` kinds
  `psionicStrainMechanics` (drives all three tracks through every threshold and asserts
  AC / speed / max HP / proficiency / advantage / healing / overflow / long rest) and
  `manifestationTest`.
