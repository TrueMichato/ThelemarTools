# bugs

## Open Bugs

[x] Ignan and Primordial have some weird issues, sometimes you can choose primordial in builder but not ignan, sometimes you can choose ignan but not primordial.
[x] When choosing Cantrips or Spells, the spells known and cantrips known modals show 0/6 despite choices being made and spells appearing
[x] Child of the Sun Bloodline Sorcerer is completley unimplemented
[x] Subclass spells are not implemented correcty.
[x] Activating Passive Metamagic (TGTT) like Extended Spell, Distant spell doesn't alter spell data. What we want is that when a passive metamagic changes a spell stat, if we hover a spell we will see the original stat and then some green parenthesis that will show the new stat. If the stat is in the sheet, we want just the new stat. This also needs to work for all passive metamgic options that alter specific stats, not just for extended and distant.
[x] you can tune to passive metamagic options even if you don't have sorcery points
[x] when choosing spells using any of the spell pickers, the sheet does not use the existing filter logics that 1. hide spells if thelemar version exists 2. set rarity and legality for each spell based on source and spell data. This means players can't filter or sort by rarity and legality, which is a problem.
[x] Site fonts feel too small for some players. let's allow players to set the font size themselves instead of using sliders, and see how this goes. It might be worse, might be better, we will see.
[x] ve-flex-col w-100 charsheet__main-header feels smaller relative to the rest of the page, font wise.
[x] When clicking a hover link to something that is part of a page (for example, hover to a specific ability from a class), the opened page is 404; need some override to just open the general page and go to the specific part (I think this issue is specific for classes)
[x] The TGTT filter logic seems to disappear from pages from time to time after edits. We want to make sure it always works and doesn't become something I need to patch back on each time.
[x] building a character sometimes results with it having 0 hp out of max, and sometimes levelups don't fill the hp to the max.

## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
