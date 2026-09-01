# ADR 0015: Versioned Campaign Hub rules policy

Status: Accepted as the target contract; rules engine not implemented

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

The current rules document is schema version 1. `server/src/campaign-content.js` normalizes six settings
(`enableTgtt`, `exhaustionRules`, carry weight, jumping, linguistics, and critical rolls), and the Character
Sheet projects those settings through `CharacterSheetState.setCampaignSettingsOverlay()`. The overlay is
effective at runtime, cannot be changed by the character while active, and is removed by `toJson()`.

This is useful policy projection, but it is not an enforcement engine:

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

The words "rule", "setting", "note", and "enforced" therefore need a stable contract before implementation.
This ADR defines that contract. It does not add a rules evaluator, new blocking behavior, or new labels to the
product.

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
never Enforced. The catalog entries introduced by this ADR remain `planned`; this document is not
implementation evidence.

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

The first policy implementation must define these stable IDs. All are `planned` until their acceptance gates
pass:

| Rule ID | Parameters | Required surfaces | Compatibility intent |
|---|---|---|---|
| `content.sources.allowed` | `sources`: unique source abbreviations; non-empty when present | builder, levelUp, quickBuild, respec, contentFilter, characterWrite, hubAdmin | Entity/source resolver and active brew manifest must understand every source. |
| `content.species.allowed` | `species`: unique case-insensitive `name\|source` UIDs; non-empty when present | builder, respec, contentFilter, characterWrite, hubAdmin | Applies to race/species and subrace identities through one canonical resolver. |
| `content.editions.allowed` | `editions`: non-empty subset of `["2014", "2024"]` | builder, levelUp, quickBuild, respec, contentFilter, characterWrite, hubAdmin | Uses canonical entity edition metadata; unknown edition is not guessed at the UI boundary. |
| `tgtt.enabled` | `enabled`: boolean | characterOpen, builder, levelUp, quickBuild, respec, contentFilter, characterWrite, hubAdmin | Projects to `settings.enableTgtt`; content permission remains a separate source rule. |
| `rules.exhaustion.system` | `system`: one of `2014`, `2024`, `thelemar` | characterOpen, characterWrite, hubAdmin | Projects to `settings.exhaustionRules`; `thelemar` declares a dependency on `tgtt.enabled`. |
| `tgtt.carry-weight` | `enabled`: boolean | characterOpen, characterWrite, hubAdmin | Projects to `settings.thelemar_carryWeight`. |
| `tgtt.jumping` | `enabled`: boolean | characterOpen, characterWrite, hubAdmin | Projects to `settings.thelemar_jumping`. |
| `tgtt.linguistics-bonus` | `enabled`: boolean | characterOpen, characterWrite, hubAdmin | Projects to `settings.thelemar_linguisticsBonus`. |
| `tgtt.critical-rolls` | `enabled`: boolean | characterOpen, characterWrite, hubAdmin | Projects to `settings.thelemar_criticalRolls`. |

An omitted content rule means "no campaign restriction" for that dimension. An empty allowlist is invalid
rather than an accidental "allow nothing." Rule-specific compatibility declares whether an entity kind can be
evaluated; the evaluator returns `unknown` instead of inventing an edition or UID.

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
make absent content available.

Intrinsic dependencies and automatic grants are evaluated separately from user choices. A spell, feature, or
item reference automatically granted by an otherwise valid selected entity is retained as a dependency and is
reported with that provenance; it is not misclassified as a forbidden new pick. A user choosing that same
entity independently must satisfy the normal content rules. This preserves the existing subclass-granted spell
behavior without making source filters porous.

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
| Import, copy, attach, or move an existing character | Admit the intact document with a compatibility report; future choices use the destination policy. |
| Create a new build | Every policy-governed initial choice must comply before authoritative creation. |
| Level up | Only choices introduced or replaced by the level-up must comply; pre-existing violations remain grandfathered. |
| Quick Build | Every choice introduced by the batch must comply; pre-existing violations remain grandfathered. |
| Respec | Every replacement choice must comply; untouched noncompliant history remains grandfathered. |
| Routine play mutation | HP, resources, notes, conditions, inventory quantities, and other non-choice changes remain writable despite grandfathered violations. |

Existing noncompliant characters remain playable and are visibly flagged. "Playable" includes ordinary rolls,
rests, resource use, damage/healing, notes, and other state changes that do not introduce a governed choice.
The flag must identify the relevant rule and entity; a generic red badge is insufficient.

New builds, level-ups, Quick Builds, respec replacements, and any other newly selected governed content must
comply. Candidate lists should hide or disable invalid options with an explanation, but the final commit is
validated again. A stale, bypassed, or incomplete browser filter cannot create a valid write.

Content is never auto-removed. No policy activation or evaluation may delete or replace a species/race, class,
subclass, feat, feature, spell, item, language, or stored choice. Remediation is an explicit user action. The
system may offer rebuild/respec guidance, but it does not mutate until the player confirms a supported flow.

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
evaluates newly introduced or replaced choices. A routine patch with no policy-sensitive delta remains valid
even when the full character report contains grandfathered violations.

If a policy-sensitive delta cannot be classified safely, the server rejects that delta with a stable policy
error and a compliance report. It must not convert an evaluator failure into success. Unknown or unsupported
rules never get an Enforced label: existing play remains available, while new policy-sensitive choices require
a compatible client/server/catalog before they can commit.

Browser and server run the same rule fixtures as golden contract vectors. Equivalent normalized inputs must
produce equivalent `status`, violations, dispositions, and blocking result. The server may append authority
metadata, but it may not use a weaker rule implementation.

### Compliance report

Every evaluation returns this versioned shape:

```json
{
  "schemaVersion": 1,
  "evaluatorVersion": "1",
  "campaignId": "campaign-uuid",
  "rulesVersion": {
    "id": "rules-version-uuid",
    "version": 7,
    "schemaVersion": 2,
    "catalogVersion": 1
  },
  "subject": {
    "type": "character",
    "id": "character-uuid",
    "revision": 14
  },
  "surface": "levelUp",
  "status": "noncompliant",
  "blocking": true,
  "violations": [
    {
      "ruleId": "content.sources.allowed",
      "ruleSchemaVersion": 1,
      "code": "SOURCE_NOT_ALLOWED",
      "title": "Allowed sources",
      "disposition": "blocking",
      "path": "/classes/1/subclass",
      "entity": {
        "uid": "Example Subclass|HBX",
        "name": "Example Subclass",
        "source": "HBX",
        "edition": "2014"
      },
      "explanation": "HBX is not allowed for new campaign choices.",
      "remediation": "Choose a subclass from an allowed source."
    }
  ],
  "notes": [],
  "unknownRules": [],
  "inputFingerprint": "sha256:...",
  "evaluatedAt": "2026-09-01T12:00:00.000Z"
}
```

`status` is `compliant`, `noncompliant`, or `unknown`. Violation `disposition` is `blocking`,
`grandfathered`, or `advisory`. `blocking` is derived from the operation and dispositions, never set
independently by a caller. Informational `notes` are copied from the active policy and never appear in
`violations`. `unknownRules` contains IDs/schema versions the evaluator cannot safely interpret.

Paths identify normalized choice projections, not arbitrary renderer DOM paths. Explanations and remediation
are safe text from the catalog plus structured entity facts; campaign-authored HTML is not accepted.

### Version pinning and migration

Every campaign page pins the complete active tuple:

`campaignId + rulesVersion.id + rulesVersion.version + rulesVersion.schemaVersion + catalogVersion`

Policy-sensitive browser submissions include the pinned `rulesVersion.id`. The server evaluates against the
currently active version. If the pin is stale, it returns `POLICY_VERSION_STALE` with the current version and a
fresh report; the browser refreshes candidate lists and asks the user to review the affected choice. Routine
play mutations with no governed-choice delta are not discarded solely because a DM changed policy during the
request.

Rules schema version 1 remains readable. A one-way adapter maps its six keys to the stable TGTT catalog IDs for
projection/reporting. The adapter does not mutate historical `rules_versions` rows and does not claim source,
species, or edition enforcement that schema version 1 never represented.

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
report, or brew-derived candidate may appear in another campaign or in local mode.

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
  advisory, unknown, intrinsic grant, and contradictory cases.
- **AG-04 Character preservation:** policy activation, context switch, import, attach, copy, move, and rollback
  never auto-remove content or persist campaign projections into character JSON.
- **AG-05 Existing play:** a noncompliant existing character is visibly flagged and can perform routine play
  mutations without weakening authorization, lease, revision, or schema checks.
- **AG-06 Choice surfaces:** Builder, Level Up, Quick Build, and supported Respec paths filter/explain invalid
  candidates and revalidate the final delta.
- **AG-07 Server authority:** new-character and policy-sensitive write tests prove browser bypass, stale policy
  pins, malformed reports, and unknown enforced rules cannot commit.
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
