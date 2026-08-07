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

## Separating bonds from attunement

Naming the state was not enough: a bond and an attunement still *looked* identical, and the
sheet counted them in the same list. Four changes separate them, all keyed on the existing
`getIounBondPolicy(item).usesBond` predicate — nothing is hard-coded to this source.

| Surface | Ordinary attunement | Ioun bond |
|---|---|---|
| Item-row control | amber `☆ Attune` / `☆ Attuned` | cyan `◇ Bond` / `◈ Bonded` |
| Name badge | violet `◈` | cyan `◈`, titled "Ioun bond — a slot-free form of attunement" |
| Attuned-items panel | listed, counts against `n/max` | **not listed**; reached through the `◇ Ioun Stones (n of m in orbit)` button |
| Undoing it | one click | confirmation dialog (see below) |

**Why cyan.** Attunement already owns two accents — amber on the button, violet on the
badge — and the manager's bond-progress bar owns indigo. Cyan (`--cs-info`) was the only
free accent, and it echoes the source book's teal. Hue is never the sole cue: the glyph
(`◇`/`◈`) and the label (`Bond`/`Bonded`) carry the distinction in greyscale.
`.is-bonded` is a *tint* rather than a solid fill because white text on `#06b6d4` is
roughly 2.5:1, far below AA, and the manager it belongs to is built on tinted insets.

**Why the confirmation.** Breaking a bond is not the mirror of un-attuning. An attunement
costs a short rest to restore; a bond costs days of consecutive orbit. The row control is
the only place a bond can be severed — the manager can start, cancel and complete a bond
but deliberately has no break action — so that one click is guarded by `pGetUserBoolean`.

**Why the slot counter changed.** `exemptCount` used to be the remainder
`attunedItems.length - currentAttuned`. With bonded stones no longer in `attunedItems`
that remainder is always zero, so it is now computed directly from the displayed rows via
`isAttunementExempt`. The visible effect is that a character carrying only stones reads
`Attunement Slots: 0/3` with no phantom "+1 slot-free" — the stones are accounted for
behind the Ioun Stones button instead.

## Setting stones into items

Some items hold Ioun Stones in place of their own gems. The Griffon's Saddlebag's
**Ioun Blade** is the seed case: *"you can choose to have that stone magically replace one
of the gemstones in the sword, instead of having it orbit your head. For each replaced
stone, the sword's bonuses increase by 1."*

### A setting is a fourth *place*, not a third *state*

The manager's zones already encode location, and the row toggle is a binary that cannot
take a third value without breaking the ON/OFF/USED contract every other control in the
sheet obeys. So the vocabulary extends by a place, not by a state:

| Word | Means | Where it lives |
|---|---|---|
| **ORBITING** | circling your head, conferring its benefit | *In orbit* |
| **SET** | seated in an item's setting, conferring its benefit **and** raising the item's bonus | *Set in items* |
| **STOWED** | in your pack, conferring nothing | *Stowed* |
| **SPENT** | consumed; its bond has ended | any zone, dimmed |

*Set in items* sits **directly beneath** *In orbit* — the two zones that hold **functioning**
stones belong together, with the two that do not below them. The zone is **absent, not
empty**, for the overwhelming majority of characters who own no host item.

Setting a stone is **pure gain**: it keeps conferring its own effect, keeps its charges, keeps
counting for the bond-time discount and the duplicate-descriptor warning. Only its *place*
changes. This is stated at the moment of the decision (in the picker) rather than in a help
page, because it is the single most misread thing about the mechanic.

The book names no action for replacing a gemstone, so **the control claims none**. There is
no "Set all", for the same reason there is no "Orbit all": seating is per-stone and
per-setting.

### The layered host resolver

`CharacterSheetState.getIounHostPolicy(itemData)` returns
`{isHost, settings, grants, perStone, waivesAttunement, settingLabel, origin}`, first match wins:

| Layer | Source | Why it exists |
|---|---|---|
| 1. `user` | `item.iounSettings` (number), set in the ⚙ item editor | A DM can make **any** item hold stones |
| | *`null`/blank* = not declared, falls through · *`0`* = an explicit "**not** a host", overriding the layers below | |
| 2. `brew` | `item.iounHost: {settings, grants, waivesAttunement}` | Editable homebrew declares it in data |
| 3. `registry` | `IOUN_HOST_REGISTRY`, keyed `_variantName\|source`, then `name\|source`, then bare `_variantName` | The **only** way to support a book that cannot be edited locally |
| 4. `prose` | the attunement-waiver wording alone | Prose cannot yield a settings *count*, so it never claims one |

The Ioun Blade is a **generic variant**, so it never appears under that name — `requires:
[{sword: true}]` generates *Ioun Longsword*, *Ioun Greatsword*, and nine more. Its stable
identity is therefore `_variantName|source`, which is why `_variantName` is now carried on
inventory rows.

**Why the lookup also falls back to a bare `_variantName`.** A source-qualified key alone is
not durable, for two measured reasons:

- A *generated* variant inherits the **base item's** source. The catalog's *Ioun Longsword*
  reports `source: "XPHB"` — the longsword's book — not `GriffonsSaddlebag3`.
- The ⚙ item editor stamps every edited row `source: "Custom"`.

Either one silently severs a `name|source` key. That was not theoretical: opening the editor
on a stone-bearing Ioun Longsword and pressing **Save Changes** — changing nothing — used to
drop the item's host status, evict the seated stone, and revert its bonus from +2 to +1. The
row was also given a `_baseSource` provenance field, but that records the *base item's*
source too, so it does not help here and the bare-name fallback is what actually holds.

Matching a bare `_variantName` is safe because a generic variant's name is its own identity:
"Ioun Blade" is never a base item's name, so the key cannot collide with an ordinary sword.
Plain `name` is **never** matched source-agnostically, since names like "Longsword" are not
distinctive. `CharacterSheetIounHost.test.js` pins all three cases, including the negative
("does not make every sword a host").

The registry entry also ships `dataCorrections`, because TGS3's data both over-grants and
under-grants relative to its own text: it applies `bonusSavingThrow: "+1"` to all six saves,
and omits the ability-check half entirely. The correction zeroes the blanket bonus and
writes the six values the text names (Int/Wis/Cha checks **and** saves). Corrections are
applied **before** the base capture, or a wrong shipped value would be pinned as the
pristine base forever.

### Why the bonus is materialised, not derived

`bonusWeapon` is read raw at about a dozen combat call sites, and `requiresAttunement &&
!attuned` is a gate at roughly two dozen more. Threading a host-aware accessor through all
of them would be a standing invitation to miss one. So both the +1-per-stone **and** the
attunement waiver are **written onto the row**, with the pristine values preserved in
`item.iounBaseBonuses` / `item.iounBaseRequiresAttunement`. Every existing consumer —
combat, the inventory aggregator, NPC export — is correct with zero call-site changes. This
is the same shape as the existing `vestigeTier` materialisation.

Three invariants keep that safe:

- **Per-key lazy capture.** A grant added by a later registry revision records *its own*
  pristine base rather than inheriting a zero from an older capture.
- **Always recompute from the base**, never from the current value, so five set/unset cycles
  land exactly where one did.
- **Reversible.** Withdrawing host status (clearing the ⚙ field, or a registry entry going
  away) restores the base and drops the seats; shrinking the setting count evicts from the
  **end**, so stones seated first keep their places.

The ⚙ editor is the sharp edge here: it shows and receives **base** values, and
`dematerialiseIounHostBonuses()` runs before the merge so both halves speak the same units.
Without that, a player who simply opened the editor on a two-stone sword and pressed Save
would bake the stones' contribution into the sword permanently.

### Seats are references, not copies

`item.iounSet` holds inventory **ids**. This is deliberately unlike `socketedGemstones`,
which absorbs the gem and destroys it as an independent row. A stone must stay a first-class
inventory row because it is bonded, charge-tracking and reversible. Set stones keep
`equipped === true`, so `_calculateItemBonuses`, `getBondDaysRequired` and
`getDuplicateDescriptors` all keep working unchanged.

A seat is vacated automatically when the stone is removed, stowed, or un-bonded.
`reconcileIounHosts()` is re-entrancy-guarded, idempotent and cheap; it runs after every
inventory or attunement mutation.

### The bond-borne attunement waiver

*"If you're also attuned to an Ioun stone, you don't need to attune to this weapon to use
its properties."* A host whose policy waives attunement, on a character with at least one
bonded stone, has `requiresAttunement` flipped to `false` and is released from attunement —
holding the slot would be a silent tax. The flag returns to `true` when the last bond ends.

### Per-ability check bonuses

Per-ability *saves* already existed end-to-end; per-ability *checks* did not — only a blanket
`itemBonuses.abilityCheck`. Phase 6 adds the missing sibling family
(`bonusAbilityCheck_<abl>` in data → `bonusAbilityCheck<Abl>` on a row →
`itemBonuses.abilityCheck<Abl>`), read through the new
`getItemAbilityCheckBonus(ability)`. This is **not** Ioun-specific: any item worded
"+N to Strength checks" is now expressible, and the ⚙ editor exposes all six.

### Entry points

| Surface | What it does |
|---|---|
| Manager zone *Set in items* | owns assignment: host rows, empty-bezel tray, pry-out |
| Item row `◇ / ◈ Settings (n/m)` | a doorway — opens the manager scrolled to and focused on that host |
| ⚙ item editor → *Ioun Stone Settings* | declares any item a host |

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

`test/jest/charactersheet/CharacterSheetIounBondUi.test.js` (12 tests) covers the
bond/attunement separation: the row control's three states, the exclusion of bonded stones
from the attuned list, the slot-free counter, and the break-bond confirmation. Four of the
twelve are regression pins on *ordinary* attunement, so a future change that collapses the
two vocabularies again fails loudly. Reverting the two `usesBond` gates turns the other
seven red on behavioural assertions.

`test/jest/charactersheet/CharacterSheetIounHost.test.js` covers the host layer: the
four-layer resolver, seating as a change of place rather than a trade, the materialisation
invariants (no compounding across repeated set/unset cycles, reconcile idempotent, pristine
base preserved, host status reversible, seat vacated on remove/stow/unbond), and the
bond-borne attunement waiver.
