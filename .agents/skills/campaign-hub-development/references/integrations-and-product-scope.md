# Integrations and product scope

## Active campaign context

The stored selection is an account-bound, device-local preference hint, not authorization.

Precedence is resource-pinned campaign, explicit URL, stored selection, then local mode. `?local=1` is an
explicit local route. Character Sheet and DM Screen resources stay pinned while open; another tab may update
the future default but must not silently rebind the current character or workspace.

Teardown is ordered:

1. advance generation and cancel pending work;
2. stop realtime;
3. remove projections/private state;
4. clear campaign rules;
5. clear temporary campaign brew;
6. activate the next verified context.

Never expose old private state under a new context. Primary sources:
`docs/hub/active-campaign-context.md`, ADR 0013, and the `hub-active-campaign-*` modules.

## Character Sheet

- Repository selection is explicit; local/signed-out sheets retain existing local persistence.
- Local-to-campaign is a non-destructive copy. Save local first and do not add Hub ownership metadata to local
  JSON.
- Clone creates an independent character. Move preserves identity, requires compatibility review, saves first,
  releases only this browser's lease, and is idempotent. Another device's lease blocks the move.
- Campaign rules/brew are runtime overlays and serialization strips them.
- Cloud writes, semantic reconciliation, party inventory, and peer targeting must go through the HTTP repository
  mutation queue; do not mutate two authoritative documents in the browser.

Primary seams: `js/charactersheet/charactersheet.js`, `charactersheet-campaign.js`,
`charactersheet-party-inventory.js`, `charactersheet-peer-targeting.js`, and
`js/hub/hub-http-character-repository.js`.

When changing Character Sheet internals, also use `charactersheet-development` and its instruction file.

## DM Screen

- Only active DM/co-DM membership may load a campaign workspace.
- One private Board blob belongs to one membership and uses the same revision/lease/fencing model.
- Live Party Tracker projections are read-only and stay outside serialized Board state.
- Shared stash detail is not copied into the Board; only the authorized in-memory summary is exposed.
- Access loss first fences saves and conceals projections/private workspace state, then clears rules/brew.
- Journey Tracker consumes the existing Party Tracker projection and remains system-neutral.

Primary seams: `js/dmscreen/dmscreen-hub-controller.js`, `js/dmscreen.js`,
`js/dmscreen/partytracker/`, and Hub DM/Party Tracker tests. Also use `dmscreen-development`.

## Rules, content and identity

- Rules versions are immutable. Publish a new version or activate an earlier version; never rewrite history.
- Current enforced surfaces: source/species/edition admission/deltas and carry/encumbrance.
- Current advisory non-content settings: TGTT enabled, exhaustion, jumping, Linguistics bonus, critical rolls.
- Existing disallowed content is grandfathered and reported; it is not silently rewritten or deleted.
- Browser filters explain policy. The server repeats admission/delta checks under the active immutable policy
  identity inside the authoritative transaction.
- Campaign brew augments only the current campaign. Personal brew can narrow availability but cannot widen
  campaign policy, and campaign brew never persists as personal brew.
- Identity authority is `(provider, immutable subject)`. Never link or merge by email, username, login, or
  display name.

Primary sources: ADR 0003, ADR 0014, ADR 0015, `campaign-rule-enforcement.md`, rules/content authority modules,
and policy parity/mutation tests.

Use `5etools-data` when entity/source/edition/brew semantics are part of the change.

## Inventory, awards and targeting

- Transfers use authoritative escrow. Reservation removes the source; terminal accept writes the target, while
  reject/cancel restores the source exactly once.
- Whole-item transfer refuses Character Sheet-linked/equipped/attuned/container state that cannot move safely.
- Atomic DM awards apply one ordered batch to 1-50 unique targets. Every target and optional stash debit commits,
  or none do.
- Browser-supplied items are bounded safe summaries; a stash award supplies the authoritative entry id.
- Carry preview is advisory and privacy-shaped (`known`, `lower_bound`, `unavailable`, `policy_blocked`), never
  invented from hidden fields.
- The only shipped player source-cost targeting flow is one PHB/XPHB Cure Wounds cast, one selected standard
  slot, one privacy-visible player-owned target, and explicit target-owner approval including self-target.
- Pact slots, arbitrary spells/effects, multi-target/party resolution, and NPC/monster targets fail closed.

Primary sources: `docs/hub/domain-model.md`, ADR 0016, ADR 0017, `hub-inventory-contract.js`,
`hub-item-award.js`, `hub-source-costs.js`, and the relevant store/reconciliation/E2E tests.
