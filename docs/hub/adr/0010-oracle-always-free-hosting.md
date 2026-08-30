# ADR 0010: Oracle Cloud Always Free for private-V1 staging and launch

Status: Accepted (2026-08-27); supersedes [ADR 0009](0009-managed-staging-provider.md)

## Context

ADR 0009 proposed DigitalOcean App Platform with managed PostgreSQL at roughly $20-30/month. That ADR was
never accepted. Before approval the project owner set an explicit constraint: **recurring cost should be
$0 if a free option can meet the contract honestly.** Private V1 is one DM and two to six known players on
an invite-only deployment, so the workload is trivially small; the binding constraints are always-on
compute, persistent WebSockets, durable PostgreSQL, and a single HTTPS origin.

A survey of free offerings found most are disqualified by shape rather than by size:

- Render's free web service sleeps after 15 minutes of inactivity, which is incompatible with persistent
  WebSockets, and its free PostgreSQL is deleted after 30 days;
- Fly.io withdrew its general free allowance for new organisations, and managed PostgreSQL starts at $38;
- Neon and Supabase free tiers provide only the database, and Supabase pauses a project after 7 days idle;
- Cloudflare Workers and similar edge runtimes do not host a long-lived Node process.

Oracle Cloud "Always Free" is the one offering that provides an always-on virtual machine with no sleep,
no expiry, and enough capacity to run the entire portable stack from [ADR 0004](0004-portable-container-topology.md).

The owner already holds an Oracle tenancy whose home region is Israel Central (Jerusalem). This matters
because Always Free resources exist only in a tenancy's home region and that region is fixed permanently at
signup. Oracle also enforces one free account per person and may suspend all accounts of an offender, so
creating a second tenancy to obtain a different region was rejected as disproportionate risk for a latency
difference that is immaterial to small JSON event traffic.

## Decision

Run private-V1 staging and launch on a single Oracle Cloud Always Free ARM instance:

1. one `VM.Standard.A1.Flex` instance at 1 OCPU / 6 GB, Ubuntu 24.04 LTS `aarch64`, 100 GB boot volume,
   in Israel Central (Jerusalem);
2. a public IPv4 address on the primary VNIC. The adopted C-ALT host retains its existing long-lived
   ephemeral address, which OCI preserves across reboot and stop/start. A reserved address is optional for
   a future new-instance path when portability to a replacement is desired;
3. the existing portable Compose stack from ADR 0004, unchanged in structure, with PostgreSQL 17 running
   as a container on the same host;
4. a new public overlay (`compose.hub.public.yml` and `deploy/hub/Caddyfile.public`) that publishes 80/443
   and replaces the self-signed local certificate with Let's Encrypt over HTTP-01;
5. `campaignhub.duckdns.org` as the public hostname;
6. images built on the instance from a verified git tag, because the free tier is ARM and GitHub-hosted
   runners are x86;
7. nightly encrypted portable backups to off-host storage, per [ADR 0006](0006-operations-retention.md).

### Adopted capacity-exhaustion deviation (2026-08-29)

After 317 failed launch attempts in `il-jerusalem-1`, the deployment changed from creating a new instance to
repurposing the retired Foundry host. The existing host already matches the resource decision (A1 1 OCPU /
6 GB and a 100 GB boot volume) but runs Ubuntu 22.04.4. Because stopping it may make it impossible to start
again, the 24.04 release upgrade is deferred until replacement/helper capacity exists. Ubuntu 22.04 remains
supported through May 2027 and Docker supports Jammy directly. This deviation is tracked by R-18 through
R-20 and executed by Part C-ALT of the Oracle provisioning runbook.

`HUB_CLIENT_IP_HEADER` remains unset. It exists for managed platforms that inject a trusted client-IP
header; here Caddy is the only ingress and `HUB_TRUST_PROXY` continues to name its fixed private address.
The provider client-IP adapter built for ADR 0009 is retained but inactive.

## Consequences

Accepted costs of the free path, each a deliberate trade rather than an oversight:

- **No managed point-in-time recovery.** PostgreSQL is self-hosted, so recovery is from nightly encrypted
  backups. Worst-case data loss is therefore up to 24 hours. This still satisfies the stated RPO of 24 hours
  and RTO of 4 hours, but with no margin. This narrows ADR 0006, which anticipated managed PITR.
- **Provenance weakens from image digest to verified tag.** ADR 0008 specified deploying the exact
  CI-produced image by registry digest. ARM/x86 divergence makes that impossible without multi-architecture
  builds, so the instance rebuilds from a tag whose CI run was green. Acceptable for an invite-only
  deployment; revisit before any public exposure.
- **Self-managed database operations.** Patching, upgrades, and disk headroom become operator tasks.
- **Capacity is a quota, not a reservation.** Always Free does not guarantee hardware; a terminated
  instance may not be immediately re-creatable, so instance replacement must be planned, not casual.
- **Single point of failure.** One virtual machine hosts the edge, application, and database. This is not a
  regression: private V1 was already limited to one BFF replica because realtime fanout is process-local.
- **Free ARM allowances have been reduced before.** Oracle halved the pool in 2026. Portability under
  ADR 0004 is the mitigation: migrating to DigitalOcean or AWS is configuration, not redevelopment.
- **Idle instances may be reclaimed.** Oracle reclaims Always Free compute whose CPU, network *and* memory
  all remain below 20% across a 7-day window. A private hub is precisely this traffic profile, and the
  pre-Hub host reports only 13% memory use. No metric is assumed safe: measure all three after seven full
  days with the Hub running. The definitive remedy is upgrading to Pay As You Go, which lifts the idle
  policy while retaining the free allowances at $0 when usage stays within them. Tracked as an operational
  risk, not a design flaw.

Benefits:

- $0 recurring cost, satisfying the owner's constraint without abandoning the architecture;
- data residency in Israel, matching the player base and keeping personal data under one legal regime;
- 6 GB RAM against DigitalOcean's 512 MiB at $5, so headroom is better than the paid recommendation it
  replaces;
- the deployed artefact is the same Compose stack CI already exercises, so staging fidelity is high.

## Required evidence before the environment carries real campaign data

1. certificate issuance and automatic HTTP-to-HTTPS redirect on the public hostname;
2. GitHub OAuth round trip on the real domain, including refusal of a non-allowlisted account;
3. quiet-WebSocket survival for at least 30 minutes, exercising the 25-second heartbeat;
4. deploy-restart reconnect and replay with no visible event gap;
5. host reboot returning the full stack unattended;
6. **encrypted backup and restore drill**, per [backup-restore.md](../runbooks/backup-restore.md);
7. Phase 6H multi-device game day and go/no-go.

Failure of gate 6 blocks launch outright; an untested backup is not a backup.

## Rejected alternatives

- **DigitalOcean App Platform (ADR 0009):** technically sound and operationally easier, but $20-30/month
  against an explicit $0 preference, and materially less memory. Retained as the documented paid upgrade
  path if self-managed operations become burdensome.
- **AWS ECS/ALB/RDS:** strongest network boundary; highest cost and operational surface.
- **Render / Fly.io / Railway free tiers:** disqualified by sleep behaviour, database expiry, or withdrawal
  of the free allowance.
- **Self-hosting at home behind Cloudflare Tunnel:** genuinely $0, but availability becomes a function of
  domestic power and internet, and Cloudflare's free plan caps idle WebSockets at 100 seconds. Oracle is
  strictly better unless physical data custody is a requirement.
- **A second Oracle tenancy for a different home region:** rejected. Oracle's one-account rule risks
  suspension of both accounts, and the existing home region is already optimal.
