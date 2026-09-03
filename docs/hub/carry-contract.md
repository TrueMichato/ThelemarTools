# Carry capacity and encumbrance

One definition of carrying capacity and encumbrance, shared by the Character Sheet, the DM
Screen Party Tracker, and the Campaign Hub server projection.

## Why this exists

Carrying capacity used to be implemented five times, and the copies disagreed on screen:

| Location | Formula / thresholds | What it missed |
|---|---|---|
| `charactersheet-state.js` `getCarryingCapacityBreakdown()` | Might×10 or STR×15; size; flat; multiplier; external | — (was the good one) |
| `charactersheet-state.js` `getEncumbranceLevel()` | `>50%` / `>75%` of capacity | not a rule from any source |
| `charactersheet-inventory.js` `_updateEncumbrance()` | `STR×5` / `STR×10` | ignored Thelemar and size |
| `dmscreen-partytracker-character.js` `getCarryCapacity()` | `STR×15` or `Might×10`, ×2 for Powerful Build | size, flat bonus, containers, status |
| `server/src/character-projection.js` | `STR×15×(powerfulBuild?2:1)` | Thelemar, size, flat, containers |

Two of these were visible bugs:

- **The sheet contradicted itself.** At STR 16 carrying 100 lb, the inventory bar rendered
  *Encumbered* (`STR×5` = 80) while play mode and the PDF — which call
  `getEncumbranceLevel()` — were told *normal* (50% of 240 = 120).
- **The DM saw different numbers than the player.** The DM Screen renders the server's
  `carrySummary`, so a Thelemar Goliath with a Bag of Holding had one capacity on their sheet
  and another in the Party Tracker. ADR 0011 explicitly forbids this: derived statistics
  "must read these values from the authoritative sheet calculation rather than reimplementing
  it."

## Modules

| File | Role |
|---|---|
| `js/hub/hub-carry-contract.js` | Pure calculation. Owns the arithmetic and the vocabulary. |
| `js/hub/hub-carry-authority.js` | Validates a materialised summary and decides whether it may be trusted. |
| `server/src/carry-basis.js` | Resolves the basis that is live for a character right now. |

Each surface owns only an **adapter** — the mapping from its own data onto
`normalizeCarryInput()`. That split is what stops the formulas re-diverging: there is nowhere
else for a formula to live.

## Rules, and where they come from

**Capacity.** Standard is STR score × 15; Thelemar is passive Might × 10. Both are scaled by
the same size ladder (Tiny ×0.5, Small/Medium ×1, Large ×2, Huge ×4, Gargantuan ×8), which
matches the TGTT *Carrying Capacity (Passive Might)* table exactly (Tiny ×5 … Gargantuan ×80
against a per-point value of 10). Push/drag/lift is 2 × body capacity.

Extradimensional containers (Bag of Holding, Heward's Handy Haversack) add a fixed external
capacity **after** the body multipliers — a bag holds 500 lb for a Halfling and a Goliath
alike — and never contribute to push/drag/lift, which is a physical Strength limit.

**Encumbrance thresholds are modelled separately from capacity**, keyed by a named policy in
`ENCUMBRANCE_THRESHOLD_RULES`:

| Policy | Tiers | Source |
|---|---|---|
| `phb-variant` | `STR score × 5` / `× 10` | PHB variant Encumbrance rule, verbatim |
| `thelemar-proportional` | ⅓ / ⅔ of capacity | **House extension** — see below |
| `capacity-only` | none; only over-maximum | TGTT as written |
| `none` | none | — |

The PHB rule reads: *"If you carry weight in excess of 5 times your Strength score, you are
encumbered… in excess of 10 times your Strength score, up to your maximum carrying capacity,
you are instead heavily encumbered."* The tiers key off the **Strength score**, and "Size and
Strength" scales only *carrying capacity and push/drag/lift* — so **size, Powerful Build and
flat bonuses must not move the tiers.** Expressing them as a fraction of capacity would look
equivalent only for an unmodified Small/Medium character and would silently change the rule
for every Large or Powerful Build one. A golden vector asserts this directly.

TGTT publishes a carrying-capacity maximum and a drag/lift/push limit but **no intermediate
tiers**; its only stated consequence is that exceeding your maximum caps Speed at 5 feet.
`thelemar-proportional` is therefore a documented **house extension** that mirrors the RAW
proportions so Thelemar characters still get a warning. `thelemar_encumbranceTiers` (default
on) turns it off in favour of the rules-faithful `capacity-only`.

**Coins** weigh 50 to the pound and are always computed and displayed, but are **not counted**
toward the load unless `isCoinWeightCounted` is set. Counting them by default would silently
add weight to every existing character — a 1,000 gp purse is 20 lb.

## The authority boundary

Capacity **cannot** be rederived from a character document by anyone but the sheet: it depends
on passive Might including passive bonuses, on `projectItemMaterial()` weights gated behind
three material sub-settings, on carry-only active-state size steps, on item-effect
multipliers, on equipped extradimensional capacity, and on the fill/body split — all behind
`CharacterSheetState` methods.

So `toJson()` materialises a closed, versioned `carry` block and `loadFromJson()` strips it,
following the `hp.effectiveMax` precedent. The server projects that block and nothing else.

### Freshness is fail-closed

The summary is authoritative precisely because only the sheet can compute it — which means the
server can never repair a stale one. A stale capacity is worse than an absent one, because a
DM cannot tell it is wrong. There are three independent staleness vectors, each needing its
own mechanism:

1. **Server-side document mutations.** Item grants and transfer escrow change `inventory` with
   no sheet present. `stripCarryAuthority()` is called at the real mutation commit points —
   `pGrantItem` and the transfer *writer* (`_setTransferContainer` / `pWrite`), which covers
   escrow reservation, acceptance, and reject/cancel/expiry restore.

   It is deliberately **not** called from `normalizeCharacterInventory()`: that also runs on
   create/import, where it would delete a perfectly fresh block on first cloud save, and from
   the container *reader*, which touches both transfer participants — so a mere proposal would
   erase the untouched target's authority.

2. **Old or third-party clients.** The current sheet writes a `/carry` op on **every** owner
   save whose document otherwise changes, even when the summary is byte-identical (`diffJson`
   would otherwise emit nothing and the server could not tell a current client from an old
   one). The server strips any pre-existing authority when a document-changing patch carries
   no valid fresh `/carry`. This needs no allowlist of "carry-relevant paths" — such a list
   could never be complete, since passive Might alone depends on skills, expertise, class
   levels, proficiency bonus, named modifiers, feature choices and item-derived modifiers.

3. **Rules and brew rotation**, which change carry inputs without touching the document at
   all. `carry.basis` records the observed `rulesVersionId`, `brewBundleHash` and a digest of
   the carry-relevant settings; the server compares **scalars only** and never recomputes
   carry arithmetic.

A campaign with no active rules version records `null` — a real observed state, not a
placeholder. If a DM later activates one, the recorded `null` stops matching and every summary
authored before it correctly falls out of trust.

The net property: **`carrySummary` is fresh or absent, never stale.** It returns on the
owner's next save.

## What the projection means

`carrySummary` is `{carried, capacity, state, isIndeterminate?}` and carries the **body pair** —
`carried = bodyLoad`, `capacity = bodyCapacity` — so all three describe one thing: physical
load against physical capacity, which is what encumbrance is judged on. Pairing gross weight
with body capacity (or either with the bag-inclusive total) would be incoherent the moment a
Bag of Holding is equipped, and omitting the bag also avoids disclosing that the bearer owns
one.

`state` is the **authoritative encumbrance level**. A consumer cannot re-derive it from the two
numbers: PHB keys its tiers off the Strength score, Thelemar off capacity, and a table may have
disabled tiers entirely — so a local guess reported genuinely encumbered characters as Normal.

`isIndeterminate` is a **separate field, not a status value**, because the two facts are
independent. When the known part of a load already exceeds capacity the status is a safe
`over_capacity` *and* the true load is still a lower bound; folding indeterminacy into `state`
loses one of those and renders that case as exact. `state: "unknown"` is only the
below-capacity presentation of the same fact, so consumers must read `isIndeterminate` rather
than infer it from the status.

Carry is **not** in the default `table` sharing preset: an owner opts in before any peer sees
it.

## The transfer preview speaks for one endpoint at a time

Three systems own the three endpoints of a transfer, and each needs its own arithmetic:

| Endpoint | Weight used | Why |
|---|---|---|
| the acting character | material-**projected**, applied to gross *and* fillable weight | it is this sheet's own calculation, and an equipped container absorbs part of the change |
| the party stash | **raw** stored weight | the stash is a plain document whose authoritative summary sums raw weight; using the projected figure made the preview contradict the very next refresh |
| a recipient | **none** — current carry only | nothing here is target-authoritative |

A recipient's **after-value is never computed**. The moved weight is this character's material
projection, the recipient may have a container that absorbs the arrival entirely, and their
tier rule is unknowable from two numbers — so adding the delta produced confident fabrications
(a target whose body load genuinely stays at 10 was warned "10 → 30, over capacity"). Their
shared current carry is shown with an explicit "impact not shown"; a withheld carry is labelled
as such and never defaulted to a number.

## Three display states, never conflated

| State | Meaning | Rendered as |
|---|---|---|
| `known` | trustworthy load and capacity | numbers + level |
| `indeterminate` | trustworthy, but some item weights are missing | `≥ N lb`; a tier is asserted only when the lower bound settles it |
| `unavailable` | absent, invalid, or basis-mismatched authority | "not synced" — **never** `0` and **never** "Normal" |

`indeterminate` is about the **number**, not the verdict, and the two are decided separately:

- the weight is always marked `≥`, wherever it appears — the actor's before and after values
  (each from its own profile), a shared recipient's current load, the party **body** total, and
  the shared **stash** total, before and after a transfer;
- the tier is asserted only when the lower bound settles it. Below capacity nothing can be
  claimed, because the true load could sit in any band above the known one, so the status is
  `unknown`. Once the *known* part already exceeds capacity the verdict is settled — more
  weight cannot bring it back under — so `over_capacity` is stated, and it stays marked `≥`
  because the amount by which it overflows is still unknown.

Softening that verdict to "unknown" would trade one inaccuracy for another: an overloaded
character would read as merely unmeasured.

**Every displayed quantity owns its own partiality.** The party body total and the shared stash
total are independent sums, and a single combined flag got both wrong at once: an exact body
total was marked `≥` merely because the stash held an unweighed stack, while that stash — the
total actually in doubt — printed bare. `getPartyCarryAggregate()` therefore reports
`isBodyTotalPartial` and `isStashTotalPartial` separately (`isTotalPartial` remains for callers
asking only "is anything on this line uncertain?").

Stash uncertainty can also **decrease**: an unweighed stack contributes nothing to the known
total, so moving one leaves that number untouched while shifting the doubt — and when the last
unweighed stack leaves, the stash becomes exact again. That is why the count is tracked rather
than a boolean.

Party aggregates count excluded members without estimating them, and nothing is back-derived
from a total: an excluded member contributes nothing, so no hidden load can be recovered by
subtraction.

## Enforcement

Advisory only, by two independent constraints. ADR 0015 lists `tgtt.carry-weight` as `planned`
with no rules evaluator, and a rule may only be labelled *Enforced* once all its required
surfaces are `implemented`. Independently, ADR 0011 forbids hidden item truth being inferred
from "transfer previews… encumbrance warnings, capacity formulas, or resource-specific
failures" — so a blocking carry check would itself be a disclosure channel. The server never
rejects a transfer on carry grounds, and the transfer composer never disables Confirm for
weight.

## Tests

| Suite | Covers |
|---|---|
| `HubCarryContract` | Both rules, size ladder against the TGTT table, thresholds provably unmoved by size/PB/flat/override, all four policies, boundaries, coins, unknown stacks, malformed input, deltas, aggregates |
| `HubCarryAuthority` | Round-trip, stale stripping, basis variants and mismatch, malformed rejection, the `/carry` write signal |
| `HubCarryFreshness` | Grant, reserve, accept, reject, expiry restore, old-client patches, rules rotation — plus the negatives: create/import and untouched participants **keep** their authority |
| `HubCarryContractParity` | Sheet / Party Tracker / projection agree; the sheet no longer contradicts itself; privacy |
| `DmScreenHubController` | Stash fetch before/after attach, re-attach, teardown, fencing, transient vs authoritative failure |
