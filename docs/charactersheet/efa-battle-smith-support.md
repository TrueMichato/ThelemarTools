# EFA Battle Smith Character Sheet Support

This document covers the complete Character Sheet implementation for the exact
*Eberron: Forge of the Artificer* (EFA) Battle Smith. It includes subclass
acquisition, spells, tools, Battle Ready, Steel Defender setup and operation,
Arcane Jolt, Improved Defender, lifecycle, persistence, and output surfaces.
It does not apply EFA mechanics to the TCE Battle Smith or Steel Defender, the
RHW Reanimator and Reanimated Companion, generic companions, or name-only
legacy records.

## Exact identity

- Feature owner:
  `Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA`
- Companion source identity: `Steel Defender|EFA`
- Replacement tool: a positive-quantity persisted inventory row for
  `Smith's Tools|XPHB`

Both the exact owner and companion source must match. Display names alone are
never enough to activate these rules.

## Feature support matrix

| Level | Feature | Character Sheet behavior |
|---|---|---|
| 3 | Tools of the Trade | Grants Smith's Tools or the existing fixed-proficiency fallback choice; halves weapon crafting time |
| 3 | Battle Smith Spells | Reconciles exact XPHB always-prepared grants without consuming the ordinary prepared-spell allowance |
| 3 | Battle Ready | Grants martial-weapon proficiency, proficient-weapon spellcasting focus support, and Intelligence substitution for magic-weapon attack and damage rolls |
| 3 | Steel Defender | Runs persistent setup and creates one exact source-owned feature companion with derived statistics and shared operations |
| 5 | Extra Attack | Grants two attacks and permits one remaining Attack-action attack to command only Force-Empowered Rend |
| 9 | Arcane Jolt | Adds the shared post-hit damage/healing transaction, Intelligence-based uses, once-per-turn receipt, and Long Rest recharge |
| 15 | Improved Defender | Raises Arcane Jolt to 4d6 and adds `1d4 + Intelligence` Force retaliation to Deflect Attack; EFA AC does not increase |

## Battle Smith spells

The following exact XPHB spells are always prepared at the listed EFA
Artificer levels:

| Level | Spells |
|---|---|
| 3 | Heroism, Shield |
| 5 | Shining Smite, Warding Bond |
| 9 | Aura of Vitality, Conjure Barrage |
| 13 | Aura of Purity, Fire Shield |
| 17 | Banishing Smite, Mass Cure Wounds |

Spell grants use exact owner/source identities, survive export/import, and are
removed only when the exact EFA Battle Smith grant is lost. Same-name TCE
owners remain independent.

## Tools of the Trade and Battle Ready

Tools of the Trade uses the shared fixed-proficiency fallback transaction. A
character who already knows Smith's Tools chooses another type of Artisan's
Tools through the same Builder, Level Up, Quick Build, and Respec-owned flow.
Its crafting descriptor applies a `0.5` time multiplier only to weapon outputs.

Battle Ready uses the canonical item and attack resolvers:

- martial-weapon proficiency is source-owned and deduplicated;
- only canonically classified magic weapons may use Intelligence instead of
  Strength or Dexterity for both attack and damage;
- removing the magic property or exact subclass grant removes the
  substitution without leaving a stale override; and
- any weapon with which the Artificer is proficient may satisfy the shared
  Artificer spellcasting-focus requirement.

The focus authorization remains tied to the ordinary inventory wrapper ID. No
Battle-Smith-specific inventory row or focus ledger exists.

## Steel Defender setup and persistence

Acquiring the exact level-3 grant opens the shared feature-companion setup
flow. The player chooses an appearance and two- or four-legged locomotion, and
may optionally set a nickname. The choices are narrative and do not change
statistics.

The player may finish immediately or defer. Deferring persists the partial
record but creates no defender. Completing setup creates exactly one
source-owned companion with a stable ID. Builder, Level Up, Quick Build, load,
and Respec all reconcile through the same setup and ownership APIs.

The live derived overlay preserves current HP, spent Repair uses, spent Hit
Dice, setup, notes, conditions, lifecycle, and generation. Recalculation never
duplicates or freely heals the companion.

## Steel Defender statistics and operations

`CharacterSheetCompanionRules` is the sole formula and policy authority:

- AC: `12 + Intelligence modifier`
- HP: `5 + 5 × EFA Artificer level`
- Hit Dice: one d8 per EFA Artificer level
- Speed 40 ft.; Darkvision 60 ft.; passive Perception 10
- poison damage immunity; charmed, exhaustion, and poisoned condition
  immunities
- understands the languages the summoner knows
- adds the summoner's Proficiency Bonus to every ability check and saving
  throw

The Manager and Play Mode use the same State/Page operation boundary:

- **Turn behavior:** the defender acts during the owner's turn; movement and
  reaction remain autonomous.
- **Dodge:** the default action; spends only the defender action receipt.
- **Other actions:** normally require the owner's Bonus Action. An
  incapacitated owner commands freely.
- **Force-Empowered Rend:** spell attack modifier; reach 5 feet;
  `1d8 + 2 + Intelligence modifier` Force damage. At level 5+, it may replace
  exactly one remaining attack from the canonical Attack action.
- **Repair:** confirms target and range, then spends the command, defender
  action, and one of three uses atomically. It restores
  `2d8 + Intelligence modifier` HP to the defender or a visible Construct or
  object within 5 feet. Modeled targets mutate HP; external targets record a
  confirmed manual result.
- **Deflect Attack:** spends only the defender reaction and applies
  Disadvantage when a visible attacker within 5 feet attacks a creature other
  than the defender.
- **Hit Dice:** a Short Rest may spend the defender's own d8 plus Constitution
  modifier; it never spends player Hit Dice.

Turn gates use the shared source-qualified receipt APIs and reset only through
`resetTurnEconomy()`. They do not depend on `combatRound`.
Long Rest restores all Repair uses and half the defender's spent Hit Dice, but
does not heal or revive a non-alive generation.

## Arcane Jolt and Improved Defender

Arcane Jolt becomes available after either a confirmed hit with a live magic
weapon or a committed hit from the exact EFA defender's Rend. The player
chooses:

- `2d6` extra Force damage to the hit target; or
- `2d6` healing to a visible creature or object within 30 feet of that target.

The resource has `max(1, Intelligence modifier)` uses, can commit only once per
turn across both trigger sources, and fully recharges on a Long Rest. Target
validation, resource spending, receipt spending, modeled healing, publication,
and rollback are one transaction.

At EFA Artificer level 15, both Jolt effects become `4d6`, and Deflect Attack
also deals `1d4 + Intelligence modifier` Force damage to the attacker. Unlike
the TCE Battle Smith, EFA Improved Defender grants no AC increase.

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

## Import, export, migration, and Respec

The ordinary Character Sheet JSON contains the setup record and companion
record; no parallel Battle Smith save store exists. Round-trips preserve exact
ownership, stable companion ID, current resources, setup, lifecycle, and
generation.

Legacy Steel Defenders migrate only when their source and statblock identity
select one unambiguous registered descriptor. An exact zero-HP EFA record
becomes `dead` with unknown timing rather than receiving an invented timestamp
or free healing. TCE, RHW, generic, wrong-source, name-only, ambiguous, and
duplicate records are left unclaimed with explicit migration status.

Respec evaluates candidate state independently. Retaining the exact grant
preserves or rebinds the legal defender; losing it deactivates only the exact
owned generation and removes only exact EFA spells, proficiencies, resources,
and receipts.

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

## Focused Jest tests

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

The broader Battle Smith operation/source gate is:

```bash
npm run test:unit -- \
  test/jest/charactersheet/CharacterSheetBattleSmithEfaCompanion.test.js \
  test/jest/charactersheet/CharacterSheetBattleSmithEfa.test.js \
  test/jest/charactersheet/CharacterSheetBattleSmithArcaneJolt.test.js \
  test/jest/charactersheet/CharacterSheetBattleSmithCompanionState.test.js \
  test/jest/charactersheet/CharacterSheetCompanionRules.test.js \
  test/jest/charactersheet/CharacterSheetCompanions.test.js \
  --runInBand --no-coverage
```

## Comprehensive E2E

The factory-driven Playwright spec is
`test/e2e/specs/tgtt-efa-battle-smith-artificer.spec.ts`. It must keep the
standard #1-#22 map visible, use page objects rather than raw spec locators,
and attach measurable effects to every mechanical feature row. It covers
exact-source progression, setup, Battle Ready loadout differences, companion
scaling and operations, Arcane Jolt/Improved Defender, lifecycle interaction,
rest behavior, and export round-trip.

Use a fresh port so `reuseExistingServer` cannot select another worktree:

```bash
PW_PORT=8097 PW_WORKERS=1 RUN_MEGA=1 \
  npm run test:e2e -- test/e2e/specs/tgtt-efa-battle-smith-artificer.spec.ts
```
