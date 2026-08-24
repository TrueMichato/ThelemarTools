# ADR 0008: Build once, verify deeply, promote by digest

Status: Accepted for Phase 6F; implementation pending

## Context

The existing repository workflows primarily build tagged static releases and use mutable action refs and
`npm i`. Hub launch needs PostgreSQL migrations, a BFF image, same-origin proxy behavior, WebSockets,
multi-context browser tests, dependency/image scanning, and reproducible promotion.

## Decision

1. Add Hub pull-request CI using Node 24 and PostgreSQL 17.
2. Use deterministic lockfile installation.
3. Test Hub/domain, affected Character Sheet/DM Screen, migrations, service worker, documentation, containers,
   Compose smoke, and real-stack multi-context E2E.
4. Generate an SBOM and scan dependencies, secrets, and the final image.
5. Pin third-party actions to reviewed immutable versions.
6. Build the BFF image once, label it with source/version/protocol/migration metadata, and identify it by
   immutable digest.
7. Separate build and deployment. Staging promotion is approved/manual; production promotion remains disabled
   until Phase 6H go/no-go.
8. Test-only authentication must use a separate entry point and fail startup under production mode.

## Consequences

- Release evidence can be tied to one artifact.
- CI becomes slower but replaces undocumented manual confidence.
- Provider deployment consumes the verified digest rather than rebuilding source.
- Exceptions require a time-bounded documented waiver with owner and risk.

## Rejected alternatives

- Rebuild independently per environment: provenance and behavior can drift.
- Real GitHub OAuth in CI: brittle and secret-heavy; manual staging covers it.
- Production-configurable test auth: unacceptable authentication bypass risk.
