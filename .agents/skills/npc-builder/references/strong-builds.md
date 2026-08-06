# Making the build strong

When the user gives a role but leaves the choices open, that's a mandate to pick
well. These NPCs are meant to be *strong* — optimize like you're building a capable
character, not a random stat block. Below is the philosophy; adapt to the specific
class, subclass, and the homebrew available in this repo (TGTT and the other loaded
homebrew have deep, often-better options — prefer them when they fit).

## General priorities

- **Cap the primary stat first.** Aim for a 20 in the key ability by the level cap
  (base 17→18 pre-racial + a `"+2:"` ASI). A caster's spell save DC / attack and a
  martial's to-hit both live or die on this.
- **Then durability + action economy.** Concentration and staying upright matter
  more than a third damage feat. War Caster / Resilient (Con) / Tough for casters;
  a defensive feat or CON bump for martials.
- **Feats > flat ASIs at these levels.** By L13–L17 the class has strong feats
  available; a well-chosen feat usually beats +2 to an already-good stat. But
  **search the real feat pool before you decide** — recall keeps handing every NPC
  the same four official half-feats (War Caster, Fey Touched, Alert, Tough), which is
  precisely the "you always give the same feats" complaint. The loaded set includes
  homebrew feats (TGTT's Dreamer / Lore Mastery / Spellsword Technique, Fizban's gem-
  dragon feats, Grim Hollow, and more) plus dozens of official ones recall skips
  (Sentinel, Slasher, Crusher, Charger, Savage Attacker, Inspiring Leader, Telekinetic,
  Shadow Touched, Gift of the Gem Dragon, Observant, Mobile, Resilient, Skill Expert…):

  ```bash
  node <skill>/scripts/search-catalog.mjs feats --source TGTT
  node <skill>/scripts/search-catalog.mjs feats --name dragon
  node <skill>/scripts/search-catalog.mjs feats --noprereq          # broad browse
  ```

  Pick feats that express *this* NPC — a draconic sorcerer wants Gift of the Gem
  Dragon, not a generic Alert. And **diversify across the batch**: if two NPCs would
  share a signature feat, change one. A little overlap on pure enablers (War Caster,
  Resilient) across dedicated casters is fine; identical feat *sets* are not.
- **Cover a weakness.** Patch the holes that get NPCs killed before they act —
  initiative (Alert), a concentration safety net (War Caster / Resilient), or an
  escape/reposition (Misty Step from Fey/Shadow Touched, Mobile). Choose the one the
  build actually lacks rather than stapling the same one onto everyone.
- **Respect the pool.** Every per-level specialty / combat method / maneuver slot is
  a real power pick — steer them (see `choice-buckets.md`), don't autofill. Choose a
  coherent kit (mobility + control + a signature strike) over a grab-bag.

## Spell selection

Think in **jobs**, not a pile of "cool" spells. A caster backing a melee-heavy party
needs to cover:

1. **Win the fight** — a few reliable damage/finisher spells appropriate to the
   level (single-target nuke + an AoE + a save-or-suck).
2. **Protect & enable allies** — buffs for the front line (Haste, Greater
   Invisibility), reactive defense (Shield, Counterspell, Absorb Elements),
   and a safety net (Contingency, a revive/restoration line — often auto-prepared by
   the subclass, so don't double-spend).
3. **Control the field** — battlefield shapers (Hypnotic Pattern, Slow, Wall of
   Force, Forcecage, Banishment, Dominate).
4. **Flavour & utility** — a small number that express *who this NPC is* (a
   researcher gets Scrying / Legend Lore; a planar dabbler gets Teleport / Plane
   Shift). For wizards these can be scribed-but-unprepared, costing nothing.

Deliberately avoid redundancy: don't prepare two spells that do the same job, and
don't burn prepared slots on effects an item or subclass already grants (e.g. if a
staff casts the big blasts, prepare *other* things). When the user gives flavour
constraints ("erudite researcher", "not outright evil"), let that shape the list —
lean the theme in, but keep the core competent.

Explore the homebrew spell lists for uncommon/rare options a caster can *add* — a
well-read caster showing off breadth is a feature, not bloat, as long as the
*prepared* set stays disciplined. Don't do this from memory; the good esoterica lives
in homebrew you won't recall (Grim Hollow, Valda's, TGTT). Search by source, level,
and school, and read what you find before picking:

```bash
node <skill>/scripts/search-catalog.mjs spells --source TGTT --level 3-7
node <skill>/scripts/search-catalog.mjs spells --source GrimHollowPG24 --school N
node <skill>/scripts/search-catalog.mjs spells --name curse --json      # exact names
```

For a wizard these can be scribed-but-unprepared (via `spellbookKnown`), costing
nothing; for a known caster (sorcerer/bard) inject them with `spec.prepare`. Let the
NPC's flavour ("erudite researcher", "draconic apprentice") drive *which* esoterica —
theme first, then confirm the spell actually pulls its weight.

## Per-role guidance

**Controller / support** — Max the casting stat; War Caster + a concentration
safety net are near-mandatory. Prioritize save-or-suck control, party buffs, and
reactive defense over raw damage. Items: save-DC / concentration boosters, a Staff
of Power / Rod of the Pact Keeper analogue, Robe of the Archmagi.

**Tank** — CON and AC first; feats/abilities that punish enemies for ignoring you or
that keep you upright (sticky/retaliation effects, damage reduction, saves). Layered
defensive items; an Ioun stone or two for a stat the build can't otherwise afford.

**DPS / striker** — Cap the attack stat, then the payoff feat the build is designed
around (GWM/SS) plus something to guarantee it lands (advantage engine, accuracy).
Mobility to reach targets. Items: a damage rider (elemental/vicious), accuracy or
extra-attack support, mobility.

**Leader** — Buffs and battlefield-command effects that make the *rest* of the party
better; enough personal offense/defense to survive the front. Auras, inspiration/
command-style features, and items that project to allies.

**Skirmisher / mobile** — Speed, disengage-for-free, and hit-and-run tools (Mobile,
Alert). Reach and repositioning items; consumables for burst.

## Sanity checks before you call it done

- Primary stat at (or reaching) 20; secondary/CON not neglected.
- Every steerable pick resolved `from: "spec"` (0 warnings) — an autofilled slot is a
  missed optimization, not just a warning.
- **You searched the catalog for items, feats, and spells — the loadout and feats
  aren't a from-memory list of official staples.** If every item is XDMG/DMG and the
  feats are Alert/Tough/War Caster/Fey Touched, you skipped discovery; go back and
  `search-catalog.mjs` for themed homebrew alternatives.
- Prepared/known spells cover offense + defense + control + utility with no dead
  weight.
- Loadout is varied, role-appropriate, within the attunement budget (Ioun stones
  free), and complements the signature items — not a palette-swap of the last NPC.
  Across the batch, no two NPCs share an Ioun stone or the same signature feat set.
- `verify-npcs.mjs` shows finite AC/HP and the expected feats/scores.
