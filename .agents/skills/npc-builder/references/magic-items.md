# Magic items — the loadout format

`LOADOUTS` maps NPC name → an array of item entries. The key is optional; omit it
for an item-less NPC. Items are resolved against the loaded catalog, enriched (bonus
strings parsed, armor fields populated, AC-setting formulas applied), then equipped /
attuned / stacked as specified.

```js
export const LOADOUTS = {
  Reggu: [
    {candidates: [P("Sun Staff", "BMT")], equip: true, attune: true},
    {candidates: [P("Bracers of Defense", "XDMG"), P("Bracers of Defense", "DMG")], equip: true, attune: true},
    {candidates: [P("Insignia of Claws", "HotDQ")], equip: true, attune: false},
    {candidates: [P("Gem of Brightness", "XDMG"), P("Gem of Brightness", "DMG")], equip: false, attune: false},
    {candidates: [P("Potion of Superior Healing", "XDMG")], equip: false, attune: false, qty: 3},
  ],
};
```

## Search the catalog before you write a single loadout

The loaded catalog has ~14,000 items across official books **and** every auto-loaded
homebrew (TGTT, Moorchlyne Ioun stones, Grim Hollow, Griffon's Saddlebag, Valda's,
and anything the user dropped in). If you write loadouts from memory you'll reach for
the same dozen official staples every time — which is the exact "these are repetitive"
complaint this skill keeps getting. So **run `scripts/search-catalog.mjs` first** and
build each loadout from what's actually loaded:

```bash
# themed striker weapon, cross-source, so you find the homebrew ones
node <skill>/scripts/search-catalog.mjs items --name fire --rarity "very rare"
# a spellcasting focus that does more than +X
node <skill>/scripts/search-catalog.mjs items --type SCF --attune yes
# planar-travel / food / utility wonders by theme
node <skill>/scripts/search-catalog.mjs items --name ethereal
# grab exact {name, source} to paste into candidates
node <skill>/scripts/search-catalog.mjs items --name "phoenix" --json
```

The by-source histogram at the bottom of each result tells you how much homebrew
exists for that theme — if everything you found is `DMG`/`XDMG`, widen the search
(different `--name` themes, drop `--rarity`) until the homebrew shelves show up.



| Field | Notes |
|---|---|
| `candidates` | Ordered list of `{name, source}`. The **first** one that resolves in the catalog wins — list the preferred printing first, cheaper fallbacks after. |
| `equip` | `true` to equip/wear/wield it. |
| `attune` | `true` to attune (counts against the 3-attunement budget — except Ioun stones, see below). |
| `qty` | Stack size for consumables (default 1). |

Why `candidates` is a list: the same item is often printed in several books with
different source codes. Listing fallbacks means the entry still resolves if the
preferred printing isn't in the loaded set. The `P(name, source)` helper (defined in
the batch) just builds `{name, source}`.

## Source-preference order

When picking which printing to list first, prefer:

**TGTT → XDMG → XPHB → DMG → PHB → other official (TCE, BMT, …) → setting/adventure**

Homebrew items live under their homebrew source (`TGTT`, and the Ioun-stone
document's source code). Because homebrew items only exist once the homebrew set is
loaded, referencing a homebrew item is also what tells the engine "homebrew is
ready" — no separate signal needed.

## Attunement budget

A character can attune to **3** items. Mark exactly your three best attunement items
`attune: true`; everything else `attune: false`.

**Ioun stones are the exception** — by this campaign's rule, Ioun-stone attunement
does **not** count against the 3-item cap. So an NPC can carry the normal 3 attuned
items *plus* one or more Ioun stones. Ioun stones are a great way to add a stat bump
or utility without spending the budget — reach for them when a build wants one more
boost and the three real slots are full.

**Never default to the official XDMG Ioun stone.** The loaded homebrew includes the
Moorchlyne document (source `MECIounStones`) — ~685 stones covering resistances,
speed, extra attacks, spell echoes, protective auras, summonable shards, and far
more. Search it and pick one that *fits the NPC's theme and role*:

```bash
node <skill>/scripts/search-catalog.mjs items --name ioun --source MECIounStones --limit 60
node <skill>/scripts/search-catalog.mjs items --name ioun --source MECIounStones --json --name "#062"
```

For **ordinary** NPCs pick the **base** stone, not a `(Super-Charged)` variant
(those are legendary/artifact-tier). Vary the stone across the party — no two NPCs
should carry the same one.

**Epic exception (bonding + super-charging).** For legendary/epic NPCs the user may
ask you to lean in: *bond* every stone (set `attune: true` on all of them — a
"bonded" stone is simply one that orbits/attunes, and unattuned ability stones do
nothing) and swap each stone that has a `(Super-Charged)` variant for that variant.
Only ~6 of a dozen numbered stones have one — confirm per stone before renaming
(`search-catalog.mjs items --name "#001" --source MECIounStones`), because a
non-existent `(Super-Charged)` name goes unresolved. Super-charged ability stones
double their bump (e.g. #001 Pale Blue STR +2→+4, #005 Pink CON +2→+4), so
re-verify the signature stat in the export after switching. The named
`Ioun Stone, Mastery` (DMG/XDMG, legendary) grants **+1 proficiency bonus** — a
prose-only effect with no structured field, so it needs `graft: {profBonus: 1}` on
that NPC to actually land (see spec-format.md).

## Stat-boosting items must be `attune: true` to actually apply

This is the single easiest way to silently lose a stat bump. The enrichment step
only applies an item's ability effect (Ioun Stone of Strength `ability:{str:2}`, a
Belt of Giant Strength `ability:{static:{str:25}}`, a Tome/Manual `ability:{int:2}`)
when the item is **attuned** — items that `requiresAttunement` but aren't attuned are
skipped, so the score never moves. Because most of these carry `reqAttune: true`, an
ability stone left at `attune: false` is purely cosmetic.

So when you want a score to land above 20 (or anywhere), mark the booster
`attune: true`. Per this campaign's rule Ioun-stone attunement is free, so attuning
an ability stone costs nothing against the budget — and belts/tomes/manuals are worth
one of the three real slots when the stat matters. Verify by reading
`itemAbilityOverrides` in the export (`{bonus:{str:6}}` / `{static:{str:25}}`) or the
spawn's printed `abil:` line, **not** by eyeballing the loadout.

Vary the booster *type* across a party rather than stacking Ioun stones on everyone:
a numbered MEC stone here, the classic named `Ioun Stone, Leadership` there, a
`Tome of Clear Thought` (INT +2, no attune) for a scholar, a `Manual of Quickness of
Action` (DEX +2) for a duelist, a `Belt of Fire Giant Strength` (sets STR 25) for a
front-liner. For **epic** NPCs, layer two boosters (e.g. a +2 stone *and* a +4
super-tier stone, or a +2 stone *and* a matching tome) to push a signature stat to
24–26, and remember an epic boon can add a further +1.

## Custom / fused items — `custom:` on a loadout entry

When the user asks for a bespoke item that exists in no book — most often "fuse
weapon A and weapon B into one" — author the item object by hand and inject it with
`custom:` instead of `candidates:`:

```js
Arthur: [
  {custom: CATACLYSM, equip: true, attune: true},   // CATACLYSM = {...} defined atop the batch
  // …
],
```

Build the object by reading the two real items' full data
(`search-catalog.mjs items --json --name "…"`) and merging their mechanical fields:
`name`, a `source` you invent (e.g. `"Raza"`), `type`, `weaponCategory`, `baseItem`,
`property`, `mastery`, `dmg1`/`dmgType`, `bonusWeapon` (a `"+N"` string — the engine
parses it), `charges`, `reqAttune`, `rarity`, and an `entries` array carrying every
merged feature as prose. A custom entry skips catalog resolution but flows through the
exact same enrichment as any other item, so `bonusWeapon`/armor fields parse
identically. Confirm in the export that the item is present with a numeric
`bonusWeapon` and finite damage.

`custom:` also has two non-fusion uses that come up for epic NPCs:

- **Enhancing a named item's stat bump.** A catalogue ring/belt whose `ability`
  boost is trivial at high level (e.g. the `Ring of the Assassin Lord`'s `dex:2`)
  can be reforged: copy its fields, keep its signature feature prose, bump `ability`
  to `{dex: 4}` (or higher), and inject it via `custom:`. A custom item's `ability`
  block is read on import exactly like a real item's, so the larger increase lands
  (verify `itemAbilityOverrides.bonus` in the export).
- **A pre-loaded `Ring of Spell Storing`.** The sheet has no structured "stored
  spells" slot — a real ring imports empty. To give an NPC a ring loaded with
  specific spells, inject a `custom:` copy whose `entries` name exactly what it holds
  (e.g. "currently holding {@spell vampiric touch} (3rd) and {@spell blindness/
  deafness} (2nd)"), keeping the total within the ring's 5-level capacity. It's
  self-documenting on the sheet even though the casting itself stays DM-tracked.

## AC-affecting items work automatically

The enrichment step handles the fiddly cases so AC math doesn't break:

- Items must be added through the inventory's add path (the engine does this) so
  `"+1"/"+2"` bonus strings and armor fields parse — a raw add yields `NaN` AC.
- **Bracers of Defense** apply through the Unarmored Defense AC formula even with a
  stored `itemBonus: 0`; they'll show up in the recomputed AC as long as the wearer
  is actually unarmored. (Reggu ends at AC 21 with them.)
- AC-**setting** items (e.g. Robe of the Archmagi) have their formula parsed and
  pushed to `state._data.acFormulas` with `sourceType: "item"`, so the sheet uses the
  set value.

Always run `verify-npcs.mjs` afterward and confirm AC/HP are finite — that's the
canary for an item that didn't enrich correctly.

## Keep loadouts varied

A recurring note from the user: **don't hand every NPC the same three staples**
(Cloak of Protection + Bracers/Ring of Protection + a generic +X weapon). It reads
as lazy. Instead:

- Give each NPC items that *express their build and role* — a controller wants
  save-DC / concentration support (Robe of the Archmagi, Rod of the Pact Keeper,
  Staff of Power), a tank wants layered defense and stickiness, a striker wants
  damage riders and mobility, a face wants social/utility wonders.
- Vary the *category* mix across the party — tattoos, ioun stones, wondrous items,
  consumables, a signature weapon, a magical food source, a planar-travel item —
  rather than everyone wearing the same cloak.
- Signature/required items the user named are fixed; build the *rest* of the loadout
  to complement them and to differ from the other NPCs in the same batch.
- Use consumables (potions, a Gem of Brightness, scrolls) to round out flavour
  cheaply without spending attunement.

When in doubt, look across the whole batch and make sure no two NPCs read as
palette-swaps of each other.
