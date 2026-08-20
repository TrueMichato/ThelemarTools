# NPC Export

Convert a live character sheet into a 5etools bestiary-shaped homebrew monster for previews, wild shape / companion consumption, downloads, clipboard paste, and Save to Homebrew.

## Entry points

| Surface | How |
|---------|-----|
| Toolbar | `#charsheet-btn-export-npc` |
| Play mode actions | **NPC Export** |
| Code | `CharacterSheetExport._showNpcExportDialog()` → `CharacterSheetNpcExporter.convertStateToMonster(state, options)` |

## Architecture

```
CharacterSheetState (read-only)
        │
        ▼
CharacterSheetNpcExporter.convertStateToMonster(state, options)   // pure
        │  monster JSON
        ▼
CharacterSheetExport dialog
  - source meta + export options (persisted)
  - live preview (Renderer.monster.getCompactRenderedString)
  - validation panel
  - Copy JSON | Download JSON | Save to Homebrew
```

- **Converter** (`js/charactersheet/charactersheet-npc-exporter.js`): all static, no DOM. Prefer state getters (`getSpellSaveDc`, `getInnateSpells`, `getPactSlots`, `getAcBreakdown`, `getFeatureCalculations`, …) over re-deriving rules.
- **Dialog** (`js/charactersheet/charactersheet-export.js`): UX shell only. Options sanitized through `getSanitizedExportOptions`.

Brew package shape:

```js
{
  _meta: { sources: [/* source meta */] },
  monster: [ /* one monster */ ],
}
```

## Export options

Persisted under `charsheet-npc-export-options` (source meta under `charsheet-npc-export-source-config`).

| Option | Values | Default | Notes |
|--------|--------|---------|-------|
| `defenseMode` | `persistent` \| `active` | `persistent` | Active merges currently-on effective defenses; **conditional** toggles (Rage B/P/S, stances) always annotate the block with `{note, cond:true}` |
| `includeUnarmed` | `auto` \| `always` \| `never` | `auto` | Auto keeps monk/enhanced unarmed; drops plain unarmed when other weapons exist |
| `includeFeatures` | `auto` \| `allImportant` \| `manual` | `auto` | Manual uses `selectedFeatureIds` from the feature picker |
| `selectedFeatureIds` | `string[]` | `[]` | Cap 64 |
| `includeCustomModifiers` | bool | `true` | Smart leftover **Additional Effects** (default on). Bookkeeping already on the block is filtered; unrepresented riders stay |
| `includeCustomAbilities` | bool | `true` | Custom abilities routed by action economy |
| `includeCombatMethods` | bool | `true` | TGTT methods grouped by stamina; stance riders expanded |
| `crMode` | `auto` \| `manual` | `auto` | |
| `crManual` | CR string | `"1"` | e.g. `"1/2"`, `"12"` |
| `legendaryEnabled` | bool | `false` | Off by default |
| `legendaryActions` | 0–5 | `3` | |
| `legendaryResistances` | 0–5 | `0` | Adds `Legendary Resistance (N/Day)` trait when > 0 |
| `nameSuffix` | string | `" (NPC)"` | Appended to display name |
| `includeCrBreakdown` | bool | `false` | Adds defensive/offensive CR note under Level Signal (implies `includeLevelSignal`) |
| `includeLevelSignal` | bool | `false` | Out-of-fiction **Level Signal** trait naming the source character's level/classes. Off by default — a bestiary entry shouldn't advertise its origin |
| `spellIndex` | object \| `null` | `null` | Name→threat map built by the dialog from `DataUtil.spell.pLoadAll()`. Makes caster CR spell-aware; absent (tests, headless) the school-weighted fallback runs |

## Conversion pipeline (high level)

1. Identity: name + suffix, size, type (from race), alignment, languages, senses, passive Perception.
2. Defenses: AC + `from` labels; HP average = max HP; formula from primary class hit die + CON.
   - Permanent resists/immunities from sheet + items + unconditional named mods.
   - **Conditional** defenses from `ACTIVE_STATE_TYPES` (e.g. B/P/S `while raging`), conditional named mods, and stance text → bestiary `{resist:[…], note, cond:true}`.
3. Ability scores, saves, skills, initiative from **effective** state totals (`getSaveBreakdown` / `getSkillMod` / `getInitiativeBreakdown`), never canonical values.
   - A save is emitted when proficient **or** when its effective value differs from the plain ability modifier — otherwise a reader silently infers the wrong number from the ability score.
   - Skills are enumerated data-driven (standard + `customSkills` + lore + homebrew) and emitted when proficient **or** bonused; homebrew skills are keyed `name|SOURCE` so they hover.
   - `initiative` is emitted only when it beats the bare DEX modifier, as a bare number, or as `{advantageMode}` when a feature grants advantage.
4. Attacks: merged sheet attacks + equipped weapons → bestiary action lines (range fix, thrown `mw,rw`, Multiattack, unarmed policy).
   - **Conditional damage riders** (`_getConditionalDamageRiders`) append situational extras the sheet does not bake into the damage number — Rage, Demolishing Might, Brutal Strike, and stand-alone conditional damage modifiers — filtered to attacks that can actually gain them. A conditional modifier whose feature also registered an unconditional twin is skipped, because that bonus is already inside the damage line.
   - **Feature-conjured weapons** (`_getFeatureWeaponActions`) become real attack entries. Statistics are parsed out of the feature prose (die, two-handed die, damage type, finesse) and the weapon's name is derived from the sibling features that refer to it, so any "manifest a weapon" feature works without being named in code.
5. Spellcasting: class / pact / innate blocks with sheet DC and attack bonus.
   - **Provenance**: a spell granted by a feat, species or subclass renders as `{@spell Mage Hand|PHB} (Telekinetic)`. Ordinary class routes (`Wizard Spellbook`, `Cantrips Known`, …) are not annotated. A feature whose *entire* content was that grant is then dropped from the ability list; features carrying real mechanics are kept.
   - **Swappable subclass lists**: a subclass declaring two or more `subSubclassSpells` tables gets its own block listing every mode, marking the active one and noting the long-rest switch. Those spells are excluded from the general list so the block never implies both modes are prepared at once.
6. **Features + feats** (`getFeatures` **and** `getFeats`): classified trait / action / bonus / reaction; cleaned prose; uses on **name** as `(6/LR)` / `(2/SR)` / `(3/Day)`; auto cap 16; same-name upgrades deduped. Feats like Polearm Master / Sentinel become real BA/reaction lines (not residual stubs).
7. **Class Resources** only lists **orphan** pools not already attached to an exported ability (and not stamina when Combat Methods is present).
8. Magic items: Special Equipment list + **named `entries` children** as traits/actions/bonus/reaction (e.g. Gae Bolg — Enemy-Blinding Radiance `(1/Dawn)`). Pure attack restatements skipped when the weapon line already covers them. Item-granted spells named per spell.
9. TGTT combat methods → Combat Methods trait (costs, DC, hovers) + **stance rider prose** expanded inline.
   - Stances are first-class active effects: `_parseStanceDefenseText` lifts resistances, immunities, condition immunities and save advantages out of the stance description (the stored `stanceEffects` payload is empty in practice) and feeds them through the same `while in <Stance>` annotation path as Rage.
   - `_ensureToggleAbilityIntegrity` guarantees every `while <Toggle>` annotation has a matching ability entry, synthesising one from the active-state or stance description when it is missing. A stance with parseable persistent effects is defined even when nothing references it.
10. Armor upgrade / gemstone notes via state getters.
11. Smart **Additional Effects** (default on): leftovers not represented by abilities/defenses/skills; `bonusAction` named mods promoted to real bonus entries when no feat covered them.
12. CR advisory + optional legendary framing.
    - **Spell-aware offence.** `highestSlot * 9 + 4` rated a Wish-carrying diplomat exactly
      like a Meteor Swarm blaster. `_estimateSpellDpr` now scores the spells the character
      actually knows. With a `spellIndex` (name→`{level, avgDamage, isAoe, isMultiTarget,
      conditionInflict}`) built from the site's spell data, damage comes from
      `damageInflict` + the largest `{@damage XdY}` in `entries` — gated on `damageInflict`
      being non-empty, so *Wish*'s incidental `1d10` is not read as artillery. Control spells
      score off `conditionInflict` ∩ an incapacitating-condition set. `areaTags` weights the
      result: every tag except `ST` and `MT` is a real area (×1.5); `MT` is ×1.25.
    - Scored over the DMG's **three rounds**, spending real slots highest-first with the
      cantrip as the floor, so one Meteor Swarm is not a sustained 105 DPR.
    - **Offline** (`spellIndex` absent — tests, Node harnesses) a school heuristic stands in:
      `(level × 8 + 4) × weight`, weight 1 for Evocation/Conjuration/Necromancy, 0.75 for
      Enchantment/Illusion, 0.4 for Abjuration/Divination/Transmutation. Coarser, but it
      still separates a blaster from a utility caster. Homebrew spells always take this path.

## Ability prose pipeline

Goal: **bestiary density + hovers**, not a PC feature dump.

1. **Preserve `{@tags}`** when stripping HTML (never unwrap tags to plain text).
2. **Sanitize inbound tags**: homebrew sources are stripped from core condition tags
   (`{@condition prone|TGTT}` → `{@condition prone}`, otherwise the hover 404s), and
   `{@quickref …|display}` collapses to its display text.
3. **Parse JSON-serialized descriptions**: some features store `description` as a
   stringified entries object; it is parsed and flattened to prose *before* cleanup,
   so raw JSON never reaches the block.
4. **Strip player meta**: `Starting at Nth level` / `at level N` (ordinal **and**
   cardinal, sentence-initial **and** trailing), path-choice preambles, `Prerequisite:`,
   “Rages column” / level-table language, `Rules Tip: … p166` cross-references, and
   use-count scaling sentences (redundant once uses print on the name).
5. **Third-person voice** — the core of the v4 rewrite. Second person is first mapped
   to neutral sentinel tokens (`§§SUBJ§§` / `§§POSS§§` / `§§REFL§§`) so pronoun choice
   and verb agreement are each decided exactly once, after every substitution lands:
   - `_conjugateAfterSubject` conjugates the verb adjacent to the subject token,
     skipping object position (`allows you to…`) and any run of `-ly` adverbs.
   - `_conjugateImpliedSubjects` handles coordinated clauses that dropped their
     subject, guarded by modal/infinitive/plural-cue checks and by
     `_hasBareAntecedentVerb` (coordinated verbs must share agreement).
   - Materialization emits the **name on first mention, `it`/`its` thereafter**, plus
     `itself` for reflexives. Sentence starts are re-capitalized.
6. **Structure-aware splitting instead of truncation.** A hard character cap silently
   discarded whole sub-sections of long features (Daemonologist boons, Staff of Power's
   Retributive Strike). `_splitFeatureDescriptionSections` splits on the renderer's
   `data-roll-name-ancestor` markers, strips the repeated heading, then splits each
   chunk on `<p>` boundaries; each section becomes its own string in `entries` with a
   `{@b Label.}` prefix. The remaining ~900-char budget is a runaway guard applied
   *within* a section, never across sections.
7. **Enrich hovers**: `{@condition …}`, ability `({@skill …})` patterns, safe skill names — without double-wrapping existing tags.
8. **Infer, don’t restate**:
   - Permanent named-mod immunities/resists fold onto the block, **credited to the
     feature that grants them** — `resist: [{resist: ["poison"], note: "({@feat Poison
     Resilience|TGTT})"}]`. `note` is pushed through `Renderer.get().render()`
     (`js/parser.js`), and `cond` is *not* required for it to display, so the attribution
     hovers. Only feats get a real tag: class, subclass and species features are keyed by
     tuples the exporter cannot reconstruct, so they degrade to a bare name rather than
     emitting a dead link — *hover when you can*, not *hover always*.
   - The sentence that granted an attributed defence is then stripped from the feature's
     prose (`_stripBlockRestatedSentences`), so Poison Resilience keeps its
     advantage-on-saves clause and loses the duplicated resistance line.
   - Toggle defenses annotate with `note` + `cond: true` on `resist`, `immune`,
     `vulnerable` **and** `conditionImmune` (not silent omission, and never stated as
     permanent).
   - **Mode-gated** defenses are read from any feature body, not just stances:
     `While <condition>, … Resistance to <type>` yields one conditional entry per mode, so
     a shapeshifter shows *both* forms rather than only the active one. A flat hand-entered
     resistance that matches a gated grant is *converted* rather than duplicated. Gate
     phrases are matched case-preserving so proper nouns survive.
   - Pure speed/HP/skill features already on the monster object are omitted (`alreadyApplied`).
   - Uses live on the **ability name**; Class Resources is orphan-only — and an orphan
     pool now forces its *ability* to export rather than printing a bare pool name.
   - **Additional Effects** is smart residual (default on), and a leftover bullet whose
     content-word fingerprint is ≥80% covered by an ability already on the block is
     dropped (`_isEffectAlreadyDescribed`).
9. **Light templates** for Rage (resists on block), Stone’s Endurance, Reckless Attack;
   written in 2nd person and pushed through the same pipeline so they inherit pronoun
   and tagging rules.
10. **Attack lines**: magic bonuses already in `{@hit}` / `{@damage}` → the qualifier
    reads “The attack is magical.” Synthesized feat attacks (Polearm Master) inherit the
    **source weapon's** to-hit and damage bonus so one statblock can't contradict itself.

11. **Compaction** (`_compactStatblockProse`). The prose pipeline emits **one sentence per
    `entries` element**, so any sentence-level rule must flatten across the whole entry
    first, mark dead sentences, then regroup — operating per element silently no-ops.
    Sentences dropped:
    - Recharge restatements ("can't do so again until it finishes a Short Rest") — the
      `(5/SR)` suffix on the name already says it.
    - A **leading** run establishing no mechanic, once a mechanical sentence follows. A
      gate ("while wielding a shield") counts as a mechanic.
    - `For example, …`, level-table scaffolding, and any sentence repeated verbatim
      elsewhere in the same entry (per-stance boilerplate).
    - Build-time spellcasting bookkeeping: "the spellcasting ability … is the ability
      increased by this feat", "must be from the … school of magic", "can also cast these
      spells using spell slots", "if it already knows this spell". A statblock prints one
      DC and one resolved spell list; none of this survives contact with the table.
    An entry whose *every* surviving sentence is a spell grant is dropped outright when the
    spells it names are already printed on the block — either because provenance says so or
    because the spell list contains them (Fey Touched grants Misty Step into a wizard's
    spellbook, leaving no provenance trail yet saying nothing new).

12. **Readability polish**:
    - `Rules Tip:` / `Sidebar` / `Design note` sub-sections are dropped — they explain the
      general rules to a player, not this creature.
    - A sub-section label authored as plain leading body text is de-duplicated against the
      emitted `{@b Label.}` prefix (`_stripLeadingLabelEcho`), which otherwise printed
      "{@b Forceful Blow.} Forceful Blow. The target is pushed…".
    - An option menu authored as plain `Shadowbite: …` paragraphs is promoted to
      `{@b Shadowbite.} …` so a DM can scan it mid-combat (`_boldInlineOptionLabel`).
      Clause-ending colons ("gains the following:") are excluded.
    - A shared rider that floats above the options it qualifies ("If the effect requires a
      saving throw, it uses a DC of …") is demoted below them (`_demoteOrphanedRider`).

13. **Features are never suppressed for lacking a structural home.** `advantage` /
    `disadvantage` are not "already applied" — a statblock has no field for them — so
    Reckless Attack, Danger Sense and Brutal Strike stay. A feature with labelled
    sub-sections is likewise never folded away. Any feature *named by an attack rider* is
    exempt from the feature cap (`protectedFeatureNames`), on the same principle as v5's
    toggle integrity: anything referenced elsewhere on the block must be defined on it.

14. **Name matching is token-subset, never substring** (`_featureKeyMatches`). Raw
    `includes` in both directions made `"rage"` match `"aura of cou`**`rage`**`"`,
    `"master fo`**`rage`**`r"` and `"`**`age`**`"` — one bug that put barbarian resistance
    on a Paladin and Rage's uses on two passives. A resource matches a feature only when
    its tokens are a **subset** of that feature's tokens.

15. **Caster ability is derived from the caster class** (`_CASTER_CLASS_ABILITY`,
    `_getPrimaryCasterAbility`). `state.getSpellcastingAbility()` returns `null` for
    multiclass characters and the old `"int"` fallback exported DC 12 for a level-13 Bard.
    The dominant caster class decides (bard/sorcerer/warlock/paladin → cha, cleric/druid/
    ranger → wis, wizard/artificer → int); any value the state *does* resolve wins.

16. **Multiattack targets the highest expected damage** (`_estimateDamageScore`), not the
    first non-unarmed attack — a level-11 Paladin's 1d8 Radiant Strikes rider was being
    named instead of its +2 longsword. Long item names are shortened for the sentence
    (`_getShortAttackName`).

17. **Only schema-legal vocabulary reaches the block.** Damage types and conditions are
    validated against the `util.json` enums; anything else (a "spell" resistance, a
    "surprised" immunity) is routed to an *Other Defenses* prose note rather than emitted
    as invalid data.

18. **Level-progression tables collapse to the applicable row** (`_collapseLevelTables`,
    run inside `_stripHtmlTags` because tables arrive as rendered HTML in
    `feature.description`). A column is treated as cumulative when its cells hold a list
    (spell tables merge every row ≤ level) and as a scalar progression otherwise (take the
    latest row): `Beast Shapes Druid Level Known Forms Max CR Fly Speed 2 4 1/4 No 4 6 …`
    becomes `{@b Beast Shapes.} Known Forms 8, Max CR 1, Fly Speed Yes.`

19. **Compaction is clause-level, not sentence-level** (`_splitIntoClauses` +
    `_repairClauseSeam`). Rules text welds a restated mechanic to a novel one with a
    semicolon, and dropping the whole sentence loses the novel half. The splitter is
    paren- and brace-aware — `(attuned; orbiting)` and `{@dice …}` are single units — and
    seams are re-punctuated afterwards. Only the *start* of a string is re-capitalised:
    "reach 5 ft. or range 20/60 ft." proves a period is not a sentence boundary here.

20. **Multi-benefit features split by action economy** (`_splitMultiBenefitEntries`).
    Shield Master arrives as one paragraph under `bonus` containing a bonus action, a
    passive AC benefit *and* a reaction. Sentences are filed by their own stated
    activation, using the same single classifier (`_getActivationSectionFromText`).
    A feat that *opens* with standing benefits and only later states its activation
    (War Caster) moves those leads to `trait` — but only when they are persistent **by
    grammar** ("has advantage", "is immune", "can perform", "doesn't"). A flavour lead
    ("can inspire others through stirring words") introduces the activation and stays.

21. **More restatement removed**: the class `Spellcasting` trait when a real spellcasting
    block exists (1,451 chars of "see chapter 10 of the Player's Handbook"); rulebook
    navigation and DM-permission guidance; weapon construction rules the attack line
    already shows (damage die, proficiency); an unconditional "This damage increases to
    2d8." that names no trigger to evaluate; form-change boilerplate (equipment merging,
    object handling, "game statistics are replaced by the Beast's stat block"); and
    `Class Resources` rows naming a spell the spellcasting block already prints
    (`_dropResourcesCoveredBySpellcasting`).

22. **Final punctuation hygiene** (`_tidyStatblockText`): toggle bookkeeping
    (`(passive; active)`), `( 2d8 )`, `….`, `e. g.`, stray list fragments left by a
    flattened bulleted list. Truncation closes any parenthesis it opens, so a cut can
    never leave the rest of an entry inside an unclosed paren.

23. **Special Equipment lists everything carried, not only what is worn**
    (`_getSpecialEquipmentBlock`). Requiring `item.equipped` silently dropped a
    Driftglobe, a Pearl of Power, a Javelin of Lightning and a Bag of Holding from every
    export. Carried items are marked `carried`; consumables collapse onto one trailing
    `{@b Consumables:}` line so a pile of potions cannot crowd out permanent gear.
    `_getMagicItemUseBlocks` **keeps** the equipped gate — a stowed item is worth
    *listing* but grants no ability.

24. **An item's trait is its benefit, not its lore** (`_getItemUseSnippet` +
    `_isGenericItemClassPreamble`). An Ioun Stone's `entries` are four paragraphs of
    shared Ioun lore plus one line of actual benefit; taking the first 240 characters
    printed pure flavour. The snippet now selects the benefit-bearing paragraph, and a
    stone whose only benefit is an ability increase already folded into the block emits
    **no trait at all** (`_isStatOnlyItemSnippet`).

25. **Numbers are inferred, not restated** (`_stripRestatedNumericSentences`). Alert's
    "+5 bonus to initiative" and a Necklace's "+3 bonus to AC and a +2 bonus to all
    saving throws" already print in `initiative`, `ac` and `save`. Each drop **verifies
    the value matches what was folded in** — an enabled `initiative` modifier, or the
    item credited in `ac[].from` — rather than trusting the phrasing.

26. **Damage riders live on the attack line** (`_getConditionalDamageRiders`). Divine
    Strike and Improved Divine Smite join Rage and Demolishing Might as `wholeFeature`
    riders, so the weapon reads `… plus {@damage 1d8} necrotic or radiant damage (Divine
    Strike, once per turn)` and the standalone trait retires. The **character's own
    feature text outranks derived calculations** (`_getFeatureStatedDamageType`):
    `calculations.divineStrikeType` reports `thunder` for a 2024 Blessed Strikes cleric
    whose feature plainly says "Necrotic or Radiant".

27. **Standing defences merge into one `Resilience` trait** (`_mergeResilienceTraits`).
    A deep character accumulates a scatter of one-line benefits (advantage against
    frightened, against spells, on concentration saves). Only single-clause standing
    benefits merge; anything with its own mechanics or sub-options stays a full trait.
    The contributing feature name stays visible so nothing becomes unattributable, and
    prefix-subsumption dedupe drops "advantage on saves against spells" once
    "…and other magical effects" is present.

28. **Feats print in statblock shorthand** (`_getTemplatedFeatureText`). Ten terse
    templates cover the high-traffic feats: Sentinel 441 → 178 chars, Great Weapon
    Master 400 → 102, Shield Master 374 → 142, Alert 183 → 89. Templates are authored in
    second person and pushed through the same pipeline, inheriting pronoun, tagging and
    conjugation rules. A feat whose only content is "its hit point maximum is already
    increased" gets no template — that is content-free, not terse.

29. **A `{@b Label.}` and the text it introduces are indivisible**
    (`_groupSentencesIntoBenefitUnits`). The multi-benefit splitter was severing Cloak of
    Shadow's body from its label, filing them under different activations. Note the label
    sits **mid-sentence** ("…gains the following options: {@b Cloak of Shadow.} …"), so
    the unit test is *contains a label*, never `^`.

30. **Stance bodies print exactly once** (`_dropDuplicatedStanceBodies`). The Combat
    Methods roster keeps only the one-line `{@combatmethod …}` index; the full body lives
    in the stance's own ability. This **must run last** in the chain, because
    `_ensureToggleAbilityIntegrity` is what *creates* the standalone stance entry.

31. **Item abilities name the weapon they apply to** (`_resolveHeldWeaponReferences`).
    "coat a physical weapon it is holding" becomes
    "coat {@item Retaliator, Sword of Mac Lir|TGTT}". Only fires when exactly one weapon
    is equipped, so it can never guess wrong.

32. **Divine Favor is built from the catalog, not scavenged from modifiers**
    (`_getDivineFavorBlock`). Boons previously leaked through the residual
    custom-modifier path as garbage (`+1 to Advantage checks when judging the sincerity
    of an oath… (While devoted to Zeus, Lorian Hyvner has advantage o…)`). The homebrew
    `divineFavor[].tiers[].boons[]` are fully structured and each boon carries a
    player-facing `desc`, so the trait renders the tiers unlocked at or below the
    character's favor, labelled once per tier. `abilityScoreBoost` boons are skipped —
    already folded into the printed scores. Degrades silently to no trait when the
    catalog was never loaded (`state.setDivineFavorCatalog()`).

33. **Shape-shifting consolidates into the ability that is actually used**
    (`_consolidateShapeshiftEntries`). Wild Shape spanned a bonus action plus four
    traits, each reprinting the rulebook, and the "rules while shifted" clause arrived
    decapitated. Satellites (`Circle Forms`, `Improved Circle Forms`,
    `Elemental Wild Shape`) fold in as labelled clauses; formulas resolve to numbers
    (`three times its Druid level (30)`, `13 plus its Wisdom modifier (19)`);
    verb-less fragments are dropped by `_isDecapitatedClause`, which exempts labelled
    stat lines like `{@b Beast Shapes.} Known Forms 8, Max CR 1`. `Wild Resurgence`,
    `Wild Companion` and `Primal Strike` stay separate — they are independently usable,
    not riders on the transformation.

34. **Ambiguous skill names need a check context.** `Nature`, `Insight`, `Perception`,
    `Performance`, `Medicine`, `History` and `Survival` are common nouns as well as
    skills; blind tagging produced "a {@skill Nature} spirit" and "the {@skill Nature} of
    the intervention". These now tag only next to a check/proficiency cue, a parenthesis,
    or an adjacent skill tag in a list — so "chosen from Insight, Persuasion, or
    Religion" still tags all three. Unambiguous skills are tagged **first** so the
    list-adjacency test has something to see.

### Runnability passes (v10)

A statblock is only useful if a DM can read a line and act on it. These passes run at
the end of the ability-prose pipeline and exist purely to reduce what the DM has to do
in their head.

35. **Every formula resolves to a number** (`_resolveAbilityFormulas`). Ability
    modifiers, proficiency bonus and their compounds are annotated with the resolved
    value — `its Charisma modifier + its proficiency bonus (11)`,
    `1 + twice its Constitution modifier (9)`, `13 plus its Wisdom modifier (19)`.
    Compound phrases are stashed behind a private-use placeholder before the bare rules
    run, so an operand is never annotated twice. `_dedupeDerivedAnnotations` keeps a
    named die's value on its first mention only.

36. **Capability nouns hover** (`_enrichHoverTags` / `_tagCapabilityTerms`). The XPHB
    action list, `Opportunity Attack`, `Unarmed Strike` and `Difficult Terrain` are
    tagged case-insensitively, keeping the sentence's own casing as display text. Feat
    trait names become `{@feat}`; maneuvers and other optional features become
    `{@optfeature}` (excluding `CTM*`/`BT`, which own `{@combatmethod}`). Each written
    tag is masked immediately so a shorter vocabulary entry can never nest inside it.
    This pass must stay **last** — anything matching entries by plain-text name has to
    run before the names are tagged.

37. **One number per fact** (`_dropSupersededQuantityClaims`). A subclass improvement
    replaces a base-class value rather than adding to it, but both sentences survive
    into the export: Wild Shape claimed Temporary HP of both 10 and 30, and a form CR
    cap of both 1 and 3. The highest value wins; a prose restatement is dropped, a value
    inside a compact list (`Max CR 1`) is corrected in place. Runs *after* the shapeshift
    merge, because the two claims only meet once both features are in one entry.

38. **A menu of parallel options becomes one line**
    (`_collapseParallelOptionLists`). Detected by shape, not by name: three or more
    consecutive `{@b Label.}` sub-blocks sharing an opening and an ending with one short
    varying middle each. Crimson Rite's six identical sentences become
    `The extra damage dealt by its rite is fire (Rite of the Flame), cold (…), or
    thunder (Rite of the Roar) damage.`

39. **A hoverable roster clause is capped** (`_condenseRosterClause`). Once a maneuver
    or stance name links to the full rule, the book paragraph beneath it is reference
    material. Two sentences are kept, plus any sentence carrying a save, DC, condition
    or damage. Stance labels in the Combat Methods roster are `{@combatmethod}`-tagged
    like the cost list above them (`_dropDuplicatedStanceBodies` matches either form).

40. **Conditionals are answered** (`_resolveConditionalFeatureReferences`). Book text
    hedges for every build — "If Dzeiy has its Extra Attack feature…", "(such as the
    barbarian's Rage feature)". An exported NPC is one build, so the hedge is resolved
    against `state.getFeatures()`: the clause is kept without its condition when the
    feature is present (naming it where the pronoun stood) and the sentence is dropped
    when it is not.

41. **Scene-setting leads are trimmed** (`_dropFlavourLeadSentences`). A leading
    sentence goes only when it carries no number, no tag and none of the mechanical or
    duration vocabulary — *and* nothing after it leans on a noun it introduced, *and*
    the remainder does not open with a back-reference ("To do so…"). That dependency
    test is what keeps the clear spindle's "requires no food or drink" and Talna's
    Eidetic Memory recall, both of which read as flavour but are the only statement of
    the mechanic.

42. **Traits are ordered for reading** (`_orderTraitsForReading`). Four stable bands:
    standing passives, resource pools (a `(n/…)` name suffix), triggered effects (a
    trigger word in the body), then rosters — `Additional Effects`, `Special
    Equipment`, `Combat Methods`, `Maneuvers`, `Divine Favor` and friends — last.

43. **A modifier followed by a minimum is resolved, not skipped**
    (`_resolveAbilityFormulas`). The "already annotated" guard used to reject any
    following parenthesis, so `its Charisma modifier (minimum of one)` stayed
    unresolved. The guard now matches the annotation *shape* the exporter writes, and a
    trailing minimum is merged into a single parenthetical: `its Charisma modifier
    (+5, min. 1)`.

44. **Level-gated upgrades are resolved to the level exported**
    (`_resolveLevelGatedUpgrades`). "up to 15 feet; at 7th level, up to 30 feet
    instead" is build guidance for a player. The character's level is known, so the
    tier it qualifies for is folded into the lead sentence and the announcement is
    dropped. Level labels (`3rd-level College of Creation feature`, in plain, italic
    and tagged forms) go with them.

45. **A bonus that applies to every non-proficient skill is stated once, not 25 times**
    (`_getSkillBlockDetail`). Jack of All Trades makes every skill deviate from its bare
    ability modifier, which used to admit all of them into the `skill` map. The uniform
    delta is now detected by comparing against the modal deviation, removed from the
    per-skill rows, and stated as one line. A skill keeps its row when it has
    proficiency, expertise, or a bonus that is *not* part of the uniform grant.

46. **A tag is only emitted when it can hover.** Two rules: a source is resolved from
    the character's own spell list or the action vocabulary, and text stays plain when it
    cannot be (never invent a source); and a spell tag requires membership in a real
    spell list, so Title-Cased sentence fragments (`{@spell Attack Or}`) can no longer
    be fabricated from prose.

47. **Metamagic is one roster, not six loose traits**
    (`_consolidateMetamagicEntries` / `_getMetamagicRosterLine`). TGTT metamagic options
    are Active or Passive, and a Passive is *tuned* — switched on with an action, holding
    its cost out of maximum Sorcery Points and applying to every spell until cancelled.
    The roster groups the options by that state, reading `tunedMetamagics` rather than
    inferring it, and gives each a single parenthetical of the form
    *cost — affected spells: effect*. Costs are read from the option's own `Cost:` line;
    the affected-spells clause is a canonical category label, never a truncated fragment.

48. **Supersession and riders reach across entries.** `_applyCrossEntryQuantityUpgrades`
    rewrites the value in the entry that owns it and drops the announcement ("the damage
    of Radiant Fire increases to 1d8" edits `Radiant Fire`);
    `_mergeSameNameEntriesAcrossSections` merges a feature filed twice, unshifting the
    passive half when the surviving text opens as a continuation;
    `_foldImprovedEntriesIntoBase` folds `Improved X` into `X` when its body is a
    continuation, dropping the "the following effects are now among its options"
    connector that becomes meaningless once the options are in one list;
    `_dropUnownedOptionClauses` removes an option clause that *modifies* a feature the
    statblock never defines; and `_dropSupersededProcedures` drops the percentile
    procedure when a later sentence says the roll no longer happens.

49. **Only positively identified description is trimmed**
    (`_trimNonMechanicalSentences` / `_isPureFlavourSentence`). Deciding what to cut by
    looking for mechanics is backwards: "It always knows the direction to the branded
    creature" and "Its brand lasts until it dismisses it" carry no number, no tag and no
    modal, yet both are rules. Only appearance, DM narration and "Describe…" instructions
    are dropped, and never a sentence carrying a number, a tag, or duration, permission or
    obligation language. Roster lines are skipped entirely — splitting a semicolon
    delimited list into sentences silently truncates its tail.

50. **The text's own action economy beats the section it was filed into**
    (`_refileByStatedEconomy`). "As a Magic action" under Bonus Actions misleads a DM,
    so the lead sentence decides. "(no action required)" files as a trait, which is how
    Tikal's `Body of the Astral Self` — a passive that switches on when two other
    aspects are up — stops being a reaction. Only the *cost* counts: a leading
    subordinate clause is dropped first, because Charger's "When it uses its action to
    Dash, it can use a bonus action to…" names the trigger before the cost, and two
    economies left in one lead are treated as an ambiguity rather than a correction.

51. **An item entry earns its slot or loses it**
    (`_dropInertItemEntries`, `_dropDuplicateItemSpellStubs`, `_tidyEntryNames`). An
    item entry with no number, no tag and no mechanical verb is appearance text; an entry
    ending on the colon of a list it never got is a dead end; and "Fili can cast
    Protection from Evil and Good." adds nothing beside the entry that gives the action,
    duration and concentration exemption. Names are tidied too (`(1 charges)`, a trailing
    separator). The mechanical test reads the *raw* body: flattening tags to plain text
    erased the `{@spell}` that was Wisp's shield's only mechanic, and read it as inert.

52. **Grammar: coordinate verbs, already-inflected verbs, and leftover imperatives.**
    An adverb can sit between a conjunction and the verb it governs ("and already have"),
    the third-person rule must not re-inflect a verb that is already third person
    ("perceives" → "perceiveses"), "or die" takes a singular subject unless the sentence
    is about several creatures, and an instruction that only becomes an instruction after
    the subject is rewritten ("When it does so, choose…") is swept a second time at the
    end (`_fixImperativeVoice`).

53. **Multiattack names the attack that actually hits hardest**
    (`_getMultiattackAction`). A default Unarmed Strike is filler and never wins — but a
    monk's is not, so an unarmed strike that out-damages every weapon carried is chosen,
    which is how Tikal stopped opening with 1d6+5 Talons over a 1d10+5 Unarmed Strike.
    The same selection feeds the CR estimate.

### Subsystem passes (v11)

The v10 doctrine still governs. v11 adds one rule the corpus forced: **a subsystem gets
one compact home** — its rules are summarised once with the character's resolved values,
its individual options are listed where they are used with their cost on the name, and
nothing else about it appears.

54. **A minimum clause never blocks a resolved modifier** (`_resolveAbilityFormulas`).
    The "already annotated" lookahead matches the annotation *shape* we write, not any
    parenthesis, and a trailing minimum is merged rather than stacked —
    `its Charisma modifier (+5, min. 1)`, never `(+5) (minimum of one)`. Both
    `(minimum of one creature)` and the bare `(minimum one test)` are consumed.

55. **Never emit a tag that cannot hover** (`_formatSpellTag`, `_tagCapabilityTerms`).
    A source is resolved from the character's own spell list or the action vocabulary;
    if it cannot be, the term is emitted as plain text. Spell tagging is gated on
    membership in a real spell list, so a Title-Cased sentence fragment
    (`{@spell Attack Or}`) can no longer become a link.

56. **Build-time scaffolding is resolved, not just deleted** (`_dropScaffoldSentences`,
    `_resolveLevelProgressions`). Level labels go in all three forms (plain, italic-
    tagged, "Nth-level X feature"). "You get more later" progressions are collapsed to
    the tier the character has reached. Option menus for choices already made, flattened
    tables, and out-of-fiction table-variance negotiation are dropped. An entry whose
    every line is a colon-terminated promise with no mechanics is dropped entirely.

57. **Supersession and riders work across entries** (`_absorbOrphanRiderEntries`,
    `_dropSupersededQuantityClaims`). An improvement that names its base and states a
    replacement value updates the base and is dropped; a rider opening "In addition, …"
    is filed under its base entry's economy even from another section; a procedure
    negated by a later sentence in the same entry is removed.

58. **Uniform skill bonuses collapse to one line.** Jack of All Trades made two bards
    print 25 skill rows. Only genuinely per-skill deviations (proficiency, expertise, a
    specialty, an item, a homebrew skill bonus) reach `skill`; the uniform grant is
    stated once and attributed.

59. **Homebrew skills print as skills.** A `linguistics|TGTT` key is unpacked before it
    reaches `out.skill`, so no statblock shows a UID.

60. **Summoned aspects and forms are deltas** (`_consolidateShapeshiftEntries`). Aspect
    chains that gate on one another emit one entry: trigger, duration/exit, then a single
    "While active:" line of uniformly bolded, hoverable sub-benefits.

61. **Option rosters carry their cost on the name.** Metamagic, Cunning Strike effects,
    combat methods and psionic powers all print as one roster with `(2 Sorcery Points)`,
    `(2 dice)`, `(1 Strain)` on the option, never as a detached `Cost:` line. Where the
    system distinguishes Active from Passive (TGTT metamagic), the roster says which.

62. **Grouped defensive traits lead.** Features granting advantage against a condition or
    on a class of roll are ordered to the head of the trait block so a DM can find them
    in one place.

63. **Riders live on the attack.** Divine Strike, Radiant Strikes, Rage damage,
    Demolishing Might and Umbral Coating are written into every weapon attack line they
    modify — conditionally where they are conditional — instead of standing as separate
    traits or, worse, phantom weapon attacks.

### Level-20 and item fidelity (v12)

64. **Psionics is a first-class subsystem.** `modes[]` on a `psionicPower` feature is
    read for the effect text, the mode matching the power's order is chosen and
    "Increased Order" folds into a single upcast sentence. A compact `Psionics` trait
    states manifestation ability, power save DC, power attack bonus, manifestation die,
    strain maximum and orders known; the 28KB class-rules dump and its designer
    commentary are gone. Powers file by their stated Manifestation Time and a power that
    forces a save with no DC gets the power save DC (`_resolvePsionicPowerSaveDcs`) —
    scoped to real powers so item DCs on the same block are untouched.

65. **Level-scaled feature dice resolve from the sheet.** A level-20 rogue's Sneak Attack
    reads 10d6, not the book's 1d6.

66. **Item powers reach the block regardless of declared type.** Homebrew items typed as
    weapons (Arthur's Ioun Stones) still export their powers; every attuned or orbiting
    item reaches Special Equipment. Stones are grouped under one `Ioun Stones (stowed):`
    heading, and a stone that only raises a stat produces no trait at all.

67. **Item entries never restate the block** (`_dropItemEntriesRestatingDefenses`,
    `_isStatOnlyItemSnippet`). An entry whose every mechanical sentence merely repeats a
    resistance or immunity already printed is dropped — the "while wearing it" gate is
    stripped first, because the item *is* worn. Bare "as described above" cross-references
    and duplicate `— Spells` stubs (now matched on multi-word subjects) go with them.
    Passive item entries are refiled out of the action block.

68. **A spell is attributed only to a feature that grants it**
    (`_isSpuriousFeatureSpell`). A level 1+ unprepared spell whose granting feature's
    text never grants casting is dropped — Divine Sense merely *mentions* Hallow.
    Cantrips are exempt. `5e `-prefixed edition variants of a spell already in the same
    slot level are dropped (`_dropEditionVariantSpellTags`).

69. **CR sees non-weapon damage** (`_estimateOncePerTurnRiderDamage`,
    `_estimatePsionicDpr`). Once-per-turn Sneak Attack and base Divine Smite are added to
    DPR, and psionic damage enters as a discounted alternative. A level-20 rogue, talent
    and paladin no longer land three to eight CR below a level-17 barbarian.

70. **No paragraph is a wall** (`_splitOverlongParagraphs`). A single entry string over
    ~620 characters splits at the sentence boundary nearest its middle. Rosters, bullet
    lists and option menus are exempt — splitting them scatters the options.

71. **Period-delimited sub-headings are bolded and welded to their body**
    (`_boldInlineSubHeadings`). A source that marks a sub-benefit with a bare Title-Case
    sentence ("…120 feet. Wisdom of the Spirit. It has advantage on…") gets the same
    `{@b Label.}` treatment as a colon or heading form, and a label left at the end of a
    paragraph is moved to lead the paragraph it introduces. Detection requires the entry
    to show the shape twice, or to already carry a bold label — a lone capitalised
    fragment is far more likely to be prose.

72. **A trim never leaves a dangling back-reference** (`_restoreBackReferenceLead`). When
    dropping flavour would leave an entry opening on "To do so, …", the antecedent
    sentence is put back.

73. **Subject substitution never damages a word.** The conjugator carries an irregular
    map, guards adverbs, prepositions and past-tense verbs (`outright`, `within`, `lost`),
    and a doubled-word collapse catches the `Juen May may cast` shape that substitution
    creates. Padded thousands separators (`2, 000 pounds`) are repaired.

### Rollable numbers and honest filing (v13)

74. **Every die in the prose rolls** (`_tagBareDice`). A die written as plain text renders
    as inert prose; `{@damage}` / `{@dice}` render as click-to-roll links. Damage and
    healing dice take `{@damage}`, everything else `{@dice}`. Tagged regions are masked
    first, and a *die-cost* label (Cunning Strike's `(1d6)`, where the die is spent rather
    than rolled) is exempt. This was the single largest "easier to run" gap left: 42
    entries across 18 of 21 corpus characters.

75. **A class-level formula resolves to the level the exporter already knows.**
    `half its Wizard level (round up)` → `half its Wizard level (10)`;
    `equal to its level + its Charisma modifier` → `equal to 15`. A trailing
    `(maximum Nth level)` cap that the resolved value already clears is dropped — a
    statblock is a snapshot of one level, not a progression table.

76. **A resolved value is attached to the noun it measures.** `compound(…, {restate})`
    leads with the answer instead of appending it to the last operand:
    `its AC equals 18 (13 plus its Wisdom modifier)`, not
    `13 plus its Wisdom modifier (18)` — which stated, falsely, that the Wisdom modifier
    was +18. **Before adding a numeric pass, read the existing `compound(…)` rules**: an
    earlier attempt at this added a second summing pass and double-counted to AC 31.

77. **Filing follows the stated economy, everywhere in the body**
    (`_refileByStatedEconomy`, `_demoteEconomylessEntries`). The action branch excludes
    "take a **Bonus** Action" explicitly — without that guard, six item entries migrated
    from Bonus Actions into Actions. A feat- or item-derived entry that states no economy
    and carries no trigger is demoted to a trait. The pass is **gated** to `{@feat …}`
    names and `{@item …}`-opening bodies: class features and psionic disciplines carry
    authoritative economy in their metadata even when their prose never says so, and an
    ungated version wrongly demoted real psionic bonus actions.

78. **An item entry never opens by naming itself** (`_stripItemSelfEcho`). A leading
    `{@item Moonlit Aegis|…}: This magic shield glows softly under moonlight` loses both
    the echo and the appearance-only lead — and the tag is **promoted to the entry
    heading**, so the hover survives the trim.

79. **A stance body prints its mechanics or nothing** (`_condenseStanceBody`). The generic
    roster condenser kept the *first* sentences, which in stance prose is always flavour,
    so 6 of 13 corpus stances said nothing mechanical ("heightens its senses."). Sentence
    selection is now by mechanical content — a tag, a save, advantage/disadvantage, a
    resistance, a bonus, a distance or an extra die. The economy lead (stated three times
    over: cost group, roster suffix, body opener) and the universal duration trailer are
    stripped, the duration rule is stated **once** in a `{@b Stances.}` block header, and
    a body with nothing mechanical left emits no line at all — the roster already names
    the stance and the name is hoverable.

80. **Residual grammar is repaired after substitution, not before**
    (`_fixResidualGrammar`, run both inside `_tidyStatblockText` and as the late
    `_applyResidualGrammar` pass). Subject substitution runs after the early prose
    compaction, so the residue it creates needs a second look:
    - a coordinated verb after a finite `it <verb>s` is conjugated ("and **miss**" →
      "and **misses**"), refusing to fire when a modal or infinitive governs the span or
      when the coordinator sits inside an unclosed parenthetical — otherwise every
      "or **take** damage" infinitive is corrupted;
    - `rolls/attacks against it **has**` → `have` (matched through a closing `}`, since the
      plural noun is often the display text of an `{@action}` tag);
    - `it can use it to X` → `it can X` — the second `it` was the feature, not the NPC;
    - the doubled-word collapse is **name-aware**: `Juen May may cast` becomes
      `Juen May can cast`, not `Juen may cast`, which deleted the surname and turned the
      sentence into a modal;
    - capitalisation after `e.g.`; symmetric em-dash spacing.

81. **A duplicated defence clause and a dangling opener are dropped**
    (`_dropRestatedSleepImmunity`, `_dropDanglingConnectives`). Fey Ancestry stated its
    sleep immunity twice in one sentence; three entries opened on `In addition,` referring
    to nothing, having been split from the sentence they extended.

### v14 — one printing per spell, honest tags and a readable voice

82. **A spell is deduped by name within its level, not by `name|source`**
    (`_dedupeSpellsByName`). The same spell reaches the block by two routes — the class
    list and a subclass or feat grant — carrying two different printings, so
    `Fog Cloud|PHB` and `Fog Cloud|XPHB` both survived and the block printed the spell
    twice on one line. **8 of 24 corpus characters** were affected. The surviving printing
    is chosen by: matching the character's edition first, then carrying a grant
    annotation, then first-seen.

83. **A tag whose kind contradicts its referent is remapped or stripped**
    (`_sanitizeTagKinds`, inside `_enrichHoverTags`). `{@condition Dash}`,
    `{@condition hidden|XPHB}`, `{@action Bonus Action|XPHB}` and `{@action Reaction|XPHB}`
    all rendered as failed lookups. Actions mis-filed as conditions are remapped;
    everything else is demoted to plain text. **This must run inside `_enrichHoverTags`** —
    an earlier version ran mid-pipeline and deleted a whole trait.

84. **`{@spell}` is emitted only on an exact catalogue match**. A capitalisation heuristic
    invented `{@spell Magic of the}` and `{@spell Absorbed}` out of the Staff of Power's
    prose — two hovers to spells that do not exist.

85. **A scaling ladder collapses to the row that applies** (`_collapseScalingLadders`).
    The resolver used to substitute the character's value into the ladder's *condition*,
    producing "deal `1d6` … the damage increases to `2d6` when its proficiency bonus
    **(+5) is +3**" for a character whose actual damage is `4d6`. Progression text is
    player-facing; a statblock states the current row. Runs **after** `_tagBareDice` and
    **entry-wide**, not per line.

86. **Every defence from one conditional feature carries the gate**
    (`_propagateConditionalDefenceNotes`). Annotating only the first read as though the
    rest were unconditional: Nagara's Stormborn gated `cold` but not `lightning`, and
    dropped `thunder` entirely.

87. **A table stays a table** (`_preserveEntryTables`). Font of Magic was stringified down
    to its bare header row — the sorcery-point costs were simply **gone**, making the
    feature unusable — and Spellsword Technique lost its row boundaries
    ("Abjuration - Force damage Conjuration or Transmutation - a normal type").

88. **A stated die count becomes a roll** (`_resolveStatedDiceAndSpeeds`). "roll a number
    of **d8s** equal to its Wisdom modifier (5)" states the number but still makes the DM
    assemble the roll and offers no click-to-roll link → `{@damage 5d8}`. Derived speeds
    resolve the same way: "a Fly Speed equal to its Speed" → `fly 30 ft.`. Takes
    `calculations` so feature-derived counts (Rage Damage) resolve too.

89. **Coordination is conjugated across a list of any length**
    (`_conjugateCoordinatedListItems`, `_getClauseGovernor`, `_getAdverbAlternation`).
    Four independent causes, each of which alone defeated the pass:
    - `_getClauseGovernor` read a clause-final **adverb** as the governing verb;
    - `it does so` was classified as a **modal**, when it is a pro-verb standing in for a
      finite clause;
    - imperative subjects were supplied **last**, so once the final list item inflected,
      the coordination lookahead matched the earlier item and inflected it in place —
      permanently destroying the chance to supply "it";
    - the `-ly` adverb guard swallowed **`apply`**, in both `_conjugateThirdPerson` and the
      shared adverb-run regex; fixing either alone changed nothing.

90. **A subordinate clause supplies the subject its main clause dropped**
    (`_supplySubordinateClauseSubject`). Player-facing rules address the reader, so
    "If it hits, **add** the Superiority Die" becomes an order to the DM. Scanned comma by
    comma rather than by one regex — the first comma is often internal to the subordinate
    clause ("When it manifests this power, and as its action…, choose…"), and a single
    match consumes the sentence before reaching the real boundary. Three guards:
    - a **modal in the governing prefix** means the bare form is already correct
      ("it can expend a die, roll it, and regain…"); a modal further along the sentence
      governs a different clause and is ignored;
    - the sentence must refer to the NPC, or the clause must name it;
    - a **comma-separated noun list** looks identical to a bare imperative from the left —
      "acid, cold, fire, **force**, lightning" became "it forces" until the pass learned
      that a list item is followed by another separator, a verb by its object.

91. **Bare DCs and coordinated action lists are tagged** (`_tagCapabilityTerms`). Every
    `DC N` becomes `{@dc N}`. Two or more action names in a coordinated run are tagged
    even with no "action" noun present, which is how Cunning Action is written ("take a
    Bonus Action to Dash, Disengage, or Hide"); **a lone `Hide` or `Attack` is left alone**
    — in prose it is too often the ordinary English word. `surprised` is deliberately
    **not** tagged: it is neither a condition nor a variant rule in the data, so all nine
    corpus occurrences would have become broken hovers.

92. **The body uses the short name; the title carries the full one**
    (`_getNpcReferenceName`). Subject substitution repeated the surname up to 49 times in
    one block — ~2,500 characters corpus-wide, and unlike any published statblock.
    Honorifics are kept ("Sir Arthur Chase" → "Sir Arthur"). One knock-on: the longer name
    had been pushing an item-flavour sentence past the truncation limit, leaving a trailing
    `:` that a suppression rule caught — **an entry disappearing is not proof it was
    correctly suppressed**, and that entry now needs its own rule.

### v15 — information placement: a rider rides its attack

The block was accurate and compact by v14; what remained was that information sat in the
wrong place. Running one attack meant cross-referencing two or three traits. v15 routes a
rider onto the line it modifies — but a rider is not always a leaf, and that constraint
governs the whole group.

93. **A referenced feature keeps its antecedent** (`_buildFeatureReferenceGraph`,
    `_isReferencedAnchor`). Sneak Attack's 10d6 is a *currency*: `Cunning Strike` spends
    dice for effects, `Improved Cunning Strike` spends two, and `Assassinate` turns a
    round-1 Sneak Attack hit into a critical. Printing `plus 10d6` and retiring the trait
    would present a spendable pool as fixed damage *and* orphan three dependents. Features
    named by two or more *other* entries occur in **14 of 24 corpus characters** (Rage,
    Focus Points, Sorcery Points, Wild Shape, Crimson Rite, Superiority Dice, Bardic
    Inspiration, Channel Divinity, Psionics). The graph is built before any reduction runs,
    and **removal is available only to leaves**.

    Two traps the corpus taught: `Special Equipment` and `Multiattack` name every item by
    construction, so without `_STRUCTURAL_REFERRERS` every magic item became an
    unremovable anchor; and single-word anchors match inside other words ("Rage" inside
    "cou*rage*"), so only multi-word names or three whitelisted resource words may anchor,
    matched with `\b…\b` rather than `includes()`.

94. **A dice-valued rider reaches the attack line** (`_getConditionalDamageRiders`). The
    rider machine accepted only *numbers*, so every dice-valued rider missed it. Sneak
    Attack is now pushed from `calculations.sneakAttack.dice` as `named` but **not**
    `wholeFeature` — named on the line, retained as an anchor. It is scoped by
    `appliesTo: "finesseOrRanged"`, so Missy's Ninjato carries it and her Claws do not.

95. **A weapon's own rider lands on that weapon** (`_getItemDamageRiders`,
    `_getItemProseDamageRiders`). Item `damageRiders` and `conditionalBonuses` were never
    exported at all — Reggu's Sun Staff lost 1d8 fire, Mikase's Silver Dragon Katana lost
    1d4 cold, Dranan's Sun Blade lost its 1d8 against Undead. A second channel lifts on-hit
    damage that exists only in item prose (Elizabeth's Fang lost 1d6 cold entirely), gated
    hard: an *optional* or daily-limited rider is excluded (Lorian's staff Lightning would
    otherwise advertise free damage), and so is a replacement attack phrased as
    "When you take the Attack action…" (Mikase's Starlight Arc).

96. **A bonus-action-only rider never appears on the Attack action line.** Charger's
    `damage:charge` modifier was rendered as `plus {@damage 5} damage after Dash + bonus
    action attack` on Aldor's and Arthur's base weapon — a mangled fragment advertising a
    bonus the attack can never receive. A conditional damage modifier whose gate names a
    *different* action is now excluded; the feature states the bonus where it happens.

97. **A rider must shrink its source to the residue** (`_reduceRiderSourcesToResidue`,
    `_stripEmittedDamageClause`). Onger read `plus 1d8 against Constructs` on the line and
    then the whole sentence again three entries later. The strip is deliberately
    clause-scoped, never sentence-scoped: the sentence usually carries a second mechanic
    the line does not (here, double damage to objects), and that residue must survive.

    Residue runs **before** whole-feature retirement, and a surviving residue cancels it —
    but only if it still reads as a rule (`_isUsableRiderResidue`). Divine Strike is the
    counter-example: its whole sentence *is* the rider, so stripping it leaves
    *"…it can cause the target to."* A decapitated clause is discarded and the entry
    retired, which is how Lorian, Dranan and Mikase keep working.

98. **An `Additional Effects` bullet already inside a printed number is suppressed**
    (`_getBakedInModifierKeys`, `_PRINTED_NUMBER_FAMILIES`). The sheet registers a fighting
    style **twice** — unconditionally (which is what the printed number sums) and again as
    a gated twin. Wisp's War Pick printed `1d8+12` and then a bullet reading *"Dueling. +2
    to damage rolls…"*, inviting the DM to add it a second time. `_getConditionalDamageRiders`
    already applied this test; `_getNamedModifierTrait` never learned it. The same guard
    now drops any unconditional numeric bonus to a number the block already prints.

99. **A number whose only source is a conditional modifier is annotated, not silently
    inflated** (`_getAcEntries`, `_negateGateCondition`). Elizabeth, Mikase and Vern have
    *no* unconditional Dual Wielder twin: the +1 **is** in the printed AC, so AC 15 is true
    only while she is dual-wielding. The gate was load-bearing and lived in a bullet the DM
    could not connect to the AC. It now rides the number itself —
    `ac: [{15, from:["unarmored"]}, {14, condition:"when not dual wielding two melee weapons (Dual Wielder)"}]`.

100. **A boolean config column is rendered as prose** (`_formatProgressionCell`). Wild Shape
    ended `{@b Beast Shapes.} Known Forms 8, Max CR 3, Fly Speed Yes.` — the sheet's
    internal form-field labels printed verbatim, and `Fly Speed Yes` duplicated the sentence
    directly above it. Now `8 known forms, max CR 3.` One knock-on found by the corpus diff:
    lowercasing a label broke `_boldInlineOptionLabel`'s `(?=[A-Z"“{])` lookahead and
    silently unbolded Tignor's `Circle of the Moon Spells` heading, so `_collapseLevelTables`
    now emits the caption already bolded and list columns skip the rewrite.

101. **Subclass lore that states no mechanic is dropped** (`_dropMechaniclessLoreEntries`).
    Elizabeth carried `Bladesinger Styles` (2,375 chars) and `Bladesinging` (478) — elven
    school history and the largest block on her sheet. The predicate is deliberately a
    **ratio**, not an absolute: body ≥ 250 chars **and** ≤ 2 mechanical sentences **and**
    mechanical ratio < 0.25. An all-or-nothing "contains no mechanical sentence" test was
    tried first and flagged 16 corpus entries — Multiattack rows, `Resilience`, `Cold
    Empowerment`, `Demolishing Might` — all legitimate. `Bladesinger Styles` itself contains
    two false-positive "mechanical" sentences (a `{@skill Stealth}` hover and "which can keep
    many foes at bay", a modal buried in flavour), which is precisely why an absolute test
    cannot work. The ratio form matches those two entries corpus-wide and nothing else.

102. **A form block splits into an activation and an alternate-form trait**
    (`_splitFormBlocksIntoAlternateForm`). Dzeiy's `Hybrid Transformation` was a 2,531-char
    bonus action describing a different creature — AC, resistances, an attack, regeneration
    and a save — which is unusable mid-combat. It is now a 284-char activation plus a
    `Hybrid Form` trait (2,188) holding the deltas. The pass requires ≥ 4 string-only lines,
    a connector line matching `^(?:while (?:it is |you are )?(?:transformed|in this form)|in
    this form)…[:.]?$` that is neither first nor last, and ≥ 2 `{@b Label.}` paragraphs after
    it. Dzeiy is the only corpus match; Mikase's Angelic Avatar deliberately does not qualify.

103. **A maneuver states only what distinguishes it** (`_consolidateManeuverEntries`). The
    roster lead already says *"a maneuver that hits adds the die to that attack's damage
    roll"*, then Riposte closed with the same sentence and Trip Attack carried it
    mid-sentence. Riposte's is deleted; Trip Attack's is joined to the trigger the following
    clause depends on (`…using a weapon or an Unarmed Strike, if the target is Large or
    smaller, …`) rather than cut, because cutting it would orphan the save. Note the strip
    runs while bodies are still imperative (`add`, not `it adds`), so both forms are matched.

104. **The spell block names the trait that alters spells**
    (`_linkSpellModifiersFromSpellcasting`). Nessa's Metamagic roster sat among the traits
    with nothing connecting it to the spells it modifies. The class block's header now ends
    with a pointer; the **innate** block is excluded, because Metamagic applies to class
    spellcasting and an innate list is a different feature with a different ability.

105. **An Attack-action rider is folded onto its own attack line**
    (`_foldAttackActionTrailers`). Reggu's Radiant Sun Bolt spent 150 characters restating the
    Attack action to say one thing, and did it in a paragraph *beneath* the line. It now ends
    the line itself: `… 1d10+5 radiant damage. As part of the Attack action, 1 Focus Point:
    make this attack twice as a Bonus Action.` The rewrite only fires when both the cost and
    the repeat count parse out of the sentence — a half-parsed cost is worse than a long one.

106. **A replacement attack becomes a real attack entry** (`_promoteReplacementAttacks`).
    Mikase's Starlight Arc was 754 characters of trait describing *an attack* — a cone, a
    shared attack roll, an extra die — while the to-hit and base damage it uses sat in a
    different entry. It is now `Starlight Arc (Replaces One Attack)` carrying the parent
    weapon's own line with the target clause swapped for the area and the power's die
    appended, plus the two facts a line cannot hold (one roll for every target; illusions
    end). 754 → ~300 characters. Fires only when the parent attack, the area **and** the
    extra damage all parse: a synthesised attack line that guesses any of the three is worse
    than the paragraph it replaces.

107. **A toggle that changes an attack is written on that attack**
    (`_annotateToggledAttackRiders`). Reggu's Eldritch Maul gave every melee attack 15-foot
    reach and 1d6 force for a minute, and said so only inside a Bonus Action — nobody reading
    `Talons` would consult it. Each melee line now ends `While Eldritch Maul is active, reach
    15 ft. and plus {@damage 1d6} force damage.`, the ranged line is untouched, and the
    source shrinks to its activation. Requires the extra damage to parse; a reach change
    alone stays in prose, because reach without a number is not something a line can state.

108. **A count upgrade is applied at the anchor** (`_foldCountUpgradesIntoBase`). This is
    A0.3 in its simplest form. `_foldImprovedEntriesIntoBase` refuses `Improved Cunning
    Strike` because it is not an *addition* to the base feature but an *edit* to the base
    feature's own count, so the block said "add one of the following" and contradicted itself
    an entry later. The count is now applied where it is stated (`add up to two of the
    following`) and the dependent, which had nothing else to say, is dropped. Only fires when
    the improvement's whole body is the count claim.

### v16 — numbers on the numbers, subsystems in one place

v15 moved riders onto their attacks. v16 finishes the same doctrine on the two surfaces it
did not reach: **a number or a roll leaves the trait list for the line it modifies**, and
**a subsystem spread over several entries reads as one entry at its final form**.

109. **2014 base weapons inherit the 2024 mastery** (`_getBaseWeaponRecord`,
    `_getInheritedMasteryFromBaseItem`). Most magic weapons in the corpus carry
    `mastery: []` and a `baseItem` pointing at a 2014 item, so Aldor's greatsword printed no
    Graze and Wisp's war pick no Sap. The base item is now resolved by name against the XPHB
    base-item list and its mastery read from there — gated on the character actually having
    Weapon Mastery, because printing a mastery for a wizard's dagger would be a new bug, not
    a fix.

110. **Mastery names are hoverable in prose** (`_tagCapabilityTerms`). "replace that property
    with the Push, Sap, or Slow property" was plain text in four exports; the eight mastery
    names are now `{@itemMastery Name|XPHB}` wherever they appear, not only in the `Mastery:`
    suffix on an attack.

111. **A derived value prints the character's number** (`_getNamedModifierValues`,
    `_resolveAbilityFormulas`). Dzeiy said "twice its Hemocraft modifier (minimum of 2)" —
    a formula the DM has to evaluate mid-turn. The computed number is substituted and the
    now-vacuous minimum dropped. Fails closed: a modifier that cannot be read from state
    leaves the phrase exactly as written, because a wrong number is worse than a formula.

112. **A dependent feature folds into its anchor at final form**
    (`_foldNamedDependentsIntoAnchor`, widened `_foldImprovedEntriesIntoBase`). Brand of
    Tethering only edits Brand of Castigation; Improved Shadowcasting only edits
    Shadowcasting. The continuation test now scans any body line rather than only the first,
    since the name already proves the entry is a rider.

113. **The aura family is one emanation entry** (`_mergeAuraEntries`). Three Aura traits all
    described the same 10-foot emanation. They now read as
    `Auras (10-ft. Emanation)`, each immunity keeping the aura that grants it in parentheses.

114. **Blood Maledict rosters its curses** (`_rosterBloodCurses`). The entry opened with the
    generic "It knows one blood curse of its choice" while the curse it actually knows sat
    three entries away — the same defect the Combat Method and Maneuver rosters already fixed.

115. **An ASI-and-spells-only feat gets no entry** (`_dropSpellOnlyFeatEntries`). Shadow
    Touched's whole mechanical content is two spells, so the trait is dropped and the spells
    attributed inside the spell block. Telekinetic is deliberately not caught: it also grants
    a real bonus-action shove.

116. **A paragraph is split at a buried label** (`_splitAtInlineBoldLabels`). Improved
    Shadowcasting welded `{@b Eyes of the Dark.}` onto the end of the previous paragraph.
    The split only fires after a completed sentence and never on a bullet line, where it
    would leave a bare `•`.

117. **Every standing roll modifier is consolidated into one pinned trait**
    (`_mergeResilienceTraits`, `_getStandingDefenseClause`,
    `_extractStandingDefenseResidue`). This is the widest-blast-radius pass in v16: 37
    entries across the corpus were wholly an advantage or disadvantage claim, and
    `Dauntless Heritage` alone stood as its own trait on eight characters. The threshold
    dropped from two candidates to one, the matcher widened to checks and Initiative, and a
    trait that *mixes* a roll claim with a real mechanic is **split, not swallowed** — the
    clause merges and the remainder stays as a shorter trait. The pass runs twice, the second
    time deliberately late, because some claims are still in first person or still carry a
    level preamble when the first pass runs.

118. **A save bonus the sheet applies silently is named**
    (`_explainSaveBonusesOnResilience`). `getSaveMod` folds in features the sheet's own
    breakdown never lists — Dark Augmentation is the corpus case — so the printed save
    exceeded anything the block explained and read as an arithmetic error. The difference is
    now stated where every other roll modifier lives. Skipped when an aura already states the
    same number, and printed without a source rather than credited to a guess when the
    feature cannot be identified.

119. **Mac Lir's on-hit power rides the sword** (`_foldItemPowerTraitsOntoAttack`). A trait
    describing what happens when he hits with the sword now ends the sword's own line, using
    the same weapon-scoped rider path v15 built for Leviathan's Bite.

120. **Carried poisons are equipment with numbers** (`_POISON_FACTS`,
    `_getCarriedPoisonEntries`). Poisons are ordinary `type: "gear"` items, so the magic-item
    gate in `_getSpecialEquipmentBlock` filtered every one of them out. They now emit as a
    `Poisons:` bullet with hoverable item tags, quantities, the save DC and the damage. An
    unrecognised poison is named without invented numbers.

121. **A form's deltas are folded onto the lines that carry them**
    (`_foldFormTraitOntoLines`, `_placeFormUnit`, `_mintFormUnarmedStrike`). A transformation
    is not a trait; it is a second set of numbers. The user rejected a second statblock
    ("tedious moving between two"), so Dzeiy's Hybrid Form is decomposed: the AC bonus
    becomes a second `ac` line conditioned on the form, the resistance joins `resist` tagged
    `while in Hybrid Form`, Predatory Strikes becomes a real `Unarmed Strike (Hybrid Form)`
    action, and the advantage claim joins the roll-modifier trait. What is left is only what
    a stat line cannot hold — Bloodlust's save-or-charge. A clause is split to sentences (and
    a sentence welding an advantage claim onto an unrelated bonus is split again) so placing
    one claim never silently discards another; anything the pass cannot confidently place
    stays in the trait.

122. **A rogue is rated for its defence and its burst** (`_getEvasiveDefenseMultiplier`,
    `_estimateBurstDamageCredit`). A level-20 rogue rated CR 10 against a level-17 barbarian's
    CR 16, because the model was blind to Uncanny Dodge, Evasion and Elusive defensively and
    to Assassinate, Death Strike and Cunning Strike offensively. The multipliers sit
    deliberately below the physical-resistance fold, each covering a narrower slice of
    incoming damage. The acceptance test was that **no non-rogue moves**: Juen went 11 → 15
    and Missy 7 → 9, and nothing else changed.

### v17 — the modifier is on the roll it modifies

v16 emptied the trait list of standing numbers. v17 closes the last four places where a
modifier still sat away from the roll it changes, and where a conversion a DM makes mid-turn
was written as prose instead of as an attack.

123. **A trigger rider folds into the feature that triggers it** (`_foldNamedDependentsIntoAnchor`
    `TRIGGERS` branch, `_getTriggerRiderLines`). Tactical Shift fires *"whenever it activates
    its Second Wind"* — that is not a sibling ability, it is part of Second Wind. The rider
    keeps its name (a DM still has to be able to say which feature is doing this) and its own
    uses (`{@b Uncanny Metabolism (1/LR).}` — dropping the suffix orphaned the pool), and loses
    only the exact self-reference its new position already states. A trigger rider is the one
    fold allowed to cross sections, because a trait is the only shape that cannot be a turn's
    worth of action in its own right. The generalisation reached Sear Undead → Turn Undead,
    Mote of Potential → Bardic Inspiration and Empowered Strikes → Unarmed Strike unprompted.
124. **A situational to-hit bonus is written onto the roll** (`_foldSituationalAttackBonuses`,
    `_attackLineMatchesScope`). High Ground's +2 with ranged attacks was three entries away
    from the only ranged attack on the block. The alternative is now stated already added up —
    `{@hit +6} to hit (+8 when standing 5 feet or more above an enemy)` — and a second
    conditional joins the same parenthetical rather than opening a rival one. Two rules keep it
    honest: a gate too long for a line (Hammer and Anvil's 148 characters) is referenced by
    name and **keeps its trait**, and the trait is dropped only when every attack *in scope*
    was annotated — Duralin has High Ground and no ranged attack, so his trait survives.
125. **The coated weapon is its own attack** (`_mintCoatedWeaponAttacks`,
    `_findWeaponCoatingClause`, `_getCoatingUnlockedFeatureNames`, `_dropCoatingCrossReferences`).
    Umbral Coating turns a carried sword into a shadow weapon, unlocking Shadow Sneak and
    Shadowbite on it — written as a paragraph inside Shadowcasting, that is a conversion the DM
    has to reconstruct. The converted weapon is now minted beside its base, carrying the thrown
    range and naming what the conversion unlocks, and the paragraph and the *"can instead
    convert…"* cross-reference are retired. Only riders that fire **off a hit** count as
    unlocked; Shadowcasting's own bonus-action attack merely mentions a shadow weapon.
126. **Two riders of the same kind state one number** (`_coalesceDamageRiders`,
    `_isUniversalRiderCondition`). Mikase stacks a Paladin-11 Radiant Strikes die and the
    Starfire Katana's own, and the line read *"plus 1d8 radiant damage (Radiant Strikes), plus
    1d8 radiant damage"*. They merge on damage type, die size and **gate**, where "on every
    melee weapon hit" and no condition at all are recognised as the same gate on a melee
    weapon's own line. A weapon's self-named rider carries a `mergeLabel` so it can still be
    attributed once merged, even though it is deliberately anonymous when it stands alone.
127. **A standing defence has exactly one home** (`_extractStandingDefenseResidue` returning an
    array, `_getDefenseClauseSignature`, inverted-shape fallback in `_getStandingDefenseClause`).
    Talna's Master Smith's Aegis printed its own trait *and* appeared inside Resilience. The
    residue extractor now takes a **leading run** of qualifying sentences rather than one, the
    inverted shape (*"Spell attack rolls against it have Disadvantage"*, which never names the
    NPC as subject) is recognised, and signatures canonicalise `damage from Xs` → `X damage` so
    "Resistance to damage from spells" and "resistance to spell damage" dedupe.

**What v17 taught.**

- **A parenthetical list cannot hold a name that ends in a parenthetical.** `(Shadow Sneak
  (1/SR), Shadowbite)` reads as unbalanced to the renderer. Any label lifted into a list has
  its own uses suffix stripped first.
- **"Every attack" and "every attack in scope" are different acceptance tests.** Counting
  out-of-scope attacks as failures kept every scoped trait alive; counting only in-scope
  failures is what lets High Ground retire on Arthur and survive on Duralin.
- **A rider's gate can be phrased two ways and mean one thing.** Merging on the literal
  condition string left Mikase's two radiant dice apart; a rider whose condition is true of
  every line it is printed on states nothing, and must normalise to no condition at all.


### v18 — a Talent reads like the book's own Talents

Every prior version invented its own answer. v18 did not have to: *The Talent and Psionics*
ships **27 author-written psionic statblocks** — seven disciplines at Talent (CR 4) / Expert
(CR 8) / Master (CR 12), plus six named psions from CR 7 to CR 29 — and they agree with each
other on every question we were about to guess at. **None of them invents a psionics
subsystem.** All 27 route their powers through an ordinary `spellcasting` block plus about
six real entries.

Measured against that, Phirse (Chronopath Talent 20) had 24 of his 27 powers written out as
full entries, 16 of them actions, with no roster, no use limits, no order, no concentration
and no hoverable tags.

128. **The strain economy converts to `N/Day`** (`_getPsionicUsesPerDay`, `_getPsionicBand`).
    Manifesting an `n`th-order power rolls the manifestation die `dD`: above `n` costs
    nothing, equal costs 1, below costs `n`, so one manifestation costs
    `E[strain] = (n·(n−1) + 1) / D`. The day's budget is **not** the strain maximum —
    strain bites per track and 5 in a track is −5 AC or Disadvantage on saves, so spending
    to the maximum cripples the character long before reaching it. One track's worth
    (`strainMaximum / 3`) is what reproduces the book's numbers. Fails closed: an
    unreadable die or strain maximum yields no limit rather than a fabricated one.
129. **Utility powers become a `Powers` roster** (`_getPsionicPowersBlock`,
    `_getRosteredPsionicPowers`, `_isSignaturePsionicPower`). A power earns a real entry
    when it *resolves in combat* — an attack roll, a saving throw or damage. Everything
    else is a `{@psionic}` line in a spellcasting block whose header is the book's own
    sentence with our numbers substituted. This is what takes 24 entries down to the
    book's range.
130. **The name states the whole economy** (`_getPsionicEntryName`,
    `_psionicPowerConcentrates`). `Intuition (3/Day; 2nd-Order Power; Concentration)` — uses,
    order and concentration, exactly as all 27 statblocks write them. Order is always
    stated; the use figure only when the power is not at-will, matching
    `Psionic Bolt (1st-Order Power)`.
131. **Upcast prose resolves to the character's ceiling** (`_compressPsionicUpcast`). Two
    paragraphs of *"it can increase its order by 1 or more. For each increase of 1, the
    damage increases by 2d10"* become `{@b Increased Order.} At 6th order: {@damage 6d10}
    more damage.` — the v16 A2 doctrine finally applied to powers. Damage, extra targets
    and area growth are each resolved; a shape we cannot read keeps its original prose, and
    a power with no headroom drops the paragraph entirely.
132. **Range and duration stop trailing as fragments.** `Duration Instantaneous` is the
    absence of a duration and is dropped; concentration already lives in the name, so
    `Duration Concentration, 1 minute` never prints twice; standalone measurements become
    `ft.` while `30-foot line` keeps house style.
133. **The power attack bonus is written where the roll is called for.** *"can make a ranged
    power attack with the object"* becomes *"a ranged power attack ({@hit 8})"*.
134. **The `Psionic Powers` trait stops repeating the header** (`_hasPsionicRoster`). Ability
    and save DC moved into the `Powers` header, so the trait keeps only what is the
    character's own — manifestation die, strain maximum, highest order known. A manifester
    with no roster has no such header, so the facts stay put.
135. **CR sees a manifester's actual offence** (`_estimatePsionicDpr`). The function read
    `feature.description`, which for a power holds **only its Range and Manifestation Time
    headers** — so it found no dice at all and rated a level 20 Talent purely on a stray
    calculation key. It now reads the primary mode's body (never the upcast mode, which
    would over-credit) and follows DMG practice in rating an area effect against two
    targets. Phirse moved CR 9 → 11, beside the book's Master tier, with better HP.

**What v18 taught.**

- **Look for the published answer before designing one.** Every rule above reproduces a
  choice 27 shipped statblocks visibly made, which is why it can be checked against
  something other than taste.
- **Calibration has a ceiling, and reaching it is the result.** Snapping to the book's three
  bands matched **140/181 = 77%** of its own roster assignments, and order-1 → at-will
  matched **28/28**. The residual is unmodellable: the same power at the same order is filed
  `3/Day` in one statblock and `1/Day` in another. Tuning past 77% would be fitting noise.
- **A continuous model produces numbers no author would write.** Before snapping to bands the
  conversion emitted 8/Day, 6/Day and 2/Day — values that appear nowhere in the book. The
  bands are the format, not a rounding convenience.
- **Reading the wrong field is invisible when the right field is optional.** `description`
  exists on every feature, so `_estimatePsionicDpr` never threw; it just silently valued a
  psion's entire arsenal at zero. A parser that finds nothing should be as suspicious as one
  that throws.
- **`\w+haves` matches "behaves".** A conjugation guard that had been green for seventeen
  versions failed the moment a power containing that word entered the corpus. Bad-word
  checks need whole-word anchors, not a leading `\w+`.


### v19 — every roster line states its own action economy

Borrowed from MCDM's statblocks: a raised letter after a name, saying when you may use it.
A spell list is the one place a statblock prints dozens of options with no economy attached,
so a DM reading *Misty Step* on a list has to know, or look up, that it is a Bonus Action.

**Pass 136 — `_getEconomyMark`.** Every saved spell already carried `castingTime`
(`"1 action"`, `"1 bonus"`, `"10 minute"`), and the exporter had never once read it. The
mark is built from that string and nothing else:

| casting time | mark | renders | hover |
|---|---|---|---|
| `1 action` | `{@sup {@tip A\|Action}}` | ᴬ | Action |
| `1 bonus` | `{@sup {@tip B\|Bonus Action}}` | ᴮ | Bonus Action |
| `1 reaction` | `{@sup {@tip R\|Reaction}}` | ᴿ | Reaction |
| `1 minute` / `10 minute` / `1 hour` | `{@sup {@tip 10min\|Takes 10 Minutes}}` | ¹⁰ᵐⁱⁿ | Takes 10 Minutes |
| unreadable or absent | *(none)* | | — |

`{@sup}` recursively renders its contents, so nesting `{@tip}` inside it makes the mark
**name itself on hover**. That is what lets the notation ship without a legend, which is
the usual reason superscript conventions fail outside a printed book.

**Long times print the time, not a letter.** An `E`-for-else glyph would have covered 35 of
the corpus's 88 non-action spells and collapsed "1 minute" and "24 hours" into one shape,
forcing a hover to learn anything — and hovers do not exist on a tablet. `Ceremony ¹ʰʳ` is
lossless and readable without hovering, consistent with the project's rule that a derived
value prints its number rather than its formula. The glyph carries no space (`10min`, not
`10 min`) so a superscript can never wrap mid-mark.

**Every readable time is marked, including plain actions**, which buys an invariant worth
~250 extra ᴬ glyphs: *an unmarked roster line means the exporter could not read a casting
time.* Two of 487 corpus spell rows have an empty `castingTime`; they are now visible
instead of indistinguishable from the other 395.

**Pass 137 — one mark, four rosters.** Spell lines go through `_formatSpellTag`, the single
choke point that also appends provenance. Psionic roster lines read `meta.actionType`
through `parsePsionicPower`. Combat-method and maneuver rosters replace the 138
`(Action)` / `(Bonus Action)` / `(Reaction)` parentheticals they already printed.

A **psionic entry name** filed under Bonus Actions or Reactions gets **no** mark — the
section heading already says it, and the same fact twice is the defect this exporter has
been removing since v8. The invariant survives because a heading is not a silent default.
An entry with a long manifestation time *is* marked, because it lands under Actions where
nothing else states the time.

A label with no glyph — `Stance`, `Replaces One Attack`, `Triggered`, `Free Action` — keeps
its parenthetical rather than being dropped. `_getEconomyMark` returns `""` for anything it
cannot read, and a `""` never silently means "action".

**Pass 138 — the mark is presentation, never identity.** Adding markup between a tag and
its trailing parenthetical broke a pass that had been correct for eleven versions:
`_dropSpellOnlyFeatEntries` detects provenance with `\{@spell …\}\s*\(`, so the
interposed mark made `granted` empty and Nessa's ASI-and-spells-only *Shadow Touched* feat
reappeared as its own trait. The fix is general, not local:

- `ECONOMY_MARK_RE_SRC` — one shared regex source, so any pass that parses a tag
  positionally can skip the mark instead of being blocked by it.
- `_stripEconomyMarks` is applied at the head of `_normalizeFeatureKey` and
  `_getAnchorBareName`, the two functions that turn a name into a key. Without it
  `Stasis Field{@sup {@tip 10min|…}}` normalises to `stasis field sup tip 10min takes 10
  minutes` and matches nothing.

**Ordering is load-bearing.** The mark binds tightest to the name, *inside* any provenance
parenthetical — `{@spell shield|XPHB}ᴿ (Oath Spells)`. `_pickPreferredSpellTag` treats a
trailing `)` as "this tag carries provenance"; a mark placed after the paren would spoof
that tiebreak silently. A test pins the order.

**Markdown recovers the fact rather than degrading.** `RendererMarkdown` had no `@sup`
case, so a mark fell through to `Renderer.stripTags` and became a mute `B`. It now prints
the hover title — `*Misty Step* (Bonus Action)` — for a `{@sup {@tip …}}` specifically,
leaving the footnote-wrapping `{@sup}` uses in `data/` untouched.

**Lessons**

- **A convention that needs a legend is a convention that will not be read.** Nesting
  `{@tip}` inside `{@sup}` was the whole feasibility question; without the hover this would
  have needed a key line in every statblock, and would not have been worth doing.
- **The published answer does not always scale down.** The bestiary promotes a non-action
  spell to a real entry named `Shield (1st-Level Spell; 3/Day)` — but only 41 times in the
  entire corpus, one to three per monster. Talna has 21 non-action spells; promoting them
  reproduces exactly the defect v18 had just removed from powers. *Mark in place, do not
  promote.*
- **Inserting markup mid-string is an interface change.** Every pass that reads
  "parenthetical directly after a tag" is a caller of that interface. One shared regex
  source and one stripper are cheaper than auditing each site again next version.
- **A/B the whole corpus, not the changed lines.** Converting all 24 characters twice — with
  the mark on and off — and diffing everything *except* the marks found the `Shadow Touched`
  regression in one run, and proved no CR moved.

### v20 — a sheet-authored item ships with the statblock that names it

The exporter tags gear as `{@item Name|SOURCE}`. That is the right shape, and for the 143
core-book tags in the corpus it resolves perfectly. But when the item is one the character
sheet *authored*, there is nothing on the receiving end to resolve **to**:

```
Juen  →  • {@item Hecate's Dagger|CUSTOM} (attuned)      ← dead hover
         Hecate's Dagger. Melee Attack Roll: +11 …       ← dead
         Hecate's Dagger — Spells. …                     ← dead
```

Three references to an item the reader cannot look up. The export has always been a
homebrew document — `{_meta, monster: [...]}` — and homebrew documents carry `item: [...]`
perfectly well. We simply never populated it.

**What ships and what does not.** Only items the sheet authored (`_isCustom`, or the legacy
`source: "custom"`). Third-party brew — `|GRIFFONSSADDLEBAG3`, `|MECIOUNSTONES`,
`|THELEMAR`, 50+ tags across the corpus — stays a *reference*. It has a real home, and
copying it into our payload would launder somebody else's content. Instead
`getExternalItemSources` names the brews a reader needs, and that goes in the new
informational `notes` bucket.

**The bundle is derived from the finished monster, not from the inventory.**
`buildCompanionItems(monster, state)` harvests `{@item Name|OURSOURCE}` out of the converted
statblock and intersects that with the custom inventory. This is the whole reason the
feature can be trusted: an item is bundled *precisely when a tag names it*, so an unequipped
custom item is not shipped, and a tag can never point at a missing entity. Neither a dead
link nor an orphan payload is representable. A corpus-wide test asserts the set equality in
both directions.

**Re-sourced to the NPC's own source.** `{@item Hecate's Dagger|CSHEET}`. One declared
source, a self-contained payload, and — by construction — no way to shadow a catalog item.
`_getItemTag` is the single choke point for all six tag sites, so this was one edit.

**The sanitizer is the whole risk surface.** The sheet's item shape is far from the schema:
Juen's dagger carries 68 properties, of which **17** survive. The schema is
`additionalProperties: false`, so shipping the raw object was never an option.

- **Whitelist**, `ITEM_SCHEMA_PROPS` — the schema's 111 legal names, pinned by a test that
  reads `node_modules/5etools-utils/schema/site/items.json` and fails on a set difference in
  either direction. A schema bump tells you which property appeared or vanished.
- **Renames run first and win over the incumbent.** `requiresAttunement → reqAttune`,
  `properties → property`, `damage → dmg1` — and the landmine: the sheet stores
  `type: "weapon"`, which is **not a legal item type code**, while the real code sits in
  `typeCode: "M"`. Whitelisting alone would have shipped an invalid `type` past a green
  test run. A rename whose *source* name is schema-legal would silently move real data, so a
  test asserts all four sources are sheet-only spellings.
- **Prune the sheet's exhaustive record** — nulls, empty containers, `bonus*: 0`, `value: 0`.
  The sheet writes every bonus slot present and zeroed; carrying that through would bury the
  handful of properties that say something about the item.
- **Default the three required fields** — `name`, `rarity` (`"none"`), `source`.

Legal as-is, pleasingly: `property: ["F","L","T"]` (bare codes validate), `mastery:
["Nick|XPHB"]`, `baseItem: "dagger|PHB"`, and the object form of `attachedSpells`.

**The preview has to prove it, too.** The payload was right the moment the sanitizer
landed — but the dialog renders the monster before any of it has been saved anywhere, so
the bundled item existed only as a JS object the dialog was holding. `{@item Hecate's
Dagger|CSHEET}` therefore rendered a link whose hover resolved against an empty cache and
**silently showed nothing**. The item was in the download and dead on screen, which reads
to a user as "the fix doesn't work".

`_registerCompanionItemHovers` seeds `DataLoader` directly:

```js
DataLoader._pCache_addToCache({allDataMerged: {item: forCache}, propAllowlist: new Set(["item"])});
```

That is the same mechanism the sheet already uses for Ar8 variant-component items and for
its loaded class/subclass/optfeature entities (`charactersheet.js`), so it is a house
pattern rather than a new one. It is synchronous — no first-hover race — and it keys on
`source` plus the item hash builder, exactly what the rendered link queries.

Two details that are load-bearing:

- **It reruns whenever the monster does.** The export source is part of an item's hash, and
  the user can change the source from this very dialog, so registration sits inside
  `rebuildCompanionItems()` rather than happening once.
- **The cached entity is a *copy*.** `_pCache_addEntityToCache` wants a `__prop`, which the
  item schema forbids; caching the payload object itself would quietly invalidate the
  download. A test asserts the payload keeps exactly its schema keys.

Failure is non-fatal by design: no `DataLoader` (jest, or a future headless caller) is a
silent no-op, and a throwing cache warns and moves on. Only the preview hover is at stake —
never the payload.

**What v20 taught.**

- **A whitelist is safe; a rename is not.** Dropping an unknown property is correct by
  construction. Moving a value into a new name is a *transform*, and `typeCode → type` is
  the one that would have shipped invalid data silently. Renames get dedicated tests;
  whitelisting gets one.
- **`_stripHtmlTags` collapses `\s+`.** Correct for statblock prose, destructive for item
  prose — an 800-character magic item arrived as one unbroken wall. `\n` means nothing to
  the renderer either; **one array element per paragraph** is both the idiomatic 5etools
  shape and the only one that actually renders as paragraphs. Caught by reading the output,
  not by a test.
- **A warning ~everybody trips is a warning nobody reads.** Download and Save both toast
  "validation issues" the moment `warnings` is non-empty, and ~20 of 24 characters reference
  external brew. Routing the dependency notice through `warnings` would have trained users
  to dismiss the toast. Hence a third `notes` bucket: rendered in the dialog, never toasted.
- **Derive the manifest from the artefact.** Bundling from inventory would have been the
  obvious implementation and would have drifted the first time a statblock stopped naming
  something. Harvesting from the finished monster makes drift unrepresentable.
- **TDZ is a real hazard in this file.** `getCompanionItems` had to move above
  `renderValidation`, because `pApplySourceConfig()` runs — and validates — before the
  button handlers below it are ever defined.

### v21 — the damage number on the line is the damage number on the sheet

The user reported one weapon: Arthur's Cataclysm exported `2d8+4` where the sheet
showed `+13`. The attack roll was right, so only the damage flat was wrong. Pulling on
it surfaced **two independent defects that pushed in opposite directions**, which is
why no earlier read-through caught them — a spot-check of any single weapon could
plausibly look correct.

**Defect 1 — a die-only helper handed a whole formula.**
`CharacterSheetUpgrades.increaseDamageDie(damageDie, steps)` matches `/(\d+)d(\d+)/`
and returns `` `${numDice}d${newSize}` `` **and nothing else**. Its parameter is named
`damageDie`; its doc comment reads `"1d6" -> "1d8"`; the sheet's two callers both hand it
a bare die. The exporter handed it `derived.damage` — a full formula — so `"2d6+15"` came
back as `"2d8"` and the flat bonus, the damage type and any rider clause were silently
dropped. **The exporter was the sole misuse, so the fix belongs in the exporter**: extract
the bare die with `/^\s*(\d+d\d+)/`, step that, and compose the flat separately.

**Defect 2 — the exporter and the sheet used two different formulas.**
The exporter derived weapon rows from `state.updateAttackFromWeapon()`, a helper whose
**only production caller is the exporter** — everything else that references it is a test.
It composes damage as `weaponDie + abilityMod + customModifiers.damageBonus`, and
`customModifiers.damageBonus` is dead legacy save data: its writer `setCustomModifier` has
zero callers in `js/`, and nothing else reads it. It is nevertheless present in **10 of the
24 corpus saves** with values from 1 to 7, so those characters exported an inflated number.
Meanwhile the helper knows nothing about the named `"damage"` modifiers (Dueling's +2) and
weapon-scoped item bonuses (Bracers of Archery) the sheet *does* show — so other characters
exported a number that was too low.

The sheet's canonical formula, used identically by combat, play mode and the sheet header,
is `abilityMod + getWeaponDisplayDamageBreakdown(attack).total`. The exporter now builds an
attack object shaped exactly like the combat tab's `autoAttack` — crucially `sourceItem`,
**not** the exporter's own `_sourceItem`, because `_attackMatchesWeaponBaseItems` reads
`sourceItem` — and folds the breakdown itself.

**It folds `base + feature + item` and deliberately *not* `state` / `rage` / `hybrid`.**
Those are situational, and v15's rider system already prints them as conditional clauses on
the same line (`plus 2 damage while raging`). Folding `.total` would both hide the condition
and double-count against the rider. This is the single most important line in the change and
it has its own test.

Both branches of `_getMergedAttacks` were fixed. The second (auto-generated weapon rows) had
both defects; the first (rows already on the sheet, matched to an active weapon by name) was
still reading raw `eff.bonusWeapon + eff.bonusWeaponDamage` where the second had moved to
`eff.totalAttackBonus` / `eff.totalDamageBonus`, so an upgraded weapon exported different
numbers depending on whether the sheet happened to carry a hand-added row of the same name.
No corpus character exercises that branch today, which is exactly why it had drifted.

**Corpus effect — 11 weapons across 9 characters moved, and all 28 now agree with the
sheet exactly:**

| character | weapon | was | now | why |
|---|---|---|---|---|
| Arthur | Cataclysm | `2d8+4` | `2d8+13` | die-step wiped the flat |
| Aldor | Phoenix Rocket Sword | +14 | +7 | phantom custom +7 |
| Dranan | Sun Blade | +11 | +9 | custom out, feature +2 in |
| Duralin | Retaliator, Sword of Mac Lir | +16 | +13 | custom out, feature in |
| Dzeiy | Reaper's Scream | +9 | +8 | phantom custom +1 |
| Elizabeth | Fang of the Whale Eater / Riptide Katana | +7 / +5 | +6 / +4 | phantom custom +1 |
| Mikase | Silver Dragon Katana | +9 | +10 | feature bonus recovered |
| Missy | Ninjato | +7 | +8 | feature bonus recovered |
| Onger | Gae Bolg | +14 | +13 | phantom custom +1 |
| Vern | Scimitar of Speed / Defender Rapier | +9 / +10 | +7 / +8 | phantom custom +2 |
| Wisp | +2 War Pick | +12 | +9 | custom out, feature in |

Aldor's and Vern's CR each drop by one as a consequence, which is the correct downstream
effect of no longer over-reporting their damage per round.

**What v21 taught.**

- **A helper's contract lives in its parameter name, not in what it tolerates.**
  `increaseDamageDie` accepted a formula without complaint and returned something
  plausible-looking. Nothing failed loudly; a `+15` just evaporated. When a helper's
  input is narrower than what it will silently accept, the caller has to narrow it.
- **A legacy helper with exactly one production caller is a fork in the road, not a
  shared path.** `updateAttackFromWeapon` looked like the sheet's own weapon logic and
  was in fact the exporter's private copy, drifting from the real one for as long as
  both existed. Before deriving a number, check who else derives it — and prefer the
  function the UI actually renders from.
- **Two bugs pushing opposite ways hide each other.** Nine characters were too high and
  one was too low, so "the export damage looks about right" held up under casual review
  for many passes. Measuring the whole corpus against the sheet's own formula — rather
  than eyeballing diffs — was what made the shape of it visible.
- **Correct-by-construction beats correct-today.** The verification that matters is not
  "Arthur is now 13" but "for all 28 equipped weapons in the corpus, exported flat ==
  `abilityMod + base + feature + item`, and the situational component is zero." That
  probe is what proved the rider exclusion was safe.

### v22 — a material is part of the weapon, so it belongs on the attack

Two reported bugs, one root cause: **materials and upgrades are stored as references and
resolved at read time**, and the exporter read the stored item.

**Bug #1 — the statblock had no material awareness at all.** Not one mention of
`material`, `getMaterialEffects` or `_materialEffects`. A DM running Mikase never learned
that her Starfire Katana counts as magical, crits on 19, and lands on a miss by 5 or less
even against magical AC.

**Bug #2 — the bundled companion item shipped *base* stats.** `buildCompanionItems` read
`state.getInventory()` — the raw list — so the hover added in v20 showed a measurably
weaker item than the statblock was built from:

| item | as worn | as bundled (pre-v22) |
|---|---|---|
| Mikase's Angelic Plate | AC 21 | AC 18 |
| Arthur's Cataclysm | `2d10`, crit 19 | `2d6`, crit 20 |
| Mikase's Starfire Katana | crit 19 | crit 20 |

**Where each effect now lives.** One home each, per the standing doctrine — *state the
number, link the term, say the mechanic once*, and anything that changes a roll goes **on
the attack**, never into a trait the reader has to cross-reference:

| effect | home | read from |
|---|---|---|
| `countsAsMagical` / `countsAsSilvered` | attack qualifier | `getEffectiveItemBonuses().tags` |
| `penetration` (+ `penetrationIgnoresMagicalAc`) | attack line, as a near-miss clause | `getMaterialEffects` |
| crit threshold (material + upgrade, combined **once**) | attack line | projected item ∪ `getEffectiveItemBonuses` |
| `overrideDamageType` | attack damage clause, as an *option* | `getMaterialDamageTypeChoice` |
| `extraDamageDiceVsType`, `bonusCritDamage` | v15 rider system | `getMaterialEffects` |
| `saveAdvantage` / `checkAdvantage` | folded into `Resilience`, attributed | `getEquippedMaterialEffects` |
| `damageReduction`, `indestructible`, `perceptionPenaltyToNotice` | `Armor Traits` | `getItemMaterialNotes` |
| `grantedActions`, condensate affinities | action / bonus / reaction | `getItemPowers({activeOnly})` |
| `speedDelta`, `bonusInitiative` | `speed`, `initiative` | already folded into `getSpeed()` / `getInitiativeBonuses()` |
| everything narrative | bundled item `entries` | `getMaterialNotes` |

**Penetration is an AC mechanic, not a resistance one.** *On a miss, if the attack missed
by N or less, it still hits* — i.e. it resolves against AC reduced by N, against
**nonmagical** AC unless `penetrationIgnoresMagicalAc` (Orichaline) is set. The in-app
glossary at `charactersheet-materials.js:1892` says it "ignores that much of a target's
non-magical damage resistance", which is wrong; that one string is where an earlier
design error in this very feature came from. The wording is now pinned by a test that
also asserts the wrong phrasing is absent.

**`requiresProperty` is a gate, not a footnote.** Stout Blackwood's bonus crit die is real
only on a Loading weapon. It is emitted or not; it is never emitted with a caveat.

**Bake, then describe.** The bundled item carries baked numbers and **no** `material` /
`appliedUpgrades` reference. `additionalProperties: false` forbids them, and a reference is
inert on a receiving instance with no material engine — so shipping one would either fail
validation or silently double-apply. Provenance survives as prose:

```
{@b Material:} Orichaline. Penetration 5: a miss by 5 or less still hits, even against
magical AC. Counts as magical for overcoming resistance and immunity. Magic capacity 3 (0 used).
{@b Upgrades:} Balanced: +1 attack.
```

The statblock and the bundled item both state penetration and crit. That is **not** the
"Master Smith's Aegis appears twice" defect, which was two *statblock traits* saying one
thing: the bundled item is a separate artifact that must not degrade, and a DM only sees it
on hover. Within the statblock, each effect still has exactly one home.

**Multiattack now scores the rendered attack, not the stored row.** Composing upgrades
stepped Mikase's Silver Dragon Katana to `1d10` and Multiattack promptly named it over the
Starfire Katana — because `_estimateDamageScore` reads only the weapon's own die and could
not see Starfire's `+2d8` radiant. `_estimateRenderedAttackScore` sums every `{@damage}`
clause on the finished line instead, excluding once-per-turn riders (a 1/turn rider fires
on whichever attack lands first, so it cannot distinguish between them). This also fixed a
pre-existing defect: a monk's Unarmed Strike row stores the bare die with no ability
modifier, so Tikal's `1d10+5` fist scored `5.5` and lost to a `1d6+5` spear.

**What v22 taught.**

- **An accessor that returns an empty result for a missing argument is a silent failure.**
  `getMaterialEffects(item)` does not resolve the material — called with one argument it
  returns a fully-populated *empty* shape rather than throwing, so a forgotten
  `resolveMaterial` is indistinguishable from a material with no effects. It cost more
  time than every real bug in this pass combined.
- **A regex that consumes its trailing context eats the next match.**
  `/\{@damage ([^}]+)\}([^.]*)/g` swallowed the second damage clause on every line and
  scored only the first. A lookahead reads context without consuming it.
- **"Nothing reads this" and "this is deliberately a table call" look identical in code.**
  The sibling session's `EFFECT_HANDLING` registry is the fix: every effect type declares
  its consumer, and an exporter test now fails when a type has no home here either.
- **A composition bug is a count of derivations.** The bundled item was one of 21 sites
  independently re-deriving a weapon's total. The fix was not to add a 22nd but to read
  `getEffectiveItemBonuses` / `getEffectiveWeaponDamage` like everything else.

### v23 — the rider says what it does, and says it once

The sibling session's `9dbdc5b9` landed the sheet-side material combat riders and, in doing
so, pinned down three semantics this exporter had been guessing at. Each claim was checked
against the authored brew data rather than taken on trust; three were real defects here.

**All three were latent.** No character in the 24-save corpus carries Cold Iron,
Yellowwood, Stout Blackwood or Crossbow Expert, so the regenerated corpus moved **zero**
characters. Nothing in this section would have been caught by looking at output — which is
the whole argument for the tests that now pin it.

**One extra weapon die is one die.** `_getExtraWeaponDice` multiplied the authored count by
the weapon's *die count*, so Cold Iron's "an additional weapon damage die" paid a maul
twice: `2d6` instead of `1d6`. The sheet's `_getSingleWeaponDie`
(`charactersheet-combat.js`) is the authority and is explicit — *a maul rolling `2d6` adds
`d6`, NOT another `2d6`.* On 1-die weapons the old arithmetic was already right (`1 x 1`),
which is exactly why it shipped, and why the v22 test that covered a longsword passed
throughout.

**A die granted by a crit is not doubled by that crit.** The rule doubles *the attack's*
damage dice; a die the crit itself grants is not among them, Brutal Critical is the
precedent, and the sheet does not double it. The old line — *"On a critical hit it deals an
extra `1d4` damage"* — read both ways, and a statblock has nobody to ask. It now says
`(this extra damage is not doubled)`.

The `requiresProperty` gate on that rider is load-bearing and stays: `getMaterialEffects`
applies the gate only inside its `grantsAction` case, **never** for `bonusCritDamage`, so
without the exporter's own check a stout blackwood *club* would advertise a crit die it
never had.

**"No disadvantage in melee" is an attack-line fact.** The sheet declares
`noRangedDisadvantageInMelee` `reference` and never applies it, for a sound reason: it has
no positional model, so it can never impose the disadvantage the effect suppresses. A
statblock reader knows exactly where the creature is standing, which makes this export the
one consumer entitled to state it mechanically. It now appears as a ranged-attack
qualifier.

Two sources feed one sentence — Yellowwood grants it on a bow, Crossbow Expert grants it to
the character — because a reader should not have to care which. The provenance rides in the
parenthetical.

This is *not* the "Master Smith's Aegis appears twice" defect. The flag has always lived in
`_MATERIAL_NOTE_FLAGS`, which is read only on the path to `_applyComposedItemStats` — the
**bundled item**, seen on hover. The statblock never carried it. Adding the attack qualifier
produces the intended split rather than a duplicate, which is the division the v22
de-duplication decision already settled.

**What v23 taught.**

- **A registered modifier is not a delivered modifier.** The plan was to read
  `getModifiersForType("ranged:noDisdvantageInMelee")`. Measured: a character holding
  Crossbow Expert aggregates **nothing** for that type — the effect is registered and never
  reaches `namedModifiers`. The exporter reads `FeatureEffectRegistry` instead, which keys
  on the same authored data and therefore picks up *any* feature that grants the effect
  rather than hardcoding the one that does today. A test pins the discrepancy so the day it
  is wired up is visible.
- **A bug that cannot move the corpus still needs a test.** Every defect in this pass was
  invisible to the 24-character regression corpus. "The output did not change" is evidence
  about the corpus, not about the code.
- **Verify a guard RED before trusting it.** Each of the three fixes was reverted and the
  suite re-run: exactly four tests failed and the four guards describing unchanged
  behaviour stayed green. A guard that has never failed has not been tested.
- **A test can be correct and still not catch the bug.** The v22 rider test used a
  one-die weapon, where the wrong arithmetic gives the right answer. Choosing the fixture
  that can distinguish the hypotheses is most of the work.

### v24 — a material-granted reaction reaches the Reactions section

`getItemPowers()` publishes an authored `actionType` on every material-granted action. The
exporter ignored it and scanned the power's prose instead.

That scan is *structurally* unable to find the answer. Every economy-bearing note in the brew
states its **trigger** and never its **cost**:

> Tideglass Slip — "When an attack hits you, move 5 feet without provoking Opportunity Attacks."

There is no "as a reaction" in that sentence, because `actionType: "reaction"` is sitting
right next to it in the data. So the scan returned `null` for all five economy-bearing
powers and every one of them filed itself as a **trait** — the one section a player does not
re-read mid-combat. A reaction nobody finds is a reaction the NPC does not have.

`_getMaterialPowerSection` now prefers the authored value and keeps the prose scan as the
fallback, using the same `{bonus, reaction, action, attack → action}` map that
`_getFeatureActivationSection` already uses for features.

**The sheet's `isReferenceOnly` is deliberately not consulted.** It means "the sheet cannot
resolve this from a button" — Yellowwood's Flurry rides on the Attack action, so no button
can express it. A statblock reader has no such limit: they can read "you can use a bonus
action to attack again" and simply do it. An economy the *sheet* had to decline is still an
economy *here*, which is exactly what the prose fallback preserves — and why the two
consumers of this data correctly disagree.

`"special"` is the accessor's filler for "the brew declared nothing", not an authored value,
so it defers to the prose. That keeps Stout Blackwood's shove a trait and keeps a condensate
affinity suppressible, which is what stops Emberglass restating the damage-type option
already printed on the attack line.

**What v24 taught.**

- **Prefer authored data to inference, and know which is which.** The prose scan was not
  merely weaker than the authored field; it was answering a different question. The note
  says *when*, the field says *what it costs*.
- **A sibling subsystem's "no" can be scoped to that subsystem.** `isReferenceOnly` is a true
  statement about a character sheet and a false one about a statblock. Reading another
  module's flag means inheriting its constraints, so check whether they are yours.
- **Measure the claim, not the claimant.** Of the accessor notes received this pass, the
  condensate-affinity coverage and the `damageReduction` accessor were both reported with the
  wrong status — in opposite directions. Both were settled in minutes by a probe.
- **Probe ordering is part of the measurement.** `getNamedModifiersByType("damageReduction")`
  returns `[]` when the material catalog is set *after* `loadFromJson` and the real value when
  set before. An earlier "it does not fire" finding here was an artifact of that, not a defect.

### v25 — the drawback rides with the benefit

Aldor's attack line advertised a benefit and hid its off-switch:

> Can deal fire damage instead of its normal type (Emberglass)

The condition that removes it — cold damage or immersion in water — appeared **nowhere in the
export**. Not in a trait, not on the item, not in a note. The suppression text lives on the
bundled item, and only *custom* items are bundled; Aldor's sword is a catalog item, so the
prose path never ran for him at all.

That is worse than saying nothing, because a DM does not know what they were not told. They
read the half they were given and apply it unconditionally, and the material's whole design —
a strong option with a real vulnerability — silently becomes a strictly-better weapon.

Two clauses now ride on the attack itself:

| helper | emits | when |
|---|---|---|
| `_getInstabilityBackfireClause` | `On a natural 1, it takes {@damage 1d4} acid damage (Vitriol Crystal)` | the material's instability is a structured `attackRoll` / `selfDamage` spec |
| `_getAffinitySuppressionClause` | `(Emberglass; cold damage or immersion in water suppresses its affinity…)` | the instability text says the affinity can be **suppressed**, and the condensate is active |

Both are deliberately narrow. Most instabilities are table calls about the *item* — Gravesalt
dissolving in fresh water is not a combat fact — and printing all eighteen on the attack line
would bury the two that matter. A fumble is a consequence of *this attack roll*; a suppression
qualifies a benefit *this line just promised*. Both are in the reader's eye at the moment they
apply, which is the v22 doctrine applied to a drawback instead of a bonus.

Magmaheart's instability fires when the NPC **takes** cold damage. That has nothing to do with
the attack being made, so it is excluded — the trigger check is `attackRoll`-only.

**What v25 taught.**

- **A statblock that advertises a benefit must state its off-switch in the same breath.** The
  reader cannot ask. Splitting a conditional across two sections is, for them, identical to
  omitting the condition.
- **A category-level guard can pass vacuously.** The routing test asserted every
  `EFFECT_HANDLING` *consumer* had a home. `condensateInstability` is declared
  `consumer: "power"`, so it satisfied that check while reaching no power channel whatsoever.
  A guard keyed on the category cannot see a hole inside it. The test now names the exporter
  mechanism **per type** for the `power` consumer, which also turns the deliberate divergence
  (an instability belongs on the attack line, not in the action economy) into a stated
  decision rather than an omission that happens to look like one.
- **A shared normaliser will edit your punctuation.** The clause first shipped as
  `Emberglass. Cold damage…` — a separate pass rewrites `"; "` before a capital into `". "`,
  ending the parenthetical mid-sentence. Lower-casing the clause both sidesteps the rule and
  reads correctly, since it *is* a continuation. Weakening the shared normaliser to protect
  one caller would have been the worse trade.

### v26 — armour tier is read across both vocabularies

The sheet describes armour two ways. A catalogue plate is `type: "HA"` with no `armorType`;
an item-builder plate is `type: "armor"` with `armorType: "heavy"`. The exporter read only
`armorType`, so **every catalogue suit resolved to `""`** — and the tier gate treated "I could
not tell" as "it applies".

Measured, before the fix:

| item | printed | correct |
|---|---|---|
| catalogue heavy (`HA`) | reduce by 3 | reduce by 3 ✓ |
| catalogue medium (`MA`) | reduce by **3** | reduce by 2 |
| catalogue light (`LA`) | reduce by **3** | *nothing — Adamantine grants light armour no DR* |
| Adamantine **longsword** | *both* "(heavy)" and "(medium)" notes | neither |
| item-builder armour | correct | correct ✓ |

A catalogue plate also kept the `(heavy)` **and** `(medium)` notes at once, so one statblock
told the DM to reduce damage by 3 and by 2 in the same block.

Two separate causes, both fixed:

- **One vocabulary read.** Now resolved through `_getArmorCategory`, which delegates to the
  sheet's public `CharacterSheetState.getArmorCategory` and keeps a matching local fallback for
  headless paths. A test asserts the two agree on eight shapes so they cannot drift.
- **`|| fx.damageReduction[0]`.** When no tier matched, the clause fell back to the *first*
  authored entry. Adamantine authors heavy-3 first, so light armour was handed a reduction the
  material never grants. The fallback is gone: no match now prints nothing.

`_isMaterialNoteApplicable` is also strict about an unknown tier, which is what stops an
adamantine sword carrying armour prose.

**What v26 taught.**

- **Two vocabularies for one concept will be read as one.** The sibling session hit the exact
  mirror of this on the sheet side — their gate read only `type`, so every *custom-built* plate
  silently lost its DR while catalogue armour worked. Same root cause, opposite survivor. Each
  bug looked correct to whoever tested the half they happened to have.
- **A corpus proves what it contains.** All 24 characters use item-builder armour, which is the
  half that worked, so regenerating them moved **nothing** — before or after. This defect was
  unreachable by the corpus and was found only because someone described its mirror image.
- **An accidentally-correct case hides a bug better than a broken one.** Under the fault,
  catalogue *heavy* armour still printed 3, because the fallback entry happened to be the heavy
  one. The most-tested case was the one the bug could not touch.

#### v26b — the double-count is now guarded, not merely avoided

`applyToItem` bakes attack, damage, AC, dice and ranges **into** the item `getItems()` returns.
`getEffectiveItemBonuses` publishes overlapping totals for the same effects. Read both
additively and every bonus pays twice.

The exporter has always branched rather than summed:

```js
if (eff) { magicAttackBonus = eff.totalAttackBonus || 0; }
else     { magicAttackBonus = (item.bonusWeapon || 0) + (item.bonusWeaponAttack || 0); }
```

That is correct and was entirely **invisible** — nothing failed if someone changed the `else`
to a `+`. Five tests now pin it: a +1 sword is `+7` not `+8`, the bonus scales linearly so a
doubling cannot hide inside a small number, and the branch's *premise* is stated outright
(`eff.totalAttackBonus` already contains the item's own enhancement).

The fifth guards a real future hazard. `damageDieIncrease` is read from the accessor and
applied on top of the **projected** die, which is safe only while no material steps dice during
projection — Mithril's ladder moves properties (`2H → V`), not dice. If a material ever gains a
die step, that die would be raised twice; the test fails the moment one is authored.

This is the exporter's half of a rule the materials session arrived at from the other side:
every field a projection writes needs its inverse handled somewhere. They needed a
*de-projection* (a missing one compounded a thrown range 20 → 40 → 60 across builder round
trips); the exporter needs a *non-addition*. Same invariant, two directions.

#### v26c — damage reduction has exactly one home

The sheet publishes a material's damage reduction through **two** independent channels:

| channel | shape |
|---|---|
| `getItemMaterialNotes(itemId)` | authored prose — *"...reduce incoming damage by 3"* |
| `getNamedModifiersByType("damageReduction")` | structured — `{name: "Adamantine (damage reduction)", value: 3}` |

For most of this task the structured channel returned `[]` for every character, so "only one
channel prints" was true **by accident**. It began firing once the sheet fixed its armour-tier
gate, which is the moment a latent double-report becomes a real one.

The exporter reads `getMaterialEffects` and never the modifier channel, so the count stayed at
one — but nothing failed if that changed. Four guards now pin it, including a vacuity guard that
asserts *both* channels are live, because counting to one proves nothing if one channel is quiet.

**The guard corrected its own premise.** I believed the authored/derived `if`/`else` in
`_getMaterialNoteClauses` was what held the count at one, and RED-verified by making it additive
— the count stayed at **1**. The real protection is `_getArmorTraitBlock`'s dedupe on the
lowercased description. Pinning the mechanism that looked responsible would have guarded nothing.

That dedupe had a bug of its own: it **rendered** descriptions with terminal punctuation stripped
but **keyed** on the unstripped string, so *"...by 3"* and *"...by 3."* counted as two different
notes. Two channels punctuating one sentence differently would each print. Fixed by keying on the
same form that is rendered.

Its limitation is now stated in a test rather than assumed: the dedupe collapses an *identical*
description, **not a paraphrase**. If a second channel ever renders its own wording for a number
that is already stated, the dedupe cannot save it — which is why "one derivation, one surface"
has to hold at the source.

Corpus movement: **0 of 24**. Only 2 characters carry armour notes at all, so this area is thinly
covered; the evidence is a direct scan of every save for punctuation-differing note pairs, not the
regen diff.

### v27 — a material that resolved to nothing is said out loud

A material is stored on an item as a `{name, source}` **reference**; the entity lives in the
catalog. `resolveMaterial` returns `null` both for a reference it cannot satisfy **and** for an
item that simply has no material — "absent" and "empty" wearing the same face. Every effect then
evaporates and nothing anywhere says so.

The exporter already warned about this, but only for **bundled** items: the check sat inside the
bundling loop, behind an `_isCompanionItem` gate *and* behind a `!tagged.size` early return. So a
catalogue item — or any item the statblock never tagged — lost its material in silence.

That is the **third** time a material code path has reached custom items only (cf. v25, where
suppression text reached bundled items and Aldor's catalogue sword advertised a benefit whose
off-switch appeared nowhere). The pattern is worth naming: *a helper written while looking at the
bundle will be scoped to the bundle.*

`_collectUnresolvedMaterialWarnings` now runs over the whole inventory, on both paths. The two
causes are worded differently because their fixes are opposite:

| condition | message | why |
|---|---|---|
| catalog empty | *"The material catalog was not loaded, so no material effect reached this export (N referenced: …)"* | one problem with one fix; repeating it per item buries the action |
| name unmatched in a populated catalog | *"X" is not among the N known materials, so its effects are absent from Y* | one problem **per reference** — each needs its own correction |

**Partition, not duplication.** The pre-existing bundled-item warning says something extra and
true ("the bundled item ships with base stats"), so it keeps its items; this pass takes the rest.
The skip set records what was **actually reported**, not what was merely visited — `seen` is
populated *before* sanitizing, so skipping on it would leave an item that failed to sanitize
described by neither pass.

Corpus: **0 of 45** characters produce a warning — every material resolves. That is the intended
result; this is a net for a broken state, not a finding about healthy data.

## Validation
`getValidationIssues(monster)` is sync and structural (name/source/size/type/AC/HP/abilities/spellcasting shape/legendary fields). It returns **three** buckets:

| bucket | blocks Save? | toasts? | for |
|---|---|---|---|
| `errors` | yes | yes | structurally invalid output |
| `warnings` | no | yes | something a reader will notice is wrong |
| `notes` | no | **no** | informational — bundled item count, external brew dependencies |

`notes` exists because both Download and Save toast "validation issues" whenever `warnings`
is non-empty, and the external-brew notice fires for ~20 of 24 characters. A warning
everybody sees is a warning nobody reads.

Full browser-side monster schema validation is still out of scope (graceful hand validator only).

## Consumers

- Preview: `Renderer.monster.getCompactRenderedString`
- Homebrew manager paste / download / save
- `activateWildShapeFromBestiary` / `addCompanionFromBestiary` (must remain consumable)

## Testing

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest CharacterSheetNpcExporter --no-coverage --forceExit
```

- Unit/regression: `CharacterSheetNpcExporter.test.js` (prose rewrite, tag preserve/enrich, defense fold-in, feature dedupe, residual modifiers)
- Class + systems matrix: `CharacterSheetNpcExporter.matrix.test.js` — all 13 PHB/TCE/XPHB classes L5, multiclass, combat methods, specialties, divine favor, ioun/items, channel divinity, gemstones, custom abilities, resources, combined legendary boss
- Materials & upgrades: `CharacterSheetNpcExporter.materials.test.js` — attack-line
  routing (penetration wording, magical-AC reach, crit threshold, damage-type *option*,
  rider die scaling, the `requiresProperty` gate), advantage folding into `Resilience`,
  material-power economy inference, bundle composition, and three **routing-completeness**
  guards driven by `CharacterSheetMaterials.EFFECT_HANDLING` — a new effect type with no
  exporter home fails the suite rather than silently vanishing. The v23 block adds the
  latent cases the corpus cannot reach: one-extra-die arithmetic on a *multi-die* weapon,
  the not-doubled crit clause, and the no-disadvantage-in-melee qualifier from both a
  material and a feat — plus a pin on the fact that the feat's registered modifier never
  materialises, which is why the registry is read instead.
- **Real-save contract tests**: `CharacterSheetNpcExporter.realsaves.test.js` runs the
  exporter against complete character saves in `npc-exports/` and asserts the contracts
  that synthetic fixtures never caught (no serialized JSON, no `p`/`s`/`b` damage codes,
  no display-text-hijacked `{@spell}` links, source-free core condition tags, no second
  person, correct conjugation, no `Class Resources` fallback, uses on names, no duplicate
  abilities, annotated conditional defenses, real AC sources, consistent weapon to-hit,
  plausible CR). Those saves are **personal character data and intentionally untracked** —
  the suite `describe.skip`s itself when they are absent, so CI stays green.

  The corpus is **21** characters chosen to cover the surfaces that break the exporter.
  The original eleven:
  **Onger** (barbarian, combat methods, ioun stones), **Duralin** (fighter/shadow knight,
  item powers, multi-benefit feats), **Talna** (dual-form caster), **Dauk** (barbarian/bard
  multiclass), **Dranan** (paladin auras and smites), **Lorian** (cleric channel divinity,
  divine favor), **Tignor** (barbarian/druid, wild shape), **Dzeiy** (blood hunter /
  Order of the Lycan — hemocraft dice, blood curses, hybrid form), **Reggu** (monk /
  Way of the Sun Soul — Focus Points, feature-granted attacks, edition-mixed text),
  **Vern** (battle master — `optionalfeatureProgression` maneuvers), **Wisp** (champion
  plus a feywild item stack).

  Added in v11: **Aldor** (artificer-style launch progressions and flanking guidance),
  **Boti** (bard/College of Creation — Jack of All Trades, animated items), **Fili**
  (cleric — divine strike supersession, rod powers), **Nessa** (sorcerer — TGTT
  metamagic Active/Passive), **Tikal** (monk/Way of the Astral Self — aspect chains).

  Added in v12, all level 20: **Arthur** (fighter/Meteor Knight — satellites, a nine-stone
  Ioun bank), **Juen** (rogue/Assassin — Cunning Strike menu, level-20 Sneak Attack),
  **Mikase** (paladin/Oath of the Crown — feature-granted senses, damage riders),
  **Octavius** (wizard/Sangromancer — a 60-spell spellbook, staff powers), **Phirse**
  (Talent/Chronopath — psionics, a class family with no spellcasting at all). A separate
  `v7 regressions` describe encodes one contract per defect class: token-subset name
  matching, class-derived caster DC, best-damage multiattack, schema-legal defense
  vocabulary, third-person coordination, collapsed level tables, balanced delimiters,
  no spell-pool restatement, standing benefits filed outside their activation section,
  and subjects supplied for imperative rules text.

  A nested `v9` describe adds the contracts that the four newer builds surfaced:

  - **Nothing the target does becomes the NPC's own defence.** "The creature is immune to
    this curse if it is immune to the blinded condition" is a *target* clause; it must
    never stamp `conditionImmune` on the block.
  - **No active state the character has not unlocked.** State-name matching is
    one-directional — every token of the *state's* name must appear in the *feature's*
    name, never the reverse, or a level-13 Champion inherits a level-18 resistance.
  - **Feature-derived attacks carry the ability modifier.** A raw `getAttacks()` row stores
    the bare die and lets the sheet add the modifier at roll time; the attack line and the
    CR estimate both have to add it back.
  - **Every scaling die and class level is resolved** (hemocraft, Martial Arts, Superiority,
    Bardic Inspiration, Sneak Attack, Psionic Energy) — either inline or once in the roster
    header that governs the clauses beneath it.
  - **Every save the NPC forces on another creature states a DC**, and no save the NPC
    *makes* is given one.
  - **Maneuvers print as one roster**, not one trait each, the same shape Combat Methods use.
  - **No build guidance, level preamble, item-object rules, or internal field names** reach
    the block.
  - **No gendered pronoun, second-person pronoun, doubled word, mid-sentence truncation,
    unbalanced paren, unbraced `@tag` or lower-case `{@spell}` name** anywhere. Official
    feature *titles* ("Know Your Enemy") are copied verbatim and are the one allowed
    exception to the second-person scan.
  - **One resource is named once.** A 2024 monk's pool is Focus Points even where the
    subclass text still says "ki".
  - **A pool with no home block is named after itself** ("Focus Points (13/Short Rest)"),
    never dumped into a generic `Class Resources` row.

  Note on **saves**: the block may print *more* than the sheet's displayed effective value
  when an always-on aura applies (a Paladin's Aura of Protection is not in
  `getSaveBreakdown`), but never less, and any excess must be explained by a trait on the
  block.

### Manual checklist

1. Martial PC → Multiattack, clean weapon lines, no `ft..`, armor name in AC `from`
2. Wizard with named DC mod + innate → DC matches sheet; innate block present
3. Warlock → Pact Magic slots + cantrips
4. Active defenses + Rage on → resists only in active mode
5. Legendary toggle → legendary section in compact preview
6. Copy JSON / Download / Save to Homebrew (overwrite & copy)
7. Manual feature picker shrinks preview when fluff deselected
8. Monk keeps Unarmed Strike; armed fighter hides default unarmed (auto)
9. Divine Favor god + favour tier → innate spells on NPC
10. Orbiting Ioun stones listed under Special Equipment with `orbiting`
11. TGTT combat methods + stamina → Combat Methods trait
12. Class resources: orphan pools under Class Resources; Second Wind / Rage uses on ability names `(N/LR)`
13. Feats (Polearm Master, Sentinel) as real bonus/reaction lines
14. Magic item named entries (Gae Bolg style) as traits/bonus actions
15. Rage resists annotated `while raging` on the resist block; rage/stance condition
    immunities annotated the same way rather than printed as permanent
16. Prose reads name-first then pronouns (“Duralin can push itself…, it can take…”),
    with no `you`, no `Starting at level N`, and no duplicated punctuation
17. Level Signal absent unless “Level signal” or “Show CR breakdown” is ticked
18. Level-20 caster/rogue/talent → CR sits within a couple of steps of an equivalent
    martial; Sneak Attack and psionic damage visibly move it
19. Talent → one compact `Psionics` trait, powers filed by Manifestation Time with strain
    on the name, and every forced save carries the power save DC
20. Ioun stone bank → one grouped Special Equipment heading; stat-only stones produce no
    trait; no entry restates a resistance already on the block
21. No single entry paragraph runs past ~620 characters unless it is a roster
22. No bare die anywhere in the prose — every `NdX` is `{@dice}` or `{@damage}` and rolls
    from the rendered block
23. No unresolved `half its <class> level (round up)` / `equal to its level`; a resolved
    sum leads its phrase rather than trailing the last operand
24. Combat Methods states the stance duration once in a `{@b Stances.}` header; every
    stance expansion carries mechanics or is absent entirely
25. A purely passive feat sits under traits, never under Reactions; an item entry does not
    open by naming itself

## Known limitations (post-upgrade)

- CR is advisory (DMG-inspired tables + level anchor), not a full monster redesign. It
  now accounts for spell-slot-scaled caster damage, spell attack bonus, once-per-turn
  riders (Sneak Attack, base Divine Smite), psionic damage, and conditional resistances
  (Rage/stance) as effective HP — but it is still a heuristic. Non-martial level-20
  builds remain the least certain end of it.
- **Some player choices are not stored by the sheet and therefore cannot be named.**
  Signature Spells and Spell Mastery keep no marker on the chosen spells, and
  `{@feat Resilient}` stores `choices.ability === null`. The export drops the imperative
  "Choose two level 3 spells…" scaffolding rather than inventing a pick, so those
  features read as a capability with no named selection.
- Homebrew classes that flatten a rules table into a `description` HTML blob are handled
  case by case (psionics has a purpose-built compact home). A general size cap is not
  applied, because it would trim legitimate content.
- No automatic lair actions / regional effects / mythic actions.
- No Foundry/Roll20-native formats — 5etools homebrew monster JSON only.
- Temporary combat buffs only appear when `defenseMode: "active"` (or as already-applied sheet state).
- Feature prose is best-effort cleaned (not full NLG); rare features may still need manual picker edits.
- **`Additional Effects` can restate a bonus already folded into the numbers.** Suppressing
  a leftover bullet requires *proving* the bonus is inside the derived AC / attack /
  damage, and only a minority of cases are provable from the state the exporter has.
  Printing a bonus twice is a readability cost; removing a live one is a correctness cost,
  so the pass stays conservative.
- **An item-granted spell stated only in the item's prose never reaches a spellcasting
  block.** Wisp's Moonlit Aegis grants *Moonbeam* in free text with no structural record
  on the sheet, so extraction would be a guess. The grant is left where it is written,
  where it is at least hoverable.
- **Compression is bounded by safety, not by a target length.** Every trim rule must
  prove the text it removes is redundant; where it cannot, the text stays. Some entries
  are therefore still long (Dzeiy's `Hybrid Transformation`), and a second mention of a
  hovered term in the same sentence is deliberately left as plain English.
- Long features are split into labelled sections rather than truncated; only a runaway
  single section is trimmed, at a sentence boundary.
- **Homebrew skill keys are a deliberate schema deviation.** `schema/site/bestiary` sets
  `additionalProperties: false` on `skill`, so `"endurance|TGTT"` is technically invalid
  — but `Renderer.monster.getSkillsString` unpacks the UID and the skill renders *and*
  hovers. Dropping a proficient homebrew skill was judged worse than the deviation.
- Stance and feature-conjured-weapon mechanics are parsed out of prose, because the
  structured payloads (`stanceEffects`) are empty in practice. Unusual phrasings may not
  be recognised; the prose itself is always exported in full, so nothing is lost.
- Damage riders are additive text on the attack line, not recomputed damage averages. The
  CR heuristic *does* now count them (Rage, Divine Strike, a Crimson Rite, Sneak Attack and
  friends are added once to per-hit damage), along with a Bonus Action attack routine
  (Flurry of Blows, two-weapon fighting, Polearm Master) — omitting both rated a level-13
  monk at CR 6. The rider credit is deliberately conservative: once each, never per swing.
- **A plural word that is also a verb is disambiguated by clause position.** "The spell
  attacks Onger" takes the subject as an object; "attacks Onger makes" is a reduced
  relative clause whose verb must be conjugated. The exporter treats `attacks`, `hits`,
  `targets`, `moves`, `saves`, `checks` and `rolls` as nouns when they open a clause.
- **A die annotation only counts a die-value paren as "already annotated".** "One
  Superiority Die (no action required)" is not annotated, and must still gain its `(1d10)`.
- Smart leftover **Additional Effects** is on by default; disable via “Leftover modifiers” if you want a minimal block.
- Validation is structural, not full `schema/site/monster.json`.
- Spell multiclass presentation prefers pact-only when no normal slots; edge multiclass mixes may need manual CR/feature cleanup.
- **Divine Favor needs the homebrew catalog.** `_getDivineFavorBlock` reads
  `state.getDivineFavorGodData()`, which resolves against whatever
  `setDivineFavorCatalog()` was given. Without it (a bare Node harness, or a sheet that
  never loaded the Traveler's Guide) the trait is silently omitted rather than guessed.
- **Shape-shift consolidation is name-keyed.** `_consolidateShapeshiftEntries` recognises
  `Circle Forms`, `Improved Circle Forms`, `Elemental Wild Shape` and `Thousand Forms`;
  a homebrew Wild Shape rider under a different name stays a separate trait (correct but
  not consolidated).
- **Held-weapon resolution requires an unambiguous weapon.** `_resolveHeldWeaponReferences`
  only names a weapon when exactly one is equipped; with two it leaves the generic
  phrasing rather than guessing which one the ability means.
- **Ambiguous skill tagging is contextual, so it can under-tag.** A genuine
  `Nature` check phrased without a check/proficiency cue and not adjacent to another
  skill tag stays untagged — deliberately preferring a missing hover to a wrong one.

- **A shared resource pool is not evidence of a specific feature.** Conditional defenses
  from a toggle (Rage resistances, a Shadow Sorcerer's Umbral Form) are only annotated
  when the character actually has the named feature — matching on the resource alone
  fabricated resistances for every Sorcerer.
- **A caster's effective AC feeds CR** (`_getEffectiveAcForCr`): Mage Armor and Shield are
  counted when the NPC knows them, because a squishy full caster otherwise rates below
  what it survives in play. It is still an approximation, and a full caster legitimately
  rates lower than an armoured cleric of the same level.
- **`_dropInertItemEntries` judges item entries only.** A class feature with no number is
  still a rule the character has, so the "no mechanical content" test is never applied to
  it.
- **`_refileByStatedEconomy` reads the lead sentence only.** A rider deep inside an entry
  that mentions a reaction does not move the entry; an entry whose *opening* names an
  economy does.
- **The residue strip matches the exact damage the line emitted, nothing looser.** Onger's
  `Brutal Strike` states its die as `1d10` (the per-die value) while the line carries the
  full `2d10`, so the clause is left intact rather than stripped by a fuzzy match. Widening
  the match to any `NdX` would break sentences whose subject sits before the clause,
  leaving *"the target it can cause…"*.
- **Retirement is unavailable to an anchor, however completely the line restates it.** Rage's
  damage is on Onger's attack line, but four entries key off "while raging", so the Rage
  entry stays. Compressing an anchor can make that entry *longer* while the block gets
  shorter — measure the character total, not the entry.
- **A correct payload is not a finished feature.** The bundle was right, the tests were
  green, and the user's verdict was still "the fix doesn't work" — because the only surface
  they looked at showed a dead link. Whatever the export *produces*, the preview is where it
  gets judged, so the preview has to resolve the same references the payload promises.
- **Verify against the dev server, never the ad-hoc one.** A plain `python -m http.server`
  sends no `Cache-Control`, so Chrome heuristically caches ES modules and keeps running code
  you have already changed — `location.reload(true)`, a fresh tab, and CDP cache-disable all
  failed to shift it. `npm run serve:dev` (`http-server -c-1`) sends `no-store`. A
  cache-busted `import("…?bust=" + Date.now())` is the quickest way to tell "my fix is
  wrong" apart from "the page is stale".

## Key files

| File | Role |
|------|------|
| `js/charactersheet/charactersheet-npc-exporter.js` | Pure converter |
| `js/charactersheet/charactersheet-export.js` | Dialog, persistence, brew I/O |
| `test/jest/charactersheet/CharacterSheetNpcExporter.test.js` | Unit / regression |
| `test/jest/charactersheet/CharacterSheetNpcExporter.matrix.test.js` | Class × systems coverage |
| `test/jest/charactersheet/CharacterSheetNpcExporter.materials.test.js` | Material & upgrade routing, bundle composition |
| `test/jest/charactersheet/CharacterSheetNpcExporter.realsaves.test.js` | Contract tests against real saves in `npc-exports/` (skipped when absent) |
| `.agents/skills/charactersheet-development/references/subsystem-details.md` | Agent quick ref |
