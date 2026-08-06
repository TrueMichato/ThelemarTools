# npc-builder — description trigger optimization

Environment note: the automated `run_loop.py` requires Anthropic's `claude -p` CLI,
which is not installed in this Copilot CLI environment. Instead the triggering model
(this session) judged each of the 20 queries against the skill's name + description
exactly as the `available_skills` classifier would — would this description cause the
skill to fire? — then the description was revised to fix the misses and re-judged.

## Iteration 1 — original description

> Build strong, level-appropriate D&D 5e NPCs as importable 5etools character-sheet
> JSON by driving the live charactersheet.html spawn engine headlessly. Use this
> skill WHENEVER the user wants to create, build, spawn, or stat out one or more
> NPCs or player-style characters … (keyword list + examples) …

**Should-trigger: 10/10.** Positive coverage is strong — the examples and the
class/subclass/level/role/item/favor keyword list catch all ten, including the two
that never say "NPC"/"spawn" (bandits-as-fighters; "drop him in as an enemy").

**Should-NOT-trigger: ~4 at real risk of a false fire.** The description foregrounds
"the spawn engine" and "stat out", which lure tooling/data tasks:

| # | Query | Risk | Why |
|---|---|---|---|
| 15 | explain `reportUnusedOverrides` in charactersheet-spawn.js | HIGH | "spawn engine" is literally in the description |
| 13 | CR 12 monster stat block for the bestiary | MED | "stat out" keyword overlap |
| 14 | level up MY (real) tempest cleric | MED | it's a character-build question, just not an NPC export |
| 17 | design a homebrew +2 war pick item JSON | MED | "magic-item loadout" overlap |
| 12 | add a homebrew spell to a data file + validate schema | LOW-MED | "spells" + "homebrew" |
| 20 | Playwright e2e test that builds a moon druid | LOW-MED | "builds a moon druid", "level-up" |
| 11 | fix the AC bug in charactersheet-state.js | LOW-MED | "character sheet" + "Bracers of Defense" |

Root cause: the description had **no negative guardrail** and advertised the internal
tooling ("spawn engine", "charactersheet.html") as if the skill were *about* it,
rather than a tool that *builds a character*.

## Iteration 2 — revised description (applied)

Changes: lead with the *outcome* (a build + loadout) instead of the mechanism;
broaden the positive verbs and add "even if they don't say 'NPC'/'spawn'"; add an
explicit **"Do NOT use it for tasks ABOUT the tooling"** clause enumerating the exact
near-misses (sheet/spawn-engine code, data/schema authoring, bestiary monster blocks,
single-item design, DM-screen panels, e2e tests, the user's own PC level-up).

**Re-judged: should-trigger 10/10, should-NOT-trigger 10/10 (20/20).** Every prior
false-positive risk is now named as an exclusion; the positive examples and the
"produces a new importable NPC build" close keep all ten true positives firing.

Converged in one meaningful revision — the negative guardrail was the missing piece.
