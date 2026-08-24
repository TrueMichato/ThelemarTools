# ADR 0004: Portable OCI and same-origin edge topology

Status: Accepted for Phase 6D; implementation pending

## Context

The repository already has a root `Dockerfile` for the static site. The Hub adds a stateful Node BFF,
PostgreSQL, WebSockets, migrations, maintenance, and recovery responsibilities. Reusing the static image or
choosing a vendor-specific runtime first would blur boundaries and make security assumptions hard to test.

The browser contract requires static assets, `/api`, `/auth`, and `/ws` to share one public HTTPS origin.
Cookies, exact-Origin CSRF checks, service-worker policy, OAuth callback, and WebSocket authorization all
depend on that contract.

## Decision

1. Keep the root `Dockerfile` as the static-site image.
2. Add a separate non-root Node 24 OCI image for the BFF.
3. Publish a Docker Compose reference topology containing PostgreSQL 17, one-shot migrator, BFF, static site,
   same-origin TLS edge, and optional maintenance/restore profiles.
4. Use a Dockerfile-specific ignore file so the static `.dockerignore` cannot omit BFF sources.
5. Define liveness separately from database/migration readiness.
6. Treat the edge proxy contract—forwarded headers, trusted CIDRs, WebSocket upgrade/timeouts, body limits,
   and no-store responses—as part of the application security boundary.
7. Choose a managed provider only after the portable topology passes clean-machine, restart, and smoke tests.

## Consequences

- Static and BFF images have separate release lifecycles.
- Production secrets are injected at runtime and never copied into images.
- Provider selection must explain any deviation from the reference contract.
- Compose is a reference/staging tool, not proof that a single-host database is acceptable for production.
- The BFF image must include the shared JSON patch module it imports from `js/hub/`.

## Rejected alternatives

- Add Node/PostgreSQL to the static image: mixed concerns, credentials, and scaling.
- Direct browser/database hosting: violates ADR 0001.
- Provider-first implementation: makes portability claims untestable.
