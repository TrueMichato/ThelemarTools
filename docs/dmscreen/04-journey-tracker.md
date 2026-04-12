# Journey Tracker

The Journey Tracker is a DM Screen panel for managing overland travel using a Risk Modifier (RM) system. It tracks travel segments with activities, camp phases, area configuration, and an event log — all driven by the central RM value that determines encounter severity.

## Architecture

### Class Hierarchy

```
DmScreenPanelAppBase
 └─ JourneyTracker               (panel app — thin wrapper)
     └─ JourneyTrackerRoot        (full implementation: ~3,100 lines)
```

Unlike the Party Tracker, the Journey Tracker is a single file with all logic in `JourneyTrackerRoot`. There is no separate serializer or character class — all state lives in one large state object.

### Module Dependencies

```
dmscreen-journeytracker.js
 ├─ imports: DmScreenPanelAppBase
 ├─ imports: DmScreenUtil              (for Party Tracker character access)
 └─ defines: JOURNEY_ACTIVITIES[]      (8 activities)
             CAMP_ACTIVITIES[]         (11 activities)
             PACE_OPTIONS[]            (slow/normal/fast)
             RANGE_COLORS              (risk badge styling)
             ACTIVITY_TOOL_KEYWORDS    (tool proficiency matching)
             WEATHER_PRESETS           (10 built-in weather types)
             DEFAULT_WEATHER_TABLE()   (default area weather weights)
             WEATHER_TABLE_PRESETS     (6 area weather table presets)
             _getActivityInteractions()  (cross-activity DC modifiers)
```

## State Shape

```javascript
{
  tab: number,                      // Active tab index (0=Journey, 1=Camp, 2=Area Config, 3=Log, 4=Timeline)
  riskModifier: number,             // Central RM value
  travelPace: "slow"|"normal"|"fast",
  rollMode: "raw"|"total",          // "raw" = d20+bonus, "total" = pre-calculated total
  players: [
    { id: string, name: string, isFromPartyTracker: boolean }
  ],
  area: {
    areaName: string,
    baseDc: number,                 // Default 10
    numSegments: number,            // Default 3
    segmentNames: string[],         // Default ["Morning", "Midday", "Afternoon"]
    riskRanges: {
      mild:     { min: number, max: number },    // Default 1–4
      moderate: { min: number, max: number },    // Default 5–10
      intense:  { min: number, max: number }     // Default 11–12
    },
    weatherTable: [                 // Area-specific weather probability table
      { weatherKey: string, weight: number }
    ]
  },
  journey: {
    segments: [
      {
        activities: { [playerId]: ActivitySlot[] },
        stealthSlots: StealthSlot[],
        riskRoll: number|null,        // Raw d12 roll
        riskRollTotal: number|null,   // d12 + RM
        riskRollOverride: number|null,
        rmAtRoll: number,             // RM snapshot at time of roll
        _collapsed: boolean
      }
    ]
  },
  camp: {
    campfireActive: boolean,
    activities: { [playerId]: ActivitySlot[] },
    guardSlots: GuardSlot[],
    riskRoll: number|null,
    riskRollTotal: number|null,
    riskRollOverride: number|null,
    rmAtRoll: number
  },
  weather: {
    current: string|null,           // Current weather key (e.g., "clear", "rain")
    customTypes: [                  // User-defined weather types
      { key: string, label: string, icon: string, dcMod: number, rmMod: number, paceRestrict: string|null, effects: string[] }
    ]
  },
  supplies: {
    enabled: boolean,               // Whether supply tracking is active
    food: { current: number, max: number },
    water: { current: number, max: number },
    ammo: { current: number, max: number }
  },
  timeline: [                       // Day-by-day snapshots (newest first)
    { day: number, date: string, area: string, weather: string, pace: string, segments: string, rm: number, notes: string }
  ],
  log: [
    { timestamp: ISO string, type: string, message: string }
  ]
}
```

### Activity Slot Shape

```javascript
{
  activity: string,           // Activity ID (e.g., "navigate", "scout", "custom")
  rollResult: string,         // The raw d20 roll or total number entered by user
  customName: string,         // Name for custom activities
  _rmAlwaysApplied: number,   // Tracks cumulative RM from "always" effects
  _rmRollApplied: number,     // Tracks cumulative RM from success/fail effects
  _critOverride: string|null  // Manual crit override: "critSuccess"|"critFail"|null
}
```

## Five-Tab System

| Tab | Index | Purpose |
|-----|-------|---------|
| Journey | 0 | Travel segments with activities, stealth rolls, RM tracking, risk rolls |
| Camp | 1 | Campfire toggle, camp activities, guard slots, risk roll |
| Area Config | 2 | Area name, base DC, segment count/names, risk ranges, weather table |
| Log | 3 | Chronological event log with add-note and clear-all |
| Timeline | 4 | Day-by-day snapshots with markdown export |

Tabs are rendered as a button bar. Only one tab's content is visible at a time via `display: none` toggling.

## Header

The header (always visible above tabs) contains:

| Section | Contents |
|---------|----------|
| RM Section | RM badge (color-coded), −/+ buttons, numeric RM input, Reset button |
| Weather Section | Weather type badge (icon + name), 🎲 Roll Weather button |
| Pace Section | Radio buttons: Slow / Normal / Fast |
| Controls | New Day button, Roll Mode toggle (`d20` vs `Total`), Sync status, Add Player button |

### Risk Modifier (RM)

The RM is the central mechanic. It starts at 0 and changes as players perform activities, make stealth checks, and interact with the environment.

```
Activities affect RM → RM feeds into Risk Roll → Risk Roll determines encounter severity
```

The RM badge is color-coded:
- **Low** (green): RM ≤ 2
- **Mid** (yellow): 3 ≤ RM ≤ 6
- **High** (red): RM ≥ 7

### Travel Pace

| Pace | Speed | Navigation DC | Stealth | Passive Perception | Special |
|------|-------|--------------|---------|-------------------|---------|
| Slow | 2/3 speed | −2 | Possible | +5 | Hide Tracks DC −2 |
| Normal | Standard | Area DC | No | Normal | — |
| Fast | 1.3× speed | +2 | No | — | Scout at disadvantage, no Map/Forage |

### Roll Mode

- **Raw** (`"raw"`): Player enters the d20 roll; system adds skill bonus automatically
- **Total** (`"total"`): Player enters the final total (already added bonus); system detects crits by comparing with bonus range

## Journey Tab

The Journey tab renders one collapsible **segment card** per journey segment (default 3: Morning, Midday, Afternoon).

### Segment Card Structure

```
┌── Segment: Morning ──────────────────────────────────┐
│  Activities                                           │
│  ┌─ Activity Table ────────────────────────────────┐  │
│  │ Player │ Activity │ Roll │ Result │ RM │ Banter │  │
│  └─────────────────────────────────────────────────┘  │
│  Stealth (Slow Pace only)                             │
│  ┌─ Stealth Slots ────────────────────────────────┐  │
│  │ Player │ Roll │ Result │ RM                     │  │
│  └─────────────────────────────────────────────────┘  │
│  RM Changes                                           │
│  ┌─ RM Summary ───────────────────────────────────┐  │
│  │ Activity deltas + interaction notes             │  │
│  └─────────────────────────────────────────────────┘  │
│  Risk Roll: [d12 input] [Roll] [Override]             │
│  Result: 8 (d12: 5 + RM: 3) → Moderate               │
└───────────────────────────────────────────────────────┘
```

### Group Check Logic

When 2+ players select the same activity in a segment, it becomes a **group check**:
- If **at least half** succeed → group success (use best individual result)
- If more than half fail → group failure (use worst individual result)
- RM effects apply based on the group outcome, not individual rolls

### Risk Roll

Each segment and camp phase has a risk roll:
1. Roll d12 (or enter manually)
2. Total = d12 + current RM
3. Classify by area risk ranges (default: 1–4 mild, 5–10 moderate, 11–12 intense)
4. Result is logged and color-coded

## Camp Tab

```
┌── Camp Phase ────────────────────────────────────────┐
│  🔥 Campfire: [toggle] (+1 RM while active)          │
│                                                       │
│  Activities                                           │
│  ┌─ Activity Table ────────────────────────────────┐  │
│  │ Player │ Activity │ Roll │ Result │ RM          │  │
│  └─────────────────────────────────────────────────┘  │
│  Guard Duty                                           │
│  ┌─ Guard Slots ──────────────────────────────────┐  │
│  │ Player │ Roll │ Result                          │  │
│  └─────────────────────────────────────────────────┘  │
│  RM Changes                                           │
│  Risk Roll: [d12 input] [Roll] [Override]             │
└───────────────────────────────────────────────────────┘
```

The campfire toggle adds +1 RM while active. Camp activities differ from journey activities (see [Journey Activities](./05-journey-activities.md)).

## Area Config Tab

Allows the DM to configure the current area:

| Field | Default | Description |
|-------|---------|-------------|
| Area Name | `""` | Descriptive name for the current region |
| Base DC | `10` | Default DC for skill checks |
| Segment Count | `3` | Number of journey segments per day |
| Segment Names | Morning, Midday, Afternoon | Customizable names for each segment |
| Mild Range | 1–4 | Risk roll range for mild encounters |
| Moderate Range | 5–10 | Risk roll range for moderate encounters |
| Intense Range | 11–12 | Risk roll range for intense encounters |

Changing the segment count rebuilds the journey segments (preserving existing data where possible).

### Weather Table

The Area Config also includes a **Weather Table** editor for configuring weather probabilities per area:

- **Preset selector** — 6 built-in area presets (Temperate, Desert, Arctic, Tropical, Coastal, Mountain) that pre-populate the table
- **Weather type rows** — Each row has the weather type name, a weight input, a probability bar showing the %, and a remove button
- **Add weather type** — Dropdown of available weather types (built-in + custom) not yet in the table
- **Roll Weather button** — Also available in the Area Config weather section

### Custom Weather Types

Below the weather table, a **Custom Weather Types** section allows the DM to define new weather types:

| Field | Description |
|-------|-------------|
| Icon | Emoji icon for the weather type |
| Name | Display name (auto-generates key from name) |
| DC Mod | Modifier to skill check DCs |
| RM Mod | Modifier to Risk Modifier per segment |
| Pace | Pace restriction (none/slow/normal) |
| Effects | Comma-separated special effects list |

Custom types integrate fully — they appear in weather selection dropdowns, per-segment weather pickers, the area weather table, and the roll system.

## Log Tab

The log records all significant events:
- RM changes (activity results, manual adjustments, resets)
- Risk roll results
- Party sync events (characters added/removed)
- New Day resets
- Manual DM notes

Events are displayed newest-first with timestamps. The DM can add freeform notes and clear the entire log.

## New Day

The "New Day" button (with confirmation prompt):
1. **Snapshots** the current day to the timeline (day number, area, weather, pace, segment summaries, final RM, notes)
2. **Depletes supplies** — Food: 1 per player, Water: 1 per player (2× if Extreme Heat weather), Ammo: unchanged
3. **Resets** journey state:
   - Risk Modifier → 0
   - All journey segment activities → cleared
   - All camp activities → cleared
   - Campfire → off
   - Stealth/guard slots → cleared
4. Logs the reset; existing players are preserved.

## State Persistence

The Journey Tracker saves its full state via `getSaveableState()` through the board's save mechanism. State is deeply cloned on save and load to prevent reference sharing. A migration step handles legacy single-activity-per-player format → array format for backward compatibility.

## Weather System

The weather system tracks current conditions that affect gameplay:

### Built-in Weather Types (10)

| Key | Label | Icon | DC Mod | RM Mod | Pace | Effects |
|-----|-------|------|--------|--------|------|---------|
| clear | Clear | ☀️ | 0 | 0 | — | — |
| overcast | Overcast | ☁️ | 0 | 0 | — | — |
| rain | Rain | 🌧️ | +2 | +1 | — | Light obscurement |
| heavyRain | Heavy Rain | ⛈️ | +4 | +2 | Slow | Heavy obscurement, difficult terrain |
| fog | Fog | 🌫️ | +2 | +1 | Slow | Heavy obscurement |
| wind | Wind | 💨 | +1 | +1 | — | Ranged attacks disadvantage |
| snow | Snow | 🌨️ | +3 | +2 | Slow | Light obscurement, difficult terrain |
| blizzard | Blizzard | ❄️ | +5 | +3 | Slow | Heavy obscurement, extreme cold |
| extremeHeat | Extreme Heat | 🔥 | +2 | +1 | — | CON saves, double water consumption |
| extremeCold | Extreme Cold | 🥶 | +2 | +1 | — | CON saves |

### Weather Rolling

The 🎲 Roll Weather button uses the area's weather table to select weather via weighted random. Each weather type in the table has a weight; probability = weight / total weight. The result is applied as the current weather and logged.

### Per-Segment Weather

Each journey segment can have its own weather override, selectable via a dropdown in the segment card. If no per-segment weather is set, the current global weather applies.

## Supply Tracker

The supply tracker (in the header, toggleable) monitors party resources:

| Resource | Auto-Depletion on New Day | Notes |
|----------|---------------------------|-------|
| Food | 1 per player | — |
| Water | 1 per player | 2× under Extreme Heat |
| Ammo | None | Manual tracking only |

Each resource shows current/max with +/− buttons. Supplies at 0 are highlighted in red.

## Day Timeline

The Timeline tab (index 4) shows a reverse-chronological history of completed days. Each day card displays:
- Day number, date, area name
- Weather, pace, segment count
- Final RM value
- DM notes (editable)

A **Markdown Export** button generates a formatted text summary of all days for copying into campaign notes.

## TGTT Integration

The Journey Tracker itself is **system-neutral** — it does not reference TGTT rules directly. All TGTT-specific mechanics (combat traditions, might skill, custom exhaustion) are handled by the Party Tracker. The Journey Tracker only uses generic character data (ability scores, skill proficiencies, tool proficiencies) that it receives through the Party Tracker sync.
