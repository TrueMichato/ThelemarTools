# ADR 0015: Versioned Campaign Hub rules policy

Status: Accepted; source/species/edition policy and carry/encumbrance-tier settings enforcement implemented; other non-content settings remain advisory

## Context

The Hub already has two distinct version concepts:

- `hub.rules_versions` stores immutable campaign rules with a campaign-local `version`, a
  `schema_version`, and a JSON rules document. A campaign points at one active version.
- `HubCampaignContext.pActivate()` loads the active rules version and brew bundle before a campaign page
  loads its character or DM data. `HubBrewContext` installs the brew as a temporary, cache-keyed overlay so
  campaign content never replaces personal brew.

ADR 0013 owns the site-wide campaign-context activation and teardown lifecycle. This ADR specializes that
lifecycle for policy pinning, evaluation, compliance reports, and policy-derived candidate caches; it does not
create an independent context lifecycle.

Historical rules documents use schema version 1. The Hub reads those versions through the compatibility
adapter. New publications use schema version 2, whose three content rules embed content-policy version 1.
`server/src/campaign-content.js` still normalizes the six established settings (`enableTgtt`,
`exhaustionRules`, carry weight, jumping, linguistics, and critical rolls), and the Character Sheet projects
those settings through `CharacterSheetState.setCampaignSettingsOverlay()`. The overlay is effective at runtime,
cannot be changed by the character while active, and is removed by `toJson()`.

The settings projection is not a full non-content rules engine. Source/species/edition policy is enforced by
the separate shared content evaluator and authoritative store adapters. The shared evaluator additionally
enforces the carry-weight/encumbrance-tier settings subset and its policy-fenced carry writes; the remaining
TGTT/exhaustion/jumping/linguistics/critical-rolls projections remain advisory:

- `CharacterSheetBuilder`, `CharacterSheetLevelUp`, and `CharacterSheetQuickBuild` already use
  `CharacterSheetPage.filterByAllowedSources()` at many candidate-picking surfaces, but a UI filter is not an
  authorization boundary.
- `CharacterSheetState` owns TGTT and edition-sensitive calculations. Those calculations must not be copied
  into a second Hub rules implementation.
- Character documents can predate a campaign policy, arrive through import/copy/move, or remain open while a
  DM activates a different rules version.
- Some out-of-source entities are intrinsic grants rather than player choices. For example, the spell picker
  restores spells explicitly granted by a selected subclass after source filtering.
- Existing characters are full documents. Automatically deleting their race/species, class, feature, spell,
  or item data would corrupt the character and violate the local-first model.

The words "rule", "setting", "note", and "enforced" therefore have the stable contract below. The three content
rules have completed their implementation gates via the shared content evaluator.
`hub-campaign-rule-evaluator.js` implements its closed, data-only settings subset and additionally promotes
`tgtt.carry-weight` and `tgtt.encumbrance-tiers` to **Enforced** on their proven surfaces. The remaining
TGTT/exhaustion/jumping/linguistics/critical-rolls settings remain truthfully **Advisory**.

## Decision

Campaign policy is an immutable policy instance pinned to a versioned, structured rule catalog. A rule
definition and a campaign's parameter values are separate:

- The **catalog** says what a rule means, which parameters it accepts, where it can run, whether those
  surfaces are implemented, and which data/protocol versions are compatible.
- A **policy instance** selects catalog rules and supplies parameters. It is stored in `rules_versions.rules`.
- An **informational note** explains a table convention but never participates in filtering, compliance, or
  blocking.
- A **compliance report** is the only evaluator output consumed by UI or server policy gates.

The catalog, policy envelope, and report are closed schemas: unknown fields fail validation at authoritative
write boundaries. Human-facing explanations may improve in a later catalog version, but an existing
`id` plus `schemaVersion` pair never changes meaning.

### Rule catalog contract

Every catalog entry has exactly these normative fields:

| Field | Contract |
|---|---|
| `id` | Stable, globally unique, lowercase dotted identifier. Never reused for different semantics. |
| `schemaVersion` | Positive integer version of this rule's parameters and evaluation semantics. |
| `title` | Short user-facing name. |
| `explanation` | User-facing meaning, scope, and consequence of the rule. |
| `parameters` | Closed JSON Schema for the parameter object. Defaults are explicit in the schema/catalog. |
| `supportedSurfaces` | Enumerated surfaces on which the rule can be evaluated or enforced. |
| `implementationStatus` | Per-surface status plus a derived aggregate status. |
| `compatibility` | Supported policy, character, content, client protocol, dependencies, and conflicts. |

The surface vocabulary is:

| Surface | Meaning |
|---|---|
| `characterOpen` | Report a loaded/imported/moved character without changing it. |
| `builder` | Filter and validate creation choices. |
| `levelUp` | Filter and validate choices added by one level. |
| `quickBuild` | Filter and validate all choices added by a batch build. |
| `respec` | Validate replacement choices while preserving untouched history. |
| `contentFilter` | Project eligible candidates into pickers and lists; never authoritative by itself. |
| `characterWrite` | Authoritatively validate a new character or a policy-sensitive document delta. |
| `hubAdmin` | Validate policy creation/activation and preview campaign impact. |

Each `implementationStatus` surface value is one of:

- `planned`: no compatible implementation exists;
- `advisory`: evaluation/reporting exists, but the surface must not block;
- `implemented`: the surface has passed the acceptance gates for that rule schema;
- `retired`: accepted only for reading historical versions and rollback.

The aggregate status is the least-capable required surface. A rule may be displayed as **Enforced** only when
all of its required enforcement surfaces are `implemented`, the server supports the rule, and the active
policy selects `mode: "enforced"`. A partially implemented rule is labeled **Advisory** or **Unavailable**,
never Enforced. The source, species, edition, carry-weight, and encumbrance-tier entries are enforced; the
remaining catalog entries are advisory projections.

Catalog entries with `kind: "note"` are prohibited. Notes use the separate policy `notes` collection below,
have no `mode`, and can never produce a violation. This keeps descriptive table guidance distinct from rules.

### Policy envelope

The target structured policy is rules schema version 2:

```json
{
  "schemaVersion": 2,
  "catalogVersion": 1,
  "rules": [
    {
      "id": "content.sources.allowed",
      "ruleSchemaVersion": 1,
      "mode": "enforced",
      "parameters": {
        "sources": ["PHB", "XPHB", "TGTT"]
      }
    }
  ],
  "notes": [
    {
      "id": "campaign.rest-variant",
      "title": "Rest pacing",
      "explanation": "The DM normally calls for long rests only in safe locations."
    }
  ]
}
```

`rules_versions.schema_version` and the envelope's `schemaVersion` must agree. `version` remains the
campaign-local immutable revision number assigned by the Hub store. `catalogVersion` pins the definitions used
to create, preview, activate, and evaluate the policy. The server retains every catalog version needed by an
active or rollback-eligible rules version.

A selected rule records `ruleSchemaVersion`; it does not silently float to the newest definition. Changing
parameters, upgrading a rule schema, changing modes, or editing notes creates a new `rules_versions` row.

### Initial catalog

The catalog defines these stable IDs:

| Rule ID | Parameters | Required surfaces | Compatibility intent |
|---|---|---|---|
| `content.sources.allowed` | `sources`: unique source abbreviations; empty means all available | builder, levelUp, quickBuild, respec, contentFilter, characterWrite, hubAdmin | Entity/source resolver and active brew manifest must understand every source. |
| `content.species.allowed` | `species`: unique case-insensitive `name\|source` UIDs; empty means all available | builder, respec, contentFilter, characterWrite, hubAdmin | Applies to race/species and subrace identities through one canonical resolver. |
| `content.editions.allowed` | `editions`: non-empty subset of `["2014", "2024"]` | builder, levelUp, quickBuild, respec, contentFilter, characterWrite, hubAdmin | Uses canonical entity edition metadata; unknown edition is not guessed at the UI boundary. |
| `tgtt.enabled` | `enabled`: boolean | characterOpen, builder, levelUp, quickBuild, respec, contentFilter, characterWrite, hubAdmin | Projects to `settings.enableTgtt`; content permission remains a separate source rule. |
| `rules.exhaustion.system` | `system`: one of `2014`, `2024`, `thelemar` | characterOpen, characterWrite, hubAdmin | Projects to `settings.exhaustionRules`; `thelemar` declares a dependency on `tgtt.enabled`. |
| `tgtt.carry-weight` | `enabled`: boolean | characterOpen, characterWrite, hubAdmin | Projects to `settings.thelemar_carryWeight`. |
| `tgtt.encumbrance-tiers` | `enabled`: boolean | characterOpen, characterWrite, hubAdmin | Projects to `settings.thelemar_encumbranceTiers`; declares a dependency on `tgtt.carry-weight`. A house extension, since TGTT defines no encumbrance tiers. |
| `tgtt.jumping` | `enabled`: boolean | characterOpen, characterWrite, hubAdmin | Projects to `settings.thelemar_jumping`. |
| `tgtt.linguistics-bonus` | `enabled`: boolean | characterOpen, characterWrite, hubAdmin | Projects to `settings.thelemar_linguisticsBonus`. |
| `tgtt.critical-rolls` | `enabled`: boolean | characterOpen, characterWrite, hubAdmin | Projects to `settings.thelemar_criticalRolls`. |

An omitted source/species rule or an empty source/species list means no additional restriction among content
available to the campaign. The edition rule is always a non-empty `["2014"]`, `["2024"]`, or
`["2014", "2024"]`, displayed as 2014-only, 2024-only, or mixed. Unknown IDs and unresolvable edition/identity
metadata fail publication or a newly governed choice rather than being guessed.

Source IDs are case-insensitive after canonicalization. `PHB14`/`PHB2014`, `DMG14`/`DMG2014`, and
`MM14`/`MM2014` canonicalize to `PHB`, `DMG`, and `MM`; their 2024 counterparts canonicalize to `XPHB`,
`XDMG`, and `XMM`. TGTT edition aliases canonicalize to `TGTT-2014` or `TGTT-2024`. Repository-bundled
content listed by the local `homebrew/index.json`, plus generated character-facing crafting data, is part of
the versioned site catalog. Any other homebrew source is available only when it is in the active immutable
campaign brew bundle, and it is permitted only when its canonical source is also allowed. Personal brew that
is neither bundled site content nor in that campaign bundle never widens campaign policy.

Species identity is the canonical case-insensitive `name|source` UID. Merged subraces use the parent source;
named subraces/variants remain distinct, and unnamed runtime bases normalize to the generated `(Base)` identity
(for example, `Human (Base)|PHB`).

### Composition and precedence

Rules compose in this order:

1. Server safety, tenancy, schema, lease, revision, and authorization invariants always win.
2. The active immutable campaign policy is the maximum permission boundary for campaign-owned choices.
3. Content source, species, and edition restrictions intersect. Passing one never bypasses another.
4. `tgtt.enabled: false` disables TGTT mechanics and TGTT-only choice behavior even if `TGTT` is an allowed
   source. Allowing the source makes content available; it does not enable mechanics.
5. TGTT subrules are inert while `tgtt.enabled` is false. Contradictory enforced combinations, such as
   Thelemar exhaustion with TGTT disabled, fail policy activation through catalog `compatibility`.
6. A character's personal `allowedSources` and priority-source settings may hide additional candidates, but
   can never widen campaign policy. Display preferences remain character-owned when no campaign rule maps to
   them.

Campaign brew availability does not imply policy permission. Campaign sources participate in
`content.sources.allowed` by their canonical source abbreviation. Conversely, a permitted source does not
make absent content available. Brew bundle shape/security validation and authoritative content-catalog validation
run before a bundle is stored. Activation repeats both checks inside the store transaction so a historical bundle
which has become incompatible cannot change the active pointer or produce an audit, event, outbox row, or receipt.
Merged campaign catalogs use case-insensitive source indexes and a bounded content-hash cache, so repeated context
reads and writes do not synchronously re-walk the active immutable bundle.

Intrinsic dependencies and automatic grants retain provenance in reports, but client-supplied provenance is
never an authorization bypass. The complete newly introduced delta must comply. Candidate projections may keep
an intrinsic grant visible while editing, but the authoritative character write still rejects a disallowed or
unclassifiable introduced identity.

TGTT calculations remain in `CharacterSheetState` and its existing feature/effect helpers. The policy layer
only selects effective settings, candidate eligibility, and compliance. It must not implement carry capacity,
jump distance, exhaustion penalties, Linguistics bonuses, critical-roll behavior, or class feature effects a
second time.

### Grandfathering and enforcement

Policy evaluates both the complete character and the current operation:

| Operation | Required behavior |
|---|---|
| Open/play an existing character | Evaluate the full document, show visible flags, and keep play controls available. |
| Activate a stricter policy | Recompute reports; never rewrite character documents. |
| Import, copy, attach, or cross-campaign move | Treat the whole document as a new destination admission and reject disallowed or unknown content. |
| Existing character already attached to this campaign | Keep it playable, report current violations, and evaluate only identities added beyond the prior document. |
| Create a new build | Every policy-governed initial choice must comply before authoritative creation. |
| Level up | Only choices introduced or replaced by the level-up must comply; pre-existing violations remain grandfathered. |
| Quick Build | Every choice introduced by the batch must comply; pre-existing violations remain grandfathered. |
| Respec | Every replacement choice must comply; untouched noncompliant history remains grandfathered. |
| Routine play mutation | HP, resources, notes, conditions, and quantity/equipment/container changes to an already-admitted item identity remain writable despite grandfathered violations, subject to normal invariants. |

Existing noncompliant characters remain playable and are visibly flagged. "Playable" includes ordinary rolls,
rests, resource use, damage/healing, notes, and other state changes that do not introduce a governed choice.
The flag must identify the relevant rule and entity; a generic red badge is insufficient.

New builds, level-ups, Quick Builds, respec replacements, and any other newly selected governed content must
comply. Candidate lists should hide or disable invalid options with an explanation, but the final commit is
validated again. A stale, bypassed, or incomplete browser filter cannot create a valid write.

An import command whose `(owner, campaign, clientImportId)` already names an active character is an exact replay:
after authorization and import-key locking it returns that existing character without evaluating the discarded
incoming document against a newer policy. Reactivating an archived import is a new admission and must satisfy the
current content policy and version fence.

Content is never auto-removed. No policy activation or evaluation may delete or replace a species/race, class,
subclass, feat, feature, spell, item, language, or stored choice. Remediation is an explicit user action. The
system may offer rebuild/respec guidance, but it does not mutate until the player confirms a supported flow.

### Inventory and item-identity boundary

Policy sensitivity follows item identity, not the name of the route or the shape of the storage mutation.
An item identity is the canonical content identity used by the item catalog (normally `name|source`, together
with edition when the resolved entity declares one) plus provenance needed to distinguish a campaign-brew
entity/version. Quantity, currency value, equipment/attunement state, and container position do not create a
new content identity.

An **already-admitted character content identity** is one present in that character's prior authoritative
document. The evaluator compares canonical `kind + uid` multiplicity; mutable provenance fields cannot create a
grandfather exception.

The boundaries are:

- Changing quantity, equipped/attuned state, or container placement for an already-admitted identity may remain
  a routine mutation, subject to inventory, lease, revision, ownership, and recalculation invariants.
- The custom-item editor blocks a newly unknown campaign identity before local state changes. Editing an existing
  item preserves its source identity; an unchanged grandfathered identity remains editable, while renaming an
  off-policy custom identity remains a new blocked choice. Custom backgrounds follow the same pre-mutation gate,
  and prose-only equipment-pack entries inherit the pack source rather than inventing a personal source.
- Introducing a new item identity is a governed delta. This includes direct character document patches, DM
  grants/awards, accepted transfers into characters, import adjuncts, batch commands, and stale or bypassed
  clients. It must satisfy the current source/edition policy.
- A character import, campaign attach/move, or whole-document admission may grandfather its existing item
  identities only through the explicit compatibility/admission flow. Adding another item to that admitted
  document later is not covered by the document's age.
- DM grants/awards and accepted transfers into characters cannot rely on picker or catalog filtering. Their
  server transaction pins/rechecks the active rules version and evaluates every introduced identity before the
  destination, audit, event, outbox, or receipt write commits. Awarding more quantity into an existing
  grandfathered stack is an existing-stack mutation, not a synthetic second identity, in both stores.
- Reserving a transfer out of a character remains an allowed removal. Reject/cancel restores the exact escrow
  to its source without a content-policy pin. A later accepted transfer from a party stash into a character is
  a new destination delta and does not launder a grandfathered identity.
- A stale policy pin returns `RULES_VERSION_STALE` before destination inventory state changes. Batch grants/awards and
  multi-item transfers are all-or-none: one blocked, unknown, stale, or malformed item rejects the entire
  policy-sensitive batch, so no subset of item identities is added.

Compliance reports for grandfathered inventory violations include the canonical item identity, rule, edition,
provenance classification, and `grandfathered` disposition. Reports never expose character names or private
document details through campaign events or member summaries.

### Shared evaluator boundary

The evaluator is a pure, data-only module usable by browser and server. It accepts normalized inputs and
returns a compliance report; it performs no fetches, DOM work, storage writes, toasts, or mutation.

Its adapters provide:

- the pinned catalog and active policy;
- canonical entity facts (`uid`, `source`, `edition`, entity kind, and grant provenance);
- the prior and candidate normalized character choice projections;
- the operation surface and policy version pin;
- the active brew bundle hash/manifest needed for content identity.

The browser uses the evaluator for previews, candidate projection, explanations, and pre-submit checks.
`filterByAllowedSources()` and future edition/species filters are projections of evaluator results, not separate
rule implementations.

The server is authoritative for Hub writes. For a brand-new character it evaluates the complete governed
choice projection. For an existing character it compares the prior accepted document with the candidate and
evaluates newly introduced or replaced choices, including item identities hidden inside document patches.
Grant, award, transfer, and stash adapters project their transactional before/after state through the same item
identity classifier and evaluator. A routine patch with no policy-sensitive delta remains valid even when the
full character report contains grandfathered violations.

If a policy-sensitive delta cannot be classified safely, the server rejects that delta with a stable policy
error and a compliance report. It must not convert an evaluator failure into success. Unknown or unsupported
rules never get an Enforced label: existing play remains available, while new policy-sensitive choices require
a compatible client/server/catalog before they can commit.

Browser and server run the same rule fixtures as golden contract vectors. Equivalent normalized inputs must
produce equivalent `status`, violations, dispositions, and blocking result. The server may append authority
metadata, but it may not use a weaker rule implementation.

### Compliance report

Character reports return this deterministic bounded version-1 shape:

```json
{
  "version": 1,
  "rulesVersionId": "rules-version-uuid",
  "total": 1,
  "findings": [
    {
      "ruleId": "content.sources.allowed",
      "code": "CONTENT_SOURCE_NOT_ALLOWED",
      "disposition": "grandfathered",
      "provenance": "user_choice",
      "entity": {
        "uid": "Example Subclass|HBX",
        "source": "HBX",
        "edition": "2014",
        "kind": "subclass"
      }
    }
  ],
  "isTruncated": false
}
```

Findings are sorted by stable kind and UID, capped at ten on server summaries and six in the Character Sheet
warning. Mutation reports use `blocking`; loaded-character reports use `grandfathered`. The Character Sheet
turns each finding into actionable safe text explaining that the identity may be kept, used, or removed but
cannot be added again. The server exposes counts and rule IDs, not character names or authored document text.

### Version pinning and migration

Every campaign page pins the complete active tuple:

`campaignId + rulesVersion.id + rulesVersion.version + rulesVersion.schemaVersion + catalogVersion`

Policy-sensitive browser submissions include the pinned `rulesVersion.id`. The server evaluates against the
currently active version inside the authoritative transaction. If the pin is stale, it returns
`RULES_VERSION_STALE` with the current version; the browser refreshes candidate lists and
asks the user to review the affected choice. No destination item, accepted-transfer resolution, event, or
receipt in a policy-sensitive batch is partially committed. Transfer escrow already reserved by an earlier
proposal remains safely rejectable/restorable. Routine play mutations with no governed-choice delta are not
discarded solely because a DM changed policy during the request.
PostgreSQL admissions that also establish carry authority take the campaign write lock at their first policy read;
they never upgrade a shared campaign-row lock after another concurrent admission has acquired the same lock.

Rules schema version 1 remains readable. A one-way adapter maps its six keys to the stable TGTT catalog IDs for
projection/reporting. The adapter does not mutate historical `rules_versions` rows and does not claim source,
species, or edition enforcement that schema version 1 never represented.

Schema-version-2 policies published before carry-weight and encumbrance-tier enforcement remain readable with
their recorded `advisory` modes. Read-time normalization preserves those modes and never rewrites the immutable
row; the policy editor upgrades only its mutable publication draft and shows the mode change explicitly. New
publication requires the current enforced modes.

Structural changes create a new policy `schemaVersion`. Semantic or parameter changes to one rule create a new
`ruleSchemaVersion`. Catalog copy changes that do not alter semantics create a new `catalogVersion`. An
activation is refused if an enforced rule is unknown, incompatible, contradictory, or not implemented on all
required authoritative surfaces.

### Caching and context-switch teardown

An evaluator cache key includes at least:

`campaignId + rulesVersion.id + policy schemaVersion + catalogVersion + brew contentHash + evaluatorVersion + subject revision/fingerprint + surface`

Candidate caches additionally include normalized choice identity and the personal display-filter revision.
The rules version ID, not just its campaign-local integer, is the policy identity.

Changing campaign, rules version, brew version, character, character revision, evaluator version, or catalog
version invalidates affected entries. `HubCampaignContext` owns the activation lifetime. On deactivation or
switch it must:

1. abort in-flight context loads and policy previews;
2. clear `HubBrewContext` temporary brew;
3. clear the Character Sheet campaign settings projection;
4. clear evaluator, candidate-filter, and compliance-report caches;
5. dismiss or invalidate dialogs built under the old policy pin;
6. remove campaign-scoped subscriptions/listeners before activating the next context.

Late results carry their context generation and are ignored if it no longer matches. No campaign policy,
report, or brew-derived candidate may appear in another campaign or in local mode. Realtime DM refreshes route
through the owning `HubCampaignContext`, clear the temporary overlay before fetching, and require the exact
rules/brew identities announced by the event or resync cursor. Cursor comparisons use the context actually applied
to the Board, not concurrently fetched campaign metadata.

### Rollback

Rollback activates a previously stored immutable `rules_versions` row; it never edits or deletes the newer
row and never rewrites character data. Activation emits the existing audit/event/outbox evidence and invalidates
all policy caches. Open clients receive or discover the new active version, discard stale candidate decisions,
and recompute compliance.

A deployment rollback is permitted only while the deployed server can read every active policy schema and
catalog version. New schemas/catalogs must be deployed in read-compatible mode before activation. Draft choices
created under a rolled-back version are re-evaluated before commit.

## Acceptance gates

No catalog entry may move to aggregate `implemented`, and no UI may call it Enforced, until all applicable
gates pass:

- **AG-01 Catalog:** unique stable IDs; closed parameter schemas; rule/catalog version fixtures; dependency and
  contradiction validation.
- **AG-02 Migration:** schema version 1 adapter fixtures; immutable historical rows; unsupported future schema
  behavior; read-compatible deploy and rollback proof.
- **AG-03 Evaluator parity:** browser/server golden vectors cover compliant, blocking, grandfathered,
  advisory, unknown, intrinsic grant, contradictory, admitted-item, and newly-introduced-item cases across
  direct patch, grant/award, transfer, and party-stash projections.
- **AG-04 Character preservation:** policy activation, context switch, rejected import/attach/copy/move, and
  rollback never auto-remove content or persist campaign projections into character JSON; rejected/cancelled
  transfer escrow restores exactly to its source.
- **AG-05 Existing play:** a noncompliant existing character is visibly flagged and can perform routine play
  mutations, including allowed changes to an admitted item, without weakening authorization, lease, revision,
  inventory, provenance, or schema checks.
- **AG-06 Choice surfaces:** Builder, Level Up, Quick Build, and supported Respec paths filter/explain invalid
  candidates and revalidate the final delta.
- **AG-07 Server authority:** new-character and policy-sensitive write tests prove browser bypass, stale policy
  pins, malformed reports, and unknown enforced rules cannot commit; cross-route parity covers direct character
  patch, DM grant/award, transfer, and stash flows, including all-or-none multi-item batches.
- **AG-08 TGTT composition:** campaign precedence, personal fallback, master/subrule dependencies, transient
  projection, and existing `CharacterSheetState` calculations are covered without duplicate formulas.
- **AG-09 Lifecycle/cache:** rapid campaign/rules/brew/character switches prove abort, generation fencing,
  listener teardown, and no cross-context cache leakage.
- **AG-10 Product evidence:** accessible labels distinguish Enforced, Advisory, Unavailable, grandfathered
  violations, and informational notes; telemetry/audit evidence identifies rule and version without character
  secrets.

The PR implementing a rule must name the gates it satisfies and link browser, server, migration, and surface
tests. Documentation or a UI filter alone is never implementation evidence.

## Consequences

- Campaign rules become explainable, version-pinned data rather than a growing bag of booleans.
- Existing characters and local mode remain safe from destructive policy changes.
- Browser filtering improves UX, while the server remains authoritative for online policy-sensitive writes.
- The same evaluator can serve Builder, Level Up, Quick Build, Respec, Hub previews, and server deltas.
- Rule rollout is slower because enforcement requires parity and surface-completeness evidence.
- The Hub must retain compatible catalogs/adapters for active and rollback-eligible policy versions.

## Rejected alternatives

- **Treat the existing settings object as enforcement:** it has no stable rule metadata, surface status,
  compatibility, or authoritative delta semantics.
- **Use content filters as authority:** filters can be stale, bypassed, or incomplete and cannot protect API
  writes.
- **Reject every save from a noncompliant character:** this would make grandfathered characters unplayable and
  block unrelated HP/resource changes.
- **Automatically remove forbidden content:** destructive, hard to reverse, and incompatible with full
  character documents.
- **Copy TGTT calculations into the evaluator/server:** creates divergent rules math and breaks
  `CharacterSheetState` as the calculation source of truth.
- **Float policies to the newest catalog/rule schema:** changes campaign behavior without a new immutable rules
  version and makes rollback non-deterministic.
