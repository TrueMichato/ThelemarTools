# Runbook: peer source-cost campaign rollout

> **Status:** Current private-V1 procedure
> **Severity:** Configuration-sensitive feature enablement
> **Owner:** Campaign Hub release operator
> **Last drill:** Automated disposable-stack coverage passed; production procedure not yet executed

## Purpose

Enable or disable the narrow protocol-4 peer source-cost capability for specific private campaigns without
database edits or a client-side assumption. This rollout covers only one player-owned character casting PHB or
XPHB **Cure Wounds** with one standard spell slot against one privacy-visible player-owned character.

The capability is deliberately default-off. A campaign receives it only when:

1. its exact UUID is present in `HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS`; and
2. it is active with an active immutable rules version.

Do not use this procedure to enable generic effects, other spells/resources, multi-target actions, or NPC targets.

## Permissions and stop conditions

The DM may create the campaign and publish its rules. Only an authorized release operator may change the protected
deployment environment or recreate the BFF. Treat those as separate approved production actions.

Stop before changing traffic if:

- the campaign UUID is not copied from the intended authenticated campaign;
- the campaign is archived, missing, or has no active rules version;
- the candidate release/image identity is not recorded and immutable;
- the preflight reports any blocker;
- `*`, a non-UUID value, a duplicate UUID, or more than 100 UUIDs appears in the allowlist;
- normal readiness, backup, migration, or rollback prerequisites are not green.

Never update campaign rows manually. Never use `*` outside the isolated automated test stack.

## Prepare the campaign

1. The DM creates the private campaign through the Hub UI.
2. The DM publishes and activates an immutable rules version.
3. Record the exact campaign UUID from the authenticated campaign URL in the private change record.
4. Confirm intended player memberships and sharing profiles. Enrollment does not bypass ownership, membership,
   consent, projection privacy, source-cost, targetability, or rules-pin checks.

## Validate the candidate configuration

1. In the protected `.env.hub`, set `HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS` to only the approved comma-separated
   campaign UUIDs. Blank means disabled.
2. Keep the file owner-only (`0600`) and outside Git.
3. Unset any same-named shell variable. Release automation rejects an ambient
   `HUB_PEER_SOURCE_COSTS_CAMPAIGN_IDS` so Docker Compose cannot silently override the reviewed `.env.hub`.
4. Run a release dry run first. The production parser rejects wildcard, malformed, duplicate, and oversized
   allowlists before the BFF starts.
5. During a real release or approved same-tag `--allow-redeploy`, `deploy/hub/release.sh` runs the candidate BFF's
   read-only preflight after migrations/grants and before traffic changes:

   ```text
   node server/scripts/check-peer-source-cost-rollout.mjs
   ```

   The preflight performs one bounded `SELECT` using the runtime role. It requires every configured campaign to
   exist, remain active, and have an active rules version. Its output contains only counts on success and the
   operator-supplied campaign UUID plus a closed blocker code on failure.

6. Do not bypass a failed preflight. The previous application remains serving traffic because the check runs
   before `traffic_mutated=true`.

## Apply and verify

After explicit approval, use the normal immutable [deploy and promote](deploy-promote.md) procedure. For a
configuration-only change to the currently deployed immutable tag, use that procedure's explicit same-tag
`--allow-redeploy` path; do not run raw Compose on Oracle.

After cutover:

1. Verify `/api/ready`, image IDs, restart counts, and the release evidence field
   `peer_source_cost_rollout=passed`.
2. As an authorized campaign member, fetch the campaign context through the normal application and confirm
   `capabilities.peerSourceCosts` has `enabled: true`, contract version 1, protocol version 4, operation version 1,
   and template registry `peer-effects-v1`.
3. Reload or reconnect Character Sheets that were open during the BFF replacement. The sheet revalidates context,
   clears stale targeting state while unavailable, and activates the selector only after the authoritative
   capability returns.
4. Verify PHB and XPHB Cure Wounds separately. Proposal must consume no slot; reject/cancel must change nothing;
   accept must atomically consume one standard slot and apply one heal.
5. Record release identity, the release evidence's environment-file/preflight-output hashes, the configured
   campaign count printed by the preflight, readiness, and sanitized pass/fail results. Do not record the
   environment file or response bodies.

## Disable or roll back

Remove the campaign UUID from the protected allowlist, obtain separate approval, and use the same immutable release
procedure. New proposals fail closed once the replacement BFF is live. Existing proposals cannot consume a source
cost after the capability is disabled; reject, cancel, inspect, and expiry remain available.

If verification fails, follow [application/database rollback](rollback.md). Do not edit the database, broaden the
allowlist, or use the wildcard as a workaround.

## Escalation

Treat an unauthorized selector, private projection leak, cost without effect, effect without cost, duplicate
application, or rollback bypass as P0/P1 and follow [incident response](incident.md). Treat a missing selector with
a disabled capability as a rollout-readiness/configuration failure until the exact context and preflight evidence
prove otherwise.
