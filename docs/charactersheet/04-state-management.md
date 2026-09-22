# State Management Deep Dive

This document provides an in-depth exploration of `CharacterSheetState`, the heart of the character sheet system.

## Overview

`CharacterSheetState` is the largest module in the character sheet system (~16,315 lines). It serves as both the **data store** and **calculation engine** for all character mechanics.

## Core Data Structure (`_data`)

All character information is stored in a private `_data` object. Understanding this structure is essential for working with the state.

### Progression History

`levelHistory` is a versioned decision ledger, not only a list of sparse receipts.
Each chronological level records its class assignment, compatibility `choices`,
and normalized `decisions`. The shared `CharacterSheetProgression` manifest
regenerates every expected opportunity from the loaded catalogs, including
choices which were skipped and therefore never appeared in older history.
Legal option catalogs remain runtime-only and are not serialized into character
saves. Structural history completeness means every character level has a row;
decision validity is checked separately by the Respec manifest.

Decision semantic keys contain class identity, class level, decision type,
source feature, and slot, but not character level. This lets choices follow their
class-level opportunity when multiclass order changes.

`progressionOwnership` tracks overlapping progression sources for skills, tools,
languages, expertise, and permanent spells. Respec detaches only the source being
changed and keeps the mechanical value if another decision or a preserved
import/manual origin still owns it. Cascades prune removed semantic sources and
delete only values which no surviving or preserved source requires. See
[22-respec.md](./22-respec.md).

### Generated class summons

Feature-created deployables use the existing `_data.companions[]` store with
`type: "class_summon"`. New generated records add a reusable
`generatedClassSummon` ownership envelope containing exact source-qualified
template/class/subclass/feature UIDs, a generated slot, and a generation
version. `generatedClassSummonRevisions` persists only the latest revision
cursor per ownership slot so a retired deployable can be recreated with a
monotonically newer identity after save/load.

The record stores mutable runtime state only. For the EFA Eldritch Cannon this
is form, size, placement, mobility, owner distance, current HP, remaining game
minutes, payment metadata, and instance revision. AC, maximum HP, immunities,
and current attack/save/form calculations are projected at read time from
`data/objects.json` and the exact `Artificer|EFA` owner level. Generated summons
are never inventory items.

`reconcileClassSummons()` is the load/import and owner-change boundary. It
returns explicit kept/clamped/retired results and reasons while enforcing
template/source identity, owner/subclass eligibility, slot ceilings, legal
runtime values, deduplication, zero-HP/duration retirement, and HP clamping
without healing.

Generic companion access (`getCompanions()`, `getActiveCompanions()`,
`getCompanion()`, generic render controls, and generic removal) excludes
generated records. Those APIs require the full legacy companion shape and
would otherwise expose unsupported controls or persist fake derived fields.
Dedicated class-summon APIs remain the only read/mutation surface, while
`toJson()` continues to serialize the compact record from `_data.companions[]`.

EFA cannon creation is a higher-level transaction over that compact lifecycle.
`pCreateEfaEldritchCannon()` validates the complete form/size/placement/payment
request before spending anything, consumes the canonical Action slot only in
combat, and spends either the source-qualified one-use Long Rest resource or an
explicit normal/Pact spell slot. The callback-backed persistence commit is
atomic: a failed save restores the full pre-request state, including action
economy, resource/slot counts, summon revisions, and companion records, then
attempts to persist the rollback. Resource-less Milestone 2 saves initialize
the use as spent only when a surviving exact-owner cannon records
`createdWith: "freeUse"`; explicit resources remain authoritative.

Base operation remains on dedicated EFA APIs:
`validateEfaEldritchCannonActivation()` /
`activateEfaEldritchCannon()` enforce the 60-foot owner range, optional
15-foot movement, form target ranges, and the canonical Bonus Action slot in
combat. Position, HP damage/healing, `mending`, Magic Action dismissal, and
explicit duration-ending each have source-specific methods. Protector applies
the ordinary temporary-HP replacement rule to self only; another creature's
rolled result is reported without mutating another character.

### Basic Information

```javascript
this._data = {
    // Identity
    name: "",                        // Character name
    race: null,                      // Race object from 5etools
    subrace: null,                   // Subrace if applicable
    background: null,                // Background object
    alignment: "",                   // Alignment string
    
    // Appearance & Personality
    appearance: "",
    personality: "",
    ideals: "",
    bonds: "",
    flaws: "",
}
```

### Class Structure

Classes are stored as an array, supporting multiclassing:

```javascript
classes: [
    {
        name: "Fighter",            // Class name
        source: "XPHB",             // Source book
        level: 5,                   // Levels in this class
        subclass: {                 // Subclass (null if not chosen)
            name: "Champion",
            shortName: "Champion",
            source: "XPHB"
        },
        hitDiceUsed: 2,             // Hit dice spent (for recovery)
        isStartingClass: true,      // First class taken
    },
    {
        name: "Rogue",
        source: "PHB",
        level: 3,
        subclass: {
            name: "Assassin",
            shortName: "Assassin",
            source: "PHB"
        },
        hitDiceUsed: 0,
        isStartingClass: false,
    }
]
```

### Ability Scores

Each ability score has multiple components for tracking different sources of bonuses:

```javascript
abilityScores: {
    str: {
        base: 15,              // Point-buy or rolled value
        racialBonus: 2,        // Bonus from race
        asiBonus: 0,           // From Ability Score Improvements
        miscBonus: 0,          // Items, feats, etc.
        overrideValue: null,   // Manual override (e.g., headband of intellect)
    },
    dex: {base: 14, racialBonus: 0, asiBonus: 2, miscBonus: 0, overrideValue: null},
    con: {base: 13, racialBonus: 1, asiBonus: 0, miscBonus: 0, overrideValue: null},
    int: {base: 10, racialBonus: 0, asiBonus: 0, miscBonus: 0, overrideValue: null},
    wis: {base: 12, racialBonus: 0, asiBonus: 0, miscBonus: 0, overrideValue: null},
    cha: {base: 8, racialBonus: 0, asiBonus: 0, miscBonus: 0, overrideValue: null},
}
```

### Hit Points

```javascript
hp: {
    current: 45,               // Current HP
    max: 45,                   // Maximum HP
    temp: 0,                   // Temporary HP
    maxModifier: 0,            // Bonus/penalty to max (e.g., from exhaustion)
},
hitDice: [
    {class: "Fighter", die: 10, max: 5, current: 3},
    {class: "Rogue", die: 8, max: 3, current: 3},
],
deathSaves: {
    successes: 0,
    failures: 0,
},
```

### Proficiencies

```javascript
// Saving Throws (array of ability abbreviations)
savingThrowProficiencies: ["str", "con"],

// Skills (array of skill names)
skillProficiencies: ["athletics", "intimidation", "perception", "stealth"],

// Expertise (double proficiency)
skillExpertise: ["stealth"],

// Tools
toolProficiencies: [
    {name: "Thieves' Tools", source: "Rogue"},
    {name: "Gaming Set (Dice)", source: "Background"},
],

// Languages
languageProficiencies: [
    {name: "Common", source: "Race"},
    {name: "Dwarvish", source: "Race"},
    {name: "Thieves' Cant", source: "Rogue"},
],

// Weapons (strings or patterns)
weaponProficiencies: ["simple", "martial"],

// Armor
armorProficiencies: ["light", "medium", "heavy", "shields"],
```

### Senses

The character sheet models the four canonical D&D 5e senses uniformly.

```javascript
senses: {
    darkvision: 0,   // range in feet
    blindsight: 0,
    tremorsense: 0,
    truesight: 0,
},
```

Race data ingestion honours **all four** senses as top-level numeric
fields on the race (and, if present, subrace) object — `race.darkvision`,
`race.blindsight`, `race.tremorsense`, `race.truesight`. The Builder,
main-sheet race application, and Respec's race-change path iterate
`CharacterSheetClassUtils.SENSE_DISPLAY_ORDER` so any new sense granted
by a race is picked up automatically without further plumbing.
Subrace values override race values when they exceed the race value
(e.g. Drow's `darkvision: 120` over the base Elf's 60). Prose-only or
conditional grants (e.g. "while submerged you gain blindsight 10 ft.")
stay in the race's `entries` block and are surfaced through the
active-state / toggle system, not through the numeric senses fields.

### Feature-Owned Companions

Feature companions remain ordinary records in `_data.companions[]`; there is no
Battle-Smith-only store. Exact ownership is carried by a full subclass-feature
UID:

```javascript
{
    id: "stable-companion-id",
    featureGrant: {
        type: "subclassFeature",
        uid: "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA",
        className: "Artificer",
        classSource: "EFA",
        subclassShortName: "Battle Smith",
        subclassSource: "EFA",
        level: 3,
    },
    setup: {...},        // persisted player choices
    lifecycle: {...},    // status, generation, and lifecycle timestamps
    uses: {...},         // companion-owned resources and current values
    turnUsage: {...},    // current action/reaction/feature flags
    hitDice: {...},      // die plus current/max counts
    scaling: {
        kind: "featureCompanion",
        featureUid: "...|3|EFA",
        registryFeatureUid: "...|3",
        identity: {...},
        summonerContext: {...},
        resolved: {...}, // detached JSON-safe rules output
    },
}
```

`CharacterSheetCompanionRules` is the sole formula authority.
`resolveFeatureCompanionRules(featureUid, summonerContext)` requires an exact
registered UID and an already-resolved context. Missing modules, descriptors,
or required context fields throw instead of falling back to a same-named TCE
feature.

`reconcileFeatureOwnedCompanion()` refreshes only derived identity, statistics,
actions/reactions, resource maxima, Hit Dice maximum, and the resolved scaling
overlay. It preserves the record ID, nickname/setup, arbitrary extension keys,
generation, lifecycle status/timestamps, turn usage, spent resources, spent Hit
Dice, conditions, and temporary HP. Current HP is kept exactly and is only
clamped when a new maximum is lower; a level or Intelligence increase never
heals the companion.

Whole-owner helpers (`getFeatureOwnedCompanions`,
`deactivateFeatureOwnedCompanions`, `removeFeatureOwnedCompanions`, and
`rebindFeatureOwnedCompanion`) compare the normalized full source-qualified UID.
They must not use `type`, display name, or subclass name, so EFA, TCE, and future
Reanimator companions can coexist safely. Deactivation, removal, and compatible
rebind also release only the affected companion's exact action/reaction receipt
keys, so a same-owner sibling is never refunded.

Reanimated Companion creation and lifecycle use the stricter canonical runtime
owner `Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW`. The six-part
registry UID remains the pure-rule lookup key, but cannot open a creation
transaction or match exact RHW teardown. Creation is exposed through
`getFeatureCompanionCreationBoundary()` and `pCreateFeatureCompanion()`:

- a versioned setup-choice transaction is derived from the pure companion rules
  before any action, payment, or tool receipt can commit;
- submitted modification options must match the transaction's exact ID, name,
  and `RHW` source, required count, uniqueness, unlock level, rules version, and
  acquisition level; stale or rejected transactions spend nothing;
- the Magic action is tracked only when combat action economy is active;
- payment is one persisted free creation per Long Rest or one selected level
  1+ spell/pact slot;
- the tool receipt comes from the shared spell-focus inventory resolver and
  must resolve immediately before the companion commit to an equipped,
  proficient `Tinker's Tools|XPHB` or another XPHB Artisan's Tool;
- action, payment, inventory, resource, and companion mutations roll back
  together when any final validation or core commit fails;
- an active exact-owner companion blocks replacement.

The free creation is a contextual `_data.resources[]` row carrying exact
`featureUid`, `classUid`, and `subclassUid` plus
`featureCompanionCreation.version`. Reconciliation preserves spent state. When
loading an exact active companion without that row, migration conservatively
infers the free use as available only when the saved creation receipt proves a
spell-slot payment; free-paid or unknown active instances infer it as spent.

An active Reanimated Companion persists a stable companion ID, generation,
current/max HP, Hit Dice, optional `setup.appearance`, exact `featureGrant`,
detached resolved rules, and `lifecycle.creationReceipt`. R4a stores the
canonical modification receipt at both
`setup.choices.modifications` and
`lifecycle.creationReceipt.setupChoices.modifications`:

```javascript
{
    version: 1,
    transactionId: "feature-companion-setup-v1|...",
    ownerUid: "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW",
    rulesVersion: 2,
    acquisitionLevel: 9,
    requiredCount: 2,
    selectedOptionIds: ["arcaneConduit", "bloated"],
}
```

The acquisition level and selected IDs are immutable for that generation.
Reconciliation can change current-level HP/Hit Dice maxima, spell attack/DC,
PB/INT-derived numbers, and Improved Reanimation, but it never adds, drops, or
repicks a modification. Level 15 therefore affects an existing level-9
generation's global formulas without silently granting its third choice; a new
level-15 generation receives a fresh three-choice transaction.

The receipt also includes stable owner identity, payment before/after values,
Magic-action status, and the shared inventory wrapper/entity tool reference.
R3 deferred saves remain explicitly `legacyDeferred` rather than receiving
invented choices. They still receive current-level Improved Reanimation because
that feature scales independently of the creation choice.

All five modification effects are projected from
`CharacterSheetCompanionRules` into `companion.scaling.resolved`: Arcane
Conduit origin/range/school/INT and future turn-receipt metadata, Ferocity's
`d6`, Bloated size/push/Death Burst INT, Gaunt movement/climbing/fear aura, and
Moist swimming/squeezing/acid retaliation. The exact active snapshot is also
available at
`getFeatureCalculations().reanimatedCompanion.activeCompanion`.
Generation-scoped operation metadata receives a deterministic key containing
the exact owner UID, source UID, companion ID, lifecycle generation, and action
UID. Reconciliation and save/load reproduce the same key without creating a
turn receipt; a replacement generation receives a different key.

Lifecycle APIs are `killFeatureOwnedCompanion()`,
`pDismissFeatureOwnedCompanion()`, `handleFeatureCompanionSummonerDeath()`, and
`applyFeatureCompanionRest()`. Ordinary death leaves the record dead at 0 HP
and emits its detached Death Burst once. Early dismissal spends its Magic
action and removes the companion without a burst. Summoner death kills at 0
HP, emits once, and removes it. Short Rest changes neither companion nor
creation payment; Long Rest expires exact-owner companions and restores the
free creation. Exact subclass loss removes only the canonical RHW companion
and creation resource. Name-only, wrong-source, foreign-owner, player-created,
and unsupported provenance records are not adopted or removed.

Legacy Steel Defender migration is intentionally narrower than the generic
runtime contract. It binds only one exact `steel_defender` statblock whose
name/source match one exact-source Artificer/Battle Smith owner. Missing source,
cross-source ownership, duplicate candidates, or an already-bound owner remain
untouched. Outcomes are exposed by `getFeatureCompanionMigrationStatus()` under
`migrationFlags.featureCompanionLegacyV1`; migration never creates a companion,
heals it, or initializes resource/Hit Die current values above zero.

Acquisition/setup lives in the generic versioned
`featureCompanionSetups.records` store, keyed by the normalized full feature
owner UID. A record contains `ownerUid`, `status` (`pending` or `complete`),
`eligibility` (`active` or `inactive`), source-specific `choices`, and the
compatible `companionId` when one exists. Pending setup is never represented by
a fake companion.

`registerFeatureCompanionGrant()` registers narrow source setup descriptors,
while `reconcileFeatureCompanionGrants()` provides the shared orchestration used
by Builder, Level Up, Quick Build, load, and Respec. For the EFA Battle Smith it:

- consumes the exact `Tools of the Trade|Artificer|EFA|Battle Smith|EFA|3|EFA`
  fixed-proficiency transaction;
- persists deferred appearance/body-shape choices without inventing defaults;
- creates or reuses exactly one
  `Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA` companion after required
  setup is complete;
- preserves the companion ID across repeated reconciliation and compatible
  EFA/TCE rebinds; and
- marks lost exact grants inactive/`vanished` instead of deleting the record.

`getFeatureCompanionSetupRecord()`,
`getFeatureCompanionSetupToolState()`,
`getFeatureCompanionSetupMissingChoices()`,
`updateFeatureCompanionSetup()`, `deferFeatureCompanionSetup()`,
`completeFeatureCompanionSetup()`, and
`getPendingFeatureCompanionSetups()` expose the persisted transaction without
copying any companion formula. `CharacterSheetCompanionRules` remains the sole
formula authority.

In-play operations use one State transaction from both desktop and Play Mode:

```javascript
state.getCompanionOperationAvailability(companionId, operation, options);
state.performCompanionOperation(payload);
state.commandCompanionAction(options);
state.useCompanionRepair(options);
state.useCompanionReaction(options);
state.spendCompanionHitDie(options);
```

The transaction preflights the exact feature owner, companion state, target and
range acknowledgement, resources, companion action/reaction receipt, and owner
command method before any mutation. A later failure rolls back the exact
receipt, owner Bonus Action or canonical Combat Attack replacement, resource,
and HP snapshot. `resetTurnEconomy()` remains the only turn reset; changing or
loading `combatRound` never releases a companion action/reaction.

EFA Force-Empowered Rend uses the rules registry's spell attack and
`1d8 + 2 + INT` force damage. Repair can heal a modeled Construct atomically or
return a manual-application amount for a confirmed external Construct/object.
Deflect Attack consumes only the defender Reaction and gains its registry-owned
level-15 retaliation. Companion Hit Dice are d8s with the companion
Constitution modifier, staged by the existing Short Rest dialog, and never
touch player Hit Dice. A long rest restores EFA Repair and half companion Hit
Dice (rounded up) without healing or resurrecting the defender.

Arcane Jolt consumes the committed Rend result through the shared
`CharacterSheetPage.pOfferEfaArcaneJolt()` post-hit flow; it does not add state
to the companion operation result or duplicate the companion receipt store.
Battle Ready weapon substitution uses the shared item classifier and attack
identity described in `06-combat-system.md`.

The print/PDF renderer recognizes the exact source-qualified EFA owner and reads
the reconciled `scaling.resolved` overlay plus public State APIs. It presents the
chosen name/appearance/body shape, resolved statistics, saves/skills, defenses,
Hit Dice, Repair, actions, reactions, command policy, Arcane Jolt tracker, and
Improved Deflection without copying companion formulas or persisted derived
values. TCE, RHW, name-only, and generic companions stay on the generic PDF path.

Death/revival/replacement transitions and E2E remain outside this milestone.
The PDF does not infer or display lifecycle state that State does not model.

The Reanimated Companion R4a boundary is creation/setup and persisted derived
state only. It does not execute command/default Dodge/Bonus Action behavior,
Dreadful Swipe attacks or pushes, start-turn fear saves, Moist reaction damage,
Lightning Absorption healing, Arcane Conduit casting or turn-receipt commits,
Death Burst targets/saves/damage, or Life Transfer. Those entries are
`metadataOnly`/`deferredR4b`; UI, Play Mode, and E2E behavior also remain later
milestones.
Other feature companions still do not gain acquisition or lifecycle behavior
unless their registry policies explicitly support it.

### Spellcasting

```javascript
// Regular spell slots
spellSlots: {
    1: {max: 4, current: 2},
    2: {max: 3, current: 3},
    3: {max: 2, current: 0},
    // ...
},

// Warlock pact magic
pactSlots: {
    level: 3,                  // Pact slot spell level
    max: 2,                    // Number of pact slots
    current: 1,                // Currently available
},

// Spell lists
knownSpells: ["magic missile", "shield", "fireball"],
preparedSpells: ["magic missile", "shield"],
alwaysPreparedSpells: ["bless", "cure wounds"],  // Domain, etc.
ritualSpells: ["detect magic", "identify"],

// Concentration tracking
concentration: {
    spellName: "bless",
    startTime: 1234567890,
    durationMinutes: 10,
},
```

Persisted spells are object rows in `spellcasting.spellsKnown` /
`cantripsKnown`; the arrays above are the conceptual view. Base-class
`additionalSpells.prepared` grants are reconciled by
`populateClassSpells()` after the page injects the fully merged class and spell
catalogs. A row created only by the class carries `grantedByClass: true` and is
removed when its class-level requirement is lost.

If the exact `name|source` spell already belongs to the player, the reconciler
does not create or later delete a duplicate. It snapshots the row's
`alwaysPrepared`, `prepared`, `sourceFeature`, and `sourceClass` values, records
source-qualified `classGrantOwners`, and temporarily applies the class grant.
The inverse ordering is handled too: if a player or Respec decision selects a
spell that currently exists only because of a class grant, the add path converts
that row into the same reversible overlay before coalescing the selection.
Nested feat/feature spell choices use their progression-ownership claim rather
than a display-label allowlist, so their owner survives removal of the class
grant as well.
Player-chosen/orphan rows temporarily use the class source feature so the grant
does not consume a prepared/cantrip allowance; rows already owned by another
feature keep that feature's attribution so its teardown remains authoritative.
The original metadata is restored when the last class owner disappears. Respec
draft states receive the same class and spell catalogs before loading their
snapshot, so draft previews and committed characters use identical spell
identities and levels.

### Inventory

```javascript
items: [
    {
        id: "item-1234",
        name: "Longsword",
        type: "weapon",
        quantity: 1,
        weight: 3,
        equipped: true,
        attuned: false,
        charges: null,
        notes: "",
        data: { /* full 5etools item data */ },
    },
    {
        id: "item-5678",
        name: "Plate Armor",
        type: "armor",
        quantity: 1,
        weight: 65,
        equipped: true,
        attuned: false,
        charges: null,
        notes: "",
        data: { /* full 5etools item data */ },
    },
],
currency: {
    cp: 0,
    sp: 50,
    ep: 0,
    gp: 150,
    pp: 2,
},
```

Items may additionally carry a **material reference**, which is *never* flattened into the
item's own fields:

```javascript
{
    name: "Longsword",
    dmg1: "1d8",                                   // base value, never mutated
    material: {name: "Darkmetal", source: "TGTT"},
}
```

`getItems()` runs `projectItemMaterial()` over every item, so all downstream readers see the
projected stats (`dmg1: "1d10"`, `penetration: 2`, …). Use `getItemRaw(id)` when you need the
unprojected item — for example when previewing a *different* material. See
[21-item-materials.md](./21-item-materials.md).

#### Host-bound feature storage

Feature-owned item state belongs on the exact inventory item when the item's
identity is part of the mechanic. EFA Artificer Spell-Storing Item follows this
rule with a versioned `item._spellStorage` descriptor containing:

- exact wrapper and source-qualified item identities;
- exact source-qualified spell identity plus copied spell data;
- the owning `Artificer|EFA` class identity and snapshotted Intelligence
  modifier, proficiency bonus, spell save DC, and spell attack bonus;
- current/maximum uses; and
- repair metadata (`active`, `stale`, or `expired`).

The state reconciler validates the descriptor after load and whenever the
spell catalog, class levels, or host item changes. Host removal, host identity
replacement, and loss of exact EFA level/source ownership clean the storage.
Generated hosts additionally re-resolve the full accepted focus reference
(generated id, exact owner, catalog item, and creation receipt), so a
same-name replacement surfaces as stale. An unavailable spell catalog,
missing exact spell, unsupported storage version, or malformed owner/casting
reference also surfaces as stale instead of guessing a replacement. Saves
without `_spellStorage` need no migration.

The stored spell projects through the normal item-power API as
`kind: "storedSpell"`. Its use is an effect-first transaction with a
runtime-only pre-effect reservation for the exact storage/host/holder. A
concurrent duplicate returns `use-in-progress`; cancellation or effect failure
releases the reservation. After the core effect resolves with the stored
Artificer statistics, the exact item use and in-combat holder turn receipt
commit. This is an item effect, not a class spell cast, so it does not publish
committed-cast hooks, consume a slot/component, invoke the focus gate, or
apply/consume cast-sensitive damage or on-cast riders.

The acting holder is carried into targeting. Self-only stored effects used by
an external holder return an explicit external-resolution descriptor and do
not mutate this character. Concentration-created active states, companions,
and temporary attacks may persist `effectOwnerId` and `effectHolderUid`;
holder-scoped teardown removes only artifacts owned by the concentration entry
being replaced. Older unowned effects retain spell-name fallback behavior.

#### Opening equipment packs

Catalog equipment packs expose a non-empty `packContents` array. The Inventory module resolves
every `name|source` UID against its loaded `_allItems` catalog before asking State to mutate
anything. Plain UIDs add one item, `{item, quantity}` entries add the requested count, and
`{special}` entries become custom inventory items because no catalog entity exists.

Opening is all-or-nothing. An unresolved UID or malformed entry produces an error that names the
unresolved content; no child item is added and no pack is consumed. After successful resolution,
`CharacterSheetState.openEquipmentPack()` adds the complete batch and decrements or removes exactly
one source pack under a rollback-backed transaction.

Every child payload stores `_fromPack: "Pack Name|SOURCE"`. `addItem()` includes this marker in its
stack identity: children from the same pack can merge, but they never merge into an ordinary stack
or a stack from a different pack. Special custom entries remain separate under the existing
`_isCustom` no-merge rule. Inventory rows surface the marker as a `From Pack Name` hint.

#### Wrapper-ID equipment bindings

Persistent mechanics that bind to a particular inventory row store the wrapper
`id`; they do not store the editable item name and do not infer identity from
derived equipment snapshots such as `_data.ac.armor`.

EFA Armorer's Arcane Armor binding is stored as:

```javascript
efaArmorer: {
    arcaneArmorItemId: "inventory-wrapper-id" // or null
}
```

The public state surface is:

- `getEfaArmorerModel()` — resolves the exact EFA model from structured
  `chosenSubfeatures` and level-history/canonical decision evidence.
- `getEfaArcaneArmorEligibleItems()` — returns equipped LA/MA/HA wrappers after
  source-aware Smith's Tools checks.
- `getEfaArcaneArmorTransformationStatus(id)` — returns the exact blocked
  prerequisite and player-facing remediation for one real armor row.
- `getEfaArcaneArmorBinding()` — returns the currently bound inventory row, or
  `null`.
- `getEfaArcaneArmorBindingStatus()` — reports active/suspended state and
  explicit reasons.
- `bindEfaArcaneArmor(id)` / `clearEfaArcaneArmorBinding()` — explicit result
  objects; invalid binds return an error code and message.
- `reconcileEfaArmorerState()` — the single mutation/load/death reconciliation
  path.

Smith's Tools proficiency and a canonical Smith's Tools inventory item are
transformation prerequisites, not ongoing Arcane Armor requirements. Once
bound, the armor remains Arcane Armor without the tools until another body
armor is equipped, the bound row becomes invalid, the exact EFA Armorer/model
is lost, or the character dies. Doffing only suspends worn benefits.

Dynamically generated item powers expose the lifecycle on that same inventory
row:

- `Transform` is a Magic action and revalidates every prerequisite before
  committing the wrapper binding.
- `Don` / `Doff` are Utilize actions backed by the existing equipped flag.
- Combat consumes one Action only after `invokeItemPower()` succeeds; stale or
  rejected powers spend nothing. Inventory can invoke the same powers outside
  combat without a combat-action gate.

While the exact bound row is worn and active, its AC snapshot retains the
wrapper `itemId`, allowing the speed/armor-requirement pipeline to ignore that
armor's Strength requirement without name matching. The same active wrapper ID
is added to the exact `Artificer|EFA` requirement returned by
`getSpellCastFocusRequirement()`. Focus selection and committed-cast receipts
therefore use the canonical source-qualified casting path; the armor cannot
satisfy an ambiguous, Wizard, or TCE Artificer cast, and another copy of the
same armor entity cannot replace the bound wrapper. Doffing or invalidation
removes both benefits immediately.

Doffing keeps the binding but suspends its mechanics. Equipping another body
armor, removing the wrapper, replacing it with a non-armor item, losing the exact
EFA subclass/model, or dying clears the binding. The three generated model
weapons use permanent `_efaArmorerWeaponId` values and retain their independent
wrapper IDs and customization across model switches/save-load. Only the selected
model row can expose an attack or item effect while the binding is active. Its
wrapper is derived-equipped only for that active/worn model; all other generated
rows are forced unequipped, and direct equip toggles reconcile back to this
derived state. Inventory hides the generic Equip control and labels each row
`Active Armor Model Weapon` or `Dormant: <Model>` from its stable ID.

The Short Rest and Long Rest dialogs expose one shared staged Armor Model
selector for an exact `Artificer|EFA` Armorer with a canonical model. A switch
requires an existing Arcane Armor binding, Smith's Tools proficiency, and a
canonical PHB/XPHB Smith's Tools inventory item. Those tool checks gate the
transformation only; losing the proficiency or item does not suspend an already
bound, worn Arcane Armor. Doffed bound armor can still switch models, with its
benefits remaining suspended until worn.

The selector does not mutate state until the rest is confirmed. Confirmation
revalidates the prerequisites and calls
`CharacterSheetClassUtils.replaceStructuredFeatureChoice()`, which updates the
materialized feature, `chosenSubfeatures`, level-history choice/replay data, and
the canonical decision/receipt as one rollback-backed transaction. The rest's
full pre-mutation snapshot therefore makes Undo Rest restore the prior model,
binding, and active generated row. If prerequisites become stale while the
dialog is open, the rest still completes but the model remains unchanged and a
warning names the failed prerequisite. The selector previews each model's
weapon and signature benefit in durable text as the selection changes, while
successful rest feedback names the old model, new model, and bound armor.

The active selected row supplies the EFA level-3 weapon baseline:

- Force Demolisher: Simple Melee, Reach, `1d10` Force, 10-foot normal reach.
- Thunder Pulse: Simple Melee, `1d8` Thunder, 5-foot normal reach.
- Lightning Launcher: Simple Ranged, `1d6` Lightning, 90/300-foot range.

All three default to Intelligence for attack and damage. Infiltrator's active
row also contributes Powered Steps (`+5` walking speed) and Dampening Field
(Stealth advantage) through the ordinary item-effect/named-modifier pipeline,
so armor disadvantage cancels it normally. Smith's Tools remain prerequisites
for the transformation/bind operation (and model switching), not ongoing
requirements after a binding is active.

At exact EFA Armorer level 9+, Improved Arsenal contributes +1 attack and +1
damage through `getEffectiveItemBonuses()` only for the active generated model
row whose permanent `_efaArmorerWeaponId` matches the worn, bound Arcane Armor.
The shared generated-attack resolver consumes those effective totals, so Combat
cards and rolls update without an Armorer-specific UI. The derived bonus does
not overwrite `bonusWeapon` or custom attack/damage fields; it composes with
them and disappears immediately on downgrade, doff/unbind, death, unresolved
model, Respec/source loss, or TCE/mixed-source ownership.

Generated mechanics use `_generatedItemBase` snapshots. Reconciliation updates
only fields that are absent or still equal to the previous generated base;
player renames, wrapper IDs/notes, bonuses, entries, effects, metadata, and
direct mechanical overrides survive model switches and save/load. Managed
passive effects have stable `_generatedEffectId` values so generated updates can
coexist with player-authored effects.

Remaining Armorer work is limited to level-15 Perfected Armor model effects,
dedicated NPC/PDF export coverage, and E2E coverage. Level-9 Armor Replication
uses the shared source-qualified plan-extension and constrained
generated-item-capacity contracts; it does not add an Armorer-specific persisted
ledger.

### Active States & Conditions

```javascript
// Toggle abilities (Rage, Bladesong, etc.)
activeStates: [
    {
        id: "rage-active-1",
        typeId: "rage",
        activatedAt: 1234567890,
        options: {
            totemSpirit: "bear",     // For Bear Totem Rage
        },
    },
],

// Chained Fury creature bookkeeping is explicitly opt-in and defaults off.
settings: {
    chainedFuryTargetTracking: false,
},

// Only successful grapple/restraint outcomes are persisted.
// Reminder-only riders do not create entries here.
targetEffects: [
    {
        id: "chain-target-...",
        source: "chained-fury",
        targetName: "Ogre",
        effectType: "restrain",
        grappled: true,
        restrained: true,
        chainIndex: 0,
        recurringDamage: {
            amount: 6,
            type: "force",
            when: "start of each of its turns",
        },
    },
],

// D&D Conditions
conditions: ["exhaustion-1", "frightened"],
exhaustionLevel: 1,

// Custom status effects
customStatuses: [
    {name: "Blessed", icon: "✨", description: "Under effects of Bless"},
],
```

---

## Computed Value Methods

The state provides many methods that calculate derived values from the raw data.

### Proficiency Bonus

```javascript
getProficiencyBonus() {
    const totalLevel = this.getTotalLevel();
    // Standard D&D proficiency bonus progression
    return Math.ceil(totalLevel / 4) + 1;
}
```

| Level | Proficiency Bonus |
|-------|-------------------|
| 1-4   | +2                |
| 5-8   | +3                |
| 9-12  | +4                |
| 13-16 | +5                |
| 17-20 | +6                |

### Ability Scores & Modifiers

```javascript
// Get total ability score
getAbilityScore(ability) {
    const scores = this._data.abilityScores[ability];
    if (scores.overrideValue !== null) return scores.overrideValue;
    return scores.base + scores.racialBonus + scores.asiBonus + scores.miscBonus;
}

// Get ability modifier
getAbilityMod(ability) {
    const score = this.getAbilityScore(ability);
    return Math.floor((score - 10) / 2);
}
```

### Armor Class

AC calculation is complex because it depends on armor type, class features, and active effects:

```javascript
getAc() {
    // Start with base AC
    let ac = 10;
    let dexCap = Infinity;
    
    // Check equipped armor
    const armor = this._getEquippedArmor();
    if (armor) {
        ac = armor.ac;
        dexCap = armor.dexCap ?? Infinity;
        
        // Medium armor caps DEX at +2
        if (armor.type === "medium") dexCap = 2;
        // Heavy armor ignores DEX
        if (armor.type === "heavy") dexCap = 0;
    } else {
        // Unarmored - check for Unarmored Defense
        const unarmoredAc = this._getUnarmoredDefenseAc();
        if (unarmoredAc > ac) ac = unarmoredAc;
    }
    
    // Add DEX modifier (capped if applicable)
    const dexMod = this.getAbilityMod("dex");
    ac += Math.min(dexMod, dexCap);
    
    // Shield bonus
    if (this._hasEquippedShield()) ac += 2;
    
    // Apply modifiers from items, features, active states
    ac += this._getAcModifiers();
    
    return ac;
}
```

Inventory-backed AC is synchronized through `CharacterSheetState.syncEquippedAcState()`.
It rebuilds the armor and shield snapshots from the raw equipped inventory rows, then applies
material projection exactly once. A shield snapshot keeps the shield's base `ac` separate from
its numeric `bonus` (authored `bonusAc` plus any material delta), while `ac.itemBonus` is reserved
for non-armor items such as Rings and Cloaks of Protection. Inventory render/update flows call this
same state-owned path, so equip, unequip, material changes, and first render after loading cannot
race competing shield writers. Signed catalog values such as `"+1"` are normalized before AC
arithmetic.

### Unarmored Defense Variants

```javascript
_getUnarmoredDefenseAc() {
    const classes = this._data.classes;
    let bestAc = 10 + this.getAbilityMod("dex");
    
    // Barbarian: 10 + DEX + CON
    if (this.hasClass("Barbarian")) {
        const barbarianAc = 10 + this.getAbilityMod("dex") + this.getAbilityMod("con");
        if (barbarianAc > bestAc) bestAc = barbarianAc;
    }
    
    // Monk: 10 + DEX + WIS
    if (this.hasClass("Monk")) {
        const monkAc = 10 + this.getAbilityMod("dex") + this.getAbilityMod("wis");
        if (monkAc > bestAc) bestAc = monkAc;
    }
    
    // Draconic Sorcerer: 13 + DEX
    if (this.hasSubclass("Draconic Bloodline")) {
        const draconicAc = 13 + this.getAbilityMod("dex");
        if (draconicAc > bestAc) bestAc = draconicAc;
    }
    
    return bestAc;
}
```

### Initiative

```javascript
getInitiativeMod() {
    let initiative = this.getAbilityMod("dex");
    
    // Feature bonuses
    const calc = this.getFeatureCalculations();
    
    // Swashbuckler: add CHA
    if (calc.hasRakishAudacity) {
        initiative += this.getAbilityMod("cha");
    }
    
    // Alert feat: +5 (PHB) or +prof (XPHB)
    if (this.hasFeat("Alert")) {
        initiative += this._isXphbAlert() ? this.getProficiencyBonus() : 5;
    }
    
    // Apply item/feature modifiers
    initiative += this._getInitiativeModifiers();
    
    return initiative;
}
```

### Spell Save DC & Attack Bonus

```javascript
getSpellSaveDc(className) {
    const cls = this._getClass(className);
    if (!cls) return 8 + this.getProficiencyBonus();
    
    const ability = this._getSpellcastingAbility(className);
    return 8 + this.getProficiencyBonus() + this.getAbilityMod(ability);
}

getSpellAttackBonus(className) {
    const cls = this._getClass(className);
    if (!cls) return this.getProficiencyBonus();
    
    const ability = this._getSpellcastingAbility(className);
    return this.getProficiencyBonus() + this.getAbilityMod(ability);
}

_getSpellcastingAbility(className) {
    const abilityMap = {
        "Wizard": "int",
        "Artificer": "int",
        "Cleric": "wis",
        "Druid": "wis",
        "Ranger": "wis",
        "Monk": "wis",
        "Sorcerer": "cha",
        "Warlock": "cha",
        "Bard": "cha",
        "Paladin": "cha",
    };
    return abilityMap[className] || "int";
}
```

---

## Feature Calculations System

The `getFeatureCalculations()` method is the most important method in the state. It computes all class-specific mechanics based on current levels and choices.

### Return Value Structure

```javascript
{
    // Barbarian
    hasRage: true,
    rageDamage: 2,
    ragesPerDay: 3,
    
    // Rogue
    sneakAttack: {dice: "3d6", avgDamage: 10},
    hasUncannyDodge: true,
    hasEvasion: true,
    
    // Monk
    kiPoints: 5,
    kiSaveDc: 14,
    martialArtsDie: "1d6",
    
    // Fighter
    superiorityDice: 4,
    superiorityDieSize: "d8",
    maneuverSaveDc: 15,
    
    // Wizard
    arcaneRecoverySlots: 3,
    
    // Warlock
    eldritchInvocationsKnown: 4,
    
    // ... all other class features
}
```

### Class-Specific Calculations

The method uses a large switch statement on class name:

```javascript
getFeatureCalculations() {
    const classes = this._data.classes || [];
    const profBonus = this.getProficiencyBonus();
    const calculations = {};

    classes.forEach(cls => {
        const className = cls.name;
        const level = cls.level || 1;
        const source = cls.source || "PHB";
        const is2024 = source === "XPHB";

        switch (className) {
            case "Barbarian":
                // Rage calculations
                calculations.hasRage = true;
                calculations.rageDamage = level >= 16 ? 4 : level >= 9 ? 3 : 2;
                calculations.ragesPerDay = level >= 20 ? Infinity : 
                    level >= 17 ? 6 : level >= 12 ? 5 : level >= 6 ? 4 : 
                    level >= 3 ? 3 : 2;
                
                // Brutal Critical
                if (level >= 9) {
                    calculations.brutalCritical = level >= 17 ? 3 : 
                        level >= 13 ? 2 : 1;
                }
                
                // Subclass features...
                break;
                
            case "Fighter":
                // Fighting Style (level 1)
                calculations.hasFightingStyle = true;
                
                // Second Wind (level 1)
                calculations.hasSecondWind = true;
                calculations.secondWindHealing = `1d10+${level}`;
                
                // Action Surge (level 2)
                if (level >= 2) {
                    calculations.hasActionSurge = true;
                    calculations.actionSurgeUses = level >= 17 ? 2 : 1;
                }
                
                // Extra Attack progression
                if (level >= 5) {
                    calculations.hasExtraAttack = true;
                    calculations.extraAttacks = level >= 20 ? 3 : 
                        level >= 11 ? 2 : 1;
                }
                
                // Indomitable (level 9)
                if (level >= 9) {
                    calculations.hasIndomitable = true;
                    calculations.indomitableUses = level >= 17 ? 3 : 
                        level >= 13 ? 2 : 1;
                }
                
                // Subclass (Champion, Battle Master, etc.)...
                break;
                
            // ... all other classes
        }
    });

    return calculations;
}
```

### 2014 vs 2024 Rules

The method handles differences between PHB (2014) and XPHB (2024):

```javascript
case "Monk":
    const is2024 = source === "XPHB";
    
    // Martial Arts die differs by edition
    if (is2024) {
        // XPHB starts at d6
        martialArtsDice = level >= 17 ? "1d12" : level >= 11 ? "1d10" : 
            level >= 5 ? "1d8" : "1d6";
    } else {
        // PHB starts at d4
        martialArtsDice = level >= 17 ? "1d10" : level >= 11 ? "1d8" : 
            level >= 5 ? "1d6" : "1d4";
    }
    
    // Feature names differ
    calculations.kiPoints = level;      // PHB name
    calculations.focusPoints = level;   // XPHB name (same value)
    
    // Some features moved to different levels
    if (is2024 && level >= 7) {
        calculations.hasReliableTalent = true;  // Moved from 11 to 7
    } else if (!is2024 && level >= 11) {
        calculations.hasReliableTalent = true;
    }
```

---

## Parser Utilities

The state module includes several parser classes for extracting information from feature text.

### FeatureUsesParser

Extracts limited-use information from feature descriptions:

```javascript
FeatureUsesParser.parseUses(
    "You can use this feature twice, and regain uses on a short rest.",
    getAbilityMod,
    getProficiencyBonus
);
// Returns: {max: 2, recharge: "short"}

FeatureUsesParser.parseUses(
    "You can use this a number of times equal to your proficiency bonus per long rest.",
    getAbilityMod,
    () => 4
);
// Returns: {max: 4, recharge: "long"}
```

### NaturalWeaponParser

Extracts natural weapon attacks from racial/class features:

```javascript
NaturalWeaponParser.parseNaturalWeapon(
    "You have talons. Your talons are natural weapons, which you can use to make unarmed strikes. When you hit with them, the strike deals 1d6 + your Strength modifier slashing damage.",
    "Talons"
);
// Returns: {
//     name: "Talons",
//     isMelee: true,
//     isNaturalWeapon: true,
//     abilityMod: "str",
//     damage: "1d6",
//     damageType: "slashing",
//     range: "5 ft",
//     properties: []
// }
```

### SpellGrantParser

Extracts spells granted by features/races/feats:

```javascript
// From structured additionalSpells data
SpellGrantParser.parseAdditionalSpells(
    [{innate: {daily: {"1": ["misty step"]}}}],
    "Fey Ancestry"
);
// Returns: [{
//     name: "Misty Step",
//     source: "PHB",
//     innate: true,
//     uses: 1,
//     recharge: "long",
//     sourceFeature: "Fey Ancestry"
// }]

// From feature text (fallback)
SpellGrantParser.parseSpellsFromText(
    "You can cast {@spell detect magic} at will.",
    "Magic Initiate"
);
```

### FeatureModifierParser

Extracts numeric modifiers from feature/item text:

```javascript
FeatureModifierParser.parseModifiers(
    "While wearing this armor, you have a +1 bonus to AC.",
    "Armor +1"
);
// Returns: [{type: "ac", value: 1, note: "Armor +1"}]

FeatureModifierParser.parseModifiers(
    "You have advantage on Strength checks and Strength saving throws.",
    "Rage"
);
// Returns: [
//     {type: "advantage", target: "check:str", note: "Rage"},
//     {type: "advantage", target: "save:str", note: "Rage"}
// ]
```

---

## State Persistence

### Saving

```javascript
toJSON() {
    return JSON.stringify(this._data, null, 2);
}

getSaveData() {
    return {
        version: CharacterSheetState.SAVE_VERSION,
        timestamp: Date.now(),
        data: this._data,
    };
}
```

### Loading

```javascript
static fromJSON(json) {
    const state = new CharacterSheetState();
    const parsed = JSON.parse(json);
    
    // Handle version migration
    const migrated = CharacterSheetState.migrate(parsed);
    
    state._data = migrated.data;
    return state;
}

static migrate(saveData) {
    let data = saveData;
    
    // Apply migrations from old versions
    if (data.version < 2) {
        data = CharacterSheetState._migrateV1ToV2(data);
    }
    if (data.version < 3) {
        data = CharacterSheetState._migrateV2ToV3(data);
    }
    // ... more migrations
    
    return data;
}
```

---

## Event System

The state emits events when data changes, allowing the UI to react:

```javascript
// In state
setName(name) {
    this._data.name = name;
    this._emit("nameChanged", name);
}

addClass(classObj) {
    this._data.classes.push(classObj);
    this._emit("classAdded", classObj);
    this._emit("levelChanged", this.getTotalLevel());
}

// In UI component
state.on("levelChanged", (newLevel) => {
    this._renderProficiencyBonus();
    this._renderFeatures();
});
```

---

## Auxiliary State Slices

Beyond the core character data, `_data` holds several smaller slices that have their own getter/setter API.

### `_data.favorites[]`

User-starred features/spells/attacks/items. See [Components Reference → Favorites System](./03-components-reference.md#favorites-system) for the shape and full API (`addFavorite` / `removeFavorite` / `toggleFavorite` / `isFavorite` / `_resolveFavorite` / `getOrphanedFavorites` / `cleanupOrphanedFavorites`). Cap = 8. Stable IDs are `"type:idSuffix"`.

### `_data.loreSkills[]` (TGTT)

TGTT variant rule. Each entry: `{name: string, bonus: number}`. Flat per-skill bonus (PB is added on top by the roll handler, no ability/PB scaling otherwise).

| Method | Purpose |
|---|---|
| `getLoreSkills()` | Returns the array (may be empty) |
| `setLoreSkillBonus(name, bonus)` | Upsert; bonus floored at 0 |
| `removeLoreSkill(name)` | Delete by name |

Gated by the standard TGTT settings flag — non-TGTT characters never render the section.

### Linked tool-check custom skills

A custom skill may carry `toolCheck: {tool, toolKey, skill}`. This stores identity,
not copied mechanics:

- `getEffectiveSkillProficiency()` derives 1× PB from current tool proficiency, or
  2× PB when Tool Expertise is active.
- `hasToolSkillAdvantage()` grants advantage only while both the linked tool and
  linked skill are currently proficient.
- `_rollSkillCheck()` merges the custom skill, underlying ability check, and
  `tool:<toolKey>` modifier pools by stable contribution identity.

This keeps saved combinations such as `Thieves' Tools + Investigation` live:
removing a proficiency or its granting Specialty immediately removes the
corresponding proficiency, advantage, or bonus die without a migration.

### `settings.skipConditionalPrompt`

When `true`, the conditional-modifier picker is suppressed and no conditional modifiers auto-apply. Roll handlers still aggregate non-conditional modifiers normally. Toggled from the dice settings dropdown.

## Modifier Aggregation API

`aggregateModifiers(type, {appliedConditionalIds?} = {})` is the canonical entry point for combining all bonuses of a given `type` (e.g. `"save:dex"`, `"skill:perception"`, `"ac"`).

### Return shape

```javascript
{
    bonus,                  // Combined numeric bonus (deterministic)
    advantage,              // True if any non-conditional source grants advantage
    disadvantage,           // True if any non-conditional source grants disadvantage
    minimum,                // Floor (e.g. Silver Tongue "minimum 10")
    maximum,                // Cap
    bonusDice,              // Compatibility array of die expressions
    bonusDiceContributions, // Stable {id, dice, source, conditional} entries
    conditionalsAvailable: [ // Surfaced for the pre-roll picker
        {id, name, sourceName, conditional, advantage?, disadvantage?, bonus?, bonusDie?, target?},
    ],
}
```

`name` preserves the stored modifier identity used by stable conditional IDs.
`sourceName` is display-only: prose-parsed modifiers append `: <condition>` to
their stored name, and this field removes only that exact suffix so prompts and
roll results can say `Advantage from Dauntless Heritage against being
frightened` without changing save compatibility.

Roll handlers merge `bonusDiceContributions` by `id`, not by die text. Two
different features which each grant `d10` therefore stack, while one logical
modifier reached through both a skill and its underlying ability is rolled once.
On load, feature prose is re-parsed for bonus-die metadata so saves created before
`bonusDie` and canonical tool names were persisted are repaired in place.

### `appliedConditionalIds`

A `Set<string>` of conditional modifier IDs (from `_buildConditionalModId`) that the caller has opted in. Only those are folded into `bonus` / `advantage` / `disadvantage`; the rest still surface in `conditionalsAvailable` for inspection. **Default is empty** — conditionals are gated off by default to prevent the "Dauntless Heritage applies to every save" class of bug.

`getAdvantageState(type, opts)` and `getModifierBonus(type, opts)` forward `opts` unchanged.

### Registration vocabulary vs. query vocabulary

A modifier is **registered** with one string (`modType`) and **read** with another (the roll type a caller passes). These are different vocabularies, and `getModifiersForType` is the only thing that connects them:

| Registered | Read from | Connected by |
|---|---|---|
| `check:dex` | `skill:stealth` | the skill's ability |
| `save:advantage:frightened` | `save:wis` | `_isConditionalSaveSubtype` → synthesized conditional |
| `check:advantage:perception` | `skill:perception` | `_normalizeSkillKey` name match |
| `skill:might` | `skill:might` | exact custom-skill selector match |
| `skill:perception:senses` | `skill:perception` | exact selector + trailing conditional qualifier |
| `d20:all` | any d20 roll | explicit category list |

**A registration with no path is silent.** It parses, stores, renders in the feature list, and never reaches a roll. `check:advantage:perception` (Keen Senses) and `check:advantage:stealth` (Synchronized Stealth) sat in exactly that state: the ability branch compares sub-types against `"wis"`/`"dex"`, and `_isConditionalSaveSubtype` deliberately excludes standard skill names because a skill is a *selector*, not a condition. Both rules are correct in isolation; together they left skill-selected modifiers with no route at all.

The selector rule applies equally to built-in and custom skills. A modifier
registered as `skill:might` affects Might only; it must never be synthesized as
an `against might` condition on Athletics, Acrobatics, or another skill. Skill
conditions are represented separately as `skill:<target>:<qualifier>` or with
an explicit `conditional` field. Save/check registry sub-types retain their
category-wide synthesized-condition behavior.

Two consequences worth carrying:

- **Never test a modifier by querying its own registration string.** `aggregateModifiers("check:advantage:stealth")` exact-matches by construction, so it passes whether or not any roll can reach the modifier. Query the roll type the feature actually affects (`skill:stealth`). The tautological form of this test existed and passed for the entire life of the bug — see `CharacterSheetBeastheartFeatures.test.js`, where both variants now sit side by side.
- **Assert reachability per type, not per category.** `check:*` had a home the whole time; `check:advantage:perception` reached it through nothing. `CharacterSheetModifierReachability.test.js` walks all 18 standard skills so the next skill-selected modifier cannot be born dead.

`_normalizeSkillKey` is the single spelling rule shared by the match branch and `_isConditionalSaveSubtype`. Routing both through it is what stops a two-word skill (`"Animal Handling"`) from being a selector to one and a condition to the other.

### The consumption manifest

`EFFECT_HANDLING` (materials) exists because an effect nothing consumes is invisible rather than loud. Feature modifiers now have the equivalent: `MODIFIER_CONSUMERS` in `CharacterSheetModifierReachability.test.js` classifies **every** registered `modType`.

| Class | Count | Meaning |
|---|---|---|
| `roll` | 42 | Reachable from at least one roll query via `getModifiersForType`. |
| `named` | 6 | Read by a dedicated consumer (`carryCapacity`, `ac:mediumArmorMaxDex`, `armor:medium:noStealthDisadvantage`, `reach:melee:bonus`, `reroll:1:attack`, `ranged:noDisdvantageInMelee`). |
| `reference` | 26 | Deliberately **not** delivered — shown to the player, adjudicated by the DM. Ignoring cover, ritual casting, charge riders and the like depend on positional or narrative state the sheet does not model. |

Four guards keep it honest, and each RED-verifies independently:

- every registered type is classified (a new registration fails until someone decides what it is);
- nothing is declared that is no longer registered;
- every `roll` type is *behaviourally* reachable — probed, not asserted;
- every `reference` type is genuinely **not** reachable.

That last one is the load-bearing one. Without it, a failure could be silenced by downgrading a type to `reference`, which is how a bug becomes a documented feature. **`reference` is a decision that has to be recorded, not an absence that can be reached by neglect.**

The extractor deliberately skips comment lines: the JSDoc for the modifier shape carries a `modType: "ac|attack|damage|..."` placeholder, and an extractor that cannot tell documentation from registration reports a type that does not exist.

---

*Previous: [Components Reference](./03-components-reference.md) | Next: [Feature Calculations](./05-feature-calculations.md)*


## Chained Fury target effects

`settings.chainedFuryTargetTracking` is read with strict `=== true`, so both new
characters and older saves with no key start with tracking off. Spectral Chains
attacks and every on-hit rider remain available in that mode; the sheet shows
the live save DC and player-facing rule reminder without creating a target
record.

When the player opts in, the rider form records only a creature name and
explicit failed/succeeded save outcomes. Missing outcomes never imply failure.
Only successful grapples consume one of the two chains (four from Barbarian
level 14); ordinary shove, resisted saves, and the removed target-only route do
not persist records. Chain Imprisonment keeps its separate
`8 + PB + CON` Strength save and recurring force-damage reminder.

Legacy size, distance, movement, and shove-position fields remain load-compatible
but are not authored or rendered by the current flow. Disabling tracking,
ending Rage or Manifest Chains, unequipping/removing the generated chain item,
losing the subclass, reducing capacity, or serializing an invalid state removes
stale Chained Fury records and resets legacy movement bookkeeping.
