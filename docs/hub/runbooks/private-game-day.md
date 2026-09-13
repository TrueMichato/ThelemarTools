# Runbook: private one-DM/two-player game day

> **Status:** Ready to execute after V1-G1 is fully green; this document is not game-day evidence
> **Owner:** Campaign Hub operator and game-day facilitator
> **Participants:** one DM and two players using real GitHub OAuth on physical devices

## Purpose

This is the final private-V1 product exercise. It checks that three real people can use the deployed Campaign
Hub through ordinary browser controls without developer guidance, database edits, test authentication, or
private-data leakage.

The run has two separate outcomes:

- **technical result:** each scenario has the expected authoritative, realtime, privacy, and recovery behavior;
- **launch decision:** the maintainers explicitly record **go** or **no-go** after reviewing evidence and defects.

Writing or rehearsing this runbook does not complete V1-G2. Only a completed physical session with recorded
evidence and an explicit decision does.

## Beginner's model

- A **campaign** is the online room containing members, shared rules, characters, activity, and party inventory.
- A **local character** exists only in one browser profile. A **campaign character** is stored by the Hub and
  can synchronize between authorized devices.
- The **DM** can manage the campaign and see the full authorized character view. Players see only the sharing
  projection chosen by each character owner.
- An **invite** grants one account access to one campaign with one role. It is not a general registration link.
- The server is authoritative. If two devices disagree, do not decide which one "looks right"; capture the
  evidence and let the documented lease/revision behavior resolve it.

## Hard prerequisites

Do not start until every item below is true:

- V1-G1 is recorded complete, including genuine scheduled maintenance and backup timer executions.
- The deployed release tag, tag object, commit, BFF/static image IDs, and migrations are recorded.
- `/api/ready`, HTTPS, OAuth, WebSocket, protected metrics, monitor heartbeat, disk, memory, outbox, maintenance
  age, backup age, and restore-drill age are healthy.
- The newest encrypted backup exists both on Oracle and a second trusted machine with matching SHA-256.
- The latest isolated restore and rollback evidence meets RPO <=24 hours and RTO <=4 hours.
- One operator can access the Oracle host and the incident/rollback runbooks but will not improvise destructive
  commands.
- The three GitHub accounts are on the private allowlist. Do not paste numeric subjects, tokens, cookies, invite
  tokens, monitor URLs, or OAuth material into the worksheet.
- Campaign A was created before the approved release/configuration window, has an active immutable rules version,
  and its exact UUID passed the [peer source-cost rollout](peer-source-cost-rollout.md) pre-cutover check.
- Campaign B is not present in `HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS`. Production wildcard rollout is forbidden.
- Each participant understands that staging uses synthetic game content only. Do not upload real private notes,
  personal information, or an irreplaceable character.

## People, devices, and responsibilities

| Role | Minimum device | Responsibility |
|---|---|---|
| Operator | DM's separate terminal/profile, or an optional fourth observer's desktop | watches health and records timestamps between scenarios; does not mutate the host without a separate approved action |
| DM | desktop or laptop | owns both campaigns, controls rules/homebrew, observes DM-only data, grants items/XP, and resolves party transfers |
| Player A | desktop/laptop plus a second browser or phone | owns the primary spellcasting character and performs the multi-device/concurrency checks |
| Player B | phone or tablet plus a desktop-capable browser | owns the target character and verifies mobile, privacy, targeting, and reconnect behavior |
| Recorder | may be the operator | records check IDs, result, sanitized screenshots, correlation IDs, defects, and the final decision |

The true minimum is three people: the DM also performs the operator/recorder checks while play is paused between
scenarios. A fourth non-playing observer may take those duties, but is not required. No one mutates the host
during play without stopping the game day and obtaining separate approval for the exact action.

Use separate browser profiles. Private/incognito windows are acceptable if they retain cookies for the duration
of the scenario. Disable password sharing and screen sharing before any OAuth or invite action.

## Test data and campaign layout

Create only synthetic data:

- **Campaign A:** `Game Day - Red Sails`
  - DM: owner/DM;
  - Player A: player;
  - Player B: player.
- **Campaign B:** `Game Day - Blue Lantern`
  - DM: owner/DM;
  - Player A: player;
  - Player B: no membership.
- **Player A character:** `Aster`, a character able to cast PHB or XPHB **Cure Wounds**, with at least two
  first-level spell slots and one ordinary inventory item.
- **Player B character:** `Bryn`, with enough maximum hit points to demonstrate healing and a deliberately
  restrictive sharing profile.
- Use a harmless campaign-only homebrew item or rule label that contains no personal information.

The two-campaign layout makes privacy visible: Player A can switch between campaigns, Player B must never discover
Campaign B, and Campaign A rules/homebrew must not leak into Campaign B or local mode.

Create both campaigns during the approved setup window before the release used for the game day. Publish and
activate a baseline immutable rules version for Campaign A, then enroll only Campaign A's exact UUID through the
[peer source-cost rollout](peer-source-cost-rollout.md). This deployment/configuration mutation requires separate
operator approval and must use the immutable release procedure; do not edit campaign rows or restart the BFF with
ad hoc commands. Campaign B deliberately remains unenrolled.

## Evidence rules

Create one private worksheet before starting. For every check record:

- check ID, UTC start/end time, participant and device/browser;
- pass, fail, blocked, or not run;
- expected result and one-sentence actual result;
- deployed release tag/commit and browser version;
- sanitized screenshot or screen recording when visual/realtime behavior matters;
- request correlation ID from the UI/log only when troubleshooting is required;
- defect ID and severity for every unexpected result.

Never record OAuth codes, cookies, invite tokens, full API bodies, monitor URLs, character JSON, private notes,
or database connection strings. Crop screenshots to the relevant UI and review them before sharing.

## Preflight

1. The operator records the release identity and runs only the normal read-only health checks from
   [Oracle host operations](oracle-operations.md).
2. Confirm the latest monitor heartbeat is Up and the latest maintenance, backup, and restore evidence is within
   policy.
3. Confirm the newest off-machine archive hash matches Oracle.
4. Record the four live container IDs and restart counts.
5. Confirm no unresolved P0/P1 defect exists.
6. Confirm all participants can reach the HTTPS Hub page while signed out.
7. Confirm the release evidence records `peer_source_cost_rollout=passed` plus the preflight-output hash, and
   record the expected configured campaign count from the preflight output without copying the protected
   environment file into the worksheet.
8. Through the normal authenticated application, confirm Campaign A advertises the exact protocol-4 peer
   source-cost capability and Campaign B advertises `enabled: false`.

If any check fails, stop before invitations and use the triage section below.

## Scenario sequence

Run the checks in order. Do not skip ahead after a stop condition.

### GD-01 — real OAuth and separate sessions

1. DM, Player A, and Player B each sign in through GitHub on their own device/profile.
2. Each person confirms the Hub shows only their own account/session state.
3. Refresh each page once.

**Expected:** every account remains signed in after refresh; no participant sees another person's account data;
the operator sees no authentication-error spike or secret-bearing log.

### GD-02 — two campaigns and invitations

1. DM confirms the prepared Campaign A and Campaign B identities match the private change record.
2. DM creates separate player invites for Player A to both campaigns and Player B to Campaign A only.
3. Each player redeems only their intended link.
4. Try to reuse one consumed link, then revoke one unused replacement invite and try it.

**Expected:** intended memberships appear once; consumed/revoked links fail clearly; Player B cannot list, open,
or infer Campaign B; no invite token appears in evidence.

### GD-03 — role and permission boundaries

1. Player A and Player B try to open DM-only workspace/administration controls in Campaign A.
2. Each player tries one DM-only action such as changing a role or granting XP.
3. DM opens the same controls.

**Expected:** player UI hides or explains unavailable controls and direct navigation/API attempts fail; DM access
works; denial does not reveal private resource existence beyond the user's authorized view.

### GD-04 — local copy and multi-device character synchronization

1. Player A creates `Aster` locally, then uses **Add cloud copy** for Campaign A.
2. Confirm the local original still exists and the campaign copy has a distinct authoritative identity.
3. Open Aster on Player A's second device/profile.
4. Change one safe field on the first device, save, and observe the second device.
5. Refresh both devices.
6. Player B creates `Bryn` locally, then uses **Add cloud copy** for Campaign A.
7. Confirm Bryn's local original remains separate and its Campaign A copy opens for Player B.

**Expected:** the cloud copy synchronizes, the local original is unchanged, the second device receives or
recovers the authoritative update, Bryn is available for the later privacy/targeting checks, and no duplicate
character appears.

### GD-05 — campaign rules and homebrew isolation

1. DM activates a distinctive campaign rule and one harmless campaign homebrew entry in Campaign A.
2. Player A confirms both are visible in Campaign A.
3. Player A opens Campaign B and a `?local=1` Character Sheet.
4. Switch repeatedly between A, B, and local mode.

**Expected:** Campaign A context applies only in A; Campaign B keeps its own rule/content version; local mode
uses personal content only; switching or access loss clears the prior temporary overlay before the next one is
used.

### GD-06 — DM visibility and player privacy

1. Player B sets Bryn's sharing profile to a restrictive preset and hides at least one supported field.
2. DM opens Bryn from Campaign A.
3. Player A opens Bryn's peer projection.
4. Player B edits the hidden field and saves.

**Expected:** Player B sees owner truth; DM sees the authorized full/preview view; Player A sees only the selected
peer projection; realtime invalidations do not leak the hidden value in activity, Party Tracker, targeting, or
logs.

### GD-07 — XP and item awards

1. DM grants a small XP amount to Aster.
2. DM awards a known catalog item, such as `Longsword|PHB`, to Aster and Bryn.
3. Player A changes unrelated form state before acknowledging the award.
4. Both players refresh their sheets.

**Expected:** XP and each item apply exactly once, unrelated local state is preserved, source/quantity are
correct, activity is readable, and retries do not duplicate the award.

### GD-08 — shared inventory and transfer

1. Record Aster's and the party inventory's relevant item/currency balances.
2. Player A offers one awarded item plus small CP/SP/GP amounts to party inventory.
3. DM reviews the human-readable source, item, quantities, and destination, then accepts.
4. Player A creates a second bounded offer of 1 CP; DM rejects it.
5. Player A creates a third bounded offer of 1 SP and uses **Cancel** before the DM resolves it.
6. DM transfers part of the accepted party stack to Bryn.
7. Repeat one completed accepted request from browser history or retry UI if available.

**Expected:** assets are reserved before acceptance, conserved exactly across source/destination, never duplicated,
and replay returns the existing outcome. The rejected 1 CP and sender-cancelled 1 SP each return exactly once to
Aster's original source identity; neither reaches party inventory or creates a duplicate.

### GD-09 — cross-character Cure Wounds

1. Reduce Bryn below maximum HP using an ordinary supported flow.
2. With Aster's campaign sheet already open, confirm the selector is available for the character's exact PHB or
   XPHB Cure Wounds source. If it is absent, reload once; if the authoritative Campaign A capability is still
   enabled but the selector remains absent, record a P2 defect and stop this scenario.
3. Player A targets Bryn with Cure Wounds.
4. Before Player B responds, verify Aster's spell slot has not been consumed.
5. Player B rejects once; repeat and accept once.
6. Repeat the proposal-and-acceptance check with the other supported PHB/XPHB Cure Wounds source using a second
   synthetic caster when necessary.

**Expected:** rejection changes neither HP nor slot; acceptance atomically spends exactly one valid slot and heals
Bryn once; both exact spell editions work without enabling another spell or target type; both sheets converge;
private character details are absent from unrelated users and logs.

### GD-10 — roll history and visibility

1. Each player makes a representative Character Sheet roll.
2. DM makes or records a DM-visible event.
3. Refresh/reconnect one participant and inspect recent activity.

**Expected:** readable actor/action labels, correct ordering, no duplicate after replay, and role-filtered detail.
Internal IDs or raw private payloads must not be shown as user-facing history.

### GD-11 — simultaneous editing and stale-writer protection

1. Open Aster on Player A's two devices.
2. Acquire the active editor on device 1 and make a saved change.
3. Attempt an overlapping edit from device 2, then use the offered takeover/recovery flow.
4. Repeat with two disjoint changes when the UI supports reconciliation.

**Expected:** only one lease owner writes at a time; the stale device is fenced; no silent overwrite occurs;
recovery explains which version won; disjoint local work is preserved only through the supported reconciliation
path.

### GD-12 — reconnect and network loss

1. On Player B's device, disable network access without closing the page.
2. Observe the offline/reconnecting state and attempt a write.
3. While Player B is offline, DM changes Bryn or Campaign A.
4. Restore the network and wait for normal reconnect/resync.

**Expected:** offline writes do not pretend to succeed; loaded data is visibly stale/read-only where required;
reconnect refreshes authoritative state without duplicates; the WebSocket returns to live state.

### GD-13 — campaign isolation

1. Player A opens Campaign A and Campaign B in separate profiles or devices.
2. DM changes a rule, inventory entry, and character in Campaign A.
3. Observe Campaign B and ask Player B to navigate directly to a copied Campaign B URL.

**Expected:** Campaign B receives none of Campaign A's state/events/content; Player B gets a non-disclosing denial;
active-campaign selection remains device/account scoped.

### GD-14 — logout, revocation, and expiry behavior

1. Player B logs out while a campaign page is open, then uses browser Back and refresh.
2. Player A opens a second session and revokes that session from the first device.
3. Observe both an open page and a later API/navigation attempt on the revoked device.
4. Review automated expiry coverage and the configured session TTL. Do not shorten production TTL or edit the
   production database merely to force natural expiry during the game day.

**Expected:** logout/revocation clears private UI and closes realtime access; cached navigation cannot recover
authorized data; later requests require sign-in. Record natural TTL expiry as covered by the release's automated
tests unless it genuinely occurs—never label revocation as observed natural expiry.

### GD-15 — mobile and desktop usability

On at least one phone-sized viewport and one desktop, repeat the core path: Hub list, campaign overview,
character open, incoming action, party inventory, recent activity, and sign-out.

**Expected:** controls remain reachable and labeled, primary targets are usable without precision tapping,
focus/keyboard behavior is visible on desktop, no horizontal layout blocks the task, and status/error text does
not rely on color alone.

## Operator observation during the run

Use read-only checks. Record aggregates, not content:

- readiness and live container IDs/restart counts;
- HTTP/auth/WebSocket error rates;
- connected sockets and reconnects;
- outbox pending/failed/age;
- database connection/statement health;
- disk/memory/CPU;
- backup, maintenance, and restore-evidence age;
- Healthchecks heartbeat state.

Do not tail participant payloads or dump rows. Use correlation IDs and aggregate metrics first.

## Defect severity and triage

| Severity | Meaning | Required action |
|---|---|---|
| **P0** | tenant/private-field leak, account takeover, secret exposure, destructive data corruption, or production-wide outage | stop immediately; preserve evidence; follow [incident response](incident.md); no-go |
| **P1** | lost/duplicated asset, unauthorized mutation, unrecoverable character/campaign state, broken login for an allowed participant, or failed recovery invariant | stop the affected scenario; do not continue to launch decision; no-go until fixed and re-run |
| **P2** | major workflow fails but data/security remain safe and a clear workaround exists | record and decide explicitly whether unaffected checks may continue; default no-go for private launch |
| **P3** | cosmetic, wording, minor responsive, or low-impact usability issue | record with screenshot; may continue if it cannot mask a higher-severity problem |

Each defect report must include release, check ID, role/device/browser, sanitized steps, expected/actual result,
reproducibility, user impact, relevant correlation ID, and sanitized media. Never attach tokens or private data.

## Stop and rollback criteria

Stop the game day immediately for:

- any P0 or P1;
- tenant/campaign isolation uncertainty;
- a private-field leak;
- lost or duplicated inventory/currency/XP;
- repeated unexplained stale state;
- readiness failure, database errors, failed outbox, or live-container replacement/restarts;
- stale backup/restore evidence or a Down external monitor.

The operator declares the stop; participants stop writing and leave affected pages open only long enough to
capture sanitized evidence. Do not improvise SQL, reverse migrations, restore over production, run Compose
`down`, prune Docker, or move/delete release tags. Follow [incident response](incident.md) and
[application/database rollback](rollback.md). Any Oracle or GitHub mutation requires its own explicit approval.

## Cleanup

After evidence is captured and cleanup is explicitly approved:

1. Revoke unused invites.
2. Sign out all game-day browser sessions and revoke forgotten secondary sessions.
3. Archive the two synthetic campaigns, or retain them only when a defect reproduction requires it.
4. Remove local synthetic character copies and downloaded exports from participant devices.
5. Confirm personal homebrew and local-only characters were not changed.
6. Re-run read-only readiness, outbox, backup-age, monitor, container identity, and restart-count checks.
7. Store the sanitized worksheet/media in the approved private evidence location.

Do not delete backups, operational rows, release evidence, or production database rows as casual cleanup.

## Final go/no-go checklist

Record exactly one decision owner and one UTC decision time.

- [ ] V1-G1 was green before invitations.
- [ ] Every GD-01 through GD-15 check is pass or has an explicitly accepted non-blocking disposition.
- [ ] No P0/P1 remains open.
- [ ] No tenant/private-field leak occurred.
- [ ] Inventory, currency, XP, spell slots, and HP remained conserved/exactly-once.
- [ ] Multi-device edits, reconnect, logout, and revocation recovered visibly.
- [ ] Campaign rules/homebrew and active context stayed isolated.
- [ ] Mobile and desktop core tasks were understandable without developer intervention.
- [ ] Production remained healthy with unchanged expected release identity.
- [ ] Backup, monitor, outbox, database, and restore evidence remained healthy.
- [ ] Cleanup and participant privacy review completed.
- [ ] Defect list and participant feedback are attached.
- [ ] Decision recorded as **GO** or **NO-GO**, with the reason.

**GO** authorizes only the existing private allowlisted cohort and observation period. It does not authorize
public registration, broader rollout, multiple active BFF replicas, or unreviewed feature enablement.
