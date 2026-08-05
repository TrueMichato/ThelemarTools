# Ioun Stones — Sheet Support and Effect-Implementation Audit

Covers the `MECIounStones` homebrew (*Quann'Ra-Tioll Moorchlyne's Most Excellent
Compilation of All the Realms Known Ioun Stones*): 600 numbered stones plus 82
Super-Charged variants and 3 loose items — **685 items** in
`homebrew/Moorchlyne Ioun Stones.json`.

Three sheet features exist because of this source, and all three are **generic** — they
use item rules/detection and character settings rather than source-specific allowlists:

| Feature | Where | What it does |
|---|---|---|
| Attunement exemption | `charactersheet-state.js` `isAttunementExempt()` | Ioun bonds don't consume one of the 3 attunement slots |
| Ioun Stone manager | `charactersheet-ioun.js` | Orbit/stow control surface over `equipped` + `attuned` |
| Item conditional modifiers | `charactersheet-state.js` `_getItemConditionalModifiers()` | Narrowly-scoped item bonuses reach the per-roll opt-in picker |

## Official/core parity

The official Ioun Stones are item records in the DMG (2014) and XDMG (2024), not the
PHB/XPHB: 14 records in each edition, plus 7 adventure-source stones. All are recognized
source-agnostically by `CharacterSheetIoun.isIounStone()`.

The effective bond policy is additive:

- With `settings.enableTgtt` enabled, every recognized Ioun Stone uses the Moorchlyne
  7-day bond, collection acceleration, and slot-free attunement rules.
- With `settings.enableTgtt` disabled, official/no-bond-text stones use RAW ordinary
  attunement.
- Intrinsic Ioun Bond text always remains active, so disabling TGTT never removes the
  bond flow or slot exemption from a Moorchlyne stone whose own rules grant them.

`CharacterSheetState.getIounBondPolicy()` is the single policy source for both manager
eligibility and attunement-slot accounting. Keeping those consumers together prevents a
stone from entering the bond flow but failing to complete at the normal attunement cap.

## Vocabulary

The sheet stored the book's two-stage state before it named it:

- **`attuned`** = *bonded* (the 7-day ritual)
- **`equipped`** = *in orbit* (actively circling your head)

`_calculateItemBonuses` already gated on both, so the manager adds no mechanics — it is a
control surface and a vocabulary over correct existing state.

## Effect-implementation audit

Every one of the 685 items was classified by its `Stone Effect` prose and cross-referenced
against the structured props it carries and the sheet's prose passive gate. Findings were
confirmed in a live browser against the real 14,061-item catalog, not inferred from code.

| Count | Bucket | Status |
|---|---|---|
| 485 | Activated (once/day, action, charges) | **Deliberately not passive** — charge/recharge tracking is the correct level of support |
| 140 | Narrative / DM-fiat | **Deliberately unimplemented** — not mechanisable |
| 47 | Passive with structured props | **Working**, verified end-to-end |
| 7 | Passive but conditional | **Working** via the conditional-modifier path below |
| 2 | Act on *other objects* (#050, #057) | **Deliberately unimplemented** — not character-mechanisable |
| 4 | Scoped-but-unconditional passives | **Deferred** (see below) |

No incorrect implementation was found. Do not re-audit the 485/140/2 buckets from
scratch: they are unimplemented **by decision**, not by omission.

### Deferred, with reason

- **#397 Glowing Rose Smooth Egg** — "+1 to the bonus of magic armor you wear" needs a
  conditional **AC** modifier keyed to wearing magic armor. The prose parser has no AC
  path and the condition is structural rather than textual.
- **#103 Cobalt Blue Lozenge / #282 damage half** — bonuses scoped to *ranged* or *melee*
  attacks only. A structured `bonusWeapon` would apply to both, so it would over-grant;
  the prose is unconditional, so the conditional path does not carry it either. Wiring
  *unconditional* item prose into the modifier registry is a much larger, riskier change
  across the whole catalog and is out of proportion here.

## Item conditional modifiers

`+N to saving throws against X` on an item was worth nothing before this work. Three
independent defects combined, **two of them generic parser bugs affecting official
content**:

1. **`_extractCondition` recognised only creature types after "against".** So
   "against poison" — and the canonical 5e phrasing "against spells" — parsed as
   `conditional: null`, i.e. indistinguishable from an unconditional bonus. A bonus
   scoped to poison was applied to *every* saving throw. Fixed by three new qualifier
   patterns (damage types, named conditions, effect categories). The fix can only ever
   *remove* an over-grant, never add one.
2. **The numeric save patterns had no third-party guard.**
   `isThirdPartySaveSubject` had exactly one production caller. Prose that buffs somebody
   else — "each of **your** other orbiting Ioun Stones has … a +2 bonus to saving throws"
   — granted the bonus to the wearer, because the guard's `you|your` bail-out is right for
   self-buffs but inverts the verdict when `your` is a possessive naming the beneficiary.
   Fixed with `THIRD_PARTY_POSSESSIVE_SUBJECT_RE` plus a `thirdPartyGuard` option now set
   on all five save patterns.
3. **Nothing fed item prose into the modifier registry.** The only two
   item→`parseModifiers` callers keep `isProficiency` / `isSpellSlot` respectively and
   discard everything else.

### Design of `_getItemConditionalModifiers()`

**Computed, never persisted.** `_data.namedModifiers` is restored verbatim by
`loadFromJson`, and the file already carries several `_migrate*` passes that exist purely
to clean up modifiers stranded there. Writing item-derived modifiers into it would strand
them when an item is dropped. Computing keeps them exactly as live as the equip/attune
state. Memoised against an `id:equipped:attuned` inventory signature, because
`getModifiersForType` runs on every roll and render.

**Conditional-only, by construction.** Unconditional item save bonuses already flow via
`bonusSavingThrow` and `_getItemProseSaveBonus`. Returning *only* modifiers with a truthy
`conditional` makes the two paths disjoint by definition — double-counting is impossible
by construction rather than by guard.

Three filters keep the surface honest:

| Filter | Why |
|---|---|
| `_getPassiveClauses` | Per-sentence passive gate. Without it, 485 activated stones leak their once-per-day bonuses as always-available conditionals |
| `_RE_ITEM_BASELINE_CONDITION` | "while wearing" / "while it orbits your head" is an item's baseline state, not a condition. Without it, Bracers of Archery and every dragon scale mail become per-roll opt-in prompts |
| `_hasStructuredEquivalent` | "Structured wins", matching the six equivalent guards in `charactersheet-inventory.js`. Pariah's Shield carries both `bonusAc: "+1"` and matching prose; without this, opting in stacks a second +1 |

> `_hasStructuredEquivalent` deliberately tests for a **non-zero value**, not for
> `!= null`. `_addItem` normalises every `bonus*` prop onto the row, materialising absent
> ones as literal `0`, so a null check reports "structured" for every item and silently
> makes the whole feature inert.

### Measured blast radius

Across the full 14,061-item catalog, **7 Ioun stones and 29 official/other items** surface
a conditional. Every non-Ioun hit is a genuine, previously-missing benefit — Belt of
Dwarvenkind vs poison, Mantle of Spell Resistance / Spellguard Shield / Staff of the Magi
vs spells, Scepter of the Unanointed vs charmed and frightened. Official content gained
correct behaviour as a side effect.

Conditionals are **default-off**. `aggregateModifiers` refuses to apply them without an
explicit `appliedConditionalIds` opt-in, and that argument must be a **`Set`** — a plain
array silently no-ops.

## Data conventions

- Entries are always `[Stone Effect, Super-Charged Stone?, General Ioun Stone Rules]`,
  with the shared `{#itemEntry …}` ref nested in the last block so the unique effect leads.
- Super-Charged stones are real `item` records via `_copy`, named
  `Ioun Stone #NNN, <Colour Shape> (Super-Charged)`. Their `entries` state **their own
  final values** — they must never restate the base value and then override it
  ("+1 … the bonus is +2 instead"), which reads as self-contradictory on a standalone
  item page.
- Source Type codes hoverlink to one `variantrule` per code
  (`Ioun Source Type: <Code>`), because the book's legend is prose only.
- `d3`/`d5`/`d2` are not 5e dice; durations are fixed rather than rolled.

## Tests

`test/jest/charactersheet/CharacterSheetItemConditionalModifiers.test.js` (30 tests)
covers the parser qualifiers, the third-party guard, the passive/activated split, the
three filters, memoisation, and the end-to-end gate→opt-in round trip. Its regression pins
were each verified to genuinely fail when the corresponding fix is reverted.

`test/jest/charactersheet/CharacterSheetAttunementExemption.test.js` (13 tests) covers the
attunement exemption; `CharacterSheetIoun.test.js` (35 tests) covers the manager.
