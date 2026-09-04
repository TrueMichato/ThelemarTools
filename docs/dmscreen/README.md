# DM Screen Panel Documentation

Developer documentation for custom panels in the 5etools DM Screen (`dmscreen.html`).

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
| [Initiative Tracker — Multi-Select HP](./08-initiative-tracker-multi-select-hp.md) | Bulk-apply HP workflow (Fireball / save-for-half), selection state, `UiUtil.getStrNumericModified` |
| [Item Builder](./09-item-builder.md) | Build and export custom magic items from the DM Screen |
| [NPC Manager](./10-npc-manager.md) | NPC roster, roleplay detail, persistent groups, and batch rolling |
| [Bestiary Quick Actions](../bestiary-quick-actions.md) | Temporary creature overrides shared with statblock panels and the Initiative Tracker creature viewer |

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
