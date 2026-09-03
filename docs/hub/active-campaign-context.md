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
 "revision":7,"updatedAt":1788271737000,"writerId":"<uuid>"}
```

Clearing writes a durable **tombstone** (`state: "cleared"`, `campaignId: null`). `removeItem()` is
used only to evict a malformed, oversized, or unknown-schema value — never a valid record.

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
| Character Sheet | Resource-canonical, else `hubCampaign`; activates rules and brew | Device default updates, but context is **not** activated — the repository, realtime sync, and recovery keys are bound to the campaign the page was opened with, and `_pCanonicalizeHubCharacterUrl` performs the authoritative rebind via navigation | Local mode | **Yes** |
| DM Screen | Explicit `hubCampaign` only | **Never auto-opens a private workspace**; the Board initialises locally and the selection is untouched | Local mode | **Yes** |

A purely local Character Sheet or DM Screen creates no coordinator, issues no request, and behaves
exactly as before. A remembered campaign can never apply its rules to a local character, and local
Board initialisation is never gated behind an authenticated fetch.

## Switching, pinning, and teardown

A committed switch runs these markers in order, each with exactly one owner, each idempotent:

`teardown-generation` → `teardown-realtime` → `teardown-projections` → `teardown-rules` →
`teardown-brew` → `activate-next`

If a stage throws, the remaining stages still run, the last completed marker is recorded, and
`activate-next` **does not** run. There is no supported mixed state of old rules with new
repositories.

A **resource-pinned** host (an open campaign character, an open DM workspace) adopts a new device
selection but stays on its own campaign in `switch_pending`. It does not tear down or activate.
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

## Invalidation

| Failure | Selection | Runtime |
|---|---|---|
| Signed out or logout | Cleared **before** the logout request is issued | Full teardown |
| Account differs from the record | Foreign record replaced by a revision-1 tombstone | Not activated |
| Malformed / oversized / unknown schema | Evicted | Per URL |
| Malformed explicit campaign id | Untouched | Navigation blocked, no fallback |
| `FORBIDDEN` / `CAMPAIGN_NOT_FOUND` / `MEMBERSHIP_NOT_FOUND` / archived | Cleared **only if it names the candidate** | Torn down **only if that campaign is the one actually active** |
| DM-only surface loses its role | **Retained** — the campaign is still selectable elsewhere | Workspace, realtime, projections, rules, and brew close |
| `NETWORK_UNAVAILABLE`, `REQUEST_ABORTED`, or 5xx | Retained | `offline_unverified`; no authenticated activation |
| Host activation throws | Retained for retry | Rules and brew cleared; no partial context left live |
| Teardown failure | Retained | Fail closed, no next activation |

A failed switch to an inaccessible campaign B therefore never tears down a still-valid, still-open
campaign A.

A cancellation is classified as `REQUEST_ABORTED` across the whole request path — including the
response body read — so it is never mistaken for connectivity loss. Personal brew and local
documents are never cleared by a campaign-context failure.

## BFCache

A persisted `pagehide` **suspends** synchronisation but retains context, rules, and brew. On a
persisted `pageshow` the coordinator fences a new generation and performs a **fresh** session read,
then revalidates the active campaign and any surface-specific role before trusting anything: a
storage reread alone is insufficient, because cross-account records are deliberately incomparable
and would simply be ignored. If the account signed out, changed, lost campaign access, or lost the
role required by a private surface while the page was frozen, the full ordered teardown runs before
any resumed mutation is permitted.

Every same-account stored record is then routed through the normal comparison path — **including
tombstones**, so a clear written by another tab while this page was frozen is honoured here too.

Realtime is resumed **after** revalidation completes, and only if the context is still active: a
frozen page must never reopen a private stream for a viewer who is no longer authorised.

Only a non-persisted `pagehide` disposes the coordinator.

## Files

| File | Role |
|---|---|
| `js/hub/hub-active-campaign-record.js` | Pure record algebra: keys, validation, parse/serialise, ordering |
| `js/hub/hub-active-campaign-store.js` | Durable store, Web Lock serialisation, compare-and-repair |
| `js/hub/hub-active-campaign-channel.js` | Cross-tab channel, storage fallback, disposal |
| `js/hub/hub-active-campaign-coordinator.js` | Precedence, state machine, fencing, teardown, pinning, BFCache |
| `js/hub/hub-campaign-context.js` | Campaign context loader; injected session/context; idempotent `dispose()` |

These four modules import nothing outside `js/hub/`, so the lightweight Hub shells keep their
two-script boot graph. Their combined transfer size is asserted against the 8 KiB budget in
`test/jest/hub/HubPerformanceBudget.test.js`.

## Tests

| Suite | Covers |
|---|---|
| `HubActiveCampaignRecord.test.js` | Validation, size cap, ordering, cross-account incomparability |
| `HubActiveCampaignStore.test.js` | Locking, verbatim repair, tombstone no-resurrect, eviction |
| `HubActiveCampaignChannel.test.js` | Filtering, storage-reread semantics, no write loop, disposal |
| `HubActiveCampaignCoordinator.test.js` | Precedence, request budgets, abort fencing, invalidation, teardown order, pinning, preflight, BFCache |
| `HubCampaignContext.test.js` | Zero-request injected activation, idempotent disposal |
| `CharacterSheetHubTeardown.test.js` | Exclusive teardown owners and the `_hubContext` rules leak |
| `HubActiveCampaignJourney.test.js` | Real BFF integration: reload, device independence, request counts, logout ordering, pinned convergence |
| `test/e2e/hub/active-campaign-context.spec.ts` | Real browser: native storage, real `BroadcastChannel`, reload, BFCache, local DM Screen |

## Not yet implemented

These are tracked follow-ups, not oversights:

1. **`navigation.js` link decoration** on ordinary heavy content pages, and with it automatic heavy
   context activation from a stored-only selection. On the Character Sheet this additionally
   requires rebinding the campaign-scoped repository, realtime sync, and recovery keys, which is
   why a stored-only selection currently updates the device default without activating context.
2. **Resource-pinned visual affordance.** The `switch_pending` behaviour ships; the banner telling
   the user their default changed does not.
3. **`offline_unverified` presentation.** The classification ships; the degraded-mode UI does not.
4. **DM Screen campaign rules application.** The DM Screen does not yet apply the returned
   `rulesVersion` at all, so it registers no rules-teardown owner. Because it never installs
   campaign rules, no stale rules can exist there.

ADR 0013 therefore remains `Accepted contract; production implementation pending` until (1)–(4)
land.
