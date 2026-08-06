# Spec format — the NPC build DSL

A batch file exports `SPECS` (builds) and `LOADOUTS` (items), each keyed by NPC
name. This doc covers `SPECS`; see `magic-items.md` for `LOADOUTS`.

```js
export const SPECS = {
  <Key>: { /* one spec, see fields below */ },
};
```

`<Key>` is just the object key (usually the character's short name); the actual
character name comes from the `name` field. `--only <Key1>,<Key2>` selects a subset.

## Fields

| Field | Req? | Notes |
|---|---|---|
| `name` | ✓ | Character name written to the sheet/export. |
| `race` | ✓ | Race name as it appears in the sheet's race list. |
| `subrace` | – | Only if the race has subraces (e.g. TGTT `"Clairnian"`, `"Theocracian"`). |
| `background` | ✓ | Background name. |
| `classes` | ✓ | Array of legs (see below). Multiclass = several legs. |
| `abilities` | ✓ | **Base** scores (pre-racial): `{str,dex,con,int,wis,cha}`. |
| `choices` | ✓ | The picker overrides — see `choice-buckets.md`. |
| `hp` | ✓ | `"average"` or `"max"`. |
| `favor` | – | TGTT divine favor (see below). |
| `graft` | – | Post-spawn skills/abilities bolted on (see below). |
| `regrantedCantrips` | – | Names of cantrips a feature re-grants on import; drops the stored duplicate. |

### `classes`

```js
classes: [
  {name: "Monk", source: "TGTT", subclass: "Way of the Sun Soul", subclassSource: "TGTT", level: 13},
]
```

Multiclass — one object per class, each with its own `level`; the engine builds them
in listed order:

```js
classes: [
  {name: "Barbarian", source: "TGTT", subclass: "Path of the World Tree", subclassSource: "TGTT", level: 6},
  {name: "Bard",      source: "TGTT", subclass: "College of the Moon",    subclassSource: "TGTT", level: 7},
]
```

`source`/`subclassSource` are the sheet's source codes. Homebrew subclasses live
under their homebrew source (`TGTT`, `GrimHollowPG24`, …). Every referenced subclass
must be registered before spawn — the engine waits for exactly that, so a typo'd
subclass name will hang the readiness wait (fix the name).

### `abilities`

Base scores only. Racial bonuses and the `"+2:"`/`"+1:"` ASI choices are layered on
by the engine, so a `dex: 18` with a `"+2:": ["Dexterity"]` choice ends at 20. Put
your primary at 17→18 pre-racial so a +2 lands it on 20 by level cap.

### `choices`

The heart of the build. Full bucket reference in `choice-buckets.md`. Quick shape:

```js
choices: {
  options: {                     // generic controls: ASIs, specialties, feats, plain skills
    "+2:": ["Intelligence"],
    "+1:": ["Constitution"],
    "Skills:": ["Arcana", "History"],
    "Feat Selection": ["War Caster", "Fey Touched", "Alert", "Telekinetic"],
    "Eldritch Invocation 0/3": ["Eldritch Mind", "Devil's Sight", "Misty Visions"],
  },
  // featureChoice:* prompts read their own buckets, NOT options:
  skills:         {"Soft Skills": ["History"]},
  tools:          {"Student of War": ["Cartographer's Tools"]},
  featureOptions: {"Battle Tactics Options": ["Hammer and Anvil"]},
  optionalFeatures:{"EI": ["Agonizing Blast"]},
  weaponMasteries: ["Greataxe|XPHB", "Greatsword|XPHB"],
  combatTraditions: ["Adamant Mountain", "Tooth and Claw"],
  expertise:      {"Bard Level 2 — Expertise": ["Athletics", "Nature"]},
  // Spell selection:
  cantrips:  ["Mind Sliver", "Ray of Frost", "Fire Bolt"],
  spells:    ["Healing Word", "Faerie Fire", "Hypnotic Pattern"],  // known casters
  spellbook: ["Shield", "Counterspell", "Teleport", "Wish"],        // wizards (book + prepared)
}
```

Weapon-mastery names sometimes need the `Name|SOURCE` form when the first grant
carries an edition tag (e.g. `"Greataxe|XPHB"`); a later bare slot can be just
`"Handaxe"`. The picklog shows the exact candidate strings.

## Spellcasters

- **Wizard** — `spellbook` is the curated list added to the book **and** prepared;
  it should total `level + INT mod` prepared spells. Additional flavour spells the
  wizard merely *knows* can be scribed but left unprepared (a wizard pays nothing to
  hold them) to showcase scholarship without competing for prepared slots.
- **`spellbookKnown`** (top-level, a sibling of `choices` — **not** inside it) — the
  scribe-but-unprepared library. Keep it at the top level on purpose: entries here are
  scribed directly via `addSpell`, so the spawn picker never sees them and can't
  false-flag each one as an unmatched option. This is where a wizard's "vast dark
  arsenal" of extra known spells lives (Octavius scribes 14 esoterica this way, on top
  of his 25 prepared).
- **Prepared/known casters** (cleric/druid/paladin/etc.) — the subclass often
  auto-prepares domain/oath spells; don't spend chosen slots duplicating them. Use
  `spells` for the picks the class actually lets you choose.
- **Fixed cantrips** — some cantrips are granted by race/feat/subclass; only list the
  ones the class actually *lets you choose* under `cantrips`, and use
  `regrantedCantrips` for any the reconcile step re-grants on import (prevents a
  stored duplicate showing twice).

## `favor` (TGTT divine favor)

```js
favor: {god: "Zeus|TGTT", level: 50, boonChoices: {"zeus-apostle-asi": "str"}},
```

`god` is `Name|Source`; `level` is the favor total; `boonChoices` steers any
favor-tier sub-choices (keyed by the boon's id → the chosen value). Order matters —
the engine sets god, then level, then applies boon choices.

## `graft` (bolt-on abilities)

For "give this NPC a couple of levels of X's abilities" requests without a full
multiclass leg — writes skill proficiencies/expertise straight to state and adds
custom abilities:

```js
graft: {
  skills: {prof: ["stealth", "perception", "investigation"], expertise: ["stealth", "perception"]},
  customAbilities: [
    {name: "Cunning Action", icon: "🗡️", category: "homebrew", mode: "active",
     activationAction: "bonus", description: "Bonus Action to Dash, Disengage, or Hide."},
    {name: "Sneak Attack (1d6)", icon: "🩸", category: "homebrew", mode: "passive",
     description: "Once per turn, +{@dice 1d6} with advantage or an ally adjacent. Finesse/ranged only."},
  ],
}
```

Skill keys are lowercase, no spaces (`sleightofhand`). `mode` is `active` or
`passive`; `activationAction` (`bonus`/`action`/`reaction`) applies to active ones.
Descriptions accept `@tag` syntax.

`graft` also carries two more channels:

- **`skillTotals`** — pin a computed skill total to an exact number, regardless of
  how ability/prof/expertise/item bonuses stack. Use it for a signature supernatural
  sense the normal math can't reach (e.g. an empath assassin who *reads everyone*):

  ```js
  graft: {skillTotals: {perception: 40}},   // total lands on +40 (passive 50)
  ```

  The engine sets a flat custom modifier so `getSkillMod` returns the target, and it
  survives re-import. This is the sanctioned "you can manually set it" channel.

- **`boons`** — grant an epic boon **directly**. Some classes have no epic-boon
  selection slot (the psionic Talent, for one), so the normal `"Epic Boon Selection"`
  options label can't reach them; injecting is the only way. Each entry is a boon name
  or `{name, source, ability}`. The engine looks the boon up in the full feats catalog
  and wires it via `addFeat` (deriving its description, uses, modifiers, and spells).
  Because many boons increase a *chosen* ability (an unresolvable `{choose}` block in
  headless mode), pass `ability` to say which score the +1 feeds so it lands
  deterministically:

  ```js
  graft: {boons: [{name: "Boon of Fate", source: "XPHB", ability: {cha: 1}}]},
  ```

  If the class *does* have a boon slot, prefer the normal route —
  `choices.options["Epic Boon Selection"]: ["Boon of …"]` — and reserve `graft.boons`
  for the slotless classes. **But check the boon actually does something for the
  build**: a boon whose benefit hinges on a feature the NPC lacks is a dead pick. For
  example `Boon of the Archlich` (GrimHollowPG24) only charges a Lich's *Soul
  Vessel* — useless on a non-Lich wizard. Read the boon's text and match it to the
  class fantasy (a Sangromancer wants `Boon of the Soul Drinker`: Cold/Necrotic
  resistance + a soul-harvest heal, and its +1 can feed INT). When you *replace* a
  boon that was previously filling a real slot, delete the old
  `choices.options["Epic Boon Selection"]` entry and grant the new one via
  `graft.boons` so it lands deterministically without an interactive ability pick.

- **`graft.profBonus: N`** — a flat proficiency-bonus bump. Some items grant "+1
  proficiency bonus" (e.g. `Ioun Stone, Mastery`) as prose only, with no structured
  field, so the sheet can't apply it on import. `getProficiencyBonus()` sums
  `customModifiers.proficiencyBonus`, so this graft makes the +1 land. Attach it to
  the NPC that carries the item and verify `customModifiers.proficiencyBonus` in the
  export:

  ```js
  graft: {profBonus: 1},   // the Ioun Stone, Mastery's +1 PB
  ```

- **`graft.abilityScores: {int: 2, …}`** — a flat, permanent ability-score bump
  written into `customModifiers.abilityScores`, which `getAbilityScore()` sums as a
  "featureBonus". Use it to bake in a stat gain that has **no persistent item** to
  carry it — most often to replace a nonsensical one-use consumable "tome"/"manual"
  (a `Tome of Clear Thought` sitting in an attuned loadout; see magic-items.md). Unlike
  raising the spec's base `abilities.int`, this is **not** overridden by the builder's
  auto-ASI allocation, and it survives export/import. Verify
  `customModifiers.abilityScores` in the export and re-check the total on the spawn's
  `abil:` line (remember an epic boon's +1 shows up separately in
  `directAbilityBonuses`):

  ```js
  graft: {abilityScores: {int: 2}, boons: [/* … */]},   // bakes in a removed tome's +2 INT
  ```

## Self-contained helper

The batch is imported as a module, so define the loadout helper inside it:

```js
const P = (name, source) => ({name, source});
```

See `assets/npc-batch.template.mjs` for a complete, spawn-clean example.
