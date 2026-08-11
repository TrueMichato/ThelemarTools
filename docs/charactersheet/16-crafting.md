# Crafting, Harvesting & Cooking

The character sheet's crafting subsystem. Materials live in the Inventory; harvesting, crafting and
cooking are modal flows launched from the Inventory tab and the play-mode Actions hub.

The reference side of the same data lives at [`crafting.html`](../crafting/README.md), and both
surfaces read the **same generated file**, so they can never disagree about what a material is.

## Three flows, two of which roll dice

**Only 19 of 456 craftables have a DC** — the Arcadia 11 dishes. The Complete Crafter defines the
other 437 as *resources and time*: raw materials worth half the item's selling cost, `gp ÷ 50`
workweeks, and the right tool proficiency. Rolling for those would invent a rule none of the six
books contain.

| Flow | Check | Resolution |
|---|---|---|
| **Harvest** | Dexterity (Harvesting) vs the material's DC | Success adds the material to inventory |
| **Cook** (19 dishes) | Wisdom (Cooking) vs `craftDC` | Meets DC → Success · +5 → Delicious · natural 20 on a success → Extra Delicious. Adds the dish to inventory at that tier; the benefit lands when somebody *eats* it |
| **Craft** (437 items) | *none* | A commit dialog: materials, tool advisory, workweeks → consume → produce |

## The two invariants

### 1. Materials are inventory items, not a parallel ledger

Crafting consumes through the same `setItemQuantity` / `removeItem` calls the variant-component
cast picker reads. An Aboleth Eye spent on a Lens of Forgotten History disappears from the cast
picker with **no code in between** — there is nothing to synchronise because nothing is separate.

Any change that introduces a private material store will desync from casting the moment anyone
touches it. `test/jest/charactersheet/CharacterSheetVariantComponentInvariant.test.js` locks this,
including the exact ×3 → craft → ×2 sequence.

### 2. Every roll goes through `_rollSkillCheck`

`_rollSkillCheck(skillKey, name, event, overrideAbility, {dc})` returns
`{total, roll, mode, isSuccess, isNat20, isNat1}` and annotates the result modal with the verdict.

A local `Math.random()` would look identical and be quietly wrong: it drops conditional modifiers,
exhaustion, advantage from active states, 3D dice and roll history. Quantity rolls (`1d4 teeth`) go
through `page.rollDice` for the same reason.

## The dual-role problem

Some materials are *both* a crafting material and a spell component, and the books disagree about
them:

| | `Aboleth Eye \| Ar8` | `Aboleth Eye \| HHHVI` |
|---|---|---|
| Harvest DC | 17 | 20 |
| Quantity | ×3 | ×1 |
| Weight | 0.5 lb | 45 lb |
| Value | — | 375 gp |
| Does | enhances *legend lore* | crafts a **Lens of Forgotten History** |

It is one physical object, so the player owns **one**, and `setCraftingCatalog` merges them using
the `alsoIn` links the generator emits (~20 of 141 components have a twin).

- **Arcadia 8 has precedence** — it owns identity, weight and `variantComponent`. Applying the
  twin's 45 lb would silently rewrite a character's encumbrance.
- The twin contributes **only what Arcadia 8 lacks**: `usedInRecipes`, trade value, an alternative
  harvest DC. Those appear under `printings` for disclosure, never applied.
- **Category:** `_isVariantComponent` is tested first, so it groups under **Spell Components** (🧪)
  and carries a second **Material** badge — the material role is disclosed, not hidden.
- The **Harvest modal shows both rows**, source-labelled and marked "also in another book". Either
  roll fills the same stack.

## Where the code lives

| Path | Role |
|---|---|
| `js/charactersheet/charactersheet-crafting.js` | All three flows |
| `charactersheet-state.js` → `setCraftingCatalog` | Indexing and the twin merge |
| `charactersheet-state.js` → `normaliseMaterialKey` | The name key that makes an Ar8 eye satisfy a `\|hhhvi` ingredient |
| `charactersheet.js` → `pGetCraftingCatalog` | Lazy loader (see below) |
| `charactersheet-inventory.js` → `_getItemCategory` | Spell Components / Crafting Materials grouping |
| `charactersheet-playmode.js` → `_renderCrafting` | Actions hub card |
| `css/charactersheet.css` → `.cs-crafting__*` | Styles |

### Item materials in the workbench

The craft commit dialog carries a **Material** dropdown (`_getCraftMaterialPickerHtml()`),
so a crafted item can be stamped with one of the 72 Thelemar `itemMaterial` entities at the
moment it enters the inventory. `_addCraftedItem` writes `base.material = {name, source}`.

That is a *different* concept from the `craftingMaterial` inputs this page is otherwise
about: a bar of mithril is an **input you spend** (MAT); *Mithril* is a **property the
finished sword has** (MTL). See [21-item-materials.md](./21-item-materials.md).

### Lazy loading

`data/crafting.json` is ~2.5 MB — an order of magnitude larger than anything else the sheet loads,
and most characters never harvest. It is **not** in the initial `Promise.all`; `pGetCraftingCatalog()`
fetches it on first use and caches the promise, so concurrent callers share one request and a
failed load is not retried in a loop. A failure is non-fatal: the flows show an empty state.

## Settings

Under **Crafting & Harvesting** in the settings modal. Backfilled for older saves by
`_migrateCraftingSettingsDefaults()` — `settings` merges shallowly on load, so an old save's object
replaces the default wholesale and these keys would otherwise arrive `undefined`.

| Setting | Default | Effect |
|---|---|---|
| `enableCrafting` | on | Master toggle; hides the Inventory buttons and the Actions hub card |
| `craftingDangerousHarvest` | off | Hamund's optional rule: botching a venom or breath sac turns it on you |
| `craftingStrictCrafterGating` | off | Block craftables you lack the profession for. Off by design — the sheet advises, the DM decides |
| `craftingConsumeOnFailure` | off | For tables that houserule a crafting check; no source book defines one |
| `craftingSkipStakePrompt` | off | Suppress the pre-roll stake confirmation entirely (see below) |

## What the modals owe the player

Both flows can destroy value — a failed harvest ruins the part outright, a craft consumes
materials — so the surface carries obligations the game rules don't state.

### One row per physical thing

The books describe the same object more than once: an Aboleth Eye is a spell component in Arcadia 8
and a 375 gp creature part in Hamund's. The player owns **one eye**. The harvest table therefore
renders one row per logical material (`_buildMaterialsByCreature` runs each creature's parts through
`_buildMergedMaterials`), with the books' disagreements available behind a per-row disclosure that
carries each printing's own DC, value and Roll button. Rolling against the book in play is a table
decision, so it stays a choice rather than a silent pick.

Rows sort **rollable first, then by value descending**. A part with no recorded DC is a reference
entry, not an action, and sinks below the ones the player can act on.

### Stake confirmation, but only when there is a stake

`CharacterSheetCrafting.getHarvestStakes(material, settings)` is a pure predicate returning the
reasons this roll is worth pausing over:

- the part is worth money,
- it doubles as a spell component (named, when the catalog knows which spells),
- `craftingDangerousHarvest` is on and this material bites back.

Empty means roll silently. Prompting on every harvest would train the player to dismiss the prompt,
which is worse than having none — so junk stays one click. `craftingSkipStakePrompt` turns the
prompt off wholesale for players who don't want it.

### Show the roll, not just the verdict

Harvest and cooking results carry `rolled N vs DC M`. "The Basilisk Eye was ruined" without the
roll sends the player to the roll log to find out by how much.

### A craft can be taken back

`_consumeIngredients` returns a ledger (`{id, item, prevQuantity, wasRemoved}` per stack) and the
success dialog offers **Undo**, which `_undoCraft` uses to remove the produced item and restore
every stack exactly as it was. Escape and the close button both resolve `null` and **keep** the
craft — only an explicit Undo reverses it.

### The shopping list is a shopping list

The craft workbench bands recipes as Ready / one-short / everything else.
`CharacterSheetCrafting.getOpenBandIndex(counts, isSearching)` owns which one opens: idle, the first
(so "Ready to craft (0)" is the honest headline); searching, the first band that actually matched,
because a result behind a collapsed header isn't a result. Bands build their contents lazily on
first expand — a closed `<details>` still pays full DOM construction otherwise, and there are 456
recipes.

Each missing ingredient names the creature it comes from and clicks through to the Harvest modal,
prefilled — `_getIngredientSourceCreature` resolves it from the catalog, no new index required.

## Arcadia 11: where ingredients actually come from

The cooking rules are the one part of the corpus where the *ingredients* are as under-specified as
the dishes are specific. Arcadia 11 p23 defines harvesting in a single sentence:

> **Dexterity (Harvesting)** is the act of collecting usable ingredients, **either from the earth or
> from a dead creature**. The DC for harvesting usable ingredients from a dead creature is
> **10 + the creature's challenge rating**.

Both halves of that sentence were unreachable in the Harvest modal, which made **all 19 dishes
impossible to make**. Both are now surfaced.

### From the earth

The Harvest modal is creature-first, which is right — the trigger at the table is a corpse. But 238
catalog materials have no `harvest.creature` at all: 195 herbs (Hamund's Herbalism), 20 minerals
(The Complete Crafter), 13 Arcadia 11 food ingredients, and a handful of others. A creature-keyed
index can never reach them.

`CharacterSheetState._buildForagedMaterials` builds the complement — every merged material with no
source creature — and the modal renders it under **"From the earth"** below any creature match,
grouped by `materialCategory`. Category is a first-class search term, because this list is *browsed*:
"herb" is a plausible thing to type in a way that "Aloyleaf" only becomes once you own the book.

### From a dead creature

Ten dishes name ingredients that exist as no material and carry `uid: null` — `owlbear meat`,
`hydra meat`, `owlbear eggs`, `chuul meat` and so on. They are not missing data. They are the
generic categories the rule says you cut off the body.

Every creature with a CR therefore gets a collapsed **"Generic ingredients from the carcass"**
disclosure at **DC 10 + ⌈CR⌉**, offering synthesised rows named `<Creature> <Category>` — so
"Owlbear Meat" enters the inventory under exactly the name the recipe asks for and satisfies it with
no aliasing layer.

It is limited to **meat, fats and eggs**. Poultry and fish are kinds of meat you gather or buy
rather than butcher out of an arbitrary monster, and *"Owlbear Fish"* is the sort of line that costs
a tool its credibility. It is collapsed by default because it is the same three rows on all ~1,600
creatures, and the book-documented parts are what the player opened the modal for.

Genuinely bespoke ingredients — mimic tongue, the three oozes, shambling mound mix, *"meat, each
harvested from a different type of dinosaur"* — remain honestly unobtainable and get the ordinary
click-through instead. Inventing a DC for them would be inventing a rule.

### Component groups and summed demand

A dish is often two things: Owlbear Omelette is *"Owlbear Steak Omelette"* plus *"Toast"*, carried
in `componentGroups`. The sheet renders those as headings whenever there is more than one, so the
duplicate `fats` row reads as two dishes needing fat rather than as a data bug.

That duplication was also a real defect. Readiness keyed requirements by name, collapsing the two
`fats` rows into one requirement satisfied by a single portion — while consumption walked the raw
array and spent both. **The two halves of the same question disagreed.** Four recipes were affected
(Cauldron Bread, Owlbear Omelette, Chuul Boil, Hydra 5 Ways).

Both now derive from pure statics that sum demand per material across the whole recipe:

| Function | Used by |
|---|---|
| `getRecipeDemand(ingredients, fnGetHeld)` | The `held/required` counts, the ready/missing banding |
| `getSpendPlan(ingredients)` | The commit dialog's *"Consumes:"*, the outcome dialog's *"Spent:"*, and `_consumeIngredients` itself |

Alternative groups are exempt from summing and only ever bill for one member.

### The cook ends like the craft ends

A dish leaves nothing in the inventory, which had been taken as licence to end the flow on a toast.
But cooking consumes just as irreversibly as crafting, so `_pCookOutcome` uses the same dialog shape:
the roll and the DC, the tier's entries, an explicit *"Spent:"* line, and **Undo**.

The failed cook gets the same dialog rather than a toast — under the optional consume-on-failure
setting a botch destroys the entire ingredient list at once, which is far too much to report in
something that dismisses itself.

`getCookTier` and `getCookOutcome` are pure and fall back down the ladder, so a recipe that only
defines `success` never tells a player who rolled a natural 20 that nothing happened. (All 19 Ar11
dishes define all three tiers; the fallback is defensive.)

### Cooking produces an object

Arcadia 11 grants the benefit to *"creatures who eat the prepared food"* — cooking and eating are
two acts, and the eater need not be the cook. Crafting added its result to the inventory; cooking
did not, which quietly reassigned every dish's benefit to whoever rolled.

A successful cook now adds the dish (`type: "FD"`) with **the rolled tier baked into the name and
the entries** — `Owlbear Omelette (Delicious)` describing exactly what eating *this* portion does.
The tier has to be in the name because `addItem` merges stacks on name and source, and two portions
cooked to different standards are not interchangeable.

`type: "FD"` is now recognised by `_isConsumable`, so a dish sits on the **Consumables** tab with a
**Use** button that presents the benefit and eats the portion.

> Fixing this surfaced a pre-existing bug: the Use button's render gate was a *third* copy of the
> consumable test, `item.type === "P" || item.type === "SC"`, stricter than both `_isConsumable` and
> the dispatch path. Any `"P|DMG"` potion, lowercase type, poison, or name-matched consumable was
> listed on the Consumables tab and then offered no way to consume it. The render site now calls
> `_isConsumable` like everything else.

### The portion carries the whole ladder, not just the tier

Eight of the nineteen dishes phrase their best outcome as a back-reference — *"You can use both of
the above benefits"* — because in the book the three tiers sit in one table, stacked. Lifting only
the rolled tier into an inventory item turned the **best** outcome of eight dishes into a sentence
with no antecedent: `A Perfect Roast (Extra Delicious)` said "you can use both of the above
benefits" and listed nothing above.

`getCookedBenefitEntries(recipe, tier)` therefore tests the rolled tier's text for `/\bthe above\b/i`
and, when it matches, carries **every lower tier as well**, ordered lowest-first so it reads in book
order. An Extra Delicious roast now arrives holding `Success:`, `Delicious:` and `Extra Delicious:`.

This is what makes the tier ladder pay: the Delicious tier's *5 temporary hit points* is only
reachable on a natural 20 because the back-reference pulls it forward.

### Which benefits the sheet applies, and why not all of them

Dish benefits were measured against `parseEffectsFromDescription` across **all 57 Arcadia 11
outcomes: 17 parsed to something, 40 to nothing** — and one of the 17 was wrong. Big Wild
Charcuterie Board's *"the target takes 6 (2d6) damage"* became a standing **+6 to the eater's own
damage**, because the parser is tuned for feature prose, where damage dealt *to a target* does not
appear. Dish prose is full of it.

So `getSafeDishEffects` runs the parser and then **allowlists** — `tempHp`, `resistance`, `immunity`,
`advantage`, and `bonus` only when the target is `ac` or `speed`. Everything else, including every
`{type: "note"}` result, is dropped. (Basilisk Burgers' "can't be knocked prone" parsed as
*"Resistant to forced movement"*, which is not a thing.)

The 40 misses are **correct behaviour, not a gap**. Most dish benefits are activatable abilities
("you can use a bonus action to make an unarmed strike") or one-shot benefits the player spends when
they choose ("advantage on **a** Strength ability check"). Neither is a standing modifier, and the
sheet has no honest place to put them. `_useFood` shows every benefit block as prose and names, above
the confirm, exactly which of them it will apply mechanically — so the player can see the difference
between what the sheet is tracking and what they are tracking.

Applied effects land in two places: temporary hit points go through `setTempHp` (RAW — take the
higher, do not stack), and everything else becomes **one dismissible 🍲 active state named after the
dish**. Active states have no "until long rest" notion, and almost every Arcadia 11 duration is
exactly that, so the player ends it when the fiction says it ends. The dialog says so.

> `_normaliseDishEffect` exists because the two vocabularies disagree. `parseEffectsFromDescription`
> names a damage type bare (`lightning`), but `_getResistancesFromStates` filters on
> `target.startsWith("damage:")`. Handing the parser's shape straight to `addActiveState` produced an
> active state that displayed correctly, sat in the list, and protected the character from nothing —
> `getResistances()` stayed empty. Resistance and immunity targets are prefixed on the way out;
> advantage needs no translation, since the parser already emits the `check:wis` / `skill:perception`
> targets `getAdvantageState` matches verbatim.

### The tiers are genuinely roll-driven

`getCookTier` reads `isNat20` and `total` off the object `_rollSkillCheck` really returns, so the
ladder is driven by the die and not by a placeholder. Measured against the live roller for
A Perfect Roast (DC 15, +5 Cooking), stubbing only the d20 face:

| d20 | total | outcome |
|---|---|---|
| 3 | 8 | failure branch |
| 13 | 18 | **Success** |
| 18 | 23 | **Delicious** (beat the DC by 5) |
| 20 | 25 | **Extra Delicious**, carrying all three blocks |

`total` includes any buff dice in play (Gift of Alacrity and friends), which is what the "beat it by
5" test should measure.

### The formula requirement is a chip, not a gate

The Complete Crafter states: *"A character needs a formula for a magic item in order to create it."*
Nothing in the sheet modelled this — but **not one of the six source books stocks a formula as an
obtainable item**, so enforcing it would brick every magic-item recipe against a prerequisite no
player could satisfy.

`isFormulaRequired` therefore drives a **`Formula` chip** on magic-item recipes, in the same
advisory register as the crafter and proficiency chips, whose tooltip quotes the rule and says the
sheet won't stop you. Potions are exempt (the book carves out potions of healing and spell scrolls),
as are dishes, which are not magic items.

Note that Arcadia 11 itself has **no such requirement for dishes** — none of its five rules mentions
learning, buying or owning a recipe, and the item behind each recipe is the dish (`type: "FD"`,
consumable), not a recipe card. Any character with the ingredients may attempt any dish; the Cooking
DC is the whole gate.

### Not implemented

Two Arcadia 11 variants are deliberately absent, both because they are player-declared rather than
derivable: **Culinary Student** (Intelligence instead of Wisdom where the background justifies it)
and **Hot and Fast** (Wisdom (Survival) for harvesting, Dexterity with cook's utensils for cooking).
Shelf life is not tracked.

## What is spent, and what is left

Everything below is a class of bug the surface actually shipped. They share a shape: a number the
player was *shown* and a number the sheet *acted on* had drifted apart.

### The row's readiness is a snapshot; inventory is the authority

The workbench builds each recipe row once and closes over the `status` it computed at build time.
Nothing re-rendered after a craft, so a second click on the same row reused readiness from **before**
the first craft spent the materials — a row that read "Ready to craft" forever and minted an item per
click from an empty bag. Measured: one Young Dragon Tooth in, two `+1 Dragon Arrow` out, zero teeth
left.

`pCommitCraft` and `pCookDish` therefore recompute `status = this._getRecipeReadiness(recipe)` as
their first act and ignore what the caller passed. The row additionally takes an `onCommit` callback
and the modal re-renders with `{isPreserveView: true}`, which restores `scrollTop` and re-opens the
same bands by their `data-band` attribute. When the band the player was reading no longer has any
entries — which is exactly what happens to "Ready to craft" after you craft the only ready
recipe — it falls through to the first band that does, so a completed craft never answers with an
empty panel.

### Readiness sums stacks, so consumption must too

`_getHeldQuantity` sums **every** inventory stack whose name normalises to the material. Consumption
used to take from the first one it found. Two vials of the same part filed under two names read as
"2 held", produced the item, and left one vial behind. `_consumeIngredients` now walks the matching
stacks until the debt is paid, recording each in the undo ledger.

It walks them **materials first** (`_isCraftingMaterial` sorts ahead). Hamund's has exactly one name
collision — the *Mimic Gel* recipe is made from *Mimic Gel (3 vials)*, and both normalise to
`mimic gel` — and without the ordering the sheet would eat a finished jar to make another one while
the harvested vial sat unused. `_addMaterialToInventory` guards the same collision from the other
side: it stacks onto an exact-name match or another crafting material, never onto a finished item
that merely normalises the same way, so harvested vials stop being filed as finished goods.

### "Craft anyway" now consumes what you hold

The confirmation says crafting anyway "will consume only what you hold". It consumed *nothing* of a
part-held material: `getSpendPlan` skipped anything whose `isHeld` was false, so a player one dragon
scale short of two kept both. The plan now bills `min(required, held)` for every requirement held
above zero, and picks the better-stocked side of an "A or B" pair rather than the first.

### Fractions

Hamund's prices five recipes in fractions of a part. Stored as `0.3333`, a third spent three times
leaves `0.0001` of a crystal — a stack the player owns, can see, and can never use. Anything within
`_QUANTITY_EPSILON` of empty is removed. Requirements render through `_fmtRequired`, which maps the
recognised fractions to `¼ ⅓ ½ ⅔ ¾`.

### No cost data is not the same as no cost

Twelve Complete Crafter recipes — *Dragonplate Armor*, *Potion of Superior Mana*, *Ghost Weapon*
among them — record no ingredients at all. `nMissing` is therefore `0`, which read as ready and
offered a primary **Craft** button that minted a legendary item for free. The dialog now disables the
primary, says which book failed to list materials, and leaves only "Craft anyway" — the same override
shape used for a missing ingredient, because the player's table has to supply the answer the data
doesn't.

### A cancelled roll is not a failed roll

`_rollSkillCheck` returns `null` when the player backs out of the conditional-modifier picker.
`pRollHarvest` tested `!result?.isSuccess`, so backing out destroyed the part and, on a dangerous
material, opened the "it bit you" dialog for a roll that was never made. It now returns early on
`null`, matching `pCookDish`.

### Repeats are shown once

`getRecipeDemand` returns one row per raw ingredient and each row carries the **summed** requirement.
Fifteen recipes name a material more than once, so rendering the rows as peers asked for the total
several times over: Hydra 5 Ways printed `hydra meat 0/5` five times, reading as twenty-five. Rows
after the first carry `isRepeat`; with component groups they render as "counted above" so the group
structure still explains why fats appears twice, and without them they are dropped entirely.

## Components with a menu of uses

Most variant components do one thing. **Distilled dragon's blood** is the exception: it carries all
twelve of [The Twelve Uses of Dragon's Blood](../../homebrew/TravelersGuidetoThelemar.json)
(a canonical TGTT `variantrule`), and its potency decides how many you may invoke at once —
1 for a wyrmling's blood, 4 for an ancient's.

That is modelled as data, not prose:

```jsonc
"variantComponent": {
  "usesPerCasting": 4,
  "uses": [
    {"key": "farFlung", "name": "Far-Flung", "entry": "Double the spell's range."},
    // …twelve in canonical order
  ],
  "spellEffects": [{"match": {"any": true}, /* … */}]
}
```

When a chosen component declares `uses`, `_pChooseComponentUses` in `charactersheet-spells.js`
prompts for that many — the first pick is mandatory (it is the point of spending the vial), and a
*"Done — invoke only N"* option appears once at least one is chosen. The selections ride the cast on
`variantComponent.uses` and are rendered as effects.

Any component can adopt this by adding a `uses` array; nothing is dragon-specific in the code.

## Advisories, never blocks
- **Crafter profession → tool.** Blacksmith → Smith's Tools, Alchemist → Alchemist's Supplies,
  Cook → Cook's Utensils, and so on. Shown as a chip, green when proficient, amber when not.
- **Hamund's Crafter Skill rule.** Proficiency bonus should reach the item's rarity (+2 common
  through +6 legendary). Shown as a `Prof +N` chip when short.
- **Last component.** When a craft would consume the final unit of something that is also a spell
  component: *"This is your last Aboleth Eye; it also enhances Legend Lore."*

None of these prevent the action. The commit dialog offers **Craft / Craft anyway / Cancel**,
mirroring the Scribe Spell modal, so a player is never trapped by advice they disagree with.

## Rules sourcing

| Decision | Source |
|---|---|
| Harvesting is **Dexterity**-based | Arcadia 11 p23 — corrected from the sheet's earlier unsourced Wisdom mapping, in both `charactersheet-state.js` and the DM Screen's Party Tracker so a character's modifier matches in both |
| Cooking is **Wisdom**-based | Arcadia 11 p23 |
| Foraged materials, and carcass yields at **DC 10 + CR** | Arcadia 11 p23 — "either from the earth or from a dead creature" |
| A dish is an object somebody eats, not an effect on the cook | Arcadia 11 p23 — "grants a benefit to creatures who eat the prepared food" |
| `Formula` chip on magic items | The Complete Crafter, "Crafting Magic Items" — advisory only, since no book stocks formulae |
| No recipe is gated behind knowing it | Arcadia 11 defines no such requirement anywhere in its five rules |
| Success / Delicious / Extra Delicious | Arcadia 11 `SimRep` / `SpeRep` item properties |
| Materials at half sell cost, `gp ÷ 50` workweeks | The Complete Crafter, "Crafting an Item" |
| Proficiency bonus vs rarity | Hamund's, "Optional Rule: Crafter Skill" |
| Failed harvest of a damaging material | Hamund's, "Optional Rule: Harvesting Dangerous Materials" |
| The Twelve Uses of Dragon's Blood | TGTT, a canonical `variantrule` — Arcadia 8's raw `Dragon Blood (…)` entries are the narrow, undistilled form and are preserved unchanged |

## Adding to the data

Never hand-edit `data/crafting.json` — it is generated. Edit the source (a homebrew book, or
`data/items-variant-components-ar8.json`), then run `npm run gen:crafting`.

`test/jest/CraftingDataFreshness.test.js` regenerates and diffs against the committed file, so
forgetting that step fails loudly instead of leaving the sheet disagreeing with `crafting.html`.

## Tests

| Suite | Covers |
|---|---|
| `CharacterSheetVariantComponentInvariant.test.js` | Casting never reads categorisation; the shared-stack rule |
| `CharacterSheetCraftingCatalog.test.js` | Indexing, name normalisation, the twin merge — including against the real generated data |
| `CharacterSheetCrafting.test.js` | Readiness, consumption, alternatives, quantity rolls, advisories, the cooking ladder and its tier fallback, the back-reference carry, the safe-effect allowlist and its `damage:` normalisation, the formula advisory, summed demand across component groups, repeat display, fractional portions, partial spend under "Craft anyway", multi-stack and materials-first consumption, the near-empty clamp, the foraged-material complement, the stake predicate, band-open policy, the undo ledger |
| `CharacterSheetModal.test.js` | The shared modal wrapper every flow's dialogs go through |
| `CraftingDataFreshness.test.js` | `data/crafting.json` matches its sources |
