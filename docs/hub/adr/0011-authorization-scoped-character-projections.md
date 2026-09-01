# ADR 0011: Authorization-scoped character projections with metadata-only invalidation

Status: Accepted as an architecture contract (2026-09-01)

Implementation: Shipped. Migration `0004` persists the policy, `HUB_PROTOCOL_VERSION` is `2`, and the
required memory/PostgreSQL evidence lives in `test/jest/hub/HubCharacterProjection.test.js`,
`HubProjectionPolicy.test.js`, `HubProjectionCanary.test.js` and `HubProjectionLifecycle.test.js`. Two
implementation notes refine, but do not alter, the contract below: `inventorySummary.entryCount` is the total
number of inventory entries while `publicItems` lists only entries an owner has explicitly marked shared, and
peer-facing owner attribution is served as campaign-roster metadata (a membership id, gated on peer-visible
identity) rather than as a catalog field.

## Context

The current projection boundary is spread across several implementation paths:

- `server/src/projections.js` copies a fixed allowlist from a character document into
  `projectCharacterForPlayer()`;
- the memory and PostgreSQL stores return owner/DM truth but that fixed projection to other members from
  `pGetCampaignSnapshot()`;
- character writes emit `character.projection.updated` with the projected character in the durable event
  payload;
- `server/src/realtime.js` sends that payload during live fanout and sends role-shaped character snapshots in
  `resync_complete`;
- `js/dmscreen/dmscreen-hub-controller.js` injects snapshot characters into Party Tracker, whose linked rows
  are read-only and deliberately excluded from the saved Board document.

That is a useful proof, but not an adequate long-term privacy contract. The fixed allowlist is not an owner
choice, its values are copied directly from truth without a typed view model, and the same projected payload is
persisted in the event log/outbox before the eventual recipient is known. New consumers could also infer hidden
state through target pickers, eligibility errors, inventory transfers, carry calculations, activity copy, or a
Party Tracker export even if the primary character card omits the field.

This decision refines ADR 0002. Canonical character documents remain ordinary revisioned documents; this ADR
defines what may leave that document boundary.

## Decision

### One projector, three authorization outcomes

Every character read is projected on the server after authenticating the session, resolving active campaign
membership, and checking character ownership. The checks are evaluated in this order:

| Requester | Response |
|---|---|
| Character owner | **Owner truth:** the authoritative character document plus its persisted sharing policy |
| DM or co-DM who is not the owner | **DM truth:** the authoritative character document plus the exact computed `peerPreview` |
| Any other active campaign member | **Peer profile:** the single computed peer-facing profile |

The owner result is not a peer result merely because the owner's campaign role is `player`. Conversely, a DM
does not receive another shape by pretending to be a peer; the response includes the peer preview beside truth
so the UI can show exactly what players and spectators see.

There is exactly one peer-facing profile per character revision and projection-policy revision. It is
recipient-independent: every non-owner, non-DM peer receives the same field values and omissions. Per-recipient
exceptions are rejected because they are difficult to explain, cache, revoke, and audit safely.

The peer envelope may contain only:

```json
{
  "kind": "peer_profile",
  "id": "character UUID",
  "campaignId": "campaign UUID",
  "revision": 12,
  "projectionRevision": 4,
  "data": {}
}
```

`ownerAccountId`, raw sharing configuration, internal item/resource identifiers, document paths, and omitted
truth are not peer fields. Character existence and the opaque character id are campaign-roster metadata; a
field-hidden character is not automatically targetable.

### Presets and overrides

The persisted policy is:

```json
{
  "version": 1,
  "preset": "table",
  "overrides": {
    "hp": {"mode": "replace", "value": {"state": "healthy"}},
    "inventorySummary": {"mode": "hide"}
  }
}
```

Version 1 defines four presets:

| Preset | Shared fields | Hidden fields |
|---|---|---|
| `table` | identity, species, classes, abilities, saves, skills, AC, HP, speed, senses, conditions, diseases, exhaustion | inventory summary, carry summary |
| `minimal` | identity, species, classes | every other catalog field |
| `open` | every catalog field | none |
| `private` | none | every catalog field |

`table` is the migration default because it most closely matches the current
`projectCharacterForPlayer()` allowlist while keeping the two new inventory-derived summaries closed.

An override key must name one field in the fixed catalog. Its mode is exactly one of:

- `share`: derive the typed field from current truth;
- `hide`: omit the field, including empty/default values;
- `replace`: emit the configured typed replacement verbatim and perform no truth-derived calculation for that
  field.

No arbitrary JSON Pointer, custom expression, nested field exception, role exception, or client-computed
projection is permitted. `replace` is a privacy feature, not a patch: for example, it can expose an HP state
such as `healthy` instead of current/max values, or an alias instead of the canonical identity.

### Fixed field catalog

Projection code converts the document into this versioned view model before applying policy. It never copies a
whole source object merely because its top-level key is allowed.

| Key | Type-validated peer value | Privacy boundary |
|---|---|---|
| `identity` | `{name: string, pronouns?: string, avatar?: SafeAssetRef}` | No account id, private notes, or unsafe URL |
| `species` | `EntityLabel \| null` | Display label only; no feature-choice state |
| `classes` | `Array<{name: string, source?: string, level: integer}>` | No hidden feature selections or resources |
| `abilities` | Six-key map of finite integer totals | No source/breakdown metadata |
| `saves` | Six-key map of `{modifier: integer, proficient: boolean}` | No conditional modifier sources |
| `skills` | Skill-key map of `{modifier: integer, rank: string}` | No private roll history or conditional sources |
| `ac` | `{value: non-negative integer}` | No formula, item, or effect source |
| `hp` | `{current?: number, max?: number, temp?: number, state?: string}` | Replacement may expose only a state label |
| `speed` | Movement-key map of non-negative finite numbers | No source/effect breakdown |
| `senses` | Array of `{name: string, range?: non-negative number}` | No source/effect breakdown |
| `conditions` | Array of sanitized display labels | No private condition notes or source ids |
| `diseases` | Array of sanitized display labels | No private disease notes or source ids |
| `exhaustion` | Non-negative integer or sanitized display state | No rule-source metadata |
| `inventorySummary` | `{entryCount: integer, publicItems: Array<{name: string, quantity: number}>}` | No item ids, notes, containers, currency, effects, or omitted items |
| `carrySummary` | `{carried?: number, capacity?: number, state?: string}` | No item list, formulas, or effect sources |

`EntityLabel`, `SafeAssetRef`, skill/rank values, movement keys, numeric bounds, string lengths, and collection
limits are closed schemas in the implementation. Unknown properties fail validation.

Policy writes validate the preset, every override, and every replacement value before commit. Invalid input
returns a stable validation error and does not change the last valid policy. If persisted policy cannot be
validated, peer projection fails closed: peers receive no data fields, owner/DM management receives
`PROJECTION_POLICY_INVALID`, and operator telemetry records the character id without recording character
truth. The server never falls back to `open` or copies an unvalidated replacement.

### Metadata-only realtime invalidation

`character.projection.updated` is replaced, with the required protocol-version transition, by
`character.projection.invalidated`. The durable event/outbox/WebSocket message carries no projected character,
patch, changed path, operation amount, field name, or display text. The event envelope already supplies the
campaign, aggregate id, aggregate revision, sequence, and event id; its payload is limited to:

```json
{"projectionRevision": 4}
```

After receiving an invalidation, a projection/read-model consumer coalesces repeated invalidations and performs
an authorization-scoped HTTP fetch. Hub cards, Party Tracker rows, and DM peer previews treat the response as a
replacement, not as a merge with an older broader projection. An editable owner Character Sheet must never
replace live local state from an invalidation-triggered fetch: ordinary document changes use its accepted-base
and live-state rebase, while semantic operations use
[ADR 0012](0012-idempotent-semantic-character-operations.md).

WebSocket resync no longer transports character documents or profiles. `resync_complete` supplies the campaign
cursor, authorized event history, and at most character ids/revisions needed to invalidate client caches.
Initial, reconnect, Party Tracker, and explicit refresh loads all use the same HTTP projector. This prevents a
second projection implementation from growing inside the realtime snapshot path.

Private owner patches remain `actor_and_dm`; their patch payload is never made shared. Semantic operation
events follow [ADR 0012](0012-idempotent-semantic-character-operations.md) visibility. Public activity renders
an invalidation as generic "character updated" copy and must not turn metadata into a diff.

### No secondary disclosure path

Omission is end-to-end, not a card-rendering preference:

- **HTTP:** list, detail, snapshot, action inbox, transfer, and error responses may contain only the requester's
  authorized outcome. Error codes must not distinguish hidden resource values.
- **WebSocket:** shared fanout and replay carry invalidation metadata, never projected or canonical field
  values. Targeted events contain only data already authorized to their explicit recipients.
- **Activity log:** shared rows use sanitized actor/target labels from the peer profile and generic action
  text. Private values, deltas, document paths, item names, and approval failures remain target/actor/DM-only.
- **Party Tracker:** linked rows receive the current requester's server projection, remain read-only, and remain
  excluded from Board persistence. Any future player-visible Party Tracker output must use `peerPreview`, even
  if its producer is a DM.
- **Targeting:** peer target lists use only peer-visible identity and an opaque server-issued target reference.
  A character with hidden identity is not peer-targetable. Proposal creation performs syntax/authorization
  checks but does not reveal HP, condition, spell-slot, inventory, or carry eligibility.
- **Inventory and carry:** hidden item truth cannot be inferred from transfer previews, stack compatibility,
  encumbrance warnings, capacity formulas, or resource-specific failures. Peer-facing responses are limited to
  the independently authorized `inventorySummary` and `carrySummary`; rejected probes use a non-enumerating
  error.

All derived values carry projection provenance internally so a consumer cannot accidentally substitute truth
for a profile. Logging and metrics record projection kind, revisions, and failure code only.

### Revision, lifecycle, and cache rules

- A character mutation that can change a shared field increments the aggregate revision and emits one
  metadata-only invalidation.
- A policy mutation increments `projectionRevision` and emits the same invalidation without exposing which
  field changed.
- Cache keys include account authorization class, character id, aggregate revision, and projection revision.
  Peer values may be shared because all peers receive identical profiles; owner and DM truth are never stored
  in that cache entry.
- Membership/role revocation invalidates requester caches and closes sockets before any later fetch. A cached DM
  truth response cannot be reused after demotion.
- A character leaving/archiving the campaign removes it from peer fetches and targeting. A later stale
  invalidation cannot resurrect cached data.

## Required implementation evidence

Production implementation is not complete until memory/PostgreSQL parity tests prove:

1. byte-for-byte equal peer profiles for two different peers and distinct owner/DM outcomes;
2. typed preset/override validation, including fail-closed corrupt persisted policy;
3. metadata-only domain event, outbox, live WebSocket, replay, and resync payloads;
4. no hidden canary value in HTTP, WebSocket, activity, Party Tracker serialization, target lists/errors,
   inventory responses, logs, or metrics;
5. role demotion, membership removal, archive, and reconnect cannot reuse a broader cached response;
6. DM truth includes a peer preview identical to a real peer fetch;
7. linked Party Tracker rows remain non-persistent and use the scoped fetch path.

The protocol document, event catalog, permission matrix, data lifecycle, security model, and Party Tracker
documentation must be updated in the implementation change. `HUB_PROTOCOL_VERSION` must change if old clients
could interpret the new invalidation/resync shapes incorrectly.

## Consequences

- Privacy policy is explicit, versioned, type-safe, and testable across every consumer.
- Payload-bearing projection events disappear from retained event/outbox data and live fanout.
- Clients perform more HTTP reads after invalidations; coalescing, ETags, and revision-aware caching bound the
  cost without weakening authorization.
- DM tools retain authorized truth while making the peer view inspectable.
- Adding a shareable field now requires a catalog/schema/privacy review rather than a top-level allowlist edit.

## Rejected alternatives

- **Keep the fixed allowlist:** it provides no owner policy and encourages source-object copying.
- **Per-recipient peer policies:** they complicate explanation, replay, caching, and revocation and make peer
  equality impossible to prove.
- **Broadcast the computed peer profile:** this still retains payloads in events/outbox and creates a second
  stale-data path beside authorized fetch.
- **Filter only in the UI:** canonical truth would already have crossed the trust boundary.
- **Arbitrary JSON paths or templates:** they are not a stable field contract and are too easy to validate or
  escape incorrectly.
