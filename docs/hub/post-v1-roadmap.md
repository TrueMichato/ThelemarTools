# Campaign Hub post-V1 roadmap (historical snapshot)

> **Status:** Historical snapshot; superseded by the [living roadmap](roadmap.md)
> **Last reviewed as active:** 2026-08-24
> **Owner:** Campaign Hub maintainers

This file preserves the original A-F horizon record. The [living roadmap](roadmap.md) is authoritative, carries
every horizon forward with an explicit **deferred** label, and separates them from the approved V2 release
trains. The following original horizons require discovery, threat modeling, data-model review, an ADR, and
explicit approval before implementation.

## A. Private-campaign usability

- campaign templates and guided onboarding;
- configurable retention/export packages;
- richer notifications without exposing private event content;
- support tooling that remains audited and avoids silent impersonation.

## B. Encounter/NPC interactions

Create a first-class encounter/NPC aggregate before targeting monsters. It must define identity, DM ownership,
hidden information, HP/condition/resource updates, undo, audit, and encounter-scoped visibility. Directly
mutating initiative-tracker blobs is rejected.

## C. Offline player mutations

Research an operation queue that distinguishes safe commutative edits from resource-spending commands.
Queued writes require authorization expiry, lease/fence handling, per-operation bases, explicit conflict UI,
and downloadable recovery. Blind stale snapshot replay remains forbidden.

## D. Collaborative editing

Evaluate bounded field ownership, semantic commands, CRDT/OT, and feature locks on a small document first.
One-editor leases remain default until collaboration is demonstrably more correct and recoverable.

## E. Transport consolidation

Replace remaining PeerJS initiative/player-viewer paths only after Hub transport has feature, latency,
offline, privacy, and compatibility parity. Preserve a staged coexistence window.

## F. Semi-public/public service

Requires registration/recovery, moderation/reporting/takedown, quotas and cost controls, privacy/terms/data
processing review, deletion SLA, support operations, tenant-scale load tests, vulnerability response, and a
fresh security assessment. Private allowlisting remains enabled until every gate has an owner and evidence.
