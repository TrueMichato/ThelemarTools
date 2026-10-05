# Campaign Hub game-day backlog and delivery plan

> **Status:** Prioritized follow-up; private-pilot expansion is **NO-GO**
> **Last reviewed:** 2026-10-01
> **Owner:** Campaign Hub maintainers

This is the sanitized repository tracking record for the 2026-09-28 r10 physical game day and its
relationship to the next gameplay waves. The facilitator's private report is the evidence of record for
observations and the decision; it is not committed here because it includes campaign-specific information.
Keep finding IDs stable when revising this backlog. Do not copy campaign URLs, character data, account
identifiers, provider subjects, tokens, or private evidence into Git.

## Current boundary

- **Deployed:** genuine-provenance `hub-staging-2026-10-01-r11e`, annotated tag object
  `677bf0a7a48d95d628accee793df9b873e6e86ab` at
  `cf9b09f1a8df99e47167528aa37aa2cdfe766e9f`, protocol 5, migrations `0001`-`0009`.
  Exact-head CI, the authorized dry run, human-confirmed promotion, independent runtime/static checks,
  healthy monitoring, and matching release-time off-machine encrypted backup passed. An approved same-tag
  redeploy subsequently enabled the narrow Cure Wounds canary for Campaign A only; independent rollout
  and release-time backup checks passed. Tested physical targeting paths passed as described below;
  this is not private-launch acceptance.
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
- **R11c physical retest:** current browser worker and owner/DM canonical views matched. The first
  Campaign -> Open Local action was blocked by a false `OPERATION_HISTORY_UNAVAILABLE` save guard; it
  never left Campaign mode. Bounded read-only Oracle metadata confirmed no lease, PATCH, domain event,
  or revision change. The server retains the applied effect at its operation watermark, so this is a
  browser reconciliation failure rather than missing server history. No Return/BFCache/two-device
  check ran; the **P1 HARD NO-GO remains**.
- **R11d physical retest:** verified current browser workers and owner/DM canonical views agreed at the
  starting revision. The first Campaign -> Open Local action showed Local authority and a valid Return
  control, but the DM then observed canonical revision **23 -> 24** before Return or any user edit.
  Bounded Oracle metadata found exactly one lease, one `character.patch`, and one projection
  invalidation, with no semantic operation. The patch was a top-level array replacement classified
  as derived-modifier repair; no private values or character body were examined. **HARD NO-GO**:
  Return, BFCache, two-device and targeting retests did not run.
- **R11e physical retest (partial):** fresh owner/DM tabs checked the controlling worker and public
  Character Sheet assets against r11e. Independent, time-bounded server metadata showed that both
  Campaign -> Local and Return to the same canonical character caused **zero lease updates, PATCH
  receipts/events, projection invalidations, or semantic operations**, with stable revision, lease epoch,
  and campaign sequence. Back -> Local -> Forward -> Campaign also made no write, but the browser
  reloaded: BFCache restoration was **not** observed. Opening the character in another owner tab left
  durable revision/events unchanged, proving no canonical write; its observer ran more than 51 hours
  after the approved 20-minute window, so transient lease acquisition is **unproven**. The decision
  owner accepted this specific evidence gap to continue testing; it is **not** a measured no-lease PASS.
  The decision owner reports that the original two-device test succeeded and elected not to repeat it;
  the r10 worksheet did not record the exact offline/concurrent-edit scenario, so this does not close
  historical finding #20. BFCache and the remaining physical game-day gates remain open.
- **R11e Campaign A targeting canary:** separate real GitHub-signed-in caster, target-owner, and DM
  profiles reported XPHB pending/reject/cancel/accept, PHB pending/accept, and self-target pending/accept
  as expected: no cost or heal before consent, none on reject/cancel, and exactly one slot plus one heal
  on acceptance. Self-target advanced one revision, DM truth agreed, and the picker omitted private,
  out-of-campaign, and DM-only characters. These are participant-reported UI observations, not
  independently quantified character/operation database evidence. Natural expiry was **not physically
  tested** (automated coverage only). A bounded post-canary host-health check passed; recheck the newest
  off-machine backup before any later live scenario.
- **Next source correction, deployed and partially physically proven:** r11d's earlier coverage fix addressed two client gaps:
  loading a character cleared the newly fetched live coverage while detaching the previous subscription,
  and canonical projection reads dropped their envelope's operation watermark. The narrow correction
  preserves the freshly fetched coverage, clears only the previous character on switch, and retains
  the authorized watermark without writing it into character data. A separate full-stack transfer
  retry interleaving exposed a successful proposal response discarded after an authorization-generation
  change, leaving a false "outcome not confirmed" state; control restoration could also apply a
  pending-draft snapshot after that draft settled. The client now defers definite confirmation until
  the current projection is authorized and reads proposal state when restoring controls, while
  preserving unconfirmed auto-resolution. Red-first route/transfer tests and the full local Hub and
  Character Sheet Jest suites pass; the complete disposable stack passed 59/59 PostgreSQL checks
  and 47/47 browser journeys on the candidate. Exact-head CI run `36841354346` passed
  migration/roles and affected regressions but stopped before real-stack E2E when a newly
  disclosed high-severity Fastify advisory failed the production dependency audit. The
  follow-up pins the fixed `fastify@5.12.5`; local production audit reports zero vulnerabilities.
  The entitlement browser probe now honors a server-supplied bounded `Retry-After` when other
  serial journeys exhaust the shared IP's campaign-creation quota, without relaxing the 201/403
  authorization assertions or the server limit. The full dependency-updated local stack passes
  59/59 PostgreSQL checks and 47/47 browser journeys. Exact-source CI run `36843468676`
  passed all four jobs at `a247865bf47c8d324a1d808d99e968af54ae9c88`, including
  59/59 PostgreSQL checks and 47/47 real-stack browser journeys. Independent review and
  another separately authorized release remain pending; passing CI did not reverse the
  physical P1 HARD NO-GO. A bounded read-only comparison in the affected DM view found three
  mechanically identical class-feature modifiers whose IDs all drifted after the late
  class-effect reapply. Synthetic red-first tests now preserve exact IDs across late class
  and Divine Favor reapplication, but mint new IDs for changed effects. A separate synthetic
  browser regression exposed `undefined` fields in derived arrays being diffed even though
  JSON transport omits them; Hub snapshots now compare the actual wire shape. Focused
  repository/Character Sheet tests and the real-stack subclass route pass with **zero lease,
  zero PATCH, and a stable revision**. Exact-head CI `36884099946` passed all four jobs at
  `cf9b09f1a8df99e47167528aa37aa2cdfe766e9f`; r11e deployed that commit with no migrations.
  Additional three-profile, PostgreSQL metadata and privacy assertions were verified locally after
  deployment but are not part of the immutable r11e tag. The bounded first-leg and Return observations above
  supply physical evidence; later scenarios retain separate gates.
- **R11b-to-r11c history:** read-only audit confirmed one ordinary character PATCH at
  the route transition (revision 22 -> 23). Synthetic red-first tests found that Fighter's synthetic
  Second Wind pool was re-minting a generic `resources[]` row, while source-managed modifier IDs also
  drifted on load. The r11c source fix prevents the duplicate and reuses exactly matching derived
  IDs; transfer refresh also retains in-flight currency input and explains an uncertain retry.
  Exact-head CI run `36707653142` passed all four jobs, including 47/47 real-stack browser journeys.
  These gates did not include the now-observed older-effect/ordinary-patch load interleaving.
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
  r11b, r11c, r11d and r11e releases passed their exact-head CI, dry run, human-confirmed promotion, and independent
  post-release checks without rollback. DB/BFF/static/edge are healthy, one BFF serves, the ledger is unchanged,
  outbox/dispatcher are clear, and the deployed static/service-worker hashes match the public assets.
  The r11e release-time encrypted prerelease archive matched off-machine by filename, size, and SHA-256
  at post-release verification; newer scheduled backups require a fresh comparison.
  The later same-tag targeting canary redeploy passed exact runtime/rollout and off-machine backup checks.
  **Campaign A alone is enabled; the tested physical targeting paths passed, but private-launch GO
  and the untested paths remain open.**
- **Targeting canary decision:** the decision owner chose a single-campaign safety canary for the
  existing PHB/XPHB Cure Wounds slice, followed by a supported campaign-level targeting policy rather
  than a permanent operator-managed allowlist. The separately authorized same-tag dry run and
  human-confirmed redeploy passed; the live BFF advertises the enabled contract for only the intended
  Campaign A, while the other active campaign remains disabled. The live pre-cutover campaign-readiness
  check passed for exactly one campaign; the dry run alone did not execute it. PHB/XPHB and self-target
  proposals have now been exercised physically, but natural expiry has not. Disabling after this
  configuration-only redeploy requires separately approved
  config reversal and redeploy; application image rollback alone would not remove the allowlist.

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
| P1 | **GD-FIND-014** | R11e's physical Campaign -> Local -> Return and Back/Forward reload each passed bounded no-lease/no-PATCH/stable-revision checks. A fresh owner tab made no canonical write, but the >51-hour observer delay leaves no-lease unproven; the decision owner accepted this gap for continued testing, not as a measured PASS. Actual BFCache restoration was not observed. | Preserve the core route PASS without claiming full closure. BFCache, the missing fresh-tab lease evidence, and the exact historical offline two-device sequence remain unproven; any new divergence restores a hard stop. |
| P2 | **GD-FIND-012** | The absent selector was a disabled rollout, not a missing spell template. Exact Campaign A-only enrollment and real-profile physical XPHB reject/cancel/accept, PHB accept, self-target accept, and picker privacy now pass by participant report; no early cost or duplicate effect observed. | Record the narrow capability as exercised, not broad targeting. Natural expiry remains automated-only and PHB reject/cancel were not repeated physically; decide whether that residual evidence is acceptable before any private-launch GO. Other campaigns remain disabled. |
| P2, source fix not deployed | **GD-FIND-003** | A disposable multi-user browser test reproduced the shared-profile disclosure closing when an ordinary realtime roll triggered an authorized roster refetch: `renderPartyRoster` replaced the open `<details>` node and lost its state/focus. A local correction keeps the same authorized character's disclosure open and summary focused on ordinary refresh; hiding identity closes it. Local full Hub Jest (1,629) and disposable PostgreSQL/browser stack (62/49) passed after the integrated P2 changes. | Reviewed exact-head CI/release and physical recheck are still required; do not label the r11e browser fixed. **Overview UX**. |
| P2, source fix not deployed | **GD-FIND-006** | Inventory **Share** began a second step in a lower sheet panel without moving focus, scrolling to, or announcing it. A local correction labels Share as a multi-step action, moves focus and viewport to Quantity, and announces that no item has moved. Cancel returns focus to Share; red-first browser evidence, affected Sheet Jest (202), full Hub Jest (1,629), and disposable PostgreSQL/browser stack (62/49) passed. | Reviewed exact-head CI/release and physical recheck remain; no asset loss was reported. **B0/B2**. |
| P2, source fix not deployed | **GD-FIND-007** | Recipients previously had to visit Campaign Hub to discover and resolve a player transfer. A local Sheet correction adds an owner-scoped notice near the sheet header with item/source summary and inline Accept/Reject through the existing server-authorized transfer API. Pending state arrives live and survives reload; identity concealment removes old details before refetch, lost responses use one bounded authoritative retry/read before claiming a terminal outcome, and access loss fences late actions. Red-first browser evidence, affected Sheet Jest (202), full Hub Jest (1,629), and disposable PostgreSQL/browser stack (62/49) passed after integration. | Exact-head review/CI/release and physical recipient confirmation remain; the r11e Sheet still lacks these controls. **B1/B2**. |
| P2, source fix not deployed | **GD-FIND-009** | After one of two requests for the same stash item was approved, the losing request stayed visibly pending for manual rejection. The local candidate now atomically cancels only definitively insufficient proposed losers on an approved/direct stash debit or stash-backed award, preserving affordable requests and adding `source_insufficient` reason/event/audit. The losing player's open Sheet announces the outcome and the DM inbox clears without manual rejection. Red-first Memory/PostgreSQL and multi-user browser tests pass, including concurrent approvals; integrated full Hub Jest (1,629), affected Sheet Jest (202), and disposable PostgreSQL/browser stack (62/49) pass. R11e still has the old behavior. | Reviewed exact-head CI/release and physical contention/reconnect confirmation remain; verify conservation, event audience and no duplicate asset. **B4**. |
| P2, confirm contract | **GD-FIND-013** | A roll did not appear live in the same owner's other-device roll log; UI warned of that limitation. Refresh/reopen was not tested. | Decide expected live versus refresh-only contract, then prove owner/DM audience, two-device delivery, replay/reconnect, no duplicates, and privacy; label a deliberate limitation clearly. **Roll-history UX**. |
| P3 | **GD-FIND-004** | **Add local character** lacked direct create/open-sheet/import choices. | Offer clear routes to create, open, or import without making a local copy appear campaign-authoritative; keyboard/mobile coverage. **Character entry UX**. |
| P3 | **GD-FIND-005** | Sharing Settings lacked per-section collapse and an advanced overrides disclosure. PR #289 covers only the outer section. | Preserve draft values/focus through nested open/close and rerender; separate basic sharing from advanced overrides and test both entry paths. **Sharing UX**. |
| Design | **GD-FIND-002** | DM requested bounded provider/account-source context; peer sharing should be optional and default hidden. | Decide which account facts, roles, consent and audience are allowed; test absence of provider subjects and hidden details from peer/network projections. **Privacy decision**. |
| Design | **GD-FIND-008** | Participants want fewer routine stash approvals, transparent withdrawals and shared-weight handling. | Decide custody, concurrent debit/approval, carry ownership, activity and notifications before changing inventory authority. **B0/B3 decision; ADR if authority changes**. |
| Design | **GD-FIND-010** | DM requested direct player-sheet editing/transfers with player notification; current arbitrary edit authority is intentionally limited. | Choose explicit typed, auditable DM operations and recipient notices; do not bypass owner leases or grant arbitrary writes. **Wave A/B authority decision**. |
| Design | **GD-FIND-011** | A condition installed only as personal/site homebrew was unavailable in campaign authority, as designed. | If desired, design an explicit reviewed publish/select-to-campaign flow; never silently import personal brew. **Content-publication decision**. |
| Resolved at r11e verification; recheck each operation | **GD-FIND-001** | R11e's prerelease archive and the newer 2026-10-04 scheduled archive matched the trusted second machine by filename, size, and SHA-256 after separately authorized pulls. The off-machine copy fell behind between checks and blocked a scenario until refreshed. | Preserve bounded release/backup evidence; recheck newest host/off-machine copy and restore age before each later scenario or promotion. **Operations**. |

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
3. **Keep release identity separate from game-day acceptance.** The r11b, r11c, r11d and r11e corrections were
   deployed from reviewed, immutable annotated tags; the initial r11 attempt rolled back and is not
   a deployment, and its tag remains immutable and unused. R11e's runtime and backup evidence passed
   and its bounded physical core-route checks found no writes; later BFCache and fresh-tab lease evidence
   remain incomplete as described above. Every *future*
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
