# Party–Journey Integration

The Party Tracker and Journey Tracker communicate through the DM Screen board event system. This document describes how character data flows between the two panels.

## Event System

### Board Events

The DM Screen `board` object provides a pub/sub event mechanism:

```javascript
// Party Tracker fires on every data change:
this._board.fireBoardEvent({type: "partyTrackerUpdate"});

// Journey Tracker listens in its panel app class:
class JourneyTracker extends DmScreenPanelAppBase {
    onBoardEvent ({type}) {
        if (type === "partyTrackerUpdate") {
            this._comp?.syncPartyCharacters();
        }
    }
}
```

### Event Triggers

The `partyTrackerUpdate` event fires when:
- A character is added
- A character is removed
- Any character field is updated (abilities, skills, name, etc.)
- Settings change (TGTT toggle, exhaustion rules, etc.)

## Character Sync

### Initial Sync

When the Journey Tracker first renders (`_doInitialPartySync()`):

1. Calls `DmScreenUtil.getPartyTrackerCharacters({board})` to get all Party Tracker characters
2. If characters exist and none are already marked as Party Tracker-sourced, imports them all
3. Logs the sync event: `"Initial sync: added N character(s) from Party Tracker"`

### Ongoing Sync

`syncPartyCharacters()` runs on every `partyTrackerUpdate` event:

1. Gets current Party Tracker characters
2. **Adds** new characters not yet in the Journey Tracker player list
3. **Updates** names of existing synced characters
4. **Removes** synced characters that are no longer in the Party Tracker
5. Logs the sync: `"Party synced: added X; removed Y"`
6. Re-renders the current tab

### Sync Rules

| Scenario | Behavior |
|----------|----------|
| New PT character | Added with `isFromPartyTracker: true` |
| PT character removed | Removed from Journey Tracker if `isFromPartyTracker: true` |
| PT character name changed | Updated in Journey Tracker |
| Manual player added | Never removed by sync (`isFromPartyTracker: false`) |
| PT not present on board | No sync — Journey Tracker operates in "manual mode" |

## Data Mapping

### What the Journey Tracker Receives

`DmScreenUtil.getPartyTrackerCharacters()` returns the full character data objects from the Party Tracker. The Journey Tracker uses:

| Field | Usage |
|-------|-------|
| `id` | Unique identifier for player/activity mapping |
| `name` | Display name in activity tables |
| `abilities` | Ability modifiers for skill bonus calculation |
| `skillProficiencies` | Proficiency levels (0/1/2) for skill checks |
| `toolProficiencies` | Tool name strings for tool bonus detection |
| `classes` | Class levels for proficiency bonus calculation |
| `journeyActions` | Number of activity slots per segment (1–4) |

### What the Journey Tracker Does NOT Use

The Journey Tracker ignores: AC, speed, senses, conditions, diseases, counters, carry capacity, exhaustion level, combat traditions, and all TGTT-specific calculated values. It computes its own skill bonuses from the raw ability/proficiency data.

## Bonus Calculation in Journey Tracker

When displaying a player's bonus for an activity, the Journey Tracker:

1. Looks up the activity's associated skill (e.g., Navigate → `survival`)
2. Maps skill → ability via `SKILL_TO_ABILITY` (e.g., survival → WIS)
3. Calculates: `abilityMod + (profLevel × profBonus)`
4. Checks for tool proficiency bonus:
   - Matches `ACTIVITY_TOOL_KEYWORDS[activityId]` against `toolProficiencies[]` (case-insensitive substring)
   - If matched **and** not already skill-proficient: adds proficiency bonus
   - Shown with 🔧 icon
5. Displays the total bonus next to the roll input

### Tool Proficiency Keywords

```javascript
const ACTIVITY_TOOL_KEYWORDS = {
    navigate: ["navigator"],
    map: ["cartographer"],
    cook: ["cook"],
    forage: ["herbalism"],
    tend: ["healer", "herbalism"],
    track: ["navigator"],
    campfire: ["tinker"],
    research: ["calligrapher", "forgery"],
};
```

Matching is case-insensitive and uses `includes()` — so `"Navigator's Tools"` matches `"navigator"`.

## Journey Actions Slots

The `journeyActions` field (1–4) on each character controls how many activity slots they get per journey segment or camp phase. By default, each character gets 1 action. The Party Tracker's expanded form has an input for this value.

In the Journey Tracker's activity table, characters with 2+ journey actions get multiple rows, each with its own activity selector and roll input.

## Manual Mode

If no Party Tracker panel exists on the DM Screen board, the Journey Tracker operates in **manual mode**:

- Sync status shows "Manual mode"
- The DM adds players manually via the "Add Player" button (prompts for name)
- Manual players are never affected by Party Tracker sync events
- All bonus calculations are unavailable (no underlying character data)

## Sync Status Display

The sync status indicator shows in the Journey Tracker header:

| Status | Display | Class |
|--------|---------|-------|
| Synced | `"Synced (N chars)"` | `dm-journey__sync-status--active` |
| Manual | `"Manual mode"` | `dm-journey__sync-status--manual` |

## Lifecycle Sequence

```
1. DM Screen loads → both panels initialize from localStorage
2. Party Tracker renders characters
3. Journey Tracker renders → calls _doInitialPartySync()
   └─ Imports all PT characters if none exist yet
4. User edits character in Party Tracker
   └─ PT fires "partyTrackerUpdate"
   └─ JT.onBoardEvent → syncPartyCharacters()
   └─ JT updates player list + re-renders current tab
5. User adds character in Party Tracker
   └─ Same flow — new player appears in JT
6. User removes character in Party Tracker
   └─ Same flow — player removed from JT (if synced)
7. Both panels save state independently to localStorage
```
