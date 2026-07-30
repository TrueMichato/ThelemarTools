# Effect Tags

Effect tags are what make "show me everything that deals fire damage" or "show me everything that
grants a flying speed" possible across ~2,300 entries whose mechanics are written as prose.

They are deliberately **coarse**. They exist to narrow a list, not to model mechanics precisely —
the stat block is still the source of truth for what a thing actually does.

## Taxonomy

Defined in `EFFECT_TAG_GROUPS` in `node/generate-crafting-data/crafting-effect-tags.js`, and
mirrored in `PageFilterCrafting.EFFECT_TAG_GROUPS` so the filter can group them.

| Group | Tags |
|---|---|
| Damage Type | acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison damage, psychic, radiant, slashing, thunder |
| Restoration | healing, temporary hit points, cures condition, cures disease, neutralises poison, revives |
| Protection | resistance, immunity, vulnerability, armour class, absorbs damage |
| Rolls | advantage, disadvantage, ability score, skill bonus, attack bonus, saving throw bonus, critical hit |
| Conditions | blinded, charmed, deafened, frightened, grappled, incapacitated, invisible, paralysed, petrified, poisoned, prone, restrained, stunned, unconscious |
| Movement | flying speed, swimming speed, climbing speed, burrowing speed, increased speed, teleportation, planar travel |
| Senses | darkvision, blindsight, tremorsense, truesight, detects magic, scrying |
| Magic | grants spell, spell component, concentration, summoning, animates dead, shapechanging, wild magic, dispels magic, counters magic |
| Mechanics | forces a saving throw, area of effect, requires an action, lasting effect, single use |
| Crafting Use | armour material, weapon material, ammunition, poison crafting, potion crafting, food, crafting ingredient, spell reagent, trade good |
| Utility | light source, adhesive, acid solvent, waterproofing, disguise, language, communication |

**Mechanical groups** are everything except *Crafting Use* and *Utility*. An entity with at least
one mechanical tag gets `hasMechanicalEffect: true`, which drives the "Has Mechanical Effect"
miscellaneous filter — the fastest way to hide the ~1,100 harvestables that are pure trade goods.

## How tags are assigned

Three passes, in order:

1. **Pattern matching** over the entity's flattened, tag-stripped text. Damage-type patterns
   require a damage context (`fire damage`, not `fire pit`). Four crafting tags — armour material,
   weapon material, ammunition, potion crafting — are gated behind a "this text is about making
   something" check, because *armour* and *weapon* otherwise appear in almost every description.

2. **Structured effects**, where they exist. Arcadia 8 components carry a real
   `variantComponent.spellEffects` block, so their damage types, healing, advantage, condition and
   concentration effects are read directly rather than guessed at.

3. **Fallbacks**, applied after the crafting graph is built (`applyFallbackTags`):
   - anything in a gatherable category gets `crafting ingredient`;
   - anything with a known value but no mechanical tag gets `trade good`.

   This is why coverage is ~99.9% without pretending that every dragon scale has a magical effect.

## Correcting a tag

Edit `data/crafting-effect-overrides.json` and re-run `npm run gen:crafting`. Overrides are
applied last, so they always win.

```jsonc
{
  "overrides": {
    "alhoon skin|hhhvii": {
      "add": ["psychic", "lasting effect"],
      "remove": ["trade good"]
    }
  }
}
```

Keys are `name|source`, lowercased. Tag names must come from the taxonomy above — an unrecognised
tag will be stored but will never appear in the filter, so it is effectively invisible.

## Adding a new tag

1. Add it to the appropriate group in `EFFECT_TAG_GROUPS`
   (`node/generate-crafting-data/crafting-effect-tags.js`).
2. Add a matching `[tag, pattern]` entry to `_PATTERNS`, ordered within its group.
3. Mirror the group entry in `PageFilterCrafting.EFFECT_TAG_GROUPS` (`js/filter-crafting.js`) so
   the filter renders it.
4. Re-run `npm run gen:crafting` and check the coverage line in the report.

If the new tag is mechanical, no further work is needed — `_MECHANICAL_GROUPS` is derived from the
group names.
