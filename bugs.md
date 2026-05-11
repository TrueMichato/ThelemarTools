# bugs
In general all bugs refer to TGTT classes unless otherwise specified.

## Open Bugs
[] Combat Traditions choosing is not pretty on levelup/builder/quickbuild, and does not filter tradition options for non-fighter classes.
[] choosing languages in race is not very pretty, does not allow filtering or searching, and in general not a nice experience.
[] Not all warlock invocations are implemented in calculations, and many have prerequisites that are not enforced in the UI (e.g. invocations that require a certain pact boon or warlock level). 
[] sometimes in levelup or quickbuild feats that increase ability scores by choice still don't take into account ASI increase that happened in the same levelup/quickbuild step, which causes miunderstandings for the user (the calculations seem to be correct, but the UI doesn't reflect the changes in the same step).

## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
