# Nested Respec choices — iteration 2 report

## Implementation range

This Builder iteration starts at `0f25a95a`, after the required baseline and
iteration-1 Inspector commit. The requested Builder commit is the single
commit made for this iteration:

```text
feat(charactersheet): [B] add nested respec choices
```

Required baseline ancestry was checked before implementation:
`aa763de9`, `05bfcbe2`, `1c581363`, and `2ee6c6df` are all ancestors of
`0f25a95a`, in the required order.

## Delivered

- Expanded normalized choice descriptors and the production census across the
  relevant class, subclass, optional-feature, feat, race, and background
  catalogs. Required entries now have explicit supported, runtime, or
  non-Respec classifications, with a production-path negative-control test.
- Added named real-data coverage for recurring Specialty pools, Extra Skill
  Training, Arcane Archer Lore, Thaumaturge, Lessons of the First Ones,
  skill/tool unions, and object/string spell filters.
- Preserved linked graph identity and origin persistence, recursively discovered
  selected descendants, preserved unsupported persisted payloads as blocking
  diagnostics, and kept legal option catalogs transient.
- Moved nested selection mechanics into the candidate graph transaction,
  including deepest-first descendant cleanup, source-keyed materialized
  receipts, ownership-aware resource preservation, and inline nested editing.
- Added a page-object-only real-browser lifecycle for nested Cleric cantrip
  editing and verified the existing candidate Cancel/Apply/reload/Undo flow
  plus 390×844 toolbar geometry.
- Updated the Respec, architecture, and development-status documentation.

## Validation

- Focused Jest gate: **PASS**, 4 suites / 58 tests.
- All Character Sheet Jest tests: **PASS** (the full repository output is
  recorded by the gate; no Character Sheet failures).
- JavaScript ESLint: **PASS**.
- CSS stylelint: **PASS**.
- JSON/schema validation: **PASS**.
- Focused Respec Playwright on fresh `PW_PORT=8120`: **PASS**, 3 tests.
- Affected Arcane Archer and Light Domain Cleric comprehensive browser specs:
  **PASS**, 12 ordinary tests and 4 skipped optional mega tests.
- Same affected specs with `RUN_MEGA=1`: **PASS**, 16 tests including both
  L1→20 mega cases.
- `npm run test:data`: **FAIL**, on the pre-existing `data/crafting.json`
  missing-link baseline documented in `22-respec.md`; no data files were
  changed or silenced.

## Explicit incomplete items

The following plan items are not claimed complete by this iteration:

- canonical nested writes from every acquisition controller (Builder, Level Up,
  Quick Build, deferred Features, and spell picker);
- a frozen pre-child-ledger fixture corpus covering every migration evidence
  order, ambiguity, pending-family policy, and fulfilled-marker case;
- exhaustive named mechanics tests for every new ownership family and every
  Cruel/triggered-die/resource-turn-use receipt path;
- complete cross-catalog browser lifecycles for Rogue Specialty and Arcane
  Archer sibling choices, ambiguous migration, and all origin same-entity
  editing variants;
- resolution of the unrelated repository `test:data` baseline.

These are intentionally listed rather than hidden behind broad census or
browser assertions.
