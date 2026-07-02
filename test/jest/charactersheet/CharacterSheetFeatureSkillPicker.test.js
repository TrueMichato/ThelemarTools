import "./setup.js"; // Import first to set up mocks
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";
import "../../../js/charactersheet/charactersheet-levelup.js";

let CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

/**
 * A state with a realistic mix of proficiencies: one standard skill, one TGTT
 * Lore skill, one plain custom skill, and the TGTT `Might` homebrew skill —
 * plus at least one standard skill the character is NOT proficient in.
 */
function makeMixedProficiencyState () {
	const state = new CharacterSheetState();
	["str", "dex", "con", "int", "wis", "cha"].forEach(a => state.setAbilityBase(a, 10));
	state.setSkillProficiency("athletics", 1); // standard, proficient
	// "arcana" intentionally left non-proficient
	state.addLoreSkill("Heraldry"); // TGTT Lore skill (sets proficiency = 1)
	state.addCustomSkill("Streetwise", "cha");
	state.setSkillProficiency("streetwise", 1); // custom skill, proficient
	state.setSkillProficiency("might", 1); // TGTT hardcoded homebrew skill
	return state;
}

describe("Bug 5 — feature skill sub-choice options derive from actual proficiencies", () => {
	describe("CharacterSheetClassUtils.getProficientSkillDisplayNames", () => {
		it("includes proficient standard, Lore, custom, and Might skills", () => {
			const state = makeMixedProficiencyState();
			const options = CharacterSheetClassUtils.getProficientSkillDisplayNames(state);
			expect(options).toEqual(expect.arrayContaining(["Athletics", "Heraldry", "Streetwise", "Might"]));
		});

		it("excludes standard skills the character is NOT proficient in", () => {
			const state = makeMixedProficiencyState();
			const options = CharacterSheetClassUtils.getProficientSkillDisplayNames(state);
			expect(options).not.toContain("Arcana");
			expect(options).not.toContain("Stealth");
		});

		it("preserves proper display names (spaces/casing) for custom & Lore skills", () => {
			const state = new CharacterSheetState();
			["str", "dex", "con", "int", "wis", "cha"].forEach(a => state.setAbilityBase(a, 10));
			state.addLoreSkill("Planar Geography");
			state.addCustomSkill("Court Etiquette", "cha");
			state.setSkillProficiency("courtetiquette", 1);
			const options = CharacterSheetClassUtils.getProficientSkillDisplayNames(state);
			expect(options).toContain("Planar Geography");
			expect(options).toContain("Court Etiquette");
		});

		it("returns [] for a null/undefined state", () => {
			expect(CharacterSheetClassUtils.getProficientSkillDisplayNames(null)).toEqual([]);
			expect(CharacterSheetClassUtils.getProficientSkillDisplayNames(undefined)).toEqual([]);
		});
	});

	describe("CharacterSheetClassUtils.resolveFeatureSkillChoiceOptions", () => {
		it("for any_proficient, returns the proficient-skill list (incl. custom/Lore/Might)", () => {
			const state = makeMixedProficiencyState();
			const options = CharacterSheetClassUtils.resolveFeatureSkillChoiceOptions({type: "proficiency", count: 1, from: "any_proficient"}, state);
			expect(options).toEqual(expect.arrayContaining(["Athletics", "Heraldry", "Streetwise", "Might"]));
			expect(options).not.toContain("Arcana");
		});

		it("returns a fixed skill list unchanged (e.g. Primal Lore's six skills)", () => {
			const fixed = ["Animal Handling", "Insight", "Medicine", "Nature", "Perception", "Survival"];
			const options = CharacterSheetClassUtils.resolveFeatureSkillChoiceOptions({type: "proficiency", count: 1, from: fixed}, makeMixedProficiencyState());
			expect(options).toEqual(fixed);
		});

		it("falls back to the 18 standard skills when the character has no proficiencies", () => {
			const state = new CharacterSheetState();
			["str", "dex", "con", "int", "wis", "cha"].forEach(a => state.setAbilityBase(a, 10));
			const options = CharacterSheetClassUtils.resolveFeatureSkillChoiceOptions({type: "proficiency", count: 1, from: "any_proficient"}, state);
			expect(options).toEqual([...CharacterSheetClassUtils.STANDARD_SKILLS]);
			expect(options).toHaveLength(18);
		});
	});

	describe("selection round-trips display name → canonical key → correct (custom) skill", () => {
		it("applies proficiency to the picked custom skill's canonical key", () => {
			const state = makeMixedProficiencyState();
			// Mirror the apply-side conversion used by both pickers.
			const picked = "Streetwise";
			const key = picked.toLowerCase().replace(/\s+/g, "");
			expect(key).toBe("streetwise");
			state.setSkillProficiency(key, 2); // expertise
			expect(state.getSkillProficiency("streetwise")).toBe(2);
			// The custom skill entry is unchanged and still the one we targeted.
			expect(state.getCustomSkills().some(s => s.name === "Streetwise")).toBe(true);
		});

		it("applies proficiency to a picked Lore skill's canonical key", () => {
			const state = makeMixedProficiencyState();
			const key = "Heraldry".toLowerCase().replace(/\s+/g, "");
			state.setSkillProficiency(key, 2);
			expect(state.getSkillProficiency("heraldry")).toBe(2);
			expect(state.getLoreSkills().some(s => s.name === "Heraldry")).toBe(true);
		});
	});

	describe("both the builder and level-up pickers delegate to the shared helper", () => {
		function makeBuilder (state) {
			const b = Object.create(CharacterSheetBuilder.prototype);
			b._state = state;
			b._selectedFeatureSkillChoices = {};
			return b;
		}
		function makeLevelUp (state) {
			const l = Object.create(CharacterSheetLevelUp.prototype);
			l._state = state;
			l._selectedFeatureSkillChoices = {};
			return l;
		}

		it("builder._renderFeatureSkillSubChoice calls resolveFeatureSkillChoiceOptions with its state", () => {
			const state = makeMixedProficiencyState();
			const spy = jest.spyOn(CharacterSheetClassUtils, "resolveFeatureSkillChoiceOptions");
			const choice = {type: "proficiency", count: 1, from: "any_proficient"};
			// The stub DOM cannot fully render checkboxes; the helper is invoked before
			// any DOM traversal, so guard the render and assert the delegation.
			try { makeBuilder(state)._renderFeatureSkillSubChoice(choice, "k"); } catch (ignored) { /* stub DOM */ }
			expect(spy).toHaveBeenCalledWith(choice, state);
			spy.mockRestore();
		});

		it("levelup._renderFeatureSkillSubChoice calls resolveFeatureSkillChoiceOptions with its state", () => {
			const state = makeMixedProficiencyState();
			const spy = jest.spyOn(CharacterSheetClassUtils, "resolveFeatureSkillChoiceOptions");
			const choice = {type: "proficiency", count: 1, from: "any_proficient"};
			try { makeLevelUp(state)._renderFeatureSkillSubChoice(choice, "k"); } catch (ignored) { /* stub DOM */ }
			expect(spy).toHaveBeenCalledWith(choice, state);
			spy.mockRestore();
		});
	});
});
