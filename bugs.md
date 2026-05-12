# bugs
In general all bugs refer to TGTT classes unless otherwise specified.

## Open Bugs
[] Not all warlock invocations are implemented in calculations, and many have prerequisites that are not enforced in the UI (e.g. invocations that require a certain pact boon or warlock level). 

## Closed Bugs
[x] when clicking to exit quickbuild, the modal appears behind the quickbuild one — fixed by threading `zIndex` through `InputUiUtil.pGetUserBoolean` → `pGetUserGenericButton` → `_pGetShowModal` (mirroring `pGetUserEnum`) and passing `zIndex: 10000` from `_closeWizard`'s confirmation prompt so the modal renders above the `.charsheet__quickbuild-overlay` (z-index 9999).

## Unverified bugs

[] Some subclasses have features that aren't fully implemented in calculations (e.g. Alchemist's Experimental Elixir count, Alchemical Savant bonus, Restorative Reagents uses). These should be added to `getFeatureCalculations()` and tested.

[] Some tests use weak patterns that don't verify the actual calculations (e.g. checking for presence of text instead of verifying calculated values). These should be converted to stronger patterns that directly check the calculated values in `calculations`.
