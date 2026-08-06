---
name: npc-builder
description: >-
  Build strong, level-appropriate D&D 5e NPCs (or player-style characters used as
  NPCs) as importable 5etools character-sheet JSON, making all the build choices —
  spells, feats, ASIs, subclass options, combat methods, specialties — strong and
  giving each a varied, power-appropriate magic-item loadout. Use this skill
  WHENEVER the user wants to create, build, spawn, stat out, or generate one or more
  characters to drop into their game as NPCs / villains / enemies for this
  5etools/TGTT repo — e.g. "make me a L17 wizard NPC", "build a Goliath barbarian
  tank with the Gae Bolg", "spawn a party of three optimized L12 heroes", "stat these
  bandits as actual level 8 fighters, not monster blocks", "a homebrew Daemonologist
  wizard I can import into the character sheet" — especially when they name
  class/subclass/level, a role (controller/tank/DPS/support/leader), signature magic
  items, TGTT homebrew, or divine favor, or want an importable/exported character.
  Do NOT use it for tasks ABOUT the tooling rather than building a character: fixing
  or explaining character-sheet or spawn-engine code (charactersheet-*.js), authoring
  or validating spell/item/monster data or schemas, writing a bestiary monster stat
  block, designing a single new magic item, DM-screen panels, Playwright/e2e tests,
  or advising on the user's own real player character's level-up. This skill produces
  a new, importable NPC build — reach for it whenever that's the goal, even if the
  user doesn't say "NPC" or "spawn" outright.
---

# NPC Builder

Create importable 5etools character-sheet JSON for strong, fully-optioned NPCs by
authoring a **batch data file** and running it through the headless spawn engine
in `scripts/spawn-npcs.mjs`. The engine loads homebrew, drives every picker on the
real character sheet, resolves and enriches magic items, applies divine favor and
grafts, and writes an export you can import straight into `charactersheet.html`.

The reason this beats hand-writing JSON: the character sheet recomputes AC, HP,
spell slots, feature calculations, and homebrew interactions on import. Driving the
real spawn engine means the NPC is *actually valid* — the same code path a player
build takes — instead of a plausible-looking blob that renders to `NaN`.

## When to use this

Any request to make/build/spawn/stat one or more NPCs or characters for this repo,
whether official or TGTT homebrew, at any level. If the user lists several NPCs,
build them all in one batch.

## The workflow

Work through these steps. Most of the depth is in the reference files — read the
one relevant to the step you're on rather than loading everything up front.

> **Discover before you recall — this is the difference between a good NPC and a
> lazy one.** The loaded catalog holds ~14,000 items, thousands of spells, and every
> homebrew feat — the Moorchlyne document alone has ~685 Ioun stones, and TGTT / Grim
> Hollow / Griffon's Saddlebag / Valda's and whatever the user dropped in all load
> too. Your training recall, by contrast, surfaces the same dozen official XDMG/DMG
> staples and the same three half-feats (Alert, Tough, Fey Touched, War Caster) every
> time — which reads as lazy and is the #1 complaint this skill exists to fix. So for
> **every** item, feat, and spell decision, search the real catalog first with
> `scripts/search-catalog.mjs` (by theme, rarity, type, level, source) and pick from
> what's actually there. Treat a familiar official pick as a fallback you chose *after*
> seeing the homebrew alternatives, never a default you reached for from memory.
>
> ```bash
> node <skill>/scripts/search-catalog.mjs items  --name fire --rarity "very rare"
> node <skill>/scripts/search-catalog.mjs items  --name ioun --source MECIounStones
> node <skill>/scripts/search-catalog.mjs feats  --source TGTT
> node <skill>/scripts/search-catalog.mjs spells --source GrimHollowPG24 --level 3-5
> ```


### 1. Pin down each NPC's build

Get (or infer) for every NPC: **name, race/subrace, class(es)+subclass+level,
background, role, and any signature/required items** the user named. If the user
gave a role ("controller and support", "tank and DPS") but left the choices open,
that's your mandate to make *strong* picks — read `references/strong-builds.md` for
per-role ASI/feat/spell priorities. Only ask the user when something is genuinely
ambiguous and build-defining (e.g. "which two subclass options?" when both are
plausible and they clearly care); otherwise choose well and move on.

If the build uses homebrew (TGTT subclasses, homebrew spells/items, Ioun stones),
make sure that homebrew is actually loaded in the sheet — it auto-loads with the
site's homebrew set. Homebrew item names double as the "homebrew ready" signal the
engine waits on, so referencing them in a loadout is enough.

### 2. Author the batch file

Copy `assets/npc-batch.template.mjs` to a working file (put it anywhere outside the
repo's tracked tree, e.g. the session workspace, or in a git-ignored dir). It
exports `SPECS` (the builds) and `LOADOUTS` (the items). One entry per NPC, keyed
by name.

- **Spec shape** (abilities, `classes`, the `choices` buckets, feats, graft, favor,
  spellbook): read `references/spec-format.md`.
- **Getting the choices right so they don't warn**: read
  `references/choice-buckets.md`. This is the highest-leverage reference — it maps
  every prompt kind to the bucket it reads, and explains the picklog-driven loop
  for eliminating "never matched an available option" warnings.
- **Magic items**: read `references/magic-items.md` for the loadout entry shape,
  source-preference order, attunement budget (and the Ioun-stone exception), and
  how to mine the catalog with `search-catalog.mjs` so loadouts are varied and
  homebrew-rich instead of copy-pasted official staples.
- **Making the picks strong (and homebrew-first)**: read
  `references/strong-builds.md` for per-role ASI/feat/spell priorities and the
  discipline of searching the real feat/spell pool before settling on a choice.

### 3. Spawn

```bash
node <skill>/scripts/spawn-npcs.mjs --batch <your-batch.mjs> --repo <repo-root> [--only Name1,Name2] [--out <dir>]
```

- `--repo` defaults to the current directory; it must contain `charactersheet.html`.
- `--out` defaults to `<repo>/npc-exports` (keep this git-ignored — see step 6).
- The engine auto-starts a static server on `:8080` if one isn't running, waits for
  homebrew + every referenced subclass + at least one candidate per loadout entry to
  be resolvable, then spawns each NPC (~2-3 min each).

For every NPC it writes `<Name>.json` (the import), `<Name>.report.json`
(`{summary, report}` — choices/warnings/unresolved/unhandledPrompts), and
`<Name>.picklog.json` (every real prompt: `{bucket, key, kind, count, candidates}`).

### 4. Read the report and fix warnings

Open each `<Name>.report.json`. The goal is **0 warnings, 0 unresolved, 0
unhandled**, with every steered pick showing `from: "spec"` (not `"auto"`). Warnings
almost always mean one of two things — over-declared/absent names, or a pick placed
in the wrong bucket. `references/choice-buckets.md` has the full diagnosis-and-fix
loop using the picklog. Fix the batch file and re-spawn (use `--only <Name>` to
redo just the ones that need it).

Don't suppress warnings by deleting choices — the point is to *make the choice
correctly* so the NPC is fully specified and reproducible.

### 5. Verify the re-import

```bash
node <skill>/scripts/verify-npcs.mjs --repo <repo-root> [--out <dir>] [--only Name1,Name2]
```

This re-imports each export exactly as the UI does and prints derived AC / HP /
ability scores / prepared count / feats. Confirm AC and HP are finite numbers (not
`NaN`) and match expectations. This catches item-enrichment and AC-formula
regressions that the spawn step alone won't.

### 6. Save

Exports belong in a **git-ignored** `npc-exports/` dir — they're generated
artifacts, not source. Ensure `.gitignore` contains `npc-exports/` (add it if
missing). Then tell the user the NPCs are ready to import via the character sheet's
Import button, and summarize each one's build + headline items.

## Reference files

- `references/spec-format.md` — the full spec DSL: every field, every `choices`
  bucket, grafts, favor, spellcasting, multiclass, HP.
- `references/choice-buckets.md` — which bucket each prompt reads, keyed vs flat
  overrides, and the picklog-driven loop to drive warnings to zero. **Read this
  whenever a spawn reports warnings.**
- `references/magic-items.md` — loadout format, source preference, attunement rules
  (incl. Ioun-stone free-attune), homebrew item sources, keeping loadouts varied.
- `references/strong-builds.md` — how to make the picks strong: ASI/feat priorities,
  spell-selection philosophy, and per-role (controller/tank/DPS/support/leader)
  guidance.

## Scripts

- `scripts/search-catalog.mjs` — **discovery: run this before choosing any item,
  feat, or spell.** Boots the same page the spawner uses and enumerates the full
  loaded catalog (`items` / `feats` / `spells`) with filters (`--name --source
  --type --rarity --attune --level --school --prereq`), plus a by-source histogram
  so homebrew breadth is visible. `--json` dumps exact `{name, source}` to paste
  into a loadout/spec.
- `scripts/spawn-npcs.mjs` — the spawn engine (step 3).
- `scripts/verify-npcs.mjs` — the re-import AC/HP verifier (step 5).

## Assets

- `assets/npc-batch.template.mjs` — copy-me starter batch with one complete,
  spawn-clean worked example (a L13 TGTT Sun Soul monk) plus an annotated stub.
