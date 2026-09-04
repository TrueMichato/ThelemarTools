# Inspector Feedback — Iteration 5

## Verdict: FAIL

## Acceptance Criteria Check

- [x] Linear ancestry and migration boundary — verified at pre-Inspector HEAD
  `763f65a2e0474b72b84df4f605ced9cc08f77d64`: the merge-base with
  `29eaf1087e3b59ff5184edf8337da340396515c8` is exactly that baseline,
  `merge-base --is-ancestor` succeeds, history is linear, and the 52-file diff
  changes no migration, `0007`, `data/crafting.json`, or other game-data file.
- [x] Shared closed evaluator — verified: the data-only evaluator has closed typed
  decisions, stable error codes, schema/catalog/rule/capability/protocol/pin gates,
  schema-v1 compatibility, and strict nested output validation. Direct probes of
  malformed top-level values and invalid string/number/object surfaces all produced
  decisions accepted by the evaluator's own nested-decision validator.
- [x] Truthful Enforced catalog surfaces — verified: only carry weight and
  encumbrance tiers are Enforced; unsupported Builder/Level Up choice enforcement
  is not claimed, other TGTT/exhaustion behavior is Advisory, and source/species/
  edition entries remain unavailable and Planned.
- [x] Composition and lifecycle replacement — verified: focused tests cover
  activation, rollback, replacement, stale ordering, teardown, local composition,
  and failure recovery. The production `connectionState` listener is bound to
  `_onHubRealtimeConnectionState`, and `live` invokes a generation-fenced refresh
  after a blocked replacement.
- [x] Character Sheet runtime/builder behavior — verified: supported calculations
  use the transient effective projection, destination copy evaluates a cloned state,
  and local/personal serialization remains unchanged. Focused Character Sheet tests
  pass.
- [x] DM/party projection parity — verified: Party Tracker consumes the shared
  evaluated projection, gates TGTT subrules consistently, and does not persist the
  campaign overlay. Focused DM parity tests pass.
- [x] Authoritative atomic server fencing — verified in implementation and focused
  behavior: memory and PostgreSQL create/patch resolve the active policy before
  mutation; invalid basis/protocol combinations reject; active-policy attach,
  clone, and move prepare destination data and remove stale derived carry authority.
  PostgreSQL performs these operations in its transaction.
- [x] Protocol-4/legacy compatibility — verified: schema-v2 carry writes require
  protocol 4 and the exact active immutable rules identity, while schema-v1,
  no-carry, signed-out, and explicit-local paths preserve compatibility.
- [x] Non-destructive documents/serialization — verified: overlays are transient,
  transition preparation clones data, only untrusted derived carry authority is
  discarded, and raw character inputs/personal settings are not rewritten.
- [x] Required deterministic coverage and store parity — verified: focused suites
  cover off/on/rollback/switch/local/stale-order/composition, memory and runtime-role
  PostgreSQL create/patch basis and protocol matrices, successful current writes,
  rejected-write atomicity, and active-policy attach/clone/move. Exact-head
  production-derived CI is terminal and successful.
- [ ] Required mutation evidence — **FAILED**: the store-owner mutants are false
  positives. `loadVariant()` copies `js/hub` and one Character Sheet file but not
  `js/parser.js`. Importing either copied store follows
  `server/src/character-derived-stats.js` to `../../js/parser.js` and throws
  `ERR_MODULE_NOT_FOUND` before `probeMemoryStoreFence`,
  `probeStoreFenceOwners`, or `probeTransitionOwners` examines the mutant.
  The runner treats every probe exception as a killed mutant. Consequently the
  memory fence, PostgreSQL create/patch fence, and destination-transition mutants
  reported as KILLED without executing their claimed owner evidence.
- [x] Full validation within the explicit scope boundary — verified: focused Hub,
  evaluator/lifecycle/DM/authority, and the mutation command as written exit
  successfully, and all four exact-head CI checks are terminal SUCCESS.
  `test:data` alone exits 1: independent detached baseline and HEAD runs each
  produced exactly 424 identical `Missing link` lines (same SHA-256
  `1622bd9307fc5451484d0cde9c751b3b14e5873010cf72a9313fcd11e25eefe4`)
  solely in unchanged `data/crafting.json` and
  `data/bestiary/monstergroups.json`. This is the proven pre-existing,
  scope-forbidden generated-data exception, not a campaign-rule regression and not
  misreported as a passing command.
- [ ] Independent exact-head Inspector pass — **FAILED**: required owner-specific
  mutation evidence is not valid.
- [ ] Draft PR/remote/CI/final handoff — **FAILED in truthfulness only**: PR #241 is
  the sole open draft against exact `multiplayer-hub`, its pre-Inspector remote head
  is the inspected SHA, all four checks are terminal/successful, no review was
  requested, no ready/merge event occurred, and the ancestry/diff/rule/collision/
  clean-state sections are present. However, its claim that independent memory,
  PostgreSQL, and destination owner mutants were killed is false because those
  probes terminate on the missing fixture module.

## Quality Gate

- `npm run test:hub` — PASS: 94 suites passed, 4 skipped; 1,256 tests passed.
- Focused evaluator, Character Sheet lifecycle/campaign, Party Tracker, and
  authority Jest — PASS: 5 suites/74 tests.
- `npm run test:hub:mutations` — command PASS: 7/7 active-context, 23/23
  campaign-policy, and 2/2 authority mutants reported killed; the store-owner
  results are invalid for the reason above.
- `npm run test:data` at baseline and exact HEAD — FAIL: exactly 424 identical
  LinkCheck messages in the same two unchanged generated-data files.
- PR #241 exact-head CI — PASS: `unit-and-supply-chain`,
  `affected-regressions`, `migration-and-roles`, and `real-stack-e2e` are all
  completed successfully.

## Issues Found

1. **Store-owner mutation probes never load the stores.**
   `scripts/test-hub-rules-policy-mutations.mjs` does not copy `js/parser.js` into
   its temporary variant. Both `MemoryHubStore` and `PostgresHubStore` imports fail
   through `server/src/character-derived-stats.js:16`. The broad catch at the
   mutation runner counts this fixture error as a kill. This invalidates
   `memory-store-policy-fence-disabled`, both PostgreSQL owner mutants, and
   `destination-transition-owner-disabled`.
2. **The PR handoff overstates evidence.** Its mutation section explicitly claims
   independent memory/PostgreSQL/destination owner mutations, but those probes did
   not reach the mutant.

## What Must Be Fixed

- Make the mutation fixture load both stores successfully, and distinguish fixture/
  import failures from assertion failures.
- Replace source-presence probes with behavioral probes that fail only when each
  memory/PostgreSQL create/patch and destination-transition owner mutant changes the
  observed atomic behavior.
- Rerun the mutation gate, push the resulting normal Builder commit, await terminal
  exact-head CI, and correct the PR evidence before another Inspector pass.
