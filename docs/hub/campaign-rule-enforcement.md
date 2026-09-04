# Campaign rule enforcement

`js/hub/hub-campaign-rule-evaluator.js` is the only interpretation boundary for campaign rules. It accepts closed,
cloneable data and returns a typed decision containing the policy identity, effective settings, applied rules, and
stable errors. It performs no fetch, DOM, storage, or character mutation.

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
| `content.sources.allowed` | Planned | None |
| `content.species.allowed` | Planned | None |
| `content.editions.allowed` | Planned | None |

Character Sheet and Party Tracker layer the decision over personal settings in memory. Their serializers retain the
personal values only. Teardown drops the decision and restores those values; realtime activation fetches and
generation-fences a replacement context. The server uses the same evaluator for carry projection and rejects a
schema-v2 carry write whose recorded rules-version identity is stale before changing canonical character data.
