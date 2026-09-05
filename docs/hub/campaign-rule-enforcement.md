# Campaign rule enforcement

> **Status:** Current merged PR #241/#242 enforcement boundary
> **Last verified:** 2026-09-05

Campaign policy has two shared interpretation boundaries:

- `js/hub/hub-campaign-rule-evaluator.js` handles non-content settings and carry/encumbrance decisions. It accepts
  closed, cloneable data and returns a typed decision containing the policy identity, effective settings, applied
  rules, and stable errors.
- `js/hub/hub-content-policy.js` and `server/src/campaign-content-policy.js` handle source/species/edition identity,
  candidate filtering, admission, and authoritative delta enforcement against the generated site catalog plus the
  active campaign-brew catalog.

These evaluators perform no fetch, DOM, storage, or character mutation. Their callers own context loading,
presentation, transaction locking, and canonical writes.

Schema-v2 evaluation requires protocol 4 and `campaign.rules_policy.v1`; schema-v1 remains readable through the
legacy adapter. Unknown schemas, catalogs, rules, rule versions, surfaces, capabilities, protocols, contradictions,
and stale policy pins block without applying a partial overlay. No active rules version means explicit local mode,
which returns personal settings unchanged.

| Rule | Product status | Effective surfaces |
|---|---|---|
| `tgtt.enabled` | Advisory | Character runtime, Builder, Level Up, Quick Build, Respec, content pickers, and DM projection |
| `rules.exhaustion.system` | Advisory | Character runtime and DM projection |
| `tgtt.carry-weight` | Enforced | Character runtime, DM projection, carry-authority writes |
| `tgtt.encumbrance-tiers` | Enforced | Character runtime, DM projection, carry-authority writes |
| `tgtt.jumping` | Advisory | Character runtime and DM projection |
| `tgtt.linguistics-bonus` | Advisory | Character runtime and DM projection |
| `tgtt.critical-rolls` | Advisory | Character runtime and DM projection |
| `content.sources.allowed` | Enforced | Candidate UI; create/import/clone/attach/move admission; direct character deltas; grants/awards; accepted transfers |
| `content.species.allowed` | Enforced | Species/race candidates; whole-document admission; race/species replacement and removal deltas |
| `content.editions.allowed` | Enforced | All governed candidate pools; whole-document admission; every newly introduced governed identity |

Character Sheet and Party Tracker layer the decision over personal settings in memory. Their serializers retain the
personal values only. Teardown drops the decision and restores those values; realtime activation fetches and
generation-fences a replacement context. The server uses the same evaluator for carry projection and rejects a
schema-v2 carry write whose recorded rules-version identity is stale before changing canonical character data.

The content-policy projection similarly remains transient: browser filtering explains allowed choices, while the
server rechecks normalized identities inside the authoritative memory/PostgreSQL write boundary. Existing
noncompliant characters are grandfathered with bounded warnings and are never silently rewritten; newly introduced
unknown or disallowed identities fail closed. Campaign brew augments only the active campaign catalog and never
widens policy through unrelated personal brew.

Transition handling is deliberately fail-closed: memory and PostgreSQL clone/attach/move paths resolve and lock
the destination policy before changing the character. A carry block is retained only when its immutable policy
identity is the destination identity; detached, malformed, or source-policy blocks are removed from the cloned
document, leaving all raw character inputs intact until the destination sheet recalculates.

| Evidence | Scope |
|---|---|
| `HubCampaignRuleEvaluator` | Closed decision fields, setting domains, catalog/schema identities, stable errors, and TGTT composition |
| `CharacterSheetHubTeardown` | Activation, rollback, failed replacement, reconnect recovery, stale ordering, and detached teardown |
| `HubCampaignRuleAuthority` | Protocol/pin fences, no-partial memory writes, destination transition invalidation, and the shared create/patch basis matrix |
| `HubRulesPolicyPostgres` | PostgreSQL transaction parity for missing, detached, stale, current, and protocol-mismatched bases, including clone/attach/move under active destination policy |
| `HubCampaignContentGating` | Source aliasing, species variants, editions, candidate filtering, admission, grandfathering, direct deltas, and context teardown |
| `HubRulesPolicyApi` / `HubRulesPolicyPostgres` | Content publication/activation, stale-pin fencing, memory/PostgreSQL admission and delta parity, and privacy-safe rejection |
| `campaign-content-gating.spec.ts` | Production-derived Builder, Level Up, import, direct-write, grandfather, rollback, multi-tab, and local-restoration journey |
| `private-v1-character-campaigns.spec.ts` | Production-derived active-policy attach, clone, and move journey |
| `HubCarryFreshness` / `HubCarryContractParity` | Carry basis and privacy-preserving projection parity |
