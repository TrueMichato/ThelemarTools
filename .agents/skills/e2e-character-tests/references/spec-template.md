# Spec Template + Authoring Checklist

Use this template to add a new TGTT character build spec.  Spec files
should be **thin** — declare a `CharacterSpec`, let the factory generate
the canonical 7-test set.

## Single-class template

```ts
import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_<NAME>} from "../utils/characterBuilder";

/**
 * #N — <Class> <Subclass> <Race> (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - <one-line: signature class mechanic>
 *   - <one-line: subclass mechanic>
 *   - <one-line: capstone>
 */
describeCharacter({
	preset: PRESET_FULL_<NAME>,
	displayName: "<Display Name>",
	signatureToggle: /<class-defining toggle regex>/i,
	midTierLoadout: [
		{name: "Cloak of Protection", source: "XDMG", attune: true},
	],
	usage: {
		atLevel: 5,
		castSpellSlotLevel: 1,                // omit for non-casters
		useResourceName: "<Resource>",        // omit if no class resource
		expectLongRestRestores: true,         // omit for non-casters
		attackName: /<weapon regex>/i,        // omit if no auto-equipped weapon
		skillRoll: {name: "<Skill>"},
		shortRestRestores: {resourceName: "<SR Resource>", expectAfter: <n>}
			// or {skip: true} with reason
		,
		concentrationCheck: {castSpell: "<Spell>", thenAction: "damage", expectActive: false}
			// or {skip: true} with reason
		,
		deathSaves: true,
		applyCondition: {name: "<condition>"}
			// or {skip: true} with reason
		,
		featAbility: {skip: true},  // populate only if the build takes a
		                            // toggleable feat (Lucky, GWM, …)
	},
	milestones: {
		1:  {totalLevel: 1,  minMaxHp: <n>, expectToggles: [/<L1 toggle>/i]},
		3:  {totalLevel: 3,  spellSlots: {2: 2}, expectToggles: [/<L3 sub feature>/i]},
		5:  {totalLevel: 5,  spellSlots: {3: 2}, expectResources: {"<Resource>": <n>}},
		11: {totalLevel: 11, spellSlots: {6: 1}},
		17: {totalLevel: 17, spellSlots: {9: 1}},
		20: {totalLevel: 20, expectToggles: [/<capstone>/i]},
	},
});
```

## Multiclass template

```ts
import {describeMulticlassCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_<PRIMARY>} from "../utils/characterBuilder";

describeMulticlassCharacter({
	displayName: "<Class A> <X> / <Class B> <Y> <Race>",
	preset: {...PRESET_FULL_<PRIMARY>, name: "Char Name"},
	plan: [
		{className: "<A>", classSource: "TGTT",
			subclassName: "<Sub A>", subclassSource: "TGTT-2024",
			signatureSpells: [...], toTotalLevel: <X>},
		{className: "<B>", classSource: "TGTT",
			subclassName: "<Sub B>", subclassSource: "TGTT-2014",
			signatureSpells: [...], toTotalLevel: <X+Y>},
	],
	usageAfterEachLeg: [
		// Probe after leg 0 (primary)
		{
			castSpellSlotLevel: 1,
			useResourceName: "<Resource A>",
			attackName: /<weapon>/i,
			skillRoll: {name: "<Skill>"},
		},
		// Probe after leg 1 (multiclass entry)
		{
			castSpellSlotLevel: 1,
			useResourceName: "<Resource B>",
			skillRoll: {name: "<Skill>"},
		},
	],
	finalMilestone: {
		totalLevel: <X+Y>,
		spellSlots: {1: 4, 5: 2, 7: 1, 9: 1},
		expectResources: {"<Resource>": <n>},
	},
});
```

## 10-step authoring checklist

Walk through this before submitting a new spec.

1. **Preset exists.** A `PRESET_FULL_<NAME>` constant lives in
   `characterBuilder.ts`.  If not, add one — the preset must be enough
   for the wizard to complete L1 creation.
2. **`displayName` is human-readable.** Include race + (sub)class.
3. **`signatureToggle` matches at least one toggleable feature** that
   appears at L5.  Use a `RegExp` with alternates; check the
   product (`getToggleableFeatureNames()` output) at L5 if unsure.
4. **`midTierLoadout` includes ≥1 item** that's expected to change AC,
   attack, or DC at L5.  Cloak of Protection is the safe default.
5. **`milestones` covers L1 / L3 / L5 / L11 / L17 / L20.**  Each must
   include `totalLevel`.  Add `spellSlots` for casters,
   `expectResources` for resource-bearing classes,
   `expectToggles` for the signature feature at the level it arrives.
6. **`usage` block populated for every check in the standard.**
   Use `{skip: true}` with a one-line comment for any probe that
   genuinely doesn't apply or is blocked by a CS-BUG.
7. **Skip sentinels carry a reason.**  `// blocked by CS-BUG-NNN`,
   `// monks don't have a concentration spell`, etc.
8. **Test names follow factory convention** — don't override.
9. **`skipL7` / `skipMega` only when blocked by a documented product
   bug** that crashes the wizard before the test can complete.
10. **Run the spec once locally before committing**:
    ```bash
    npx playwright test test/e2e/specs/tgtt-<file>.spec.ts --reporter=list
    RUN_MEGA=1 npx playwright test test/e2e/specs/tgtt-<file>.spec.ts --reporter=list  # for the MEGA path
    ```
    All tests must either pass or skip with a documented reason.

## Naming conventions

- File: `tgtt-<archetype>-<class>-<race>.spec.ts` (e.g.
  `tgtt-mercy-monk-changeling.spec.ts`).
- `displayName`: `"<Subclass> <Class> <Race>"` (Title Case).
- Preset: `PRESET_FULL_<ARCHETYPE>_<RACE>` (UPPER_SNAKE).

## Things to NOT put in a spec

- Open-coded level-up loops (use `levelUpTo`).
- Direct DOM selectors (use page-object methods).
- Per-test `test.beforeEach` / `test.afterEach` (factory provides these).
- One-off helper functions (extend
  `comprehensiveBuildHelpers.ts` or `CharacterSheetPage` instead).
- Manual workarounds for a flaky probe (fix the probe in the page
  object, or skip it cleanly).
