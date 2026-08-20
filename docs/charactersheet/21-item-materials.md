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

Effects are **declared as data**, never hardcoded per material name.

Every type is registered in `CharacterSheetMaterials.EFFECT_HANDLING`, which names the single
place that consumes it. That registry is the contract between authoring and consumption, and it
exists because the alternative failed: for a long stretch a new effect type could be authored,
pass the normaliser, render a tidy sentence in the item modal, and change no number in the
sheet — silently, forever. Thirty-four of the 72 materials were in that state. Nothing
distinguished "deliberately narrative" from "someone forgot to wire it up".

`CharacterSheetMaterialEffectHandling.test.js` walks all 72 materials and fails on any type that
is unregistered, so that failure mode is now a red build rather than a disappointed player.

The five consumers:

| Consumer | Meaning |
|---|---|
| `projection` | Changes the item itself, via `applyToItem`. The projected item carries the new number. |
| `modifier` | Becomes a named modifier on the character through `_recalculateMaterialModifiers`. |
| `roll` | Read at roll time by `charactersheet-combat.js` — a rider, a crit change, an advantage. |
| `power` | Surfaces in the Actions hub through `getItemPowers()`. |
| `reference` | **Deliberately** not automated. Surfaced as prose because resolving it is a table decision. |

`reference` is a claim that has to be earned. It means someone decided the rule is a DM call,
not that nobody got to it. Only seven types hold it, and the guard test caps that number — pushing
past the cap fails CI and forces the question to be argued rather than assumed.

#### `projection`  (15)

| Effect type | What actually happens |
|---|---|
| `bonusAc` | Folded into the item's AC bonus. |
| `bonusWeaponAttack` | Folded into the weapon's attack bonus. |
| `bonusWeaponDamage` | Folded into the weapon's damage bonus. |
| `addProperty` | Adds weapon properties. |
| `removeProperty` | Removes weapon properties. |
| `propertyLadder` | Steps a property up its ladder. |
| `armorForceHeavy` | Forces the armour to Heavy. |
| `armorStealthDisadvantage` | Imposes Stealth disadvantage. |
| `armorNoStealthDisadvantage` | Removes Stealth disadvantage. |
| `armorNoStrengthRequirement` | Drops the Strength requirement. |
| `armorStrengthRequirementDelta` | Adjusts the Strength requirement. |
| `armorDexCapDelta` | Adjusts the Dex cap. |
| `rangeMultiplier` | Multiplies weapon range. |
| `thrownRangeDelta` | Adjusts thrown range. |
| `penetrationIgnoresMagicalAc` | Penetration applies against magical AC. |

#### `modifier`  (10)

| Effect type | What actually happens |
|---|---|
| `bonusInitiative` | getInitiativeBonuses() → getInitiative(). |
| `speedDelta` | getMaterialSpeedBonus() → getSpeed()/getSpeedByType(). |
| `saveAdvantage` | Conditional named modifier on saves. |
| `checkAdvantage` | Conditional named modifier on checks. |
| `damageReduction` | Named modifier of type damageReduction. |
| `resistance` | Added to derived resistances. |
| `immunity` | Added to derived immunities. |
| `perceptionPenaltyToNotice` | Conditional Stealth modifier: a penalty to an observer's check equals a bonus to the wearer's contested roll. |
| `spellcastingFocus` | Makes the item eligible as a spellcasting focus. |
| `draconicResonanceSlot` | Grants draconic resonance slots. |

#### `roll`  (5)

| Effect type | What actually happens |
|---|---|
| `countsAsMagical` | Weapon tag; overcomes non-magical resistance. |
| `countsAsSilvered` | Weapon tag; overcomes silver-vulnerable resistance. |
| `overrideDamageType` | Offered as a damage-type choice at roll time. |
| `bonusCritDamage` | Extra dice on a critical hit. |
| `extraDamageDiceVsType` | Extra dice against a creature type. |

#### `power`  (3)

| Effect type | What actually happens |
|---|---|
| `grantsAction` | Becomes an item power in the Actions hub; activatable when the author declared an `actionType`, reference-only otherwise. A `requiresProperty` gate removes it entirely. |
| `condensateAffinity` | Becomes an item power; reference-only when it is a table call. |
| `condensateInstability` | Offered on its trigger, never auto-applied. |

#### `reference`  (5)

| Effect type | What actually happens |
|---|---|
| `doubleNumericProperties` | Ioun Sand doubles properties granted by an intact Ioun Stone SET IN THE MATRIX — explicitly not ordinary enchantments or loose fragments. The sheet models Ioun Stones as their own subsystem, not as material sockets, so which numbers qualify is a table call. |
| `noRangedDisadvantageInMelee` | The sheet has no positional model, so it never imposes the disadvantage this would suppress. |
| `indestructible` | Whether an effect could damage the item is a DM call. |
| `armorWearableUnderClothing` | Concealment is a fiction/social question, not a stat. |
| `note` | Free prose the author attached to the material. |

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

### A note that names its own cost is data, not decoration

`grantsAction` decides activatable-vs-reference-only from the authored `actionType`, and only
from it (see `EFFECT_HANDLING`). That rule is right, and the code has always followed it — but
it can only read what the entry declares. Yellowwood's Flurry declared nothing while its own
note said *"you can use a bonus action to attack again"*, so the sheet correctly applied the
rule to an entry that contradicted itself, and the power sat unusable behind an accurate
"Rules reference only" label.

No code-side guard can catch that, because nothing about the code is wrong. So the check lives
on the data: `CharacterSheetMaterialGrantedActions.test.js` walks every `grantsAction` in the
brew and fails any whose note names an action economy without declaring a matching
`actionType`.

The implication runs one way only. Every power authored with an `action` or `reaction` cost
describes only its **trigger** ("When an attack hits you…"), never the cost — their economy
exists solely as structured data, and requiring the prose to repeat it would be wrong. The
suite therefore pins *which* economies currently appear in prose (`bonus`, once) rather than
demanding that all of them do, so the asymmetry stays a recorded fact instead of an
unexamined one.

### Degradation and instability

Some materials break, and some bite back. The two are deliberate siblings — **identical trigger
vocabulary, matched by the same function** (`_matchesTrigger`) so they can never drift about what
a natural 1 is. They differ in who gets hurt:

| Block | Who it hurts | Materials |
|---|---|---|
| `degradation` | The **item** | Duststone, Obsidian, Ordinary Glass, Rimeglass, Stone and Flint |
| `instability` | The **carrier** | Vitriol Crystal, Stormprism, Magmaheart, Skyshard |

Both are **offered, never applied**. Whether a fumble actually chipped the blade is a table
decision, so the sheet asks and the player confirms.

#### Triggers

```jsonc
{"on": "attackRoll", "natural": [1], "alsoOnCriticalHit": true}
{"on": "damageTaken", "damageType": "fire"}   // omit damageType to match any
```

An `attackRoll` trigger is scoped to the weapon actually swung. A `damageTaken` trigger sweeps
**everything carried**, because Magmaheart contracts wherever you are keeping it.

#### Instability effects

```jsonc
{"type": "selfDamage", "damage": "1d4", "damageType": "acid"}
{"type": "save", "ability": "str", "dc": 13, "onFail": "pushed 10 feet"}
```

Self-damage routes through `takeDamage`, so the carrier's own resistances apply — being
fire-immune should protect you from your own scabbard too.

> **The `damageTaken` trap.** `isDegradationTriggered` matched this trigger from the day it was
> written, but `getDegradationCandidates` had exactly one caller, and that caller only ever passed
> `attackRoll`. Rimeglass's authored fire degradation was therefore unreachable — matched by the
> vocabulary, fired by nothing. It is now offered from the sheet's Damage flow.
>
> A related consequence: that flow only asked "what damage type?" when the character had a
> resistance, immunity or vulnerability, so a character with no defenses could never provoke a
> material reaction at all. It now also asks when a carried material cares, via
> `getMaterialReactiveDamageTypes()`.

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

### Instability API

The carrier-facing sibling. Same trigger shapes, same offer-never-apply doctrine, same
`materials_degradation` sub-toggle — a table that turned one off did not ask for the other.

| Call | Where | Returns |
|---|---|---|
| `getInstabilitySpec(material)` | static | The authored block, or `null` |
| `isInstabilityTriggered(material, trigger)` | static | Whether this roll/damage matches |
| `getReactiveDamageTypes(material)` | static | Damage types this material reacts to, from **both** blocks |
| `state.getInstabilityCandidates(trigger, {itemId})` | state | `[{id, name, material, spec}]` |
| `state.getMaterialReactiveDamageTypes()` | state | Union across everything carried |
| `combat.pResolveMaterialInstability(candidates)` | combat | Offers, then applies each |

`pResolveMaterialInstability` is public because the trigger is not always an attack — the
Damage flow calls it too, so a Magmaheart chill and a Vitriol fumble read alike.

### Surfaces

| Surface | Where |
|---|---|
| `⚠ Damage -2 steps` badge on the inventory row (amber; red + struck through when destroyed) | `getDegradationBadgeHtml(itemId)` |
| **Degraded:** line + **Repair** button in the item info modal | `charactersheet-inventory.js` |
| *Material Degrades* / *Material Shatters* confirm after a qualifying attack | `charactersheet-combat.js`, hook `materialDegradation` |
| *Material Instability* confirm after a qualifying attack | `charactersheet-combat.js`, hook `materialInstability` |
| Both reactions offered after taking typed damage | `charactersheet.js`, `_pOfferMaterialDamageReactions()` |
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

`CharacterSheetMaterials.countMagicalEffects(item, {material, manualAdjust, isUpgradeMagical})`
returns `{total, breakdown}`. It counts, from the item:

| Counted | Notes |
|---|---|
| **Magical** applied upgrades | One per upgrade — **only** those authored `isMagical` |
| Set gemstones | One per gem |
| Attached spells | One per **distinct** spell, across every usage category |
| Resistances / immunities / condition immunities | One per entry |
| Ability score grants (`ability`) | One per ability |
| Speed modifications (`modifySpeed`) | One |
| A curse | One |
| Sentience | One |

**Most upgrades are not magical, and must not fill a magic budget.** Balanced, Brutal,
Sharpened, Silvered, Masterwork and the armour proofings are plain smithing; counting them
here meant a well-made sword was "full" before a single enchantment touched it.

Magicality is **authored data** — an `isMagical: true` on the upgrade entity — never inferred
from effect shape and never read off a hardcoded name table. Effect shape cannot tell the two
apart: *Balanced* grants +1 to attack and is mundane craftsmanship, while *Enchanted* grants
+1 to spell attacks and is not. A name table would silently miss every homebrew upgrade.

What is flagged today:

| Source | Flagged | Rationale |
|---|---|---|
| `data/itemupgrades.json` | **Enchanted**, **Magical**, **Arcane** | The only three of thirty that invoke magic — spellcasting-focus bonuses, and counting as magical for resistance |
| `homebrew/TravelersGuidetoThelemar.json` | all 39 `GS:*` gemstone powers | They carry `rarity` and `craftingDC`: magic items by construction |
| `homebrew/TravelersGuidetoThelemar.json` | **Blessed**, **Mirrored**, **Specifically Tempered**, **Copper Plated** | The four `AU` tags that grant damage resistance. No mundane crafting in 5e grants resistance — that is the province of magic, or of a *material*, which is a separate axis |

Absence of the field means mundane; the flag is never written `false` in data. Note that
*Gem Socket* is **not** magical — the socket is a fitting, and the gem set into it is counted
separately.

**Legacy saves resolve against the catalog.** `applyItemUpgrade` snapshots `isMagical`
alongside the name, so the hot path never needs a lookup. Snapshots written before the field
existed carry nothing, so `getMagicCapacityStatus` passes
`CharacterSheetUpgrades.isUpgradeMagical` as a resolver, which reads the snapshot's own flag
first and falls back to `itembuilder-upgrade-rules.isUpgradeMagical`. An upgrade that resolves
to nothing counts as **non**-magical: a lookup miss must never manufacture an overload the
player did not earn.

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

### The two ladders diverge at 1d12, and materials made that reachable

The upgrade ladder is `[4, 6, 8, 10, 12]` with a `Math.min` clamp. It agrees with the material
ladder on every die a base weapon actually has, and disagrees at exactly one point: from `1d12`
a material steps to `2d6`, while an upgrade stays at `1d12`.

That matters now because **materials can reach `1d12` from a common weapon** — `Darkeline` and
`Paradox Metal` are `+2`, so any d8 weapon lands there. The consequence is that a `Superior`
upgrade on such a weapon costs resources, still prints *"Damage die +1 step"*, and changes
nothing. It predates materials (a `Superior` greataxe was always inert) but materials turn a
corner case into a common one.

This is **not** treated as a bug to fix in passing, because unifying the ladders is a rules
decision with three dependents that must move together: the cap is pinned by
`CharacterSheetUpgrades.test.js`, the NPC exporter relies on `increaseDamageDie` returning the
die term *alone* (it pre-extracts flat modifiers because of it, so `2d6+15` → `2d8`), and the
two ladders come from different books. The divergence is instead **pinned as declared
behaviour** in `CharacterSheetMaterialAccessorGaps.test.js`, so that whoever changes it is shown
everything it touches.

### Material steps and upgrade steps travel in separate channels

A weapon can be stepped by both a material and an upgrade, and each must land exactly once. They
stay separate structurally rather than by arithmetic care:

| Source | Where the step lives | Read by |
|---|---|---|
| Material | baked into the projected `dmg1` by `applyToItem` | anything reading `getItems()` |
| Upgrade | published as `getEffectiveItemBonuses().damageDieIncrease` | consumers that step the projected die |

`damageDieIncrease` starts at `0` and accumulates **only** from `getUpgradeEffects`, so it is
always `0` for a material-only weapon. The separation is reinforced by the fact that
`getEffectiveItemBonuses` receives the **raw** inventory entry, which carries no resolved
material entity at all — the accessor structurally *cannot* see a material's `damage` axis.

So a consumer that reads the projected die **and** adds `damageDieIncrease` counts each source
once, and this is why no double-application occurs. Note the reason carefully: it is **not**
that materials avoid stepping dice. Thirteen of them do. Any guard written on the premise that
none exist is vacuous and will never fire.

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
| **NPC export** — attack-line qualifiers, `Armor Traits`, `Resilience` folding, and baked companion items | `charactersheet-npc-exporter.js` (see [18-npc-export.md](./18-npc-export.md#v22--a-material-is-part-of-the-weapon-so-it-belongs-on-the-attack)) |

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

### The breakdown speaks in game terms, not property names

The Magic Capacity breakdown is shown to a player deciding what to strip off an overloaded
item, and it was the one place 5etools' internal property names reached the screen —
`bonusWeapon, bonusWeaponAttack` is not an answer to *what is filling my sword up*. Three
maps on `CharacterSheetMaterials` translate them: `_BONUS_KEY_LABELS`, `_ABILITY_KEY_LABELS`
and `_SPEED_KEY_LABELS`, applied through `_labelKeys`.

An **unmapped** key falls through verbatim rather than being dropped. A leaked key is a bug
worth seeing, and hiding it would make the detail line unreconcilable with the count printed
beside it.

### A dormant affinity says whether it is reachable

A condensate's affinity applies only in the role it is authored for. Two situations look
identical in the data and are completely different to a player:

- **Reachable** — the item kind *can* host that role, so the affinity is one role switch
  away. → *"…switch its role to claim it."*
- **Unreachable** — the item kind has no such slot at all. A rootstone sword is authored for
  a protective layer a weapon does not have. → *"Never applies on a weapon: it is written for
  the item's protective layer, which a weapon cannot have."*

The old copy said "Applies only while this material is the item's protective layer" in both
cases, which reads as a condition the player could go and satisfy. On a weapon they cannot.
The label reflects it too: `(dormant)` versus `(not available)`.

### The picker ranks, and explains its own vocabulary

Filtering answers *"where is mithril?"*. It does not answer *"which of these twelve metals is
best for my sword?"* — for that the list has to rank.

`getSortMetrics(item, material)` returns the five comparable numbers **projected onto this
specific item**, and `getSortOptions(item)` returns the axes worth offering for it. Three
rules keep the ranking honest:

- **Options are item-aware.** A longsword gets Damage but not Armor Class; offering AC there
  would produce sixty-five identical rows and teach the player the control is broken.
- **Unrankable materials sink, they do not lie.** A material priced *per scale*, or priceless,
  cannot reprice the item — `applyToItem` correctly leaves the base value in place. Ranking on
  that number would file every priceless material under "cheapest". `getSortMetrics` therefore
  reports `null` for an axis the material cannot move, and `null` sorts to the bottom. Same for
  weight when a material carries no density.
- **`∞` outranks every finite capacity; `−∞` sits below every one** — exactly how a player ranks
  an unlimited material against a suppressing one.

Sorting and grouping answer different questions and fight each other, so an explicit sort
**flattens** the list the way a filter does: a "best damage" ranking split across eight
collapsed category headers ranks nothing.

Alongside it, a collapsed `<details>` at the foot of the picker defines `MC`, `MC ∞`, `MC −∞`,
`✦`, `Pen`, `Crit` and the condensate roles. The vocabulary is invented by this feature and
explained nowhere else outside a 678-line rules document; the legend is a reference for the
first few visits rather than a permanent tax on list space.

### An empty list says which kind of empty it is

"No material fits this item" and "the catalog never arrived" look identical from inside the
modal, and blaming the item for a data-loading failure sends the player off to re-read the
rules for an answer that is not there. The picker branches on `getMaterials().length` and names
the homebrew when the catalog itself is missing.

The **upgrade** picker now follows the same rule with three branches: nothing eligible for this
item kind, nothing eligible at this tier, and everything this item can take already applied.

### The inventory row derives; it does not remember

`item.damage` is a display string written once, when the item is added, and never touched again.
A material's die step and an upgrade's bonuses all land afterwards, so for the entire life of a
modified weapon the inventory row showed a number the combat tab disagreed with — the same
weapon reading `1d8` in one tab and `1d10+3` in another.

The row now calls **`state.getEffectiveWeaponDamage(itemId)`**, which reads the *projected* item
(so a material's die step is already in `dmg1`) and folds in `getEffectiveItemBonuses` (so an
upgrade's `damageDieIncrease`, flat `bonusWeaponDamage` and attack bonus land too). It returns
`null` rather than a fallback when there are no damage dice, so a lantern gets no `Dmg:` line.

Two details worth keeping:

- **`display` excludes damage riders; `displayFull` includes them.** The inventory row already
  gives riders their own warning-coloured chip and would otherwise print them twice.
- **The coercion now lives one level down.** See *The derivation returns numbers* below —
  `getEffectiveItemBonuses` absorbs the authored string format, so this function no longer has to.

A figure that has moved off the printed value is marked `isModified` and rendered in
`--cs-info` with a dotted underline. The cue is quiet on purpose: on an unmodified weapon —
the common case — none of it fires. `isModified` compares against the **raw** entry, not the
projected one, or a material's die step would silently look standard.

The stored `damage` field stays for save compatibility but is legacy. Read-time derivation wins.

### The derivation returns numbers, and everyone reads one total

Item data authors bonuses as **signed strings**. Every one of the 190 `bonusWeapon` values in the
site catalogue is `"+1"` / `"+2"` / `"+3"`; so is every `bonusAc` and every `bonusSpellAttack`.
`getEffectiveItemBonuses` used to coerce everything *around* those fields while passing them
through untouched, so the obvious thing a caller does —

```js
(eff.bonusWeapon || 0) + (eff.bonusWeaponAttack || 0)
```

— concatenated instead of adding. A `+2` longsword carrying Balanced, Wounding: Keen and
Masterwork reported an attack bonus of **`"2200"`** and a damage line of **`1d8+223`**. Twenty-one
call sites across four modules made exactly that mistake, while a coercion helper (`_parseBonus`)
sat three of them away.

Two changes, both in the derivation rather than the readers:

- **Every numeric field comes back a number.** A derivation absorbs the authored format; it never
  leaks it. An unparseable value reports `0`, never `NaN` — a garbled bonus must not poison an
  entire attack line.
- **`totalAttackBonus` and `totalDamageBonus` are folded and canonical.** `bonusWeapon` is the
  "+2" of a +2 weapon and applies to *both* axes. Left as a bare field, every reader has to know
  that and fold it in itself. Callers now read the totals and never re-add the parts; the per-axis
  fields remain (numeric) for anything that genuinely needs one axis.

The two weapon-attack modals were also reading the **raw entry** rather than the derivation, so
they told a player carrying three upgrades that their magic bonus was "none". They consult
`getEffectiveItemBonuses` now like everything else.

> A `getEffectiveItemBonuses` call for an unknown id still returns `{}`, so `|| 0` guards on the
> totals hold. Test stubs that mock the function with `() => ({})` keep working unchanged.

### Three accessors that could not see their own data

Found by the NPC-export session reading this subsystem from the outside — which is the point:
every one of them looked correct from inside the file that produced the value.

- **`getEffectiveItemBonuses().critThreshold` read the raw item.** A material's `critical` axis
  lands on the *projection*, so an Orichaline katana reported 20 from this accessor while the
  projected item said 19 — live on the combat tab, not only in export. The delta is now read from
  the projection, the way `_recalculateItemBonuses` already did, so `applyToItem`'s clamps and
  degradation's `zeroedAxes` come along instead of being re-derived and drifting.

  The material and the `Critical: Spiked` upgrade are **independent sources that must combine
  exactly once**: 20 − 1 − 1 = 18. The first fix compared them instead of summing and silently
  dropped the material's point whenever an upgrade had already taken one. The clamp now sits
  after *both* sources rather than inside one, which also closed a hole where an upgrade-only
  reduction was never clamped.

- **Adamantine's damage reduction never reached a custom-built armour.** The gate asked
  `item.type === "HA"` — the 5etools catalogue's vocabulary — but the custom-item builder writes
  `type: "armor"` with a separate `armorType: "heavy"`. Every hand-built plate silently lost its
  DR while a catalogue plate kept it. Use **`CharacterSheetState.getArmorCategory(item)`**, which
  understands both vocabularies and returns `"heavy" | "medium" | "light" | "shield" | null`,
  rather than adding another ad-hoc check.

- **`getMaterialEffects(item)` returned a populated *empty* shape** when the material argument was
  forgotten, because — alone among `applyToItem` / `getMaterialNotes` / `getPenetration` — it did
  not resolve internally. A forgotten argument was indistinguishable from a material with no
  effects. It now resolves like its siblings; the two-argument form is unchanged.

### Projection needs a matching inverse, or values compound

`thrownRangeDelta` was added to `applyToItem` without one. The item builder's legacy
de-projection only knew how to undo `rangeMultiplier`, so a Skyshard dagger gained 20 feet of
thrown range on **every** trip through the builder — 20/60 → 40/80 → 60/100 — permanently, because
the gain was baked into the authored value rather than re-derived.

The inverse runs in the opposite order to the projection: `applyToItem` scales and *then* shifts,
so `_deprojectRange` unshifts and *then* undivides. Any new projection field that writes a number
onto the item needs a reversal in `_deprojectLegacyProjection` and, if it is lossy, an entry in
`_getLegacyDeprojectionAmbiguities`. A multiplier is lossy (floor rounding collapses distinct
authored ranges) and is deliberately refused; an additive shift is exact and is reversed.

**`armorForceHeavy` is the case where the loss is invisible.** It overwrites a *category* rather
than a number, and forcing is idempotent — heavy stays heavy — so a forced-heavy leather armour
is indistinguishable from authored plate in the projected item. There is no arithmetic to
detect, which is why it is declared unreversible rather than inverted.

Guarding it needs the effect **isolated**. Darkmetal, the only material that carries it, also
blocks on `ac`, `stealth`, `weight` and `value`, so a test built on the real material still
reports `isValid === false` with the category branch deleted — passing while guarding nothing.
`ItemBuilderCore.test.js` therefore uses a material carrying only the force effect, making the
armour category the sole reason the save is refused. Same trap as counting to one while a
channel is silent: **a guard over one of several sufficient causes must isolate its own.**

### Exploding damage dice are an effect, not a note

*Brutal*'s rules text is genuine exploding dice — roll the maximum on the weapon's damage dice
and you reroll them, adding the result, repeating for as long as you keep rolling maxima. For a
long time the upgrade carried only a `notes` string, so it cost a thousand gold and did nothing
but print a sentence.

It follows the same doctrine magicality does: **the effect is authored data.**
`explodingDamageDice: true` sits on the catalog entity and travels through
`_getStructuredUpgradeDescriptor` → `_mergeUpgradeDescriptor` → `getAggregatedUpgradeEffects` →
`getEffectiveItemBonuses`, so a homebrew upgrade can grant it with no code change and no name
match. The name-keyed built-in survives only as a fallback for saves and catalogs that predate
the field, exactly as `isUpgradeMagical` does.

Boolean flags merge by **OR**, not last-wins: applying Balanced after Brutal must not quietly
revoke the explosion.

`_explodeDamageDice(roll)` applies it, mutating a `_parseDamage` result in place so the damage
total, the dice animation groups and the roll log all pick the extra dice up for free. Three
things it deliberately does:

- **Only the weapon's own dice explode.** Riders, sneak attack and Doubleshot are separate
  `_parseDamage` calls and are left alone — the rule is about *the weapon's* damage dice.
- **Crit-doubled dice explode, once each.** `_parseDamage` doubles `numDice` before this runs, so
  the doubled dice are already in `rolls`; a single pass over them is both correct and immune to
  double-exploding.
- **A maximized roll does not explode.** Destructive Wrath *sets* the dice to their maximum; it
  does not roll it. And the loop is bounded (`maxExplosions`, default 20) rather than trusted —
  a d2 explodes half the time, and a degenerate `sides < 2` is refused outright.

The reroll is itemised in the breakdown (`+ 16 (exploding: 12, 4)`). A player must be able to see
why the number grew.

### The hover tells the truth, and keeps a way back to the book

A materialled or upgraded item is no longer what the catalog describes, so it stops routing to
`items.html`. `isCatalogItemHoverTarget` now treats "has a material", "has applied upgrades" and
"has socketed gemstones" as derived-item conditions, in the same class as `_isEmpoweredGemstone`,
and those items fall through to `buildItemInlineHoverEntry`. Nothing is lost: `_addItem` copies
`entries`, so the printed prose comes along.

Two things make this safe rather than a trade of one regression for another:

- **A plain catalog item takes the catalog path unchanged.** Verified side by side — a pristine
  Shortsword still shows the full 5etools statblock with properties, mastery and source line.
- **A modified item keeps a link back.** `hasCatalogItemIdentity` was split out of
  `isCatalogItemHoverTarget` for exactly this: an item can *have* a catalog identity while no
  longer *being* what that entry describes. The inline entry ends with a `{@note}` carrying an
  `{@item}` link to the printed version.

The entry gains **Material**, **Upgrades**, **Socketed**, **Attack** and **Critical** lines, and
its Damage line comes from `getEffectiveWeaponDamage` rather than the frozen string. With more
than one upgrade the list becomes a real bulleted list — each summary already carries its own
punctuation, so joining several with semicolons was unreadable.

`buildItemInlineHoverEntry` is a pure static called from a dozen render sites with no reference
to state, so state publishes itself as **`globalThis.__csState`** in its constructor, mirroring
the existing `__csMaterialCatalog` / `__csResonanceCatalog` handles. `window.charSheet` looks
like an alternative but is explicitly a debugging affordance.

**Every surface has to actually call the shared builder for any of this to hold.** The Combat tab
opted out: it hard-coded `Renderer.get().render("{@item ${name}|${source}}")` for auto-generated
weapon rows. A custom weapon has no catalog entry, so that produced a link resolving to nothing; a
materialled one resolved to the pristine entity — the exact lie removed everywhere else, still
intact there because that site never called `buildItemHoverNameHtml`. It does now.

Only weapon-backed rows go through it. A feature or spell attack is not an item, and resolving its
name against the item catalog would produce a second broken link in place of the first.

### A single-valued picker closes; a multi-valued one stays open

A material is one field, so applying one is a completed decision and the modal closes. Upgrades
are a *list* — a weapon takes several — so the upgrade picker rebuilds its body in place after
every apply, remove or unsocket and exits only via an explicit **Done**. The consequence is that
nothing in its body may be closed over: the eligible list, the applied list, the gold total and
the socketed gemstones are all recomputed per rebuild. Anything that must persist across a
rebuild but lives in the DOM — the cost-bypass checkbox — is mirrored into a closure flag,
because the element itself is destroyed each time.

This is also why the upgrade rows use a hairline separator rather than zebra stripes: a row's
colour must not change just because the list above it grew.

### The row wraps instead of overflowing

Each row carries a name, a stat summary and up to two chips. At 390px they cannot share a line:
without `flex-wrap` the summary is squeezed toward zero and breaks one word per line while the
`white-space: nowrap` chips overflow the modal. The row wraps, and the summary has a
`14ch` flex basis so it drops to its own line rather than being crushed.

The header's clear-material control also moved: it was a red trash glyph sitting directly under
the modal's ✕, which is a mis-tap that silently changes the item. It is now a labelled
**Remove** button beside the material's own name, and the expanded detail panel carries a second
one in context.

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

`test/jest/charactersheet/CharacterSheetMaterials.test.js` — 209 tests over a hand-built
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
the picker sort metrics (item-aware axis gating, projected damage die, `∞`/`−∞` ordering, and
the null-not-lie rule for materials that cannot reprice or reweigh the item),
and the `attachedSpells` shape matrix (every usage key, combined keys, the non-spell `ability`
sibling, suffix stripping, cross-category dedupe, plus the state guard degrading to `null`
instead of throwing).

`test/jest/CraftingItemMaterials.test.js` additionally pins the two Thelemar reference rules,
including the drift guard between the brew's Magical Interference table and the JS constant.

## An empty catalog looks exactly like "no material"

Materials are stored on items as a `{name, source}` **reference**; the entity itself lives in the
catalog. `resolveMaterial` returns `null` when it cannot find the entity — and `null` is also the
correct answer for an item that simply has no material. Those two cases are indistinguishable to
every caller, so a character whose catalog never loaded renders as a plausible, wrong sheet: no
error, no missing section, just every material effect quietly absent.

This is not hypothetical. Two sessions independently concluded that Adamantine's damage reduction
was unimplemented, each having loaded a real save into a harness that never called
`setItemMaterialCatalog`. Both measured `getNamedModifiersByType("damageReduction") === []` and
both believed it. The feature was working the whole time.

`resolveMaterial` and `resolveResonance` now record every reference they cannot satisfy, and warn
once per unique reference. **The catalog size is the diagnostic**, because it separates two causes
with opposite fixes:

| Signal | Cause | Fix |
|---|---|---|
| `poolSize: 0` | The catalog was never loaded — brew missing, or a test that forgot `setItemMaterialCatalog` | Load it. *Every* material on the character is dead, not just this one |
| `poolSize: n` | This one reference is bad — renamed or mis-sourced material | Fix the reference |

Read the record with `CharacterSheetMaterials.getUnresolvedReferences()`. `setItemMaterialCatalog`
clears it when a non-empty catalog arrives, so a late-loading brew does not leave behind warnings
that are no longer true.

**When writing a test that touches materials, load the catalog.** A test that omits it does not
test materials — it tests the empty-material path, and it will pass against a completely broken
implementation. `CharacterSheetMaterialCatalogResolution.test.js` measures the real Adamantine
path against the authored brew for exactly this reason.

**Order matters, and the setter now compensates.** A brew is user-installed, so it can load
*after* a character. Every material modifier computed before that point was computed against an
empty catalog, and from the inventory's point of view nothing has changed since — so no ordinary
path would ever recompute them, and the sheet stayed silently un-materialled for the rest of the
session. `setItemMaterialCatalog` and `setDraconicResonanceCatalog` now call
`_recalculateEquipmentModifiers()` when a non-empty catalog changes size and an inventory exists.
An empty catalog is ignored rather than allowed to wipe live modifiers.

## Damage reduction is a tiered list, so every reader must gate it

Adamantine authors **two** damage-reduction entries — 3 for heavy armour, 2 for medium — and
authors nothing for light armour, shields or weapons. The entries are a menu, not a total, so
every consumer has to select the one matching the item in hand and reject the rest.

There are two ways to get this wrong and both manufacture a rule:

- **No gate at all** prints every tier at once. One plate is told to reduce incoming damage by 3
  *and* by 2, and a longsword is told it reduces damage at all.
- **Falling back to the first entry** when no tier matches hands light armour, or a sword, the
  heavy-armour number, because heavy happens to be authored first.

Inventing a defence is worse than omitting one. A missing note reads as "this material does
nothing here"; a manufactured one reads as a rule, and nothing on screen marks it as false.

The gate is `CharacterSheetMaterials.damageReductionApplies(item, armorType)` and it is the only
copy — `CharacterSheetState._materialDamageReductionApplies` delegates to it, so the modifier
path and the note path cannot disagree about which tier applies. Armour tier itself comes from
`CharacterSheetState.getArmorCategory`, which understands both the catalogue vocabulary
(`type: "HA"`) and the builder's (`type: "armor"` plus `armorType: "heavy"`); the materials
module keeps a small inline fallback for headless callers, pinned against the state module by
test so it cannot drift.

Note the shape of the bug that hid this: under an ungated loop, catalogue **heavy** armour still
printed the right number, because the first authored tier happened to be the heavy one. The case
anyone would check first was the one case the defect could not touch.

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
