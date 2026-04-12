# DM Screen — Party Tracker & Journey Tracker Documentation

Developer documentation for the Party Tracker and Journey Tracker panels in the 5etools DM Screen (`dmscreen.html`). These two panels work together: the Party Tracker manages character data, and the Journey Tracker consumes it for overland travel simulation.

## Quick Navigation

| Document | Description |
|----------|-------------|
| [Party Tracker](./01-party-tracker.md) | Panel architecture, classes, settings, toolbar, state persistence |
| [Character Model](./02-party-tracker-character.md) | `PartyTrackerCharacter` data shape, ability calculations, serialization, exhaustion variants, carry/jump formulas |
| [DC Calculator](./03-dc-calculator.md) | Probability engine, group check math, roll modes, TGTT critical rules |
| [Journey Tracker](./04-journey-tracker.md) | Panel architecture, state shape, four-tab system, Risk Modifier, risk rolls, area config |
| [Journey Activities](./05-journey-activities.md) | All 8 journey + 11 camp activities, RM deltas, group checks, pace modifiers, tool proficiency |
| [Party–Journey Integration](./06-party-journey-integration.md) | Board event system, automatic character sync, player data mapping |
| [Styling Guide](./07-styling-guide.md) | SCSS class hierarchy for both trackers, color coding, night mode |

## System at a Glance

Both panels are DM Screen panel apps extending `DmScreenPanelAppBase`. They persist state via `board.doSaveStateDebounced()` → localStorage and communicate through board events.

```
┌─────────────────────────────────────────────────────────┐
│  DM Screen (dmscreen.html)                              │
│  ┌──────────────────┐    partyTrackerUpdate    ┌──────────────────┐
│  │  Party Tracker    │ ─────────────────────▶  │  Journey Tracker  │
│  │  (4 JS modules)   │                         │  (1 JS module)    │
│  └──────────────────┘                         └──────────────────┘
│          │                                            │
│          ▼                                            ▼
│  board.doSaveStateDebounced()              board.doSaveStateDebounced()
│          │                                            │
│          └───────────── localStorage ─────────────────┘
└─────────────────────────────────────────────────────────┘
```

## File Layout

| Path | Contents |
|------|----------|
| `js/dmscreen/partytracker/dmscreen-partytracker.js` | `PartyTracker` (panel app) + `PartyTrackerRoot` (controller) |
| `js/dmscreen/partytracker/dmscreen-partytracker-character.js` | `PartyTrackerCharacter` — data model, calculations, rendering |
| `js/dmscreen/partytracker/dmscreen-partytracker-serial.js` | `PartyTrackerCharacterSerializer` — serialize/deserialize, static data maps |
| `js/dmscreen/partytracker/dmscreen-partytracker-dccalc.js` | `PartyTrackerDcCalc` — DC probability calculator |
| `js/dmscreen/dmscreen-journeytracker.js` | `JourneyTracker` (panel app) + `JourneyTrackerRoot` (full implementation) |
| `js/dmscreen/dmscreen-panels.js` | Panel registration (`PanelContentManager_PartyTracker`, `PanelContentManager_JourneyTracker`) |
| `js/dmscreen/dmscreen-panelapp-base.js` | `DmScreenPanelAppBase` — parent class for panel apps |
| `js/dmscreen/dmscreen-util.js` | `DmScreenUtil` — cross-panel utilities (e.g., `getPartyTrackerCharacters()`) |
| `scss/includes/dmscreen-party-tracker.scss` | Party Tracker styles (`.dm-party__*`) |
| `scss/includes/dmscreen-journey-tracker.scss` | Journey Tracker styles (`.dm-journey__*`) |

## Known Gaps

- **No unit tests** — neither tracker has test coverage yet. Both are integration-tested manually through the browser.
- **Initiative Tracker, Time Tracker, Mapper** — other DM Screen panels are not covered by this documentation.
- **TGTT-only features** in Journey Tracker — the Journey Tracker itself is system-neutral; all TGTT-specific logic lives in the Party Tracker.
