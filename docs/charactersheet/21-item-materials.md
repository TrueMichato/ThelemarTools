# Item Materials — Thelemar Homebrew

Covers the **Thelemar item-materials** system: 72 `itemMaterial` entities in
`homebrew/TravelersGuidetoThelemar.json` (source `TGTT`) and the sheet-side engine in
`js/charactersheet/charactersheet-materials.js` that projects them onto items.

The same 72 entities are lifted into `data/crafting.json` and browsed on `crafting.html`
as the fourth entity type (`MTL`) — see [`../crafting/05-item-materials.md`](../crafting/05-item-materials.md).

## The idea

Before this system the sheet had three item-shaping paths — **Upgrades**, **Crafting**,
and **Custom item creation** — but no concept of what an item is *made of*. Materials add
a **fourth, orthogonal axis**.

A material is stored on an item as a **non-destructive reference**, exactly like
`appliedUpgrades`:

```jsonc
"item": {
  "name": "Longsword",
  "dmg1": "1d8",              // never mutated
  "material": {"name": "Darkmetal", "source": "TGTT"}
}
```

The base item is **never rewritten**. Effects are resolved at **read time** by a projection
inside `CharacterSheetState.getItems()`, so a material can be swapped or removed at any
point and the item returns to its printed stats.

> Use `state.getItemRaw(id)` when you need the **unprojected** item (the picker preview
> does this — previewing against an already-projected item was a real bug).

## Data model

Each material declares six axes plus metadata. Every axis is **tri-state**:

| Value | Meaning |
|---|---|
| a number | apply this value |
| `0` | explicitly no effect |
| `"na"` | this axis cannot apply to this material |
| `null` | *Varies* — the book gives no single value |

`magicCapacity` additionally accepts `"infinity"` (Jadoo) and `"-infinity"` (Lead).

```jsonc
{
  "name": "Darkmetal", "source": "TGTT",
  "materialCategory": "metal",   // metal wood stone crystal cloth organic constructed condensate
  "density": 15.62,              // g/cm³ — drives the weight multiplier
  "damage": 1,                   // signed steps on the die ladder
  "protection": 19,              // sets base armour AC, *before* Dex and shield
  "critical": 0,                 // lowers the crit threshold by N (clamped)
  "penetration": 2,
  "magicCapacity": 6,
  "rarity": "very rare",
  "price": {"gp": 550, "unit": "lb", "display": "550 gp per lb.", "isPriceless": false},
  "color": {"css": "#000000"},
  "objectAc": 21,
  "appliesTo": ["weapon", "armor", "shield", "other"],
  "roles": ["strikingSurface", "protectiveLayer", "focus"],
  "effects": [ /* structured — see below */ ],
  "entries": [ /* verbatim prose */ ]
}
```

### Structured effects

Effects are **declared as data**, never hardcoded per material name. 33 types are in use:

| Group | Types |
|---|---|
| Weapon properties | `addProperty`, `removeProperty`, `propertyLadder` |
| Armour | `armorForceHeavy`, `armorStealthDisadvantage`, `armorNoStealthDisadvantage`, `armorNoStrengthRequirement`, `armorStrengthRequirementDelta`, `armorDexCapDelta`, `armorWearableUnderClothing` |
| Bonuses | `bonusAc`, `bonusInitiative`, `bonusCritDamage`, `speedDelta`, `rangeMultiplier`, `thrownRangeDelta` |
| Damage | `damageReduction`, `extraDamageDiceVsType`, `overrideDamageType` |
| Tags | `countsAsMagical`, `countsAsSilvered`, `indestructible`, `spellcastingFocus` |
| Rolls | `saveAdvantage`, `perceptionPenaltyToNotice`, `noRangedDisadvantageInMelee`, `penetrationIgnoresMagicalAc` |
| Actions | `grantsAction` |
| Condensates | `condensateAffinity`, `condensateInstability` |
| Draconic | `draconicResonanceSlot` |
| Ioun | `doubleNumericProperties` |
| Advisory | `note` |

Most effects accept an `appliesTo` gate so one material can behave differently on a weapon
than on a shield. **Darkmetal's `+1 AC` is gated to `["shield"]`** — it is not a
free +1 on armour.

### Authored effect notes

An effect may carry a `note`. By default that note is the book's own wording for the effect
and **replaces** the sheet's generated one-line summary — Deep Crystal's `spellcastingFocus`
note is a complete sentence, so printing both would say the same thing twice.

Some notes are only a *qualifier* — a sentence fragment that narrows when the effect applies
("While wielding a yellowwood longbow or shortbow."). Those carry `"noteMode": "qualifier"`
and are **appended** to the generated summary with an em dash instead of replacing it. Four
effects are tagged this way (Silver, Stout Blackwood, Yellowwood, Mirror Amalgam).

Notes on effects that generate no summary line of their own (`rangeMultiplier`, `addProperty`,
…) are surfaced as free-standing notes so their prose is never lost. `grantsAction` is exempt
from both rules — its note *is* the action's description.

### Degradation (Phase 4)

Five materials carry a `degradation` block (Duststone, Obsidian, Ordinary Glass, Rimeglass,
Stone and Flint). These are **authored but not yet automated** — they render on the crafting
page and are reserved for Phase 4.

## Elemental condensates and roles

The eighteen materials with `"materialCategory": "condensate"` each carry one
**Affinity** (a benefit) and one **Instability** (a drawback).

> *"An elemental condensate can replace a weapon's striking surface, an armour's primary
> protective layer, or a spellcasting focus. **Its special property applies only in that
> role.**"*

The affinity is therefore **role-scoped**. Smokestone's affinity is a `focus` property, so a
Smokestone *blade* is simply a blade of dense smoke-stone: it does **not** grant the
bonus-action smoke cloud.

### How the role is decided

The role is derived from the item, and only stored when there is genuinely a choice:

| Item kind | Roles it can host |
|---|---|
| Weapon | Striking surface, spellcasting focus |
| Armour, shield | Protective layer |
| Anything else | Spellcasting focus |

Only a **weapon** is ambiguous, so only a weapon gets a selector. The chosen role is stored on
the material reference as `item.material.role`; absent, the first available role is used
(striking surface for a weapon). A stored role the item cannot host is ignored rather than
honoured.

### What the gate does and does not suppress

| | Gated by role? |
|---|---|
| The affinity's **mechanical** effects (`grantsAction`, `resistance`, `overrideDamageType`, …) | **Yes** — dormant outside their role |
| The `condensateAffinity` **description** | No — it still renders, marked `(dormant)`, with a line explaining which role would wake it |
| `condensateInstability` | **Never** — instability is inherent to the substance, not the role. A Rootstone breastplate is heavy whatever you call its role |

Role-specific instabilities that genuinely differ by item kind (Rootstone's −5 ft. speed on
armour) are already `appliesTo`-gated in the data and need no role logic.

### API

| Method | Returns |
|---|---|
| `CharacterSheetMaterials.isRoleScoped(material)` | `true` for condensates |
| `CharacterSheetMaterials.getAffinityRole(material)` | The role the affinity belongs to |
| `CharacterSheetMaterials.getAvailableRoles(item, material)` | The roles this item can host |
| `CharacterSheetMaterials.getActiveRole(item, material)` | The role in force right now |
| `state.getMaterialRole(itemId)` / `state.setMaterialRole(itemId, role)` | Read / write the override; an unavailable role is rejected |

`getMaterialEffects(...).condensate` carries `{affinity, instability, activeRole, isActive}`.

### Surfaces

The selector appears in the **material picker modal** beneath the applied material, and only
when `getAvailableRoles` returns more than one role. Changing it re-renders the preview so the
affinity visibly wakes or sleeps before the modal is closed.

## Draconic Domain Resonance

> *"An item forged from the remains of a dragon may carry a single resonance drawn from that
> dragon's domain."*

Four materials — **Dragon Bone**, **Dragonhide**, **Dragon Scales** and **Dragon Teeth and
Claws** — carry a `draconicResonanceSlot` effect. The slot is empty by default; the wielder
picks one of **18 resonances**, split into **9 Fear** and **9 Safety** domains.

### Where the choice lives

The chosen resonance is stored as a `{name, source}` reference at
`item.material.resonance` — the same non-destructive pattern as the material itself, the
condensate `role` and the Magic-Capacity `mcAdjust`. Because it hangs off `item.material`,
**swapping the material voids the resonance automatically**; there is no orphan cleanup pass.

### Catalog

Resonances are **shared reference data, not a fifth browsable entity**. They are authored once
in `homebrew/TravelersGuidetoThelemar.json` under a `draconicResonance` array and reach their
two consumers by different routes:

| Consumer | Route | Handle |
|---|---|---|
| Character sheet | Brew merge in `charactersheet.js` | `charSheet.getDraconicResonances()`, `state.getDraconicResonanceCatalog()`, `globalThis.__csResonanceCatalog` |
| `crafting.html` | Lifted into `data/crafting.json` by `extractDraconicResonances` | `globalThis.__craftingDraconicResonances` |

The crafting page **does not** list them; `_RenderItemMaterialImpl` prints the whole 18-row
Fear-then-Safety table inline inside any material that grants a slot. This keeps `crafting.html`
at four list entities (MAT / CRF / RUL / MTL).

> ⚠️ The generated dataset *and* an installed TGTT brew both supply the array, so
> `CraftingPage._addData` has to dedupe **within the incoming batch**, not just against what it
> has already stashed — the two sources are merged before `_addData` ever sees them.

### Entry shape

```jsonc
{
  "name": "Ruinous Release",
  "source": "TGTT",
  "kind": "fear",              // fear | safety
  "domain": "Cataclysm",
  "entries": ["After a critical hit with the item, …"]
}
```

### API

| Method | Returns |
|---|---|
| `CharacterSheetMaterials.resolveResonance(item, allResonances?)` | The resonance entity on an item, or `null`. Falls back to `globalThis.__csResonanceCatalog` |
| `state.getDraconicResonance(itemId)` | The resolved entity, or `null` |
| `state.setDraconicResonance(itemId, ref)` | `true` on success. **Rejects** when the material grants no slot, or when the reference is not in the catalog. Pass a falsy `ref` to clear |
| `state.setDraconicResonanceCatalog(list)` / `getDraconicResonanceCatalog()` | Install / read the catalog |
| `state.getDraconicResonanceEntity(ref)` | Look up one reference |

`getMaterialEffects(...).draconicResonanceSlots` is the slot count (currently always `1`).

### Notes

While the slot is empty the material's note reads *"May carry 1 Draconic Domain Resonance from
its source dragon"*. Once a resonance is chosen, `getMaterialNotes` **replaces** that line with
the resonance itself — labelled `<Domain> — <Name>`, typed `drawback` for Fear and `passive`
for Safety. Clearing the choice restores the slot line.

### Surfaces

A grouped `<select>` (Fear / Safety `<optgroup>`s, plus *None*) appears in the **material picker
modal** whenever the applied material grants a slot, with the active resonance's prose rendered
beneath it. The chosen resonance also shows in the **item-info modal**'s material section.

### Dragon Blood is a separate system

Dragon Blood's **Twelve Uses** are *not* resonances. They were already implemented as variant
spell components in `charactersheet-spells.js` (`_pChooseComponentUses`), backed by the four
`Distilled Dragon's Blood (Wyrmling|Young|Adult|Ancient)` items whose `usesPerCasting` is 1–4.
Do not rebuild them here. (Unrelated: `data/items-variant-components-ar8.json` holds a
*different* Arcadia 8 `Dragon Blood` family keyed on `spellTag: dragonBreathMatch`.)

## The Ioun crystal family

Ioun Crystal is one material with **three mechanically distinct forms** — an intact **Stone**,
a broken **fragment**, and the **Ioun Sand** that webs them together inside a geode. The sheet
already had a full Ioun Stone manager (`charactersheet-ioun.js`: bond, orbit, seat, pry) long
before materials existed, so this phase **extends** it rather than forking it.

Read [`docs/charactersheet/`'s Ioun coverage and the module docstring
first](../../js/charactersheet/charactersheet-ioun.js) — bond is `attuned`, orbit is
`equipped`, and the deliberate action asymmetry (batch *Stow all*, but no *Orbit all*) is a
rules consequence, not an oversight.

### Ioun Sand matrices

> *"An actual Ioun Stone placed in the matrix remains until deliberately removed, and each
> coherent numerical property granted by that stone is doubled … Ioun Sand does not double
> ordinary enchantments, Dragon Blood uses, or the effects of loose Ioun fragments."*

Applying the **Ioun Sand** material to any item turns it into an Ioun host. Detection is keyed
on the material's structured `doubleNumericProperties` effect, **never on its name**, so a
homebrew material declaring the same effect behaves identically.

`getIounHostPolicy()` gained a fifth step, but as an **overlay** rather than a fifth detection
layer — `_applyIounMatrixOverlay()` runs on whatever the four existing layers answered, so a
player who sizes the matrix from the ⚙ editor (`iounSettings`) still gets the doubling. An
undeclared matrix gets **one** seat.

A matrix confers **no bonus of its own** — the doubling *is* its contribution — so the overlay
zeroes `perStone` and empties `grants` unless the item was *already* a declared bonus-granting
host (an Ioun Blade remade in Ioun Sand keeps its `+1`). This is why `_getIounHostPolicyBase`
now reports `isBonusDeclared`: a bare `iounSettings` number sizes a matrix, it does not turn it
into a magic weapon.

### How the doubling is applied

`_recomputeIounMatrixDoubling(hostRow)` **materialises** doubled values onto the *stone* row,
exactly as `_recomputeIounHostBonuses` materialises the per-stone bonus onto the host. The
reason is the same: `bonusWeapon` and friends are read raw across combat, the inventory
aggregator and NPC export, and only some of those call the effective-bonus helper.

Pristine values are captured once in `stone.iounMatrixBaseBonuses`, and every recomputation
reads *from* the capture — so the operation is **idempotent** and never compounds. The capture
also carries a `__hostId` key, so only the host responsible for a stone unwinds it; a stone
moved straight from one matrix to another is re-doubled by the new matrix's own pass and never
double-restored.

It is wired into `setIounStone`, `unsetIounStone` and the `reconcileIounHosts` loop.
`_onItemMaterialChanged` also calls `reconcileIounHosts()`, because applying or removing Ioun
Sand changes both the host policy and the doubling.

**Only the structured numeric props are doubled** — `CharacterSheetState.IOUN_MATRIX_DOUBLED_PROPS`,
13 of them, drawn from `ITEM_SCHEMA_EFFECT_ADAPTERS`. Ranges, areas, healing and durations live
in prose and cannot be doubled by machine; the UI tooltip says so rather than pretending
otherwise. Zero and non-finite values are skipped.

### Fragments

`CharacterSheetState.isIounFragment(item)` is **name-based**, because the book gives a fragment
no separate mechanical marker. It is load-bearing in exactly two places and nowhere else:

1. A matrix does not double a fragment.
2. Ioun Crystal's `freeEffect` Magic Capacity rule belongs to fragments alone.

The second is enforced by `CharacterSheetMaterials._isMcRuleFormApplicable(item, rule)`: a rule
with an `appliesTo` **form** (string or array) matches that word against the item *name*; an
unscoped rule still applies to everything. This is the general mechanism — Ioun Crystal is
simply its only current user.

⚠️ Note that `CharacterSheetState.isIounStone` deliberately does **not** match "Ioun Sand" or
"Ioun Geode". A fragment is only seatable through the UI if its name also contains *Ioun
Stone* (e.g. "Ioun Stone Fragment (Warding)"); the state-level exclusion is correct either
way, including for imported saves.

### Geodes

Reference prose only. The DC 20 Constitution save and `6d12 + 8` radiant damage are authored as
an `entries` line on the **Ioun Crystal** material, so they render on `crafting.html` and in the
item-info modal. Nothing is automated — a geode is scenery, not gear.

### API

| Call | Returns |
|---|---|
| `state.isIounMatrix(itemData)` | whether the item's material grants `doubleNumericProperties` (false when materials are disabled) |
| `CharacterSheetState.isIounFragment(itemData)` | name-based fragment test |
| `state.getIounMatrixStatus(hostItemId)` | `{isMatrix, doubled[], excluded[], props[]}` |
| `CharacterSheetState.IOUN_MATRIX_DOUBLED_PROPS` | the frozen 13-prop list |
| `CharacterSheetMaterials._isMcRuleFormApplicable(item, rule)` | whether a form-scoped MC rule applies |

### Surfaces

| Surface | Where |
|---|---|
| **Matrix** badge + "a set stone's numeric properties are doubled" meta on the host row | `_getHostRowHtml` |
| **Doubled** / **Not doubled** badge on each seated stone | `_getStoneRowHtml` |
| Bonus readout **suppressed** for a matrix that grants nothing | `_getHostRowHtml` (`isShowReadout`) |
| Fragment and geode prose | `entries` on the Ioun Crystal material — item-info modal and `crafting.html` |

## Material degradation

Five materials wear out in play. Each declares a `degradation` block; **no material is
named anywhere in the code**, so a sixth needs only data.

```jsonc
"degradation": {
  "trigger": {"on": "attackRoll", "natural": [1], "alsoOnCriticalHit": false},
  "effect":  {"type": "damageStepDelta", "value": -1},
  "stacking": true,
  "destroys": false,
  "repair":  {"method": "shortRest", "tool": "mason's tools"},
  "note":    "...verbatim rules text..."
}
```

| Material | Trigger | Effect | Repair |
|---|---|---|---|
| Stone and Flint | natural 1 on an attack roll | Damage −1 step, **stacking** | manual |
| Obsidian | natural 1 on an attack roll | Damage −2 steps, **stacking** | Short Rest, appropriate tools |
| Duststone | natural 1 on an attack roll | Damage −1 step, **stacking** | Short Rest, mason's tools |
| Ordinary Glass | natural 1 **or a critical hit** | **destroyed** | — |
| Rimeglass | Fire damage taken | Protection and Critical → 0 | Short Rest, smith's or glassblower's tools |

### `effect.type`

| Type | Meaning |
|---|---|
| `damageStepDelta` | Adds signed steps to the material's own Damage axis |
| `zeroAxes` | Forces the listed axes (`protection`, `critical`) to 0 |
| `destroy` | Sets `isDestroyed`; nothing is projected |

### How it is applied

Degradation is **summed into the material's own axes before projection**, not layered
after it. `applyToItem` adds `degradation.damageStepDelta` to `material.damage` and steps
the die **once** — stepping twice would round differently through the ladder's off-ladder
rungs (`2d4`, `3d6`).

`stacking: false` clamps `applied` to 1 however many events were recorded. The raw
`stacks` count is still kept, so the log stays honest.

### Nothing is auto-applied

Whether a fumble actually chipped the blade — and, for Ordinary Glass, whether that
critical hit landed at all — is a table decision. The `materialDegradation` post-attack
hook only ever **offers**; the player confirms.

The hook is scoped to `ctx.attack.sourceItem.id`, so only the weapon actually swung is
ever a candidate, and it excludes spell attacks. Destroyed items stop being candidates.

### API

| Call | Where | Returns |
|---|---|---|
| `getDegradationSpec(material)` | static | The authored block, or `null` |
| `isDegradationTriggered(material, trigger)` | static | Whether this roll/damage matches |
| `getDegradationStatus(item, material)` | static | `{stacks, applied, isDestroyed, damageStepDelta, zeroedAxes, repair, note}` or `null` |
| `getDegradationSummary(item, material)` | static | `"Damage -2 steps"` / `"Destroyed"` / … |
| `state.getItemDegradation(itemId)` | state | The status, honouring the sub-toggle |
| `state.getDegradationCandidates(trigger, {itemId})` | state | Affected carried items |
| `state.degradeItemMaterial(itemId)` | state | Records one event; returns the new status |
| `state.repairItemMaterial(itemId)` | state | Clears stacks **and** `isDestroyed` |
| `state.getShortRestRepairableItems()` | state | Degraded, `shortRest`-repairable, not destroyed |

### Surfaces

| Surface | Where |
|---|---|
| `⚠ Damage -2 steps` badge on the inventory row (amber; red + struck through when destroyed) | `getDegradationBadgeHtml(itemId)` |
| **Degraded:** line + **Repair** button in the item info modal | `charactersheet-inventory.js` |
| *Material Degrades* / *Material Shatters* confirm after a qualifying attack | `charactersheet-combat.js`, hook `materialDegradation` |
| Short-rest toast offering per-item repairs | `offerShortRestRepairs()`, called from `charactersheet-rest.js` |

`materials_degradation: false` suspends the **effect** but preserves the recorded stacks,
so toggling it back on restores the degraded numbers exactly.

## Object durability & magical interference (reference)

Two `variantrule` entries authored in the brew and allowlisted in
`node/generate-crafting-data/extract-rules.js`, surfaced on `crafting.html` only — the
sheet automates neither:

- **Object Durability** — the 15-row Object AC table, the Tiny→Large fragile/resilient HP
  table, and the damage-type notes.
- **Magical Interference** — the d20-vs-`15 + overage` trigger and the d8 effect table.

⚠️ The interference table now exists **twice**: as `CharacterSheetMaterials.MAGICAL_INTERFERENCE_TABLE`
(which the sheet actually rolls on) and as the reader-facing brew rule. A test in
`test/jest/CraftingItemMaterials.test.js` pins the two together so they cannot drift.

## Magic Capacity

Magic Capacity (MC) is how many magical effects a material can hold before it starts to
misbehave. It is the one axis that is a *budget* rather than a modifier.

### Counting effects

`CharacterSheetMaterials.countMagicalEffects(item, {material, manualAdjust})` returns
`{total, breakdown}`. It counts, from the item:

| Counted | Notes |
|---|---|
| Applied upgrades | One per upgrade |
| Set gemstones | One per gem |
| Attached spells | One per **distinct** spell, across every usage category |
| Resistances / immunities / condition immunities | One per entry |
| Ability score grants (`ability`) | One per ability |
| Speed modifications (`modifySpeed`) | One |
| A curse | One |
| Sentience | One |

**Bonus families collapse.** `bonusWeapon`, `bonusWeaponAttack` and `bonusWeaponDamage` on
one item are a single `+N` enchantment, not three, and are counted once.

**`attachedSpells` is read in every shape it ships in.** It is a flat
`["fireball|phb"]` array only about a fifth of the time; far more often it is keyed by
usage — `will` / `other` / `ritual` hold arrays directly, while `daily` / `charges` /
`limited` / `rest` nest one level further under a use count (`{"1e": [...]}`). The sheet
emits that dict itself when a custom item is built with spells, and copies it verbatim
from the catalog onto matched inventory items. `_flattenAttachedSpells` therefore
collects **only strings that live inside an array**, which covers every shape in one rule
and drops non-spell siblings such as `ability: "int"` for free. Names are stripped of
`|source` and `#level` suffixes and deduped, so a spell offered both at-will and daily
counts once.

**Counting reads the raw item, not the projection.** A material's own intrinsic properties
are what the item *is*, not enchantments placed into it — Darkmetal's shield `+1 AC` must
not consume a slot of Darkmetal's own capacity.

**A bad item costs a badge, not the page.** The tally reads a dozen loosely-typed fields
straight from the catalog, homebrew and hand-built custom items, and it is reached from
three places — the picker preview, `_renderItemRow`, and `notifyOverloadedItemsOnRest` — two
of which would take down a whole render or the rest flow if it threw. `state.getMagicCapacityStatus`
is the single choke point all three funnel through, so it catches, logs, and returns `null`;
every caller already treats `null` as "no capacity to show", so an unfamiliar shape
degrades to a missing badge instead of a broken inventory tab. Render paths are deliberately
left unguarded — one catch at the boundary between the tolerant read layer and the pure
calculator is enough, and scattering more would only hide bugs.

### Status

`getMagicCapacityStatus(item, material, {manualAdjust})` returns
`{count, capacity, over, dc, isOverloaded, isUnlimited, isSuppressing, breakdown, notes}`,
or `null` when the material has no MC (`"na"`). Two special capacities exist:

| Capacity | Meaning |
|---|---|
| `"infinity"` | `isUnlimited` — Jadoo, never overloaded |
| `"-infinity"` | `isSuppressing` — Lead, actively suppresses magic |

### Interference

> Roll a d20. If the result is **lower than** `15 + effects above capacity`, roll on the
> Magical Interference table.

So `passed = d20 >= dc`, `dc = 15 + over`. Failure rolls a d8 on the verbatim eight-entry
interference table. `rollMagicalInterference(dc, rollFn)` accepts an injectable roller for
tests.

Passive effects are re-checked **after each short or long rest** while the item remains
overloaded. `notifyOverloadedItemsOnRest(restKind)` raises a warning toast listing every
overloaded item with a per-item Roll button that reports its result inline.

### Per-material MC rules

Five materials carry `magicCapacityRules`. Only two change arithmetic:

| Rule | Material | Automated? |
|---|---|---|
| `freeEffect` | Ioun Crystal, Rose Gold | **yes** — the first effect of the named `theme` is deducted after the breakdown is built, so the tally still shows the true count |
| `dcRiseThreshold` | Steeline | **yes** — the DC rises by 1 only per *N* effects over capacity |
| `opposedStatesCountAsOne` | Electrum | advisory |
| `makerForeknowledge` | Deep Crystal | advisory |

The last two are advisory because the sheet cannot know whether two effects are "opposed
states", and foreknowledge is *information*, not a modifier. The **manual ±1 adjustment** in
the Magic Capacity modal is the deliberate escape hatch for both. It persists as
`item.material.mcAdjust` — on the *material reference*, so swapping the material correctly
voids the judgement call.

Authored rule prose wins over generated text; the sheet appends what it actually did
("Already applied to the DC.", "Already deducted from the count.", "Use the manual
adjustment below to apply this.").

### Surfaces

| Surface | Where |
|---|---|
| `✦ n/MC` badge on inventory rows, colour-coded ok / over / suppress | `charactersheet-inventory.js` |
| **Magic Capacity** button in the item action row | `charactersheet-inventory.js` |
| **Magic Capacity** line in the item info modal | `_renderItemMaterialDetails` |
| Magic Capacity block in the material picker preview | `showMaterialPickerModal` — the crafter's pre-commit decision point, and Deep Crystal's `makerForeknowledge` surface |
| **Magic Capacity modal** — breakdown, ±1 adjustment, rules notes, Roll Interference | `showMagicCapacityModal(itemId)` |
| Post-rest overload toast | `notifyOverloadedItemsOnRest(restKind)` |

## The damage die ladder

Materials step the damage die along an **11-step ladder**, wider than the upgrade system's:

```
1d4 → 1d6 → 1d8 → 1d10 → 1d12 → 2d6 → 2d8 → 2d10 → 2d12 → 3d8 → 3d10
```

`CharacterSheetMaterials.stepDamageDie(die, steps)` supports **negative** steps (Gold −1,
Heart Stone −2) and clamps at both ends. Off-ladder equivalents (`2d4`, `3d4`, `3d6`) are
normalised onto the ladder.

`CharacterSheetUpgrades.increaseDamageDie` is deliberately **left unchanged** (it caps at
`1d12`) so the `Superior` upgrade behaves exactly as before.

## Derived numbers

| Quantity | Rule |
|---|---|
| **Weight** | `baseWeight × (density / baseline)`. Baselines: **metal 7.87** (iron), **wood 0.14**. An explicit `weightMultiplier` overrides the derivation. `density: null` ⇒ no change. |
| **Value** | `baseValue + (effectiveWeight × price.gp × 100)` — item `value` is **copper**, prices are **gp**. Only recomputed when `price.unit === "lb"`. |
| **Protection** | Sets base armour AC **literally**, before the Dex modifier and any shield. |
| **Critical** | Lowers the threshold by N, clamped so it can neither produce an impossible crit nor remove the natural-20 auto-hit. |
| **Penetration** | A single number surfaced on the attack row; see below. |

Non-pound trade units (`vial`, `sqYard`, `sqFoot`, `tooth`, `scale`, `heart`, `stone`,
`matrix`, `none`) and `isPriceless` materials get **no automatic value recomputation** —
the price is shown as reference only.

## Where it plugs into the sheet

| Concern | Hook |
|---|---|
| Flattened item reads | `getItems()` → `projectItemMaterial()` |
| Unprojected reads | `getItemRaw(id)` |
| Set / clear | `setItemMaterial(id, material)` / `clearItemMaterial(id)` |
| Catalog injection | `setItemMaterialCatalog(materials)` (called from the loader) |
| Recalc fan-out | `_onItemMaterialChanged()` → `_refreshEquippedAcSlots()` + `_recalculateMaterialModifiers()` + `_recalculateEquipmentModifiers()` |
| Conditional effects | `namedModifiers` with `sourceType: "itemMaterial"` |

### The AC-snapshot trap

`_data.ac.armor` / `_data.ac.shield` are stamped **once, at `equip()` time**. Changing an
equipped item's material would otherwise leave the character wearing the pre-change
armour. `_refreshEquippedAcSlots()` re-stamps both slots from the currently-equipped items
on every material change. Any future feature that mutates an equipped item's derived stats
must do the same.

## User-facing surfaces

| Surface | Where |
|---|---|
| Material badge on inventory rows (`⚙ Darkmetal`) | `charactersheet-inventory.js` |
| Material row + config button in the item info modal | `charactersheet-inventory.js` |
| **Material picker modal** — filterable, grouped, click-to-expand inline diff | `CharacterSheetMaterials.showMaterialPickerModal(itemId)` |
| **Material** dropdown in Create / Modify Custom Item | `charactersheet-inventory.js` |
| **Material** dropdown in the Craft workbench commit dialog | `charactersheet-crafting.js` |
| `Pen N` on attack rows + post-attack **Penetrating Blow** prompt | `charactersheet-combat.js` |

The picker only offers **eligible** materials — `isEligible(item, material)` filters on
`appliesTo` against the item's kind, so a weapon sees 65 of the 72 and armour sees a
different set.

### Picker interaction model

Sixty-five options is a list, not a menu, so the picker is built around **finding** rather
than browsing:

- A **filter box** takes focus on open and matches name, category, one-line summary **and**
  the material's note text — so typing `silver` finds Silver *and* Mercurial Steel, whose
  silvered-damage note never mentions it in the title. The live count (`Filter 65
  materials…` → `4 of 65`) is announced via `role="status"`.
- Each material is a **native `<button>` disclosure row**. Clicking, or pressing Enter or
  Space, expands the before-after diff **inline underneath that row** — mouse, keyboard and
  touch all drive the same single interaction. There is deliberately **no hover preview**:
  it would thrash layout and could never work on a phone.
- **Apply lives only inside the expanded row**, so exactly one primary button is ever on
  screen. Selecting is a separate act from committing.
- Materials are grouped by category in `<details>` sections. **One group is always open** —
  the applied material's group when there is one, otherwise the first — because landing on
  eight collapsed headers gives the player nothing to react to.
- Filtering flattens the groups; the open selection survives being filtered out, so clearing
  the filter restores it.
- `@media (pointer: coarse)` raises rows and the Apply button to a 44 px minimum.

### Summaries are item-aware

`getSummary(material, item)` gates each axis by the **same rules `applyToItem` uses**, so
the one-line summary only ever promises what the projection will actually deliver:

| Axis | Shown when |
|---|---|
| `Dmg`, `Crit`, `Pen` | the item is a weapon |
| `AC` | the item is armour |
| `MC` | always |

Omitting `item` lists every axis — correct for a context-free chip, wrong for a picker row.
Without this a longsword advertised `Mithril — AC 18`, describing a suit of armour the
player was not looking at. `applyToItem` is gated to match: it no longer writes a
`critThreshold` onto armour, where nothing rolls against it.

### Inventory-row badges have accessible names

The three chips on an inventory row each carried their whole meaning in `title=`, which
reaches a mouse and nothing else. They now pair a visible glyph with an accessible name:

| Badge | Element | Accessible name |
|---|---|---|
| `⚙ Darkmetal` | `<span>` | `Material: Darkmetal. Dmg +1 · Pen 2 · MC 2` — via `getMaterialBadgeAriaLabel(material, item)`, so it respects the same item-aware axis gating |
| `✦ 5/3` | **`<button>`** | `Magic Capacity 5 of 3, overloaded by 2. Interference DC 17. Open details to roll.` — via `getMagicCapacityAriaLabel(material, status)` |
| `⚠ Damage −1 step` | `<span>` | `Damaged: Damage −1 step — Its striking edge chips. Repaired manually.` |

Three rules hold across all of them:

- **The glyph is `aria-hidden`.** `⚙`, `✦` and `⚠` are announced as "gear", "black
  four-pointed star" and "warning sign", which is noise in front of the real content.
- **The ratio is spelled out.** `4/6` becomes "4 of 6"; a slash is read literally by some
  screen readers and skipped by others.
- **The accessible name names the outcome, not the input device.** The tooltip still says
  "Click for details" because only a mouse ever sees it; the accessible name says "Open
  details", because a keyboard and a switch read it too.

The capacity chip is a real `<button>` rather than a click-handled `<span>`, so it is
tab-reachable, activates on Enter and Space, and shows the standard focus ring. Under
`pointer: coarse` all three chips reach a 44 px minimum — the two inert ones grow with the
button so the row keeps one baseline.

### Risk is stated before the choice, and reversible after it

Exactly one material in the catalog destroys the item outright — **Ordinary Glass**, which
shatters on a natural 1 or after it scores a critical hit. Four more degrade without
destroying (Stone and Flint, Obsidian, Rimeglass, Duststone). Before this, all six looked
exactly like Steel at the moment of choosing.

`CharacterSheetMaterials.getRiskFlag(material)` derives a two-tier flag **entirely from the
authored `degradation` block** — never from a material's name, so a sixth degrading material
needs no code change:

| Tier | Condition | Reads |
|---|---|---|
| `destroys` | `degradation.destroys === true` | `⚠ Can be destroyed` |
| `degrades` | any other `degradation` block | `⚠ Degrades in use` |

The flag appears twice: as a chip in the picker row, so it is visible while scanning, and as
the **first** element of the expanded detail panel — ahead of the damage and capacity numbers
that made the material tempting.

Applying still commits instantly. A confirm dialog is the wrong trade here: it would tax all
65 eligible choices to protect against a mistake in one of them, and it demands an answer
*before* the player can see whether they were right. Instead every apply and every clear
raises an undo toast:

- `_offerMaterialUndo(itemId, prior, label)` captures the raw material reference **before**
  the mutation. `prior` may be `null`, and reverting then restores the *absence* of a
  material as faithfully as a previous one — which is the common case, since most applies
  land on a bare item.
- The host toast dismisses itself on any click inside it, so the Revert button cannot swap
  itself into a "Reverted" state. A short success toast acknowledges the revert instead;
  without it the revert lands silently.

### Status colours read through an ink-on-tint token

Every material status — capacity overload, worn, destroyed, both risk tiers — is semantic ink
on a 12–14% tint of its own hue. That construction fails quietly: move `--cs-danger` for a
fill somewhere else on the sheet and the chip's text and background move *together*, so the
pair keeps looking deliberate while dropping under AA.

The chips therefore read `var(--cs-danger-text, var(--cs-danger, …))` and tint with
`color-mix()` off the **same** token, so the two can never drift apart. `--cs-*-text` is
defined per theme in `css/charactersheet-modern.css` — one shade darker than the fill hue in
day, one shade lighter in night. Night's values were missing until now, which is precisely
why the night chips failed.

`CharacterSheetMaterialsContrast.test.js` resolves the real token values out of the real
stylesheet and asserts AA for every state pair against both `--cs-bg-surface` and
`--cs-bg-elevated` (the modal — the harder surface, and where the whole picker lives).

### Penetration is not auto-resolved

The sheet tracks **no target AC**. Penetration therefore shows as `Pen N` on the attack row,
and after a roll the sheet offers a *Penetrating Blow* button that asks for the miss margin
and reports whether the reduced AC would have been beaten. Fully automatic resolution
would require a target-AC field and is out of scope.

## Settings

All of it is gated. Defaults are `true`, migrated in for existing characters by
`_migrateMaterialSettingsDefaults()`.

| Key | Controls |
|---|---|
| `enableMaterials` | The whole system. `false` ⇒ `projectItemMaterial` returns the item untouched. |
| `materials_weightFromDensity` | Density-derived weight |
| `materials_recomputeValue` | Price-per-pound value recomputation |
| `materials_magicCapacity` | Magic Capacity badge, modal and post-rest interference re-check |
| `materials_penetration` | `Pen N` and the Penetrating Blow prompt |
| `materials_degradation` | Degradation detection, projection, badges and repairs |

The crafting page is **unconditional** — it is a reference, not a rules engine.

## Testing

```
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetMaterials --no-coverage --forceExit
```

`test/jest/charactersheet/CharacterSheetMaterials.test.js` — 164 tests over a hand-built
material fixture: die ladder (including negative steps, clamping and off-ladder
normalisation), tri-state axes, eligibility, weapon/armour/shield projection, weight and
value, effect resolution, state integration, the preview rows, item-aware summaries, effect counting, Magic
Capacity status (including `∞` / `−∞` / `na` and `dcRiseThreshold`), interference rolls,
`mcAdjust` persistence, note override / qualifier handling, condensate role gating, and
draconic resonance selection / validation / note replacement / save round-trip, and the
Ioun Sand matrix (effect-keyed detection, seat sizing without an invented bonus, doubling,
restoration, idempotence, fragment exclusion, matrix-to-matrix moves, and the form-scoped MC
rule), degradation (trigger matching, stacking vs non-stacking, axis zeroing, destruction,
candidate scoping, short-rest repair listing, the sub-toggle and the save round-trip), and
the two-tier risk flag (data-derived, absent for the other 67 materials), material undo
(restoring a previous material, restoring the absence of one, and the acknowledgement toast),
and the `attachedSpells` shape matrix (every usage key, combined keys, the non-spell `ability`
sibling, suffix stripping, cross-category dedupe, plus the state guard degrading to `null`
instead of throwing).

`test/jest/CraftingItemMaterials.test.js` additionally pins the two Thelemar reference rules,
including the drift guard between the brew's Magical Interference table and the JS constant.

## Phasing

| Phase | Status | Contents |
|---|---|---|
| **P1 — Core** | **done** | 72 entities, loader + settings, die ladder, projection, weight/value/penetration, all three UI entry points, the `MTL` crafting-page entity, tests, docs |
| **P2 — Magic Capacity** | **done** | Effect counter, `n/MC` badge, `∞`/`−∞`, DC 15 + overage roll, d8 interference table, per-material MC exceptions, manual ±1 adjustment, post-rest re-check |
| **P3 — Draconic / Blood / Ioun** | **done** | ✅ 18 condensates (role-gated) · ✅ 18 Draconic Domain Resonances · ✅ Dragon Blood's twelve uses (pre-existing, in `charactersheet-spells.js`) · ✅ Ioun Sand matrices, fragments and geode prose |
| **P4 — Durability & Degradation** | **done** | ✅ Object Durability + Magical Interference reference tables on the crafting page · ✅ degradation auto-detect on nat-1 / crit / fire, stacks, shatter, manual + short-rest repair |

## Known limitations

- **Same-named items stack.** `addItem()` merges items with the same name into one stack, so
  a material (and its `mcAdjust`) applies to the whole stack. Give two otherwise-identical
  items distinct names if they need different materials.
- **`opposedStatesCountAsOne` and `makerForeknowledge` are advisory** — the sheet surfaces the
  rule text and offers the manual ±1 adjustment, but cannot decide for you.
- **An Ioun Sand matrix doubles only the 13 structured numeric props.** Ranges, areas,
  healing and durations stated in prose are the DM's call, as the rules themselves say.
- **Fragment detection is name-based.** A fragment named without the word "fragment" is
  treated as an intact stone.
- **Degradation is offered, never applied.** The sheet cannot know whether an attack hit,
  so Ordinary Glass's crit trigger and every fumble trigger are confirm prompts.
- **A destroyed item is not removed from the inventory** — it is flagged, struck through and
  excluded from further triggers, but deleting it stays the player's call.
- **`Varies` density** ⇒ no weight derivation, by design.
- The Foundry VTT export in `charactersheet-export.js` is lossy and does not carry
  `material`; the native sheet JSON round-trips it correctly.
