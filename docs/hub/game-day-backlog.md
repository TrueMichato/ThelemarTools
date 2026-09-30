# Campaign Hub game-day backlog and delivery plan

> **Status:** Prioritized follow-up; private-pilot expansion is **NO-GO**
> **Last reviewed:** 2026-09-30
> **Owner:** Campaign Hub maintainers

This is the sanitized repository tracking record for the 2026-09-28 r10 physical game day and its
relationship to the next gameplay waves. The facilitator's private report is the evidence of record for
observations and the decision; it is not committed here because it includes campaign-specific information.
Keep finding IDs stable when revising this backlog. Do not copy campaign URLs, character data, account
identifiers, provider subjects, tokens, or private evidence into Git.

## Current boundary

- **Deployed:** genuine-provenance `hub-staging-2026-09-29-r11b`, annotated tag object
  `a4e5f742eccb3cd007756ce734e1361a4dedd9e8` at
  `a8a70f5f3faeb31bf0f1f2c0d36091723fb3b167`, protocol 5, migrations `0001`-`0009`.
  Independent post-release host/public checks passed at 2026-09-29T16:22Z; this is not physical
  character or targeting acceptance.
- **Physical result:** final **NO-GO** at 2026-09-28T20:02:31Z. GD-FIND-014 is a confirmed P1
  refresh-persistent local/campaign Character Sheet divergence. GD-FIND-012 records that the
  campaign's player-targeting rollout was disabled. Several scenarios lack participant/device evidence.
- **R11b physical retest:** browser service worker matched r11b; initial owner and DM campaign views agreed
  on the same character ID and revision, and the Local copy was clearly separate. Campaign -> Local ->
  **Return to campaign character** reached the same canonical ID but advanced its revision with no user edit.
  Owner/DM visible fields still agreed after return; no data loss was observed. This is a new **P1
  read-only route-write/convergence stop**, not evidence that the original data was overwritten.
  BFCache/new-tab/two-device and targeting retests were stopped pending command/audit correlation and a
  stable-revision fix.
- **Revised source candidate, not deployed:** read-only audit confirmed one ordinary character PATCH at
  the route transition (revision 22 -> 23). Synthetic red-first tests found that Fighter's synthetic
  Second Wind pool was re-minting a generic `resources[]` row, while source-managed modifier IDs also
  drifted on load. The source fix prevents the duplicate and reuses exactly matching derived IDs;
  focused PostgreSQL/browser testing now proves the no-edit route sends zero PATCHes and leaves the
  canonical revision unchanged. The initial source candidate at `86547a9f` passed local Hub and
  Character Sheet suites, but exact-head CI's full-stack transfer journey failed: a projection
  refresh replaced an in-flight 2 SP form entry with its earlier zero draft. A red-first overlap
  regression now protects the input event and the existing stale-generation test in one campaign.
  The first CI attempt also exposed an empty status beside an enabled Retry transfer button; a
  separate red-first response/authorization-fence journey now requires pending guidance and safe
  same-command replay. The currency-only follow-up passed 47/47 browser journeys; the latest
  combined local run passed 45/47, with an unrelated action-form click timeout and a per-IP
  campaign-creation 429; both failed journeys passed together on a fresh isolated stack. Focused
  transfer and no-edit route journeys pass, as do 59/59 PostgreSQL prerequisites and the Hub
  suite. Exact source head `6d930fb5ea7cd1aa3eddf084146c8daba9410667` passed all four jobs
  in CI run `36700531710`, including 47/47 real-stack browser journeys. The local full-suite
  discrepancy remains recorded rather than silently called green. No new tag, deployment, or
  physical acceptance exists; the newest Oracle backup also lacks a verified off-machine match.
  Keep the P1 hard stop until operational and physical gates close.
- **P1 remediation deployed, not physically proven:** [PR #331](https://github.com/TrueMichato/ThelemarTools/pull/331)
  fixes local/campaign route and repository-authority restoration. Its reviewed head
  `7f6c5d37dd7e7bee47b6ca39040eaf607f484179` passed all four CI jobs, including real-stack E2E;
  it merged into `multiplayer-hub` as `df9e0b0a6aba82c19ee4e146209725f6c8ee18e2`.
  Exact-merge review found a retained Party Inventory BFCache generation fence; the normal descendant
  `dd1522955c86a6cbbccf651da5d8e2fcc855f63a` restores attachment and refresh after an authorized
  Back navigation, with red-first unit and real-stack regressions.
  Its r11b release includes the BFCache fix. Local same-ID and real-stack tests did not reproduce a
  canonical Hub overwrite; they cannot establish what happened to the original live character or
  replace the pending physical comparison.
- **Related sharing UX in code, not on Oracle:**
  [PR #289](https://github.com/TrueMichato/ThelemarTools/pull/289) adds an accessible outer sharing
  disclosure. Its exact head `2048973d37198da04681ec86d5a7fb82af49ca1b` passed all four CI jobs,
  including the full projection-privacy journey, but remains an unmerged draft. It does **not**
  implement the nested/advanced disclosure requested in GD-FIND-005.
- **Wave A:** [#285](https://github.com/TrueMichato/ThelemarTools/pull/285) (ADR 0020) ->
  [#286](https://github.com/TrueMichato/ThelemarTools/pull/286) (DM effects) ->
  [#287](https://github.com/TrueMichato/ThelemarTools/pull/287) (source costs, migration 0010) ->
  [#288](https://github.com/TrueMichato/ThelemarTools/pull/288) (multi-target server, migration 0011)
  remain stacked drafts, unmerged/undeployed with their runtime capability default-off. The existing
  delivery hold has **not** been lifted by this document.
- **Release safety status:** the first r11 attempt was interrupted after traffic changed; its evidence
  records exit 130 in deploy, successful compatible rollback to r10, and no schema migration. Its
  placeholder-provenance tag remains immutable and unused. The separately approved, genuinely tagged
  r11b release passed its exact-head CI, dry run, human-confirmed promotion, and independent post-release
  checks without rollback. DB/BFF/static/edge are healthy, one BFF serves, the ledger is unchanged,
  outbox/dispatcher are clear, and the deployed static/service-worker hashes match the public assets.
  The newest verified encrypted prerelease archive matches off-machine by filename, size, and SHA-256.
  **Targeting enrollment remains disabled, and the physical NO-GO has not been reversed.**

Implemented, merged, tagged, deployed, enabled for a specific campaign, and physically proven are distinct
states. A green PR is not a new game-day release. The repository's GitHub Issues feature is disabled; use
this indexed document for actionable tracking until maintainers choose another tracker.

## Prioritized findings

**P1** blocks further writes to the affected live character until an owner and DM compare the refreshed
Campaign Hub character/revision with the DM-authoritative view and the local copy, read-only. **P2** defaults
to NO-GO at the next private-launch gate unless the decision owner explicitly accepts a bounded workaround
and owner. **P3** may follow after launch-blocking regressions. Design feedback needs an authority/privacy
decision before implementation. "Open" means neither a code PR nor a passing CI run has closed the physical
finding.

| Priority | Finding | Observation and current disposition | Next acceptance evidence / lane |
|---|---|---|---|
| P1 | **GD-FIND-014** | The original general-site/local and Campaign Hub routes diverged. PR #331 is deployed in r11b, but its physical return check advanced the same canonical character's revision with no edit. Initial and final owner/DM visible fields agreed, so data loss is not established; historical impact remains unknown. | Correlate the read-only route's command/audit/event and identify the write source. Prove stable canonical revision with no edit across both entry paths, Local return, refresh, BFCache and two devices before another physical run. **Physical re-entry remains blocked**. |
| P2 | **GD-FIND-012** | Cure Wounds targeting was absent because the peer source-cost campaign rollout was disabled. This does not prove a missing server template. | Operator-approved exact-campaign enrollment using the checked-in preflight; physical reject/cancel/expiry/accept/self-target checks with no early cost and one accepted cost/effect. **Release re-entry / Wave A**. |
| P2, reproduce | **GD-FIND-003** | Character-information view opened from Campaign Overview closed after about ten seconds; interaction/timeout conditions were not captured. | Reproduce with pointer and keyboard interaction, distinguish intentional expiry from premature dismissal, keep a readable/focus-safe view, and test the real browser. **Overview UX**. |
| P2 | **GD-FIND-006** | Inventory **Share** began a second step in a lower sheet panel without moving focus, scrolling, or announcing it; action looked stalled. No asset loss was reported. | Focus/announce the next actionable control; distinguish draft/pending/committed states and prove no duplicate submission. **B0/B2**. |
| P2 | **GD-FIND-007** | Recipient of a player transfer got no Character Sheet notice/action and had to discover it in Campaign Hub. | Show a privacy-scoped pending notice and resolution action on the open sheet; verify realtime, reconnect, access loss, and recipient authority. **B1/B2**. |
| P2 | **GD-FIND-009** | After one of two requests for the same stash item was approved, the losing request stayed visibly pending for manual rejection. Refresh recovery was not tested. | Prove one conserved winner, a bounded terminal/invalid loser, matching Memory/PostgreSQL state, fresh inbox after reconnect, and no duplicate asset. **B4**; raise severity if conservation fails. |
| P2, confirm contract | **GD-FIND-013** | A roll did not appear live in the same owner's other-device roll log; UI warned of that limitation. Refresh/reopen was not tested. | Decide expected live versus refresh-only contract, then prove owner/DM audience, two-device delivery, replay/reconnect, no duplicates, and privacy; label a deliberate limitation clearly. **Roll-history UX**. |
| P3 | **GD-FIND-004** | **Add local character** lacked direct create/open-sheet/import choices. | Offer clear routes to create, open, or import without making a local copy appear campaign-authoritative; keyboard/mobile coverage. **Character entry UX**. |
| P3 | **GD-FIND-005** | Sharing Settings lacked per-section collapse and an advanced overrides disclosure. PR #289 covers only the outer section. | Preserve draft values/focus through nested open/close and rerender; separate basic sharing from advanced overrides and test both entry paths. **Sharing UX**. |
| Design | **GD-FIND-002** | DM requested bounded provider/account-source context; peer sharing should be optional and default hidden. | Decide which account facts, roles, consent and audience are allowed; test absence of provider subjects and hidden details from peer/network projections. **Privacy decision**. |
| Design | **GD-FIND-008** | Participants want fewer routine stash approvals, transparent withdrawals and shared-weight handling. | Decide custody, concurrent debit/approval, carry ownership, activity and notifications before changing inventory authority. **B0/B3 decision; ADR if authority changes**. |
| Design | **GD-FIND-010** | DM requested direct player-sheet editing/transfers with player notification; current arbitrary edit authority is intentionally limited. | Choose explicit typed, auditable DM operations and recipient notices; do not bypass owner leases or grant arbitrary writes. **Wave A/B authority decision**. |
| Design | **GD-FIND-011** | A condition installed only as personal/site homebrew was unavailable in campaign authority, as designed. | If desired, design an explicit reviewed publish/select-to-campaign flow; never silently import personal brew. **Content-publication decision**. |
| Resolved; recheck each release | **GD-FIND-001** | Newest encrypted backup was initially absent off-machine and then copied before play. The interrupted r11 attempt required a second copy; successful r11b created another encrypted prerelease archive. The latest Oracle and trusted-machine copies now match. | Preserve bounded release/backup evidence; recheck newest host/off-machine copy and restore age before each later promotion. **Operations**. |

The 2026-09-13 game-day findings are historical, not silently closed by this list. R10 reproduced earlier
entry-path finding #3 and rollout finding #18; its P1 is a *separate convergence-class recurrence*
related to #20, not proof that #20's exact offline/two-device sequence was rerun. Other historical findings
remain untested or insufficiently evidenced unless the private report explicitly says otherwise.

## Release and re-entry plan

1. **Establish live truth without writing.** Compare the affected character's sanitized ID/revision and a
   non-private field summary from refreshed owner Campaign Hub view and DM-authoritative view with the
   separate local view. Record which authority held each value. If canonical data is altered or the
   difference is still unexplained, stop and triage recovery under the current runbook; never copy a local
   document over Hub truth as an ad hoc repair.
2. **Prepare the focused correction candidate.** P1 routing PR #331 is merged into `multiplayer-hub`.
   PR #289 is useful but not required for the P1/targeting retest; keep its separate
   draft hold unless deliberately included. If integrated together, resolve their shared CSS, Character
   Sheet campaign test and campaign-context browser spec with normal descendant commits, no history rewrite.
   Rerun route/convergence and, if included, disclosure/projection-privacy journeys on the *integrated*
   head, plus full Hub, affected Character Sheet, relevant mutation and real-stack gates. The nested
   GD-FIND-005 request remains open either way.
3. **Keep release identity separate from game-day acceptance.** The focused P1 correction is now deployed
   as exact r11b from a reviewed, merged, annotated commit. The initial r11 attempt rolled back and is
   not a deployment; its tag remains immutable and unused. r11b's final release and off-machine backup
   evidence passed, but its routing fix still needs physical owner/DM/local checks. Every *future*
   promotion still requires its own immutable tag, fresh operational preflight, dry run, human-confirmed
   `deploy/hub/release.sh` invocation, and post-release checks. Do not treat a merge or this document as
   authorization for another release.
4. **Enable only the intended targeting slice.** The r10 one-target PHB/XPHB Cure Wounds flow already has a
   separate campaign-ID-gated rollout. Check its current exact release and rules prerequisites; use
   [peer source-cost rollout](runbooks/peer-source-cost-rollout.md) for a separately authorized, exact-campaign
   preflight and enablement. The presence of code or a deployed image does not enroll a campaign.
5. **Repeat the physical gate.** On the actual release and devices, rerun GD-R10-03/06/10 plus incomplete
   GD-R10-01/02/04/07/08/09/11/12 checks, including roles/devices/browsers, privacy, inventory contention,
   offline convergence, and the previously reported P2 findings. Record each result or explicit skip and
   refresh operational preflight. Only the decision owner can replace the final NO-GO with a new GO.

The existing hold on A0-A3 is a delivery decision, not a technical requirement for testing the merged
PR #331 fix or the already-implemented Cure Wounds slice. To physically test **new** Wave A server
capabilities, first decide whether to lift that hold, then integrate A0 -> A1 -> A2 -> A3 in reviewed order;
verify migrations 0010/0011, previous-app/rollback rules, protocol 6, and default-off campaign enrollment
before any promotion. Do not bundle the entire stack into the focused r10 correction release by accident.

## Forward delivery sequence

The r10 backlog is the immediate re-entry work. Approved gameplay development remains a separate sequence,
not a claim that these features have reached the live campaign:

| Wave | Planned scope | Prerequisite / proof |
|---|---|---|
| **A0-A3** | ADR 0020 consent model; immediate DM effect hardening; exact source-cost binding and migration 0010; multi-target proposal/consent/finalization and migration 0011. Draft PRs #285-#288 are held. | A release decision to lift the hold; normal bottom-up integration, schema/role and rollback proof, full Hub/mutation/PG/real-stack, exact-head review. |
| **A4-A5** | One Character Sheet multi-target source/target UX and reconciliation, then reviewed one-to-one and first multi-target healing templates. NPC/monster and arbitrary effects remain deferred. | A3 server authority/protocol 6; template-scoped cost and privacy proof; three-account physical convergence and explicit capability enrollment. |
| **B0-B4** | Shared inventory vocabulary; Hub party inventory home; one player Sheet composer; atomic DM award/stash modes; repeated-use, contention and uncertain-outcome recovery. GD-FIND-006/007/009 feed these slices. | Integrate reviewed Wave A first because shared Sheet, Hub, event and E2E seams overlap; Memory/PG conservation and audience parity, two-user real stack, no refresh requirement. |
| **D0-D5** | Rule authority matrix; TGTT dependency evaluator; shared jumping, linguistics and exhaustion calculations; critical-roll contract last. Existing source/species/edition and carry policies stay enforced; other rules are not silently relabeled. | Integrate B before broad rule/UI changes; prove policy/calculation/mutation/roll authority separately, rollback/teardown parity, Character Sheet/Party Tracker and physical context-toggle checks. ADR 0021 only if structured roll authority changes. |

The detailed implementation handoffs and verification matrix remain in the coordinating session's private
artifacts; this document is the repository-visible priority/acceptance map. Do not convert a design row into
implementation without its decision, or mark a physical finding closed from synthetic tests alone.
