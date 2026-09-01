# Campaign Hub

The Campaign Hub is an optional online layer over the existing local-first 5etools experience.
Signed-out character sheets, homebrew, and DM screens remain supported and do not use hub storage.

> **Implementation:** Private invite-only V1 plus player-test readiness through role-aware campaign workflows
> **Deployment:** Private Oracle staging is live; deliberate tagged release automation is implemented but its
> real-host induced-failure drill and the one-DM/two-player pilot remain gated
> **Last verified:** 2026-09-01
> **Owner:** Campaign Hub maintainers

## Start here

| Need | Read |
|---|---|
| What exists now | [Current system](current-system.md) |
| Why it is structured this way | [Architecture](architecture.md) and [ADRs](#architecture-decisions) |
| What was implemented and why | [Implementation history](implementation-history.md) |
| Exact Phase 0-5 working-tree checkpoint | [Checkpoint record](checkpoint.md) |
| Current capabilities/gates | [Implementation status](implementation-status.md) |
| Data, ownership, lifecycle | [Domain model](domain-model.md) and [data lifecycle](data-lifecycle.md) |
| Schema evolution and DB roles | [Migration guide](migrations.md) |
| OCI/Compose and edge contract | [Deployment guide](deployment.md) |
| Tagged Oracle release | [Deploy and promote runbook](runbooks/deploy-promote.md) |
| HTTP/error/auth contract | [API reference](api-reference.md) |
| WebSocket/event contract | [Realtime protocol](realtime-protocol.md) and [event catalog](event-catalog.md) |
| Who may do what | [Permission matrix](permission-matrix.md) |
| Security and limits | [Security model](security.md) and [performance budgets](performance.md) |
| Logs, metrics, SLOs, alerts | [Observability](observability.md) |
| Local setup/backup/restore | [Operations](operations.md) |
| Tests and release evidence | [Testing guide](testing.md) |
| CI, test-auth boundary, artifacts | [CI and provenance](ci-and-provenance.md) |
| How to change Hub safely | [Contributor guide](contributing.md) |
| Planned managed staging | [Staging plan](staging-plan.md) |
| Managed provider decision | [Provider comparison](provider-comparison.md) |
| Launch sequence and phase gates | [Private-V1 roadmap](private-v1-roadmap.md) |
| Diagnose a problem | [Troubleshooting](troubleshooting.md) and [runbooks](runbooks/README.md) |
| Requirement-to-code evidence | [Traceability matrix](traceability.md) |
| Current risks | [Risk register](risk-register.md) |
| Future options, not launch scope | [Post-V1 roadmap](post-v1-roadmap.md) |

Documents labeled **planned**, **pending**, or **not implemented** are not current capabilities.

## System summary

- Production authority: Fastify BFF + PostgreSQL under `server/`.
- Browser authority: none; clients use same-origin HTTP/WebSocket APIs.
- Character writes: per-character documents, revision + lease + fencing epoch, path patches and explicit
  conflict recovery.
- DM workspaces: private per-membership Board blobs with the same revision/fencing model.
- Campaign content: immutable brew/rules versions activated as non-persisted overlays.
- Realtime: committed outbox rows -> visibility-filtered WebSocket events; snapshots/replay recover gaps.
- Multiplayer commands: structured effects, grants, party inventory, and escrowed item/currency transfers.
- Campaign controls use character/item names rather than internal IDs, expose CP/SP/EP/GP/PP, and load the core
  plus campaign-homebrew item catalog only when a DM opens it.
- Local mode: unchanged local Character Sheet/DM Screen repositories and personal brew.

| Concern | Existing local path | Hub path |
|---|---|---|
| Characters | `charsheet-characters` roster + rescue mirror | `HubCharacterRepository`, one document per character |
| Homebrew | `BrewUtil2.pSetBrew()` personal persistence | `HubBrewContext` temporary overlay |
| DM screen | `DMSCREEN_STORAGE` Board blob | per-membership `HubDmWorkspaceRepository` |
| API/auth | ordinary network fallback | explicit service-worker NetworkOnly route |

## Character campaign workflow

The Character Sheet campaign control is the canonical place to add an existing character to a campaign:

1. A local character remains local while signed out. After sign-in, **Create cloud copy** saves the local
   character first, creates a separate campaign character, and leaves the local original unchanged.
2. A campaign character copied to another campaign is cloned by default. The original stays in its current
   campaign and the two characters do not share later changes.
3. Moving an attached cloud character is deliberately secondary. The sheet first compares the source and
   destination rules and homebrew, explains the consequences, and requires an explicit checkbox confirmation.
   A move preserves the character id, cancels pending incoming actions, and creates no duplicate.
4. Membership removal or campaign lifecycle changes can leave an owned cloud character detached rather than
   deleting it. `hub.html` lists these as **Cloud characters between campaigns**; opening one allows the same
   cloud character to join an eligible campaign.
5. The current browser releases only its own editor lease before a move. A lease held by another device blocks
   the operation without opening the normal conflict-takeover dialog; the character stays in its source
   campaign and the player can retry after that editor closes or expires.

Copy, attach, and move commands reuse an idempotency key when retried, so a lost response cannot create a
second character or apply the move twice. Local character JSON does not gain Hub ownership metadata.

## Architecture decisions

- [ADR 0001: backend and sessions](adr/0001-backend-and-sessions.md)
- [ADR 0002: documents, events, and leases](adr/0002-documents-events-and-leases.md)
- [ADR 0003: campaign homebrew security](adr/0003-campaign-homebrew-security.md)
- [ADR 0004: portable container topology](adr/0004-portable-container-topology.md)
- [ADR 0005: migration ledger](adr/0005-migration-ledger.md)
- [ADR 0006: operations and retention](adr/0006-operations-retention.md)
- [ADR 0007: lifecycle and account deletion](adr/0007-lifecycle-deletion.md)
- [ADR 0008: CI and artifact provenance](adr/0008-ci-provenance.md)
- [ADR 0009: managed staging provider](adr/0009-managed-staging-provider.md) — superseded
- [ADR 0010: Oracle Cloud Always Free hosting](adr/0010-oracle-always-free-hosting.md)
- [ADR 0011: authorization-scoped character projections](adr/0011-authorization-scoped-character-projections.md) — contract only
- [ADR 0012: idempotent semantic character operations](adr/0012-idempotent-semantic-character-operations.md) — contract only
- [ADR 0013: device-scoped active campaign context](adr/0013-device-scoped-active-campaign-context.md) — contract only
- [ADR 0014: multi-provider account identity](adr/0014-multi-provider-identity.md) — contract only
- [ADR 0015: versioned Campaign Hub rules policy](adr/0015-campaign-rules-policy.md) — contract only

ADRs 0001-0008 describe implemented portable architecture and launch-readiness decisions. ADR 0009 proposed
a paid managed provider and was superseded on cost grounds by ADR 0010, which selects Oracle Cloud Always
Free; it is retained as the evaluation of record for the paid upgrade path. ADRs 0011-0012 are accepted
architecture contracts for projection privacy and semantic operation reconciliation; production behavior is
not implemented by those ADRs.

## Local BFF setup

The BFF and PostgreSQL store live under `server/`. See `server/.env.example` and the operations runbook.

```bash
DATABASE_URL=... npm run hub:migrate
npm run hub:serve
```

The global navigation links to `hub.html`. API and authentication routes are same-origin and explicitly
NetworkOnly in the service worker.

## Historical references

- [Phase 0 proof notes](phase0-proof-notes.md) explain the original integration experiments. They are
  historical; current behavior is in `current-system.md`.
