# bugs
In general all bugs refer to TGTT classes unless otherwise specified.

## Open Bugs
[] choosing spells did not become optional at the levelup screen despite the fact we wanted it to be
[] there is a display issue where choosing metamagic at level up requires scrolling down and some of the options are hidden even when you do scroll down.
[] Combat Traditions choosing is not pretty on levelup/builder/quickbuild, and does not filter tradition options for non-fighter classes. It also causes some scroll down display issues.
[] choosing languages in race is not very pretty, does not allow filtering or searching, and in general not a nice experience.

## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
