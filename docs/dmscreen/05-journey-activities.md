# Journey Activities

The Journey Tracker defines 8 journey activities and 11 camp activities. Each activity has a skill, RM effects on various outcomes, and descriptive text for the DM. This document catalogs all activities and their mechanical effects.

## Activity Structure

Every activity object follows this shape:

```javascript
{
  id: string,              // Unique identifier (e.g., "navigate", "scout")
  label: string,           // Display name
  skill: string|null,      // Associated skill for DC checks (null = DM chooses)
  rmOnSuccess: number,     // RM delta on success
  rmOnCritSuccess: number, // RM delta on critical success
  rmOnFail: number,        // RM delta on failure
  rmOnCritFail: number,    // RM delta on critical failure
  rmAlways: number,        // RM delta applied always (regardless of roll)
  critSuccessPerPlayer: boolean, // If true, crit success RM applies per player (Scout)
  desc: string,            // Activity description
  successText: string,     // What happens on success
  critSuccessText: string, // What happens on crit success
  failureText: string,     // What happens on failure
  critFailText: string,    // What happens on crit failure
  restrictionText: string  // Pace/interaction restrictions
}
```

## Journey Activities (8)

### Navigate
| Field | Value |
|-------|-------|
| Skill | Survival |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / 0 |
| RM Always | 0 |
| Restrictions | Fast Pace: DC +2. Slow Pace: DC −2 |

Essential navigation activity. Success continues travel; failure causes lost time (1d6 hours). Crit fail may lead into dangerous territory.

### Scout
| Field | Value |
|-------|-------|
| Skill | Perception |
| RM on Success/Crit/Fail/CritFail | −1 / −1 / 0 / +1 |
| RM Always | 0 |
| Crit Success Per Player | Yes |
| Restrictions | Fast Pace: Disadvantage. +2 DC to Hide Tracks per scout |

Scouting reduces RM on success. Critical success applies −1 RM **per party member** taking this activity. Fast pace imposes disadvantage. Each scout increases Hide Tracks DC by +2.

### Map
| Field | Value |
|-------|-------|
| Skill | Investigation |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / 0 |
| RM Always | 0 |
| Restrictions | Not possible at Fast Pace |

No RM effect. Success grants advantage on next Navigation check; crit success grants advantage for the rest of the journey phase. Crit fail imposes disadvantage on next Navigation.

### Forage (Journey)
| Field | Value |
|-------|-------|
| Skill | Survival |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / +1 |
| RM Always | 0 |
| Restrictions | Not possible at Fast Pace. +2 DC to Hide Tracks per forager |

Success finds 1d4 rations; crit success finds 1d4 + proficiency bonus. Crit fail adds +1 RM. Each forager increases Hide Tracks DC by +2.

### Hide Tracks
| Field | Value |
|-------|-------|
| Skill | Stealth |
| RM on Success/Crit/Fail/CritFail | −1 / −2 / 0 / +1 |
| RM Always | 0 |
| Restrictions | Fast Pace: DC +2. Slow Pace: DC −2. Per Scout/Forage/Entertain: DC +2 each |

Effective RM reducer. DC is heavily influenced by other party activities — each Scout, Forager, and Entertainer adds +2 to the DC.

### Entertain
| Field | Value |
|-------|-------|
| Skill | Performance |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / +2 |
| RM Always | +1 |
| Restrictions | Always +1 RM (noise). May prevent stealth-based actions |

**Always increases RM** by 1 (noise). Success grants Heroic Inspiration to all allies. Crit fail adds +2 more RM. The +1 RM is applied immediately when the activity is selected, before any roll.

### Track
| Field | Value |
|-------|-------|
| Skill | Survival |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / 0 |
| RM Always | 0 |
| Restrictions | Normal Pace: Disadvantage. Fast Pace: Not possible |

Replaces Navigation for pursuit segments. No RM effect. Failure means the trail is lost.

### Custom (Journey)
| Field | Value |
|-------|-------|
| Skill | null (DM chooses) |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / 0 |
| RM Always | 0 |

Freeform activity with a custom name field. DM adjudicates all effects.

## Camp Activities (11)

### Campfire
| Field | Value |
|-------|-------|
| Skill | Survival |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / +2 |
| RM Always | 0 |
| Restrictions | +1 RM while active (toggled separately). Required for light-dependent activities |

The campfire is a **separate toggle** in the camp UI, not just an activity. Success provides a stable fire for the night. Crit success gives advantage on Cook checks. Crit fail adds +2 RM.

### Forage (Camp)
| Field | Value |
|-------|-------|
| Skill | Survival |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / +1 |
| RM Always | +1 |
| Restrictions | +1 RM (leaving camp). May require Campfire to process finds |

**Always +1 RM** because the forager leaves camp. Same gathering results as journey forage.

### Cook
| Field | Value |
|-------|-------|
| Skill | null (DM chooses — typically Cooking Tools) |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / 0 |
| RM Always | 0 |
| Restrictions | Requires light (typically Campfire). Chef feat may improve effects |

No RM effect. Success reduces 1 level of Exhaustion for each creature who eats. Costs 1 ration + 1 water per person.

### Pray
| Field | Value |
|-------|-------|
| Skill | Religion |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / 0 |
| RM Always | 0 |
| Restrictions | Special components (incense, sacrifice, chanting) add +1 RM each |

No inherent RM effect, but ritual components may increase RM at DM discretion.

### Tend
| Field | Value |
|-------|-------|
| Skill | Medicine |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / 0 |
| RM Always | 0 |

No RM effect. Benefits depend on the specific tending action (healing wounds, meditation, etc.).

### Entertain (Camp)
Identical to Journey Entertain — always +1 RM, crit fail +2 RM, success grants Heroic Inspiration.

### Scout (Camp)
| Field | Value |
|-------|-------|
| Skill | Perception |
| RM on Success/Crit/Fail/CritFail | −1 / −1 / 0 / +1 |
| RM Always | 0 |
| Restrictions | +2 DC to Hide Camp per scout |

Camp version — crit success also grants advantage on all Guard perception checks until camp breaks.

### Research
| Field | Value |
|-------|-------|
| Skill | null (DM chooses) |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / 0 |
| RM Always | 0 |
| Restrictions | Requires light. Some experiments may add RM |

No inherent RM effect. Covers studying, experimenting, crafting, ritual practice.

### Hide Camp
| Field | Value |
|-------|-------|
| Skill | Stealth |
| RM on Success/Crit/Fail/CritFail | −1 / −2 / 0 / +1 |
| RM Always | 0 |
| Restrictions | Campfire present: DC +2. Per Scout/Forage: DC +2 each. Beginning of camp only |

Camp equivalent of Hide Tracks. Campfire is a major DC modifier.

### Guard
| Field | Value |
|-------|-------|
| Skill | Perception |
| RM on Success/Crit/Fail/CritFail | 0 / 0 / 0 / +2 |
| RM Always | 0 |
| Restrictions | Can be done alongside low-intensity tasks (Banter). Multiple Guards act in shifts |

Guard duty uses dedicated **guard slots** separate from the activity table. Success prevents surprise; crit success grants advantage on initiative. Crit fail adds +2 RM (guard falls asleep).

### Custom (Camp)
Same as Journey Custom — freeform with custom name, no inherent effects.

## Activity Interactions

The `_getActivityInteractions()` function analyzes cross-activity effects:

| Interaction | Effect |
|------------|--------|
| Scout + Hide Tracks/Camp | +2 DC per scout |
| Forage + Hide Tracks/Camp | +2 DC per forager |
| Entertain + Hide Tracks/Camp | +2 DC per entertainer |
| Scout at Fast Pace | Disadvantage |
| Map at Fast Pace | Impossible |
| Forage (Journey) at Fast Pace | Impossible |
| Navigate at Fast Pace | DC +2 |
| Navigate at Slow Pace | DC −2 |
| Entertain (any) | Always +N RM where N = number of entertainers |
| Camp Forage | Always +N RM where N = number of foragers |

These interactions are displayed as warning notes in the RM summary section.

## Tool Proficiency Detection

The Journey Tracker detects tool proficiency bonuses via keyword matching against the character's `toolProficiencies[]` array:

| Activity | Tool Keywords |
|----------|--------------|
| Navigate | `"navigator"` |
| Map | `"cartographer"` |
| Cook | `"cook"` |
| Forage | `"herbalism"` |
| Tend | `"healer"`, `"herbalism"` |
| Track | `"navigator"` |
| Campfire | `"tinker"` |
| Research | `"calligrapher"`, `"forgery"` |

If a character has a matching tool proficiency and is **not** already proficient in the activity's skill, they get a tool proficiency bonus (= proficiency bonus) added to their roll. Indicated with a 🔧 icon in the UI.

## RM Delta Application

When a player rolls for an activity:

1. **rmAlways** is applied when the activity is selected (before rolling). Tracked in `_rmAlwaysApplied` to avoid double-application on re-render.
2. On roll result, the system classifies the outcome as success/crit success/fail/crit fail.
3. The corresponding `rmOn*` delta is applied and tracked in `_rmRollApplied`.
4. If a `_critOverride` is set (total roll mode), it overrides the automatic crit detection.

The RM summary section then displays the net RM change from all activities in that segment/camp phase.

## Crit Detection

### Raw Mode (d20)
- **Nat 20** → Critical Success
- **Nat 1** → Critical Failure
- Otherwise: compare total (d20 + bonus) against DC

### Total Mode (pre-calculated)
Since the raw d20 is unknown, the system estimates:
- If `total - bonus ≥ 20` → likely Nat 20 → Critical Success
- If `total - bonus ≤ 1` → likely Nat 1 → Critical Failure
- A manual crit override button lets the DM force crit status

## Group Checks

When 2+ players select the same activity in a segment:
- Results are evaluated as a **group check**
- Group success = at least half pass
- Group failure = more than half fail
- RM effects based on group outcome use the activity's RM deltas
- If `critSuccessPerPlayer` is set (Scout), crit success RM applies per player
