/**
 * Circle of the Zodiac (TGTT) — Zodiac Form: Month constellation forms.
 *
 * Zodiac Form is an activatable state (via Wild Shape) that lets the druid
 * choose one of 12 monthly constellation forms. Each form applies concrete,
 * displayed effects via the active-state / customEffects system.
 *
 * This suite asserts the actual computed effects of representative forms, plus
 * the form-detection, exclusivity, and lifecycle wiring:
 *  - ZODIAC_FORM_DEFS enumerates the 12 month forms.
 *  - detectActivatableFeature maps "Zodiac Form: Month" to the zodiacForm state
 *    type (not wildShape) and carries stateType + needsFormChoice.
 *  - Passive forms (Bulette, Aurochs, Horse, Octopus, Cat) inject their effects
 *    into the derived stats (AC, speeds, advantage, roll floor).
 *  - Triggered/info forms (Bee, Phoenix, Peacock) surface a readable label with
 *    the exact computed value.
 *  - Wild Shape <-> Zodiac Form mutual exclusivity is enforced.
 *  - Deactivation clears the effects; getActiveZodiacForm reports the form.
 *  - The active form round-trips through save/load.
 */

import "./setup.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

function makeZodiacDruid (level = 3, wisBase = 16) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Druid",
		source: "TGTT",
		level,
		subclass: {name: "Circle of the Stars", shortName: "Stars", source: "TGTT"},
	});
	state.setAbilityBase("wis", wisBase);
	return state;
}

/** Activate a Zodiac Form by id, mirroring what the controller does. */
function activateForm (state, formId) {
	state.activateZodiacForm(formId);
	return CharacterSheetState.getZodiacFormDef(formId);
}

describe("Zodiac Form — definitions", () => {
	it("enumerates 12 month constellation forms", () => {
		const months = CharacterSheetState.ZODIAC_FORM_DEFS.filter(d => d.tier === "month");
		expect(months.length).toBe(12);
		const names = months.map(d => d.name).sort();
		expect(names).toEqual([
			"Aurochs", "Beaver", "Bee", "Bulette", "Cat", "Griffon",
			"Horse", "Hound", "Octopus", "Peacock", "Phoenix", "Roc",
		]);
	});

	it("every form definition exposes id/name/icon/getEffects", () => {
		for (const def of CharacterSheetState.ZODIAC_FORM_DEFS) {
			expect(typeof def.id).toBe("string");
			expect(typeof def.name).toBe("string");
			expect(typeof def.getEffects).toBe("function");
		}
	});

	it("getZodiacFormDef resolves by id", () => {
		expect(CharacterSheetState.getZodiacFormDef("bulette").name).toBe("Bulette");
		expect(CharacterSheetState.getZodiacFormDef("nope")).toBeNull();
	});
});

describe("Zodiac Form — detection", () => {
	it("maps 'Zodiac Form: Month' to the zodiacForm state type, not wildShape", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Zodiac Form: Month",
			description: "As a bonus action, you can expend a use of your Wild Shape feature to assume a constellation form for 10 minutes.",
		});
		expect(info).not.toBeNull();
		expect(info.stateTypeId).toBe("zodiacForm");
		expect(info.needsFormChoice).toBe(true);
		expect(info.formTier).toBe("month");
		// Must carry stateType so getActivatableFeatures resolves the Wild Shape resource.
		expect(info.stateType).toBeDefined();
		expect(info.stateType.resourceName).toBe("Wild Shape");
	});

	it("still maps a real Wild Shape feature to wildShape", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Wild Shape",
			description: "You can use your action to magically assume the shape of a beast that you have seen before.",
		});
		expect(info?.stateTypeId).toBe("wildShape");
	});
});

describe("Zodiac Form — passive form effects", () => {
	it("Bulette grants an AC bonus of ceil(prof/2) and a burrow speed", () => {
		const state = makeZodiacDruid(9, 16); // prof +4 -> ceil(4/2)=2
		state.setSpeed("walk", 30);
		expect(state.getBonusFromStates("ac")).toBe(0);

		activateForm(state, "bulette");
		expect(state.getBonusFromStates("ac")).toBe(2);
		expect(state.getSpeed("burrow")).toBe(15); // floor(walk/2)
	});

	it("Aurochs grants advantage + proficiency to Strength checks and saves", () => {
		const state = makeZodiacDruid(9, 16); // prof +4
		activateForm(state, "aurochs");
		expect(state.hasAdvantageFromStates("check:str")).toBe(true);
		expect(state.hasAdvantageFromStates("save:str")).toBe(true);
		expect(state.getSkillBonusFromStates("athletics", "str")).toBe(4);
		expect(state.getSaveBonusFromStates("str")).toBe(4);
	});

	it("Horse doubles the walking speed", () => {
		const state = makeZodiacDruid(3, 16);
		state.setSpeed("walk", 30);
		expect(state.getWalkSpeed()).toBe(30);
		activateForm(state, "horse");
		expect(state.getWalkSpeed()).toBe(60);
	});

	it("Octopus grants a swim speed equal to the walking speed", () => {
		const state = makeZodiacDruid(3, 16);
		state.setSpeed("walk", 30);
		expect(state.getSpeed("swim")).toBe(0);
		activateForm(state, "octopus");
		expect(state.getSpeed("swim")).toBe(30);
	});

	it("Cat sets a roll floor of 8 on Perception/Stealth/Acrobatics that clears on deactivation", () => {
		const state = makeZodiacDruid(3, 16);
		expect(state.aggregateModifiers("skill:perception").minimum).toBeNull();

		activateForm(state, "cat");
		expect(state.aggregateModifiers("skill:perception").minimum).toBe(8);
		expect(state.aggregateModifiers("skill:stealth").minimum).toBe(8);
		expect(state.aggregateModifiers("skill:acrobatics").minimum).toBe(8);
		// Unaffected skills get no floor.
		expect(state.aggregateModifiers("skill:arcana").minimum).toBeNull();

		state.deactivateState("zodiacForm");
		expect(state.aggregateModifiers("skill:perception").minimum).toBeNull();
	});
});

describe("Zodiac Form — triggered/info form effects", () => {
	it("Bee surfaces a readable label carrying the computed radiant damage", () => {
		const state = makeZodiacDruid(3, 16); // WIS +3 -> 1d8+3
		const def = activateForm(state, "bee");
		const effects = state.getActiveStateEffects().filter(e => e.type === "info");
		expect(effects.length).toBeGreaterThan(0);
		const beeDamage = state.getFeatureCalculations().beeDamage;
		expect(beeDamage).toBe("1d8+3");
		expect(effects.some(e => e.label.includes(beeDamage))).toBe(true);
		expect(def.name).toBe("Bee");
	});

	it("Phoenix surfaces a label with the stabilize heal value", () => {
		const state = makeZodiacDruid(3, 16);
		activateForm(state, "phoenix");
		const heal = state.getFeatureCalculations().phoenixStabilizeHeal;
		const infoLabels = state.getActiveStateEffects().filter(e => e.type === "info").map(e => e.label);
		expect(infoLabels.some(l => l.includes(String(heal)))).toBe(true);
	});

	it("Peacock surfaces a label with the Wisdom save DC", () => {
		const state = makeZodiacDruid(5, 16);
		state.setSpellcastingAbility("wis");
		activateForm(state, "peacock");
		const dc = state.getFeatureCalculations().peacockSaveDc;
		const infoLabels = state.getActiveStateEffects().filter(e => e.type === "info").map(e => e.label);
		expect(infoLabels.some(l => l.includes(String(dc)))).toBe(true);
	});
});

describe("Zodiac Form — exclusivity, lifecycle and persistence", () => {
	it("activating Zodiac Form deactivates Wild Shape and vice versa", () => {
		const state = makeZodiacDruid(3, 16);
		state.activateState("wildShape", {name: "Wild Shape"});
		expect(state.isStateTypeActive("wildShape")).toBe(true);

		activateForm(state, "bulette");
		expect(state.isStateTypeActive("zodiacForm")).toBe(true);
		expect(state.isStateTypeActive("wildShape")).toBe(false);

		state.activateState("wildShape", {name: "Wild Shape"});
		expect(state.isStateTypeActive("wildShape")).toBe(true);
		expect(state.isStateTypeActive("zodiacForm")).toBe(false);
	});

	it("getActiveZodiacForm reports the chosen form and clears on deactivation", () => {
		const state = makeZodiacDruid(3, 16);
		expect(state.getActiveZodiacForm()).toBeNull();

		activateForm(state, "horse");
		expect(state.getActiveZodiacForm()).toEqual({tier: "month", formId: "horse", formName: "Horse"});

		state.deactivateState("zodiacForm");
		expect(state.getActiveZodiacForm()).toBeNull();
	});

	it("re-activating with a different form replaces the chosen constellation", () => {
		const state = makeZodiacDruid(9, 16);
		state.setSpeed("walk", 30);
		activateForm(state, "bulette");
		expect(state.getBonusFromStates("ac")).toBe(2);

		activateForm(state, "horse");
		expect(state.getActiveZodiacForm().formName).toBe("Horse");
		// Bulette's AC bonus is gone; Horse's speed effect now applies.
		expect(state.getBonusFromStates("ac")).toBe(0);
		expect(state.getWalkSpeed()).toBe(60);
	});

	it("re-activating the SAME form does not compound a snapshot effect", () => {
		const state = makeZodiacDruid(3, 16);
		state.setSpeed("walk", 30);
		activateForm(state, "horse");
		expect(state.getWalkSpeed()).toBe(60);
		// Re-selecting Horse must snapshot from the base 30 ft, not the doubled 60.
		activateForm(state, "horse");
		expect(state.getWalkSpeed()).toBe(60);
	});

	it("switching from a speed-doubling form snapshots the base speed", () => {
		const state = makeZodiacDruid(9, 16);
		state.setSpeed("walk", 30);
		activateForm(state, "horse");
		expect(state.getWalkSpeed()).toBe(60);
		// Bulette's burrow must be floor(base/2)=15, not floor(60/2)=30.
		activateForm(state, "bulette");
		expect(state.getSpeed("burrow")).toBe(15);
		expect(state.getWalkSpeed()).toBe(30);
	});

	it("updates the displayed icon when switching forms", () => {
		const state = makeZodiacDruid(3, 16);
		activateForm(state, "horse");
		const horseIcon = CharacterSheetState.getZodiacFormDef("horse").icon;
		expect(state._data.activeStates.find(s => s.stateTypeId === "zodiacForm").icon).toBe(horseIcon);
		activateForm(state, "bulette");
		const buletteIcon = CharacterSheetState.getZodiacFormDef("bulette").icon;
		expect(state._data.activeStates.find(s => s.stateTypeId === "zodiacForm").icon).toBe(buletteIcon);
	});

	it("round-trips the active form (and its effects) through save/load", () => {
		const state = makeZodiacDruid(9, 16);
		state.setSpeed("walk", 30);
		activateForm(state, "bulette");
		expect(state.getBonusFromStates("ac")).toBe(2);

		const json = state.toJson();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);

		expect(reloaded.getActiveZodiacForm()).toEqual({tier: "month", formId: "bulette", formName: "Bulette"});
		expect(reloaded.getBonusFromStates("ac")).toBe(2);
	});
});
