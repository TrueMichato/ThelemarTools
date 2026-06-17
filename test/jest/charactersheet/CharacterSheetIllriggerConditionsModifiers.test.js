/**
 * Regression tests for the S-B round-23 Illrigger/Thelemar fixes:
 *   #2  Advantage/disadvantage-encoded named modifiers must NOT leak a flat +1 onto
 *       the affected ability's checks/saves (phantom +1 to WIS/CHA rolls).
 *   #16 A Thelemar (TGTT) character must apply the `_tgtt` condition variants (extra
 *       verbal/somatic-spell constraints, concentration-save disadvantage) even when a
 *       feature adds the condition with the granting feature's name as `source`.
 *   #11 Intransigent's charmed immunity is gated on consciousness ("while conscious")
 *       and source-aware, plus an ally-count chooser that drives the summary label.
 *
 * Assertions target REAL mechanics (modifier totals, applied condition effects,
 * immunity booleans, rendered summary strings) — never level counts.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/** Minimal non-Thelemar character. */
function makeBaseCharacter () {
	const state = new CharacterSheetState();
	state.setName("Test Character");
	state.setAbilityBase("str", 10);
	state.setAbilityBase("dex", 10);
	state.setAbilityBase("con", 10);
	state.setAbilityBase("int", 10);
	state.setAbilityBase("wis", 10);
	state.setAbilityBase("cha", 10);
	state.addClass({name: "Fighter", source: "XPHB", level: 5});
	state.setHp(40, 40, 0); // conscious by default (HP > 0)
	return state;
}

/** Character that plays under Thelemar (TGTT) rules via a TGTT-sourced class. */
function makeThelemarCharacter () {
	const state = makeBaseCharacter();
	state.addClass({name: "Illrigger", source: "TGTT-IllR", level: 11});
	return state;
}

// =============================================================================
// #2 — Advantage-encoded modifiers do not leak a flat numeric bonus
// =============================================================================
describe("#2 advantage-encoded named modifiers do not add a flat bonus", () => {
	it("check:<abil>:advantage (sentinel value 1) adds 0 to the ability-check custom mod", () => {
		const state = makeBaseCharacter();
		// Mirrors Moloch's Blessing / Forked Tongue Improvement on the real character.
		state.addNamedModifier({name: "Moloch's Blessing", type: "check:cha:advantage", value: 1});
		state.addNamedModifier({name: "Forked Tongue", type: "check:wis:advantage", value: 1});

		expect(state.getAbilityCheckCustomMod("cha")).toBe(0);
		expect(state.getAbilityCheckCustomMod("wis")).toBe(0);
	});

	it("save:advantage:<subtype> (sentinel value 1) adds 0 to the saving-throw custom mod", () => {
		const state = makeBaseCharacter();
		state.addNamedModifier({name: "Devil's Due", type: "save:advantage:poisoned", value: 1});

		// getSaveMod = base (prof? no save prof) + custom; CON base mod 0, no save prof → 0.
		expect(state.getSaveMod("con")).toBe(0);
		expect(state._data.customModifiers.savingThrows.con || 0).toBe(0);
	});

	it("a genuine numeric check modifier is still applied", () => {
		const state = makeBaseCharacter();
		state.addNamedModifier({name: "Guidance-like", type: "check:cha", value: 2});
		expect(state.getAbilityCheckCustomMod("cha")).toBe(2);
	});

	it("advantage + a separate numeric modifier: only the numeric value counts", () => {
		const state = makeBaseCharacter();
		state.addNamedModifier({name: "Adv", type: "check:cha:advantage", value: 1});
		state.addNamedModifier({name: "Real bonus", type: "check:cha", value: 3});
		expect(state.getAbilityCheckCustomMod("cha")).toBe(3);
	});

	it("disadvantage-encoded modifiers also contribute 0 (no phantom penalty)", () => {
		const state = makeBaseCharacter();
		state.addNamedModifier({name: "Hex", type: "check:str:disadvantage", value: 1});
		expect(state.getAbilityCheckCustomMod("str")).toBe(0);
	});
});

// =============================================================================
// #16 — Thelemar characters apply the _tgtt condition variants
// =============================================================================
describe("#16 Thelemar characters resolve _tgtt condition variants", () => {
	it("detects Thelemar play from TGTT-sourced class content (not the universal defaults)", () => {
		// A pure-PHB build is NOT treated as Thelemar even though the fork defaults
		// exhaustionRules to "thelemar" and prioritySources to ["TGTT"].
		expect(makeBaseCharacter()._usesThelemarConditions()).toBe(false);

		const byClassSource = makeBaseCharacter();
		byClassSource.addClass({name: "Illrigger", source: "TGTT-IllR", level: 1});
		expect(byClassSource._usesThelemarConditions()).toBe(true);
	});

	it("applies the _tgtt Frightened (verbal-spell constraint) when a feature adds it by feature name", () => {
		const state = makeThelemarCharacter();
		// Source is the granting feature's NAME (how combat self-conditions are added),
		// NOT "TGTT" — the pre-fix bug resolved the generic variant here.
		state.addCondition({name: "Frightened", source: "Charm Enemy"});

		const active = state._data.activeStates.find(s => s.isCondition && s.conditionName.toLowerCase() === "frightened");
		expect(active).toBeTruthy();
		const types = active.customEffects.map(e => e.type);
		expect(types).toContain("verbalConstraint"); // TGTT-only effect
	});

	it("applies the _tgtt Poisoned (concentration-save disadvantage) for a Thelemar character", () => {
		const state = makeThelemarCharacter();
		state.addCondition({name: "Poisoned", source: "Hellish Rebuke"});

		const active = state._data.activeStates.find(s => s.isCondition && s.conditionName.toLowerCase() === "poisoned");
		expect(active).toBeTruthy();
		const hasConcSaveDisadv = active.customEffects.some(e => e.type === "disadvantage" && /concentration/.test(e.target || ""));
		expect(hasConcSaveDisadv).toBe(true);
	});

	it("non-Thelemar characters keep the generic variant (no leak / regression)", () => {
		const state = makeBaseCharacter();
		state.addCondition({name: "Frightened", source: "Some Feature"});

		const active = state._data.activeStates.find(s => s.isCondition && s.conditionName.toLowerCase() === "frightened");
		expect(active).toBeTruthy();
		const types = active.customEffects.map(e => e.type);
		expect(types).not.toContain("verbalConstraint");
	});

	it("charmed has no _tgtt variant — it deliberately falls back to the generic definition", () => {
		const state = makeThelemarCharacter();
		state.addCondition({name: "Charmed", source: "Some Fey"});

		const active = state._data.activeStates.find(s => s.isCondition && s.conditionName.toLowerCase() === "charmed");
		expect(active).toBeTruthy();
		// Generic charmed effects (no extra TGTT constraints) — matches the static def.
		const generic = CharacterSheetState.getConditionEffects("charmed");
		expect(active.customEffects.map(e => e.type)).toEqual(generic.effects.map(e => e.type));
	});

	it("an incapacitating _tgtt condition still breaks concentration for a Thelemar character", () => {
		const state = makeThelemarCharacter();
		state._data.concentrating = true;
		state.addCondition({name: "Stunned", source: "Feature"});
		expect(state._data.concentrating).toBeFalsy();
	});
});

// =============================================================================
// #11 — Intransigent: conscious-gated, source-aware charmed immunity + chooser
// =============================================================================
describe("#11 Intransigent charmed immunity is conscious-gated and source-aware", () => {
	it("a 'while conscious' condition immunity applies when conscious and drops at 0 HP", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("charmed", "while conscious");

		expect(state.isImmuneToCondition("charmed")).toBe(true);

		state._data.hp.current = 0; // unconscious
		expect(state.isUnconscious()).toBe(true);
		expect(state.isImmuneToCondition("charmed")).toBe(false);

		state._data.hp.current = state._data.hp.max; // conscious again
		expect(state.isImmuneToCondition("charmed")).toBe(true);
	});

	it("an unconditional source keeps the immunity active even while unconscious (multi-source safety)", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("charmed", "while conscious"); // Intransigent
		state._addClassFeatureConditionImmunity("charmed", null); // e.g. an ungated source

		state._data.hp.current = 0;
		expect(state.isImmuneToCondition("charmed")).toBe(true);
	});

	it("drops a 'while conscious' immunity under the Unconscious condition even at positive HP", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("charmed", "while conscious");

		expect(state.isImmuneToCondition("charmed")).toBe(true); // conscious, full HP

		state.addCondition("unconscious"); // e.g. magical sleep — HP still > 0
		expect(state.isUnconscious()).toBe(false); // HP-based check is false...
		expect(state.hasCondition("unconscious")).toBe(true); // ...but the condition is present
		expect(state.isImmuneToCondition("charmed")).toBe(false);
	});

	it("non-conscious conditionals (e.g. 'while raging') keep applying unconditionally", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("charmed", "while raging");

		state._data.hp.current = 0;
		expect(state.isImmuneToCondition("charmed")).toBe(true);
	});

	it("an unrelated unconditioned immunity is unaffected by the conscious gate", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("poisoned");
		state._data.hp.current = 0;
		expect(state.isImmuneToCondition("poisoned")).toBe(true);
	});

	it("condition-immunity metadata is reset when class features are torn down", () => {
		const state = makeBaseCharacter();
		state._addClassFeatureConditionImmunity("charmed", "while conscious");
		expect((state._data._conditionImmunityMeta || []).length).toBe(1);

		state._clearClassFeatureEffects();
		expect((state._data._conditionImmunityMeta || []).length).toBe(0);
		expect(state.isImmuneToCondition("charmed")).toBe(false);
	});
});

describe("#11 Intransigent ally-count chooser drives the feature summary", () => {
	it("stores a non-negative ally count only when the character has Intransigent", () => {
		const state = makeBaseCharacter();
		// No Intransigent → setter is a no-op (stale choices never linger).
		expect(state.setIntransigentAllyCount(4)).toBe(0);
		expect(state.getIntransigentAllyCount()).toBe(0);

		// Stub the calc gate to emulate a level-11 Hellspeaker.
		state.getFeatureCalculations = () => ({hasIntransigent: true});
		expect(state.setIntransigentAllyCount(3)).toBe(3);
		expect(state.getIntransigentAllyCount()).toBe(3);
		expect(state.setIntransigentAllyCount(-2)).toBe(0); // clamps negatives
		expect(state.setIntransigentAllyCount(2.7)).toBe(2); // floors fractions
	});

	it("renders a dynamic, conscious-gated summary that reflects the ally count", () => {
		const calcs = {hasIntransigent: true, intransigentRange: 10};
		const summaryFn = CharacterSheetState.ILLRIGGER_FEATURE_SUMMARIES.intransigent;

		const self0 = {getIntransigentAllyCount: () => 0};
		expect(summaryFn(calcs, self0)).toBe("You are immune to charmed (while conscious); may extend to creatures of your choice within 10 ft");

		const self1 = {getIntransigentAllyCount: () => 1};
		expect(summaryFn(calcs, self1)).toBe("You + 1 chosen creature within 10 ft are immune to charmed (while conscious)");

		const self3 = {getIntransigentAllyCount: () => 3};
		expect(summaryFn(calcs, self3)).toBe("You + 3 chosen creatures within 10 ft are immune to charmed (while conscious)");
	});
});
