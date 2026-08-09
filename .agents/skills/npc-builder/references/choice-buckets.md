# Choice buckets & driving warnings to zero

The spawn engine walks every picker the character sheet shows during a build and,
for each, looks up your steered choice in `spec.choices`. Getting choices into the
**right bucket** is what makes a build fully specified and reproducible — and what
makes the "Spec override never matched an available option" warnings disappear.

Read this whenever a spawn reports warnings.

## The buckets

`spec.choices` recognizes these keys (from `charactersheet-spawn.js` `CHOICE_KEYS`):

| Bucket | Prompt kinds that read it | Shape |
|---|---|---|
| `options` | generic auto-fill controls (ASIs, most subclass/level pickers, feats, skills shown as plain checkboxes) | keyed by control label |
| `optionalFeatures` | invocations, metamagic, maneuvers, fighting styles surfaced as "optional features" | keyed by featureType/progression (e.g. `"EI"`) |
| `featureOptions` | `featureChoice:subfeature` prompts (a feature that offers sub-options) | keyed by prompt/feature name |
| `skills` | `featureChoice:skill` prompts | keyed by prompt name (or flat array) |
| `tools` | `featureChoice:tool` prompts | keyed by prompt name (or flat array) |
| `cantrips` | `featureChoice:cantrip` + class cantrip pickers | flat array |
| `spells` | known-caster spell pickers (sorcerer/bard/ranger/…) | flat array |
| `spellbook` | wizard spellbook (added to book **and** prepared) | flat array |
| `expertise` | expertise pickers | keyed or flat |
| `languages` / `racialLanguages` | language pickers | keyed or flat |
| `weaponMasteries` | weapon mastery pickers | flat array |
| `combatTraditions` | TGTT combat-tradition pickers | flat array or keyed |
| `subclassChoice` | sub-selections like Divine Soul affinity | value |
| `scholarSkill` | scholar-skill prompt | value |
| `racialSkills` / `racialTools` | race-granted skill/tool pickers | keyed or flat |

## `options` is the workhorse — but not everything

Most day-to-day picks (ability score increases, per-level subclass specialty
prompts, feat slots, plainly-listed skills) come through as generic controls and
read the `options` bucket, keyed by the exact label the sheet renders:

```js
options: {
  "+2:": ["Intelligence"],
  "+1:": ["Wisdom"],
  "Skills:": ["Acrobatics", "Insight"],
  "Combat Methods 0/8": ["Perfect Edge Stance", "Twist the Blade", "Heightened Reflexes", "Instinctive Counterattack", "Retributive Blow", "Dashing Razor", "Dangerous Strikes", "Sharpened Awareness"],
  "Monk Level 2 — Specialties": ["Adept Speed"],
  "Eldritch Invocation 0/3": ["Eldritch Mind", "Devil's Sight", "Misty Visions"],
  "Feat Selection": ["War Caster", "Fey Touched", "Alert", "Telekinetic"],
}
```

**Feats are special.** Slots labelled `Feat Selection` are placed by a search-box
autofill wrapper, not the normal picker — the generic picker deliberately returns
`[]` for them so it can't grab junk. List your feats under `options["Feat Selection"]`
and the engine types each name into the feat search and clicks the real row.

**Epic boons** work the same way: at level 19+ most classes surface an
`"Epic Boon Selection"` slot that reads `options` — list the boon there
(`options["Epic Boon Selection"]: ["Boon of Irresistible Offense"]`) and it's placed
through the same search-box wrapper. A few classes have **no** boon slot at all (the
psionic Talent, for one); there the label never appears, and the only way to grant a
boon is `graft.boons` (see spec-format.md). The engine also disambiguates the
`Fighting Style` vs epic-feat label overlap, so an epic feat whose name resembles a
fighting-style prompt lands in the feat slot rather than being mistaken for a style.

## The trap: `featureChoice:*` prompts do NOT read `options`

Some prompts look generic but are `featureChoice:skill` / `:tool` / `:subfeature`
under the hood (common on TGTT martial subclasses — "Soft Skills", "Student of War",
"Battle Tactics Options", "Maneuver Options"). These read `skills` / `tools` /
`featureOptions`, **not** `options`. Put them under `options` and the pick is
silently ignored and autofilled, and you get an unused-override warning.

```js
choices: {
  options: { /* ASIs, specialties, feats… */ },
  // featureChoice:skill  → skills bucket, keyed by prompt
  skills:  {"Soft Skills": ["History"], "Student of War": ["Animal Handling"]},
  // featureChoice:tool   → tools bucket, keyed by prompt
  tools:   {"Student of War": ["Cartographer's Tools"]},
  // featureChoice:subfeature → featureOptions bucket, keyed by prompt
  featureOptions: {"Battle Tactics Options": ["Hammer and Anvil"], "Maneuver Options": ["Disarming Attack"]},
}
```

## Keyed vs flat overrides

`_getOverrides(bucket, key)` supports both:

- **Flat array** — returned for *every* prompt that consults the bucket, regardless
  of key. Fine when only one prompt reads that bucket (e.g. a lone `cantrips` list).
- **Keyed object** — the engine loosely matches the prompt's key against your object
  keys (`namesMatch`: case/spacing-insensitive). Use this whenever **multiple prompts
  share a bucket** — e.g. two `featureChoice:skill` prompts both read `skills`; a flat
  array would dump the same names into both and cross-contaminate. Keying by prompt
  name keeps each pick where it belongs.

## The picklog-driven fix loop

Every spawn writes `<Name>.picklog.json` — one entry per **real** prompt:
`{bucket, key, kind, count, candidates}`. And `<Name>.report.json` has
`report.choices` (each with `from: "spec"` if your override resolved, or `"auto"` if
it autofilled) plus `report.warnings`.

When you see a warning:

1. **Open the picklog.** Find the prompt your names were meant for. Note its real
   `bucket`, `key`, and `count`, and the exact `candidates` (the only names that will
   match).
2. **Classify the warning:**
   - **Over-declared / absent name** — you listed more names than `count`, or a name
     that isn't in `candidates`. The leftovers never match → warning. *Fix:* trim the
     list to exactly `count` names, all drawn verbatim from `candidates`.
   - **Wrong bucket** — the prompt's `kind` is `featureChoice:*` but you put the pick
     in `options` (or vice-versa). The override sits unused → warning, and the prompt
     autofills. *Fix:* move the pick to the bucket the table above maps that `kind`
     to, keyed by the prompt's `key`.
   - **Shuffled/capped pool** — the name is a *real* option, but this run's rendered
     candidate list didn't contain it. Some large TGTT pools (most notably
     `Combat Methods`, which can hold 100+ maneuvers) surface only a partial, per-spawn
     window of ~40 candidates to the picker. The matcher (`pickMany`) can only match
     names that are in *that render's* `options`, so a valid name can match on one
     spawn and warn on the next. *Fix:* pick from the pool's **stable core** — names
     that appear in the picklog `candidates` across two different spawns (the list
     shares a long identical tail; the variable part is the head). See the note below.
3. **Re-spawn** just that NPC (`--only <Name>`) and confirm the choice now shows
   `from: "spec"` and warnings are 0.

Target state for every NPC: **0 warnings, 0 unresolved, 0 unhandledPrompts**, and
every deliberate pick `from: "spec"`. A handful of `from: "auto"` entries are fine
when they're forced/only-option prompts you didn't need to steer.

Never silence a warning by *removing* a choice you wanted — that just means the NPC
autofills that slot and isn't fully specified. Make the choice correctly instead.

## Large per-spawn pools (Combat Methods et al.) — pick from the stable core

A few TGTT buckets are backed by a pool far larger than the picker renders at once.
`Combat Methods` is the canonical case: the sheet offers a partial ~40-candidate
window that reshuffles its **head** every spawn while keeping a long **identical
tail**. Because `pickMany` only matches against the render it's given, a name that
lives in the variable head matches on some spawns and warns on others — even though
it's a perfectly real maneuver.

To choose reliably:

1. Spawn once, read `<Name>.picklog.json`, and copy the `candidates` for the bucket.
2. Spawn a second time (any `--only <Name>` run) and copy that run's `candidates`.
3. Intersect the two. Names present in **both** are the stable core — safe to pin.
   The tail (identical across runs) is the safest of all.
4. List exactly `count` names, all from the intersection, and re-spawn to confirm 0
   warnings.

Never pad the list with extra "backup" names hoping one lands — every name beyond a
match that doesn't resolve is its own warning. Pick from the core and list exactly
`count`.

## Feats: list exactly as many as the build has ASI/feat levels

The picklog logs a `Feat Selection` control **every time the autofill re-encounters
it** across its multi-pass sweep, so a single feat slot routinely shows up two or
three times. Counting `Feat Selection` entries in the picklog therefore *overstates*
how many feats you can actually place. The real capacity is the number of
**ASI/feat levels** in the build (each class's ASI levels — Fighter 4/6/8/12/14/16,
Rogue 4/8/10/12, most classes 4/8/12/16/19 — plus any origin-feat the race grants).

The spawner's feat priming reveals one selector per ASI level it can flip to "feat"
mode; once those run out it stops, and every name past that point warns
(`"…" (options.Feat Selection) never matched`). Ordering is preserved, so the
**trailing** names in your list are the ones that fall off.

*Fix:* count the build's ASI/feat levels and list exactly that many feats, best
ones first. If you're unsure of the count, spawn once with your full wishlist and
see how many place `from: "spec"` — the count that lands **is** the capacity; trim
the list to it. (Example from a Fighter 6 / Wizard 3 / Warlock 4: 3 ASI levels →
exactly 3 curated feats; a 2014 Variant Human here grants no extra origin feat.)

## Source-suffixed option pools need the *exact* candidate string

`namesMatch` (see `charactersheet-spawn.js`) compares by exact / punctuation-stripped
/ article-stripped equality — it has **no substring or startsWith fallback**. So a
bare name will **not** match a candidate that carries a trailing source tag. The
canonical trap is Fighting Style, whose candidates render as
`Two-Weapon Fighting (PHB'24)`, `Archery (PHB'24)`, `Great Weapon Fighting (PHB'24)`,
etc. Overriding with `"Two-Weapon Fighting"` warns; you must write
`"Two-Weapon Fighting (PHB'24)"` verbatim. When a picklog `candidates` entry has a
`(...)` suffix, copy the whole thing.

## Grant off-list proficiencies with a graft, not a phantom featureChoice

If a skill/tool you want isn't offered by any of the build's real pickers, grant it
with `graft: {skills: {prof: [...], expertise: [...]}}` — a direct post-build state
edit. Do **not** key a `skills:` override to a *specialty* the character didn't pick:
options like the Rogue's `Extra Skill Training` only expose a skill sub-picker **after
you select that specialty**, so keying `skills: {"Extra Skill Training": [...]}`
without choosing it never matches. Expertise on a skill requires proficiency first —
if you graft `expertise: ["perception"]`, graft `prof: ["perception"]` too (or the
proficiency must come from a class/race list), or the expertise is invalid.

## Migrating an existing sheet (e.g. a PDF) into a TGTT NPC

When the source is a finished lower-level character rather than a blank concept:

1. **Transcribe, then re-map to TGTT.** Read off race, classes, subclass, ability
   array, and signature items. Swap each subclass to its TGTT equivalent where one
   exists (e.g. a generic Sea-themed druid → `Circle of the Sea`), and honor TGTT's
   structural rules — e.g. TGTT gates Bladesinging behind Wizard 3, so a level-8
   bladesinger becomes a multiclass, not a straight wizard.
2. **Level to the target** by extending `classes[].level`; let the spawner walk every
   intervening choice. Keep the original ability array as the base — TGTT ASIs/feats
   layer on top.
3. **Re-gear to the cohort's power band.** Preserve the character's iconic items
   (create them as `custom` items if they don't exist), then top up to the same
   legendary/very-rare/rare budget as the other NPCs at that level, favoring homebrew.
4. Drive to 0 warnings with the picklog loop exactly as for a from-scratch build.

## Choosing between level splits — decide empirically, not from memory

When a multiclass NPC's final level(s) could go to any of several classes and the
"best" choice depends on the concept (e.g. "which 13th level makes this gish the best
bag-of-tricks?"), do NOT reason it out from remembered class tables — TGTT reworks
class progressions, so memory is unreliable. Spawn the alternatives and diff their
*computed* capabilities:

1. Copy the finished spec into a throwaway `_variants.mjs` with `export const SPECS`
   (the loader requires that name), one entry per candidate split. Give every variant
   the FULL known-good choice set — stripped/empty choices stall the build at level 1
   because autofill can't clear early required gates (Fighting Style, Weapon Mastery,
   Combat Methods). Tail mismatches autofill harmlessly.
2. Spawn to a temp dir, then diff the exports on the reservoirs that matter: feats
   (a level that grants no ASI silently costs a feat), spell slots per level
   (`spellcasting.spellSlots[N].max`), `spellcasting.pactSlots`, superiority dice +
   maneuvers known (`resources[]`), invocations, spellbook size.
3. Watch for "trap" levels that look like progress but add nothing structural. The
   classic: **Warlock pact slots do not upgrade every level** — Warlock 3→4 keeps
   `pactSlots` at 2×L2 (the jump to L3 pact slots is at Warlock 5), so a 4th warlock
   level only buys a cantrip + the ASI. A full-caster level (e.g. Wizard 3→4) instead
   adds a slot at the character's top spell tier AND keeps the feat — usually the
   stronger pick for a spell-slinger. Let the diff, not intuition, make the call.
4. Delete the `_variants.mjs` and temp dir once the winner is chosen and folded back
   into the deliverable spec.
