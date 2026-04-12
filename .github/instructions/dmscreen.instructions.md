---
applyTo: "dmscreen.html,js/dmscreen/**/*.js,scss/*dmscreen*.scss,css/dmscreen*.css,docs/dmscreen/**/*.md"
description: "Instructions for DM Screen panel development — Party Tracker, Journey Tracker, DC Calculator, and related SCSS. Emphasizes vanilla DOM patterns, state persistence, board events, and TGTT homebrew integration."
---

# DM Screen Instructions

## Primary Goals

- Use the existing panel architecture (`DmScreenPanelAppBase`, board events, `doSaveStateDebounced()`) before creating new patterns.
- Maintain the vanilla DOM toolkit conventions: `ee` tagged templates, `.onn()`, `.appendTo()`, `.empty()`, `.toggleClass()`. Do NOT use `.text()` — use `.textContent` or `.txt()`.
- Preserve backward compatibility in serialized state. New fields must have defaults in `deserialize()`.
- Keep TGTT homebrew logic gated behind `settings.enableTgtt` and its sub-toggles. The Journey Tracker should remain system-neutral.

## Architecture Rules

- Read the relevant reference before editing:
  - `.agents/skills/dmscreen-development/references/architecture.md`
  - `.agents/skills/dmscreen-development/references/party-tracker.md`
  - `.agents/skills/dmscreen-development/references/journey-tracker.md`
- Respect the save path: data change → `_doUpdate()` → `board.doSaveStateDebounced()` + `board.fireBoardEvent()`.
- New serialized fields need: `serialize()` key, `deserialize()` with default, and UI input if user-editable.
- Re-rendering is manual — after any state change, the responsible module must re-render the affected DOM section.
- State is deeply cloned on save/load to prevent reference sharing bugs.

## Party Tracker Specifics

- `PartyTrackerCharacter` is both data model and renderer. Derived values use `get*()` methods — do not store computed values in `_data`.
- Calculations support overrides (`overrides.{field} != null → return override`) — preserve this pattern for new calculations.
- Collapsed row stats should be brief (emoji + compact value), with full details in the tooltip (`title` attribute).
- TGTT skills (7) are always present in `skillProficiencies` but only rendered when `enableTgtt` is true.

## Journey Tracker Specifics

- Activities are defined as constants (`JOURNEY_ACTIVITIES[]`, `CAMP_ACTIVITIES[]`) at module level — not class members.
- Activity RM deltas use the `_rmAlwaysApplied` / `_rmRollApplied` tracking pattern to prevent double-application on re-render.
- Group checks in activities follow the "at least half" rule — separate from the DC Calculator's group check which uses exact DP.
- The Journey Tracker gets character data via `DmScreenUtil.getPartyTrackerCharacters({board})` — it never imports Party Tracker modules directly.

## Styling Rules

- Party Tracker uses `.dm-party__` prefix, Journey Tracker uses `.dm-journey__` prefix.
- Both are in `scss/includes/` and imported via `scss/dmscreen.scss`.
- Build with: `npx sass scss/dmscreen.scss css/dmscreen.css`
- Night mode overrides go in `.night-mode` blocks at the bottom of each SCSS file.
- Use the existing color conventions: green/yellow/orange/red for success tiers, `--warn`/`--danger` modifiers for stat highlights.

## Testing

Neither tracker has unit tests yet. Validate changes by:
1. Syntax check: `node --check <file.js>`
2. SCSS build: `npx sass scss/dmscreen.scss css/dmscreen.css`
3. Browser verification at `localhost:8080/dmscreen.html`
