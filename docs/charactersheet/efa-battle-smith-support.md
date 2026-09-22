# EFA Battle Smith Steel Defender Support

This document covers the exact *Eberron: Forge of the Artificer* (EFA) Battle
Smith Steel Defender. It does not apply EFA mechanics to the TCE Steel
Defender, the RHW Reanimated Companion, generic companions, or name-only legacy
records.

## Exact identity

- Feature owner:
  `Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA`
- Companion source identity: `Steel Defender|EFA`
- Replacement tool: a positive-quantity persisted inventory row for
  `Smith's Tools|XPHB`

Both the exact owner and companion source must match. Display names alone are
never enough to activate these rules.

## Lifecycle states

The existing companion record keeps one lifecycle:

| State | Meaning | Available lifecycle action |
|---|---|---|
| `alive` | The current generation is operational. | Normal companion operations |
| `dead` | It is at 0 HP inside the revival window, or has unknown migrated death timing. | Begin revival |
| `revivalPending` | Action and slot were committed; canonical time has not reached completion. | Complete revival (+1 minute) |
| `expired` | The one-hour revival window closed. | Optional replacement after Long Rest |
| `vanished` | The persisted generation left play, including owner death. | Optional replacement after Long Rest |

Ordinary healing, Repair, Arcane Jolt restoration, Hit Dice, Short Rest, and
Long Rest do not revive a non-alive generation.

## Manager and Play Mode

The Manager companion card remains the primary desktop surface. Play Mode adds
the same compact lifecycle block to its existing companion drawer; it does not
create a second panel.

Both surfaces show:

- a text lifecycle label and generation, not color alone;
- known death minute, deadline, and remaining time, or an unknown-timing note;
- the pending completion minute;
- expired and owner-death vanished explanations;
- visible reasons while normal companion controls are disabled; and
- the same Begin Revival or Complete Revival action.

Inactive companions normally remain hidden. The only exception is the exact
persisted EFA Steel Defender tombstone, so dead, pending, expired, and vanished
records remain actionable without exposing unrelated inactive companions.
The legacy generic **Add Steel Defender** toolbar action is available only to
an exact `Artificer|TCE` / `Battle Smith|TCE` class-subclass pair. An EFA Battle
Smith always uses feature setup and its persisted card; non-Battle-Smith and
name-only Artificers never receive the generic add action.

## Beginning revival

Beginning revival is one protected operation:

1. Choose one State-provided normal or Pact Magic spell slot.
2. Confirm that the owner is touching the defender.
3. For an old migrated save with unknown death timing, also confirm in the same
   operation that the defender died within the last hour.
4. Review the pre-commit Action, slot, and confirmation summary.
5. Select **Begin revival**.

The commit spends the owner's Magic Action and selected slot together. Closing,
cancelling, missing fields, unavailable costs, or a State error spends nothing.
While the commit is resolving, the modal cannot close by its close control or
Escape. Validation focuses the first missing field, and focus returns to the
invoking lifecycle area after the sheet rerenders.

Successful begin changes the state to `revivalPending`; it does not heal the
defender immediately.

## Completing revival

**Complete revival (+1 minute)** advances the canonical game clock by one
minute through `advanceGameTimeMinutes(1, ...)`. When the recorded due minute
is reached, State atomically returns the defender alive at full HP. There is no
Battle Smith timer, wall clock, or combat-round tracker.

## Optional Long Rest replacement

The existing Long Rest dialog contains an optional Steel Defender fieldset.
Leaving it blank does not affect the rest.

To stage a replacement:

1. Select the exact persisted positive-quantity `Smith's Tools|XPHB` inventory
   row.
2. Confirm that the selected row is in hand.
3. Finish the Long Rest.

The rest first commits canonical time and recovery. Only afterward does the
shared lifecycle coordinator ask State to replace the defender, so the new
`lastLongRestMinute` is authoritative. Replacement is never automatic. It
keeps the stable companion ID and setup, records the prior generation as
vanished, increments generation, and restores the new generation's HP and
resources. Cancelling the rest mutates nothing, and **Undo last rest** restores
the pre-rest generation with the rest snapshot.

Custom, generated, wrong-source, empty, proficiency-only, or renamed rows do
not satisfy the tool requirement.

## PDF output

The exact EFA Steel Defender block includes lifecycle status and generation.
Depending on state, it also includes known death timing and remaining window,
unknown timing, pending completion, expired/vanished notes, and
revival/replacement guidance. TCE, RHW, generic, name-only, and wrong-source
PDF output remains on the generic companion path.

## Developer contract

State owns lifecycle policy, validation, spending, rollback, time transitions,
and replacement:

```javascript
state.getFeatureCompanionRevivalAvailability(companionId, options);
state.beginFeatureCompanionRevival(options);
state.advanceGameTimeMinutes(1, options);
state.getFeatureCompanionReplacementToolRows(companionId);
state.getFeatureCompanionReplacementAvailability(companionId, options);
state.replaceFeatureCompanionAfterLongRest(options);
```

Revival availability supplies the authoritative known death minute, deadline,
and remaining-window projection used by the UI and PDF; those surfaces do not
recalculate the one-hour rule.

Page owns the shared Manager/Play Mode presentation and interaction boundary:

```javascript
page.getFeatureCompanionLifecycleSurfaceCompanions();
page.getFeatureCompanionLifecyclePresentation(companion);
page.pUseFeatureCompanionLifecycle({companionId, operation});
page.commitFeatureCompanionReplacementAfterLongRest(options);
```

Do not add a second lifecycle store, copy timing formulas into UI code, alter
`getActiveCompanions()` globally, create a fake tools item, or bypass these
shared Page/State operations.

## Focused tests

Run:

```bash
npm run test:unit -- \
  test/jest/charactersheet/CharacterSheetBattleSmithEfaLifecycle.test.js \
  test/jest/charactersheet/CharacterSheetBattleSmithEfaFlow.test.js \
  test/jest/charactersheet/CharacterSheetPlayMode.test.js \
  test/jest/charactersheet/CharacterSheetEfaReplicateRest.test.js \
  test/jest/charactersheet/CharacterSheetRestUndo.test.js \
  test/jest/charactersheet/CharacterSheetPdf.test.js \
  --runInBand --no-coverage
```
