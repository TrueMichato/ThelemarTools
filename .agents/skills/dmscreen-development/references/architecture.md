# DM Screen Architecture Reference

Compressed reference for Party Tracker and Journey Tracker module structure, class hierarchy, and data flow.

## Panel Registration

```
dmscreen-panels.js:
  PanelContentManager_PartyTracker  → creates PartyTracker panel app
  PanelContentManager_JourneyTracker → creates JourneyTracker panel app
```

Panel apps extend `DmScreenPanelAppBase` which provides:
- `_getPanelElement(board, state)` → build DOM, return root element
- `getState()` → return saveable state object
- `onBoardEvent({type})` → receive board-level events

## Class Hierarchy

```
DmScreenPanelAppBase
├── PartyTracker                    (js/dmscreen/partytracker/dmscreen-partytracker.js)
│   └── PartyTrackerRoot            (private, same file)
│       ├── PartyTrackerCharacter[]  (dmscreen-partytracker-character.js)
│       └── PartyTrackerDcCalc       (dmscreen-partytracker-dccalc.js)
│
└── JourneyTracker                  (js/dmscreen/dmscreen-journeytracker.js)
    └── JourneyTrackerRoot           (private, same file)
```

## Party Tracker State

```javascript
getSaveableState() → {
  settings: { et, tcw, tj, tlb, tcr, exr },    // compressed setting keys
  characters: [                                  // array of compressed characters
    { id, n, r, cl, ab, sv, sp, tp, lng, ac, spd, sns, ct, exh, cw, ov, bon, ja, nt, cnd, dis, ctr }
  ]
}
```

Full settings:
```javascript
{ enableTgtt, thelemar_carryWeight, thelemar_jumping,
  thelemar_linguisticsBonus, thelemar_criticalRolls, exhaustionRules }
```

## Journey Tracker State

```javascript
{
  tab: 0-4,                    // Journey | Camp | Area Config | Log | Timeline
  riskModifier: number,        // Central RM value
  travelPace: "slow"|"normal"|"fast",
  rollMode: "raw"|"total",
  players: [{ id, name, isFromPartyTracker }],
  area: { areaName, baseDc, numSegments, segmentNames, riskRanges, weatherTable },
  journey: { segments: [{ activities, stealthSlots, riskRoll, riskRollTotal, riskRollOverride, rmAtRoll, _collapsed }] },
  camp: { campfireActive, activities, guardSlots, riskRoll, riskRollTotal, riskRollOverride, rmAtRoll },
  weather: { current, perSegment, segmentWeather, customTypes },
  supplies: { items: [{ id, name, count, dailyBurn, unit, isDefault }], autoDeplete },
  timeline: { days, currentDayIndex, journeyName, startDate },
  log: [{ timestamp, type, message }]
}
```

## Data Flow

```
[Party Tracker]
  User edits field → PartyTrackerCharacter._data updated
    → _doUpdate() → PartyTrackerRoot.onUpdate callback
      → board.doSaveStateDebounced()
      → board.fireBoardEvent({type: "partyTrackerUpdate"})
        → [Journey Tracker] JourneyTracker.onBoardEvent()
          → JourneyTrackerRoot.syncPartyCharacters()
            → Adds/removes/updates players in JT state
            → Re-renders current tab
```

## DOM Toolkit

Both trackers use the 5etools vanilla DOM toolkit:
- `ee\`<div>...\`` — tagged template for element creation
- `.appendTo(parent)` — append to parent
- `.empty()` — clear children
- `.onn("event", handler)` — add event listener
- `.toggleClass(cls, bool)` — toggle CSS class
- `.val()` / `.val(v)` — get/set input value
- `.prop(name)` / `.prop(name, v)` — get/set property
- `.attr(name, v)` — set attribute
- `.css({...})` — set inline styles
- `.txt(str)` — set text content (alias for textContent)
- **`.text()` DOES NOT WORK** — always use `.textContent` or `.txt()`

## Rendering Pattern

Both trackers follow the same pattern:
1. `render(eleParent)` — builds full DOM tree, appends to parent
2. Section-level re-render: clear section → rebuild → append
3. `_reRenderCurrentTab()` — Journey Tracker: re-renders the active tab only
4. `_refreshAll()` — Party Tracker: full re-render of entire panel
5. `_renderSummaryRow()` / `_renderExpandedForm()` — Per-character toggle

No reactive binding — all UI updates are imperative.

## Event System

Only one board event exists currently:

```javascript
board.fireBoardEvent({type: "partyTrackerUpdate"})
// Fired by: Party Tracker on any character/settings change
// Consumed by: Journey Tracker → syncPartyCharacters()
```

Access party data from other panels:
```javascript
DmScreenUtil.getPartyTrackerCharacters({board}) → character data array
```
