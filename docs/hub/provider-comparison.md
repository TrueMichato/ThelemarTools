# Campaign Hub managed-staging provider comparison

> **Status:** Phase 6G decision made — Oracle Cloud Always Free selected ([ADR 0010](adr/0010-oracle-always-free-hosting.md))
> **Last verified:** 2026-08-27
> **Owner:** Campaign Hub maintainers

> **Outcome:** the paid comparison below led to a DigitalOcean recommendation that was **not** accepted. A
> $0 recurring-cost constraint was then set, and the free-tier evaluation in the following section selected
> Oracle Cloud Always Free instead. The paid analysis is retained as the evaluation of record for the
> upgrade path.

## Decision criteria

The provider must preserve the portable contract rather than replace it:

- deploy the CI-exported BFF image without rebuilding and pin the resulting registry digest;
- run Node 24/Fastify with WebSockets and graceful SIGTERM;
- route static content plus `/api`, `/auth`, and `/ws` through one HTTPS origin;
- provide PostgreSQL 17, TLS, private/trusted-source networking, PITR, and separate database roles;
- run scheduled maintenance and encrypted-backup jobs;
- store secrets, collect redacted logs/metrics, and alert on the portable SLOs;
- keep staging and production isolated;
- support the private-V1 target at low cost.

All estimates below are planning ranges, not quotes. Re-check the selected region and account console before
creating billable resources.

## Free-tier evaluation (decisive)

Added 2026-08-27 after the $0 constraint was set. Most free tiers fail on **shape**, not size — the
workload is tiny, but it needs an always-on process holding WebSockets and a database that still exists
next month.

| Free offering | Always-on process | Persistent WebSockets | Durable PostgreSQL | Verdict |
|---|---|---|---|---|
| **Oracle Cloud Always Free (ARM VM)** | Yes — a real VM, no sleep, no expiry | Yes, unmediated | Self-hosted on the same VM; 200 GB block storage | **Selected** |
| Render free web service | No — sleeps after 15 min idle | Broken by sleep | Free database **deleted after 30 days** | Disqualified |
| Fly.io | Free allowance withdrawn for new organisations | n/a | Managed Postgres from $38/month | Disqualified |
| Neon / Supabase free | Database only | n/a | 500 MB; Supabase pauses after 7 days idle; no PITR | Insufficient alone |
| Cloudflare Workers | No long-lived Node process | Durable Objects only, a rewrite | Not applicable | Wrong shape |
| Home server + Cloudflare Tunnel | Yes | Free/Pro plans cap idle sockets at 100 s | Self-hosted | Viable but availability depends on domestic power/internet |

Oracle is the only entry that runs the portable stack unmodified. Its deviations from the criteria above
are explicit and accepted in ADR 0010: images are **rebuilt on the instance from a verified tag** rather
than pulled by digest, because the free tier is ARM while CI runners are x86; and there is **no managed
PITR**, so recovery is from nightly encrypted backups with an RPO of up to 24 hours.

Two constraints shaped the choice and are worth recording, because both are irreversible:

- Always Free resources exist **only in the tenancy home region**, and that region is fixed permanently at
  signup. Here it is Israel Central (Jerusalem), which is also the best available outcome — lowest latency
  to the player base and a single legal regime for personal data.
- Oracle permits **one free account per person** and reserves the right to suspend all accounts of an
  offender. Creating a second tenancy to obtain a different region was therefore rejected.

## Comparison (paid options, retained for the upgrade path)

| Provider shape | Contract fit | Important deviations/open items | Estimated staging/month | Operations |
|---|---|---|---:|---|
| DigitalOcean App Platform + Managed PostgreSQL | Native digest field; first-class multi-component same-origin ingress; scheduled jobs; PostgreSQL trusted-source rule can target the app; TLS/PITR | App Platform exposes the real client through `do-connecting-ip`; `X-Forwarded-For` contains the ingress server, so the current exact-CIDR `HUB_TRUST_PROXY` path cannot supply correct client IPs. SIGTERM, quiet WebSockets, mixed-app static pricing, and `/ws` ingress must be drilled. | about $20-30 | Low |
| AWS ECS Fargate + ALB + RDS PostgreSQL | Best match for exact proxy CIDR/security-group trust; digest tasks, WebSockets, configurable drain, private RDS/PITR | Highest number of VPC/IAM/LB primitives; private GitHub egress adds NAT cost unless architecture is relaxed | about $57-95 | High |
| Google Cloud Run + HTTPS LB + Cloud SQL | Digest deployment, private Cloud SQL/PITR, managed secrets/telemetry | WebSockets reconnect at the request-timeout ceiling; fixed short SIGTERM grace; forwarded trust is hop-based rather than an exact CIDR; LB required for one origin | about $55-80 | Medium-high |
| Render services + Postgres | Digest deployment, native WebSockets on web services, private database, low cost | No verified fixed ingress CIDR; static rewrite WebSocket behavior is not documented, otherwise a paid edge service is needed; PITR window depends on plan | about $20-27 | Low-medium |

## Recommendation (paid path — not adopted)

Had cost not been constrained, the recommendation was **DigitalOcean App Platform + DigitalOcean Managed
PostgreSQL**, conditionally.
It best fits the small trusted-table workload and keeps the planning range near $20-30/month:

- one `apps-s-1vcpu-0.5gb` BFF service at $5/month;
- one static-site component, subject to verification that the free tier applies inside a mixed paid app and
  that its 1 GiB allowance is sufficient;
- one single-node managed PostgreSQL cluster starting at $15/month;
- scheduled jobs billed only while running;
- $0-5 for registry storage, depending on approved GHCR/DOCR tier and digest garbage collection;
- $0-5 for the mandatory encrypted-backup destination, depending on whether approved external storage
  already exists.

The recommendation above was not adopted. ADR 0009 is superseded by ADR 0010; DigitalOcean remains the
documented destination if self-managed PostgreSQL operations later become burdensome, and the client-IP
adapter it required is already implemented and tested.

### Mandatory conditions

1. Keep `instance_count: 1` and disable autoscaling. Realtime socket membership and dispatch are process-local
   in private V1; horizontal replicas are not supported.
2. The code-level trusted-client-IP adapter for provider-set `do-connecting-ip` is implemented. It uses one
   validated source consistently for structured logs, HTTP rate-limit keys, and WebSocket context. The
   remaining gate is first-party assurance or a decisive staging proof that ingress overwrites browser
   copies; otherwise use AWS.
3. Route `/api`, `/auth`, and `/ws` to the BFF with preserved prefixes; route `/` to the static component.
4. Import the CI image archive, push it to an approved supported registry (GHCR or DOCR), record the registry
   digest, and deploy only that digest. Define digest retention/garbage collection before the free tier fills.
5. Attach managed PostgreSQL as the only trusted database source, require TLS verification, apply migrations
   with the owner role, then run the BFF/jobs with least-privilege roles.
6. Configure daily encrypted portable backup and bounded maintenance as scheduled jobs.
7. The server now emits 25-second WebSocket ping frames and terminates missed pongs. Drill quiet-session
   survival, upgrade/reconnect, client-IP spoofing, SIGTERM, rolling deployment overlap, PITR, restore, and
   destroy/recreate before accepting the provider.
8. Fall back to AWS ECS/ALB/RDS if DigitalOcean cannot satisfy client-IP authenticity, WebSocket routing, or
   graceful shutdown in a live staging probe.

## Single-replica constraint

`HubRealtime` and the outbox callback keep socket state in process memory. With two BFF replicas, the process
which claims an outbox row can notify only its own sockets. Snapshot/replay repairs reconnects, but it does
not make two simultaneously active replicas a correct live fanout topology.

Private V1 therefore requires one BFF instance and does not receive App Platform's two-container high
availability. A later scale-out design needs shared fanout (for example a
database notification or broker) and a dedicated ADR/test matrix. Provider rolling deployments may briefly
overlap old and new instances, so staging must verify that old sockets reconnect and replay without visible
gaps before the old instance exits.

## First-party references

DigitalOcean:

- [App specification: ingress, image digest, instance count, health, encrypted env](https://docs.digitalocean.com/products/app-platform/reference/app-spec/)
- [Deploying container images](https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-container-images/)
- [Cron and deployment jobs](https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/)
- [App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/)
- [App Platform regions](https://docs.digitalocean.com/products/app-platform/details/availability/)
- [App Platform limits and HA behavior](https://docs.digitalocean.com/products/app-platform/details/limits/)
- [Client IP header behavior](https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/)
- [Managed PostgreSQL pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/)
- [Managed PostgreSQL backup/PITR restore](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/)
- [Managed PostgreSQL TLS and trusted sources](https://docs.digitalocean.com/products/databases/postgresql/how-to/secure/)
- [Encrypted runtime variables](https://docs.digitalocean.com/products/app-platform/how-to/use-environment-variables/)

Fallback comparisons:

- [AWS ALB forwarded headers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/x-forwarded-headers.html)
- [AWS RDS PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)
- [AWS Fargate pricing](https://aws.amazon.com/fargate/pricing/)
- [Cloud Run WebSockets](https://cloud.google.com/run/docs/triggering/websockets)
- [Cloud Run container contract](https://cloud.google.com/run/docs/container-contract)
- [Render WebSockets](https://render.com/docs/websocket)
- [Render PostgreSQL backups](https://render.com/docs/postgresql-backups)

## Inputs required before provisioning

- provider acceptance or selection of the AWS fallback;
- staging region/data location;
- staging domain and DNS ownership;
- billable provider account/project, registry choice, and digest-retention policy;
- GitHub OAuth staging application;
- operator destination for alerts and mandatory encrypted backup storage.
