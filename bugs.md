# bugs
In general all bugs refer to TGTT classes unless otherwise specified.

## Open Bugs
[x] The Druid subclass "Circle of the Zodiac" is currently named "Circle of the Stars" in the code, which causes issues with feature calculations and tests. This should be renamed to "Circle of the Zodiac" in both the homebrew data and the code to ensure consistency and correct functionality.
[x] When choosing subclasses for druid, the "Circle of the Zodiac" subclass is not displayed as an option
[x] Ranger does not get access to the absorb elements spell for some reason. This should lead a general investigation into why certain spells aren't being granted to classes as expected, and a fix should be implemented to ensure all class features are properly granted.
[x] A level 6 Ranger can choose 3rd level spells in the sheet despite not being supposed to have access to them. This should be fixed by ensuring that the spell level options are correctly limited based on the spell progression of the class and subclass.
[x] Ranger's Primal Focus is not implemented - it should let you choose and switch focuses, and grant the appropriate benefits based on the chosen focus. This should be implemented in the code and tested to ensure it functions correctly, with appropriate UI for selecting and switching focuses.
[x] Druid's Magician feature does not grant bonuses to arcana and nature checks as it should. This should be implemented in the code and tested to ensure that the correct bonuses are applied to the appropriate skill checks when the feature is active.
[x] Multiclassing into a spellcasting class (Druid was tried but probably applies to others) does not grant spell choices upon multiclass.
[x] We need to validate spellcasting progression for multiclass characters to ensure that they are granted the correct spell slots and spell choices based on their combined levels in spellcasting classes. sometimes we have really edge cases we want to support, like ranger 6/druid 3 getting 3 3rd level slots but not getting access to 3rd level spells, and we want to make sure those are handled correctly.
[x] when choosing invocations for Warlock in levelup/quickbuild, the sheet does not show all available invocations, only TGTT invocations.
[x] When choosing invocations for Warlock in levelup/quickbuild/builder/multiclass/respec, the sheet does not check for prerequisites (e.g. Pact of the Blade for Thirsting Blade) and allows you to select invocations you shouldn't have access to. This should be fixed by implementing prerequisite checks in the invocation selection process during levelup and quickbuild, and providing appropriate feedback to the user when they attempt to select an invalid invocation.

## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
