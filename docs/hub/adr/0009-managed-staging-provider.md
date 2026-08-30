# ADR 0009: DigitalOcean for managed private-V1 staging

Status: Rejected on cost grounds; superseded by [ADR 0010](0010-oracle-always-free-hosting.md) (2026-08-27)

> **Outcome:** never accepted. After this comparison was written the project owner set a $0 recurring-cost
> constraint, and Oracle Cloud Always Free was found to satisfy the portable contract. The analysis below
> is retained because it remains the evaluation of record for the **paid upgrade path**: if self-managed
> PostgreSQL operations become burdensome, DigitalOcean is the documented destination, and the
> client-IP adapter built for this ADR is already implemented and tested.

## Context

Phase 6F proved the OCI/Compose contract and exact-image CI path. Phase 6G now needs a billable managed
environment. The private-V1 target is one DM and two to six players, so low fixed cost and simple operations
matter, but not at the expense of PostgreSQL PITR, same-origin WebSockets, tenant security, or digest
provenance.

AWS ECS/ALB/RDS most closely preserves exact proxy-CIDR trust but has the highest cost and operational
surface. Cloud Run has forced WebSocket reconnect and shutdown deviations. Render has unresolved
same-origin WebSocket/proxy-trust questions. The detailed evidence is in
[provider-comparison.md](../provider-comparison.md).

The existing realtime implementation is process-local. Private V1 is safe only with exactly one active BFF
replica; horizontal scale is a future architecture decision.

## Proposed decision

Use DigitalOcean App Platform, an approved supported registry, and a single-node DigitalOcean Managed
PostgreSQL 17 cluster for staging:

1. one BFF service, fixed at one 512 MiB shared-CPU instance;
2. one static-site component;
3. App Platform ingress rules preserving `/api`, `/auth`, and `/ws` prefixes;
4. CI image archive imported and pushed without rebuilding, then pinned by registry digest;
5. managed PostgreSQL with TLS, app-only trusted source, PITR, and migration/runtime/backup/operations roles;
6. scheduled maintenance and encrypted-backup jobs;
7. encrypted runtime variables, provider logs/insights/alerts, and synthetic staging data only.

## Required live evidence before acceptance

DigitalOcean documents that `do-connecting-ip` contains the client address while `X-Forwarded-For` contains
the ingress server. The provider-gated adapter is implemented: only this header is accepted, it is mutually
exclusive with `HUB_TRUST_PROXY`, and one validated address drives logs, HTTP rate-limit keys, and WebSocket
context. IPv6 rate limits retain `/64` normalization. Unit/integration coverage includes
spoofed/absent/ambiguous headers and IPv4/IPv6. Staging still
requires first-party overwrite assurance or a decisive live proof; never enable unrestricted `trustProxy`.

The server now sends 25-second WebSocket ping control frames and terminates missed pongs. Staging must prove
quiet-session survival, routing, rolling-deploy reconnect/replay, shutdown grace, scheduled jobs, PostgreSQL
TLS/trusted source, backup/PITR, and restore. Failure of any gate rejects this ADR and selects AWS.

## Cost and region

Planning range: approximately $20-30/month, based on a $5 App Platform service, a $15 single-node managed
PostgreSQL cluster, and $0-5 each for registry and mandatory encrypted-backup storage. Mixed-app static-tier
eligibility and bandwidth must be confirmed in the provider console before resource creation.

No region is selected in this ADR. That is a user/data-location decision.

## Consequences

- Staging stays inexpensive and declarative in one App Spec.
- The managed edge replaces local Caddy while preserving the same-origin route contract.
- DigitalOcean encrypted env values are operationally adequate but weaker than a separate secret-manager
  product; provider-console access must be tightly limited.
- One BFF replica is a launch constraint, not a scaling recommendation.
- One replica also means no App Platform two-container HA; private V1 accepts restart/deploy downtime and
  relies on reconnect/replay.
- The client-IP adapter is a reviewed provider deviation, not a generic trust relaxation.
- Production is not provisioned or enabled by this decision.

## Rejected alternatives

- AWS ECS/ALB/RDS as the first private staging environment: strongest network boundary, but materially higher
  cost and operational burden. Retained as fallback.
- Cloud Run/Cloud SQL: forced WebSocket timeout and fixed shutdown grace add unnecessary private-V1 risk.
- Render: unresolved first-party evidence for the exact proxy and same-origin WebSocket path.
- Deploying before approval: rejected because provider, recurring cost, region, domain, and account ownership
  require user consent.
