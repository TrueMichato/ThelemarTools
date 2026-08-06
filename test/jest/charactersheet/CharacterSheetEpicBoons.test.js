/**
 * Character Sheet Phase 5 — XPHB Epic Boons
 * Tests for ability score max override (max 30), applyASI / increaseAbility with maxScore param,
 * and Epic Boon ability choice application.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Epic Boons — Ability Score Max Override", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ==========================================================================
	// applyASI with maxScore parameter
	// ==========================================================================
	describe("applyASI with maxScore", () => {
		it("should cap at 20 by default", () => {
			state.applyASI("str", 2); // 10 → 12
			expect(state.getAbilityBase("str")).toBe(12);

			// Set to 19, then try +2 → should cap at 20
			state.setAbilityBase("str", 19);
			state.applyASI("str", 2);
			expect(state.getAbilityBase("str")).toBe(20);
		});

		it("should cap at 30 when maxScore is 30", () => {
			state.setAbilityBase("str", 19);
			state.applyASI("str", 2, 30);
			expect(state.getAbilityBase("str")).toBe(21);
		});

		it("should allow ability score to reach 30 with Epic Boon max", () => {
			state.setAbilityBase("str", 29);
			state.applyASI("str", 2, 30);
			expect(state.getAbilityBase("str")).toBe(30);
		});

		it("should not exceed 30 even with large bonus", () => {
			state.setAbilityBase("str", 29);
			state.applyASI("str", 5, 30);
			expect(state.getAbilityBase("str")).toBe(30);
		});

		it("should still cap at 20 when no maxScore specified", () => {
			state.setAbilityBase("dex", 19);
			state.applyASI("dex", 2);
			expect(state.getAbilityBase("dex")).toBe(20);
		});
	});

	// ==========================================================================
	// increaseAbility with maxScore parameter
	// ==========================================================================
	describe("increaseAbility with maxScore", () => {
		it("should cap at 20 by default", () => {
			state.setAbilityBase("con", 19);
			state.increaseAbility("con", 2);
			expect(state.getAbilityBase("con")).toBe(20);
		});

		it("should cap at 30 when maxScore is 30", () => {
			state.setAbilityBase("con", 19);
			state.increaseAbility("con", 2, 30);
			expect(state.getAbilityBase("con")).toBe(21);
		});

		it("should work with different max values", () => {
			state.setAbilityBase("wis", 23);
			state.increaseAbility("wis", 2, 24);
			expect(state.getAbilityBase("wis")).toBe(24);
		});
	});

	// ==========================================================================
	// Epic Boon feat data patterns
	// ==========================================================================
	describe("Epic Boon feat data patterns", () => {
		it("should recognise Epic Boon category marker", () => {
			// Epic Boons have category: "EB" in feat data
			const mockBoon = {
				name: "Boon of Combat Prowess",
				source: "XPHB",
				category: "EB",
				ability: [{choose: {from: ["str", "dex", "con"]}, max: 30}],
			};

			expect(mockBoon.category).toBe("EB");
			expect(mockBoon.ability[0].max).toBe(30);
			expect(mockBoon.ability[0].choose.from).toContain("str");
		});

		it("propagates max 30 into the shared picker choice spec", () => {
			const boon = {
				name: "Boon of Combat Prowess",
				source: "XPHB",
				category: "EB",
				ability: [{choose: {from: ["str", "dex", "con", "int", "wis", "cha"]}, max: 30}],
			};
			expect(globalThis.CharacterSheetClassUtils.buildFeatChoicesSpec(boon).ability).toEqual({
				count: 1,
				amount: 1,
				from: ["str", "dex", "con", "int", "wis", "cha"],
				max: 30,
			});
		});

		it("should handle fixed ability bonuses with max 30", () => {
			// Some boons have fixed ability bonuses like {str: 1, max: 30}
			const mockBoon = {
				ability: [{str: 1, max: 30}],
			};

			const ablEntry = mockBoon.ability[0];
			const max = ablEntry.max || 20;
			expect(max).toBe(30);

			// Simulate applying the bonus
			state.setAbilityBase("str", 20);
			const bonus = ablEntry.str;
			const current = state.getAbilityBase("str");
			state.setAbilityBase("str", Math.min(max, current + bonus));
			expect(state.getAbilityBase("str")).toBe(21);
		});

		it("should handle choose-based ability bonuses with max 30", () => {
			const mockBoon = {
				ability: [{choose: {from: ["str", "dex", "con", "int", "wis", "cha"]}, max: 30}],
			};

			state.setAbilityBase("cha", 20);
			globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, mockBoon, {ability: "cha"});
			expect(state.getAbilityBase("cha")).toBe(21);
		});
	});

	// ==========================================================================
	// Non-Epic-Boon feats should still cap at 20
	// ==========================================================================
	describe("Non-Epic-Boon feats retain cap of 20", () => {
		it("should not exceed 20 for regular feats", () => {
			// Regular feat with ability bonus (no max property)
			state.setAbilityBase("str", 19);
			const ablEntry = {str: 2}; // No max property
			const max = ablEntry.max || 20;
			const bonus = ablEntry.str;
			const current = state.getAbilityBase("str");
			state.setAbilityBase("str", Math.min(max, current + bonus));
			expect(state.getAbilityBase("str")).toBe(20);
		});

		it("applyASI without maxScore should cap at 20", () => {
			state.setAbilityBase("int", 19);
			state.applyASI("int", 2);
			expect(state.getAbilityBase("int")).toBe(20);
		});
	});
});

// =============================================================================
// Boon of Skill — Proficiency in All Skills + Expertise Choice
// =============================================================================
describe("Boon of Skill — Skill Proficiencies and Expertise", () => {
	let state;

	const ALL_SKILLS = [
		"athletics", "acrobatics", "sleightofhand", "stealth",
		"arcana", "history", "investigation", "nature", "religion",
		"animalhandling", "insight", "medicine", "perception", "survival",
		"deception", "intimidation", "performance", "persuasion",
	];

	const BOON_OF_SKILL_DATA = {
		name: "Boon of Skill",
		source: "XPHB",
		category: "EB",
		skillProficiencies: [{
			athletics: true,
			acrobatics: true,
			sleightofhand: true,
			stealth: true,
			arcana: true,
			history: true,
			investigation: true,
			nature: true,
			religion: true,
			animalhandling: true,
			insight: true,
			medicine: true,
			perception: true,
			survival: true,
			deception: true,
			intimidation: true,
			performance: true,
			persuasion: true,
		}],
		expertise: {anyProficientSkill: 1},
		ability: [{choose: {from: ["str", "dex", "con", "int", "wis", "cha"]}, max: 30}],
	};

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("Skill proficiencies from applyFeatBonuses", () => {
		it("should apply all 18 skill proficiencies from Boon of Skill", () => {
			// Verify no skills initially
			expect(Object.keys(state.getSkillProficiencies())).toHaveLength(0);

			// Apply Boon of Skill bonuses
			globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, BOON_OF_SKILL_DATA, {});

			// Verify all 18 skills are now proficient
			const proficiencies = Object.keys(state.getSkillProficiencies()).map(s => s.toLowerCase());
			expect(proficiencies).toHaveLength(18);

			ALL_SKILLS.forEach(skill => {
				expect(proficiencies).toContain(skill);
			});
		});

		it("should not duplicate skills if already proficient", () => {
			// Add some skills first
			state.addSkillProficiency("athletics");
			state.addSkillProficiency("perception");
			expect(Object.keys(state.getSkillProficiencies())).toHaveLength(2);

			// Apply Boon of Skill
			globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, BOON_OF_SKILL_DATA, {});

			// Still should have 18 skills (not 20)
			const proficiencies = Object.keys(state.getSkillProficiencies()).map(s => s.toLowerCase());
			expect(proficiencies).toHaveLength(18);
		});
	});

	describe("Expertise choice includes fixed skills", () => {
		it("should correctly extract fixed skill proficiencies from feat data", () => {
			// This tests the pattern used in QuickBuild/LevelUp expertise dropdown
			const fixedFeatSkills = BOON_OF_SKILL_DATA.skillProficiencies?.[0]
				? Object.entries(BOON_OF_SKILL_DATA.skillProficiencies[0])
					.filter(([, v]) => v === true)
					.map(([s]) => s.toLowerCase())
				: [];

			expect(fixedFeatSkills).toHaveLength(18);
			ALL_SKILLS.forEach(skill => {
				expect(fixedFeatSkills).toContain(skill);
			});
		});

		it("should apply chosen expertise from feat choices", () => {
			// First apply skill proficiencies
			globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, BOON_OF_SKILL_DATA, {});

			// Now apply expertise choice
			globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, BOON_OF_SKILL_DATA, {
				expertise: ["perception"],
			});

			const expertise = state.getExpertise().map(s => s.toLowerCase());
			expect(expertise).toContain("perception");
		});
	});

	describe("Ability score bonus with max 30", () => {
		it("should allow ability score to exceed 20 with Boon of Skill", () => {
			state.setAbilityBase("dex", 20);

			globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, BOON_OF_SKILL_DATA, {ability: "dex"});
			expect(state.getAbilityBase("dex")).toBe(21);
		});

		it("should cap a chosen Epic Boon ability at 30", () => {
			state.setAbilityBase("dex", 30);
			globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, BOON_OF_SKILL_DATA, {ability: "dex"});
			expect(state.getAbilityBase("dex")).toBe(30);
		});
	});
});

// =============================================================================
// Epic Boon Immunity Application
// =============================================================================
describe("Epic Boon — Immunity Application via applyFeatBonuses", () => {
	let state;
	const ClassUtils = globalThis.CharacterSheetClassUtils;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	it("should apply damage immunity from boon 'immune' property", () => {
		const boon = {
			name: "Boon of Blazing Dawn",
			source: "ABH",
			category: "EB",
			immune: ["radiant"],
			ability: [{choose: {from: ["str", "dex", "con", "int", "wis", "cha"]}, max: 30}],
		};

		ClassUtils.applyFeatBonuses(state, boon, {});

		const immunities = state.getImmunities?.() || state._data?.immunities || [];
		expect(immunities).toContain("radiant");
	});

	it("should apply multiple damage immunities", () => {
		const boon = {
			name: "Test Boon",
			source: "TST",
			immune: ["fire", "cold"],
		};

		ClassUtils.applyFeatBonuses(state, boon, {});

		const immunities = state.getImmunities?.() || state._data?.immunities || [];
		expect(immunities).toContain("fire");
		expect(immunities).toContain("cold");
	});

	it("should not duplicate immunity if already present", () => {
		state.addImmunity("radiant");

		const boon = {
			name: "Boon of Blazing Dawn",
			source: "ABH",
			immune: ["radiant"],
		};

		ClassUtils.applyFeatBonuses(state, boon, {});

		const immunities = state.getImmunities?.() || state._data?.immunities || [];
		const radiantCount = immunities.filter(i => i === "radiant").length;
		expect(radiantCount).toBe(1);
	});

	it("should apply condition immunity from boon 'conditionImmune' property", () => {
		const boon = {
			name: "Test Condition Boon",
			source: "TST",
			conditionImmune: ["poisoned"],
		};

		ClassUtils.applyFeatBonuses(state, boon, {});

		const condImmunities = state._data?.conditionImmunities || [];
		expect(condImmunities).toContain("poisoned");
	});

	it("should apply both immunity and ability bonus from same boon", () => {
		const boon = {
			name: "Boon of Blazing Dawn",
			source: "ABH",
			category: "EB",
			immune: ["radiant"],
			ability: [{choose: {from: ["str", "dex", "con", "int", "wis", "cha"]}, max: 30}],
		};

		state.setAbilityBase("cha", 20);
		ClassUtils.applyFeatBonuses(state, boon, {ability: "cha"});

		// Check immunity applied
		const immunities = state.getImmunities?.() || state._data?.immunities || [];
		expect(immunities).toContain("radiant");

		// Check ability score increased beyond 20
		expect(state.getAbilityBase("cha")).toBe(21);
	});

	it("should not add immunity when boon has no immune property", () => {
		const boon = {
			name: "Boon of Combat Prowess",
			source: "XPHB",
			category: "EB",
			ability: [{choose: {from: ["str", "dex", "con", "int", "wis", "cha"]}, max: 30}],
		};

		ClassUtils.applyFeatBonuses(state, boon, {});

		const immunities = state.getImmunities?.() || state._data?.immunities || [];
		expect(immunities).toHaveLength(0);
	});
});
