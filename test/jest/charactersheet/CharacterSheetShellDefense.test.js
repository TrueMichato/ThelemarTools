/**
 * Shell Defense (Tortle race trait) — round-11 bug #7, session S5.
 *
 * Shell Defense must be a proper ACTIVATABLE state, not an always-on/passive modifier:
 *  - OFF by default (no AC/speed/save effect until the player withdraws into the shell);
 *  - surfaced as an activation affordance via getActivatableFeatures();
 *  - while ACTIVE: +4 AC, advantage on STR/CON saves, speed 0, disadvantage on DEX saves,
 *    prone (defensive attack effects), and no reactions;
 *  - deactivating reverts every effect.
 *
 * These assert REAL mechanics (AC delta, walk speed, advantage/disadvantage flags), not
 * existence-only / level counts.
 */

import "./setup.js";

let CharacterSheetState;
let state;

const SHELL_DEFENSE_FEATURE = {
	name: "Shell Defense",
	source: "TTP",
	description: "You can withdraw into your shell as an action. Until you emerge, you gain a +4 bonus to AC, and you have advantage on Strength and Constitution saving throws. While in your shell, you are prone, your speed is 0 and can't increase, you have disadvantage on Dexterity saving throws, you can't take reactions, and the only action you can take is a bonus action to emerge from your shell.",
	entries: ["Shell Defense effect"],
};

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

beforeEach(() => {
	state = new CharacterSheetState();
	state.setAbilityBase("str", 12);
	state.setAbilityBase("dex", 12);
	state.setAbilityBase("con", 12);
	state.addFeature({...SHELL_DEFENSE_FEATURE});
});

describe("Shell Defense — detection & affordance", () => {
	test("is detected as an activatable toggle state, not passive", () => {
		const info = CharacterSheetState.detectActivatableFeature({...SHELL_DEFENSE_FEATURE});
		expect(info).not.toBeNull();
		expect(info.stateTypeId).toBe("shellDefense");
		expect(info.isToggle).toBe(true);
		expect(info.interactionMode).not.toBe("passive");
	});

	test("detection returns the full state-type effect set verbatim (not lossy parsed effects)", () => {
		const info = CharacterSheetState.detectActivatableFeature({...SHELL_DEFENSE_FEATURE});
		// Must be the canonical state-type effects so speed-0 and DEX-disadvantage survive
		// (parseEffectsFromDescription cannot extract either).
		expect(info.effects).toBe(CharacterSheetState.ACTIVE_STATE_TYPES.shellDefense.effects);

		const effs = info.effects;
		expect(effs.some(e => e.type === "bonus" && e.target === "ac" && e.value === 4)).toBe(true);
		expect(effs.some(e => e.type === "advantage" && e.target === "save:str")).toBe(true);
		expect(effs.some(e => e.type === "advantage" && e.target === "save:con")).toBe(true);
		expect(effs.some(e => e.type === "setSpeed" && e.value === 0)).toBe(true);
		expect(effs.some(e => e.type === "disadvantage" && e.target === "save:dex")).toBe(true);
		// Prone (defensive attack effects) while withdrawn.
		expect(effs.some(e => e.type === "disadvantage" && e.target === "attack")).toBe(true);
		expect(effs.some(e => e.type === "advantage" && e.target === "meleeAttacksAgainst")).toBe(true);
		expect(effs.some(e => e.type === "disadvantage" && e.target === "rangedAttacksAgainst")).toBe(true);
		// "Can't take reactions" surfaced as a note.
		expect(effs.some(e => e.type === "note" && /reaction/i.test(e.value || ""))).toBe(true);
	});

	test("appears in getActivatableFeatures() so the sheet exposes an activation affordance", () => {
		const af = state.getActivatableFeatures().find(a => a.stateTypeId === "shellDefense");
		expect(af).toBeDefined();
		expect(af.feature?.name).toBe("Shell Defense");
		// Off by default => listed as available to activate, not already active.
		expect(af.isActive).toBe(false);
	});
});

describe("Shell Defense — OFF by default", () => {
	test("no Shell Defense effects apply before activation", () => {
		expect(state.isStateTypeActive("shellDefense")).toBe(false);
		expect(state.getBonusFromStates("ac")).toBe(0);
		expect(state.hasDisadvantageFromStates("save:dex")).toBe(false);
		expect(state.hasAdvantageFromStates("save:str")).toBe(false);
		expect(state.hasAdvantageFromStates("save:con")).toBe(false);
		// Walk speed is the normal (non-zero) base.
		expect(state.getWalkSpeed()).toBeGreaterThan(0);
	});

	test("AC and walk speed match an identical character WITHOUT the trait (guards the old always-on regression)", () => {
		const baseline = new CharacterSheetState();
		baseline.setAbilityBase("str", 12);
		baseline.setAbilityBase("dex", 12);
		baseline.setAbilityBase("con", 12);
		// `state` has the Shell Defense feature; `baseline` does not. With the trait
		// inactive they must be identical — i.e. the trait contributes NOTHING passively.
		expect(state.getAc()).toBe(baseline.getAc());
		expect(state.getWalkSpeed()).toBe(baseline.getWalkSpeed());
	});
});

describe("Shell Defense — effects WHILE ACTIVE", () => {
	test("activating applies +4 AC, speed 0, DEX-save disadvantage, STR/CON-save advantage", () => {
		const baseAc = state.getAc();
		const baseWalk = state.getWalkSpeed();
		expect(baseWalk).toBeGreaterThan(0);

		state.activateState("shellDefense");

		expect(state.isStateTypeActive("shellDefense")).toBe(true);
		expect(state.getAc()).toBe(baseAc + 4);
		expect(state.getWalkSpeed()).toBe(0);
		expect(state.hasDisadvantageFromStates("save:dex")).toBe(true);
		expect(state.hasAdvantageFromStates("save:str")).toBe(true);
		expect(state.hasAdvantageFromStates("save:con")).toBe(true);
	});

	test("does NOT grant advantage on DEX saves or disadvantage on STR/CON saves", () => {
		state.activateState("shellDefense");
		expect(state.hasAdvantageFromStates("save:dex")).toBe(false);
		expect(state.hasDisadvantageFromStates("save:str")).toBe(false);
		expect(state.hasDisadvantageFromStates("save:con")).toBe(false);
	});

	test("once active it is no longer listed as available to activate", () => {
		state.activateState("shellDefense");
		const af = state.getActivatableFeatures().find(a => a.stateTypeId === "shellDefense");
		expect(af?.isActive).toBe(true);
	});
});

describe("Shell Defense — activation through the sheet's affordance path", () => {
	// Mirrors charactersheet.js `_activateFeatureState`: for a non-generic state type
	// with non-empty effects, `shouldParseEffects` is false, so it activates with
	// customEffects:null and the canonical state-type effects apply. This proves the
	// UI bridge passes the right stateTypeId/payload (not a lossy parsed copy).
	test("activating via the activatable entry (customEffects null) applies the canonical effects", () => {
		const af = state.getActivatableFeatures().find(a => a.stateTypeId === "shellDefense");
		expect(af).toBeDefined();

		const stateType = CharacterSheetState.ACTIVE_STATE_TYPES[af.stateTypeId];
		const shouldParseEffects = af.stateTypeId === "custom"
			|| !stateType
			|| stateType.isGeneric
			|| (stateType.effects && stateType.effects.length === 0);
		expect(shouldParseEffects).toBe(false);

		const baseAc = state.getAc();
		state.activateState(af.stateTypeId, {
			sourceFeatureId: af.feature?.id,
			customEffects: shouldParseEffects ? af.effects : null,
		});

		expect(state.isStateTypeActive("shellDefense")).toBe(true);
		expect(state.getAc()).toBe(baseAc + 4);
		expect(state.getWalkSpeed()).toBe(0);
		expect(state.hasDisadvantageFromStates("save:dex")).toBe(true);
	});
});

describe("Shell Defense — deactivation reverts everything", () => {
	test("deactivating removes the AC, speed, and save effects", () => {
		const baseAc = state.getAc();
		const baseWalk = state.getWalkSpeed();

		state.activateState("shellDefense");
		expect(state.getAc()).toBe(baseAc + 4);

		state.deactivateState("shellDefense");

		expect(state.isStateTypeActive("shellDefense")).toBe(false);
		expect(state.getAc()).toBe(baseAc);
		expect(state.getWalkSpeed()).toBe(baseWalk);
		expect(state.hasDisadvantageFromStates("save:dex")).toBe(false);
		expect(state.hasAdvantageFromStates("save:str")).toBe(false);
		expect(state.hasAdvantageFromStates("save:con")).toBe(false);
	});
});

describe("Shell Defense — regression: other toggle states still classify", () => {
	test("Rage and Bladesong are still detected as their own state types", () => {
		const rage = CharacterSheetState.detectActivatableFeature({
			name: "Rage",
			description: "On your turn, you can enter a rage as a bonus action.",
		});
		expect(rage?.stateTypeId).toBe("rage");

		const bladesong = CharacterSheetState.detectActivatableFeature({
			name: "Bladesong",
			description: "You can invoke an ancient elven magic called the Bladesong as a bonus action.",
		});
		expect(bladesong?.stateTypeId).toBe("bladesong");
	});
});
