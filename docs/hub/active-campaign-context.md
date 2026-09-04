# Active campaign context (device- and account-scoped)

The active campaign context lets a browser remember which campaign the user is working in, so
campaign rules and brew survive ordinary navigation without a campaign parameter on every link.

The full contract is [ADR 0013](adr/0013-device-scoped-active-campaign-context.md). This document
records **what is implemented today** and what is deliberately still outstanding.

## What the selection is, and is not

The selection is a **device-local preference hint**, bound to one account:

- it lives in one browser storage partition — two browsers, profiles, private windows, or devices
  are independent even for the same account;
- it is **never** stored on the server and never synchronised between devices;
- it holds identifiers only, so it grants no capability and is not an authorization cache. The BFF
  revalidates session, membership, and campaign lifecycle on every startup, explicit URL,
  cross-tab change, and access-loss signal.

## Keys

| Concern | Key |
|---|---|
| Durable record | `localStorage["hub.activeCampaign.v1"]` |
| Cross-tab channel | `BroadcastChannel("hub:active-campaign:v1")` |
| Write serialisation | `navigator.locks.request("hub:active-campaign-write:v1", …)` |

```json
{"schemaVersion":1,"accountId":"<uuid>","campaignId":"<uuid>|null","state":"selected|cleared",
 "cause":"logout|access_loss|selection","revision":7,"updatedAt":1788271737000,"writerId":"<uuid>"}
```

Clearing writes a durable **tombstone** (`state: "cleared"`, `campaignId: null`) carrying the
`cause` that produced it; `cause` is absent on a selection. `removeItem()` is used only to evict a
malformed, oversized, or unknown-schema value — never a valid record.

## Ordering and convergence

Records are comparable **only** within one account. For one account the order is `revision`, then
state precedence (`cleared` outranks `selected`), then `updatedAt`, then `writerId`. So an
equal-revision select/clear race deterministically clears, and an equal-revision select/select race
has one stable winner that survives a restart.

A tab broadcasts **only** when it authored a mutation, or when a repair raised durable storage
toward the winner. Repair copies a record **verbatim** — it never increments `revision` — and
receivers ignore anything that is not *strictly greater* than their in-memory winner. The ordering
value is therefore monotone and bounded, so tabs reach a fixed point instead of trading writes.

## Precedence

| Priority | Candidate | Behaviour |
|---:|---|---|
| 1 | Authoritative campaign of the open cloud resource | Corrects a stale or absent `hubCampaign`; becomes the selection after validation. |
| 2 | Explicit URL (`campaign.html?id`, `?hubCampaign`) | Overrides the stored selection for this navigation, then updates it. |
| 3 | Account-matching stored selection | Used only when there is no explicit or resource candidate. |
| 4 | No candidate | Local mode. Campaign list order never auto-selects. |

A malformed, forbidden, or archived **explicit** candidate blocks that navigation. It never falls
through to a different stored campaign.

## Two verification paths

Hosts choose the cheapest path that satisfies them:

| Path | Requests | Used by |
|---|---|---|
| `pVerifySelection` | reused session + `GET /api/campaigns/:id` | Lightweight Hub shells. **Never** fetches context or brew. |
| `pVerifyContext` | reused session + campaign and context **in parallel** | Character Sheet, DM Screen. |
| `adoptVerified` | none | A host that already fetched session and campaign. |

The verified context is injected into `HubCampaignContext`, so activation itself issues no request
and campaign brew is never activated before campaign metadata has been validated.

The DM Screen bootstrap previously issued **four** requests including **two duplicate**
`GET /api/session` calls (`pLoadCampaign` and then `HubCampaignContext.pActivate`). It now issues
**three** with no duplicate, via the network-free `DmScreenHubController.adoptVerifiedCampaign()`.

## Host behaviour

| Host | Explicit / resource URL | No URL + stored selection | No URL + tombstone or signed out | Pinned |
|---|---|---|---|---|
| `hub.html` / `campaign.html` | Explicit `?id`, adopted at zero request cost | Revalidated through the selection-only path; cleared if archived or inaccessible | Signed out writes a clear tombstone for the stored record's account | No |
| Character Sheet | Resource-canonical, else `hubCampaign`; activates rules and brew | A bare URL opens the selected campaign repository; `?local=1` preserves the local repository | Local mode | **Yes**, once opened |
| DM Screen | Explicit `hubCampaign`; DM/co-DM only | A bare URL opens the selected authorized private workspace; `?local=1` preserves the local Board | Local mode | **Yes**, once opened |
| Ordinary content/build pages | Explicit `hubCampaign` | Activates temporary campaign brew and context before page data/rendering | Existing local/personal-brew behavior | No |

A purely local Character Sheet or DM Screen never resolves an authenticated campaign coordinator,
issues no request, and behaves exactly as before. Its lightweight navigation adapter is suspended
for the page lifetime, so storage and BroadcastChannel selections are ignored. A remembered campaign
can never apply its rules to a local character, and local Board initialisation is never gated behind
an authenticated fetch.

## Switching, pinning, and teardown

A committed switch runs these markers in order, each with exactly one owner, each idempotent:

`teardown-generation` → `teardown-realtime` → `teardown-projections` → `teardown-rules` →
`teardown-brew` → `activate-next`

If a stage throws, the remaining stages still run, the last completed marker is recorded, and
`activate-next` **does not** run. There is no supported mixed state of old rules with new
repositories.

A **resource-pinned** host (an open campaign character, an open DM workspace) adopts a new device
selection but stays on its own campaign in `switch_pending`. It does not tear down or activate.
Pinning is decided from coordinator creation, not from state that only exists after heavy
initialisation, so a remote selection arriving mid-startup cannot abort or rebind the page.
If the user reselects the campaign already backing the pinned resource, the coordinator verifies
and restores that campaign as the durable device default, clears the pending selection, and returns
to `active` without tearing down or reloading the open resource. This applies after either another
campaign or explicit local mode was selected.

A host may also refuse *activation* while still accepting the selection, via
`shouldActivateContext`. The Character Sheet uses this: its repository, realtime stream, roll log,
and URL are bound to the campaign it was opened with, so only that campaign may install context.
The gate applies to switching as well as startup — otherwise a remote selection could install
campaign B's rules while every other binding still pointed at A.

A **switchable** host must pass `pPreflightSwitch` — which stops new mutations and checks pending
writes — before any teardown runs; if it cannot guarantee safety the switch stays pending and the
current campaign stays active. Logout, account mismatch, and authoritative access loss always tear
down immediately, pinned or not.

### The rules-teardown trap

The Character Sheet re-applies `setCampaignSettingsOverlay(this._hubContext?.rulesVersion?.rules)`
on **every** character load and reset. Calling `clearCampaignSettingsOverlay()` alone is therefore
**not** a teardown — the next character load silently reinstalls the campaign rules. The
`teardown-rules` owner must also null `_hubContext`. This is pinned by
`test/jest/charactersheet/CharacterSheetHubTeardown.test.js`.

Private persistence is fenced independently from realtime teardown. Character saves capture both
the character identity and load generation before their first await; DM workspace saves capture the
Board save generation. Conflict prompts, recovery downloads, retries, server-document adoption,
panel hydration, save indicators, and other post-await effects recheck those fences. Access loss
therefore wins even when a conflict response or panel loader was already in flight.

## Invalidation

| Failure | Selection | Runtime |
|---|---|---|
| Signed out or logout | Cleared **before** the logout request is issued | Full teardown |
| Account differs from the record | Foreign record replaced by a revision-1 tombstone | Not activated |
| Malformed / oversized / unknown schema | Evicted | Per URL |
| Malformed explicit campaign id | Untouched | Navigation blocked, no fallback |
| `FORBIDDEN` / `CAMPAIGN_NOT_FOUND` / `MEMBERSHIP_NOT_FOUND` / archived | Cleared **only if it names the candidate** | Torn down **only if that campaign is the one actually active** |
| DM-only surface loses its role | **Retained** — the campaign is still selectable elsewhere | Workspace and projections close |
| `NETWORK_UNAVAILABLE`, `REQUEST_ABORTED`, or 5xx | Retained | `offline_unverified`; no authenticated activation |
| Host activation throws | Retained for retry | Rules and brew cleared; no partial context left live |
| Teardown failure | Retained | Fail closed, no next activation |

A failed switch to an inaccessible campaign B therefore never tears down a still-valid, still-open
campaign A.

At `teardown-projections`, an access-lost Character Sheet resets its private character model and replaces the
document UI; an access-lost DM Screen drops panels, projections, and campaign context. This happens before
rules and brew teardown, so no private projection remains visible during cleanup. DM access denials also
cancel pending debounced Board persistence before clearing panels, preventing concealment from being saved
as an empty authoritative workspace.

A cancellation is classified as `REQUEST_ABORTED` across the whole request path — including the
response body read — so it is never mistaken for connectivity loss. Personal brew and local
documents are never cleared by a campaign-context failure.

## BFCache

A persisted `pagehide` **suspends** synchronisation but retains context, rules, and brew. On a
persisted `pageshow` the coordinator fences a new generation and performs a **fresh** session and campaign read
before trusting anything: a storage reread alone is insufficient, because cross-account records are
deliberately incomparable and would simply be ignored. If the account signed out or changed while
the page was frozen, membership was removed, or the campaign was archived, the full ordered teardown runs
before any resumed mutation is permitted.

Every same-account stored record is then routed through the normal comparison path — **including
tombstones**, so a clear written by another tab while this page was frozen is honoured here too.

Realtime is resumed **after** revalidation completes, and only if the context is still active: a
frozen page must never reopen a private stream for a viewer who is no longer authorised.
`HubRealtimeClient.suspend()` deliberately retains replay state, and `resume()` reconnects from the
retained cursor — a restored page continues its subscription instead of going permanently stale.

A remote clear needs to say **why**, and that reason is part of the **durable record**, not transient
message metadata:

```json
{"schemaVersion":1,"accountId":"…","campaignId":null,"state":"cleared","cause":"logout",
 "revision":8,"updatedAt":…,"writerId":"…"}
```

A transient signal cannot carry this safely. The `storage` fallback has no payload to attach it to,
and when both transports deliver the same record the second one is correctly discarded by the
strict-greater convergence guard — so a message-only cause is lost in exactly the cases that matter.
Putting it on the record makes the decision identical regardless of delivery order or transport.

`cause` is one of `logout`, `access_loss`, or `selection`, and it **fails closed**: an absent or
unrecognised value is read as `logout`, so a record written by an older client still tears down.
Logout always tears down, pinned or not — it is a security boundary. Only a positively recognised
`access_loss` or `selection` lets a resource-pinned host adopt the cleared device default and enter
`switch_pending` while keeping its open resource, so losing access to campaign X cannot dismantle an
unrelated open campaign Y.

Only a non-persisted `pagehide` disposes the coordinator.

## Files

| File | Role |
|---|---|
| `js/hub/hub-active-campaign-record.js` | Pure record algebra: keys, validation, parse/serialise, ordering |
| `js/hub/hub-active-campaign-store.js` | Durable store, Web Lock serialisation, compare-and-repair |
| `js/hub/hub-active-campaign-channel.js` | Cross-tab channel, storage fallback, disposal |
| `js/hub/hub-active-campaign-coordinator.js` | Precedence, state machine, fencing, teardown, pinning, BFCache |
| `js/hub/hub-active-campaign-switcher.js` | Accessible selector and campaign-aware link decoration |
| `js/hub/hub-site-context.js` | Early ordinary-page activation and shared-navigation adapter |
| `js/hub/hub-surface-defaults.js` | Bare Character Sheet/DM Screen default routing |
| `js/hub/hub-capabilities.js` | Active-context protocol capability |
| `js/hub/hub-campaign-context.js` | Campaign context loader; injected session/context; idempotent `dispose()` |

The active-selection modules import nothing outside `js/hub/`, so the lightweight Hub shells keep their
two-script boot graph. The coordinator graph's combined transfer size is asserted against the 8 KiB budget in
`test/jest/hub/HubPerformanceBudget.test.js`.

## Tests

| Suite | Covers |
|---|---|
| `HubActiveCampaignRecord.test.js` | Validation, size cap, ordering, cross-account incomparability |
| `HubActiveCampaignStore.test.js` | Locking, verbatim repair, tombstone no-resurrect, eviction |
| `HubActiveCampaignChannel.test.js` | Filtering, storage-reread semantics, no write loop, disposal |
| `HubActiveCampaignCoordinator.test.js` | Precedence, request budgets, abort fencing, invalidation, teardown order, pinning, preflight, BFCache |
| `HubCampaignContext.test.js` | Zero-request injected activation, idempotent disposal |
| `HubCampaignNavigation.test.js` | URL decoration, explicit local routes, and surface defaults |
| `HubContentBootstrap.test.js` / `HubSiteContext.test.js` | Pre-data activation, temporary-only brew, capability failure |
| `CharacterSheetHubTeardown.test.js` / `CharacterSheetPersistenceBackend.test.js` | Ordered rules cleanup and in-flight character-save conflict fencing |
| `DmScreenCampaignPrivacy.test.js` / `DmScreenWorkspacePersistence.test.js` | Private Board concealment and conflict/panel-hydration fencing |
| `HubActiveCampaignJourney.test.js` | Real BFF integration: reload, device independence, request counts, logout ordering, pinned convergence |
| `test/e2e/hub/active-campaign-context.spec.ts` | Production stack: switcher/reselection, native storage/channel, defaults/local routes, pinning, in-flight conflict/access-loss order, BFCache, revoke/archive |
| `npm run test:hub:mutations` | Kills generation, teardown-order, account-scope, local-fallback, pinned-reselection, Character Sheet save-fence, and DM workspace save-fence mutants |

## Content-policy consumer

V2-T5 still owns only context transport and teardown. ADR 0015/V2-T6 consumes the active rules version,
content catalog, source/edition metadata, and campaign brew bundle to filter choices and fence authoritative
writes. Rules-version activation, rollback, reconnect, campaign switch, logout, or access loss increments the
context generation and immediately removes stale filters/reports before another context or local mode can load.
No campaign policy is written into local character JSON or personal brew.

## Parallel-change collision surfaces

The content-policy implementation adds dedicated evaluator/catalog modules and no migration. Later house-rule
and player-targeting lanes should conflict-check `campaign.html`, `js/hub/hub-page.js`,
`js/hub/hub-api-client.js`, Hub roadmap/status/traceability/testing documents,
`test/e2e/pages/HubCampaignPage.ts`, and the real-stack Hub specs. The context lane owns global navigation and
active-context lifecycle; later integrations must preserve its capability gate, temporary-brew boundary,
teardown generation, and resource pinning.
