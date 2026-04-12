# Styling Guide

Both the Party Tracker and Journey Tracker use SCSS with BEM-like naming under the `@layer vetools` scope. This document catalogs the CSS class hierarchy, color conventions, and night mode overrides.

## File Locations

| File | Prefix | Scope |
|------|--------|-------|
| `scss/includes/dmscreen-party-tracker.scss` | `.dm-party__` | Party Tracker |
| `scss/includes/dmscreen-journey-tracker.scss` | `.dm-journey__` | Journey Tracker |

Both are `@use`-imported by `scss/dmscreen.scss` and compiled to `css/dmscreen.css`.

## Party Tracker Classes

### Layout & Structure

| Class | Purpose |
|-------|---------|
| `.dm-party__root` | Panel root container |
| `.dm-party__toolbar` | Top toolbar (add button, summary, settings) |
| `.dm-party__summary` | Summary text (char count, avg level, carry) |
| `.dm-party__body` | Scrollable character list container |
| `.dm-party__card` | Expanded character card |
| `.dm-party__section` | Section within expanded card |
| `.dm-party__section-title` | Section heading |
| `.dm-party__settings` | Settings dropdown panel |
| `.dm-party__settings-title` | Settings panel heading |
| `.dm-party__settings-group` | Settings sub-toggle container |
| `.dm-party__settings-row` | Individual setting row |

### Character Row (Collapsed)

| Class | Purpose |
|-------|---------|
| `.dm-party__char-row` | Collapsed row container (flexbox) |
| `.dm-party__char-name` | Character name (truncatable) |
| `.dm-party__char-meta` | Race and class info |
| `.dm-party__char-stat` | Individual stat element (AC, passives, carry, etc.) |
| `.dm-party__char-stat--warn` | Yellow warning state (carry > 75%) |
| `.dm-party__char-stat--danger` | Red danger state (carry > 100% or exhaustion) |
| `.dm-party__char-tgtt-stat` | TGTT-specific stat (stamina, combat DC) |
| `.dm-party__conditions-summary` | Condition/disease pills container |
| `.dm-party__condition-pill` | Individual condition pill |
| `.dm-party__condition-pill--disease` | Disease-specific pill variant |

### Expanded Form

| Class | Purpose |
|-------|---------|
| `.dm-party__abilities-grid` | 6-column ability score grid |
| `.dm-party__ability-item` | Individual ability cell |
| `.dm-party__ability-mod` | Modifier display below score |
| `.dm-party__skills-grid` | 2-column skill grid |
| `.dm-party__skill-name--tgtt` | TGTT skill name styling |
| `.dm-party__senses-grid` | Senses input grid |
| `.dm-party__sense-item` | Individual sense input group |
| `.dm-party__derived-bar` | Derived stats bar (carry, jump) |
| `.dm-party__field-label` | Input field label |

### DC Calculator

| Class | Purpose |
|-------|---------|
| `.dm-party__dc-calc` | DC calculator container |
| `.dm-party__dc-title` | "DC Success Calculator" heading |
| `.dm-party__dc-controls` | Controls bar (DC input, type, skill, roll mode, group) |
| `.dm-party__dc-control-group` | Individual control group |
| `.dm-party__dc-label` | Control label text |
| `.dm-party__dc-results` | Results grid container |
| `.dm-party__dc-row-header` | Header row |
| `.dm-party__dc-row` | Per-character result row |
| `.dm-party__dc-row-summary` | Summary/average row |
| `.dm-party__dc-col-name` | Name column |
| `.dm-party__dc-col-bonus` | Bonus column |
| `.dm-party__dc-col-pct` | Percentage column |
| `.dm-party__dc-bar-wrap` | Probability bar wrapper |
| `.dm-party__dc-bar` | Probability bar (inner, colored) |
| `.dm-party__dc-bar--success-high` | Green (≥ 75%) |
| `.dm-party__dc-bar--success-med` | Yellow (≥ 50%) |
| `.dm-party__dc-bar--success-low` | Orange (≥ 25%) |
| `.dm-party__dc-bar--success-fail` | Red (< 25%) |

### DC Group Check

| Class | Purpose |
|-------|---------|
| `.dm-party__dc-group-result` | Group check result container |
| `.dm-party__dc-group-row` | Group result row |
| `.dm-party__dc-group-row--main` | Main group pass row |
| `.dm-party__dc-group-row--detail` | Crit pass/fail detail row |
| `.dm-party__dc-group-label` | "Group Check (≥N/M pass)" label |
| `.dm-party__dc-group-pct` | Percentage display |
| `.dm-party__dc-group-pct--pass` | Green text (≥ 50%) |
| `.dm-party__dc-group-pct--fail` | Red text (< 50%) |
| `.dm-party__dc-group-crit` | Crit pass/fail display |
| `.dm-party__dc-group-crit--pass` | Crit pass (✨) styling |
| `.dm-party__dc-group-crit--fail` | Crit fail (💀) styling |

## Journey Tracker Classes

### Layout & Structure

| Class | Purpose |
|-------|---------|
| `.dm-journey__root` | Panel root container |
| `.dm-journey__header` | Top header (RM, pace, controls) |
| `.dm-journey__body` | Scrollable content area |
| `.dm-journey__tab-bar` | Tab button bar |
| `.dm-journey__tab-btn` | Individual tab button |
| `.dm-journey__tab-content` | Tab content wrapper |

### Risk Modifier

| Class | Purpose |
|-------|---------|
| `.dm-journey__rm-section` | RM controls group |
| `.dm-journey__rm-label` | "RM" label |
| `.dm-journey__rm-badge` | RM value badge |
| `.dm-journey__rm-badge--low` | Green badge (RM ≤ 2) |
| `.dm-journey__rm-badge--mid` | Yellow badge (3–6) |
| `.dm-journey__rm-badge--high` | Red badge (RM ≥ 7) |
| `.dm-journey__rm-input` | RM numeric input |
| `.dm-journey__rm-btn` | RM +/− buttons |

### Pace & Controls

| Class | Purpose |
|-------|---------|
| `.dm-journey__pace-section` | Pace radio group |
| `.dm-journey__pace-label` | Individual pace option label |
| `.dm-journey__sync-section` | Sync status + add player + new day |
| `.dm-journey__sync-status` | Sync status text |
| `.dm-journey__sync-status--active` | Green "Synced" state |
| `.dm-journey__sync-status--manual` | Gray "Manual mode" state |
| `.dm-journey__roll-mode-btn` | d20/Total toggle button |

### Segment Cards

| Class | Purpose |
|-------|---------|
| `.dm-journey__segment-card` | Collapsible segment container |
| `.dm-journey__segment-header` | Segment name + collapse toggle |
| `.dm-journey__segment-name` | Segment name text |
| `.dm-journey__collapse-btn` | Collapse/expand triangle button |
| `.dm-journey__section-title` | Section heading within segment |

### Activity Table

| Class | Purpose |
|-------|---------|
| `.dm-journey__activity-table` | Activity grid container |
| `.dm-journey__activity-header` | Table header row |
| `.dm-journey__activity-row` | Individual player activity row |
| `.dm-journey__activity-row--impossible` | Red border + strikethrough for impossible activities |
| `.dm-journey__activity-name` | Player name cell |
| `.dm-journey__activity-selector` | Activity dropdown cell |
| `.dm-journey__activity-roll` | Roll input cell |
| `.dm-journey__activity-result` | Roll result display |
| `.dm-journey__activity-rm` | RM delta display |
| `.dm-journey__activity-banter` | Banter/inspiration column |

### Roll Results

| Class | Purpose |
|-------|---------|
| `.dm-journey__roll-result--pass` | Green success |
| `.dm-journey__roll-result--crit-pass` | Bold green critical success |
| `.dm-journey__roll-result--fail` | Red failure |
| `.dm-journey__roll-result--crit-fail` | Bold red critical failure |

### Risk Roll & Badges

| Class | Purpose |
|-------|---------|
| `.dm-journey__badge--empty` | Gray "Empty" result |
| `.dm-journey__badge--mild` | Green "Mild" result |
| `.dm-journey__badge--moderate` | Yellow "Moderate" result |
| `.dm-journey__badge--intense` | Red "Intense" result |
| `.dm-journey__risk-section` | Risk roll area container |

### Popover

| Class | Purpose |
|-------|---------|
| `.dm-journey__popover` | Activity info popover container |
| `.dm-journey__popover-title` | Popover heading |
| `.dm-journey__popover-body` | Popover content area |

### Other

| Class | Purpose |
|-------|---------|
| `.dm-journey__stealth-section` | Stealth slots container |
| `.dm-journey__stealth-section--disabled` | Grayed out (non-slow pace) |
| `.dm-journey__guard-section` | Guard slots container |
| `.dm-journey__camp-fire-toggle` | Campfire on/off toggle area |
| `.dm-journey__log-entry` | Individual log entry |
| `.dm-journey__note` | Informational note text |

## Color Conventions

### Probability / Success Colors

| Level | Color | Hex (Light) | Usage |
|-------|-------|-------------|-------|
| High | Green | `#28a745` | ≥75% success, crit pass, mild encounter |
| Medium | Yellow | `#ffc107` | ≥50%, warn carry, moderate encounter |
| Low | Orange | `#fd7e14` | ≥25%, approaching danger |
| Fail | Red | `#dc3545` | <25%, danger carry, crit fail, intense encounter |

### Stat Color Modifiers

| Class | Background | Text | Usage |
|-------|-----------|------|-------|
| `--warn` | `rgba(255,193,7,0.2)` | `#856404` | Carry > 75% capacity |
| `--danger` | `rgba(220,53,69,0.15)` | `#dc3545` | Carry > 100% or exhaustion > 0 |

## Night Mode

Night mode overrides are scoped under `.night-mode` selectors. Key changes:

| Element | Light Mode | Night Mode |
|---------|-----------|------------|
| `--warn` background | `rgba(255,193,7,0.2)` | `rgba(255,193,7,0.15)` |
| `--warn` text | `#856404` | `#ffc107` |
| `--danger` background | `rgba(220,53,69,0.15)` | `rgba(255,107,107,0.15)` |
| `--danger` text | `#dc3545` | `#ff6b6b` |
| DC bar backgrounds | Standard colors | Slightly muted variants |
| Group check text | Standard colors | Brighter variants for contrast |

Both SCSS files include explicit `.night-mode` blocks at the bottom for their respective elements.

## Build

```bash
npx sass scss/dmscreen.scss css/dmscreen.css
```

Both tracker SCSS files are automatically included via `@use` imports in `scss/dmscreen.scss`.
