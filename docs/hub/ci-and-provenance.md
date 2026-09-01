# Campaign Hub CI, test boundary, and artifact provenance

> **Status:** Implemented for Phase 6F; tagged Oracle promotion deployed
> **Last verified:** 2026-09-01
> **Owner:** Campaign Hub maintainers

## Workflow contract

`.github/workflows/hub.yml` runs on pull requests and manual dispatch. Every third-party action is pinned to
a full reviewed commit SHA. Deployment remains intentionally absent from this workflow. Phase 6G deployed a
verified git tag to the ARM Oracle host under ADR 0008/0010. V2-T0 protected release automation shipped in
[PR #219](https://github.com/TrueMichato/ThelemarTools/pull/219); only the V1-G1 live Oracle release and
induced-failure proof remains. Expansion stays disabled until the V1 go/no-go.

| Job | Gates | Failure owner |
|---|---|---|
| `unit-and-supply-chain` | locked install, Hub Jest/docs contracts, JS and Hub/DM SCSS lint, service-worker build, production dependency audit, Hub-credential source scan (tracked plus commit-candidate files), Node/image SBOMs, production BFF build, Trivy HIGH/CRITICAL scan | contributor for code/test failure; security owner for dependency/image finding |
| `affected-regressions` | Character Sheet persistence/repository/rules/roll seams and targeted DM Screen/Party Tracker suites | Character Sheet or DM Screen maintainer with Hub maintainer |
| `migration-and-roles` | fresh PostgreSQL 17.6 migration chain, idempotent role grants/status, runtime read access, denied runtime schema alteration | database/migration owner |
| `real-stack-e2e` | downloads the exact production-image artifact, production-entry-point smoke, synthetic-auth layer derived from that image, disposable HTTPS edge + PostgreSQL 17, two multi-context Playwright journeys, BFF/database restart readiness, unconditional teardown | Hub maintainer; infrastructure owner when failure is runner/Docker-only |

CI failures are not waived by rerunning until green. A non-runtime exception requires an owner, expiry, risk
entry, and evidence that the affected code cannot execute in the release artifact.

## Test-only authentication boundary

Real GitHub OAuth is deliberately excluded from CI. Synthetic sign-in is constrained by four independent
boundaries:

1. production `server/Dockerfile` does not copy `test/e2e/hub/test-server.mjs`;
2. only `server/test.Dockerfile` uses the synthetic entry point;
3. the entry point refuses startup unless `NODE_ENV=test` and `HUB_TEST_AUTH_ENABLED=true`;
4. `/auth/__test/session` requires `HUB_TEST_AUTH_SECRET` and exists only in that test process.

`compose.hub.test.yml` is only an override for the disposable E2E stack. It does not change
`compose.hub.yml` or the production image. A production-configurable test-auth switch remains prohibited.
Real OAuth, callback, allowlist, and cookie behavior pass Oracle smoke checks. The physical one-DM/two-player
game day remains the target-environment acceptance gate.

## Real-stack scenarios

`npm run test:hub:e2e:stack`:

1. chooses a random Compose project name that cannot collide with the normal `thelemartools-hub` project;
2. creates random local-only secrets in process memory;
3. loads the CI production image, or builds it once for a local run;
4. derives the test-auth layer with `FROM ${HUB_TEST_BASE_IMAGE}` rather than rebuilding dependencies/source;
5. starts the one-origin HTTPS stack on `https://localhost:8443` and waits for migration-aware readiness;
6. starts the unmodified production image with its real entry point against the migrated PostgreSQL database
   and requires its inherited health check to pass;
7. runs Playwright with isolated browser contexts;
8. restarts the BFF and PostgreSQL separately and requires readiness after each;
9. handles ordinary completion, error, `SIGINT`, and `SIGTERM` through idempotent cleanup of only that random
   project's containers, networks, volumes, and locally built images.

The lifecycle journey covers DM/player sign-in, campaign/invite redemption, cloud Character Sheet loading,
XP and damage commands, party-inventory transfer, second-device session revocation, member removal and
character detachment, and deletion grace/cancellation.

The budget journey covers six active campaign members, a 1.4 MB character document, 500 roll events and a
500-event replay page, and two concurrent reservations against insufficient shared source currency. Exactly
one reservation succeeds. Unit/domain suites continue to own exhaustive fencing, outbox retry, protocol
skew, quota rejection, transfer terminal states, and local-mode behavior; the browser suite proves their
critical integration seams rather than duplicating every state permutation.

## Build artifact and evidence

The supply-chain job builds the production BFF image once with the full source SHA as tag and OCI
source/revision/version labels. It exports:

- `hub-bff-image.tar`: the exact locally scanned image;
- `hub-node-sbom.json`: CycloneDX production dependency SBOM;
- `hub-image-sbom.spdx.json`: image/filesystem SBOM;
- `hub-ci-provenance.json`: source SHA, image artifact SHA-256, app/protocol/migration versions, lockfile
  SHA-256, and workflow identity.
- `hub-trivy-results.json`: HIGH/CRITICAL vulnerability scan result and the scanner/database metadata emitted
  by that run.

The artifact name includes the source SHA and is retained for 14 days. The SHA-256 recorded in provenance is
calculated from the exported image archive, so a changed archive cannot be substituted silently. It is
explicitly an archive checksum, not an OCI manifest/registry digest; `registryDigest` remains null because the
ARM Oracle path builds from a verified git tag rather than importing the x86 CI image. Signing/attestation
beyond the workflow evidence is a pre-public-service gate.

The source-SHA image artifact is uploaded with explicit overwrite semantics, so a failed supply-chain job can
replace its own partial attempt and an E2E-only rerun can still download the successful producer artifact.
Playwright artifacts include `github.run_attempt`. Playwright always emits
`test-results/hub-playwright-results.json`, including on a successful run; missing evidence fails the upload
step rather than being silently ignored.

Never promote from an untrusted pull request artifact. Staging promotion requires an approved branch/run and
records source SHA/tag, applicable archive hash or image id, SBOMs, migration version, test run, operator, and
time. Release `hub-staging-2026-09-01` at `8f181712` is the deployed baseline. Automated promotion remains
V2-T0; expansion remains disabled until the explicit V1 go decision.

## Local commands

```bash
npm run test:hub
npm run test:hub:e2e:stack
npm run hub:check-secrets
npm sbom --omit=dev --sbom-format=cyclonedx > /tmp/hub-node-sbom.json
docker build -f server/Dockerfile -t thelemartools-hub-bff:local .
```

The Trivy action implementation is pinned, but its vulnerability database is refreshed dynamically and is
not a reproducible/pinned input. CI retains the JSON result and metadata from the actual run. Local scanning
is useful for early feedback but does not replace the recorded CI result.
