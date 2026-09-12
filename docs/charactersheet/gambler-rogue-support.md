# TGTT Gambler Rogue support

The Character Sheet treats the TGTT Gambler as a subclass-owned spellcaster.
Its persisted slot grid and cantrip progression come from the published TGTT
tables, rather than the generic third-caster progression.

## Runtime rules

- Gambler prepared-spell rolls are `2d4`, upgraded to `3d6` at Rogue 13.
- The Gambling Modifier is `1d6`, upgraded to `2d4` at Rogue 13.
- Gambler's Folly wagers use d4 for spell levels 1–2, d6 for level 3, and d2
  for level 4 and higher.
- A cast creates one persisted resolution receipt. The receipt owns the wager,
  cast-scoped modifier, Gambling Table result, and slot transaction, so attacks
  and saves produced by the cast cannot roll different modifiers.
- Result 49 is represented as a slot-preserving transaction before the slot is
  spent. Result 33 and other confirmation outcomes remain pending until the
  player acknowledges them.
- Extra Luck is offered only when a bonus action is available. Applying it
  spends one resource use and the bonus action atomically; declining or
  cancelling an offer spends neither.
- Master of Fortune turns a natural 1 into a natural 20 and stores both
  Gambling Table rolls until the player chooses one. Pending choices survive
  save/load.

## Gambling Table boundary

All 100 published rows have descriptors in
`CharacterSheetGamblerRules`. Safe self effects use the existing condition and
active-state systems. Target, world, narrative, and DM-adjudicated outcomes
are durable manual resolutions with the published row text and explicit
acknowledgement instructions; they are never silently discarded.

## Deterministic tests

Production rolls use the normal random source. Tests can install a runtime-only
source with `state.setGamblerRollSource({nextInt(max, context) { ... }})`.
The source is never serialized, so saved characters retain outcomes without
retaining test callbacks or queues.

