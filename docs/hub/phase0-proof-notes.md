# Phase 0 proof notes

> **Status:** Historical proof record
> **Last reviewed:** 2026-08-24
> **Current reference:** [Current system](current-system.md)

## Character persistence

The existing character store is one `charsheet-characters` array plus a per-character synchronous rescue
mirror. A global `StorageUtil` replacement cannot provide safe per-character cloud revisions and would also
intercept unrelated local settings.

Proof implementation:

- `LocalCharacterRepository` wraps only the existing roster key.
- `HubCharacterMemoryAuthority` stores separate character documents.
- `HubCharacterRepository` diffs accepted snapshots and writes revisioned patches.
- lease takeover increments a fencing epoch.

Production integration subsequently replaced the Character Sheet's Hub-mode roster calls with an HTTP
repository router. This section records the proof that justified that change.

## Campaign brew overlay

`BrewUtil2Base.setBrewTemporary()` formalizes the existing `_brewsTemp` merge seam:

- it deep-copies the overlay;
- records the campaign/bundle cache key;
- invalidates only processed brew;
- never updates persisted brew metadata/storage.

Separate tabs have separate JavaScript realms and temporary arrays. Same-tab campaign switching invalidates
the processed cache via the bundle key.

## DM workspace

Board now accepts a repository and defaults to `LocalDmWorkspaceRepository`, preserving
`DMSCREEN_STORAGE`. The cloud proof stores one full Board blob per DM membership and fences stale editors.
Hub-linked live character data must remain outside that saved blob.

## PWA

The service worker registers same-origin `/api` and `/auth` routes as NetworkOnly before precache routing.
WebSocket traffic is not intercepted by service-worker fetch handlers. Protocol rejection and client reload
handling were implemented after this proof.

## Security spike result

Campaign homebrew cannot ship safely based only on cookies and CSP:

- the renderer has an intentional `wrappedHtml` path;
- generated output contains inline event handlers;
- rendered data reaches many `innerHTML` sinks.

The implemented resolution rejects raw HTML campaign brew and sanitizes compatibility HTML inside character
documents. See ADR 0003 and the security model.
