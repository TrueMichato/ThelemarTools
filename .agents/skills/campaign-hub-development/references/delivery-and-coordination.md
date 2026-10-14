# Delivery and coordination

Campaign Hub work is usually delivered as several narrow branches developed in parallel and integrated in
dependency order. That parallelism is deliberate and it works, but most of the *non-coding* time lost in past
programs was lost here rather than in the code: lanes waiting on each other, lanes colliding in the same files,
and handoffs that claimed more than was true.

This file is about keeping a lane moving. For the contract rules that govern what you may change, see
[Architecture and authority](./architecture-and-authority.md); for defect patterns see
[Pitfalls and failure modes](./pitfalls-and-failure-modes.md).

## Shared hotspots

Nearly every Hub feature has to touch the same handful of files, which is why independent lanes collide:

```
js/hub/hub-api-client.js          server/src/app.js
server/src/memory-hub-store.js    server/src/postgres-hub-store.js
campaign.html                     docs/hub/{roadmap,implementation-status,testing}.md
test/e2e/hub/*.spec.ts
```

You cannot avoid them, so make the collision small and legible instead. Put the substance of your change in new,
lane-owned modules and keep the edits inside these files to thin wiring. Then say out loud, early and before you
commit, which hotspots you touched — a collision announced at the start is a merge; a collision discovered at
integration is a re-review.

## Scarce numbers must be reserved, not chosen

Some resources are globally ordered, so two lanes picking independently both end up wrong:

- **ADR numbers.** `HubDocumentationContract.test.js` requires contiguous ADR files, each with a `Status:` line,
  each indexed in `docs/hub/README.md`, with valid relative links.
- **Migration numbers.** Migrations are immutable and checksummed; `deploy/hub/migration-policy.json` must gain a
  matching operator-reviewed entry.

The contiguity rule is worth understanding, because it once deadlocked five parallel lanes. Each lane authored an
ADR, and each needed the others' files to exist for the contract test to pass. Lanes sat finished-but-unpushed
waiting for a predecessor; one reported *"I remain blocked on the promised 0011-0013 stack and will not push
early"*, and another proved readiness by running the whole suite while excluding the one contract test it could
not satisfy alone.

So: get your number assigned by whoever is coordinating before you write the file. If you are working alone,
check what is already taken on the branch **and** on any sibling branch you know about. If you are genuinely
blocked on someone else's file, say so immediately with the exact ref you need — do not sit idle, and do not
quietly renumber, because renumbering moves the collision rather than removing it.

## History is append-only

Integration uses ordinary descendant commits. Do not rebase, amend, reset, squash, or force-push a branch that
has been reviewed or handed off, and do not move a tag that has been published. Reviews pin an exact head; if
that head stops existing, every review already performed becomes unverifiable and has to be redone. When a
review finds problems, fix them in a new commit on top and report the old head and the new head.

Do not treat an unreviewed branch as permission to force-update it either. Branch creation, commits, pushes,
integration, tagging, deployment and enrollment are separate actions governed by the current user's
authorization; an old session's standing permission does not authorize them in a new task.

## Review loops are the normal path, not a failure

Hub PRs routinely go through several independent exact-head reviews, and later rounds regularly find real
blockers even when earlier rounds and all CI passed. Plan for that instead of treating the first green run as the
finish line.

Two things shorten the loop measurably:

- **Report the exact head with every handoff.** Reviews are performed against a SHA. "The fix is pushed" without
  a SHA costs a round trip every time.
- **Do not describe work you have not finished.** Sessions were slowed more than once by a handoff that
  announced remediation which the tree did not contain; the correction then cost more than the original task. If
  you have only completed part of it, report exactly that part and what remains.

The same rule applies to artifacts: a plan or document counts as revised when the file on disk contains the
revision. Claiming a revision, or summarising one, is not the same as producing it — one planning loop burned
four rounds on this distinction alone.

Use one canonical owner/candidate and one active review for the same objective. Freeze its exact head/tree/delta
while review runs. Retain the reviewer for bounded same-task closure when appropriate; use a fresh independent
review at the program's required fresh-review boundary, not a new reviewer for every status notification.
Ignore superseded kickoff/candidate messages after checking current state; they once repeatedly requested gates
against an already invalidated candidate.

Scope evidence to the actual tree and command. If a source candidate changes, re-establish affected proof;
never relabel old totals as new. A final landing program may explicitly require a complete exact-head gate
restart, but that expensive procedure is not the default for every small edit.

## CI gates

The Hub workflow (`.github/workflows/hub.yml`) runs four named jobs: `unit-and-supply-chain`,
`affected-regressions`, `migration-and-roles`, and `real-stack-e2e`. Read the workflow on your branch rather than
trusting this list; `real-stack-e2e` is by far the slowest, so order cheaper gates ahead of it.

`affected-regressions` is the one that surprises people: it runs Character Sheet persistence, repository-seam,
campaign-rules, and roll-history suites plus selected DM Screen suites, because Hub changes reach through those
seams. A Hub-only change can fail it. Run that slice locally before asking for review when you touch the
Character Sheet or DM Screen integration.

Supply-chain and image-vulnerability gates fail for reasons unrelated to your diff, such as a newly published
advisory. Fix or waive them deliberately through the documented path; never weaken, skip, or re-run around a
HIGH/CRITICAL finding to get a branch green.

## Running several sessions at once

Parallel lanes are worth it, but they have their own failure modes:

- **Duplicate spawns.** Two sessions for the same task were once created about three seconds apart. Before
  creating a session for a task, check whether one already exists; if you end up with duplicates, pick one as
  canonical and archive the other *while it still has no changes*.
- **Sessions that look busy but are not.** A lane can appear active while it is actually waiting. If a session
  has produced nothing for a while, ask it for a concrete status — current phase, files changed, commands
  running, blockers — rather than continuing to wait on it.
- **Idle-by-design holds.** A lane that is finished, green, and deliberately uncommitted while it waits for
  ancestry is a coordination cost, not progress. If you impose such a hold, say when it will be lifted and what
  will lift it.
- **Shared-machine resource contention.** Parallelize independent implementation/read-only work, but serialize
  heavy Jest, PostgreSQL/container, mutation and real-stack gates when they compete for the same host. Record an
  overlap-induced failure and rerun serially at the original budget/cardinality; do not call it green or enlarge
  timeouts. Keep one owner per gate and clean up only its named resources.

## Before integration

Forecast the merge instead of discovering it. A read-only conflict forecast against the current target branch —
which files collide, which authority or realtime invariants the resolution must preserve, and which targeted
tests to re-run afterwards — turns integration into a known quantity. Past programs did exactly this and it
worked; the ones that skipped it paid at merge time.
