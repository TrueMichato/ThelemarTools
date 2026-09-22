# EFA Alchemist Character Sheet Support

> **Implementation status:** this document is the source-of-truth contract for
> planned `Alchemist|EFA` Character Sheet support. The work is milestone-driven.
> Do not read the workflows below as currently shipped behavior until the
> corresponding code and acceptance tests land.

This guide explains what full support must mean for the 2024 EFA Alchemist,
including how the sheet distinguishes it from the legacy TCE Alchemist, what
state must be saved, and what the player-facing controls must do.

> **Innate-grant milestone status:** canonical source-owned grant/resource
> metadata and executable cast transactions now ship for
> `Lesser Restoration|XPHB` and `Tasha's Bubbling Cauldron|XPHB`. Both require
> equipped, proficient `Alchemist's Supplies|XPHB`, resolve through the normal
> spell-result pipeline, spend their linked use only after successful resolution,
> and publish the shared exact committed-cast receipt.
>
> **Alchemical Savant milestone status:** the level-5 Savant modifier now ships
> for exact committed `Artificer|EFA` casts by
> `Alchemist|Artificer|EFA|EFA` using held
> `Alchemist's Supplies|XPHB`. Experimental Elixir and Alchemical Eruption
> remain separate work.

> **Experimental Elixir transaction milestone status:** exact-owner Long Rest
> drafts now commit produce/decline/no-supplies replacements through the normal
> rest recovery and full-state undo boundary. Slot-funded creation validates the
> exact held XPHB supplies, chosen effect, selected slot, and combat-tracked Magic
> action before atomically spending costs and creating one provenance-backed vial.
> Rest/create modals and all Operate-mode controls remain separate work; Self
> consumption, Other-target preview/handoff transactions, and all measurable
> effect applications now ship through the lifecycle milestone below.

> **Chemical Resistance milestone status:** the exact
> `Chemical Mastery|Artificer|EFA|Alchemist|EFA|15|EFA` owner now contributes
> Acid resistance, Poison resistance, and Poisoned condition immunity through
> the canonical defense queries. The grant is source/owner/level gated,
> round-trips idempotently, follows class/subclass/feature teardown, and
> coexists with independent grants. Alchemical Eruption is not part of this
> milestone; Conjured Cauldron cast execution ships through the innate-grant
> milestone above.
>
> **Experimental Elixir consumption milestone status:** exact-owner generated
> vials can now be consumed on Self or administered to a named external target
> within 5 feet through one atomic state transaction.
> Healing uses the creation-snapshotted dice plus the current Intelligence
> modifier; Swiftness, Resilience, Boldness, and Flight use persisted
> source-owned active states for Self and exact readable/copyable handoffs for
> Other. The Other preview is read-only; commit requires a nonblank target,
> explicit within-5-feet confirmation, and explicit confirmation. A committed
> in-combat use spends the shared Bonus Action and exact vial together; invalid,
> cancelled, stale, wrong-source, or failed commits spend nothing. Player-facing
> controls, slot-funded creation UI, and Long Rest production UI remain later
> milestones.

> **Alchemical Eruption milestone status:** exact level-15 EFA Alchemist owners
> now receive the optional post-commit `2d8` Force follow-up when a normalized
> cast receipt contains positive final Acid, Fire, or Poison damage. The player
> must confirm one tracked damaged creature (or explicitly resolve a named
> target manually outside combat). Tracked-combat use commits the canonical
> persisted turn receipt and resets only through the existing turn lifecycle;
> outside combat remains explicitly manual and writes no receipt. This milestone does not add
> Alchemical Savant, innate grant execution, or any other Chemical Mastery
> behavior.

## 1. Identity comes before feature names

The word "Alchemist" is not enough to identify the rules. The data contains
three relevant combinations:

| Meaning | Selector identity | Parent-qualified identity |
|---|---|---|
| EFA parent class | `Artificer|EFA` | `Artificer|EFA` |
| EFA Alchemist | `Alchemist|EFA` | `Alchemist|Artificer|EFA|EFA` |
| TCE compatibility Alchemist under the EFA parent | `Alchemist|TCE` | `Alchemist|Artificer|EFA|TCE` |

The EFA Artificer is a distinct 2024 class record
([`data/class/class-artificer.json:506-529`](../../data/class/class-artificer.json#L506-L529)).
The compatibility entry copies `Alchemist|TCE` onto `Artificer|EFA`
([`data/class/class-artificer.json:1086-1105`](../../data/class/class-artificer.json#L1086-L1105)).
The actual EFA subclass is a separate record with EFA spell and feature
references
([`data/class/class-artificer.json:1321-1375`](../../data/class/class-artificer.json#L1321-L1375)).

This means that checking only the class source or only the subclass name is
incorrect. Every identity-sensitive calculation, spell grant, generated item,
migration, and respec cleanup must match both the parent and subclass sources.

### Authoritative feature records

| Record | Source range |
|---|---|
| EFA Alchemist feature root | [`data/class/class-artificer.json:2815-2841`](../../data/class/class-artificer.json#L2815-L2841) |
| Alchemist Spells | [`data/class/class-artificer.json:2842-2888`](../../data/class/class-artificer.json#L2842-L2888) |
| Experimental Elixir | [`data/class/class-artificer.json:2889-2955`](../../data/class/class-artificer.json#L2889-L2955) |
| Tools of the Trade | [`data/class/class-artificer.json:2956-2982`](../../data/class/class-artificer.json#L2956-L2982) |
| Alchemical Savant | [`data/class/class-artificer.json:2983-2996`](../../data/class/class-artificer.json#L2983-L2996) |
| Restorative Reagents | [`data/class/class-artificer.json:2997-3010`](../../data/class/class-artificer.json#L2997-L3010) |
| Chemical Mastery | [`data/class/class-artificer.json:3011-3043`](../../data/class/class-artificer.json#L3011-L3043) |
| Legacy TCE comparison records | [`data/class/class-artificer.json:4291-4524`](../../data/class/class-artificer.json#L4291-L4524) |

## 2. Complete spell-grant contract

> **Milestone status:** the fixed prepared-spell tiers and exact-owner
> EFA/TCE lifecycle cleanup, source-owned innate grants/use counters, and shared
> exact-focus receipt infrastructure are implemented. Alchemical Savant consumes
> that infrastructure; focus-validated innate-grant execution remains pending.

Subclass spell grants are owned by
`Alchemist|Artificer|EFA|EFA`. Prepared grants are always prepared and do not
consume the character's ordinary Artificer prepared-spell allowance. Innate
grants are separate cast permissions with their own uses and requirements;
they are not prepared spells and must not be flattened into prepared rows.

| Artificer level | Mode | Spell | Uses and recharge | Cast requirements |
|---:|---|---|---|---|
| 3 | Prepared | `Healing Word|XPHB` | Always prepared | Ordinary Artificer spell casting |
| 3 | Prepared | `Ray of Sickness|XPHB` | Always prepared | Ordinary Artificer spell casting |
| 5 | Prepared | `Flaming Sphere|XPHB` | Always prepared | Ordinary Artificer spell casting |
| 5 | Prepared | `Melf's Acid Arrow|XPHB` | Always prepared | Ordinary Artificer spell casting |
| 9 | Prepared | `Gaseous Form|XPHB` | Always prepared | Ordinary Artificer spell casting |
| 9 | Prepared | `Mass Healing Word|XPHB` | Always prepared | Ordinary Artificer spell casting |
| 9 | Innate | `Lesser Restoration|XPHB` | `max(1, Intelligence modifier)` per Long Rest | No spell slot, not prepared, exact `Alchemist's Supplies|XPHB` focus |
| 13 | Prepared | `Death Ward|XPHB` | Always prepared | Ordinary Artificer spell casting |
| 13 | Prepared | `Vitriolic Sphere|XPHB` | Always prepared | Ordinary Artificer spell casting |
| 15 | Innate | `Tasha's Bubbling Cauldron|XPHB` | 1 per Long Rest | No spell slot, not prepared, no Material components, exact `Alchemist's Supplies|XPHB` focus |
| 17 | Prepared | `Cloudkill|XPHB` | Always prepared | Ordinary Artificer spell casting |
| 17 | Prepared | `Raise Dead|XPHB` | Always prepared | Ordinary Artificer spell casting |

The prepared and innate data is declared on the EFA subclass
([`data/class/class-artificer.json:1328-1368`](../../data/class/class-artificer.json#L1328-L1368)).
The feature prose supplies the exact innate-use and focus rules for Lesser
Restoration
([`data/class/class-artificer.json:2997-3010`](../../data/class/class-artificer.json#L2997-L3010))
and the Cauldron's component waiver
([`data/class/class-artificer.json:3011-3043`](../../data/class/class-artificer.json#L3011-L3043)).

The sheet must keep current innate uses by a stable grant ID, not by spell
name. If an Intelligence change alters Lesser Restoration's maximum, spent
uses remain spent:

```text
new current = max(0, new maximum - (old maximum - old current))
```

An independently learned or prepared copy of either spell remains independent
from the subclass grant.

## 3. Level 3: Tools of the Trade

Tools of the Trade has two separate mechanical benefits
([`data/class/class-artificer.json:2956-2982`](../../data/class/class-artificer.json#L2956-L2982)).

### 3.1 Tool proficiency choices

The sheet must capture the character's proficiency state before applying the
feature:

1. Grant `Alchemist's Supplies|XPHB`.
2. Grant `Herbalism Kit|XPHB`.
3. If the character already had one fixed proficiency, require one different
   Artisan's Tool choice.
4. If the character already had both, require two distinct Artisan's Tool
   choices.
5. If the character had neither, require no replacement choice.

The decision is one atomic, source-owned record. It stores the pre-grant facts,
the two fixed grants, zero to two canonical tool UIDs, and reversible receipts.
Builder, Level Up, Quick Build, migration repair, and respec must all use the
same exact-count behavior. The UI must never persist a display object as
`"[object Object]"`, auto-pick a missing choice, or allow duplicate replacement
tools.

### 3.2 Potion Crafting

Potion Crafting halves the time required to brew a potion. It is a measurable
`0.5` crafting-time multiplier filtered by structured
`recipeCategory === "potion"` and exact EFA Alchemist ownership. It is not a
name search and must not affect unrelated recipes.

The shared crafting calculation must first establish a recipe's ordinary
duration, including recipes that have no price/value field, and only then
apply feature multipliers. The XDMG rarity table gives 5/10/50/125/250 days
and halves both time and cost for consumables other than Spell Scrolls
([`data/book/book-xdmg.json:25427-25476`](../../data/book/book-xdmg.json#L25427-L25476)).
In the sheet's five-day workweek model, the expected progression is:

| Rarity | Generic magic item | Potion after consumable rule | EFA Potion Crafting |
|---|---:|---:|---:|
| Common | 1 workweek | 0.5 | 0.25 |
| Uncommon | 2 workweeks | 1 | 0.5 |
| Rare | 10 workweeks | 5 | 2.5 |
| Very Rare | 25 workweeks | 12.5 | 6.25 |
| Legendary | 50 workweeks | 25 | 12.5 |

The value-less baseline is shared infrastructure, not an Alchemist fallback.
The same calculation result must drive preview, commit, outcome text, undo,
tests, and future crafting-time features. Removing or respecing away from the
exact EFA subclass removes the `0.5` multiplier immediately.

## 4. Level 3: Experimental Elixir

Experimental Elixir is generated, source-owned inventory with transactional
creation and use. Its source rules cover Long Rest production, slot-funded
creation, Bonus Action consumption, and all five effects
([`data/class/class-artificer.json:2889-2955`](../../data/class/class-artificer.json#L2889-L2955)).

> **State, transaction, and consumption milestones:** the exact-owner
> generated-vial contract, pure d6 batch planner, creation-time scaling
> snapshots, atomic batch replacement, save/load reconciliation, source-loss
> cleanup, Long Rest produce/decline/no-supplies transactions, full-state rest
> undo, and atomic spell-slot/Magic-action creation are implemented. The model
> transaction for exact
> `Alchemist|Artificer|EFA|EFA` vials is implemented. It consumes the shared
> Bonus Action only for an in-combat committed use and consumes the exact
> quantity-1 generated vial. Self applies Healing or the creation-snapshotted
> timed effect atomically. Other returns a versioned external handoff containing
> the exact target/range confirmation, provenance snapshot, formula or numeric
> mechanics, and duration/rest-expiry policy without changing local HP or active
> states. Outside combat it does not latch action economy. Save/load, source-loss
> cleanup, same-effect refresh, round expiry, and Short/Long Rest expiry use the
> shared inventory, action-economy, healing, and active-state systems rather than
> parallel ledgers. Rest/create/consume UI remains a later milestone.

### 4.1 Long Rest batch

| Artificer level | Elixirs when production is chosen |
|---:|---:|
| 3-4 | 2 |
| 5-8 | 3 |
| 9-14 | 4 |
| 15+ | 5 |

For each vial, roll `1d6` separately. Results 1-5 produce the corresponding
effect. A 6 is not a sixth effect: the player must choose one of rows 1-5 for
that vial.

A committed Long Rest always removes every surviving EFA Experimental Elixir
from the previous batch. Producing a replacement batch is optional and
requires held `Alchemist's Supplies|XPHB`:

| Rest decision | Result on successful commit |
|---|---|
| Supplies held; production chosen; all row-6 choices resolved | Expire the prior batch and create the new 2/3/4/5-vial batch |
| Supplies held; production declined | Expire the prior batch and create nothing |
| Supplies not held | Expire the prior batch and create nothing |
| Entire rest cancelled | Preserve the prior batch and every other pre-rest value |
| Production chosen but a row-6 choice is unresolved | Validation failure; commit nothing |

The distinction is important: declining production is not cancelling the Long
Rest. The rest still completes, so old vials still expire.

### 4.2 Effect scaling

All scaling uses the creator's **Artificer level**, not total character level.
Healing uses the creator's current Intelligence modifier when consumed. A
timed effect snapshots its resolved numeric value when applied, so later level
or ability changes do not mutate an effect already in progress.

| Effect | Artificer 3-8 | Artificer 9-14 | Artificer 15+ |
|---|---|---|---|
| Healing | `2d8 + INT modifier` HP | `3d8 + INT modifier` HP | `4d8 + INT modifier` HP |
| Swiftness | +10 ft walking Speed, 1 hour | +15 ft, 1 hour | +20 ft, 1 hour |
| Resilience | +1 AC, 10 minutes | +1 AC, 1 hour | +1 AC, 8 hours |
| Boldness | `1d4` to every attack and saving throw, 1 minute | Same bonus, 10 minutes | Same bonus, 1 hour |
| Flight | Fly Speed 10 ft, 10 minutes | Fly Speed 20 ft, 10 minutes | Fly Speed 30 ft, 10 minutes |

Consuming the same timed effect again refreshes/replaces its source-owned
state; it does not stack a second identical bonus. One-hour-or-shorter states
end on a Short or Long Rest. The eight-hour Resilience state ends on a Long
Rest. Combat-round durations also participate in normal round expiry, and
remaining rounds persist across leaving and re-entering combat rather than
resetting from the original duration.

### 4.3 Creating one vial with a spell slot

The player can use a Magic action while holding exact
`Alchemist's Supplies|XPHB`, expend one available spell slot of any level, and
choose one of the five effects. The slot level does not improve the elixir.

The operation validates subclass identity, held focus, available Magic action,
available slot, and chosen effect before changing state. Confirmation spends
the action and slot and creates one vial as one atomic transaction. Cancellation
or validation failure spends nothing.

### 4.4 Drinking or administering

Drinking or administering a vial costs one Bonus Action. The player chooses:

- **Self:** healing uses the normal HP-healing path; other effects create or
  refresh the appropriate active state.
- **Other within 5 feet:** consume the action and vial, then return a precise
  effect/formula/duration handoff. The sheet does not invent or mutate another
  creature's HP, AC, Speed, rolls, or conditions.

Unlike the TCE rule, the other creature need not be incapacitated. Cancellation
consumes neither the vial nor the Bonus Action.

The state-level Self and Other transactions now ship. Self stores the exact
consumed-vial provenance and creation snapshot on its timed state, so later
level changes cannot rewrite an active effect. Other first exposes
`previewEfaExperimentalElixirOtherHandoff()`, which validates the exact current
owner, metadata versions and snapshot, quantity, named external target, and
explicit within-5-feet confirmation without mutating or randomly rolling
anything. A deterministic Healing preview can supply explicit rolls; otherwise
it returns the exact formula with unresolved roll fields.

`consumeEfaExperimentalElixir({target: "other", ...})` additionally requires
`confirmed: true`, revalidates the live vial and shared Bonus Action, and then
atomically consumes the action only in combat plus that exact vial. The returned
`externalHandoff` contains a copyable summary and structured target, full
generated-item provenance, Healing dice/current Intelligence result or timed
mechanics, and numeric duration with Short/Long Rest expiry. It never heals Self,
creates a local active state, or claims to mutate the named creature.

Both paths fail closed for unsupported targets, blank external names,
unconfirmed range or commit, stale six-part ownership, unsupported metadata
versions, TCE/custom provenance, corrupted quantities, missing actions, and
lost EFA source ownership. Action or item-removal failure restores the full
pre-use state.

Boldness feeds the main Character Sheet attack and saving-throw roll pipeline,
the dedicated Combat-tab weapon/temporary/active-state attack roller, and the
Combat quick spell-attack roll through the same generic active-state roll-dice
query. Each Combat path rolls the `1d4` once, adds it to the displayed total,
and labels the die and `Experimental Elixir: Boldness` source in the breakdown.

Still deferred: the drinking/administering modal, inventory action controls,
slot-funded creation UI, Long Rest production orchestration, and undo
presentation. The shipped Other handoff is a state API for that later UI, not
the UI itself.

### 4.5 Generated-item ownership

> **Prerequisite status:** the shared versioned generated-feature-item
> provenance, classification, exact-owner listing/removal, replacement, and
> save/load contract is available. Subclass feature ownership uses the
> repository's canonical seven-part source-aware UID, for example
> `Experimental Elixir|Artificer|EFA|Alchemist|EFA|3|EFA`; six-part legacy
> records are repair-required and never activated or removed. Experimental
> Elixir effects and UI are not implemented by this prerequisite. Exact-owner
> creation, subclass lifecycle cleanup, and rest/spell-slot transactions now
> build on it.

Each vial is a normal quantity-1 inventory item with a stable unique ID and
versioned provenance containing at least:

- generating feature, class, and subclass UIDs;
- effect key;
- `longRest` or `spellSlot` origin;
- batch ID and creation Artificer level;
- spent slot level, if any;
- metadata schema version.

Cleanup, effect execution, migration, and respec act only on positively owned
EFA records. A same-named custom potion or TCE item is never adopted,
activated, or deleted. Unsupported metadata versions render an explicit stale
item/repair state instead of guessing.

## 5. Level 5: Alchemical Savant

> **Milestone status:** implemented and covered by the focused
> `CharacterSheetEfaAlchemicalSavant` Jest suite.

Alchemical Savant applies only when the cast receipt proves that exact
`Alchemist's Supplies|XPHB` was selected as the focus
([`data/class/class-artificer.json:2983-2996`](../../data/class/class-artificer.json#L2983-L2996)).

The bonus is `max(1, Intelligence modifier)` and can be applied to exactly one
eligible roll of the spell:

- one healing roll; or
- one Acid, Fire, or Poison damage roll.

The bonus applies once per cast, not once per die, target, or damage instance.
Necrotic damage is not eligible for EFA. A cast using another focus, another
class's casting identity, or an ineligible damage type receives no bonus.

The structured cast result must preserve the original formula, flat Savant
bonus, final formula/total, selected focus, exact casting class UID, and whether
the once-per-cast application was consumed.

The implementation publishes serializable roll records in the committed
receipt's `cast.rolls` array. The Savant hook re-resolves the live focus through
`resolveCommittedSpellCastReceiptFocus`, requires the parent-qualified
`castingSubclassUid`, and annotates exactly one selected roll. A single eligible
roll is deterministic. Multiple eligible rolls use the existing accessible
enum dialog with a decline path. Declined, consumed, and armed roll state lives
only on that cast receipt; it is not character-save state and cannot leak into
a later cast or reload.

If the post-commit Savant hook or selection UI fails, the receipt remains
`ok: true, committed: true`, reports `followUpFailed`, and surfaces a warning.
The spent slot or resource is not restored and the valid spell cast is not made
retryable.

## 6. Level 9: Restorative Reagents

> **Implemented:** the exact EFA-owned grant exposes a cast action, requires
> equipped, proficient `Alchemist's Supplies|XPHB`, resolves the normal spell
> result, and then spends its linked Intelligence-derived use before publishing
> the committed receipt. Cancellation or failed focus/ownership validation is a
> no-op.

Restorative Reagents grants the innate Lesser Restoration cast described in
the spell table
([`data/class/class-artificer.json:2997-3010`](../../data/class/class-artificer.json#L2997-L3010)).

It does **not** grant the TCE `2d6 + Intelligence modifier` temporary-HP rider.
Its use counter belongs to the innate spell grant. The sheet must not create a
second generic "Restorative Reagents" resource.

A successful cast spends one grant use. Cancelling the cast or failing focus,
target, or spell-resolution validation spends none. A Long Rest restores the
grant to its current Intelligence-derived maximum.

The generic spell-result engine does not currently automate choosing and
removing one of Lesser Restoration's four conditions from another creature.
The cast transaction, focus, use, receipt, and visible spell result are
canonical; the downstream condition change remains player-resolved.

## 7. Level 15: Chemical Mastery

Chemical Mastery contains three independent benefits
([`data/class/class-artificer.json:3011-3043`](../../data/class/class-artificer.json#L3011-L3043)).
They must not be represented as one shared generic use pool.

### 7.1 Alchemical Eruption

> **Implemented:** the exact owner is
> `Chemical Mastery|Artificer|EFA|Alchemist|EFA|15|EFA`. The consumer is a
> runtime committed-cast hook registered only for `Artificer|EFA`.

After an `Artificer|EFA` spell actually deals Acid, Fire, or Poison damage to a
target, the result offers an optional `2d8` Force damage follow-up against one
such target.

- It is offered, never auto-applied.
- It can be used once on each tracked turn.
- A second use in the same turn is rejected.
- Advancing to the next tracked turn restores availability.
- Confirmation commits the exact Chemical Mastery/Alchemist/action turn receipt
  before the `2d8` roll, so a failed follow-up cannot reopen the use.
- Save/load during the same tracked turn preserves that receipt; combat
  lifecycle reset advances the opaque turn and clears it.
- A spell cast through another class or with an ineligible final damage type
  does not qualify.
- An item-power cast is not an Artificer spell for this feature, even when the
  item power carries exact `Artificer|EFA` attribution for other receipt
  consumers.
- Damage and target candidates come from the committed receipt's bounded
  `damageEvidence`; authored spell names or `damageInflict` intent never count
  as proof.
- Miss, no-damage, absent-target, cancelled, refunded, ambiguous-owner, and
  post-Transmuted non-qualifying outcomes fail closed.
- If several tracked creatures could have received the qualifying damage, the
  player explicitly chooses one or declines. Selecting an unconfirmed tracked
  candidate is the explicit confirmation that it actually took the recorded
  damage.

Outside tracked combat, the sheet cannot prove the once-per-turn boundary. It
therefore requires an explicit manual confirmation and marks the result as
manually resolved.

The original cast is already committed before the hook runs. Target choice,
the `2d8` roll, feedback rendering, or any later hook can fail only as a
`followUpFailed` receipt entry; spell slots, resources, components, focus
selection, and the spell result are never refunded or made retryable.

### 7.2 Chemical Resistance

> **Implemented:** this passive is registered through the source-aware
> `FeatureEffectRegistry` with the exact Chemical Mastery owner UID. A stored
> same-named feature is insufficient unless the active character still has
> `Artificer|EFA` 15 + `Alchemist|EFA`.

The canonical defense and condition queries gain:

- Acid resistance;
- Poison resistance; and
- immunity to the Poisoned condition.

These passives are exact-source EFA feature effects. They do not depend on an
active toggle or resource.

### 7.3 Conjured Cauldron

> **Implemented:** the exact EFA-owned grant exposes a cast action and publishes
> the same committed receipt contract as other exact EFA casts. Its explicit
> supplies requirement remains active even though the feature waives the spell's
> ordinary Material component.

The once-per-Long-Rest Cauldron grant uses the normal spell-resolution
pipeline:

- cast `Tasha's Bubbling Cauldron|XPHB`;
- spend no spell slot;
- require no preparation;
- ignore Material components;
- still require exact `Alchemist's Supplies|XPHB` as the focus;
- spend the use only after a successful cast transaction.

The generic spell-result engine does not currently create or track the chosen
Common/Uncommon potion inventory produced by the cauldron. This milestone proves
the legal cast transaction and visible result only; potion choice, withdrawals,
and expiration remain player-resolved.

## 8. EFA and TCE must remain isolated

The TCE rules are separately defined
([`data/class/class-artificer.json:4291-4524`](../../data/class/class-artificer.json#L4291-L4524)).
The compatibility `Alchemist|TCE` under `Artificer|EFA` still uses those TCE
rules. It is not an EFA Alchemist merely because its parent class is EFA.

| Rule | `Alchemist|EFA` | `Alchemist|TCE` |
|---|---|---|
| Long Rest vial count | 2/3/4/5 at levels 3/5/9/15 | 1/2/3 at levels 3/6/15 |
| Healing | `2d8/3d8/4d8 + INT` | `2d4 + INT` |
| Row 6 | Choose rows 1-5 | Transformation/Alter Self |
| Consumption | Bonus Action; Other within 5 ft | Action; administer to an incapacitated creature |
| Fixed tools | Alchemist's Supplies and Herbalism Kit | Alchemist's Supplies only |
| Potion Crafting | Structured potion time multiplier `0.5` | Absent |
| Savant damage types | Acid, Fire, Poison | Acid, Fire, Necrotic, Poison |
| Restorative Reagents | Lesser Restoration grant only | Lesser Restoration plus elixir temporary HP |
| Level-13 spell | Vitriolic Sphere | Blight |
| Level-15 active benefit | Eruption and Cauldron | Greater Restoration and Heal |
| Chemical defenses | Acid/Poison resistance; Poisoned immunity | Same passive defenses |

Every source-sensitive test must cover all three combinations:

1. `Artificer|EFA` + `Alchemist|EFA`;
2. `Artificer|EFA` + compatibility `Alchemist|TCE`;
3. `Artificer|TCE` + `Alchemist|TCE`.

## 9. Save, migration, and respec ownership

### Save/export contract

The saved character must retain:

- exact parent and subclass identities;
- prepared and innate grant ownership;
- current/max innate uses;
- Tools of the Trade acquisition facts, selections, and receipts;
- generated-vial version, owner, batch, origin, effect, and slot metadata;
- active elixir states and their snapshotted values;
- tracked-turn Eruption receipt.

Ordinary JSON export/import must round-trip these records without converting
innate spells to prepared spells or generated elixirs to permanent custom
items.

### Migration contract

Migration is exact-source, conservative, and idempotent:

1. Detect only `Alchemist|Artificer|EFA|EFA`.
2. Normalize legacy Lesser Restoration or Cauldron rows only when existing
   metadata positively proves EFA subclass ownership.
3. Preserve independent spell copies and ambiguous custom resources.
4. Preserve spent uses when a dynamic maximum changes.
5. Never adopt a same-named custom inventory item as an Experimental Elixir.
6. Reconstruct only provable fixed tool grants. If pre-acquisition duplicate
   facts are unknown, create a visible repair-required decision instead of
   guessing replacement tools.
7. Reject unsupported generated-item versions explicitly.
8. Produce the same serialized state when rerun.

### Respec contract

Respec operates on the isolated candidate state. Moving away from exact
`Alchemist|EFA` removes only its owned prepared/innate grants, grant uses,
tool receipts, generated vials, active elixir states, crafting modifier, and
Eruption turn receipt.

Independent spells, non-EFA tool proficiencies, same-named custom items, and
TCE data survive. Changing to compatibility `Alchemist|TCE` must not translate
EFA vials into TCE vials or leave EFA-only spell and effect rows behind.
Returning to EFA recomputes Tools of the Trade from the candidate state's
pre-acquisition proficiencies.

## 10. Operate-mode interaction contract

The interface is for completing operations clearly, not for simulating an
always-open alchemy workshop.

### Feature panel

The EFA Experimental Elixir card shows:

1. current Artificer level and next produced batch size;
2. exact supplies requirement and readiness;
3. current generated vials with effect, duration, and origin;
4. `Create with Spell Slot` as the primary contextual action;
5. expandable rendered rules text.

Unavailable, missing-supplies, no-slot, action-spent, stale-item, and
repair-required states must each explain why an operation cannot proceed.
Missing supplies never block completing a Long Rest.

### Long Rest interaction

The existing Long Rest modal owns production:

- state clearly that committing the rest expires the prior batch;
- offer an explicit produce/decline choice when supplies are held;
- stage the exact number of rolls only when production is selected;
- show one labeled row-1-to-5 control for every rolled 6;
- disable final commit only while selected production has unresolved choices;
- keep Cancel/Escape fully non-mutating;
- announce expired and created vial results after a successful commit.

### Create and consume interactions

The create-with-slot modal shows the slot, chosen effect, focus requirement,
and Magic action cost before confirmation. The consume modal shows Self/Other,
the resolved formula or numeric effect, duration, and Bonus Action cost before
confirmation.

Failures remain inline and leave all costs untouched. Success refreshes every
affected surface, including Features, Spells, Inventory, Combat, and active
effects.

### Accessibility and mobile expectations

- Use native buttons, selects, radio groups, and fieldsets with visible labels.
- Put initial focus on the modal heading or first unresolved field.
- Keep Tab order aligned with visual order.
- Support Space/Enter activation and non-mutating Escape/Cancel.
- Associate validation with its control through `aria-describedby`.
- Announce errors and committed results through `aria-live`.
- Never use color or an icon as the only explanation of an effect or error.
- Return focus to the feature, vial, or Rest control that opened the modal.
- Use a single-column mobile layout with full-width controls and stacked vial
  cards; do not require a horizontally scrolling table.

## 11. Honest limitations

Even after the planned implementation lands, two boundaries remain explicit:

- **External targets:** the Character Sheet owns the current character, not
  another creature's sheet or HP. Administering an elixir to Other and applying
  Eruption to an external target produce exact readable/copyable handoff
  results instead of claiming to mutate remote state.
- **Out-of-combat Eruption:** without a tracked turn key, once-per-turn
  enforcement is manual. The player confirms responsibility for the limit and
  the result is labeled manual.

No current partial or smoke-level EFA behavior should be described as full
support. Full support exists only when the relevant milestone code and causal
acceptance tests are integrated together.

## 12. Acceptance summary

### Mechanical acceptance

- Exact EFA/TCE source matrix with no cross-source leakage.
- All ten prepared grants and both innate grants retain their modes and owners.
- Tools of the Trade handles zero, one, and two replacement choices.
- A value-less potion receives the shared rarity baseline and exact `0.5`
  Potion Crafting multiplier in preview and committed outcome.
- Experimental Elixir proves every count, row-6 choice, effect, scaling tier,
  duration, action cost, rest expiry, refresh behavior, and Other handoff.
- Savant proves eligible healing/damage, wrong focus, wrong class, wrong type,
  and once-per-cast behavior.
- Lesser Restoration and Cauldron prove success-only use spending and Long
  Rest restoration.
- Eruption proves optional application, damage-type/class eligibility,
  same-turn rejection, next-turn reset, and manual out-of-combat handling.
- Chemical resistance and Poisoned immunity affect canonical defense queries.

### Transaction and persistence acceptance

- Full-rest cancellation, unresolved row 6, missing focus, missing action,
  missing slot, and consume cancellation mutate nothing.
- Declined/no-supplies committed rests still expire the prior batch.
- Undo restores the previous batch after a committed replacement.
- Save/export/import preserves exact owners, uses, choices, provenance, and
  active states.
- Migration is idempotent and preserves ambiguous or independent data.
- Respec removes only exact EFA-owned state.
- Transient generated vials do not become permanent NPC equipment.

### UI and test acceptance

- Keyboard, focus-return, labels, inline validation, `aria-live`, mobile
  stacking, and explicit disabled reasons are covered.
- Focused Jest suites cover state, spell automation, crafting, rest/undo,
  inventory, UI, migration, respec, source isolation, and NPC export.
- The comprehensive Playwright build covers the complete Artificer 1-20
  lifecycle and all required character-spec checks, with measurable effect
  probes rather than feature-name-only assertions.
- Matrix-bearing E2E validation runs with `RUN_MEGA=1` on a fresh `PW_PORT`
  and verifies that feature rows were not silently skipped.

## 13. Milestone delivery

Implementation is intentionally split into bounded reviewable milestones:

| Milestone | Deliverable |
|---:|---|
| 0 | Integrate base EFA contracts: exact focus receipts, source-safe class calculations, generated-item provenance, shared crafting baseline, and shared E2E chassis |
| 1 | Source-safe calculations and prepared/innate spell grants |
| 2 | Tools of the Trade choices and shared Potion Crafting multiplier |
| 3 | Experimental Elixir state, inventory, transactions, and effect lifecycle |
| 4 | Operate-mode UI, rest choices, accessibility, and mobile behavior |
| 5 | Chemical Resistance defenses and Restorative Reagents/Cauldron cast execution (shipped); Savant and Alchemical Eruption remain separate bounded work |
| 6 | Migration, respec, export, rendering, and isolation hardening |
| 7 | Integrated Jest/E2E verification and documentation alignment |

The guide becomes a description of shipped support only after the integrated
branch satisfies the acceptance summary, not when any single milestone exists
in isolation.
