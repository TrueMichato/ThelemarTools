# bugs
In general all bugs refer to TGTT classes unless otherwise specified.

## Open Bugs

## Combat Methods
* The feature name for the combat methods at the feature tab is "CTM 1, CTM 2, CTM 3, CTM 4, CTM 5"


## ⭐ Feats

* **Forest Sage (Prepping for next level):** This feat correctly allows for a stat increase, but it only lets me choose **one** Wizard spell instead of **two**. Additionally, it fails to change the base ability score for Arcana and Nature to Wisdom.

---

## ⚙️ UI, Items & General Questions

* **Skill Bonus Breakdown:** I really like the skill breakdown UI, but under Nature/Arcana, it lists the bonus from the *Magician* feature generically as a "Custom Modifier" rather than stating the feature's name explicitly.
* In the spells tab, the display for amount of spells known/prepared is showing wrong numbers and is generally confusing. What we want is a multiclass compatible approach - you should have modals for spells and cantrips of each class you have (i.e warlock spells, warlock cantrips, sorcerer spells, sorcerer cantrips) that each count the amount of spells you have from each list. Drop the known vs prepared names (this is a mechanic side we want to remember and maybe help enforce, but is confusing. Remember - bards, sorcerers, warlocks all have a limited number of spells they know, clerics and druids have spells they prepare each morning, wizards have the spellbook mechanics which are completly different), and the 2014 vs 2024 badges. We want to be able to tell how many spells we have in each class.
* Also regarding multiclass spellcasters, each class has its own spell save DC and spell attack modifier, it is just that if both class have the same spellcasting ability and no special modifiers it can be exactly the same. We want to display this clearly and track this clearly.
* some specialties have a hover problem:
render.js:15823 Uncaught (in promise) Error: Failed to load renderable content for: page="classfeatures.html" source="TGTT" hash="poisons%20and%20antidotes_ranger_tgtt_2_tgtt" preloadId="null" customHashId="undefined" isFluff="undefined"
    at Renderer.hover._pHandleLinkMouseOver_doVerifyToRender (render.js:15823:9)
    at Renderer.hover.pHandleLinkMouseOver (render.js:15738:9)
_pHandleLinkMouseOver_doVerifyToRender @ render.js:15823
pHandleLinkMouseOver @ render.js:15738
render.js:15823 Uncaught (in promise) Error: Failed to load renderable content for: page="classfeatures.html" source="TGTT" hash="build%20shelter_ranger_tgtt_4_tgtt" preloadId="null" customHashId="undefined" isFluff="undefined"
    at Renderer.hover._pHandleLinkMouseOver_doVerifyToRender (render.js:15823:9)
    at Renderer.hover.pHandleLinkMouseOver (render.js:15738:9)
_pHandleLinkMouseOver_doVerifyToRender @ render.js:15823
pHandleLinkMouseOver @ render.js:15738
await in pHandleLinkMouseOver
Renderer.hover.pHandleLinkMouseOver @ charactersheet.js:747
onmouseover @ charactersheet.html?id=100834a7-00c2-4af2-872b-74ddfe93b2fa:1
render.js:15823 Uncaught (in promise) Error: Failed to load renderable content for: page="classfeatures.html" source="TGTT" hash="read%20the%20room_ranger_tgtt_6_tgtt" preloadId="null" customHashId="undefined" isFluff="undefined"
    at Renderer.hover._pHandleLinkMouseOver_doVerifyToRender (render.js:15823:9)
    at Renderer.hover.pHandleLinkMouseOver (render.js:15738:9)
_pHandleLinkMouseOver_doVerifyToRender @ render.js:15823
pHandleLinkMouseOver @ render.js:15738
await in pHandleLinkMouseOver
Renderer.hover.pHandleLinkMouseOver @ charactersheet.js:747
onmouseover @ charactersheet.html?id=100834a7-00c2-4af2-872b-74ddfe93b2fa:1


## Respec
* Respec does not treat multiclass correctly - it assume linear tree, but in fact should create a seperate branch for the new class in the multiclass (to allow for a player changing their last level of either class, removing it, etc).
* Respec does not allow removing a level with a subclass despite us agreeing this should be removeable

## Sorcerer
* Hovering Metamagic has a small error where the hover displayes cost twice, with the first one being usually wrong, and the second one being inline with the text and correct.
* Divine soul sorcerer gets a free subclass spell depending on ther alignment orientation. This spell should be changeable, but only with other cleric spells. This might prove difficult to implement, so we can be satisfied with just having a reminder clearly displayed to the player. Currently this spell is locked like all other subclass spells, but it should not be. 
* Interaction with Spell Scribing Adept Feat - the spells displayed possible for scribing don't include cleric spells for Divine Soul Sorcerer.

## Druid
* In the Zodiac subclass from TGTT, the Star Map feature appears as a resource with 3 uses. In fact, it gives X uses of the Guiding Bolt spell, where X is the wisdom modifier. We want this to reflect that fact and also allow when casting the spell and choosing the spell slot to choose this resource instead
* Zodiac Form: Month appears as an activatable ability, but does nothing. It should give a modal for choosing the form, and each form should have its effects properly applied to the sheet and displayed. 

## Ranger
* Hunter's Prey choice is not displayed anywhere in the sheet and does not take effect when chosen. It should appear in the overview somewhere (maybe Rangers should have a dedicated area to both Hunter's Prey and Primal Focus?) and it should also take effect when chosen (e.g. Colossus Slayer should only apply when the Colossus Slayer option is active, and the same for Giant Killer and Horde Breaker).
* Primal focus should on use should toggle between the two modes, and it should also be chosen from the long rest menu. Currently none of the modes nor their upgrades have any functionality, and the feature is treated as a generic resource that is activatable but does nothing.
* Many ranger features (Tireless, Roving, more) are not actually implemented and have no effect on the sheet. These should be implemented and have their effects properly displayed and calculated.



## Closed Bugs

* **Resilient (no save proficiency granted):** Taking Resilient raised the chosen ability by 1 but never granted proficiency in that ability's saving throw. Root cause: Resilient is a half-feat whose data carries `savingThrowProficiencies: [{choose: {from: […]}}]` alongside its `ability` choose-block — the save is *implicitly tied to the chosen ability* (one pick) — but **no** character-sheet code read `feat.savingThrowProficiencies`: the central `applyFeatBonuses` handled ability/skill/language/expertise/spells only, and the Features-tab inline apply (which doesn't route through `applyFeatBonuses`) likewise skipped it. A stale registry entry `register("Resilient", [{type: "saveProficiency", save: "chosen"}])` existed but its handler deliberately no-ops `"chosen"`, so nothing was applied. Fixed generically (architecture-first, DRY — benefits every save-granting feat): added `CharacterSheetClassUtils.resolveFeatSaveProficiencies(feat, choices)`, which resolves a `choose` block to the chosen ability (respecting any `from` allowlist) and also handles pre-resolved `"con"` / `{con: true}` forms, de-duped and validated against `Parser.ABIL_ABVS`. Wired it into `applyFeatBonuses` (covers **Level-Up / Quick-Build / Builder / Respec**) and the Features-tab inline apply, each calling `state.addSaveProficiency()` (which dedupes). No new picker — the save is derived from the existing ability choice, so the combined half-feat now grants both the +1 and the matching save in every flow. The harmless registry no-op was left as-is. Covered by `CharacterSheetResilientSaveProficiency.test.js` (14 tests).

* **Plantmender / uncategorized feats (missing +1 ASI):** Plantmender (Humblewood partnered content, not in the committed data) declares neither a `category` nor an `ability` grant, so no ASI picker appeared and nothing was applied — the feat-sheet picker and applier both keyed strictly on `feat.ability`. Fixed generically in code (no data edits, per design): added three pure helpers to `CharacterSheetClassUtils` — `featHasAbilityGrant()` (does the feat already grant a fixed/choose ASI?), `featDefaultsToGeneralAsi()` (uncategorized **and** ASI-less **and** not a superseded reprint → treat as General), and `getEffectiveFeatAbility()` (synthesizes a `[{choose:{from:Parser.ABIL_ABVS, amount:1, count:1}}]` grant for such feats, otherwise passes `feat.ability` through unchanged). Re-using the exact half-feat spec shape means every downstream picker/applier/validator handles synthesized grants with **zero** special-casing. Wired `getEffectiveFeatAbility()` into all spec-builders and the central applier: `buildFeatChoicesSpec` + `applyFeatBonuses` (ClassUtils — covers Level-Up, **Builder** via the shared `_renderOptFeatureFeatProgressionPicker`, Respec preview, and Quick-Build/Builder apply), Quick-Build's local `getFeatChoices`, and the Features tab's `_getFeatChoices` (its inline apply already defaulted the amount to 1). Guarded by `!feat.reprintedAs` (**Option B**) so superseded legacy 2014 feats (Alert/Lucky/Tough, which are category-less and ASI-less but carry a `reprintedAs` pointer) are **not** retroactively buffed; the predicate also never double-grants on feats that already have an ASI (Forest Sage is unaffected). Now taking Plantmender in Level-Up / Quick-Build / Builder / Features surfaces a "+1 to one ability of your choice" picker and applies it (capped at 20). Covered by `CharacterSheetUncategorizedFeatAsi.test.js` (23 tests); two pre-existing `isFeatChoiceSpecComplete` gate tests were updated to use categorized (Origin) feats so they keep isolating the skill/no-choice gates rather than the new General-ASI behavior.

* **Druid multiclassing (Specialties never offered):** Multiclassing into Druid silently recorded an empty choice set and never surfaced the *Specialties* picker. Root cause: Specialties live **only** on the TGTT Druid class (source `TGTT`); the XPHB Druid has no such feature. The multiclass class picker (`showMulticlass`) built its list from the raw, un-deduped, un-source-filtered `getClasses()`, so two "Druid" rows (XPHB + TGTT) appeared, distinguished only by tiny muted source text — and the feature-less XPHB Druid was the one that got chosen. Fixed generically (architecture-first, benefits every duplicated-name class): added `CharacterSheetClassUtils.dedupeClassesBySourcePreference()`, which collapses same-named class variants to a single preferred entry (preference order: a source the character already uses → TGTT when TGTT is enabled → XPHB → PHB → other, with a stable name-order and `localeCompare` tie-break). `showMulticlass` now runs the catalog through `filterByAllowedSources` then this deduper, so a single "Druid" row resolves to the variant whose features actually exist; the existing `_renderFeatureOptionsSelection` path then renders Specialties (and Primal Order) correctly. Note: **no migration** — a character whose Druid was already recorded as XPHB (e.g. Lunaria) must re-level the multiclass leg to pick up the TGTT Druid and its Specialties.

* **Primal Order — Magician (missing extra cantrip):** Choosing *Magician* correctly applied the Nature/Arcana bonus but never offered the extra Druid cantrip it grants. Root cause: `magicianCantripsBonus` was computed in state but never consumed anywhere. Fixed at the architecture-first integration point — the **central spellcasting cantrip budget**: `_getClassSpellcastingInfo()` now adds `+1` to a Druid's `cantripsKnown` when `hasFeature("Magician")` (both the data-driven and fallback progression branches), and `getMagicianBonusCantripCount()` was added to ClassUtils. Because the spells tab gates cantrip selection by `getSpellcastingInfo().cantripsKnown`, the extra pick now surfaces across **every** flow — builder, multiclass, respec, and already-loaded characters — the moment Magician is selected. The builder's build-time spell-picker (`_getKnownCasterInfoForBuilder`) was additionally wired to include the bonus for creation-time consistency. Covered by `CharacterSheetDruidMulticlassMagician.test.js` (16 tests). Note: the related "Skill Bonus Breakdown shows *Magician* as a generic Custom Modifier" item stays open under UI/General.

* **Hunter's Prey (consumable "Use" instead of a toggle):** The Ranger Hunter's *Hunter's Prey* surfaced as a consumable resource (max 1, short rest) because the generic uses-parser matched the "Short Rest or Long Rest … once per turn" wording and auto-created a resource. Fixed: Hunter's Prey is now a **toggle** between *Colossus Slayer* / *Horde Breaker* (plus *Giant Killer* in the 2014 ruleset), modeled on Primal Focus. Added `huntersPrey` state with `hasHuntersPrey()` / edition-aware `getHuntersPreyOptions()` / `get`/`setHuntersPreyOption()`; `getFeatureCalculations` is now option-aware (`colossusSlayerDamage` only when Colossus Slayer is active, else `hasHordeBreaker` / `hasGiantKiller`). `addFeature` no longer auto-creates a resource/uses for Hunter's Prey (treated as a resource-system/meta feature), and a `loadFromJson` migration (`_migrateHuntersPrey`) strips the legacy orphan resource + feature `uses` so existing characters (e.g. Lunaria) are cleaned automatically. The Features tab shows a **read-only** active-option display ("Swap on a short or long rest"), and both the **short and long rest modals** include a passive swap selector (per the 2024 rest-swap rule). Covered by `CharacterSheetHuntersPrey.test.js` (18 tests).

* **Fighting Style (no picker for class-level `featProgression`):** TGTT/2024 classes grant Fighting Style as a *feat* via a class-level `featProgression` entry (`category: ["FS", "FS:R"]`), but no character-sheet code read `featProgression` — only `optionalfeatureProgression` (which uses `featureType`) was wired — so the Fighting Style picker never appeared. Fixed generically (architecture-first, so every class with a `featProgression` benefits): added `CharacterSheetClassUtils.getClassFeatProgressionGains()` (sums grants over the leveled range, excludes Epic Boon category `EB` which the dedicated ASI/Epic-Boon flow already handles), then wired a category-filtered feat picker — with sub-choice support (e.g. Druidic Warrior's cantrips, Superior Technique's maneuver) — into all four flows: **Level-Up**, **Quick Build**, **Builder** (XPHB Fighter's L1 Fighting Style now surfaces too), and **Respec** (full re-pick via the real feat system). Chosen feats are persisted with a `classFeatProgression` provenance tag for cleanup/respec, and recorded in level history. Note: **no migration** — existing characters (e.g. Lunaria) must re-level the granting level (Ranger L2) to receive the Fighting Style pick.

* **Primal Focus Upgrade (spurious "Activate"/Stamina button):** The feature's description hand-wrote *Singular Focus* and *Groundshatter* as plain text with "X Stamina Points", so the activatable detector mistook it for a combat method and surfaced a misleading Activate button. Root cause: those are real combat-method entities that were accidentally duplicated as prose and never granted. Fixed: added a generic, reusable `grantsCombatMethods` field on features; `Primal Focus Upgrade` (L6) now grants the real `{@combatmethod Singular Focus|TGTT}` (Predator) and `{@combatmethod Groundshatter|TGTT}` (Prey) methods. `CharacterSheetClassUtils.resolveGrantedCombatMethods()` resolves grant UIDs against the combat-method catalog (wired into state via `setCombatMethodCatalog()`), `addFeature()` adds the granted methods, the combat panel focus-gates each method's Use button to its matching Primal Focus mode, and the parent feature is marked passive so no spurious Activate appears. Note: no migration — existing characters must re-level/re-add the feature to receive the methods.

* **Primal Focus (uses badge):** Was appearing as a Bonus Action with proficiency-bonus uses based on *total* character level (showed 4 when multiclassing). Fixed: Primal Focus no longer auto-generates a generic uses badge; instead the feature now shows two dedicated badges — **Focus Switches** (always, Ranger-level based, e.g. 2 at Ranger 6) and **Hunter's Dodge** (Prey mode only, Ranger-level proficiency bonus). Hunter's Dodge uses now scale off Ranger class level, not total level.


## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
