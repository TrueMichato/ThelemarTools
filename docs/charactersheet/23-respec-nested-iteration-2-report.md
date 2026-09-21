# Nested Respec choices — iteration 3 report

## Implementation commit

This iteration is the Builder implementation for:

```text
feat(charactersheet): [B] add nested respec choices
```

The required ancestry is preserved in order:
`aa763de9`, `05bfcbe2`, `1c581363`, and `2ee6c6df`.
The goal file is intentionally unmodified and untracked.

## Delivered contract

- The production choice census requires every reachable required `choose` or
  `options` shape to yield a legal descriptor/catalog or an explicit reviewed
  runtime/non-Respec classification. It reports actionable unsupported and
  missing-catalog issues and includes a production-path negative-control test.
- Normalized descriptors cover entity, skill, skill/tool/language unions,
  expertise, tools, languages, ability/configuration, saves, weapons, armor,
  resistances, feats, optional features, spells, cantrips, recurring pools,
  object/string spell filters, and reviewed prose fallbacks.
- Ordinary Spellcasting/preparation/recommendation prose is runtime metadata,
  not a nested cantrip obligation. Explicit feature grants retain contextual
  `XPHB`/source-aware spell identity.
- Nested decisions carry stable scope, parent/root keys, depth, provenance,
  occurrence, pick slot, and compact source-keyed receipts. Origin decisions
  are persisted in `characterBase.decisions`; class decisions remain in level
  history. Scope-aware projections preserve sparse legacy rows and never copy
  nested proficiency picks into top-level `choices.*`.
- Recursive discovery covers selected feature options, subclass features,
  recurring Specialty pools, Arcane Archer Lore siblings, Divine Order →
  Thaumaturge, Lessons of the First Ones feat descendants, feat subchoices,
  optional-feature descendants, and origin choices. Specialty catalogs are
  filtered at the acquisition class level.
- Candidate mutations are isolated and staged. Descendants are removed
  deepest-first; source ownership and receipts are reversed before a parent
  replacement; legal children are retained by semantic identity; failures
  restore both candidate JSON and manifest.
- The executable adapter closure runs against the loaded Respec and State
  prototypes rather than accepting an unavailable-prototype bypass. Existing
  unknown pending queues warn without blocking, while a mutation-created
  unrepresented pending item is rejected and rolled back.
- Ownership and reversal cover skills, expertise, tools, languages, saves,
  weapons, armor, resistances, spells, cantrips, features, modifiers,
  resources, scalar ability effects, and configuration receipts. Overlapping
  and preserved/manual grants survive removal. Cruel/triggered resources keep
  source-identical current uses, clamp to a new maximum, and clear
  `resourceTurnUsage` when the source disappears.
- Builder, Level Up, Quick Build, deferred Features, and spell-picker
  persistence use the shared canonical decision synchronization path while
  retaining compatibility fields and candidate-bound picker isolation.
- The nested Respec UI renders linked statuses and an inline branch editor.
  Page-object helpers target named decisions, preserve candidate isolation, and
  retain the mobile toolbar/action contract.

## Validation

- Focused nested Jest gate: **PASS**, 4 suites / 60 tests.
- Full Character Sheet Jest gate: **PASS**, 547 suites passed, 2 skipped;
  16,248 tests passed, 208 skipped.
- JavaScript lint: **PASS**.
- CSS lint: **PASS**.
- JSON/schema validation: **PASS**.
- Production descriptor census and negative-control restoration: **PASS**.
- Focused Respec Playwright on a fresh port: **PASS**, 3 tests.
- Arcana Domain Cleric comprehensive browser coverage: **PASS**.
- Arcana Domain Cleric `RUN_MEGA=1`: **PASS**, including the previously
  failing Arcane Initiate milestone.
- `npm run test:data`: **KNOWN BASELINE FAILURE** only in unchanged generated
  links under `data/crafting.json` (COMCRAF, HHHVI, TGTT Identify, and
  Arcadia cooking references). The Respec work does not alter or suppress this
  repository-wide data baseline.

## Explicit scope note

No in-scope nested Respec implementation item is intentionally left as a
follow-up. The only red gate is the documented, pre-existing crafting-data
link baseline, which is outside the approved Respec scope and remains visible
to maintainers.
