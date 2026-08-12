# Beastheart (MCDM, `BST`)

*Beastheart and Monstrous Companions* is a homebrew class built around a
**monstrous companion** with a **Ferocity** track. It is the first class on the
sheet whose primary subject is a *second creature*, so most of the interesting
decisions are about where that creature's state lives rather than about the
features themselves.

Source: `MCDM Productions; Beastheart.json` in TheGiddyLimit's homebrew repo.
Hit die d8. Five subclasses ("Companion Bonds"): Ferocious, Hunter, Infernal,
Primordial, Protector.

---

## 1. The rules, stated correctly

Ferocity is easy to get wrong from memory. The published text says:

| Rule | Detail |
|---|---|
| **Gain** | At the start of the companion's turn, if it is not incapacitated: `1d4` **plus one per hostile creature within 5 feet** it can see or hear. Creatures sharing a stat block (a swarm) count as one. |
| **Maximum** | **There is none.** Ferocity is unbounded. |
| **Rampage** | Not a state you enter at a cap. At **10 or more** ferocity the companion *risks* a rampage; the caregiver makes a Wisdom (Animal Handling) check at **DC 5 + current ferocity** to prevent it. |
| **Resolving a rampage** | Ferocity drops to **0** with **no** healing. |
| **End of combat** | Ferocity drops to 0 **and the companion regains hit points equal to it** — withheld if the companion is dying. |
| **While rampaging** | Ferocity actions are **illegal**. A rampaging signature attack deals **half ferocity** extra damage. |
| **While unconscious** | Ferocity actions remain **legal**. |

Two consequences drive the whole implementation: ferocity is **not** rest-based,
and it belongs to the **companion**, not the character.

---

## 2. Architecture

### 2.1 The companion is a `_data.companions[]` record

The sheet already has a mature companion subsystem — `COMPANION_TYPES`,
`addCompanionFromBestiary`, `damageCompanion` / `healCompanion`,
`recalculateCompanion`, and a card renderer in `charactersheet.js`.
`recalculateCompanion`'s own comment names the declarative `scaling` descriptor
as *"the path any new feature-granted summon should take"*, so Beastheart takes
it: a new `COMPANION_TYPES.BEASTHEART_COMPANION`, created through
`addCompanionFromBestiary`.

Persistence is free — `toJson()` deep-copies `_data`, so new fields on a
companion record round-trip with no serialisation work.

> The `charactersheet-spawn*.js` modules are **not** related. They are a seeded
> character-*generation* test harness that drives the Builder and Quick Build
> wizards; the name collision is coincidental.

### 2.2 Ferocity lives on the companion record, not in `_data.resources[]`

`_data.resources[]` models **bounded, rest-recharging** pools. Ferocity is
unbounded, clears at end of combat rather than on a rest, and belongs to the
companion. Forcing it in would have meant a fake `max`, a `recharge` value that
lies, and a pool excluded from the rest pipeline — a parallel system wearing the
resource system's clothes.

So the companion record carries `ferocity` and `isRampaging`, with state methods
sitting beside the existing companion HP methods:

| Method | Returns |
|---|---|
| `gainCompanionFerocity(id, {hostilesWithin5, roll})` | `{ferocity, gained, bonus, hostiles, roll, rampageDc, rampageRisk}` |
| `spendCompanionFerocity(id, cost)` | `{ok, spent, ferocity, reason}` — `reason ∈ null \| "no-companion" \| "rampaging" \| "insufficient"` |
| `resolveCompanionRampageCheck(id, {isSuccess, isDeclined})` | `{isRampaging, dc, isAutomatic}` |
| `endCompanionRampage(id)` | raw — ferocity to 0 |
| `endBeastheartRampage(id)` | bond-aware — honours Energizing Rampage's floor |
| `endCompanionCombat(id)` | reset **and heal** |
| `getCompanionRampageDc(id)` | `5 + ferocity` |

The genuinely rest-bounded features **do** use `_data.resources[]`, through
`_ensureBeastheartResources()`: Rejuvenating Ferocity (L6), Summon the Wilds
(L18), Primal Warding (L7 Hunter), Unseen Hunters (L15 Hunter), Hell's Charmer
(L7 Infernal).

> **Adopt, don't push.** The generic feature-description parser already mints a
> pool for any feature whose text says "a number of times equal to your Wisdom
> modifier". `_ensureBeastheartResources` therefore looks for an existing row by
> name before creating one, otherwise the sheet grows two identically-named
> "Rejuvenating Ferocity" rows — one live, one static.

### 2.3 Scaling reuses `ScaleClassSummonedCreature` verbatim

All 15 companions carry `summonedScaleByPlayerLevel: true` and express every
stat as a `special` string in terms of PB and the caregiver's level:

```json
"hp": {"special": "7 + 7 times caregiver's level"},
"ac": [{"special": "13 plus PB (natural armor)"}]
```

`js/scalecreature/scalecreature-scaler-summon-class.js` already resolves exactly
this vocabulary — it even special-cases the literal phrase `caregiver's level` —
so nothing new was written. A `statblockScaler: "classSummon"` mode was added to
the existing `_recalculateScaledCompanion`, which stores the pristine unscaled
stat block and re-runs the scaler whenever level changes. A `scaleSync()` was
split out of the scaler's `async scale()` (whose body contained no `await`, so
the split is behaviour-preserving).

**Order matters:** `_parseBestiaryCreatureToBeastRecord` must run *after* the
scaler, or it parses `"7 + 7 times caregiver's level"` as a literal.

### 2.4 Pick counts are derived, not hand-authored

Beastheart's `optionalfeatureProgression` is `null`; the counts live in the
standard `{type: "options", count: N}` shape inside each feature's entries.
`CharacterSheetClassUtils.deriveOptionalFeatureProgressions` already synthesised
progressions from inline `refOptionalfeature` entries, but assumed one pick per
feature. It was generalised to honour an enclosing `options.count` and to
accumulate same-named features across levels, then split so subclasses get the
same treatment via `deriveSubclassOptionalFeatureProgressions`.

Derived result, matching the printed class table (`0,3,3,…,5,5,…,7`) exactly:

| Level | `count` | Cumulative |
|---|---|---|
| 2 | 3 | 3 |
| 10 | 2 | 5 |
| 17 | 2 | 7 |

That generalisation exposed **CS-BUG-140** — see `known-bugs.md`.

> **Mystic Connection (`BST:MC`) is not a player choice.** The 15 MC optional
> features map 1:1 to the 15 companion monsters, each carrying a prerequisite
> naming its companion. Picking a companion picks the connection.

---

## 3. UX

Per `DESIGN.md`'s "one shell, many contents", the companion surface reuses the
existing `.charsheet__companion-card` chrome rather than inventing a panel.

**Exactly one bespoke modal is earned:** companion selection at 1st level
(`CharacterSheetModal.pGetShow`), because the player is comparing fifteen stat
blocks, not picking a label. Every other decision uses vocabulary already on the
page — `pGetUserNumber` for hostiles-within-5-feet, `pGetUserBoolean` for the
rampage check, `pGetUserEnum` for exploits, Primal Strike type, Beyond Instinct
picks and Fiendish Traits, `pGetUserString` for the quarry's name.

### There is never an unbonded Beastheart

The Companion feature is not a pending choice — it is granted at 1st level, and
*everything* else in the class reads the companion record. A Beastheart with no
companion is therefore not a character awaiting a decision, it is a broken
character with a dead control strip: no ferocity, no exploits, no bond features,
no Signature Attack.

So the sheet guarantees one. `_ensureBeastheartCompanionBonded()` bonds the first
roster entry as a default and toasts once to say it is the player's to change;
**Choose Companion** re-opens the picker at any time and rebonding is free.

It is called from two places, on purpose:

| Call site | Why |
|---|---|
| `_reconcileClassFeatures()` | The sheet's existing "make derived state match the character's classes" seam — covers load and class change. |
| `_renderCompanions()` | Derived state must exist before it is drawn. The builder-completion and level-up paths do **not** both run a full reconcile, so reconcile alone left E2E characters companion-less all the way to L20. |

Both are idempotent and roster-gated (no brew loaded → no-op). The render-path
call deliberately uses the state-only `_bondBeastheartCompanionState()` rather
than the full `_bondBeastheartCompanion()`, so it cannot re-enter render.

### The ferocity strip

Lives inside the companion card. Deliberately **not** a percentage-fill bar:
ferocity is unbounded, so a fill would be a lie. Instead a loud number and an
explicit threshold marker, with rationed colour — neutral below 10, gold at the
rampage threshold, red while rampaging.

Actions: `＋ Ferocity`, `Spend`, `Rampage Check` (only at risk), `End Rampage`
(only while rampaging), `End Combat`. A second row appears for bonds with
ferocity-spending actions, each button carrying its cost as a badge and
disabling with an explanatory title when unaffordable, so "can't afford yet"
never reads as "broken".

---

## 4. Feature coverage

### Class features

| Level | Feature | Effect |
|---|---|---|
| 1 | Companion | Bespoke picker; scaled stat block on the sheet |
| 1 | Natural Language | `info` — narrative |
| 2 | Primal Exploits | Derived pick pool (3/5/7 cumulative) |
| 2 | Superior Ferocity | Exploit save DC = `8 + PB + WIS` |
| 3 | Companion Bond | Subclass |
| 3 | Master Caregiver | Animal Handling proficiency; PB doubled **only if already proficient** |
| 5 | Beyond Instinct | Ferocity gain bonus **+1 / +3 / +5** at 5/10/15 (*increases to*, not cumulative), plus one companion save and one companion skill proficiency at each tier |
| 5 | Improved Signature Attack | **+1 / +2 / +3** damage dice at 5/11/17, written into the printed attack line |
| 6 | Faithful Companion | `info` |
| 6 | Rejuvenating Ferocity | Long-rest pool, WIS uses |
| 8 | Primal Strike | `1d8` at 8th, `2d8` at 14th; type chosen from acid/cold/fire/lightning/poison/thunder, re-choosable each class level. Registered as a real damage rider |
| 9 | Mystic Connection | Determined by companion, not chosen |
| 13 | Loyal to the End | Charmed + frightened **condition immunity** for caregiver *and* companion, via the shared modifier registry |
| 14 | Keen Senses | `check:advantage:perception`, sub-typed conditional ("relying on hearing, sight, or smell") |
| 18 | Summon the Wilds | Short-rest pool, 1 use; battlefield effect is `info` |
| 20 | Unbreakable Friendship | Rampage checks auto-succeed while the caregiver has ≥1 HP; `1d10` ferocity on initiative |

### Companion Bonds

| Bond | L3 | L7 | L11 | L15 |
|---|---|---|---|---|
| **Ferocious** | Frenzied Charge (`info`), Fury of the Wise — Intimidation proficiency **+ WIS-modifier bonus** to Intimidation checks | Energizing Rampage — rampage ends at a **floor of 4** ferocity rather than 0 | Furious Rampage — rampage bonus damage becomes **full** ferocity (divisor 1, not 2) | Invigorated Rampage — blinded / deafened / frightened |
| **Hunter** | Chosen Quarry — **spends 4 ferocity**, marks a creature, `+1d6`; Hunter's Instincts — Survival proficiency **and expertise** | Primal Warding — WIS uses, long rest, `4d8` force at the exploit DC | Synchronized Stealth — `check:advantage:stealth` conditional | Unseen Hunters — 1 use, long rest |
| **Infernal** | Devil's Understanding — Arcana **or** Religion (player's choice); Infernal Exploits (+1 pick) | Hell's Charmer — WIS uses, long rest, WIS save at the exploit DC | Fiendish Traits — Barbed Hide (`1d10` reflect) / Fiendish Immunities (fire + poison damage, poisoned condition) / Fiery Weapons (`1d6` fire on the signature attack) / Wings (fly 40). Swappable on a long rest; +1 exploit pick | Fiendish Form — **spends 6 ferocity**; companion becomes a fiend with resistance to B/P/S and advantage on saves vs magic |
| **Primordial** | Primal Understanding — Nature proficiency; Nature Exploits (+1 pick) | Allied Earth — 10-ft difficult-terrain aura, live at ≥1 ferocity | Spirit Stampede — force damage **equal to live ferocity**; +1 exploit pick | Allied Weather — prone (STR save) or lightning **equal to live ferocity** (DEX save), at the exploit DC |
| **Protector** | Beast Vitality — **the Beastheart's own** max-HP bonus equal to its class level (the text is "*your* hit point maximum", not the companion's); Pack Phalanx (`info`) | Thickened Hide — companion **AC +2** | Sentinel Companion — **spends 2 ferocity** for a reaction signature attack | Undying Protector — drop to 1 HP instead of 0; cost starts at **2** and rises **+2 per use**, resetting on either rest |

---

## 5. Honest gaps

These are surfaced as `info` because their effect is positional or belongs to
another creature's dice, which the sheet does not own:

- **Frenzied Charge** — a reaction move-and-attack; the sheet does not model
  movement or reaction ordering.
- **Pack Phalanx** — imposes disadvantage on *enemy* attack rolls.
- **Allied Earth** — the aura's live/not-live state is real
  (`getAlliedEarthAura`), the difficult terrain itself is narrated.
- **Primal Warding** — trap placement is positional; the uses, damage, DC and
  save ability are all real.
- **Summon the Wilds** — the use is a real short-rest pool; the summoned swarm
  is narrated.
- **Natural Language**, **Faithful Companion** — narrative.

Each keeps its countable part real even where the positional part is narrated.

---

## 6. Landmines

- **`setAbilityBase` is a raw setter.** It does not recalculate max HP. Set
  abilities *before* `addClass`, or HP is computed from a stale CON modifier.
- **A fresh state has `getCurrentHp() === 0`** even with a positive max. Any
  test touching an HP-gated feature must set current HP first.
- **Registry effects match by feature NAME and require the feature to be
  present.** A state built with only `addClass` has zero features, so
  `getConditionImmunities()` returns `[]`. Add features, then call
  `applyClassFeatureEffects()`.
- **Companion field shapes differ.** `saveProficiencies` is an **array**;
  `skillProficiencies` is a **map** of skill → level. Getting this wrong throws
  `is not iterable`.
- **Cross-path double counting.** Beast Vitality's text ("hit point maximum
  increases by 3") is *also* matched by the generic description parser, which
  credits a flat `+3` named modifier. `_getBeastheartBeastVitalityHp()`
  subtracts what that path already contributed — the same dedupe precedent as
  carry capacity / Powerful Build.
- **`_ensure*Resources` must never call `getFeatureCalculations()`** — it
  recurses back through `getResources()`. Derive from class level and ability
  directly.
- **Transient companion flags must be cleared explicitly.** The recalc rebuilds
  arrays and objects from the pristine stat block, but a scalar written onto the
  record survives it, so Fiendish Form's `hasAdvantageOnMagicSaves` is deleted in
  an explicit `else`.
- **`Renderer.dice.parseRandomise2` must be mocked in
  `beastheartTestHarness.js`, never in shared `setup.js`.** Two other suites do
  `Renderer.dice = Renderer.dice || {...}`, so a shared mock wins the `||` and
  shadows theirs.

---

## 7. Tests

| Suite | Covers |
|---|---|
| `CharacterSheetBeastheartCompanion.test.js` | Stat-block scaling — HP, AC, saves, skills and the signature attack at levels 1→20 |
| `CharacterSheetBeastheartFerocity.test.js` | The full ferocity rule set — gain, spend, thresholds, rampage, end-of-combat heal, unconscious-but-legal |
| `CharacterSheetBeastheartFeatures.test.js` | Every class feature at every threshold, all five bonds, bond isolation, and the ferocity-spending bond actions |

All assertions are behavioural. `expect(calc.hasX).toBe(true)` appears only
where a feature genuinely has no number and is surfaced as honest `info`.

```
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetBeastheart --no-coverage --forceExit
```

Two of these suites also guard machinery this class merely *exposed* rather than
owns: `CharacterSheetSetupShimParity.test.js` pins the `setup.js` Parser shims
against `js/parser.js`, and the reentrancy tests in the companion suite pin the
guard described in `10-known-limitations.md`.

---

## 8. The pattern this class kept finding

Implementing homebrew works as a **load test on the engine**. Four generic,
pre-existing bugs affecting *official* content surfaced across this round of
work — an inert Actor feat, a Champion's missing 10th-level Fighting Style,
permanently-granted speeds returning zero, and every companion's defences — none
of them found by the test suite. The instances this branch owns are tabulated
below; they share one shape:

> **A reader whose alphabet is narrower than its writer's, silent when they
> diverge.**

The writer is correct. The reader either does not exist, reads a different field
name, or accepts a narrower set of inputs than the writer can emit. Nothing
throws. Nothing warns. The result is indistinguishable from a feature that was
never implemented — which is exactly why no test caught any of them: **the
consumer that would have depended on the value had not been built yet.**

| Instance | Writer | Reader | Symptom |
|---|---|---|---|
| CS-BUG-141 | companion parse writes `resistances` / `immunities` / `conditionImmunities` | no companion renderer ever read them | every companion the sheet has ever drawn, Beast Master included, silently dropped its defences |
| CS-BUG-140 | Champion declares `FS:F {10: 1}` | `getOptionalFeatureGains` `continue`d past any shared `featureType` | the 10th-level Fighting Style was never offered |
| defence readers | an active state effect spelled `{type: "immunity", condition: …}` | `_getDamageDefenceFromStates` (`:46498`) accepts only `e.target`, while `_getConditionImmunitiesFromStates` (`:46533`) — 35 lines later, same reader family, same path — accepts `e.target \|\| e.condition` | one tolerant reader, one strict; the second spelling reaches condition immunities but is silently dropped for damage defences |
| `textToNumber` shim | scaler captures an unbounded `(?<perLevel>\d+\|[a-z]+)` | shim knew only `one`…`twelve` | `NaN` into a companion HP string, in tests only |

**A spelling difference is not automatically a defect.** Two rows were removed
from this table after tracing them to completion: the effect registry writes
damage defences as `{damageType}` and senses as both `{sense, range}` and
`{senseType, value}`, and *every one of those spellings has a working reader.*
`_applyFeatureEffect` reads `effect.damageType` directly
(`:28393`/`:28410` → `_addClassFeatureResistance` → `_data.resistances` →
`getResistances()`), so a Monk's Purity of Body poison immunity works. The two
sense spellings are two paths, not one: `{sense, range}` is the class-feature
registry read by `_applyFeatureEffect` (`:28581`), `{senseType, value}` is the
*feat* registry (Skulker, `:3525`) read by `_processFeatRegistryEffects`
(`:41937`) — and the separation is deliberate, enforced by an explicit
`FEAT_NAMEDMOD_TYPES` guard at `:28383` whose comment states it exists to
prevent double-application.

The distinction that matters:

- **Cross-path difference** — two paths, each with its own writer *and* its own
  matching reader. Working as designed. Not a bug.
- **Missing or narrow reader** — one path, where the reader does not exist
  (CS-BUG-141), skips a live case (CS-BUG-140), or accepts less than its own
  path's writer can emit (the adjacency row above). This is the bug.

Both removed rows were asserted by two people independently, and both were
wrong. Each of us had checked the writer and *one* reader; neither trace reached
the applier. Stopping one call short of the consumer produces a confident,
specific, false bug report — the mirror image of the failure this section exists
to prevent.

**It is not confined to product code.** The same shape appeared twice in the
tooling used to *check* for it: a `CS-BUG-113` grep cannot see the second number
in a compound reference like `CS-BUG-113/119`, and a `^#+ CS-BUG-[0-9]+` sweep
truncates the suffix on `017a` / `017b` and reports a false duplicate. Both are
readers with an alphabet narrower than the writer's.

### Practical consequences

- **Grepping a field name proves nothing about whether it is read.** Check the
  writer and the reader independently; a match on one is not evidence about the
  other. **And trace to the applier, not to the first plausible reader** — both
  rows removed above survived a writer check *and* a reader check, and were only
  disproven at the third hop, where the value is actually consumed.
- **Prefer a failure that is loud.** Where a `continue` or a silent default is
  unavoidable, leave a named warning behind it. The reentrancy guard in
  `_applyBeastheartCompanionBonuses` exists for exactly this reason.
- **Test the guard, not just the fix.** Every guard added here was verified by
  re-introducing the original defect and confirming the test fails.

### A category no test can defend

Distinct from the above, and worth naming separately: **documentation drift.**
This document originally described Beast Vitality as a *companion* HP bonus; the
source reads "**your** hit point maximum". The code was correct, and the E2E
assertion (`beastVitalityHpBonus`) was correct *whichever creature it belonged
to* — so no possible test could have caught the prose being wrong. Tests defend
behaviour; nothing defends prose except reading it against the source.
