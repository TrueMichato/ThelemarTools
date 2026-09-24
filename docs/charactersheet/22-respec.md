# Respec Workspace

The Respec tab is a transaction-based progression editor. It reconstructs the
opportunities a character should have received at each level, including choices
which were skipped or never recorded, and applies changes only after the entire
draft is valid.

## Architecture

Three layers divide discovery, mutation, and presentation:

| Layer | File | Responsibility |
|---|---|---|
| Progression contract | `charactersheet-progression.js` | Builds the level-by-level decision manifest, assigns stable semantic keys, normalizes legacy history, validates selections, and projects decisions back to compatibility `choices`. |
| Transaction engine | `charactersheet-respec-engine.js` | Clones the live state, owns the candidate manifest, validates the draft, computes the review summary, applies atomically, rolls back failed saves, and retains one undo snapshot. |
| Workspace UI | `charactersheet-respec.js` | Renders the timeline and attention states, opens decision editors, performs candidate-only mechanics, and exposes Cancel, Review, Apply, and Undo. |

The live `CharacterSheetState` is never used as the editing surface. Opening
Respec creates a candidate from `state.toJson()`. All controls target that
candidate until Apply succeeds. An untouched candidate refreshes if the live
character changes before editing begins; a dirty candidate is never replaced
silently.

Feature-companion setup follows the same isolation rule. Subclass replacement
runs `reconcileFeatureCompanionGrants({reason: "respecCandidate"})` against the
candidate only. A legal exact-owner setup and companion retain their stable
identity; a compatible EFA/TCE Battle Smith change uses
`rebindFeatureOwnedCompanion()`; losing the exact grant marks the candidate
companion inactive with lifecycle status `vanished` and leaves its setup
record inactive rather than deleting either. Atomic Apply reruns the same
idempotent reconciliation on the newly loaded live candidate before save.
Cancel therefore cannot deactivate, rebind, or otherwise mutate the live
companion.

## Progression Manifest and Ledger

`levelHistory` remains the chronological source of class assignment, but each
entry now carries a versioned `decisions` ledger in addition to the compatibility
`choices` object.

Each decision records:

- its character level and class level;
- the decision family and source feature;
- the required selection count;
- the current selection;
- one of `resolved`, `deferred`, `missing`, `invalid`, or `ambiguous`;
- a semantic key which excludes character level.
- graph provenance (`parentSemanticKey`, `rootSemanticKey`, acquisition key,
  selected grant identity, depth, and source path);
- a compact receipt for source ownership and reversible scalar/configuration
  effects.

Excluding character level from the semantic key is intentional. If the order of
two class levels changes, a choice follows the class-level opportunity which
created it instead of remaining attached to the old character-level row.

The manifest is rebuilt from the loaded class, subclass, optional-feature, feat,
spell, and skill catalogs. A required opportunity appears even when the old
history has no corresponding property. This is how skipped skills, tools,
languages, expertise, spell picks, subclasses, ASIs, feats, and other deferred
choices become repairable.

Most legal option catalogs exist only on the in-memory manifest. They are
re-derived when Respec opens and are not serialized into `levelHistory`,
preventing full spell, feat, and feature entities from inflating character
saves. Compatibility choices which are seeded directly from acquired feature
prose may retain a compact string option list until a generic descriptor owns
their discovery; they never persist full catalog entities.

### Nested decisions

Feature, feat, optional-feature, species, and background descriptors are
discovered recursively. A selected parent grant becomes the parent node for
its child decisions, so paths such as `Divine Order → Thaumaturge → cantrip`
and `Lessons of the First Ones → feat → feat choice` remain linked rather than
becoming unrelated level rows. The graph uses stable acquisition and semantic
identities, a bounded recursion depth, and visited tuples to detect cycles.
Only the selected branch is expanded; legal catalogs are still transient.

Origin decisions live in `characterBase.decisions` and use `base:` semantic
keys. They are not stored in the level-1 class row, which means changing or
removing the first class level cannot orphan species/background choices.
Legacy level-1 origin copies remain readable and are migrated to the base node
without losing user selections.

Background ability alternatives are represented as a required distribution
parent with weighted ability children. For example, the 2024 `+2/+1` and
`+1/+1/+1` alternatives are one mode opportunity, not two independent ability
choices. Selecting a mode creates only its required children; changing the
mode removes the previous children and reverses only their receipt-owned bonus
deltas. Legacy saves without `backgroundUserChoices.selectedAbilityBonuses`
remain explicitly incomplete instead of inferring ownership from aggregate
ability bonuses, and the Base card links to the existing background editor to
complete the missing history.

Fixed species/background feats are also origin child decisions, even though
the player does not choose them. Their semantic key is derived from the origin
entity and feat UID, and the materialized feat plus its modifiers/resources
are recorded in the decision receipt. Legacy saves adopt an existing exact
feat in place rather than adding a duplicate; the feat is marked with its
origin owner and remains at character level 0. If a later level opportunity
also records the same non-repeatable feat, both opportunities remain visible:
the fixed origin grant stays resolved, while the later selection is invalid
until the player chooses another legal feat. The later editor excludes feats
already granted by another documented owner, and replacement removes only
artifacts owned by that level decision, preserving the origin feat and its
exact modifiers/resources. This ownership does not infer a level for unrelated
orphan feats.

Mechanically present feats with no explicit origin, class-feature, or level
owner are preserved as **unplaced feat** records on the Character Base card.
Their stable semantic key is derived from the feat UID, while the record keeps
the existing feat ID, recorded subchoices, unknown subchoice fields, and an
exact materialized receipt. They have no acquisition level and are not matched
to an open ASI/feat opportunity by name. An unplaced feat with exactly one
ability-choice family exposes that choice as a stable child of the Character
Base record. Legacy recorded evidence adopts the feat's exact canonical
ability delta without changing the candidate score; replacement reverses only
that delta and preserves the parent-owned feat, modifiers, resources, ID, and
null-level provenance. Missing evidence remains a required incomplete choice
rather than being inferred.

The ability/proficiency/expertise shape used by Skill Expert is also supported
as three stable children of one unplaced feat record. Candidate adoption uses
the recorded feat choices to claim only the feat-owned +1, gained proficiency,
and expertise. The expertise catalog is recalculated from the candidate's
proficiencies after every staged skill change; a now-illegal expertise choice
remains visible as invalid and blocks Apply until repaired. Existing
independent proficiency or expertise sources are marked preserved, so replacing
the feat's selection cannot remove them. Other multi-family feat shapes and
their dependency rules remain separate transactions.

Manifest discovery must be complete before it replaces the saved ledger. If
class data is temporarily unavailable, Respec may report the discovery error,
but it preserves the existing decisions and `manifestComplete` state rather
than treating an empty degraded manifest as authoritative.

Every decision family must be registered in
`CharacterSheetProgression.DECISION_ADAPTERS`. The adapter declares its
discovery source, editor, validation contract, mechanics handler, and
compatibility projection. Manifest construction rejects an unregistered type,
so adding a new progression choice cannot silently create a read-only Respec
row.

The descriptor census also runs over production class/feature/feat data. A
required choice shape which cannot be classified or whose legal catalog is
missing blocks ledger replacement and is shown as an actionable Respec
diagnostic. A degraded catalog never silently replaces a saved ledger with an
empty one.

The executable adapter closure is checked against the loaded Respec and State
prototypes, including the concrete editor and family-specific apply/reverse
entry points. A module which is not loaded cannot make the closure check pass
vacuously.

### EFA Artificer Replicate Magic Item plans

Exact `Artificer|EFA` Replicate Magic Item plans are normal progression
decisions, not inventory entries. `charactersheet-artificer-plans.js` parses the
authoritative feature tables from `data/class/class-artificer.json`:

- fixed `{@item ...}` rows use the tag's canonical `name|source` identity;
  display aliases do not change identity;
- the starred level-2 common-item, level-10 uncommon-Wondrous-Item, and level-14
  rare-Wondrous-Item rows are repeatable wildcard categories;
- every wildcard pick still binds one exact source-qualified item, and that
  exact item cannot occupy another known-plan slot;
- stable acquisition slots are created at Artificer levels 2/6/10/14/18 for
  cumulative totals 4/5/6/7/8;
- an optional replacement opportunity exists at every Artificer level from
  level 2 onward. It records the target slot, previous plan, next plan, and
  prior replacement semantic key.

The decision types are `artificerPlan` and `artificerPlanReplacement`. Their
compatibility projections are `choices.artificerPlans[]` and
`choices.artificerPlanReplacements[]`. Each persisted receipt uses
`family: "artificer-plan"` and contains the opportunity, exact owner,
`decisionLevel`, acquisition-only `acquisitionLevel`, replacement-only
`replacementLevel`, stable slot, source-qualified plan selection, and
replacement lineage. Its only effect is a `configuration` receipt; Respec
apply/reverse is intentionally inventory-free.

Builder's higher-level handoff, Level Up, Quick Build, and Respec all use
`CharacterSheetArtificerPlanPicker`. The picker keeps edits local until
validation succeeds, supports search and fixed/wildcard filtering, disables
duplicate exact items, shows source/eligibility badges, and presents the old
and new plan together before a replacement commit. Cancel and invalid commit
paths do not change live or candidate state. The current target plan is also
disabled with an accessible explanation: choosing it is not a replacement, so
the player must use **Keep Current Plans** for the non-mutating path.

Legacy plan evidence with no exact source-qualified catalog identity is
preserved as `ambiguous` and remains repairable in Respec. It is never guessed
from a display name. `CharacterSheetState.getEfaArtificerPlanDecisions()`,
`getEfaArtificerPlanProjection()`, and `getEfaArtificerPlans()` expose the
ledger and current stable-slot projection for later consumers. These APIs
include only decisions owned by exact `Artificer|EFA`: at least one complete
top-level or `meta.owner` class pair must be exact, and every supplied class
name/source field across both locations must agree. Subclass and feature source
fields remain independent for mixed-source extensions.

This milestone stops at plan decisions. It does not create, grant, mutate,
remove, or expire replicated inventory items; those item-instance effects are
reserved for the separate M3 transaction layer.

Pending feature/spell queues remain compatibility caches, not a second ledger.
An item which existed when a draft opened but is not yet represented by a
decision is preserved and shown as a warning. A mutation which creates a new
unrepresented pending item is rejected and rolled back immediately. Once a
queue item has a source decision key, removing that decision consumes only the
matching queue item.

### Structured feature-choice replacement

Permanent structured feature options use
`CharacterSheetClassUtils.replaceStructuredFeatureChoice()` as their shared
mutation boundary. The transaction removes the exact prior materialized
feature and its owned effects, applies the replacement, updates
`chosenSubfeatures`, and rewrites both `choices.featureChoices` and its replay
snapshot. Acquisition flows may run it before the level-history row exists;
Respec supplies the existing decision and performs the call inside
`stageGraphMutation()`, which writes the replacement receipt and rolls the
candidate back on failure. A future rules-driven switch flow can use the same
transaction with history persistence and canonical synchronization instead of
maintaining a second model-specific state path.

Fixed-proficiency fallback features ("gain X; if already proficient, choose
Y") expose their pending/resolved transaction as a normal `nestedTool`
decision. The descriptor carries the full feature/class/subclass source UID,
an exact acquisition key, and the subclass decision parent. Respec replacement
updates the transaction, pending queue, fulfillment marker, progression
ownership, and feature grant ledger atomically. It never matches by feature
label, and removing or replacing one owner preserves the same tool proficiency
when another exact owner or preserved source still requires it.

## Legacy Reconstruction

Old saves are normalized on load.

- Exact recorded history becomes a resolved decision.
- A uniquely reconstructable state value may be attached to its opportunity.
- A legacy known caster with materialized class spells but no recorded
  acquisition choices receives one current-repertoire decision for leveled
  spells and one for cantrips. Respec does not fabricate acquisition levels
  from the final spell list. Each cumulative decision owns its exact set so a
  replacement removes only that class decision's old spell.
- Recorded acquisition or replacement history still produces level-specific
  decisions and is validated against the spell level available at that level.
- A pre-manifest character with no tracked class spells or cantrips is treated
  as having left spell tracking unused. Its historical spell-acquisition rows
  remain explicitly deferred instead of blocking an unrelated Respec. The
  deferred marker is persisted so reopening Respec remains stable.
- Uncertain values remain `ambiguous`; Respec does not invent a historical
  choice.
- Values with no recorded progression source are preserved rather than removed.

The compatibility `choices` object is regenerated from decisions so existing
level removal, summary, and replay code continues to operate while modules
migrate to the ledger. Choice families which a manifest version does not
rediscover are retained rather than erased.

Legacy detection is structural: a character is legacy only when chronological
level rows are missing. Missing or ambiguous decisions are Respec validation
states, not evidence that a recorded level never existed.

## Ownership and Overlap

Progression-controlled proficiencies and spells use
`state.progressionOwnership`. Each value can have multiple decision sources, and
unattributed imported/manual values are marked `preserved`.

When an editor changes a choice, it detaches only that decision's source. The
mechanical value is removed only when no other progression source or preserved
origin remains. This prevents changing a class skill, tool, language, expertise,
or spell from deleting the same value when a species, background, feature,
another class level, or manual edit still supplies it.

Skill proficiency state and skill-choice ownership use one persisted identity:
lowercase with whitespace removed. Display labels such as `Animal Handling`
remain in decision selections and receipts, while proficiency/expertise
mechanics, ownership lookup, reversal, and reconciliation resolve them as
`animalhandling`. Load merges legacy whitespace aliases in skill-specific
stores, keeps the highest proficiency level, unions owners, and preserves
meaningful custom skill punctuation.

Conditional feature-granted tool choices use the same rule. EFA Artillerist
**Tools of the Trade** records a `nestedTool` decision only when the character
already had Woodcarver's Tools at acquisition time. The pending choice carries
the full `Tools of the Trade|Artificer|EFA|Artillerist|EFA|3|EFA` UID, persists
the original legal artisan-tool options, and claims progression ownership for
the selected replacement. Respec therefore removes only the old decision-owned
tool and preserves an overlapping manual, origin, or class grant.

Materialized feature/resource rows carry their decision provenance where the
feature path can provide it. Descendant teardown runs deepest-first and also
clears chosen-subfeature records, resources, active states, and once-per-turn
resource usage through the normal state removal APIs. Runtime uses are not
treated as progression ownership and are not recreated by a manifest refresh.

Subclass replacement treats an explicit `subclassSource` as authoritative.
Legacy source-less subclass features are removable only when their class,
subclass name, and entity source exactly identify the outgoing subclass.
Weaker legacy provenance blocks the candidate change with a repair diagnostic
instead of leaving a stale feature or guessing ownership; explicit rows owned
by another source remain untouched.

## Historical Class Changes

Every level has a Class decision. Changing it rebuilds the candidate's:

- class totals and chronological primary class;
- first-class and multiclass proficiencies;
- class and subclass features;
- hit dice, hit points, spell slots, and class resources;
- later decision opportunities.

Choices are retained by semantic key when still legal. Choices whose opportunity
disappears are removed from the ledger, and choices which no longer satisfy the
new option set become `invalid`. Entering a new class also checks multiclass
prerequisites against the ability scores which existed at that historical level,
before later recorded ASIs.

Starting equipment and ordinary inventory are not reconstructed by a class
change. Inventory, notes, identity, layout, favorites, custom data, and other
non-progression state remain attached to the candidate.

Generated `class_summon` companions are also runtime state, not progression
decisions. The candidate receives the live state's runtime-only authoritative
template catalog before its snapshot is loaded. Class reconstruction defers
summon reconciliation until the complete class set has been rebuilt, avoiding
false retirement while `_data.classes` is temporarily empty or partial. The
finished candidate then reconciles exact owner source, subclass, level, slot,
HP, and duration normally; a staged EFA↔TCE change therefore retires only the
candidate's EFA cannon.

## Improvements and Feats

ASI and feat opportunities are derived from the loaded class data instead of a
universal level table. PHB classes retain their normal level-19 ASI-or-feat
choice. XPHB and TGTT classes which declare an `Epic Boon` feat progression at
level 19 receive a feat-only opportunity:

- Epic Boons are listed first as the recommended choice;
- another feat remains legal when its prerequisites are satisfied;
- a legacy level-19 ASI is marked invalid and must be repaired;
- the editor can move both directions between ASI and feat when the opportunity
  genuinely permits both.

Fallback discovery from `classFeatures` accepts canonical four-part UIDs and
source-qualified five-part UIDs. It validates the referenced class name and
class source against the containing class before treating the feature as an
improvement, so a wrong-source or malformed reference cannot create an Epic
Boon opportunity.

Feat prerequisites are evaluated against the candidate for level, ability
scores, spellcasting, race, background, armor/weapon proficiency, prior feats,
feat categories, and named features. Campaign-specific or free-text special
prerequisites are withheld instead of being assumed legal.

Applying a feat records an exact effect receipt: capped ability deltas,
proficiency transitions, added saves/tools/languages/spells, and immunities.
Replacing that feat reverses the receipt before applying the new feat. Old saves
which predate receipts still use the conservative legacy reversal path; fixed
or overlapping grants from those old feats may require manual review when they
are replaced.

Feat sub-choice controls in Respec run against the isolated candidate state.
The selected ability and other sub-choices are stored on the candidate feat,
and its exact effect receipt is committed atomically with the resolved
progression decision.

Changing a parent choice is a staged graph transaction: the candidate snapshot
is captured, descendants are reversed/removed deepest-first, the parent
mechanics are applied, the manifest is rediscovered, and only exact child
identities which remain legal are retained. Any failure restores both the
candidate state and the manifest snapshot.

All legacy editors use the same engine-level candidate snapshot boundary. Their
mechanics callback runs inside the staged mutation; no controller mutates the
candidate first and then asks the engine to record the selection. This includes
feat/ASI replacement, class reassignment, spell repair, optional-feature
replacement, and deferred pending-choice edits.

Non-Epic-Boon `featProgression` grants, such as Fighting Styles, are also
manifest decisions. A skipped grant can be created later, and replacements use
the same prerequisite, nested-choice, add-feat, receipt, and rollback
transaction as ordinary feats.

## Historical Optional Features

Optional-feature slots are reconstructed from the progression curve itself, not
from the character's final feature count. Progression values are treated as
cumulative totals, and the manifest emits the delta at each class level. For
example, a Jester progression which rises from two Acts to three creates one
level-specific choice even if the final save contains only the original two.

The editor targets the manifest decision ID and selection, so it can create a
missing Metamagic, Invocation, Jester's Act, maneuver, or similar slot without a
pre-existing sparse-history array entry.

## Apply, Cancel, and Undo

- **Cancel** discards the candidate without touching the live character.
- **Review** lists staged decision/base changes and all blocking decisions.
- **Apply** validates first, loads the candidate into the live state, persists it,
  and rolls back the live snapshot if persistence fails. If another sheet tab
  changed the live character after the draft opened, Apply refuses to overwrite
  those newer changes.
- **Undo** restores the snapshot from immediately before the last successful
  Apply. Starting another edit consumes that undo opportunity.

Re-selecting an unchanged skill is a clean no-op only when its canonical
proficiency/expertise, decision ownership, resolved status, and receipt are all
already complete. The guard runs before descendant reversal, so it neither
dirties the draft nor consumes Undo. Missing mechanics, ownership, or receipts
fall through the normal transaction and are repaired.

Because generated-summon ownership and revision state is part of the serialized
candidate, Apply commits its reconciled runtime result atomically and Undo
restores the pre-Apply summon. Candidate retirement never mutates the live
character before Apply.

Apply is disabled while any required decision is missing, invalid, or ambiguous,
or while an optional decision contains an invalid/ambiguous selection.
Rows are indented by graph depth and expose resolved, deferred, missing,
invalid, and ambiguous status. Review lists discovery/catalog diagnostics as
well as decision errors; unsupported required shapes and missing non-class
catalogs are blocking rather than silently dropped.

## Spell Decisions

Permanent spell acquisition is progression-owned:

- Wizard cantrips and spellbook additions;
- known-caster spell and cantrip gains;
- permanent prepared-spell progression used by supported 2024/homebrew classes;
- Spell Mastery and Signature Spells;
- optional known-spell replacements.

Wizard daily preparation and other freely replaceable runtime loadouts are not
progression decisions. Legal spell options are filtered by class/subclass list
and by the maximum spell level available at the acquisition level.

Modern saves and legacy saves with genuine acquisition evidence retain
level-specific decisions. A legacy known caster whose save contains only the
final repertoire instead gets a stable cumulative editor at the current class
level. The editor validates the complete set, applies source-owned set
differences, and round-trips through Apply, reload, Cancel, and one-step Undo.
For a 2024 Bard at level 10 or later, the leveled-spell opportunity also admits
the Cleric, Druid, and Wizard lists granted by Magical Secrets. Cantrips keep
their own list rules.

If real level-specific choices are missing, Review groups unresolved spell
decisions into one repair item. The spell-repair flow prevents assigning the
same permanent spell to two levels and keeps partially completed work in the
candidate when the player chooses **Finish later**. A historical spell which is
no longer legal remains visible and selected until the player removes it; the
repair cannot finish while such a selection remains, and replacing it preserves
every still-legal spell in the repertoire. Pre-manifest characters
which never used class spell tracking retain empty spell rows as deferred; they
are not forced to invent twenty levels of historical spell picks before
applying an unrelated change.

## Tests

Focused Jest contracts live in:

- `CharacterSheetProgressionManifest.test.js`
- `CharacterSheetRespecBardSpells.test.js`
- `CharacterSheetRespecEngine.test.js`
- `CharacterSheetRespecSkillMechanics.test.js`
- `CharacterSheetRespecWorkspace.test.js`
- the existing `CharacterSheetRespec*.test.js` regression suites

`test/e2e/specs/respec-workspace.spec.ts` exercises a skipped first-level choice
through the rendered UI and verifies candidate isolation, Cancel, Apply, Undo,
and the narrow-screen toolbar.

The shared descriptor census has a production-data regression and a
real-path negative-control test: temporarily disabling the descriptor function
must make the census fail, and the test restores the production function before
continuing. Focused graph tests cover recursive discovery, origin persistence,
legacy reconstruction, ownership overlap, and staged rollback.

## Nested graph contract

Every permanent child acquisition is a compact decision node linked to its
parent and root by semantic key. The node records scope, depth, acquisition
and source provenance, selected-grant identity, occurrence, pick slot, and a
source-keyed receipt. Legal catalogs are recomputed transiently; they are never
stored in the ledger. Origin nodes are stored under `characterBase.decisions`,
while class and subclass nodes remain in their level-history entry.

Conditional fixed proficiency grants capture their duplicate facts before any
fixed grant is applied. EFA Alchemist `Tools of the Trade` records whether
`Alchemist's Supplies|XPHB` and `Herbalism Kit|XPHB` were already owned, gives
both fixed tools under the feature's source receipt, and creates exactly zero,
one, or two replacement Artisan's Tool opportunities from that acquisition-time
snapshot. Replacement selections are canonical tool-name arrays even for one
pick; two-pick decisions require distinct legal values. Fixed and replacement
sources reverse independently, preserving any pre-existing proficiency.
Removing and replaying the subclass recomputes the duplicate snapshot from the
candidate state rather than reusing stale counts.

The descriptor census covers structured options, unions, recurring pools,
object and string spell filters, `featProgression`, and reviewed prose
fallbacks. Runtime-only data is classified separately from supported
progression data; unsupported required persisted payloads remain visible and
block Apply rather than becoming inert rows.

Changing a parent is one candidate graph transaction. Descendants are reversed
deepest-first, the parent and its mechanics are applied inside the candidate
snapshot, and legal compatible children retain their exact semantic identity.
Feature, modifier, spell, resource, and configuration effects carry the source
decision receipt. Ownership claims preserve overlapping race/background/manual
grants and remove only orphaned progression-owned values. Source-identical
resources retain spent uses (clamped to the new maximum); same-named resources
from different sources do not share uses. Triggered pools such as Cruel restore
their stable-key `turnReceipts` entry across a same-owner rebuild and prune that
exact owner/source receipt when removed.

The nested editor is rendered inline in the level editor rather than opening a
second modal. Rows expose graph depth and resolved/deferred/missing/invalid/
ambiguous status, and Review lists actionable discovery diagnostics. The
candidate remains isolated until Apply; Cancel, failed-save rollback, reload,
and one-step Undo operate on the same serialized snapshot.

The current `npm run test:data` and `npm run test:tags` failures are unrelated
repository data baselines in `data/crafting.json` and
`data/bestiary/monstergroups.json`: the validators report unresolved links in
those files, including COMCRAF, HHHVI, TGTT, and Arcadia references. The
commands are still run as required gates; these pre-existing links are
documented here rather than silenced or changed as part of the Character Sheet
Respec scope.

## Iteration 3 implementation and verification

The nested ledger is now the canonical representation for supported permanent
child acquisitions. Builder, Level Up, Quick Build, deferred feature choices,
and spell-picking persistence call the same `syncCanonicalDecisions()` path,
which writes the shared decision schema and compatibility projections rather
than creating flow-specific choice records. Origin decisions remain in
`characterBase.decisions`; level decisions remain in their class-history rows.

Legacy reconstruction is ordered and conservative: exact decisions, feat
choice/effect evidence, chosen subfeatures, materialized provenance, replay
snapshots, spell provenance, and compatibility values are considered before
unique inference. Fulfilled markers prove only that a required obligation
existed, so they leave a missing repair item instead of inventing a selection.
Ambiguous or illegal evidence remains visible as `ambiguous` or `invalid`.
Pre-existing wholly-untracked class spell progressions retain the legacy
`legacyUntracked` deferred policy.

Each staged graph edit snapshots candidate JSON and the manifest, removes
descendants deepest-first, reverses source-keyed receipts/ownership, applies
the replacement, rediscovers children, retains only exact legal identities,
and persists one refreshed manifest. Receipt reversal covers set ownership,
features, modifiers, resources, spells, scalar ability changes, and reversible
configuration. Resource cleanup also prunes exact stable-key `turnReceipts`;
same-source resources preserve current uses and current-turn receipt state while
unrelated same-name resources do not inherit either.

The census now rejects reachable required `choose`/`options` nodes which do not
produce a legal descriptor or an explicit reviewed runtime/non-Respec
classification. Adapter closure is checked with the executable Respec and State
prototypes loaded, and the production census includes a negative-control
mutation which must fail before restoring the real descriptor path.

The focused browser suite targets Divine Order → Thaumaturge by identity,
checks the cantrip mechanic in the isolated candidate, and covers the existing
Cancel/Apply/reload and 390×844 action contract. The focused and full Character
Sheet Jest suites, JavaScript/CSS/JSON gates, and production census pass.
The fresh-port TGTT `RUN_MEGA=1` matrix is still in progress for this
iteration; its final result must be recorded before any closure claim.

`npm run test:data` and `npm run test:tags` remain red for the pre-existing
generated-link baseline in `data/crafting.json` and
`data/bestiary/monstergroups.json` (including COMCRAF, HHHVI, TGTT, and
Arcadia references). No source-data or schema suppression was added; fixing
those unrelated links is outside this Respec change and is recorded as an
explicit repository baseline rather than hidden.
