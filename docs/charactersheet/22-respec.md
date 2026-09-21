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

Legal option catalogs exist only on the in-memory manifest. They are re-derived
when Respec opens and are not serialized into `levelHistory`, preventing full
spell, feat, and feature entities from inflating character saves.

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

Pending feature/spell queues remain compatibility caches, not a second ledger.
An item which existed when a draft opened but is not yet represented by a
decision is preserved and shown as a warning. A mutation which creates a new
unrepresented pending item is rejected and rolled back immediately. Once a
queue item has a source decision key, removing that decision consumes only the
matching queue item.

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

Materialized feature/resource rows carry their decision provenance where the
feature path can provide it. Descendant teardown runs deepest-first and also
clears chosen-subfeature records, resources, active states, and once-per-turn
resource usage through the normal state removal APIs. Runtime uses are not
treated as progression ownership and are not recreated by a manifest refresh.

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
candidate when the player chooses **Finish later**. Pre-manifest characters
which never used class spell tracking retain empty spell rows as deferred; they
are not forced to invent twenty levels of historical spell picks before
applying an unrelated change.

## Tests

Focused Jest contracts live in:

- `CharacterSheetProgressionManifest.test.js`
- `CharacterSheetRespecBardSpells.test.js`
- `CharacterSheetRespecEngine.test.js`
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
from different sources do not share uses. Triggered pools such as Cruel clear
their `resourceTurnUsage` entries when removed.

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
configuration. Resource cleanup also removes stale `resourceTurnUsage` entries;
same-source resources preserve current uses while unrelated same-name resources
do not inherit them.

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
