# DC Calculator

`PartyTrackerDcCalc` is a probability engine embedded in the Party Tracker that calculates each character's success chance against a given DC. It supports skill checks, saving throws, combat DC checks (TGTT), advantage/disadvantage, Thelemar critical roll rules, and group check mode.

## Architecture

```
PartyTrackerDcCalc
  ├─ Controls bar (DC input, check type, skill/ability selector, roll mode, group toggle)
  ├─ Results grid (per-character rows with bonus, %, colored bar)
  └─ Summary row (average or group check probabilities)
```

The DC Calculator is instantiated by `PartyTrackerRoot._renderDcCalcSection()` and receives a `getCharacters()` and `getSettings()` callback pair. It creates temporary `PartyTrackerCharacter` instances for each character to compute bonuses, so it always reflects the latest data.

## State

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `_dc` | number | `10` | Target Difficulty Class (1–40) |
| `_checkType` | string | `"skill"` | One of: `"skill"`, `"save"`, `"combatDc"` (TGTT only) |
| `_selectedSkillOrAbility` | string\|number | `"perception"` | Selected skill/ability key, or numeric save bonus for combatDc mode |
| `_rollMode` | string | `"normal"` | `"normal"`, `"advantage"`, or `"disadvantage"` |
| `_groupCheckMode` | boolean | `false` | When true, shows group check summary instead of individual summary |

The DC Calculator does not persist its own state — it resets on panel re-render.

## Controls

### Check Type Selector

| Type | Selector Shows | Bonus Source |
|------|---------------|-------------|
| `skill` | Dropdown of all skills (18 std + 7 TGTT if enabled) | `PartyTrackerCharacter.getSkillBonus()` |
| `save` | Dropdown of 6 abilities (STR–CHA) | `PartyTrackerCharacter.getSaveBonus()` |
| `combatDc` | Numeric input for target's save bonus | `PartyTrackerCharacter.getCombatMethodDc()` (inverted — shows fail % for target) |

When the check type changes, the skill/ability selector rebuilds. If the previously selected skill/ability is no longer valid, it defaults to `"perception"` (skill) or `"dex"` (save).

### Roll Mode

| Mode | Label | Effect |
|------|-------|--------|
| `normal` | Normal | Standard d20 roll |
| `advantage` | Adv | Roll 2d20, take higher |
| `disadvantage` | Dis | Roll 2d20, take lower |

## Probability Math

### Standard (Non-TGTT)

**Normal roll:**
```
target = DC - bonus
if target ≤ 1   → 95%  (Nat 1 still fails)
if target ≥ 21  → 5%   (Nat 20 still succeeds)
else            → (21 - target) / 20
Always clamped to [5%, 95%]
```

**Advantage:**
```
failSingle = 1 - successNormal
successAdv = 1 - failSingle²
```

**Disadvantage:**
```
successDis = successNormal²
```

Both clamped to [5%, 95%].

### TGTT Critical Roll Rules

When `enableTgtt` and `thelemar_criticalRolls` are both enabled, probability is calculated face-by-face using `_calcFaceByFace(dc, bonus, mode)`:

| d20 Face | Effective Total |
|----------|----------------|
| Nat 1 | `1 - 5 + bonus = bonus - 4` |
| Nat 20 | `20 + 5 + bonus = bonus + 25` |
| Others | `face + bonus` |

The function iterates all faces (or all 400 face pairs for advantage/disadvantage) and counts how many meet or exceed the DC, returning `successes / total`.

**Key difference**: No 5%/95% floor/ceiling. Under TGTT rules, 0% and 100% are possible.

### Combat DC Mode

In `combatDc` mode, the display is inverted:
- Each character row shows their **Combat Method DC** and the **target number** the opponent needs to roll
- The bar shows the **fail percentage** for the target (i.e., how likely the target is to fail the save)
- Characters without a combat DC (non-TGTT) show "No combat DC"

## Results Display

### Per-Character Rows

Each row shows:

| Column | Content |
|--------|---------|
| Name | Character name |
| Bonus/DC | Signed bonus (`+5`) or Combat DC |
| Percentage | Success % (or "Needs X+" in combat DC mode) |
| Bar | Color-coded probability bar |

Bar color classes:
- `--success-high` (green): ≥ 75%
- `--success-med` (yellow): ≥ 50%
- `--success-low` (orange): ≥ 25%
- `--success-fail` (red): < 25%

### Individual Summary

When group check mode is off:

```
Summary  |  | avg% | X/N likely succeed (≥50%) [Thelemar]
```

## Group Check Mode

When toggled on and there are ≥ 2 characters, the summary switches to group check probabilities.

### Group Check Rules

A group check succeeds if **at least half** of the participants succeed (ceil(N/2) for odd groups):

| Party Size | Need to Pass |
|-----------|-------------|
| 2 | 1 |
| 3 | 2 |
| 4 | 2 |
| 5 | 3 |
| 6 | 3 |

### Dynamic Programming Algorithm

`_calcGroupCheckProbabilities(probs)` uses exact DP (not binomial — each character has a different success probability):

```javascript
// dp[j] = probability that exactly j characters have succeeded so far
dp = [1, 0, 0, ..., 0]   // initially 0 out of 0 have succeeded

for each character i with success probability p[i]:
  next[j+1] += dp[j] * p[i]      // character i succeeds
  next[j]   += dp[j] * (1 - p[i]) // character i fails
  dp = next

// Results:
pPass    = sum(dp[threshold..n])   // ≥ ceil(N/2) pass
pAllPass = dp[n]                   // all pass (crit success)
pAllFail = dp[0]                   // all fail (crit failure)
```

This handles heterogeneous probabilities correctly — unlike a simple binomial, each character can have a different success chance.

### Group Check Display

```
┌─────────────────────────────────────────────────┐
│ Group Check (≥2/3 pass)           67%  ████░░░  │
│ ✨ Crit Pass: 12%    💀 Crit Fail: 3%          │
└─────────────────────────────────────────────────┘
```

- **Main row**: Group pass threshold, percentage, and colored bar
- **Detail row**: Crit pass (all pass) and crit fail (all fail) with icons
- Percentage text color: green (`--pass`) if ≥ 50%, red (`--fail`) if < 50%

## Refresh

The DC Calculator exposes a `refresh()` method that re-renders results. This is called by `PartyTrackerRoot` whenever a character is added, removed, or updated, ensuring the probability display stays current.
