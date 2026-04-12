# Journey Tracker Reference

Compressed reference for `JourneyTrackerRoot`, activities, RM system, and state persistence.

## Constants

### Journey Activities (8)

| ID | Label | Skill | RM: S/CS/F/CF/Always | Notes |
|----|-------|-------|---------------------|-------|
| navigate | Navigate | survival | 0/0/0/0/0 | DC ±2 by pace |
| scout | Scout | perception | −1/−1/0/+1/0 | critSuccessPerPlayer, +2 DC to Hide Tracks |
| map | Map | investigation | 0/0/0/0/0 | Not possible at fast pace |
| forage | Forage | survival | 0/0/0/+1/0 | Not possible at fast, +2 DC HideTracks |
| hideTracks | Hide Tracks | stealth | −1/−2/0/+1/0 | DC += 2×(scouts+foragers+entertainers) |
| entertain | Entertain | performance | 0/0/0/+2/+1 | Always +1 RM (noise) |
| track | Track | survival | 0/0/0/0/0 | Normal: disadvantage, Fast: impossible |
| custom | Custom | null | 0/0/0/0/0 | Freeform |

### Camp Activities (11)

| ID | Label | Skill | RM: S/CS/F/CF/Always | Notes |
|----|-------|-------|---------------------|-------|
| campfire | Campfire | survival | 0/0/0/+2/0 | Separate toggle, +1 RM while active |
| forage | Forage | survival | 0/0/0/+1/+1 | Always +1 RM (leaves camp) |
| cook | Cook | null | 0/0/0/0/0 | Requires light, reduces exhaustion |
| pray | Pray | religion | 0/0/0/0/0 | Components may add RM |
| tend | Tend | medicine | 0/0/0/0/0 | DM adjudicates |
| entertain | Entertain | performance | 0/0/0/+2/+1 | Same as journey |
| scout | Scout | perception | −1/−1/0/+1/0 | +2 DC Hide Camp per scout |
| research | Research | null | 0/0/0/0/0 | Requires light |
| hideCamp | Hide Camp | stealth | −1/−2/0/+1/0 | Campfire: +2 DC, per scout/forage: +2 DC |
| guard | Guard | perception | 0/0/0/+2/0 | Uses dedicated guard slots |
| custom | Custom | null | 0/0/0/0/0 | Freeform |

### Pace Options

| ID | Navigation DC | Stealth | Scout | Map/Forage |
|----|--------------|---------|-------|-----------|
| slow | −2 | Possible | Normal | Normal |
| normal | Base DC | No | Normal | Normal |
| fast | +2 | No | Disadvantage | Impossible |

### Tool Proficiency Keywords

```
navigate → ["navigator"], map → ["cartographer"], cook → ["cook"],
forage → ["herbalism"], tend → ["healer","herbalism"], track → ["navigator"],
campfire → ["tinker"], research → ["calligrapher","forgery"]
```

Match: case-insensitive `includes()` against `toolProficiencies[]`. Adds prof bonus only if **not** already skill-proficient.

## Activity Slot Shape

```javascript
{ activity: string, rollResult: string, customName: string,
  _rmAlwaysApplied: number, _rmRollApplied: number, _critOverride: string|null }
```

## Risk Modifier (RM) Flow

```
Activities set RM deltas → RM accumulates → feeds Risk Roll
  rmAlways: applied on activity selection (tracked in _rmAlwaysApplied)
  rmOn*: applied on roll result (tracked in _rmRollApplied)
```

RM badge colors: low (≤2) = green, mid (3–6) = yellow, high (≥7) = red

## Risk Roll

```
Roll d12 + current RM → classify by area risk ranges:
  Default: mild 1-4, moderate 5-10, intense 11-12
  Supports: riskRollOverride for manual testing
Result logged to event log
```

## Group Check (Activities)

When 2+ players select same activity in a segment:
- ≥ half succeed → group success (use best result)
- > half fail → group failure (use worst result)
- RM effects based on group outcome

## Roll Mode

- **raw**: User enters d20 face. System adds bonus. Nat 1/20 detected directly.
- **total**: User enters final number. System estimates crit by comparing `total - bonus` to 1/20 range. Manual `_critOverride` available.

## State Persistence

```javascript
setStateFrom(toLoad):
  Deep copy all fields with defaults
  _migrateActivities(): convert single-object → array format (backward compat)

getSaveableState():
  Deep clone all state fields
  Clone activities via _cloneActivities() static method
```

## Party Sync

```javascript
syncPartyCharacters():
  1. Get PT characters via DmScreenUtil.getPartyTrackerCharacters({board})
  2. Add new PT chars (isFromPartyTracker: true)
  3. Update names of existing synced chars
  4. Remove departed PT chars (only if isFromPartyTracker)
  5. Manual players never removed
  6. Log sync event, re-render current tab
```

Sync status: "Synced (N chars)" or "Manual mode"

## Tab Rendering

| Tab | Index | Renders | Key Method |
|-----|-------|---------|-----------|
| Journey | 0 | Segment cards (collapsible) → activities + stealth + RM summary + risk roll | `_renderJourney()` |
| Camp | 1 | Campfire toggle + activities + guard slots + RM summary + risk roll | `_renderCamp()` |
| Area Config | 2 | Area name, base DC, segment count/names, risk ranges | `_renderArea()` |
| Log | 3 | Event log (newest first), add note, clear all | `_renderLog()` |

## New Day Reset

Resets: RM → 0, all activities → cleared, campfire → off, stealth/guard slots → cleared.
Preserves: players, area config, log (adds reset entry).

## Activity Interaction Analysis

`_getActivityInteractions(activities, allPlayers, activityList, pace)`:
- Counts scouts, foragers, entertainers
- Generates DC modifier notes for Hide Tracks/Hide Camp
- Flags impossible activities at current pace
- Returns string[] of warning notes displayed in RM summary
