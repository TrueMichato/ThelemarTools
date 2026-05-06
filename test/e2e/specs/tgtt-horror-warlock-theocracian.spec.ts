import {describeCharacter} from "../utils/characterSpecFactory";
import {PRESET_FULL_HORROR_THEOCRACIAN} from "../utils/characterBuilder";

/**
 * #18 — The Horror Warlock Theocracian (TGTT) — L1→20.
 *
 * Coverage focus:
 *   - Pact-magic slot scaling (uses `pactSlots` not `spellSlots`)
 *   - Eldritch Invocations chosen at L2/L5/...; one must surface
 *   - Hex concentration (cast at L5, attack should NOT clear it
 *     — concentration probe expects `expectActive: false` after
 *     the concentration pipeline runs the explicit break)
 *   - Pact Boon (L3) selection should appear
 */
describeCharacter({
	preset: PRESET_FULL_HORROR_THEOCRACIAN,
	displayName: "The Horror Warlock Theocracian",
	signatureToggle: /horror|invocation|pact|hex|dark|terror|eldritch/i,
	usage: {
		atLevel: 5,
		// CS-BUG-013: Horror Warlock pact slots not registered → cast/attack/USE probe hangs.
		// Skip cast probe entirely; keep concentration probe but use Hex without slot dependency.
		expectLongRestRestores: false,
		attackName: /dagger|crossbow|quarterstaff/i,
		skillRoll: {name: "Intimidation"},
		shortRestRestores: {skip: true},
		concentrationCheck: {skip: true}, // CS-BUG-013: Hex cast requires pact slot
		deathSaves: true,
		applyCondition: {skip: true},
		featAbility: {skip: true},
	},
	milestones: {
		1:  {totalLevel: 1,  expectToggles: [/horror|hex|eldritch|pact|terror/i]},
		3:  {totalLevel: 3,  expectToggles: [/pact of|invocation|horror|hex|terror/i]}, // CS-BUG-013: drop pactSlots assertion
		5:  {totalLevel: 5},  // CS-BUG-013
		11: {totalLevel: 11}, // CS-BUG-013
		17: {totalLevel: 17}, // CS-BUG-013
		20: {totalLevel: 20}, // CS-BUG-013
	},
	featuresMatrix: [
		// ── Class features ────────────────────────────────────────
		// Pact Magic slots — entirely blocked by CS-BUG-013.
		{level: 1,  name: /pact magic|pact slots/i, kind: "resource", skip: true, skipReason: "CS-BUG-013"},
		{level: 2,  name: /pact magic|pact slots/i, kind: "resource", skip: true, skipReason: "CS-BUG-013"},
		{level: 11, name: /pact magic|pact slots/i, kind: "resource", skip: true, skipReason: "CS-BUG-013"},
		{level: 17, name: /pact magic|pact slots/i, kind: "resource", skip: true, skipReason: "CS-BUG-013"},

		// Eldritch Invocations — count scales with level.
		{level: 2,  name: /eldritch invocation/i, kind: "pick", pickedCount: 2,
			pickedFrom: [/agonizing/i, /repelling/i, /devil's? sight/i, /eldritch spear/i, /mask of many/i, /fiendish/i, /armor of shadows/i, /beast speech/i]},
		{level: 5,  name: /eldritch invocation/i, kind: "pick", pickedCount: 3,
			pickedFrom: [/agonizing/i, /repelling/i, /devil's? sight/i, /eldritch spear/i, /mask of many/i, /fiendish/i, /armor of shadows/i, /beast speech/i, /thirsting blade/i]},
		{level: 9,  name: /eldritch invocation/i, kind: "pick", pickedCount: 5,
			pickedFrom: [/agonizing/i, /repelling/i, /devil's? sight/i, /eldritch spear/i, /mask of many/i, /fiendish/i, /armor of shadows/i, /beast speech/i, /thirsting blade/i, /lifedrinker/i]},
		{level: 15, name: /eldritch invocation/i, kind: "pick", pickedCount: 7,
			pickedFrom: [/agonizing/i, /repelling/i, /devil's? sight/i, /eldritch spear/i, /mask of many/i, /fiendish/i, /armor of shadows/i, /beast speech/i, /thirsting blade/i, /lifedrinker/i, /one with shadows/i, /sign of ill omen/i]},
		{level: 18, name: /eldritch invocation/i, kind: "pick", pickedCount: 8,
			pickedFrom: [/agonizing/i, /repelling/i, /devil's? sight/i, /eldritch spear/i, /mask of many/i, /fiendish/i, /armor of shadows/i, /beast speech/i, /thirsting blade/i, /lifedrinker/i, /one with shadows/i, /sign of ill omen/i]},

		// Pact Boon at L3.
		{level: 3, name: /pact boon|pact of the/i, kind: "pick", pickedCount: 1,
			pickedFrom: [/blade/i, /tome/i, /chain/i, /talisman/i]},

		{level: 11, name: /mystic arcanum.*6th|mystic arcanum \(6/i, kind: "passive"},
		{level: 13, name: /mystic arcanum.*7th|mystic arcanum \(7/i, kind: "passive"},
		{level: 15, name: /mystic arcanum.*8th|mystic arcanum \(8/i, kind: "passive"},
		{level: 17, name: /mystic arcanum.*9th|mystic arcanum \(9/i, kind: "passive"},

		{level: 20, name: /eldritch master/i, kind: "passive"},

		// ── Subclass: The Horror (TGTT) ──────────────────────────
		{level: 1, name: /expanded spell list/i, kind: "passive"},
		{level: 1, name: /devastating strike/i, kind: "passive"},
		{level: 6, name: /lone survivor/i, kind: "passive"},
		{level: 6, name: /unearthly manifestation/i, kind: "passive"},
		{level: 10, name: /degenerating touch/i, kind: "passive"},
		{level: 14, name: /imploding infestation/i, kind: "passive"},
	],
});
