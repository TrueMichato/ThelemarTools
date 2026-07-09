# Upstream Tracker (5etools/tracker) — Status in This Fork

**Purpose:** durable record of which 5etools tracker feature requests this fork has
implemented, is actively working on, has explicitly declined, or is treating as a
future candidate. Grows as PRs land and as new triage passes happen. Keep this file
in sync when a related PR merges into `character-sheet-wip`.

**Legend:**
- ✅ **Shipped** — PR merged into `character-sheet-wip`.
- 🔄 **In flight** — session running, PR open, or pending review.
- 📋 **Queued** — assessed and prioritized but not yet started.
- 🛑 **Declined / dropped** — explicitly decided against for this fork.
- 🎯 helps character sheet · 🔗 helps indirectly · — no sheet fit

**Convention:** rows sorted by tracker # ascending within each section. When a PR
lands, move the row from Queued / In flight into Shipped and add the PR # + merge
commit.

---

## ✅ Shipped

| Tracker | Title | Our PR | Merge |
|---|---|---|---|
| [#517](5ET-tracker 517) A+B | Expanded monster `group[]` tags + normalization | #155 | data-only phase |
| [#517](5ET-tracker 517) C+D+E | First-class `monsterGroup` entity + renderer + filter enrichment | #161 | 5 flagship entities; 13 more deferred to follow-up |
| [#597](5ET-tracker 597) | Bestiary Wide Mode (statblock + fluff side-by-side ≥1600px) | #152 | |
| [#738](5ET-tracker 738) | Compare Creatures side-by-side | #157 | `RenderCompareCreatures.pOpenForUids(hashes)` public entry |
| [#1042](5ET-tracker 1042) | `skillToolLanguageProficiencies` on `subclassFeature` | #159 | Also fixes silent-drop bug for class features; schema PR pending upstream |
| [#1148](5ET-tracker 1148) | Tool proficiency prerequisites on optional features | #156 | schema PR pending upstream |
| [#1190](5ET-tracker 1190) | Collapsible statblock entries | #153 | post-processor `Renderer.statblockCollapse` |
| [#1191](5ET-tracker 1191) | DM Screen Custom Random Tables panel | #160 | with tab-title sync |
| [#1195](5ET-tracker 1195) | Draw Card button on deck hover / DM Screen embed | #166 | |
| [#1200](5ET-tracker 1200) | Two-column statblock layout toggle | #158 | `column-count: 2` on wrapped `<tbody>` |
| [#1232](5ET-tracker 1232) | Multi-select HP math on initiative tracker | #165 | `InitiativeTrackerRowUtil.getHalvedDelta` shared helper |
| [#1234](5ET-tracker 1234) | Auto-add Lair Action to initiative tracker | #164 | idempotent reconciler + shared `isNonCombatantRow` predicate |
| [#1252](5ET-tracker 1252) | DM Screen Dice Calculator panel | #162 | `PANEL_TYP_DICE_CALCULATOR = 17` |
| [#1279](5ET-tracker 1279) | Cost column on magic items list | #163 | reuses `_l_value` display helper |
| [#1281](5ET-tracker 1281) | Full `senses` tag on races (blindsight/tremorsense/truesight) | #154 | schema PR pending upstream |

**15 tracker items shipped across 15 PRs.**

## 🔄 In flight

_None currently. Queue is empty pending a new triage pass._

## 📋 Queued (assessed, not started)

_Populated by triage passes. See `## Assessed but not queued` below for the wider
candidate pool with notes on why each is or isn't a good next-sprint fit._

## 🛑 Declined / dropped

| Tracker | Title | Why declined |
|---|---|---|
| [#1099](5ET-tracker 1099) + [#1227](5ET-tracker 1227) | Encounters page + auto generator | Parked pending product-scope decision (catalog vs generator vs runner). Existing `encountergen.html` already covers 42 random-encounter tables. Re-open when the user articulates which of the three surfaces is wanted. |
| [#1225](5ET-tracker 1225) | Feet Speed filter for Races | Already implemented in `js/filter-races.js` (verified). |
| [#331](5ET-tracker 331), [#406](5ET-tracker 406), [#1381](5ET-tracker 1381), [#1383](5ET-tracker 1383) | Charactermancer / character-sheet features | Superseded by this fork's full character sheet. |
| [#1371](5ET-tracker 1371) | Weapon Mastery Selection Support | Already implemented in this fork's character sheet. |
| Any `PLUT-*` | Plutonium / Foundry-only tickets | Out of scope for this fork. |
| [#326](5ET-tracker 326) | Mobile app | Out of fork scope. |
| [#383](5ET-tracker 383) | Translations infrastructure | Out of fork scope. |

## Companion upstream schema PRs pending

These landed in-fork but depend on a matching PR against `5etools-utils` for schema
validation to pass on the new fields. Staged diffs live under `docs/schema-patches/`.

- **#1148** — new `tool` case in `prerequisite.proficiency`.
- **#1042** — proficiency fields on `subclassFeature`.
- **#1281** — `tremorsense` / `truesight` on race schema. Staged at
  `docs/schema-patches/race-senses-5etools-utils.diff`.
- **#517 C+D+E** — new `monsterGroup` entity schema. Staged at
  `docs/schema-patches/monster-groups-5etools-utils/`.

---

## Assessed but not queued

Candidate pool from the most-recent triage pass, minus items above. Grouped by
"how well does this fit this fork's strengths right now". Each row is a real
tracker link with age + effort/impact/sheet-fit rating.

**Rating shorthand:** Effort S/M/L/XL, Impact Low/Med/High, Sheet 🎯 direct /
🔗 indirect / — none.

### Tier A — high leverage or hidden gems, natural fit

Read the full write-up in the triage pass; short list here for reference only. See
also cross-links to Compare Creatures (#738), Party Tracker (`js/dmscreen/partytracker/`),
and the `_l_value` helper for shared consumers.

- 5ET issue triage lives in agent conversation history for now — new triage runs
  should update this file's Queued section directly.
