import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

describe("CharacterSheetClassUtils.checkPrerequisites", () => {
	const baseContext = {
		classes: [{name: "Warlock", source: "XPHB", level: 5}],
		totalLevel: 5,
		existingFeatures: [
			{name: "Pact of the Blade", source: "XPHB", featureType: "Optional Feature"},
			{name: "Agonizing Blast", source: "XPHB", featureType: "Optional Feature"},
		],
		cantrips: [
			{name: "Eldritch Blast", source: "XPHB", sourceClass: "warlock"},
			{name: "Minor Illusion", source: "XPHB", sourceClass: "warlock"},
		],
		spells: [
			{name: "Hex", source: "PHB", level: 1, sourceClass: "warlock"},
			{name: "Misty Step", source: "PHB", level: 2, sourceClass: "warlock"},
		],
	};

	describe("no prerequisites", () => {
		it("should return met=true when prerequisite is null", () => {
			const result = CharacterSheetClassUtils.checkPrerequisites(null, baseContext);
			expect(result.met).toBe(true);
			expect(result.reasons).toEqual([]);
		});

		it("should return met=true when prerequisite is empty array", () => {
			const result = CharacterSheetClassUtils.checkPrerequisites([], baseContext);
			expect(result.met).toBe(true);
			expect(result.reasons).toEqual([]);
		});

		it("should return met=true when prerequisite is undefined", () => {
			const result = CharacterSheetClassUtils.checkPrerequisites(undefined, baseContext);
			expect(result.met).toBe(true);
			expect(result.reasons).toEqual([]);
		});
	});

	describe("level prerequisites", () => {
		it("should pass when character meets class level requirement", () => {
			const prereq = [{level: {level: 5, class: {name: "Warlock"}}}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(true);
		});

		it("should fail when character is below class level requirement", () => {
			const prereq = [{level: {level: 9, class: {name: "Warlock"}}}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Level 9 Warlock");
		});

		it("should fail when character doesn't have the required class", () => {
			const prereq = [{level: {level: 3, class: {name: "Wizard"}}}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Level 3 Wizard");
		});

		it("should pass total level requirement", () => {
			const prereq = [{level: {level: 5}}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(true);
		});

		it("should fail total level requirement when too low", () => {
			const prereq = [{level: {level: 10}}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Level 10");
		});

		it("should handle level as plain number (shorthand)", () => {
			const prereq = [{level: 3}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(true);
		});
	});

	describe("pact prerequisites", () => {
		it("should pass when character has Pact of the Blade", () => {
			const prereq = [{pact: "Blade"}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(true);
		});

		it("should fail when character doesn't have required pact", () => {
			const prereq = [{pact: "Chain"}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Pact of the Chain");
		});

		it("should match pact name case-insensitively", () => {
			const context = {
				...baseContext,
				existingFeatures: [{name: "PACT OF THE BLADE", source: "PHB"}],
			};
			const prereq = [{pact: "Blade"}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, context);
			expect(result.met).toBe(true);
		});

		it("should match TGTT pact variant names (Pact of Transformation)", () => {
			const context = {
				...baseContext,
				existingFeatures: [{name: "Pact of Transformation", source: "TGTT"}],
			};
			const prereq = [{pact: "Transformation"}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, context);
			expect(result.met).toBe(true);
		});
	});

	describe("spell prerequisites (PHB format)", () => {
		it("should pass when character has required cantrip (eldritch blast#c)", () => {
			const prereq = [{spell: ["eldritch blast#c"]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(true);
		});

		it("should fail when character doesn't have required cantrip", () => {
			const prereq = [{spell: ["fire bolt#c"]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Fire Bolt cantrip");
		});

		it("should pass when character has required spell (non-cantrip)", () => {
			const prereq = [{spell: ["hex"]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(true);
		});

		it("should fail when character doesn't have required spell", () => {
			const prereq = [{spell: ["fireball"]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Fireball spell");
		});

		it("should match spell names case-insensitively", () => {
			const prereq = [{spell: ["ELDRITCH BLAST#c"]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(true);
		});
	});

	describe("spell prerequisites (XPHB choose format)", () => {
		it("should pass when character has a warlock cantrip (level=0|class=Warlock)", () => {
			const prereq = [{spell: [{choose: "level=0|class=Warlock", entry: "a Warlock cantrip", entrySummary: "Warlock Cantrip That Deals Damage"}]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(true);
		});

		it("should fail when character has no cantrips from required class", () => {
			const context = {
				...baseContext,
				cantrips: [{name: "Fire Bolt", source: "PHB", sourceClass: "wizard"}],
			};
			const prereq = [{spell: [{choose: "level=0|class=Warlock", entry: "a Warlock cantrip", entrySummary: "Warlock Cantrip"}]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, context);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Warlock Cantrip");
		});

		it("should fail when character has no cantrips at all", () => {
			const context = {...baseContext, cantrips: []};
			const prereq = [{spell: [{choose: "level=0|class=Warlock", entry: "a Warlock cantrip", entrySummary: "Warlock Cantrip"}]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, context);
			expect(result.met).toBe(false);
		});
	});

	describe("combined prerequisites", () => {
		it("should pass when all requirements met (level + pact)", () => {
			const prereq = [{pact: "Blade", level: {level: 5, class: {name: "Warlock"}}}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(true);
		});

		it("should fail with multiple reasons when multiple requirements unmet", () => {
			const prereq = [{pact: "Chain", level: {level: 9, class: {name: "Warlock"}}}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Level 9 Warlock");
			expect(result.reasons).toContain("Pact of the Chain");
		});

		it("should fail with spell + level combined prereqs", () => {
			const prereq = [{spell: ["fire bolt#c"], level: {level: 5, class: {name: "Warlock"}}}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Fire Bolt cantrip");
			// Level passes so no level reason
			expect(result.reasons).not.toContain("Level 5 Warlock");
		});
	});

	describe("optionalfeature prerequisites", () => {
		it("should pass when character has required optional feature", () => {
			const prereq = [{optionalfeature: ["Agonizing Blast|XPHB"]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(true);
		});

		it("should fail when character doesn't have required optional feature", () => {
			const prereq = [{optionalfeature: ["Thirsting Blade|PHB"]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Thirsting Blade");
		});
	});

	describe("feature prerequisites", () => {
		it("should pass when character has required feature by name", () => {
			const prereq = [{feature: ["Pact of the Blade|Warlock|XPHB|3"]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(true);
		});

		it("should fail when character doesn't have required feature", () => {
			const prereq = [{feature: ["Extra Attack|Fighter|PHB|5"]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Extra Attack");
		});
	});

	describe("edge cases", () => {
		it("should handle empty context gracefully", () => {
			const prereq = [{level: {level: 5, class: {name: "Warlock"}}}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, {});
			expect(result.met).toBe(false);
			expect(result.reasons.length).toBeGreaterThan(0);
		});

		it("should handle features without name field in context", () => {
			const context = {
				...baseContext,
				existingFeatures: [{source: "PHB"}], // no name
			};
			const prereq = [{pact: "Blade"}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, context);
			expect(result.met).toBe(false);
		});

		it("should handle multiple prerequisite objects (OR logic between objects is not used here — all accumulate)", () => {
			// In 5etools data, multiple prereq objects in the array are typically alternatives,
			// but our implementation accumulates all reasons (conservative — shows all requirements)
			const prereq = [
				{pact: "Blade"},
				{level: {level: 9, class: {name: "Warlock"}}},
			];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, baseContext);
			// Pact of Blade passes, level 9 fails
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Level 9 Warlock");
		});
	});

	describe("tool proficiency prerequisites", () => {
		const smithCtx = {...baseContext, toolProficiencies: ["Smith's Tools", "Thieves' Tools"]};
		const noToolsCtx = {...baseContext, toolProficiencies: []};

		it("passes when the character has the required tool", () => {
			const prereq = [{proficiency: [{tool: "smith's tools"}]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, smithCtx);
			expect(result.met).toBe(true);
			expect(result.reasons).toEqual([]);
		});

		it("fails with a named reason when the character lacks the required tool", () => {
			const prereq = [{proficiency: [{tool: "smith's tools"}]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, noToolsCtx);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Proficiency with Smith's Tools");
		});

		it("treats an array as any-of — passes if any listed tool matches", () => {
			const prereq = [{proficiency: [{tool: ["tinker's tools", "smith's tools"]}]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, smithCtx);
			expect(result.met).toBe(true);
		});

		it("fails when none of an array-form tool list is proficient", () => {
			const prereq = [{proficiency: [{tool: ["tinker's tools", "cook's utensils"]}]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, smithCtx);
			expect(result.met).toBe(false);
			expect(result.reasons[0]).toMatch(/Proficiency with Tinker's Tools or Cook's Utensils/);
		});

		it("`tool: true` passes when the character has any tool proficiency", () => {
			const prereq = [{proficiency: [{tool: true}]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, smithCtx);
			expect(result.met).toBe(true);
		});

		it("`tool: true` fails when the character has no tool proficiencies", () => {
			const prereq = [{proficiency: [{tool: true}]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, noToolsCtx);
			expect(result.met).toBe(false);
			expect(result.reasons).toContain("Proficiency with any tool");
		});

		it("normalizes apostrophes and whitespace when matching", () => {
			// Data-side is lowercase without apostrophes; character stores canonical case
			const prereq = [{proficiency: [{tool: "smiths tools"}]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, smithCtx);
			expect(result.met).toBe(true);
		});

		it("prefers state.hasToolProficiency when a state object is provided", () => {
			const stubState = {
				hasToolProficiency: (t) => t.toLowerCase().includes("smith"),
				getToolProficiencies: () => ["Smith's Tools"],
			};
			const ctx = {...baseContext, state: stubState, toolProficiencies: []};
			const prereq = [{proficiency: [{tool: "smith's tools"}]}];
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, ctx);
			expect(result.met).toBe(true);
		});

		it("ignores non-tool proficiency kinds without throwing (armor/weapon/skill not yet gated)", () => {
			const prereq = [{proficiency: [{armor: "heavy"}, {tool: "smith's tools"}]}];
			// Armor prereq is intentionally not gated yet — only the tool prereq matters
			const result = CharacterSheetClassUtils.checkPrerequisites(prereq, smithCtx);
			expect(result.met).toBe(true);
		});

		it("integrates with getEligibleOptionalFeatures — blocks selection without the tool", () => {
			const opt = {
				name: "Rune Craft (Test)",
				source: "TEST",
				featureType: ["EI"],
				prerequisite: [{proficiency: [{tool: "smith's tools"}]}],
			};
			const eligibleWithout = CharacterSheetClassUtils.getEligibleOptionalFeatures([opt], {
				featureTypes: ["EI"],
				prereqContext: noToolsCtx,
			});
			expect(eligibleWithout[0]._meetsPrereqs).toBe(false);
			expect(eligibleWithout[0]._selectable).toBe(false);

			const eligibleWith = CharacterSheetClassUtils.getEligibleOptionalFeatures([opt], {
				featureTypes: ["EI"],
				prereqContext: smithCtx,
			});
			expect(eligibleWith[0]._meetsPrereqs).toBe(true);
			expect(eligibleWith[0]._selectable).toBe(true);
		});
	});
});
