# Pitfalls and failure modes

Everything here was measured, not imagined. Each entry comes from a Campaign Hub session that lost real time to
it. The contract references tell you what correct looks like; this file tells you where correctness was actually
lost, so you spend your budget on the parts that historically break instead of rediscovering them.

Read this before starting Hub work. It is short on purpose.

## Contents

- [The single most expensive lesson](#the-single-most-expensive-lesson)
- [Where defects actually cluster](#where-defects-actually-cluster)
- [Recurring defect classes](#recurring-defect-classes)
- [What real multiplayer use broke](#what-real-multiplayer-use-broke)
- [Tooling and harness traps](#tooling-and-harness-traps)
- [Before you claim it is done](#before-you-claim-it-is-done)

## The single most expensive lesson

**Green CI is not evidence that Hub concurrency code is correct.**

PR #263 (offline/queued character writes) went through six consecutive independent exact-head reviews. Every one
of them ran against fully green CI. Every one of them found HIGH blockers anyway — thirteen in total. The review
notes repeat the same phrase: *"found 2 blockers ... despite all CI green"*, *"found 4 blockers ... all CI
green"*.

The blockers were never syntax or coverage. They were sequences: save B queued while save A is in flight and A
fails; a reconciliation that transforms only the newest queued command and leaves earlier snapshots
pre-operation; a resolution that adopts the server document into one track while live state keeps the old one.
No unit test failed because no unit test described a two-command interleaving.

The practical consequence: when you touch queueing, recovery, reconciliation, leases, or identity migration,
**write the interleaving down before you write the fix**. Name the two commands, the failure point, the arrival
order, and the expected end state for every track (accepted, latest-submitted, live, durable recovery, visible
page). If you cannot express the scenario as a sentence, you do not yet understand the bug, and a passing suite
will not tell you.

## Where defects actually cluster

Budget review attention proportionally. This ranking is from observed blocker density, not from file size.

| Area | Why it breaks | Check specifically |
|---|---|---|
| `js/hub/hub-http-character-repository.js` | Owns the offline queue, durable recovery, conflict resolution, identity migration, and lease acquisition at once. Most blockers landed here. | Every queued command reconciled (not just the newest); recovery stores an ordered queue (not one slot); recovery keys scoped to account **and** access mode; canonical-vs-temporary id used consistently in lookup, re-add, lease, and deletion paths |
| Character Sheet ↔ Hub seam in `js/charactersheet/charactersheet.js` | Resolution succeeds in the repository but the visible page keeps stale identity or state. | After any identity or conflict resolution, adopt the full sequence: id, URL, selector/roster, realtime detach/attach, generations, campaign scope — the same sequence an ordinary save uses |
| `server/src/app.js` + `memory-hub-store.js` + `postgres-hub-store.js` | Three files must change together; one is routinely forgotten. | Rejected writes as well as accepted ones; identical stable error shape; no audit/event/outbox/receipt on rejection |
| `server/src/realtime.js`, `character-projection.js` | Late responses and stale generations publish data the viewer may no longer see. | Sequence/generation fencing on every refetch; access loss clears projections before any in-flight response can land |
| Inventory, transfer, award, stash | Item identity and metadata degrade as items move between owners. | Item type/metadata preserved across award and transfer; repeated transfers in one session; stash take/return for both roles |
| Multi-target authority and cleanup | Historical command responses, current permission, workflow reads and lifecycle locks have different clocks. | Preserve the original retry outcome with today's privacy mask; coherent detail/cleanup; exact owner refs; precision-safe recovery pagination |
| Sheet authority installation and recovery scheduling | A fresh connection can deliver work before current context is installed, or recovery can stop after visual convergence. | Readiness barrier through stage/adopt/commit; same-scope automatic recovery; no ghost settled track; next save succeeds |
| Template/resource acquisition | Test fixtures can manufacture links that ordinary character acquisition never creates. | Real source-qualified acquisition, unique reciprocal links, UID/brew contradictions, mirrors across lifecycle and actual HTTP bounds |

For these newer failure classes, read [Semantic and reconnect review](./semantic-and-reconnect-review.md).
They are not solved by reviewing the repository queue in isolation.

## Recurring defect classes

These shapes recurred across unrelated features. Treat each as a question to ask of your own change.

1. **Partial success reported as failure.** The write lands server-side, then a follow-up call fails and the UI
   reports an error and warns about losing unsaved data. The user retries and risks duplicates. Ask: if step 2 of
   3 fails, what has already committed, and what does the user see?
2. **Temporary identity leaking past the create response.** New records live under a client-generated id until
   the server answers. Lookup, lease, recovery, deletion, and realtime attachment must all migrate together, or
   later calls fail with `CHARACTER_NOT_FOUND` against an id the server never had.
3. **One slot where a queue is required.** Storing "the failed command" loses every other queued command. If more
   than one mutation can be outstanding, the durable structure is ordered and complete.
4. **Reconciling only the newest entry.** An authoritative operation must transform *every* queued command's base
   and snapshot atomically. Reconciling the tail lets an older command commit stale state and silently undo
   authoritative changes.
5. **Resolution that updates one track.** Repository state, latest-submitted state, coverage, durable recovery,
   and the visible page are separate tracks. Adopt a resolution into all of them inside the same serialized,
   fenced section, before realtime resumes.
6. **Two entry paths, two behaviours.** The same object reached through the campaign and through the ordinary
   site produced materially different controls and context. Whenever you add a Hub-aware surface, ask what the
   non-Hub path does, and make the difference deliberate and explained rather than accidental.
7. **Metadata lost in transit.** Items moved by a DM or between characters degraded to a generic type and lost
   their data. Moving an asset must preserve its identity and fields, not re-create an approximation.
8. **Works twice, then stops until refresh.** A flow that succeeds a couple of times and then fails permanently
   is almost always an un-advanced version, lease, sequence, or generation — not load. Reproduce by repeating the
   action, never by doing it once.
9. **Convergence that never converges.** Two devices edited the same character while one was offline; afterwards
   each device kept its own value and the DM saw a third. Any offline-capable path needs an explicit,
   testable answer for "which value wins, and how does every observer learn it?"
10. **Merged is not deployed is not enabled.** Implemented capabilities were invisible in real use because the
    deployed release predated them or their capability gate was off. Never infer availability from code being
    present in the branch.

## What real multiplayer use broke

A physical game day with one DM and two players on separate devices produced **twenty findings and a NO-GO
verdict**, against a suite that was green. This is the strongest available evidence about what unit tests do not
catch. The distribution is the lesson:

- **Identity and lifecycle** — creation reported failure despite succeeding; DM edits of a player sheet returned
  `FORBIDDEN` on lease acquisition; `pending-actions` and `projection-policy` returned 404 during page init.
- **Two-flow divergence** — campaign entry and ordinary entry disagreed about sharing controls and context.
- **Sharing legibility** — owners could not tell what peers actually received.
- **Inventory** — items lost metadata on award and transfer; stash take/return worked for one role only;
  transfers failed after the first few until a refresh.
- **Capability rollout** — spell targeting offered no target selector, and Discord/Google sign-in was absent,
  although both had been implemented.
- **Convergence** — the split-brain HP case above.

Two habits follow. First, exercise features with **two accounts on two devices**, including one going offline,
when proving multiplayer acceptance; single-session testing cannot see most of this list. Second, check the
deployed release and capability configuration before reporting that a feature is available to users. A recorded
physical-retest waiver may allow bounded engineering/release continuation; report the waiver, not an invented
physical PASS, and preserve independent launch/enablement holds.

## Tooling and harness traps

These cost hours of debugging that looked like product bugs.

**The semantic registry test option that silently removes production templates.**
`createSemanticOperationRegistry({templates})` *replaces* the production set; `additionalTemplates` extends it
(`server/src/semantic-operation-registry.js:272-274`). A test server that passed `templates` removed Cure Wounds
from the registry, and the resulting E2E failure was chased as a targeting bug. `test/e2e/hub/test-server.mjs`
now uses `additionalTemplates`, and `test/jest/hub/HubCiContract.test.js` asserts it stays that way. Extend
fixtures; do not replace production data in them.

**Inherited Git environment breaks release-automation tests.**
`HubReleaseAutomation.test.js` shells out to Git, so ambient `GIT_ALLOW_PROTOCOL`, `GIT_CONFIG_COUNT`,
`GIT_CONFIG_KEY_*`, and related variables leak into fixtures. `GIT_ALLOW_PROTOCOL=https:ssh` alone caused 3/19
failures. The suite defends itself with `getIsolatedGitEnv()` (`test/jest/hub/HubReleaseAutomation.test.js:14`).
Agent shells frequently set these variables, so if that suite fails in a way that makes no sense, print the Git
environment before suspecting the code.

**Jest open handles.** Hub suites hold sockets and timers. Use the repository's configured scripts, which pass
`--forceExit`; if a run hangs, do not blindly re-run it — bound it with an explicit timeout and force exit. This
repository is ESM: plain `npx jest` does not work. Use `npm run test:hub`, `npm run test:hub:mutations`, or
`npm run test:unit -- <paths> --runInBand --no-coverage --forceExit`.

**Real-stack E2E is expensive and honest.** It runs for several minutes, so order cheap gates first. When it
fails, check whether the failure reproduces on retry: a repeating failure across several specs that all wait on
basic page structure is a shared boot/render regression, not flake. Raising timeouts or relaxing assertions to
get past it hides a real defect.

**A detached picker may be a correct safety fence.** Actual targeting invalidation suspends controls while
context revalidates. A page object that calls this "ready" too early can lose the picker correctly. Trace the
real stack/generations, repair readiness, and retain the product fence. Neither suppressing invalidation nor
recasting automatically is a valid fix.

**A slow run is still a failed run.** Concurrent mutation/Jest/container work once pushed an ordinary Roll
History body over its unchanged limit after stress cleanup had already passed. Those are separate failures.
Keep the original sample, rerun serially without lowering workload or raising budgets, and delete only the
synthetic rows/resources owned by that run. See [Delivery and coordination](./delivery-and-coordination.md).

## Before you claim it is done

- State the exact HEAD you tested and the exact commands you ran. Historical totals from an earlier head are not
  evidence for your change.
- Name at least one interleaving, retry, or reconnect scenario you proved, not only the happy path.
- Say plainly which of merged / deployed / capability-enabled your change reaches, and do not blur them.
- If something remains broken or unproven, say so. Several sessions were slowed because a handoff claimed
  completion that later inspection contradicted; an accurate "not done" is faster than a retracted "done".
