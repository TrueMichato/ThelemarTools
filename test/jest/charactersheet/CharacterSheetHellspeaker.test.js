/**
 * Behavioral tests for the Illrigger **Hellspeaker** (Moloch) subclass features
 * (MCDM IllriggerRevised brew, surfaced through TGTT). These assert real
 * mechanical wiring — resource pools + recharge, save DCs, condition immunity,
 * the conditional CHA-influence advantage, and the Moloch's Blessing skill /
 * expertise / language grants — not mere flag existence.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const addHellspeaker = (state, level, {cha = 16} = {}) => {
	state._data.abilities.cha = cha;
	state.addClass({
		name: "Illrigger",
		source: "IllriggerRevised",
		level,
		subclass: {name: "Hellspeaker", shortName: "Hellspeaker", source: "IllriggerRevised"},
	});
	state.applyClassFeatureEffects();
};

describe("Illrigger Hellspeaker (Moloch)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ----------------------------------------------------------------------
	// Save DCs + Charm Enemy use count (calc block)
	// ----------------------------------------------------------------------
	describe("Save DCs and Charm Enemy uses", () => {
		it("computes Charm Enemy DC = 8 + PB + CHA at L3", () => {
			addHellspeaker(state, 3, {cha: 16}); // +3, PB 2
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasCharmEnemy).toBe(true);
			expect(calcs.charmEnemyDc).toBe(13);
		});

		it("sets Charm Enemy uses = CHA modifier (minimum 1)", () => {
			addHellspeaker(state, 3, {cha: 16}); // +3
			expect(state.getFeatureCalculations().charmEnemyUses).toBe(3);
		});

		it("clamps Charm Enemy uses to a minimum of 1 with low CHA", () => {
			addHellspeaker(state, 3, {cha: 8}); // -1 → clamped to 1
			expect(state.getFeatureCalculations().charmEnemyUses).toBe(1);
		});

		it("does not expose Quid Pro Quo DC before L15", () => {
			addHellspeaker(state, 11, {cha: 16});
			expect(state.getFeatureCalculations().quidProQuoDc).toBeUndefined();
		});

		it("computes Quid Pro Quo DC = Interdict DC at L15", () => {
			addHellspeaker(state, 15, {cha: 16}); // +3, PB 5 → 16
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasQuidProQuo).toBe(true);
			expect(calcs.quidProQuoDc).toBe(16);
			expect(calcs.quidProQuoDc).toBe(calcs.interdictDc);
		});
	});

	// ----------------------------------------------------------------------
	// Curated limited-use pools (_getCuratedFeatureUses)
	// ----------------------------------------------------------------------
	describe("Curated limited-use pools", () => {
		it("sizes Charm Enemy to CHA modifier, long-rest recharge", () => {
			addHellspeaker(state, 3, {cha: 16}); // +3
			const uses = state._getCuratedFeatureUses({name: "Charm Enemy", classSource: "IllriggerRevised"});
			expect(uses).toEqual({max: 3, recharge: "long"});
		});

		it("sizes Let's Make a Deal to the proficiency bonus, long-rest recharge", () => {
			addHellspeaker(state, 11, {cha: 16}); // PB 4
			const uses = state._getCuratedFeatureUses({name: "Let's Make a Deal", classSource: "IllriggerRevised"});
			expect(uses).toEqual({max: 4, recharge: "long"});
		});

		it("matches Let's Make a Deal regardless of apostrophe glyph", () => {
			addHellspeaker(state, 11, {cha: 16}); // PB 4
			const uses = state._getCuratedFeatureUses({name: "Let\u2019s Make a Deal", classSource: "IllriggerRevised"});
			expect(uses).toEqual({max: 4, recharge: "long"});
		});

		it("sizes Quid Pro Quo to 1/long rest", () => {
			addHellspeaker(state, 15, {cha: 16});
			const uses = state._getCuratedFeatureUses({name: "Quid Pro Quo", classSource: "IllriggerRevised"});
			expect(uses).toEqual({max: 1, recharge: "long"});
		});

		it("never curates a same-named feature from another source", () => {
			addHellspeaker(state, 15, {cha: 16});
			expect(state._getCuratedFeatureUses({name: "Charm Enemy", classSource: "PHB"})).toBeNull();
			expect(state._getCuratedFeatureUses({name: "Quid Pro Quo", source: "XPHB"})).toBeNull();
		});
	});

	// ----------------------------------------------------------------------
	// Activatable detection (static, prose-driven)
	// ----------------------------------------------------------------------
	describe("Activatable detection", () => {
		it("surfaces Charm Enemy as a bonus-action limited-use ability", () => {
			const det = CharacterSheetState.detectActivatableFeature({
				name: "Charm Enemy",
				uses: {max: 3, current: 3},
				description: "As a bonus action when you place a magical seal, you can force a creature that can see or hear you to make a Charisma saving throw.",
			});
			expect(det).toBeTruthy();
			expect(det.activationAction).toBe("bonus");
		});

		it("surfaces Let's Make a Deal as a bonus-action ability", () => {
			const det = CharacterSheetState.detectActivatableFeature({
				name: "Let's Make a Deal",
				uses: {max: 4, current: 4},
				description: "As a bonus action, you can strike a bargain with an ally, and you can grant them a boon.",
			});
			expect(det).toBeTruthy();
			expect(det.activationAction).toBe("bonus");
		});

		it("surfaces Quid Pro Quo as an action ability", () => {
			const det = CharacterSheetState.detectActivatableFeature({
				name: "Quid Pro Quo",
				uses: {max: 1, current: 1},
				description: "As an action, you can banish a creature you can see and summon a devil to serve you.",
			});
			expect(det).toBeTruthy();
			expect(det.activationAction).toBe("action");
		});
	});

	// ----------------------------------------------------------------------
	// Intransigent — charmed condition immunity (L11)
	// ----------------------------------------------------------------------
	describe("Intransigent condition immunity", () => {
		it("does not grant charmed immunity before L11", () => {
			addHellspeaker(state, 3, {cha: 16});
			expect(state.isImmuneToCondition("charmed")).toBe(false);
		});

		it("grants charmed immunity at L11 while conscious", () => {
			addHellspeaker(state, 11, {cha: 16});
			state.setHp(58, 58, 0); // conscious
			expect(state.isImmuneToCondition("charmed")).toBe(true);
			expect(state.getConditionImmunities().map(c => c.toLowerCase())).toContain("charmed");
		});

		it("suppresses charmed immunity while unconscious (Intransigent is conscious-gated)", () => {
			addHellspeaker(state, 11, {cha: 16});
			state.setHp(0, 58, 0); // downed → unconscious
			expect(state.isImmuneToCondition("charmed")).toBe(false);
			// still listed as a granted immunity, just not currently active
			expect(state.getConditionImmunities().map(c => c.toLowerCase())).toContain("charmed");
		});
	});

	// ----------------------------------------------------------------------
	// Moloch's Blessing — conditional CHA-influence advantage (L3)
	// ----------------------------------------------------------------------
	describe("Moloch's Blessing conditional advantage", () => {
		it("registers a CHA-check advantage that is gated OFF by default", () => {
			addHellspeaker(state, 3, {cha: 16});
			const agg = state.aggregateModifiers("check:cha");
			expect(agg.advantage).toBe(false); // must not auto-apply

			const cond = agg.conditionalsAvailable.find(c => c.name === "Moloch's Blessing");
			expect(cond).toBeDefined();
			expect(cond.advantage).toBe(true);
			expect(cond.conditional).toMatch(/influence/i);
		});

		it("does not register the advantage without the subclass", () => {
			state.addClass({name: "Illrigger", source: "IllriggerRevised", level: 3});
			state.applyClassFeatureEffects();
			const agg = state.aggregateModifiers("check:cha");
			expect(agg.conditionalsAvailable.find(c => c.name === "Moloch's Blessing")).toBeUndefined();
		});
	});

	// ----------------------------------------------------------------------
	// Moloch's Blessing — skill proficiency / expertise choice (L3)
	// ----------------------------------------------------------------------
	describe("Moloch's Blessing skill choice", () => {
		const MOLOCH_DESC = "When Moloch accepts you as his illrigger, you gain proficiency in the {@skill Persuasion} or "
			+ "{@skill Deception} skill (your choice). If you already have proficiency in the skill of your choice, your "
			+ "proficiency bonus is doubled for any ability check you make with that skill.";

		it("queues a single-pick skill choice between Persuasion and Deception", () => {
			addHellspeaker(state, 3, {cha: 16});
			state.addFeature({name: "Moloch's Blessing", classSource: "IllriggerRevised", description: MOLOCH_DESC});

			const choice = state.getPendingFeatureChoices().find(c => c.featureName === "Moloch's Blessing");
			expect(choice).toBeDefined();
			expect(choice.kind).toBe("skill");
			expect(choice.options.sort()).toEqual(["deception", "persuasion"]);
			expect(choice.expertiseIfProficient).toBe(true);
		});

		it("grants plain proficiency when the chosen skill is not yet proficient", () => {
			addHellspeaker(state, 3, {cha: 16});
			state.addFeature({name: "Moloch's Blessing", classSource: "IllriggerRevised", description: MOLOCH_DESC});

			const choice = state.getPendingFeatureChoices().find(c => c.featureName === "Moloch's Blessing");
			expect(state.fulfillFeatureChoice(choice.id, "persuasion")).toBe(true);
			expect(state.getSkillProficiencies().persuasion).toBe(1);
		});

		it("upgrades to expertise when already proficient in the chosen skill", () => {
			addHellspeaker(state, 3, {cha: 16});
			state.setSkillProficiency("deception", 1); // already proficient
			state.addFeature({name: "Moloch's Blessing", classSource: "IllriggerRevised", description: MOLOCH_DESC});

			const choice = state.getPendingFeatureChoices().find(c => c.featureName === "Moloch's Blessing");
			expect(state.fulfillFeatureChoice(choice.id, "deception")).toBe(true);
			expect(state.getSkillProficiencies().deception).toBe(2); // expertise
		});
	});

	// ----------------------------------------------------------------------
	// Moloch's Blessing — Forked Tongue +1 language
	// ----------------------------------------------------------------------
	describe("Moloch's Blessing extra language", () => {
		it("raises the Forked Tongue swappable maximum by 1 at L3", () => {
			addHellspeaker(state, 3, {cha: 16});
			expect(state.getForkedTongueMaxSwappable()).toBe(3);
		});

		it("raises it to 4 once the L9 Forked Tongue improvement also applies", () => {
			addHellspeaker(state, 9, {cha: 16});
			expect(state.getForkedTongueMaxSwappable()).toBe(4);
		});
	});
});
