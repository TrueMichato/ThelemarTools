# Campaign Hub HTTP API

> **Status:** Current private-V1 contract
> **Wire protocol:** `3`
> **Last verified:** 2026-09-02
> **Owner:** Campaign Hub maintainers

The browser uses relative same-origin paths through `HubApiClient`. This is an application BFF contract, not
a public third-party API. Schemas in `server/src/app.js` are authoritative if this document and code differ.

## Common behavior

### Authentication

- Session cookie: signed `__Host-hub_session`; httpOnly, SameSite=Lax, Secure in production.
- OAuth correlation cookie: signed `__Host-hub_oauth`; httpOnly and short-lived. State/PKCE live in a
  provider/operation/redirect-bound one-time server transaction.
- Account authority is only `(provider, immutable subject)`; email and mutable profile fields never select or
  link an account.
- `GET /api/session` is the bootstrap call. Signed-in responses include the CSRF token.
- Private reads require an active session. Campaign reads additionally require active membership.

### Mutation headers

Every mutation requires:

```http
Origin: https://the-exact-app-origin.example
X-CSRF-Token: <session HMAC>
X-Hub-Protocol-Version: 3
Idempotency-Key: <non-empty value, at most 200 characters>
```

The server hashes method, route, params, query, and body (excluding `baseRevision` and `leaseEpoch`) and stores
the hash with the per-account receipt. Reusing one key for a different logical request returns
`IDEMPOTENCY_KEY_REUSED`. Excluding revision/epoch lets the same logical mutation retry after safe rebase or
lease refresh without becoming a different command.

### Responses

- JSON unless redirect/download/204 semantics state otherwise.
- `/api/*` and `/auth/*` set `Cache-Control: no-store`.
- Stable errors:

```json
{
  "error": "STABLE_CODE",
  "details": {}
}
```

`details` is omitted when absent. Internal exception messages are not returned.

### Identifier validation

Path/query keys ending in `Id` must be UUID-shaped. Invalid values fail as `INVALID_ID` before route logic.

## Public and session routes

| Method/path | Access | Input | Result/behavior |
|---|---|---|---|
| `GET /api/health` | Public | none | `{ok:true}` or 503 `{ok:false,error:"DATABASE_UNAVAILABLE"}`; verifies DB, migration ledger, and required migration |
| `GET /api/meta` | Public | none | protocol/package version plus additive `auth.provider_registry.v1` capability and bounded provider availability |
| `GET /auth/:provider/start` | Public, 10/min | concrete `github`, `discord`, or `google` route; query `returnTo?` | Creates a one-time durable transaction, sets signed correlation cookie, and redirects using the adapter's declared PKCE/nonce capabilities |
| `GET /auth/:provider/callback` | OAuth correlation cookie, 20/min | concrete route; query `code`, `state` | Atomically consumes exact provider/operation/redirect-bound state, validates immutable subject, enforces exact allowlist authority, rotates the prior session, and redirects safely |
| `GET /api/session` | Public | session cookie optional | `{signedIn:false}` or account + CSRF token |
| `POST /api/logout` | Mutation security | none | Revokes current session, closes its sockets, clears cookie |
| `GET /api/account/export` | Authenticated | none | Download containing owned account/external-identity/session-provenance/membership/campaign/character/audit data; never provider tokens/OAuth transactions |
| `GET /api/account/sessions` | Authenticated active account | none | Own sessions with current/revoked/activity metadata |
| `POST /api/account/sessions/:sessionId/revoke` | Authenticated mutation | own session UUID | Revokes session/leases and closes matching sockets |
| `POST /api/account/sessions/revoke-others` | Authenticated mutation | none | Revokes all other own sessions/leases/sockets |
| `GET /api/account/deletion` | Authenticated, including deletion grace | none | Current deletion status/timestamps |
| `POST /api/account/deletion/request` | Authenticated mutation | `{confirmation:"DELETE"}` | Blocks active campaign owners; schedules seven-day purge, revokes sessions/cookie |
| `POST /api/account/deletion/cancel` | Reauthenticated deletion-grace mutation | none | Restores active account before purge begins |

The concrete routes are `/auth/github/*`, `/auth/discord/*`, and `/auth/google/*`; disabled or
configuration-error providers have no routes. Google validates RS256 signature, fixed issuer/audience/`azp`,
expiry/issued-at bounds, nonce, and `sub`. Discord validates the `/api/v10/users/@me` decimal user id. Provider
tokens and response bodies never cross the callback adapter boundary.

## Campaign routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `POST /api/campaigns` | Authenticated mutation, 10/min | `{name}` 1-120 chars | 201 campaign + owner DM membership |
| `GET /api/campaigns` | Authenticated | none | Active memberships' non-deleting campaigns |
| `GET /api/campaigns/:campaignId` | Active member | none | Campaign with caller membership role/id |
| `GET /api/campaigns/:campaignId/members` | Active member | none | Active member summaries |
| `PATCH /api/campaigns/:campaignId/members/:membershipId` | Campaign owner mutation | role co_dm/player/spectator | Changes a non-owner role |
| `DELETE /api/campaigns/:campaignId/members/:membershipId` | Owner or co-DM mutation | none | Removes allowed non-owner, resolves pending state, detaches characters |
| `POST /api/campaigns/:campaignId/leave` | Non-owner mutation | none | Leaves and performs the same lifecycle cleanup |
| `GET /api/campaigns/:campaignId/context` | Active member | none | Active immutable brew/rules versions |
| `GET /api/campaigns/:campaignId/snapshot` | Active member; protocol-versioned | none | Campaign, membership, authorization-scoped character envelopes, roster metadata, last sequence |
| `GET /api/campaigns/:campaignId/character-projections` | Active member; protocol-versioned | none | `{projections, roster}` — the batch scoped projector every consumer refetches through |
| `GET /api/campaigns/:campaignId/events` | Active member | `afterSequence>=0`, `limit` 1-500 (default 200) | `{events, replay: {scannedThroughSequence, hasMore}}`; ordered authorization-scoped events plus the authoritative continuation boundary |
| `POST /api/campaigns/:campaignId/archive` | Campaign owner mutation | none | Cancels actions/releases leases/detaches characters, or `CAMPAIGN_BUSY` |
| `POST /api/campaigns/:campaignId/transfer-ownership` | Campaign owner mutation | `{targetAccountId}` | Changes owner and owner/target roles atomically |

The archive/ownership routes rely on store-level owner authorization in addition to session security.

Event replay pages can contain fewer than `limit` events, including zero, after character-projection privacy
redaction. A client continues while `replay.hasMore` is true and passes `replay.scannedThroughSequence` as the
next `afterSequence`; returned event count is never evidence that the scanned range is exhausted. The marker is
the highest raw event sequence in that page's bounded scan window, excluding its one-row lookahead, not the last
event disclosed to the viewer.

### Authorization envelopes

Every character read returns exactly one outcome, discriminated by `kind`
([ADR 0011](adr/0011-authorization-scoped-character-projections.md)):

| Requester | `kind` | Contents |
|---|---|---|
| Character owner | `owner_truth` | canonical document, `policy`, `projectionRevision`, opaque `targetRef`, `operationWatermark` |
| DM or co-DM who is not the owner | `dm_truth` | canonical document, opaque `targetRef`, `operationWatermark`, plus the exact `peerPreview`; never the raw policy |
| Any other active member | `peer_profile` | `{id, campaignId, revision, projectionRevision, data}` |

Reads whose response is an envelope require `X-Hub-Protocol-Version`; a mismatch returns
`426 PROTOCOL_UPDATE_REQUIRED` so an older client is told to update rather than silently misreading a shape it
does not understand.

## Invite routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `POST /api/campaigns/:campaignId/invites` | DM/co-DM mutation, 20/min | role co_dm/player/spectator, expiry 1-720h (default 168), max uses 1-20 | 201 invite metadata plus raw token |
| `GET /api/campaigns/:campaignId/invites` | DM/co-DM | none | Invite metadata without token hashes/raw tokens |
| `POST /api/campaigns/:campaignId/invites/:inviteId/revoke` | DM/co-DM mutation | none | Idempotently sets revoke time |
| `POST /api/invites/redeem` | Authenticated mutation, 20/min | raw token 32-500 chars | Active membership; invalid/expired/revoked/exhausted is `INVITE_INVALID` |

Only the token hash is persisted. The raw token is returned only from creation.

## Character routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `GET /api/characters?campaignId?` | Authenticated; protocol-versioned | optional campaign UUID | Owner's active characters; DMs see campaign characters; other members see only owned rows. No response ever carries `projectionPolicy` — sharing settings are read only from the owner-only management endpoint |
| `POST /api/characters` | Authenticated mutation; non-spectator membership if campaign scoped | `clientImportId`, `campaignId?`, `schemaVersion`, `data` | 201 created/reactivated/idempotently existing canonical character |
| `GET /api/characters/:characterId` | Any active campaign member; protocol-versioned | none | `{projection}` — one ADR 0011 envelope: `owner_truth`, `dm_truth`, or `peer_profile` |
| `GET /api/characters/:characterId/projection-policy` | Owner only; protocol-versioned | none | `{policy, projectionRevision, preview}`; `preview` is the server-computed peer profile, and `error` reports `PROJECTION_POLICY_INVALID`. A character owned by somebody else and one that does not exist both return `404 PROJECTION_POLICY_NOT_AVAILABLE`, so the endpoint cannot confirm an id |
| `PUT /api/characters/:characterId/projection-policy` | Owner mutation | `{policy, expectedProjectionRevision}` + `Idempotency-Key` | Updated policy/preview, `409 PROJECTION_POLICY_CONFLICT` with the current safe state, or `422 PROJECTION_POLICY_INVALID` |
| `POST /api/characters/:characterId/lease` | Owner mutation | `{takeover?}` | Lease session, monotonic epoch, expiry |
| `PATCH /api/characters/:characterId` | Owner mutation + held lease | `baseRevision`, `leaseEpoch`, up to 500 add/remove/replace patches | Canonical character or revision/lease conflict |
| `DELETE /api/characters/:characterId` | Owner mutation | none | Soft archive; blocks outgoing reserved transfer |
| `POST /api/characters/:characterId/clone` | Owner + target non-spectator membership | `{campaignId}` | Independent character with new id |
| `POST /api/characters/:characterId/move` | Owner + target non-spectator membership | `{campaignId}` | Same character moved; active lease/outgoing escrow blocks |

Character data is sanitized/validated and capped at 1.5 MB after the resulting mutation.

## Rolls, actions, and grants

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `POST /api/campaigns/:campaignId/rolls` | Active-member mutation; character owner or DM when character supplied | characterId?, formula <=200, numeric total, context <=100, visibility, detail | Durable `roll.logged` event; activity uses a bounded semantic `detail.title` and selected detail fields |
| `GET /api/campaigns/:campaignId/actions` | Active member | none | Proposed semantic operations visible to DM/co-DM, proposer, or target owner |
| `POST /api/campaigns/:campaignId/actions` | DM/co-DM/player mutation; spectator denied | Direct DM/co-DM command or source-derived peer proposal, below | 201 stable operation/lifecycle metadata; direct authority is already `applied`, peer authority is `proposed` |
| `POST /api/campaigns/:campaignId/actions/:operationId/resolve` | Target owner, proposer, or DM/co-DM according to decision | `{commandId, decision}` where decision is `accept`, `reject`, or `cancel` | Stable operation/lifecycle metadata; acceptance returns the applied revision/watermark |
| `POST /api/campaigns/:campaignId/characters/:characterId/xp-grants` | DM/co-DM mutation | integer amount 1-1,000,000; reason <=500 | Updated character |
| `POST /api/campaigns/:campaignId/characters/:characterId/item-grants` | DM/co-DM mutation | item object; quantity 1-100,000 | Updated character + stable new entry |

Every semantic command uses a UUID `commandId` equal to `Idempotency-Key`. Exact retries return the stored
operation and event ids; any actor/body reuse returns `IDEMPOTENCY_KEY_REUSED`.

Direct DM/co-DM body:

```json
{
  "commandId": "uuid",
  "targetCharacterId": "uuid",
  "operation": {"kind": "hp.heal", "version": 1, "arguments": {"amount": 5}}
}
```

Source-derived peer body:

```json
{
  "commandId": "uuid",
  "sourceCharacterId": "uuid",
  "sourceEntity": {"type": "ability", "uid": "name|source", "version": "content-version"},
  "effectTemplateId": "server-template-id",
  "choice": {},
  "targetRef": "opaque-uuid"
}
```

The version-1 catalog is `hp.damage`, `hp.heal`, `condition.add`, `condition.remove`, `spell_slot.spend`, and
`spell_slot.restore`. Players cannot submit generic `kind`/`arguments`. Peer proposals rederive from the pinned
server template at creation and approval, always require a later explicit target-owner acceptance (including
self-target), and expire after at most 24 hours. DMs/co-DMs may reject/cancel but may accept only when they own
the target. The production registry currently enables no successful `cost=none` peer template; recognized
cost-bearing Cure Wounds requests fail with `SOURCE_COST_UNSUPPORTED` before row creation and again at apply.
An otherwise-authorized resolution command received after the deadline performs the single `expired` transition
and returns its stable terminal metadata; retries replay that response. The authority does not interpret
arbitrary spell prose.

## Party inventory and transfer routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `GET /api/campaigns/:campaignId/party-inventory` | Active member | none | Lazily created party inventory, entries, denomination currency |
| `GET /api/campaigns/:campaignId/transfers` | Active member | none | Transfers visible to DM, actor, source owner, or target owner |
| `POST /api/campaigns/:campaignId/transfers` | Active-member mutation; source owner or DM for party source | source/target kind+UUID, <=100 item quantities, nonnegative denomination currency | 201 transfer already in `reserved` state |
| `POST /api/campaigns/:campaignId/transfers/:transferId/resolve` | Target owner or DM/co-DM; originating actor may reject | accept/reject | committed or rejected transfer |

`sourceKind`/`targetKind` are `character` or `party_inventory`. Empty/insufficient transfers fail before a
row is committed. Item quantities must be positive finite safe integers within the route schema limit. The
authority removes the requested value into escrow before returning `reserved`; acceptance writes that escrow
to the destination, while rejection or lifecycle cancellation restores the source exactly once. Reusing an
idempotency key with the same command replays its stored result rather than repeating either mutation.

The server derives item eligibility and stack compatibility from canonical data. A whole stack is refused
while equipped, attuned, container-linked, spell/component-linked (including a real `itemGrantedSpells[].itemId`
record), or otherwise referenced by Character Sheet state. Concentration records do not carry source-item
identity and are not treated as item links. A partial move is allowed only when every reference remains valid
against the source copy and the transferred wrapper carries no child/container linkage that would be duplicated. Such refusals
return `TRANSFER_ITEM_LINKED`. Destination stacks merge only when their complete transferable metadata matches;
custom names, source/edition, charges, durability, notes, material/variant/component state, and other mutable
fields therefore remain distinct when they differ.

An owned campaign-backed Character Sheet uses these routes directly: it fetches the party stash on open and
after reconnect or relevant transfer events, proposes character-to-stash and character-to-character moves, and
lets a DM/co-DM move stash items into the open character. The browser never applies an escrow mutation to two
documents itself. Character updates are adopted through the HTTP character repository's authoritative
reconciliation queue. Local, signed-out, detached, and non-owner sheets do not activate this integration.

## Campaign content routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `POST /api/campaigns/:campaignId/brew-versions` | DM/co-DM mutation | 1-100 brew documents | 201 immutable content-addressed version |
| `POST /api/campaigns/:campaignId/brew-versions/:versionId/activate` | DM/co-DM mutation | none | Campaign pointer + activation event |
| `POST /api/campaigns/:campaignId/rules-versions` | DM/co-DM mutation | typed rules object | 201 immutable rules version |
| `POST /api/campaigns/:campaignId/rules-versions/:versionId/activate` | DM/co-DM mutation | none | Campaign pointer + activation event |

## DM workspace routes

| Method/path | Authorization | Input | Result |
|---|---|---|---|
| `GET /api/campaigns/:campaignId/dm-workspace` | DM/co-DM | none | Caller membership's private workspace, created lazily |
| `POST /api/campaigns/:campaignId/dm-workspace/:workspaceId/lease` | Owning DM/co-DM mutation | `{takeover?}` | Workspace lease |
| `PUT /api/campaigns/:campaignId/dm-workspace/:workspaceId` | Owning DM/co-DM mutation + held lease | baseRevision, leaseEpoch, state object | Updated private workspace |

Campaign role alone does not permit reading another DM's workspace.

## Error catalog

| Class | Stable codes |
|---|---|
| Authentication/security | `AUTH_REQUIRED`, `INVALID_ORIGIN`, `INVALID_CSRF`, `PROTOCOL_UPDATE_REQUIRED`, `ACCOUNT_NOT_ALLOWED`, `ACCOUNT_DELETION_PENDING`, `FORBIDDEN` |
| Request/idempotency | `INVALID_REQUEST`, `INVALID_ID`, `INVALID_CAMPAIGN_NAME`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_RESULT_GONE`, `PAYLOAD_TOO_LARGE`, `REQUEST_REJECTED` |
| OAuth | `INVALID_OAUTH_STATE`, `ACCOUNT_NOT_ALLOWED`, `AUTH_PROVIDER_UNAVAILABLE` |
| Not found/lifecycle | `ACCOUNT_NOT_FOUND`, `SESSION_NOT_FOUND`, `CAMPAIGN_NOT_FOUND`, `MEMBERSHIP_NOT_FOUND`, `CHARACTER_NOT_FOUND`, `WORKSPACE_NOT_FOUND`, `ACTION_NOT_FOUND`, `TRANSFER_NOT_FOUND`, `BREW_NOT_FOUND`, `RULES_NOT_FOUND`, `INVITE_INVALID`, `INVITE_NOT_FOUND`, `ACCOUNT_DELETION_NOT_PENDING` |
| Concurrency/lifecycle conflicts | `REVISION_CONFLICT`, `LEASE_HELD`, `LEASE_EXPIRED`, `LEASE_FENCED`, `CHARACTER_BUSY`, `CAMPAIGN_BUSY`, `MEMBERSHIP_OWNER_PROTECTED`, `ACCOUNT_OWNS_CAMPAIGN` |
| Character/cloud content | `CHARACTER_INVALID`, `CHARACTER_TOO_LARGE`, `CLOUD_DATA_INVALID`, `CLOUD_DATA_TOO_LARGE`, `CLOUD_DATA_TOO_DEEP`, `CLOUD_HTML_FORBIDDEN`, `CLOUD_URL_FORBIDDEN`, `CLOUD_KEY_FORBIDDEN` |
| Campaign content | `BREW_INVALID`, `BREW_TOO_LARGE`, `BREW_TOO_DEEP`, `BREW_BLOCKLIST_FORBIDDEN`, `BREW_RAW_HTML_FORBIDDEN`, `BREW_URL_FORBIDDEN`, `BREW_KEY_FORBIDDEN`, `BREW_DEPENDENCY_MISSING`, `RULES_INVALID`; generic `CLOUD_DATA_INVALID`, `CLOUD_DATA_TOO_LARGE`, or `CLOUD_DATA_TOO_DEEP` may surface from the shared JSON-safety pass |
| Actions/transfers | `ACTION_INVALID`, `OPERATION_FORBIDDEN`, `SOURCE_OR_TARGET_UNAVAILABLE`, `SOURCE_COST_UNSUPPORTED`, `PROPOSAL_STALE`, `RESOURCE_INSUFFICIENT`, `NUMERIC_INVALID`, `TRANSFER_EMPTY`, `TRANSFER_INSUFFICIENT`, `TRANSFER_ITEM_LINKED`, `TRANSFER_TARGET_INVALID` |
| Availability | `DATABASE_UNAVAILABLE`, `INTERNAL_ERROR` |

Most validation/domain errors default to 400. Authorization uses 401/403, hidden/unavailable resources use
404, conflicts use 409, gone idempotency results use 410, size uses 413, protocol skew uses 426, readiness
uses 503.

## Rate limits

The rate-limit plugin is not global. Explicit route limits currently apply to OAuth start (10/min), OAuth
callback (20/min), campaign creation (10/min), invite creation (20/min), and invite redemption (20/min).
WebSockets enforce 20 inbound messages/second/connection separately. Phase 6 observability/load work must
validate whether additional per-route limits are needed before broader onboarding.
