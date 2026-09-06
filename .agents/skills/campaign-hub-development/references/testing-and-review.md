# Testing and review

## Choose evidence by risk

| Change | Minimum focused evidence |
|---|---|
| Shared pure helper or browser adapter | Targeted Hub Jest file(s) |
| Route/schema/authorization | Route/domain/authorization tests plus stable error cases |
| Store or transaction | Matching memory tests and executable PostgreSQL suite |
| Context/rules/content lifecycle | Targeted Jest plus `npm run test:hub:mutations` |
| Realtime/projection/privacy | Realtime, authorization, projection canaries, reconnect/replay tests |
| Character Sheet/DM Screen seam | Affected integration suites plus their domain-specific skill guidance |
| Protocol, cross-user, privacy or real-stack behavior | `npm run test:hub:e2e:stack` |
| Migration | fresh, prior-ledger, concurrent/failure/checksum, roles, readiness, and restore compatibility |
| Release/backup/restore automation | `test/jest/hub/HubReleaseAutomation.test.js` plus `campaign-hub-operations` review |

Canonical commands are in `docs/hub/testing.md` and `package.json`:

```bash
npm run test:hub
npm run test:hub:mutations
npm run test:hub:e2e:stack
npm run hub:migrate:plan
npm run hub:migrate
npm run hub:migrate:status
npm run hub:check-secrets
```

Use `npm run test:unit -- <paths> --runInBand --no-coverage --forceExit` for targeted Jest work. Do not use plain
`npx jest` in this ESM repository.

## Assertions that matter

Test more than final state:

- memory/PostgreSQL response and stable error parity;
- authorization rechecked after asynchronous work;
- exact idempotent replay and mutated-body rejection;
- no audit/event/outbox/receipt on rejected writes unless the contract explicitly records a terminal workflow;
- transaction and event ordering;
- stale rules/projection/protocol/capability fences;
- concurrent winner/loser behavior under real locks;
- visibility-minimized events and non-enumerating failures;
- reconnect, replay marker, duplicate delivery, and access-loss cleanup;
- local/signed-out isolation and campaign-overlay non-persistence.

Mutation runners must kill their seeded defects. A green ordinary unit test does not replace a mutation gate for
the context/rules/content invariants those runners own.

## Review checklist

- Is the implementation authoritative in the server/store rather than UI-only?
- Did both stores change, or is the deliberate store difference documented and tested?
- Could any response, event, error, log, metric, preview, or cache reveal a hidden field or identity?
- Are lock order, idempotency, retries, expiry, cancellation, and lifecycle cleanup explicit?
- Does protocol/capability absence fail closed without showing dead controls?
- Are local mode and personal data unchanged?
- Are merged, deployed, enabled, and externally proven claims separated?
- Are historical test totals clearly historical? Record exact-head commands and SHAs for new evidence.
- Is integration a normal descendant commit with each contributing session's provenance preserved, rather than a
  rewritten branch history?

## Documentation surfaces

Use `docs/hub/README.md` as the index. Update the closest current contract:

- route/error: `api-reference.md`;
- event/audience/replay: `event-catalog.md`;
- authority/flow: `architecture.md` or `domain-model.md`;
- privacy/threat boundary: `security.md`;
- capability/status/limits: `roadmap.md` and `implementation-status.md`;
- requirement mapping: `traceability.md`;
- test ownership: `testing.md`;
- operational behavior: the relevant runbook and `campaign-hub-operations`.

`HubDocumentationContract.test.js` requires indexed docs, contiguous ADR numbers with a `Status:` line, and valid
relative links.
