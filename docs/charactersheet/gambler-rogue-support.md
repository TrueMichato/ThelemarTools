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
  spent. Result 33 creates a confirmed free, canonical PHB Color Spray cast
  even when Color Spray is not on the character's known list. Result 61 keeps a
  durable unresolved delayed-cast receipt until the player explicitly resumes
  it from the Gambling Table controls. Choice and confirmation outcomes block
  the cast until the player resolves them.
- Extra Luck is offered only when a bonus action is available. Applying it
  spends one resource use and the bonus action atomically; declining or
  cancelling an offer spends neither. Play Mode reads and writes this same
  persisted bonus-action flag, so toggling or resetting either view cannot
  bypass the cost.
- Master of Fortune turns a natural 1 into a natural 20 and stores both
  Gambling Table rolls until the player chooses one. Pending choices survive
  save/load.

## Gambling Table boundary

All 100 published rows have canonical descriptors in
`CharacterSheetGamblerRules`. Safe self effects (including Persuasion
disadvantage, initiative penalties, Light, Prone/Blinded/Invisible,
Reduce/half-speed changes, levitation, X-ray vision, Silence, and the two
spell transactions) use the existing condition, modifier, active-state, and
receipt systems. Target, world, narrative, and DM-adjudicated outcomes remain
durable manual resolutions with the published row text and explicit
acknowledgement instructions; they are never silently discarded.

Pending cast and fortune receipts are available in the Gambling Table modal,
which exposes keyboard-labelled controls for Master of Fortune choices,
confirmation, delayed-result resume, manual acknowledgement, application, and
cancellation. The receipt queue is persisted with the character, so
closing/reopening or saving/loading does not lose a required choice or leave
behind a UI-only acknowledgement.

## Source safety

The Gambler identity requires a TGTT Rogue base class, a TGTT Gambler subclass,
and the TGTT setting enabled. Spell-list attribution, preparation, picker
substitution, and cast receipts use that source-qualified identity; a
same-named homebrew subclass cannot acquire Gambler spellcasting or resources.

## Deterministic tests

Production rolls use the normal random source. Tests can install a runtime-only
source with `state.setGamblerRollSource({nextInt(max, context) { ... }})`.
The source is never serialized, so saved characters retain outcomes without
retaining test callbacks or queues.
