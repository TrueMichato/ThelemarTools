# Campaign Hub

The Campaign Hub is an optional online layer over the existing local-first 5etools experience.
Signed-out character sheets, homebrew, and DM screens remain supported and do not use hub storage.

> **Implementation:** Private invite-only V1 through Phase 5
> **Deployment:** Not yet hosted; Phase 6 launch-readiness work remains
> **Last verified:** 2026-08-24
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
| HTTP/error/auth contract | [API reference](api-reference.md) |
| WebSocket/event contract | [Realtime protocol](realtime-protocol.md) and [event catalog](event-catalog.md) |
| Who may do what | [Permission matrix](permission-matrix.md) |
| Security and limits | [Security model](security.md) and [performance budgets](performance.md) |
| Local setup/backup/restore | [Operations](operations.md) |
| Tests and release evidence | [Testing guide](testing.md) |
| How to change Hub safely | [Contributor guide](contributing.md) |
| Planned managed staging | [Staging plan](staging-plan.md) |
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
- Local mode: unchanged local Character Sheet/DM Screen repositories and personal brew.

| Concern | Existing local path | Hub path |
|---|---|---|
| Characters | `charsheet-characters` roster + rescue mirror | `HubCharacterRepository`, one document per character |
| Homebrew | `BrewUtil2.pSetBrew()` personal persistence | `HubBrewContext` temporary overlay |
| DM screen | `DMSCREEN_STORAGE` Board blob | per-membership `HubDmWorkspaceRepository` |
| API/auth | ordinary network fallback | explicit service-worker NetworkOnly route |

## Architecture decisions

- [ADR 0001: backend and sessions](adr/0001-backend-and-sessions.md)
- [ADR 0002: documents, events, and leases](adr/0002-documents-events-and-leases.md)
- [ADR 0003: campaign homebrew security](adr/0003-campaign-homebrew-security.md)
- [ADR 0004: portable container topology](adr/0004-portable-container-topology.md)
- [ADR 0005: migration ledger](adr/0005-migration-ledger.md)
- [ADR 0006: operations and retention](adr/0006-operations-retention.md)
- [ADR 0007: lifecycle and account deletion](adr/0007-lifecycle-deletion.md)
- [ADR 0008: CI and artifact provenance](adr/0008-ci-provenance.md)

ADRs 0001-0003 describe implemented architecture. ADRs 0004-0008 are accepted continuation decisions whose
implementation is explicitly pending.

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
