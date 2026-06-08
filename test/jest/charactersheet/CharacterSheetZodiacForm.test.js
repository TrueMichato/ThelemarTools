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

	it("every month form definition carries non-empty entries for hovers", () => {
		const months = CharacterSheetState.ZODIAC_FORM_DEFS.filter(d => d.tier === "month");
		for (const def of months) {
			expect(Array.isArray(def.entries)).toBe(true);
			expect(def.entries.length).toBeGreaterThan(0);
			expect(def.entries.every(e => typeof e === "string" && e.length)).toBe(true);
		}
	});
});

describe("Zodiac Form — per-form effect matrix", () => {
	// Each month form must surface its primary declared effect: a passive that
	// mutates derived stats, or a readable info label for triggered abilities.
	const cases = [
		["beaver", (s) => {
			const labels = s.getActiveStateEffects().filter(e => e.type === "info").map(e => e.label);
			// Druid level 9 + proficiency +4 = 13; guard against bad interpolation.
			const label = labels.find(l => /reduce the damage/i.test(l));
			expect(label).toBeDefined();
			expect(label).not.toMatch(/undefined|NaN/i);
			expect(label).toContain("13");
		}],
		["aurochs", (s) => {
			expect(s.hasAdvantageFromStates("check:str")).toBe(true);
			expect(s.hasAdvantageFromStates("save:str")).toBe(true);
			expect(s.getCarrySizeBonusFromStates()).toBe(1);
		}],
		["horse", (s) => {
			s.setSpeed("walk", 30);
			s.deactivateState("zodiacForm");
			s.activateZodiacForm("horse");
			expect(s.getWalkSpeed()).toBe(60);
		}],
		["octopus", (s) => {
			s.setSpeed("walk", 30);
			s.deactivateState("zodiacForm");
			s.activateZodiacForm("octopus");
			expect(s.getSpeed("swim")).toBe(30);
			expect(s.getReachBonus()).toBe(5);
		}],
		["peacock", (s) => {
			s.setSpellcastingAbility("wis");
			const dc = s.getFeatureCalculations().peacockSaveDc;
			const label = s.getActiveStateEffects().filter(e => e.type === "info").map(e => e.label)
				.find(l => /Wisdom save/i.test(l));
			expect(label).toBeDefined();
			expect(label).not.toMatch(/undefined|NaN/i);
			expect(label).toContain(String(dc));
		}],
		["roc", (s) => {
			const label = s.getActiveStateEffects().filter(e => e.type === "info").map(e => e.label)
				.find(l => /Gust of Wind|Warding Wind/i.test(l));
			expect(label).toBeDefined();
			expect(label).not.toMatch(/undefined|NaN/i);
			expect(label).toMatch(/without expending a spell slot/i);
		}],
		["bee", (s) => {
			const dmg = s.getFeatureCalculations().beeDamage;
			const label = s.getActiveStateEffects().filter(e => e.type === "info").map(e => e.label)
				.find(l => /radiant damage/i.test(l));
			expect(label).toBeDefined();
			expect(label).not.toMatch(/undefined|NaN/i);
			expect(label).toContain(dmg);
		}],
		["hound", (s) => {
			const label = s.getActiveStateEffects().filter(e => e.type === "info").map(e => e.label)
				.find(l => /mark a creature/i.test(l));
			expect(label).toBeDefined();
			expect(label).not.toMatch(/undefined|NaN/i);
			expect(label).toMatch(/disadvantage/i);
		}],
		["cat", (s) => {
			expect(s.aggregateModifiers("skill:stealth").minimum).toBe(8);
		}],
		["griffon", (s) => {
			const label = s.getActiveStateEffects().filter(e => e.type === "info").map(e => e.label)
				.find(l => /frightened/i.test(l));
			expect(label).toBeDefined();
			expect(label).not.toMatch(/undefined|NaN/i);
			// Surfaces both halves: frightened-save advantage and the bonus melee attack.
			expect(label).toMatch(/extra melee attack|additional melee attack/i);
		}],
		["bulette", (s) => {
			s.setSpeed("walk", 30);
			s.deactivateState("zodiacForm");
			s.activateZodiacForm("bulette");
			expect(s.getBonusFromStates("ac")).toBeGreaterThan(0);
			expect(s.getSpeed("burrow")).toBe(15);
		}],
		["phoenix", (s) => {
			const heal = s.getFeatureCalculations().phoenixStabilizeHeal;
			const label = s.getActiveStateEffects().filter(e => e.type === "info").map(e => e.label)
				.find(l => /regain/i.test(l));
			expect(label).toBeDefined();
			expect(label).not.toMatch(/undefined|NaN/i);
			expect(label).toContain(heal);
		}],
	];

	it.each(cases)("%s applies its primary declared effect", (formId, assertEffect) => {
		const state = makeZodiacDruid(9, 16);
		state.setSpeed("walk", 30);
		state.setSpellcastingAbility("wis");
		activateForm(state, formId);
		assertEffect(state);
	});
});

describe("Zodiac Form — specific-form hover resolution", () => {
	let CharacterSheetClassUtils;
	beforeAll(async () => {
		await import("../../../js/charactersheet/charactersheet-class-utils.js");
		CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
	});

	it("resolves the hover entity to the CHOSEN form, not the generic feature", () => {
		const state = makeZodiacDruid(3, 16);
		activateForm(state, "octopus");
		const stateRec = state._data.activeStates.find(s => s.stateTypeId === "zodiacForm");
		const entity = CharacterSheetClassUtils.getZodiacFormHoverEntity(stateRec);
		expect(entity).not.toBeNull();
		// Hover heading is the specific constellation, not "Zodiac Form: Month".
		expect(entity.name).toBe("Octopus");
		expect(entity.type).toBe("entries");
		expect(entity.entries.join(" ")).toMatch(/reach increases by 5 feet/i);
	});

	it("returns null for a non-zodiac active state", () => {
		const state = makeZodiacDruid(3, 16);
		state.activateState("wildShape", {name: "Wild Shape"});
		const stateRec = state._data.activeStates.find(s => s.stateTypeId === "wildShape");
		expect(CharacterSheetClassUtils.getZodiacFormHoverEntity(stateRec)).toBeNull();
	});

	it("renders the hover with the SPECIFIC form's name while keeping the full state label visible", () => {
		// Both render paths (Overview + Combat) call buildInlineEntriesHoverLink
		// with (state.name, formEntity.name, formEntity.entries). Stub the
		// Renderer's hover so we can assert the label/name separation Bug 2 needs.
		// NB: class-utils captures `Renderer` from globalThis at import, so we
		// must MUTATE the existing object's `hover`, not replace `Renderer`.
		const prevHover = globalThis.Renderer.hover;
		const calls = [];
		globalThis.Renderer.hover = {getInlineHover: (entity) => { calls.push(entity); return {html: `data-vet-stub="1"`}; }};
		try {
			const html = CharacterSheetClassUtils.buildInlineEntriesHoverLink(
				"Zodiac Form: Octopus",
				"Octopus",
				CharacterSheetState.getZodiacFormDef("octopus").entries,
			);
			// Visible label stays the full active-state name...
			expect(html).toContain(">Zodiac Form: Octopus<");
			// ...but the hovered entry heading is the SPECIFIC constellation.
			expect(calls).toHaveLength(1);
			expect(calls[0].name).toBe("Octopus");
			expect(calls[0].entries.join(" ")).toMatch(/reach increases by 5 feet/i);
		} finally {
			globalThis.Renderer.hover = prevHover;
		}
	});

	it("HTML-escapes the visible label (sourced from save data)", () => {
		const prevHover = globalThis.Renderer.hover;
		globalThis.Renderer.hover = {getInlineHover: () => ({html: `data-vet-stub="1"`})};
		try {
			const html = CharacterSheetClassUtils.buildInlineEntriesHoverLink(
				`Zodiac <script> & "Form"`,
				"Octopus",
				["x"],
			);
			expect(html).toContain("&lt;script&gt;");
			expect(html).toContain("&amp;");
			expect(html).not.toContain("<script>");
		} finally {
			globalThis.Renderer.hover = prevHover;
		}
	});
});

describe("Zodiac Form — load migration heals older saves", () => {
	it("re-derives Octopus reach for a save whose snapshot predates the fix", () => {
		const state = makeZodiacDruid(3, 16);
		state.setSpeed("walk", 30);
		activateForm(state, "octopus");

		// Simulate an older persisted snapshot lacking the reach effect.
		const json = state.toJson();
		const zodiac = json.activeStates.find(s => s.stateTypeId === "zodiacForm");
		zodiac.customEffects = zodiac.customEffects.filter(e => e.type !== "reach" && e.target !== "reach");
		expect(zodiac.customEffects.some(e => e.type === "reach" || e.target === "reach")).toBe(false);

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);

		// Migration restores the reach bonus without disturbing the swim speed.
		expect(reloaded.getReachBonus()).toBe(5);
		expect(reloaded.getMeleeReach()).toBe(10);
		expect(reloaded.getSpeed("swim")).toBe(30);
	});

	it("does not compound a speed-doubling form on reload", () => {
		const state = makeZodiacDruid(3, 16);
		state.setSpeed("walk", 30);
		activateForm(state, "horse");
		expect(state.getWalkSpeed()).toBe(60);

		const json = state.toJson();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);
		// Re-derivation must snapshot from base 30, not the persisted 60.
		expect(reloaded.getWalkSpeed()).toBe(60);
	});

	it("heals an INACTIVE zodiac record alongside an active one without leaking effects", () => {
		// Hand-built save with two zodiac records: an ACTIVE Horse and an
		// INACTIVE Octopus whose persisted snapshot predates the reach fix.
		// (Runtime keeps a single record, but loadFromJson trusts the array;
		// the migration must heal every zodiac record it finds.)
		const seed = makeZodiacDruid(3, 16);
		seed.setSpeed("walk", 30);
		const json = seed.toJson();
		json.activeStates = [
			{
				id: "zodiacForm_horse",
				stateTypeId: "zodiacForm",
				name: "Zodiac Form: Horse",
				active: true,
				customEffects: [{type: "bonus", target: "speed:walk", value: 30}],
				zodiacForm: {tier: "month", formId: "horse", formName: "Horse"},
			},
			{
				id: "zodiacForm_octopus",
				stateTypeId: "zodiacForm",
				name: "Zodiac Form: Octopus",
				active: false,
				// Stale snapshot: swim only, no reach effect.
				customEffects: [{type: "swimSpeed", value: 30}],
				zodiacForm: {tier: "month", formId: "octopus", formName: "Octopus"},
			},
		];

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(json);

		// Active Horse still applies (walk doubled, not compounded); the inactive
		// Octopus contributes nothing to the live reach.
		expect(reloaded.getWalkSpeed()).toBe(60);
		expect(reloaded.getReachBonus()).toBe(0);

		// The inactive Octopus record has been re-derived to include the reach
		// effect (agreed `{type:"reach", value:N}` shape), so toggling it on
		// later will grant reach.
		const octRec = reloaded._data.activeStates.find(s => s.zodiacForm?.formId === "octopus");
		expect(octRec.customEffects.some(e => e.type === "reach" && e.value === 5)).toBe(true);
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

	it("Octopus increases melee reach by 5 ft and reverts on toggle-off", () => {
		const state = makeZodiacDruid(3, 16);
		state.setSpeed("walk", 30);
		expect(state.getReachBonus()).toBe(0);
		expect(state.getMeleeReach()).toBe(5);

		activateForm(state, "octopus");
		expect(state.getReachBonus()).toBe(5);
		expect(state.getMeleeReach()).toBe(10);
		// Swim is still granted alongside the reach bonus.
		expect(state.getSpeed("swim")).toBe(30);

		// Toggling the form off reverts reach to the base.
		state.deactivateState("zodiacForm");
		expect(state.getReachBonus()).toBe(0);
		expect(state.getMeleeReach()).toBe(5);
	});

	it("Aurochs counts as one size larger for carrying capacity and reverts", () => {
		const state = makeZodiacDruid(3, 16);
		// Medium creature -> carry multiplier 1.
		expect(state.getSizeCarryMultiplier()).toBe(1);
		expect(state.getCarrySizeBonusFromStates()).toBe(0);

		activateForm(state, "aurochs");
		// One size larger (Medium -> Large) doubles the carry multiplier; the
		// combat size is unchanged (carry-only step).
		expect(state.getCarrySizeBonusFromStates()).toBe(1);
		expect(state.getSizeCarryMultiplier()).toBe(2);
		expect(state.getSize()).toBe("medium");

		state.deactivateState("zodiacForm");
		expect(state.getCarrySizeBonusFromStates()).toBe(0);
		expect(state.getSizeCarryMultiplier()).toBe(1);
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

	// Every passive plumbing path must fully revert when the form toggles off.
	const revertCases = [
		["horse", (s) => s.getWalkSpeed(), 30, 60, "horse"],
		["octopus-swim", (s) => s.getSpeed("swim"), 0, 30, "octopus"],
		["octopus-reach", (s) => s.getReachBonus(), 0, 5, "octopus"],
		["bulette-ac", (s) => s.getBonusFromStates("ac"), 0, 2, "bulette"],
		["bulette-burrow", (s) => s.getSpeed("burrow"), 0, 15, "bulette"],
		["aurochs-adv", (s) => s.hasAdvantageFromStates("check:str"), false, true, "aurochs"],
		["aurochs-carry", (s) => s.getCarrySizeBonusFromStates(), 0, 1, "aurochs"],
	];
	it.each(revertCases)("%s applies while active and reverts on toggle-off", (_label, read, base, active, formId) => {
		const state = makeZodiacDruid(9, 16); // prof +4 -> Bulette AC +2
		state.setSpeed("walk", 30);
		expect(read(state)).toBe(base);
		activateForm(state, formId);
		expect(read(state)).toBe(active);
		state.deactivateState("zodiacForm");
		expect(read(state)).toBe(base);
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
		const state = makeZodiacDruid(3, 16); // WIS +3 -> 2d8+3
		activateForm(state, "phoenix");
		const heal = state.getFeatureCalculations().phoenixStabilizeHeal;
		expect(heal).toBe("2d8+3");
		const label = state.getActiveStateEffects().filter(e => e.type === "info").map(e => e.label)
			.find(l => l.includes(heal));
		expect(label).toBeDefined();
		expect(label).not.toMatch(/undefined|NaN/i);
	});

	it("Peacock surfaces a label with the Wisdom save DC", () => {
		const state = makeZodiacDruid(5, 16);
		state.setSpellcastingAbility("wis");
		activateForm(state, "peacock");
		const dc = state.getFeatureCalculations().peacockSaveDc;
		expect(Number.isFinite(dc)).toBe(true);
		const label = state.getActiveStateEffects().filter(e => e.type === "info").map(e => e.label)
			.find(l => l.includes(String(dc)));
		expect(label).toBeDefined();
		expect(label).not.toMatch(/undefined|NaN/i);
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
