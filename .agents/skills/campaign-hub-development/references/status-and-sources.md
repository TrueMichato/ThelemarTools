# Status and source priority

## What the Hub is for

The Hub adds shared campaigns, player/DM interaction, campaign rules/brew and multi-device access to a
local-first 5etools fork. Preserve ordinary signed-out/local use. The same character or screen should have one
coherent experience whether reached from a campaign or from the ordinary site; differences in authority must
be intentional and legible.

## Establish the baseline, do not memorize one

1. Capture `git rev-parse HEAD`, worktree status and the relevant base/merge base. Distinguish committed source
   from dirty files and a staged pending merge. For a reviewed dirty candidate, include tree/diff identity and
   `MERGE_HEAD` when present; a SHA does not identify uncommitted content.
2. Check the requested ref and whether the objects/files being discussed are reachable in this checkout.
   Compare the remote tip when needed, stating whether it is freshly fetched or a cached tracking ref. A file
   missing locally does not establish absence on another branch. Do not reset/stash/repair the checkout as an
   incidental orientation step.
3. Read `docs/hub/roadmap.md`, `implementation-status.md`, and especially `game-day-backlog.md` for active
   findings, Wave dependencies, decisions and holds. `staging-plan.md` and the relevant release record describe
   environment evidence. Session artifacts may hold newer local review/publication evidence; keep it distinct.
4. Verify protocol, schema, templates and capabilities at their actual definitions, not at a copied baseline:

| Question | Inspect |
|---|---|
| Client protocol and compatible route/event lanes | `js/hub/hub-capabilities.js`, `server/src/app.js`, `server/src/realtime.js` |
| Schema and release compatibility | `server/migrations/`, migration runner/ledger, `deploy/hub/migration-policy.json` |
| Supported effects, costs, editions and bounds | `server/src/semantic-operation-registry.js`, `peer-source-cost-authority.js`, `js/hub/hub-source-costs.js`, template-specific shared definitions |
| Targeting enrollment/readiness | `server/src/peer-source-cost-rollout.js`, `multi-target-operation-rollout.js`, capability response and exact campaign configuration |
| Identity/linking/reauthentication availability | route/provider registry, capability response, implementation records |
| What users actually receive | separately authorized release/config evidence and participant observations |

At the 2026-10-14 skill revision, the checked-out client declared protocol 6 and migration files reached 0014,
while the roadmap still described deployed r11f on protocol 5/migrations 0001-0009 and older held local
candidates. That discrepancy illustrates separate evidence scopes, not permission to declare a rollout.
These numbers are an example, not defaults for future work.

## Separate the delivery states

Track **implemented, independently reviewed, published/CI, integrated/merged, tagged, deployed, enabled and
physically accepted** separately for each slice. Add the exact ref, date and evidence source where it matters.
An exact-head local review is not remote CI; a tag is not a deployed image; a default-off template is not an
enabled campaign; a user-reported canary is not a fresh automated or independently observed result.

Record **measured PASS**, **user-reported**, **unobserved**, **accepted evidence gap**, and **waived** honestly.
Back/Forward navigation does not prove actual BFCache restoration. A physical-retest waiver permits the named
engineering/release step; it neither changes an earlier NO-GO into GO nor lifts gameplay, publication,
deployment, enrollment or private-launch holds.

The sharing work is a useful scope trap: nested Basic/Advanced/field/preview disclosures and a whole-panel
outer disclosure were separate delivery slices. "Collapsible sharing is done" is ambiguous without naming the
surface and its delivery state.

## Source priority depends on the question

- **Runtime behavior:** route schemas, shared authority helpers, both stores, migrations and executable tests.
  The API document defers to the route schemas when they differ.
- **Approved scope and sequencing:** current roadmap/backlog decisions and active authorization. New code or
  a session's completion message does not authorize an additional stage.
- **Current contract:** `architecture.md`, `domain-model.md`, `api-reference.md`, `event-catalog.md`,
  `security.md`, `traceability.md`, and accepted ADR status/superseding notes.
- **Environment state:** independently verified exact release/configuration evidence through
  `campaign-hub-operations`, not the local checkout or a plan.
- **History:** checkpoints, previous review totals, private-V1/post-V1 snapshots and older ADR body text.
  Useful for intent and regression scenarios, not proof at a new head.

When sources disagree, report both scopes/dates and verify the specific question before choosing a conclusion.
Update directly affected stale documentation as part of product work; do not rewrite a release or acceptance
record to manufacture agreement.

For broad architecture changes read `docs/hub/README.md` and the current architecture/domain/API/event/security/
testing/traceability documents. For bounded work, use that index to load the relevant contract and ADRs rather
than reading a frozen numeric ADR range.
