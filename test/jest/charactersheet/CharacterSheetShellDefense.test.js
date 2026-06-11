/**
 * Shell Defense (Tortle race trait) — round-11 bug #7, session S5.
 *
 * Shell Defense must be a proper ACTIVATABLE state, not an always-on/passive modifier:
 *  - OFF by default (no AC/speed/save effect until the player withdraws into the shell);
 *  - surfaced as an activation affordance via getActivatableFeatures();
 *  - while ACTIVE: +4 AC, advantage on STR/CON saves, speed 0, disadvantage on DEX saves,
 *    the real Prone condition (defensive attack effects + Conditions UI), and no reactions;
 *  - deactivating reverts every effect (and removes the Prone condition it added).
 *
 * These assert REAL mechanics (AC delta, walk speed, advantage/disadvantage flags,
 * the Prone condition), not existence-only / level counts.
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
		// "Can't take reactions" surfaced as a note.
		expect(effs.some(e => e.type === "note" && /reaction/i.test(e.value || ""))).toBe(true);
		// Prone is modeled as the REAL condition (addsConditions), not inlined attack effects,
		// so it surfaces in the Conditions UI rather than being a hidden side effect.
		expect(CharacterSheetState.ACTIVE_STATE_TYPES.shellDefense.addsConditions).toContain("Prone");
		expect(effs.some(e => e.target === "attack")).toBe(false);
		expect(effs.some(e => /Against$/.test(e.target || ""))).toBe(false);
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

	test("activating adds the real Prone condition (surfaced in Conditions), giving attack disadvantage", () => {
		expect(state.getConditionNames().map(n => n.toLowerCase())).not.toContain("prone");

		state.activateState("shellDefense");

		// The actual condition is present (Conditions UI), not just hidden attack effects.
		expect(state.getConditionNames().map(n => n.toLowerCase())).toContain("prone");
		// Prone's own effects compose: disadvantage on your attacks.
		expect(state.hasDisadvantageFromStates("attack")).toBe(true);
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
	test("deactivating removes the AC, speed, save effects, and the Prone condition", () => {
		const baseAc = state.getAc();
		const baseWalk = state.getWalkSpeed();

		state.activateState("shellDefense");
		expect(state.getAc()).toBe(baseAc + 4);
		expect(state.getConditionNames().map(n => n.toLowerCase())).toContain("prone");

		state.deactivateState("shellDefense");

		expect(state.isStateTypeActive("shellDefense")).toBe(false);
		expect(state.getAc()).toBe(baseAc);
		expect(state.getWalkSpeed()).toBe(baseWalk);
		expect(state.hasDisadvantageFromStates("save:dex")).toBe(false);
		expect(state.hasAdvantageFromStates("save:str")).toBe(false);
		expect(state.hasAdvantageFromStates("save:con")).toBe(false);
		// The Prone condition Shell Defense added is gone.
		expect(state.getConditionNames().map(n => n.toLowerCase())).not.toContain("prone");
		expect(state.hasDisadvantageFromStates("attack")).toBe(false);
	});

	test("deactivating does NOT remove a Prone condition the character already had", () => {
		// Knocked prone independently, BEFORE shell defense.
		state.addCondition("Prone");
		expect(state.getConditionNames().map(n => n.toLowerCase())).toContain("prone");

		state.activateState("shellDefense");
		state.deactivateState("shellDefense");

		// Shell Defense only manages the condition IT added; the pre-existing prone stays.
		expect(state.getConditionNames().map(n => n.toLowerCase())).toContain("prone");
	});
});

describe("Shell Defense — part a: stale persisted passive modifier is migrated away on load", () => {
	test("a pre-fix save with an enabled Shell Defense AC modifier loads with that modifier stripped", () => {
		// Simulate a character SAVED before Shell Defense became activatable: the
		// description's "+4 bonus to AC" was registered as an ENABLED passive named
		// modifier and persisted. loadFromJson restores namedModifiers verbatim, so
		// without a migration the +4 AC would leak while the toggle is OFF.
		const json = state.toJson();
		json.namedModifiers = [
			...(json.namedModifiers || []),
			{name: "Shell Defense", type: "ac", value: 4, enabled: true, note: "From Shell Defense"},
		];

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);

		// The stale modifier is gone…
		expect(loaded.getNamedModifiers().some(m => m.name === "Shell Defense")).toBe(false);
		// …and the state is OFF, so AC matches an identical character WITHOUT the trait.
		const baseline = new CharacterSheetState();
		baseline.setAbilityBase("str", 12);
		baseline.setAbilityBase("dex", 12);
		baseline.setAbilityBase("con", 12);
		expect(loaded.isStateTypeActive("shellDefense")).toBe(false);
		expect(loaded.getAc()).toBe(baseline.getAc());
	});

	test("the migration is idempotent and leaves unrelated modifiers untouched", () => {
		const json = state.toJson();
		json.namedModifiers = [
			{name: "Shell Defense", type: "ac", value: 4, enabled: true, note: "From Shell Defense"},
			{name: "Ring of Protection", type: "ac", value: 1, enabled: true, note: "From Ring of Protection"},
		];

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		// Running load again must be a no-op (no resurrection, no double-strip side effects).
		loaded.loadFromJson(loaded.toJson());

		const names = loaded.getNamedModifiers().map(m => m.name);
		expect(names).not.toContain("Shell Defense");
		expect(names).toContain("Ring of Protection");
	});
});

describe("Shell Defense — round-trip while active", () => {
	test("saving while active then loading and deactivating still removes the Prone condition", () => {
		state.activateState("shellDefense");
		expect(state.getConditionNames().map(n => n.toLowerCase())).toContain("prone");

		// Round-trip: the _managedConditions tracking rides on the active-state object.
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.isStateTypeActive("shellDefense")).toBe(true);
		expect(loaded.getConditionNames().map(n => n.toLowerCase())).toContain("prone");

		loaded.deactivateState("shellDefense");
		expect(loaded.getConditionNames().map(n => n.toLowerCase())).not.toContain("prone");
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
