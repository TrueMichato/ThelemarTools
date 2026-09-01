# Campaign Hub staging plan

> **Status:** Release deployed; host-operations proof and physical game day remain
> **Last reviewed:** 2026-09-01
> **Owner:** Campaign Hub maintainers

## Objectives

Staging must prove the provider-portable contract with real HTTPS, GitHub OAuth, PostgreSQL, WebSockets,
service workers, multiple physical devices, maintenance, monitoring, backup, and restore. It is not a demo
environment and must not use copied production characters.

## Current environment

- A reused Oracle Always Free ARM VM runs the private staging stack on Ubuntu 22.04 LTS.
- Caddy terminates public HTTPS and keeps the static site, API, OAuth, and WebSocket routes on one origin.
- GitHub OAuth, PostgreSQL, campaign creation, and the basic deployment smoke checks pass.
- Release `hub-staging-2026-09-01` at `8f181712` is deployed; Phase 6G is complete.
- The instance must not be stopped, resized, detached, or recreated while replacement ARM capacity is
  unavailable; normal guest reboots are allowed.
- The staging-baseline repair, lightweight Hub boot, Character Sheet-native campaign linking, role-aware
  campaign operation page, and human-readable interaction controls are deployed and pass Oracle smoke checks.
- The [living roadmap](roadmap.md) now gates the V1 decision only on host-operations proof and the physical
  one-DM/two-player game day.

## Environment requirements

- Separate database, OAuth application, secrets, allowlist, domain, backup destination, and alerts.
- Synthetic accounts/characters/campaigns only.
- Immutable BFF image digest with recorded app/protocol/migration versions.
- Same-origin static/API/auth/WebSocket routing.
- Least-privilege runtime and migration roles.
- Nightly encrypted off-machine portable backup with an isolated restore drill.
- Maintenance worker and outbox dispatcher active.
- Logs and metrics configured with redaction.
- Exactly one BFF instance; autoscaling disabled until shared realtime fanout exists.
- Provider-specific client-IP trust behavior proven against direct spoofing.

## Participants

- one DM;
- two players;
- one spectator where available;
- a second browser/device for one player;
- at least one desktop and one mobile physical device;
- one operator who is not relying on undocumented shell history.

## Scenario matrix

### Identity and access

- valid GitHub sign-in and session rotation;
- unallowlisted subject rejection;
- valid, invalid, expired, revoked, and reused invite;
- co-DM/player/spectator role boundaries;
- one-session and all-other-session revocation;
- membership removal while connected;
- OAuth secret/session/CSRF rotation rehearsal.

### Characters and content

- local-only character remains local while signed out;
- non-destructive local-to-campaign copy, canonical-id adoption, edit/save/reload;
- lease takeover and stale-writer fencing;
- detached-character Hub discovery and attachment;
- clone-by-default reuse, compatibility-gated move, another-device move refusal, retry, and idempotent replay;
- archive and campaign detachment;
- campaign brew/rules in two campaign tabs without personal-brew mutation;
- near-limit character and rejected over-limit mutation;
- DM full view versus player projection/private notes.

### DM workspace and realtime

- private workspace save/load/takeover/conflict recovery;
- Party Tracker linked rows remain read-only and unsaved;
- presence, reconnect, snapshot/resync, and 500-event replay;
- private/all-member/actor-and-DM roll visibility;
- session/membership revocation closes existing sockets.

### Actions and inventory

- online and offline structured effect;
- damage, healing, condition, informational, and spell-slot proposals with useful spell/action context;
- accept, reject, cancel, and DM override;
- XP and core/campaign-homebrew/custom item grants while owner is active;
- party inventory;
- source-aware partial/full stack selection and CP/SP/EP/GP/PP transfers without entering inventory IDs;
- empty and visibly insufficient transfer rejection before reservation;
- currency-only transfer from a character with no transferable item stacks;
- metadata-incompatible stacks;
- reject/cancel restores identity;
- linked/equipped item is refused;
- disconnect and member removal during reserved transfer.

### Lifecycle and deletion

- ownership transfer and campaign archive;
- account export;
- deletion blocked by active ownership;
- request deletion, restricted grace session, cancel;
- purge after grace in accelerated staging time;
- audit anonymization and backup-aging documentation.

### Failure/recovery

- BFF restart during reads and during a queued save;
- database restart;
- temporary database unavailability and readiness behavior;
- edge/WebSocket disconnect;
- rolling deployment overlap with old/new sockets and replay after reconnect;
- quiet WebSocket period beyond the provider idle threshold, with heartbeat where required;
- spoofed/missing provider client-IP header and rate-limit key behavior;
- outbox publish failure and retry;
- expired lease/session;
- stale service worker/protocol;
- rollback to previous image;
- restore backup to an isolated database and open representative workflows.

## Acceptance

- No unresolved P0/P1 defect.
- No tenant/private-field leak.
- No lost or duplicated inventory/currency.
- Selected RPO <=24h and RTO <=4h demonstrated.
- Logs/metrics identify induced failures without secrets/content.
- Every operator action follows a repository runbook.
- All documentation gaps found during the game day are resolved before go/no-go.

## Rollout

After a successful game day, start the private pilot with one DM and two players. Expand only after an
observation window reviews errors, outbox lag, database health, backup age, restore evidence, and participant
feedback. Public/semi-public registration remains disabled.
