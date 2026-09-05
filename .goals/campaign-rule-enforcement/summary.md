# Campaign rule enforcement — completed

## Outcome

The Campaign Hub now evaluates supported campaign rules through one closed, pure browser/server contract. Carry weight and encumbrance tiers are truthfully Enforced; incomplete TGTT settings remain Advisory, and source/species/edition rules remain Planned.

## Acceptance criteria

- The product branch remains linearly descended from `29eaf1087e3b59ff5184edf8337da340396515c8`; no migration or generated game-data path changed.
- The evaluator validates closed inputs and outputs, schema/catalog/rule versions, capabilities, protocol 4, surfaces, stable errors, and immutable policy identity. Schema-v1 and explicit-local behavior remain compatible.
- Character Sheet and Party Tracker consume transient effective settings without persisting campaign overlays. TGTT master-off makes all TGTT subrules inert.
- Activation, rollback, switching, teardown, stale ordering, failed replacement, and actual reconnect recovery are generation-fenced and covered.
- Memory and PostgreSQL enforce active schema-v2 policy identity atomically for create/patch operations. Destination attach/clone/move removes untrusted derived carry authority without rewriting character inputs.
- Mutation evidence covers evaluator contracts, Character Sheet teardown/reconnect owners, memory/PostgreSQL transaction owners, and destination transitions. Infrastructure failures cannot count as killed mutants.
- Hub, Character Sheet, lint, build, security, runtime-role PostgreSQL, production Chromium, and exact-head CI gates pass. The unchanged generated-data LinkCheck baseline is documented as the explicit scope boundary.
- Draft PR #241 is the sole PR against `multiplayer-hub`; it remains draft, unreviewed, unmerged, and terminal-green.

## Iteration history

Eight Inspector rounds progressively found and closed: bypassable policy pins, stale-context resurrection, overclaimed catalog surfaces, malformed evaluator outputs, TGTT master-toggle divergence, broken destination copies, missing reconnect recovery, shallow parity evidence, destination-transition fencing gaps, and false-positive mutation kills.

Iteration 8 passed after mutation probes preserved original runtime failures and proved that module/setup/runtime errors cannot masquerade as behavioral kills.

## Final handoff

- Product/remote/PR head: `af88234555674ea25cc11c8ac7f3b91553e3dcaa`
- Base and merge-base: `29eaf1087e3b59ff5184edf8337da340396515c8`
- Diff: 54 files, 3,389 additions, 153 deletions
- Draft PR: https://github.com/TrueMichato/ThelemarTools/pull/241
- Terminal CI: `unit-and-supply-chain`, `affected-regressions`, `migration-and-roles`, and `real-stack-e2e` all succeeded

## Recommendations

- Keep content source/species/edition gating in its separate lane and preserve the shared evaluator/identity-fence contract.
- Resolve the repository-wide generated crafting/bestiary LinkCheck baseline separately; do not fold it into campaign-rule work.
- Retain mutation-runner infrastructure classification so future setup/import/runtime failures cannot be reported as killed mutants.
