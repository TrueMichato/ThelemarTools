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
minutes, payment metadata, optional creation-tool receipt, and instance
revision. The receipt is a stable reference to the equipped, positive-quantity,
proficient Smith's Tools or Woodcarver's Tools wrapper used at creation; legacy
records may omit it, and removing the tool later does not retire the cannon.
AC, maximum HP, immunities, and current attack/save/form calculations are
projected at read time from `data/objects.json` and the exact `Artificer|EFA`
owner level. Generated summons are never inventory items.

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
`pCreateEfaEldritchCannons()` validates one request or, at level 15, two
requests before spending anything. Two-cannon creation is available only when
both slots are empty. One Magic Action creates the batch; the free Long Rest
use pays for either one or both cannons, while spell-slot creation spends one
explicit normal/Pact slot per cannon after aggregating every requested pool.
`pCreateEfaEldritchCannon()` remains the compatible one-cannon delegate. The
callback-backed persistence commit is atomic: a failed save restores the full
pre-request state, including action economy, resource/slot counts, summon
revisions, and both companion records, then attempts to persist the rollback.
Resource-less Milestone 2 saves initialize the use as spent only when a
surviving exact-owner cannon records `createdWith: "freeUse"`; explicit
resources remain authoritative.

Base operation remains on dedicated EFA APIs:
`validateEfaEldritchCannonActivation()` /
`activateEfaEldritchCannon()` enforce the 60-foot owner range, optional
15-foot movement, form target ranges, and the canonical Bonus Action slot in
combat. Position, HP damage/healing, `mending`, Magic Action dismissal, and
explicit duration-ending each have source-specific methods. Protector applies
the ordinary temporary-HP replacement rule to self only; another creature's
rolled result is reported without mutating another character.

At level 15, `validateEfaEldritchCannonActivations()` /
`activateEfaEldritchCannons()` prevalidate both request/roll pairs and commit
both activations with one canonical Bonus Action. A failed request spends
nothing. Finishing a 60-minute Short Rest or 480-minute Long Rest retires every
active EFA cannon through the duration-expiry path; the Rest UI captures its
full snapshot before that mutation, so Undo restores records, HP, duration,
revision cursors, cover, and resources.

After surviving damage at level 9, an in-combat cannon within 60 feet may arm
one transient `pendingEfaCannonDetonation` trigger while the Reaction is
available. Decline clears it without spending or retiring anything.
`pDetonateEfaEldritchCannon()` spends the canonical Reaction, retires the exact
revision as `detonated`, and reports `3d10` force damage in a 20-foot radius
against the owner's spell-save DC (Dexterity, half on success). Its rollback
snapshot is intentionally post-damage: a persistence failure restores the
Reaction and damaged cannon without undoing the damage that created the
opportunity. Pending triggers are never trusted across load, reconciliation,
owner removal, new damage, or action-economy reset.

Cover is a reusable projection rather than an Artillerist AC special case.
`getCoverProjections()` gathers active cover effects and generated-cannon
sources; `getCoverProjection()` applies only the highest grade once while
retaining all equal-grade sources for AC/save breakdowns. Half Cover therefore
adds +2 AC and +2 Dexterity saves whether one or several sources apply. Smite of
Protection, Cover of Darkness, and EFA Shimmering Field Projection all use this
primitive. Only the EFA owner is mutated for cannon cover; allies within 10 feet
are reported by the Combat UI.

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

The XPHB level-3 Barbarian feature **Primal Knowledge** (also used by the
TGTT Barbarian) queues one skill proficiency from the owning class's
`startingProficiencies.skills.choose.from` list. The TGTT list includes
Endurance and Might; a PHB/TCE optional feature with the same name is
separate. The shared feature-choice picker excludes skills already proficient
and stores the chosen grant against the feature, so removing the feature
removes only that grant. A choice with no untrained skills remains pending
with a warning instead of silently claiming a new proficiency.

Class-feature reconciliation installs each resolved owner in the state class
catalog before restoring features, so an old save missing this feature can
queue the same source-correct choice even before the page's full
brew-merged catalog is available. It refreshes only the matching owner entry
and preserves other classes and editions in the catalog.

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

Both renderers open that transaction through
`CharacterSheetPage.pShowFeatureCompanionSetup()`. The setup modal uses native
required controls, focuses the first missing choice, announces validation,
defer, cancellation, and error outcomes, then restores focus to either the
still-pending setup button or the created companion after the shared render.
Play Mode suppresses the legacy summon route only for an exact EFA setup
record, so same-name TCE/RHW content is not captured.

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
Registry-backed operations require the descriptor's canonical runtime owner
and an exact source-qualified companion record; compact six-part or malformed
collisions never reach the resolver. The generic non-attack action set is Dash,
Disengage, Dodge, Help, Hide, Influence, Magic, Ready, Search, Study, and
Utilize. Attack remains available only through an explicitly registered
operation such as Force-Empowered Rend or Dreadful Swipe.

The interaction layer remains shared too:
`CharacterSheetPage.pUseCompanionOperation()` supplies both desktop and Play
Mode. Controls carry stable focus keys for post-render restoration, visible
disabled reasons are connected with `aria-describedby`, and a polite live
region reports cancellations and complete success summaries. Play Mode's
native owner-cost/Dodge/other-action controls still call the Page method; they
do not mutate State or maintain a second resource store. Mobile layouts stack
the setup and command controls, preserve 44px targets, and keep primary actions
above statblock details.

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

The Reanimated Companion R4b boundary adds source-exact State execution while
preserving the R3/R4a creation, lifecycle, and immutable generation choices.
The generic companion operation transaction now executes default Dodge and
Dreadful Swipe command rules, including Bonus Action/incapacitated autonomy,
critical dice, Improved Reanimation, and manual Swipe riders. Dedicated
source-safe State methods execute Lightning Absorption/damage-to-zero, one-shot
Death Burst target results, Gaunt, Moist, Arcane Conduit origin plus stable
per-generation turn receipt, and Life Transfer's Reaction/heal/death rollback.
Summoner death prevalidates every required Death Burst result before mutation,
then removes the companion only after that manual result is attached; omitted
or invalid target/save/roll input leaves the companion byte-stable. Runtime
range, save, damage, and trigger amounts accept only actual finite numbers, not
numeric strings, booleans, arrays, objects, null, or blank values.

All choice-dependent runtime rules resolve from the active companion's
persisted R4a setup receipt. Arcane receipts use M1E `turnId`, survive
save/load and `combatRound` changes, and reset only through
`resetTurnEconomy()`. Exact generation keys are removed on replacement,
dismissal/removal, source loss, and Respec Apply without pruning Battle Smith,
TCE, foreign, or malformed six-part collision state. R5b consumes these
boundaries in the Companions Manager and Play Mode; E2E/export behavior remains
outside that milestone.

R5a adds the descriptor-driven Companions-tab Manager foundation. Every
registry-backed feature companion is summarized from
`CharacterSheetCompanionRules` plus its detached `scaling.resolved` snapshot:
exact source-qualified identity, lifecycle state, AC/HP/Hit Dice,
movement/senses, immutable modifications, creation tool/payment provenance,
and read-only Action/Reaction availability. Owner, creature source, resolved
identity, and modification-receipt mismatches render as explicit invalid/setup
diagnostics; the UI never name-adopts a same-label or wrong-source record.
Registry companions without a dedicated safe operation UI model are
overview-only and never fall through to the legacy generic companion card's
direct HP, dismissal, or `usedAction` handlers. This is structural rather than
keyed to a transient runtime status: EFA/TCE Steel Defenders retain their
supported operation card, while RHW remains Manager-only before and after R4b.

When an executable companion runtime exists, Manager readiness reads the
canonical status returned by
`getCompanionOperationAvailability(id, "action", {actionKey: "dodge"})`.
Deferred R4a records fall back explicitly to legacy `turnUsage`;
inactive/dead/invalid lifecycle state remains unavailable. Canonical status
takes precedence over stale legacy flags, and `resetTurnEconomy()` restores the
displayed availability.

RHW creation remains a distinct R3 transaction. It does **not** use Battle
Smith's persisted `featureCompanionSetups` record or
`completeFeatureCompanionSetup()`. The Manager reads the live
`getFeatureCompanionCreationBoundary()` result and creates directly only when
tool, payment, and modification choices are deterministic. Otherwise one
atomic review modal contains:

- the boundary's equipped, proficient XPHB Artisan's Tool references;
- free creation versus available spell/pact slots;
- the exact versioned Strange/Macabre/Superior modification transaction;
- optional appearance text; and
- a final transaction review.

The R3 boundary deliberately excludes transient combat action economy. The
Manager therefore also reads the shared
`isActionTypeAvailable("action", {trackOnlyInCombat: true})` gate. A spent
Magic action renders an explicit unavailable state, disables the surface, and
prevents both modal opening and transaction dispatch. The modal repeats this
gate beside its final live boundary validation so a later turn-state change
cannot close the review or spend anything.

Confirmation re-reads the boundary with the completed payment and setup-choice
payload before calling `pCreateFeatureCompanion()`. Cancel, stale validation,
and transaction failure do not save or re-render and report through an ARIA
live region. `CharacterSheetModal` owns focus trapping and restoration.

R5b adds one source-exact live-operation route. Manager buttons and Play Mode
buttons both call `CharacterSheetPage.pUseFeatureCompanionOperation()`, which
owns prompts, manual confirmations, persistence, result publication, and focus
restoration. Its single Page-to-State call invokes
`pDispatchFeatureCompanionOperation()`; that dispatcher supplies the immutable
RHW class/subclass/feature identities and delegates to the accepted R4b
methods. It does not add formulas, usage flags, or a parallel receipt store.

The Operate surface includes default Dodge, commanded Dreadful Swipe, typed
damage and Lightning Absorption, Gaunt, Moist, Arcane Conduit, Life Transfer,
pending Death Burst resolution, and canonical dismissal. Labels, ranges,
save DCs, modification availability, damage dice, and manual-rider copy come
from the active generation's detached descriptor result. Action, companion
Reaction, owner Magic Action, owner Bonus Action, and owner Reaction readiness
come from canonical operation/action-economy queries. Only
`resetTurnEconomy()` resets the persisted turn receipts.

Arcane Conduit registers a temporary exact `Artificer|EFA` committed-spell
hook, then uses the normal spell-casting flow. After a committed evocation or
necromancy cast, the player chooses one resolved damage roll and confirms the
companion's range; the R4b method then updates that roll and commits the
generation-qualified once-per-turn receipt. Cancelling the rider does not
spend its receipt, and save/load preserves a committed receipt.

Exact RHW feature-owned records never receive Play Mode's legacy direct HP
input, Heal/Damage buttons, dismissal handler, or `turnUsage` controls. A
source/setup mismatch suppresses those handlers and renders an explicit
diagnostic instead of name-adopting the record. Valid RHW generations use a
read-only HP display plus the shared canonical controls. Destructive controls
use the established danger semantic in both Manager and Play Mode, and each
Play button disables itself with `aria-busy` while its canonical operation is
pending so repeated activation cannot stack prompts. Dead generations remain
reachable only while Death Burst needs resolution. The collector accepts an
explicit zero target count for an empty emanation, still rolls and validates the
canonical damage dice, and persists the resolved receipt with `targets: []`.
Existing EFA/TCE Battle Smith setup, operation, lifecycle, and legacy `active`
behavior remain unchanged. R5b does not add E2E/export work or R6 surfaces.

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
concurrent duplicate holder returns `use-in-progress`; reservations from every
holder count against the host storage's shared remaining uses, so the final use
cannot resolve twice. Cancellation or effect failure releases only that exact
reservation. When capacity permits, different holders may resolve in parallel.
After the core effect resolves with the stored Artificer statistics, the exact
item use and in-combat holder turn receipt commit. This is an item effect, not
a class spell cast, so it does not publish committed-cast hooks, consume a
slot/component, invoke the focus gate, or apply/consume cast-sensitive damage
or on-cast riders.

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

At exact level 15, Perfected Armor advances only the active generated row's
managed damage baseline (`2d6` Force Demolisher, `1d10` Thunder Pulse, `2d6`
Lightning Launcher). The same `_generatedItemBase` comparison moves or removes
the upgrade without replacing wrapper IDs, editable names, or player damage
overrides.

Guardian and Infiltrator each use a deterministic exact-owned Perfected Armor
resource ID. Both maxima are the Intelligence modifier (minimum 1), while
`metadata.efaPerfectedArmor.spentUses` preserves total expenditure across
Intelligence changes and model switches; Long Rest alone resets the spend.
Guardian validates the external save/pull context before the shared committed
Reaction transaction and returns adjacent melee follow-up descriptors after
commit. Infiltrator flight uses the shared active-state movement channel and
resolves twice the final live walking Speed without reapplying global movement
modifiers, then expires on `resetTurnEconomy()`. Lightning Launcher glimmer uses
opaque target IDs and the shared turn-receipt boundary to refresh a selected
existing target and expire on the canonical owner-turn reset. Its owner-only
disadvantage semantics remain distinct from Thunder Pulse's
disadvantage-against-others semantics.

Remaining Armorer work is limited to dedicated NPC/PDF export coverage and E2E
coverage. Level-9 Armor Replication uses the shared source-qualified
plan-extension and constrained generated-item-capacity contracts; it does not
add an Armorer-specific persisted ledger.
#### EFA Tinker's Magic and Magic Item Tinker

Base `Artificer|EFA` item operations reuse ordinary inventory rows and the generated-item
provenance system. They do not maintain a parallel feature ledger. The state API is:

```javascript
getEfaArtificerTinkerOptions();
previewEfaArtificerTinkerTransaction(request);
commitEfaArtificerTinkerTransaction(request);
reconcileEfaArtificerTinker({reason});
applyEfaArtificerTinkerLongRestTransition();
```

Tinker's Magic creates distinct generated rows owned by
`Tinker's Magic|Artificer|EFA|1` with independent `featureSource: "EFA"`.
It resolves one exact item from the published 31-item `XPHB` list and uses the
existing exact focus/proficiency pipeline for equipped `Tinker's Tools|XPHB`.
Charge, Drain, and Transmute target only active rows owned by the exact
`Replicate Magic Item|Artificer|EFA|2` owner.

Every operation is previewed before commit. Commit snapshots `_data`, consumes
combat action economy only when combat is active, mutates through normal APIs,
and restores the snapshot on failure. Charge carries an explicit
`slotPool: "ordinary" | "pact"` whenever ordinary and Pact Magic slots share a
level, dispatches through `useSpellSlot()` or `usePactSlot()`, and writes a
deterministic clamped `chargesCurrent`. Drain uses `removeItem()` plus an exact
named `spellSlots:<level>` modifier. Transmute uses normal remove/create paths,
projects slot-exempt attunement correctly, creates the replacement unattuned,
and then calls normal `attune()` so an attunement failure rolls back the entire
transaction. Container spill, item-effect teardown, capacity, attunement, and
save/export behavior therefore stay shared with the rest of Inventory.

The only additional persisted record is:

```javascript
efaArtificerTinker: {
    version: 1,
    tinkersMagicUsesSpent: 0,
    drainUsed: false,
    transmuteUsed: false,
    drainSlotLevel: null,
    drainSlotAvailable: false,
}
```

Older saves receive these defaults during load. Normalization rejects invalid
Drain levels; reconciliation removes invalid or source-lost exact M4 state
without touching unrelated items or modifiers. It recalculates a stale slot
maximum even when the exact Drain modifier is missing. The availability marker
tracks whether the temporary current slot remains: source/rest cleanup subtracts
it only while unspent, while an expended temporary slot preserves ordinary
class-slot current. All ordinary slot-current writes route through one mutation
helper with an explicit expenditure mode. `useSpellSlot()`, manual pips, normal
Spells-tab/Play Mode casts, feature-use conversions, slot-to-Stamina, and
slot-to-sorcery-points mark genuine downward expenditure and consume the
availability marker only at the Drain level. Recalculation, maximum clamping,
rest/recovery, refunds, progression, Drain cleanup, and slot creation use the
non-consuming mode; they neither spend nor re-arm the marker. Other slot levels
also leave it intact. A cast expenditure returns an ephemeral receipt recording
the slot maximum, per-level mutation revision, exact Drain modifier IDs, and
whether that spend cleared the marker. Target cancellation or a thrown
cast-result failure restores the numeric slot and marker only while that full
identity still matches. Source/level cleanup or any later same-level mutation
invalidates the receipt; a rejected receipt never falls back to incrementing
the live slot. Unrelated recovery/refund calls cannot re-arm it. Non-consuming maximum
recalculation also preserves `max(0, current - oldMax)` independently-created
above-max slots (such as Font of Magic), so adding/removing Drain changes only
Drain's own maximum and available slot.
Inventory and Combat Charge affordances use the canonical `chargeSlots` option
list, so a Pact-only slot remains usable. The idempotent
`applyEfaArtificerTinkerLongRestTransition()` runs from both `onLongRest()` and
the active Finish Long Rest controller after its undo snapshot. A committed
long rest therefore removes all exact-owner Tinker's creations, refills its
Intelligence-based use pool, removes the temporary Drain slot, and resets
Drain/Transmute use state through either entry point.

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

### Persisted monotonic game time

Character time is stored as non-negative whole in-game minutes:

```javascript
gameTime: {
    version: 1,
    minute: 0,
    lastLongRestMinute: 0,
}
```

This is never a wall-clock timestamp. Passive reads and rendering use
`getGameTimeMinutes()` and do not mutate state. The single normal mutation
boundary is:

```javascript
state.advanceGameTimeMinutes(minutes, {
    reason: "travel",
    identity: "journey-segment-7",
});
```

`minutes` must be a positive safe integer, and the optional second argument
must be a non-array object. Zero, negative, fractional, non-finite, or
non-number minute inputs return `invalid-game-time-minutes`; malformed option
bags return `invalid-game-time-options`. `advanceRestTime` applies the same
option-bag guard and returns `invalid-rest-time-options`. These failures do not
change the character. A successful receipt contains:

```javascript
{
    ok: true,
    code: "game-time-advanced",
    priorMinute,
    newMinute,
    deltaMinutes,
    reason,
    identity,
    receiptId,
    updated, // generated lifecycle rows whose derived display changed
    removed, // generated rows removed at their exact due minute
}
```

Clock advancement and registered generated-item teardown are one transaction.
If ordinary `removeItem()` cleanup throws, the full character snapshot is
restored and the API returns `game-time-advance-rolled-back`; callers must not
save or render a success state from that failure.

Compatibility APIs delegate to this same transaction:

- `advanceTime(hours)` accepts only positive hour values that convert exactly
  to whole minutes, then calls `advanceGameTimeMinutes(hours * 60, ...)`.
- `advanceGeneratedFeatureItemLifecycleDays(days)` validates positive whole
  days and delegates with `days * 1440`.
- `advanceRestTime(restType, {identity})` reads
  `getRestRequirements(restType).duration`; current effective durations are 60
  minutes for a short rest and 480 for a long rest.
- `onShortRest()`, `onLongRest()`, and the two confirmed rest dialogs consume
  `advanceRestTime`. Opening/cancelling a dialog does not advance time, and rest
  undo restores the pre-rest clock and lifecycle state from the existing full
  snapshot.

A completed long rest records `lastLongRestMinute` at the new clock minute, so
the 24-hour restriction is derived from the canonical clock rather than a
second elapsed-hours counter. The existing `lastLongRestTime` save field
migrates by converting its elapsed hours to whole minutes; saves with neither
field default idempotently to minute 0. `toJson()`/`loadFromJson()` and
`serialize()`/`deserialize()` preserve the same versioned shape.

Replicate Magic Item death expiry stores an absolute `assignedMinute` and
`expiryMinute`. `minutesRemaining` and the compatibility `daysRemaining`
display mirror are derived from the shared clock, with days calculated as
`ceil(minutesRemaining / 1440)`. Legacy records containing only
`daysRemaining` are anchored once at the clock minute on load, without rerolling
or moving that due minute on later loads. Migration first requires a valid
generated-item classification and the exact Replicate owner, including
`featureSource`; foreign and malformed lifecycle records remain byte-for-byte
unchanged. Exact checks can therefore distinguish `+59`, `+60`, and `+61`
minutes, while repeated partial rests and manual advances compose without
truncation.

**Residual duration limitation:** `getFeatureCalculations()` can expose
Warder's Duty's `longRestHours = 2`, but the current rest-duration API does not
consume that dormant calculation. This milestone intentionally preserves the
existing effective 480-minute long rest instead of activating unrelated
feature behavior.

---

### Transient zero-HP interventions and custom selection costs

`takeDamage()` only arms the generic `ZERO_HP_INTERVENTIONS` registry; it does
not branch on a class or feature. `_pendingZeroHpIntervention` stores the
trigger context while the character remains at 0 HP and is deliberately
removed by `toJson()`. Import/load never recreates a dismissed or stale prompt.

Relentless Rage uses this transaction without a use pool: its exact PHB/XPHB
class feature and Barbarian edition are checked before offering a CON save.
The trigger records whether Rage was active when damage dropped HP to zero;
the pending offer retains that fact until a save succeeds, fails, or is declined.
`relentlessRageAttempts` persists the number of committed save attempts since
the last short or long rest. The next DC is `10 + 5 * attempts`, including
failed saves; a declined offer spends nothing. PHB success returns to 1 HP,
XPHB and TGTT success to twice the Barbarian level. Failed/declined saves leave
HP at zero and end Rage along with other states that end on incapacitation.
Both the rest dialog and direct `onShortRest()` / `onLongRest()` APIs reset the
counter after a committed rest, including a short rest at full HP with no Hit
Dice left. Load migration removes only the old Relentless Rage feature use
counter and resource linked to that feature, not unrelated resource rows.

An intervention can publish a `selectionCost` descriptor. The shared
`inventoryRows` contract supplies exact generated-item ownership, allowed
rarities, lifecycle/expiry gates, minimum selections, display copy, and a
consume policy. `getZeroHpInterventions()` projects only currently eligible
rows for the generic damage modal, but the modal's list is advisory:
`applyZeroHpIntervention()` re-resolves every selected row immediately before
commit. Foreign, copied/ambiguous, stale-owner, inactive, expired, wrong-rarity,
missing, duplicate, or empty selections are rejected.

The consume-and-revive operation is atomic. It snapshots the complete live
character state, removes selected rows through ordinary `removeItem()`,
verifies every removal, and restores the snapshot if any teardown fails.
Only after all costs commit does it set HP, reset death saves/massive-death
state, and clear the pending intervention. Success therefore averts generated
item death-expiry finalization. Decline or invalid commit clears the transient
prompt and runs the existing death reconciliation, preserving M3B expiry when
the character is otherwise finalized dead.

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
`8 + PB + CON` Strength save and recurring force-damage reminder. The restrain
choice is resolved in the successful chain grapple, not by spending a separate
bonus action or leaving an active-state toggle behind. Older custom toggles
owned by the exact TGTT Chain Imprisonment feature are removed on load; foreign
same-named states and Rage/Manifest Chains are preserved.

Legacy size, distance, movement, and shove-position fields remain load-compatible
but are not authored or rendered by the current flow. Disabling tracking,
ending Rage or Manifest Chains, unequipping/removing the generated chain item,
losing the subclass, reducing capacity, or serializing an invalid state removes
stale Chained Fury records and resets legacy movement bookkeeping.
