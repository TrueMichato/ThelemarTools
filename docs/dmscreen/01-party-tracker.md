# Party Tracker

The Party Tracker is a DM Screen panel for managing a party of D&D 5e characters. It provides at-a-glance stats, a DC success calculator, and optional Thelemar (TGTT) homebrew integration.

## Architecture

### Class Hierarchy

```
DmScreenPanelAppBase
 └─ PartyTracker              (panel app — thin wrapper)
     └─ PartyTrackerRoot      (controller — rendering, state, settings)
         ├─ PartyTrackerCharacter[]   (data model + per-character UI)
         └─ PartyTrackerDcCalc        (DC probability engine)
```

### Module Map

| File | Class | Role | Approx. Lines |
|------|-------|------|---------------|
| `dmscreen-partytracker.js` | `PartyTracker`, `PartyTrackerRoot` | Panel entry point + main controller | ~290 |
| `dmscreen-partytracker-character.js` | `PartyTrackerCharacter` | Character model, calculations, rendering | ~760 |
| `dmscreen-partytracker-serial.js` | `PartyTrackerCharacterSerializer` | Serialization, static data constants | ~260 |
| `dmscreen-partytracker-dccalc.js` | `PartyTrackerDcCalc` | Probability math, group checks | ~450 |

### Data Flow

```
User input → PartyTrackerCharacter._data → _doUpdate() callback
                                              │
                      ┌───────────────────────┤
                      ▼                       ▼
              board.doSaveStateDebounced()   board.fireBoardEvent("partyTrackerUpdate")
                      │                       │
                      ▼                       ▼
                localStorage              JourneyTracker.syncPartyCharacters()
```

1. User edits a field in the expanded character form
2. The `change` event handler updates `this._data`, then calls `this._doUpdate()` → `onUpdate()`
3. `PartyTrackerRoot` saves state and fires a board event
4. The Journey Tracker (if present) receives the event and syncs player data

## Panel Lifecycle

### Initialization

```javascript
// dmscreen-panels.js registers the panel type
class PanelContentManager_PartyTracker extends _PanelContentManager { ... }

// When the DM Screen loads the panel:
PartyTracker._getPanelElement(board, savedState)
  → new PartyTrackerRoot(board, wrpPanel)
  → root.setStateFrom(savedState)   // deserialize characters + settings
  → root.render(wrpPanel)           // build entire DOM tree
```

### Rendering

`PartyTrackerRoot.render()` builds:

1. **Toolbar** — Add Character button, DC Calc toggle, summary text, Settings gear
2. **Character list** — `<div role="list">` with one `PartyTrackerCharacter` per entry
3. **DC Calculator section** — toggled by the DC Calc button

Each character starts in collapsed (summary row) mode. Clicking the expand button renders the full editing form. Collapsing re-renders the summary row.

### State Persistence

```javascript
getSaveableState() → {
  settings: PartyTrackerCharacterSerializer.serializeSettings(this._settings),
  characters: this._characters.map(c =>
    PartyTrackerCharacterSerializer.serialize(c.getSaveableData())
  )
}
```

State is saved to localStorage via `board.doSaveStateDebounced()` on every character add/remove/update and every settings change. See [Character Model](./02-party-tracker-character.md) for the full serialization format.

## Toolbar Summary

The summary line in the toolbar displays:

```
N chars · Lv X · Carry: Y/Z lb (P%)
```

- **N chars** — total character count
- **Lv X** — average level across all characters (rounded to 1 decimal)
- **Carry** — sum of `currentWeight` / sum of `getCarryCapacity()` with percentage

Calculation in `_updateSummary()` iterates all characters, instantiating temporary `PartyTrackerCharacter` objects to compute carry capacity.

## Settings

Settings are accessed via the gear icon button, which opens a positioned dropdown menu.

### Available Settings

| Setting | Key | Default | Description |
|---------|-----|---------|-------------|
| Enable Thelemar (TGTT) | `enableTgtt` | `false` | Master toggle for all TGTT homebrew rules |
| Carry Weight | `thelemar_carryWeight` | `true` | Might-based carry capacity instead of STR×15 |
| Jump Distances | `thelemar_jumping` | `true` | Athletics-based jump instead of STR-based |
| Linguistics Bonus | `thelemar_linguisticsBonus` | `true` | +1 per non-Common language to Linguistics |
| Critical Rolls | `thelemar_criticalRolls` | `true` | Nat 1: −5 effective, Nat 20: +5 effective |
| Exhaustion Rules | `exhaustionRules` | `"thelemar"` | Rule set: `"thelemar"` (max 10), `"2024"` (max 6), `"standard"` (2014, max 6) |

TGTT sub-toggles are only visible when the master `enableTgtt` toggle is on. Changing any setting triggers `_refreshAll()` which re-renders the entire panel.

### Settings Serialization

```javascript
// Compressed keys for localStorage
serializeSettings(settings) → {
  et: enableTgtt,
  tcw: thelemar_carryWeight,
  tj: thelemar_jumping,
  tlb: thelemar_linguisticsBonus,
  tcr: thelemar_criticalRolls,
  exr: exhaustionRules
}
```

## Board Events

The Party Tracker fires one event type:

```javascript
this._board.fireBoardEvent({type: "partyTrackerUpdate"});
```

This fires on: character add, character remove, character data update, and settings change. The Journey Tracker listens for this event via `onBoardEvent({type})` to synchronize its player list.

## Character List UI

### Collapsed Row (Summary)

Each character's collapsed row shows, left to right:

| Element | Description |
|---------|-------------|
| `+` button | Expand character details |
| Name | Character name or `—` |
| Race | Race/species |
| Classes | e.g. `Fighter 5/Wizard 2` |
| 🛡 AC | Armor class |
| 👁 Passive Perception | 10 + skill bonus + passive bonus |
| 🔍 Passive Investigation | Same formula |
| 💡 Passive Insight | Same formula |
| 🗣 Passive Linguistics | TGTT only — 10 + linguistics bonus + passive bonus |
| 🏋 Carry | `currentWeight/carryCapacity` with warn/danger colors |
| 👀 Senses | Non-zero senses (DV, BS, TS, TrS) |
| ➡⬆ Jump | Long (running/standing) and High (running/standing) |
| 💤 Exhaustion | Shows only if > 0, danger color |
| Condition pills | Colored pills for active conditions/diseases |
| TGTT stats | Stamina pool and Combat Method DC (TGTT only) |
| 🗑 Remove | Remove character button |

### Expanded Form

The expanded form contains sections for: Identity (name, race), Classes (multi-class rows), Ability Scores (6-grid), Derived Stats bar (carry, jump), Speed (5 types), Senses (4 types), Skills (18 standard + 7 TGTT), Saves, Tool Proficiencies, Languages, TGTT section (combat traditions, stamina, overrides), Conditions, Diseases, Counters, and Notes.

### Add Character

Clicking "Add Character" calls `PartyTrackerCharacterSerializer.getDefaultCharacter()` which returns a character with all default values (empty name, 10 in all abilities, level 1, AC 10, speed 30, etc.).

## Condition & Disease Hover/Click

Condition and disease pills in the collapsed row and expanded form support:

- **Hover** — shows a 5etools hover tooltip via `Renderer.hover.pHandleLinkMouseOver()` with the condition/disease description
- **Click** — opens the full condition/disease page in a new browser tab via `window.open(url, "_blank", "noopener,noreferrer")`

Condition/disease data is loaded asynchronously via `DataLoader.pCacheAndGetAllSite(UrlUtil.PG_CONDITIONS_DISEASES)` and cached in a static class-level property.
