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

## Validation
`getValidationIssues(monster)` is sync and structural (name/source/size/type/AC/HP/abilities/spellcasting shape/legendary fields). Hard errors block Save to Homebrew; warnings allow Download / Copy. Full browser-side monster schema validation is still out of scope (graceful hand validator only).

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

## Key files

| File | Role |
|------|------|
| `js/charactersheet/charactersheet-npc-exporter.js` | Pure converter |
| `js/charactersheet/charactersheet-export.js` | Dialog, persistence, brew I/O |
| `test/jest/charactersheet/CharacterSheetNpcExporter.test.js` | Unit / regression |
| `test/jest/charactersheet/CharacterSheetNpcExporter.matrix.test.js` | Class × systems coverage |
| `test/jest/charactersheet/CharacterSheetNpcExporter.realsaves.test.js` | Contract tests against real saves in `npc-exports/` (skipped when absent) |
| `.agents/skills/charactersheet-development/references/subsystem-details.md` | Agent quick ref |
