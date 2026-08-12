# The Talent & Psionics (MCDM, `TalPsi`)

The Talent is a **full homebrew base class**, not a subclass bolt-on. It has no
spellcasting at all: instead of slots it spends **psionic strain**, a
three-track damage economy that degrades the character as it fills. This
document describes the strain subsystem, the generic machinery that surfaces
the Talent's many choices, and the Chronopath specialization.

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

## The manifest dialog

One bespoke modal, and it is earned: manifesting is a genuinely multi-field
decision (which power · at what order · with which Exertion · paid from which
track) whose *combination* determines the cost. Chaining sequential
`pGetUserEnum` prompts would hide the one thing that makes the decision legible
— the running strain total updating as the player pushes harder.

`_pUsePsionicAbility` therefore shows: a context line (power, order, discipline,
save DC), the concentration input, an Adept-reroll checkbox, a Reduce Stress
checkbox, a live projection strip (`role="group"`, `aria-live="polite"`) that
recomputes the worst-case strain as inputs change, and — after the roll — the
result lines plus the **penalty deltas** the new strain just switched on, read
from `getStrainState()`, so the cost is visible where it lands.

Everything else uses the sheet's existing prompt vocabulary and does **not** get
a modal: the Ignore Strain track choice on long rest is a single
`InputUiUtil.pGetUserEnum`; every "spend 1 strain to …" is a
`pGetUserBoolean`. The class adds exactly one dialog.

---

## Tests

- `test/jest/charactersheet/CharacterSheetTalent.test.js` — 63 tests covering
  the class table, every strain penalty against the *real* getters, overflow,
  rest behaviour, the manifestation test, every Chronopath ability, generic
  activation detection, and both derivation engines.
- `test/jest/charactersheet/CharacterSheetTalentSpecializations.test.js` — 74
  behavioural tests across all seven specializations, the generic Adept reroll,
  Reduce Stress, the class capstones, strain-cost detection and cross-class leak
  guards. Every assertion is on a derived effect (the fly speed that appears, the
  hit points that move, the Persuasion modifier that rises), never on a
  `has*` flag.
- `test/e2e/specs/tgtt-talent-chronopath.spec.ts` — full L1→20 comprehensive
  build with a `featuresMatrix` entry per feature per tier, plus two new
  shared `EffectCheck` kinds: `psionicStrainMechanics` (drives all three tracks
  through every threshold and asserts AC / speed / max HP / proficiency /
  advantage / healing / overflow / long rest) and `manifestationTest`.
