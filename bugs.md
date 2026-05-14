# bugs
In general all bugs refer to TGTT classes unless otherwise specified.

## Open Bugs
[] we are missing a Thelemar Concept called Lore Skills, detailed in the Traveler's Guide to Thelemar. This requires a seperate builder step and some implementation ideas.
[] Celestial Resistance of Hochhling/Aasimar isn't appearing as a resistance.
[] We need to somehow allow players to have Aid cast on them, even if they are not spellcasters, as it's a common buff that players will want to track.
[] We want to add some "Favourites" area to the overview tab, and allow players to pin certain features/resources/attacks there for quick reference. This is a quality of life improvement that would be nice to have. We want this to allow a player to easily reference things like specific specialties, background features, items, spells, class features, and resources that they use often.
[] Evasion isn't being added or calculated for Monks and Rogues.
[] A chronourgy wizard doesn't get Gift of Alacrity as an option when adding spells, which suggests there are still issues in how spell lists are being handled.
[] when exporting characters as a json, we get a file called "name.json.json" instead of "name.json". This is a minor issue but should be fixed for better user experience.
[] the Dreamer feat from the Traveler's Guide to Thelemar isn't granting the expected benefits, and may not be fully implemented in calculations.
[] Nyuidj from TGTT are supposed to have an advantage in Wis Saving Throws, and they do! But when trying to roll with disadvantage, it just rolls with disadvantage instead of normal. This is a bug in the roll logic that needs to be fixed to properly handle cases where a character has both advantage and disadvantage on the same roll.
[] Chronourgy Wizard's should get +int mod to initiative from their Temporal Awareness feature, but this isn't being calculated correctly.
[] There is a weird bug for wizards in how cantrips are handled, which I don't quite understand. I will add the json of the character to the bug report, but basically the cantrips known and cantrips prepared are not being calculated correctly, which leads to some weird issues with spellcasting and spell preparation.
[] Not all warlock invocations are implemented in calculations, and many have prerequisites that are not enforced in the UI (e.g. invocations that require a certain pact boon or warlock level). 

## Closed Bugs
[x] HP breakdown is not visible to players — fixed by adding a single `getHpBreakdown()` source-of-truth method on `CharacterSheetState` (per-level rows + flat / per-level bonus sources + temp/current HP + legacy fallback flag), then consuming it in two UI surfaces: (1) a click-to-open `_showHpBreakdownModal` on the HP card (mirroring the AC / speed popovers) showing each level's hit-die source (max / rolled / average), CON contribution and subtotal, plus aggregated bonus rows for Toughness-style `hp + perLevel:true` and flat HP modifiers; (2) a new `❤️ charsheet__level-choice--hp` pill on every level-history card showing "Rolled 7 (d10) +2 CON = +9 HP" / "Average …" / "Max …". HP-section click ignores propagation from inputs/buttons so editing current/temp HP still works. Covered by `test/jest/charactersheet/CharacterSheetHpBreakdown.test.js` (15 tests).
[x] levelup/quickbuild still sometimes lead to non full hp for players — fixed by persisting per-level `hpRoll` (bare die value) on `levelHistory[i].choices.hpRoll`, having `_calculateMaxHp` consume the recorded class + roll for each level, and replacing the incremental `setMaxHp(currentMax + delta)` calls in builder/levelup/quickbuild/respec with a single end-of-flow `recalculateHp({syncCurrent: true})` that sees feats (Toughness `hpPerLevel`), ASI-to-CON, racial bonuses, and the current modifier stack. Respec now also recalculates HP after ASI / feat / feature-choice / subclass changes (preserving healing on max-up via `_recalcHpPreservingHealing`). Caveat: legacy characters who rolled higher-than-die under the old code (and whose stored `hpRoll` is now clamped) may see their max HP shift on the next recalculation; this is by design — no migration is performed. Covered by `test/jest/charactersheet/CharacterSheetMaxHpCalculation.test.js` (16 tests).
[x] when clicking to exit quickbuild, the modal appears behind the quickbuild one — fixed by threading `zIndex` through `InputUiUtil.pGetUserBoolean` → `pGetUserGenericButton` → `_pGetShowModal` (mirroring `pGetUserEnum`) and passing `zIndex: 10000` from `_closeWizard`'s confirmation prompt so the modal renders above the `.charsheet__quickbuild-overlay` (z-index 9999).

## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
