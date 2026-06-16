/**
 * Character Sheet — Illrigger "Forked Tongue" feature tests
 * (MCDM Productions — The Illrigger Revised)
 *
 * Forked Tongue (L1): speak/read/write Mictlanian (granted automatically) plus a number
 * of *swappable* spoken-only languages the player chooses (2 at L1, 3 once Forked
 * Tongue Improvement is gained at L9). On a long rest the player may replace ONE
 * swappable spoken language with another (once per long rest). All swappable languages
 * are mirrored into `_data.languages` so the Thelemar Linguistics bonus counts them.
 *
 * Forked Tongue Improvement (L9): +1 swappable language AND advantage on Wisdom (Insight)
 * checks made to ascertain a creature's true intentions or sincerity.
 */
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const addIllrigger = (state, level) => {
	state.addClass({name: "Illrigger", source: "IllriggerRevised", level});
	state.applyClassFeatureEffects();
};

describe("Illrigger Forked Tongue", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("L1 grants", () => {
		it("auto-grants Mictlanian in languages", () => {
			addIllrigger(state, 1);
			expect(state._data.languages.map(l => l.toLowerCase())).toContain("mictlanian");
		});

		it("allows exactly 2 swappable spoken languages at L1", () => {
			addIllrigger(state, 1);
			expect(state.getForkedTongueMaxSwappable()).toBe(2);

			expect(state.addForkedTongueSwappableLanguage("Elvish")).toBe(true);
			expect(state.addForkedTongueSwappableLanguage("Draconic")).toBe(true);
			// Third is rejected at L1 (max 2)
			expect(state.addForkedTongueSwappableLanguage("Goblin")).toBe(false);

			expect(state.getForkedTongueSwappableLanguages()).toEqual(["Elvish", "Draconic"]);
		});

		it("mirrors swappable languages into _data.languages", () => {
			addIllrigger(state, 1);
			state.addForkedTongueSwappableLanguage("Elvish");
			expect(state._data.languages.map(l => l.toLowerCase())).toContain("elvish");
		});

		it("rejects Mictlanian and duplicates as swappable choices", () => {
			addIllrigger(state, 1);
			expect(state.addForkedTongueSwappableLanguage("Mictlanian")).toBe(false);
			expect(state.addForkedTongueSwappableLanguage("Elvish")).toBe(true);
			expect(state.addForkedTongueSwappableLanguage("elvish")).toBe(false); // case-insensitive dup
		});
	});

	describe("L9 improvement", () => {
		it("raises the swappable maximum to 3", () => {
			addIllrigger(state, 9);
			expect(state.getForkedTongueMaxSwappable()).toBe(3);
			expect(state.addForkedTongueSwappableLanguage("Elvish")).toBe(true);
			expect(state.addForkedTongueSwappableLanguage("Draconic")).toBe(true);
			expect(state.addForkedTongueSwappableLanguage("Goblin")).toBe(true);
			expect(state.getForkedTongueSwappableLanguages()).toHaveLength(3);
		});

		it("registers a conditional Wis (Insight) advantage modifier (gated by default)", () => {
			addIllrigger(state, 9);
			const calcs = state.getFeatureCalculations();
			expect(calcs.hasForkedTongueImprovement).toBe(true);

			// The advantage is a per-roll opt-in conditional: it must NOT auto-apply,
			// but it must surface in aggregateModifiers().conditionalsAvailable so the
			// roll handler's pre-roll picker can offer it (same path as Danger Sense /
			// Dauntless Heritage). A modifier stored disabled would be invisible there.
			const agg = state.aggregateModifiers("check:wis");
			expect(agg.advantage).toBe(false); // gated off by default
			const cond = agg.conditionalsAvailable.find(c => c.name === "Forked Tongue");
			expect(cond).toBeDefined();
			expect(cond.advantage).toBe(true);
			expect(cond.conditional).toMatch(/intentions|sincerity/i);
		});

		it("does NOT register the Insight advantage modifier before L9", () => {
			addIllrigger(state, 8);
			const agg = state.aggregateModifiers("check:wis");
			expect(agg.conditionalsAvailable.find(c => c.name === "Forked Tongue")).toBeUndefined();
		});
	});

	describe("Long-rest swap (once per long rest)", () => {
		beforeEach(() => {
			addIllrigger(state, 1);
			state.addForkedTongueSwappableLanguage("Elvish");
			state.addForkedTongueSwappableLanguage("Draconic");
		});

		it("replaces exactly one language and updates _data.languages", () => {
			expect(state.swapForkedTongueLanguage("Elvish", "Celestial")).toBe(true);

			const swappable = state.getForkedTongueSwappableLanguages();
			expect(swappable).toHaveLength(2);
			expect(swappable).toContain("Draconic");
			expect(swappable).toContain("Celestial");
			expect(swappable).not.toContain("Elvish");

			const langs = state._data.languages.map(l => l.toLowerCase());
			expect(langs).toContain("celestial");
			expect(langs).not.toContain("elvish");
			expect(langs).toContain("draconic");
		});

		it("enforces once-per-long-rest until reset", () => {
			expect(state.swapForkedTongueLanguage("Elvish", "Celestial")).toBe(true);
			// Second swap in the same rest period is blocked.
			expect(state.hasSwappedForkedTongueSinceLongRest()).toBe(true);
			expect(state.swapForkedTongueLanguage("Draconic", "Goblin")).toBe(false);

			// A new long rest re-enables swapping.
			state.resetForkedTongueSwap();
			expect(state.hasSwappedForkedTongueSinceLongRest()).toBe(false);
			expect(state.swapForkedTongueLanguage("Draconic", "Goblin")).toBe(true);
		});

		it("rejects swapping an unknown language or swapping to Mictlanian", () => {
			expect(state.swapForkedTongueLanguage("Orcish", "Goblin")).toBe(false);
			expect(state.hasSwappedForkedTongueSinceLongRest()).toBe(false);
			expect(state.swapForkedTongueLanguage("Elvish", "Mictlanian")).toBe(false);
			expect(state.hasSwappedForkedTongueSinceLongRest()).toBe(false);
		});
	});

	describe("Linguistics integration (Thelemar)", () => {
		it("counts Mictlanian + swappable languages toward the Linguistics bonus", () => {
			addIllrigger(state, 1);
			state._data.settings = state._data.settings || {};
			state._data.settings.thelemar_linguisticsBonus = true;

			// Only Mictlanian so far (1 non-Common language).
			const base = state._getDynamicSkillFeatureBonus("linguistics");

			state.addForkedTongueSwappableLanguage("Elvish");
			state.addForkedTongueSwappableLanguage("Draconic");
			const withTwo = state._getDynamicSkillFeatureBonus("linguistics");
			expect(withTwo).toBe(base + 2);

			// Swapping does not change the count, but reflects the new language.
			state.swapForkedTongueLanguage("Elvish", "Celestial");
			const afterSwap = state._getDynamicSkillFeatureBonus("linguistics");
			expect(afterSwap).toBe(withTwo);
			expect(state._data.languages.map(l => l.toLowerCase())).toContain("celestial");
		});
	});

	describe("Save/load round-trip", () => {
		it("persists forkedTongue state through toJson/loadFromJson", () => {
			addIllrigger(state, 9);
			state.addForkedTongueSwappableLanguage("Elvish");
			state.addForkedTongueSwappableLanguage("Draconic");
			state.swapForkedTongueLanguage("Elvish", "Celestial");

			const json = state.toJson();
			const reloaded = new CharacterSheetState();
			reloaded.loadFromJson(json);

			expect(reloaded.getForkedTongueSwappableLanguages().sort())
				.toEqual(["Celestial", "Draconic"].sort());
			expect(reloaded.hasSwappedForkedTongueSinceLongRest()).toBe(true);
		});

		it("defaults forkedTongue for old saves missing the field", () => {
			addIllrigger(state, 1);
			const json = state.toJson();
			delete json.forkedTongue;

			const reloaded = new CharacterSheetState();
			reloaded.loadFromJson(json);

			expect(reloaded.getForkedTongueSwappableLanguages()).toEqual([]);
			expect(reloaded.hasSwappedForkedTongueSinceLongRest()).toBe(false);
		});
	});
});
