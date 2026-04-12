---
name: dmscreen-development
description: "Develop, debug, and extend the 5etools DM Screen panels — Party Tracker (js/dmscreen/partytracker/) and Journey Tracker (js/dmscreen/dmscreen-journeytracker.js). Covers character data model, ability calculations, carry capacity, jump distances, exhaustion rules, DC probability engine, group checks, Risk Modifier system, journey/camp activities, travel pace, risk rolls, area configuration, party-journey sync, tool proficiency detection, TGTT/Thelemar homebrew settings, SCSS styling, night mode. Use for any task mentioning DM Screen, dmscreen, party tracker, journey tracker, DC calculator, risk modifier, journey activities, camp activities, carry capacity, group check, stealth rolls, or travel pace."
---

# DM Screen Development (Party Tracker & Journey Tracker)

## System Overview

The DM Screen (`dmscreen.html`) hosts panel apps for DM tools. Two custom panels manage party data and overland travel:

- **Party Tracker** — 4 modules in `js/dmscreen/partytracker/` managing character stats, derived calculations, DC probabilities, and TGTT homebrew
- **Journey Tracker** — 1 large module (`js/dmscreen/dmscreen-journeytracker.js`, ~2100 lines) managing travel segments, activities, Risk Modifier, and camp phases

Both extend `DmScreenPanelAppBase` and persist state via `board.doSaveStateDebounced()` → localStorage. The Party Tracker fires `partyTrackerUpdate` board events that the Journey Tracker consumes for automatic character sync.

### Key Facts

- **No unit tests** — both trackers are integration-tested via browser only
- **No reactive framework** — vanilla DOM via `ee` tagged templates, `appendTo()`, `.onn()`, `.empty()`, `.css()`, `.val()`, `.prop()`, `.toggleClass()`
- **`.text()` does NOT work** — use `.textContent` or `.txt()` for setting text
- DOM is the output of `render()` calls; re-rendering replaces entire sections
- TGTT homebrew is only in the Party Tracker; Journey Tracker is system-neutral
- Settings dropdown uses click-outside listener for dismissal
- State is deeply cloned on save/load to prevent reference sharing

### Module Map

| File | Class(es) | Lines | Role |
|------|-----------|-------|------|
| `partytracker/dmscreen-partytracker.js` | `PartyTracker`, `PartyTrackerRoot` | ~290 | Panel app + controller |
| `partytracker/dmscreen-partytracker-character.js` | `PartyTrackerCharacter` | ~760 | Data model, calculations, rendering |
| `partytracker/dmscreen-partytracker-serial.js` | `PartyTrackerCharacterSerializer` | ~260 | Serialization, static data maps |
| `partytracker/dmscreen-partytracker-dccalc.js` | `PartyTrackerDcCalc` | ~450 | DC probability engine |
| `dmscreen-journeytracker.js` | `JourneyTracker`, `JourneyTrackerRoot` | ~2100 | Full journey/camp implementation |
| `dmscreen-panels.js` | `PanelContentManager_*` | — | Panel registration |
| `dmscreen-panelapp-base.js` | `DmScreenPanelAppBase` | — | Base class for panel apps |
| `dmscreen-util.js` | `DmScreenUtil` | — | Cross-panel utilities |

### SCSS

| File | Prefix | Contents |
|------|--------|----------|
| `scss/includes/dmscreen-party-tracker.scss` | `.dm-party__` | Party Tracker + DC Calculator |
| `scss/includes/dmscreen-journey-tracker.scss` | `.dm-journey__` | Journey Tracker |

Build: `npx sass scss/dmscreen.scss css/dmscreen.css`

## Before You Start

Read the reference that matches your task:

| Task | Reference |
|------|-----------|
| Understanding module roles, data flow, state shapes | [Architecture](./references/architecture.md) |
| Character data model, calculations, serialization | [Party Tracker](./references/party-tracker.md) |
| Journey/camp activities, RM system, risk rolls | [Journey Tracker](./references/journey-tracker.md) |

Also consult the project docs in `docs/dmscreen/` for narrative explanations.

## Procedure

### 1. Identify the Layer

Work falls into:
- **Panel App** (`PartyTracker` / `JourneyTracker`) — thin wrappers, rarely edited
- **Controller** (`PartyTrackerRoot` / `JourneyTrackerRoot`) — rendering, state management, settings
- **Data Model** (`PartyTrackerCharacter`) — calculations, derived values
- **Serialization** (`PartyTrackerCharacterSerializer`) — data shape, static maps, settings
- **DC Calculator** (`PartyTrackerDcCalc`) — probability math
- **SCSS** — styling, colors, night mode

### 2. Understand the Save Path

```
User input → data model update → _doUpdate() callback
  → PartyTrackerRoot: doSave() + fireBoardEvent("partyTrackerUpdate")
    → board.doSaveStateDebounced() → localStorage
    → JourneyTracker.syncPartyCharacters() (if present)
```

New fields must be added to: data model, serializer (serialize + deserialize + defaults), and any UI that displays them.

### 3. TGTT Integration Rules

- All TGTT logic lives in the Party Tracker, gated by `settings.enableTgtt`
- Sub-toggles: `thelemar_carryWeight`, `thelemar_jumping`, `thelemar_linguisticsBonus`, `thelemar_criticalRolls`
- Exhaustion rules: `"thelemar"` (max 10, d20 & DC penalty), `"2024"` (max 6, d20 & speed penalty), `"standard"` (max 6, no auto penalties)
- Journey Tracker never checks TGTT — it uses raw ability/skill/tool data from Party Tracker

### 4. Adding a New Field

1. Add to `PartyTrackerCharacterSerializer.deserialize()` with a backward-compatible default
2. Add compressed key to `serialize()`
3. Add UI input in `PartyTrackerCharacter._renderExpandedForm()`
4. Include in collapsed summary row if appropriate
5. Update toolbar summary if it's aggregate data
6. Build SCSS: `npx sass scss/dmscreen.scss css/dmscreen.css`
7. Verify in browser

### 5. Common Pitfalls

- **`.text()` doesn't work** — use `.textContent` or the `txt()` method
- **Re-rendering is manual** — after state change, must call render method or re-render section
- **Board save is debounced** — multiple rapid changes are batched
- **Journey Tracker won't sync without Party Tracker** — falls back to manual mode
- **Settings dropdown needs click-outside handler** — or it stays open forever
