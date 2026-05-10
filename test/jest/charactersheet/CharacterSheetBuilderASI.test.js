import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;

/**
 * Minimal mock state that tracks ability bonuses.
 * Uses the same SET/GET pattern as the real CharacterSheetState.
 */
function createMockState () {
	const bonuses = {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
	const bases = {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10};
	return {
		bonuses,
		bases,
		setAbilityBonus (abi, val) { bonuses[abi] = val; },
		getAbilityBonus (abi) { return bonuses[abi] || 0; },
		setAbilityBase (abi, val) { bases[abi] = val; },
		getAbilityBase (abi) { return bases[abi] || 10; },
		setRace () {},
		setBackground () {},
		addLanguage () {},
		addToolProficiency () {},
		setSkillProficiency () {},
		addFeature () {},
		setSpeed () {},
		addNamedModifier () {},
		recordLevelChoice () {},
	};
}

function createBuilder (overrides = {}) {
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder._state = overrides.state || createMockState();
	builder._page = {renderCharacter () {}};
	builder._currentStep = 1;
	builder._maxSteps = 7;
	builder._selectedRace = overrides.race || null;
	builder._selectedSubrace = overrides.subrace || null;
	builder._selectedBackground = overrides.background || null;
	builder._selectedAbilityBonuses = overrides.abilityBonuses || {};
	builder._selectedRacialAbilityChoices = overrides.racialAbilityChoices || {};
	builder._selectedRacialAbilitySetIdx = overrides.racialAbilitySetIdx || {};
	builder._abilityScores = overrides.abilityScores || {str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8};
	builder._useTashasRules = false;
	builder._tashasAbilityBonuses = {};
	builder._tashasLanguageReplacements = [];
	builder._selectedToolProficiencies = [];
	builder._selectedLanguages = [];
	builder._selectedClassFeatureLanguages = [];
	builder._selectedFeatureOptions = {};
	builder._selectedFeatureSkillChoices = {};
	builder._selectedRacialSkills = [];
	builder._selectedRacialTools = [];
	builder._selectedRacialLanguages = {};
	builder._selectedSubraceLanguages = [];
	builder._selectedRacialSpells = [];
	builder._selectedRacialSpellAbilities = {};
	return builder;
}

describe("CharacterSheetBuilder ability score bonus accumulation", () => {
	describe("Step 1 (Race) clearing", () => {
		test("re-applying step 1 does not double choose-based racial ASI", () => {
			const state = createMockState();
			// Half-Elf: +2 CHA (fixed) + choose 2 × +1 — single ability object (matches real data)
			const halfElf = {
				name: "Half-Elf",
				source: "PHB",
				ability: [
					{cha: 2, choose: {count: 2, from: ["str", "dex", "con", "int", "wis"]}},
				],
			};

			const builder = createBuilder({
				state,
				race: halfElf,
				racialAbilityChoices: {
					"Half-Elf|PHB": {
						"choose_0_0": "str",
						"choose_0_0_amount": 1,
						"choose_0_1": "dex",
						"choose_0_1_amount": 1,
					},
				},
			});

			// Simulate step 1 applied (first time)
			builder._currentStep = 1;
			builder._applyCurrentStep();
			expect(state.bonuses.cha).toBe(2);
			expect(state.bonuses.str).toBe(1);
			expect(state.bonuses.dex).toBe(1);

			// Simulate re-visiting step 1 and applying again
			builder._applyCurrentStep();
			expect(state.bonuses.cha).toBe(2); // SET, so idempotent
			expect(state.bonuses.str).toBe(1); // Should NOT be 2
			expect(state.bonuses.dex).toBe(1); // Should NOT be 2
		});

		test("switching races clears previous bonuses", () => {
			const state = createMockState();
			const dwarf = {
				name: "Mountain Dwarf",
				source: "PHB",
				ability: [{str: 2, con: 2}],
			};

			const builder = createBuilder({state, race: dwarf});
			builder._currentStep = 1;
			builder._applyCurrentStep();
			expect(state.bonuses.str).toBe(2);
			expect(state.bonuses.con).toBe(2);

			// Switch to a race with no ASI (2024 species)
			builder._selectedRace = {name: "Human", source: "XPHB"};
			builder._applyCurrentStep();
			expect(state.bonuses.str).toBe(0);
			expect(state.bonuses.con).toBe(0);
		});
	});

	describe("Step 2 (Background) clearing", () => {
		test("re-applying step 2 does not double background ASI", () => {
			const state = createMockState();
			// Simulate racial bonuses already applied
			state.setAbilityBonus("str", 2);
			state.setAbilityBonus("con", 2);

			const builder = createBuilder({
				state,
				race: {name: "Mountain Dwarf", source: "PHB", ability: [{str: 2, con: 2}]},
				background: {name: "Sage", source: "XPHB", ability: [{choose: {weighted: {from: ["str", "dex", "con", "int", "wis", "cha"], weights: [2, 1]}}}]},
				abilityBonuses: {bg_0: "int", bg_0_weight: 2, bg_1: "wis", bg_1_weight: 1},
			});

			// Simulate step 2 applied (first time) — Background is now step 2
			builder._currentStep = 2;
			builder._applyCurrentStep();
			// racial (str: 2, con: 2) + background (int: 2, wis: 1)
			expect(state.bonuses.str).toBe(2);
			expect(state.bonuses.con).toBe(2);
			expect(state.bonuses.int).toBe(2);
			expect(state.bonuses.wis).toBe(1);

			// Re-apply step 2 (simulates going back to step 2 and forward again)
			builder._applyCurrentStep();
			// Should be same as before, NOT doubled
			expect(state.bonuses.str).toBe(2);
			expect(state.bonuses.con).toBe(2);
			expect(state.bonuses.int).toBe(2); // NOT 4
			expect(state.bonuses.wis).toBe(1); // NOT 2
		});

		test("re-applying step 2 preserves racial bonuses", () => {
			const state = createMockState();
			const builder = createBuilder({
				state,
				race: {
					name: "Half-Elf",
					source: "PHB",
					ability: [{cha: 2, choose: {count: 2, from: ["str", "dex", "con", "int", "wis"]}}],
				},
				racialAbilityChoices: {
					"Half-Elf|PHB": {
						"choose_0_0": "str",
						"choose_0_0_amount": 1,
						"choose_0_1": "con",
						"choose_0_1_amount": 1,
					},
				},
				background: {name: "Acolyte", source: "XPHB"},
				abilityBonuses: {bg_0: "wis", bg_0_weight: 2, bg_1: "int", bg_1_weight: 1},
			});

			builder._currentStep = 2;
			builder._applyCurrentStep();
			// racial: cha +2, str +1, con +1. background: wis +2, int +1.
			expect(state.bonuses.cha).toBe(2);
			expect(state.bonuses.str).toBe(1);
			expect(state.bonuses.con).toBe(1);
			expect(state.bonuses.wis).toBe(2);
			expect(state.bonuses.int).toBe(1);

			// Re-apply — should be identical
			builder._applyCurrentStep();
			expect(state.bonuses.cha).toBe(2);
			expect(state.bonuses.str).toBe(1);
			expect(state.bonuses.con).toBe(1);
			expect(state.bonuses.wis).toBe(2);
			expect(state.bonuses.int).toBe(1);
		});
	});

	describe("2024 species + background ASI", () => {
		test("2024 species with no racial ASI gets bonuses only from background", () => {
			const state = createMockState();
			const builder = createBuilder({
				state,
				race: {name: "Human", source: "XPHB", edition: "one"},
				background: {name: "Sage", source: "XPHB"},
				abilityBonuses: {bg_0: "int", bg_0_weight: 2, bg_1: "wis", bg_1_weight: 1},
			});

			builder._currentStep = 2;
			builder._applyCurrentStep();
			expect(state.bonuses.str).toBe(0);
			expect(state.bonuses.dex).toBe(0);
			expect(state.bonuses.con).toBe(0);
			expect(state.bonuses.int).toBe(2);
			expect(state.bonuses.wis).toBe(1);
			expect(state.bonuses.cha).toBe(0);
		});

		test("mixed fixed+choose ability set applies both (Changeling pattern)", () => {
			const state = createMockState();
			// ERLW Changeling: +2 CHA (fixed) AND choose 1 from [str,dex,con,int,wis]
			// Both values are in the SAME ability set object
			const builder = createBuilder({
				state,
				race: {
					name: "Changeling",
					source: "ERLW",
					ability: [{cha: 2, choose: {from: ["str", "dex", "con", "int", "wis"], count: 1}}],
				},
				racialAbilityChoices: {
					"Changeling|ERLW": {
						"choose_0_0": "dex",
						"choose_0_0_amount": 1,
					},
				},
			});

			builder._currentStep = 1;
			builder._applyCurrentStep();
			expect(state.bonuses.cha).toBe(2); // Fixed entry — must NOT be skipped
			expect(state.bonuses.dex).toBe(1); // Choose entry
			expect(state.bonuses.str).toBe(0); // Untouched
		});

		test("choose-based racial ASI with missing amount key skips bonus", () => {
			const state = createMockState();
			const builder = createBuilder({
				state,
				race: {
					name: "Changeling",
					source: "ERLW",
					ability: [{choose: {count: 2, from: ["str", "dex", "con", "int", "wis", "cha"]}}],
				},
				// Simulate broken state: ability chosen but amount NOT stored
				racialAbilityChoices: {
					"Changeling|ERLW": {
						"choose_0_0": "cha",
						// "choose_0_0_amount" is missing!
						"choose_0_1": "dex",
						// "choose_0_1_amount" is missing!
					},
				},
			});

			builder._currentStep = 1;
			builder._applyCurrentStep();
			// With || 1 default, these become +1 each (consistent with UI default)
			expect(state.bonuses.cha).toBe(1);
			expect(state.bonuses.dex).toBe(1);
		});
	});

	describe("Display methods for mixed fixed+choose ability sets", () => {
		test("_getRacialBonus returns fixed bonus from mixed ability set", () => {
			const state = createMockState();
			const builder = createBuilder({
				state,
				race: {
					name: "Changeling",
					source: "ERLW",
					ability: [{cha: 2, choose: {from: ["str", "dex", "con", "int", "wis"], count: 1}}],
				},
				racialAbilityChoices: {
					"Changeling|ERLW": {
						"choose_0_0": "dex",
						"choose_0_0_amount": 1,
					},
				},
			});

			// Fixed entry (CHA +2) must be included even when choose exists
			expect(builder._getRacialBonus("cha")).toBe(2);
			// Choose entry (DEX +1) must also be included
			expect(builder._getRacialBonus("dex")).toBe(1);
			// Unchosen ability must be 0
			expect(builder._getRacialBonus("str")).toBe(0);
		});

		test("_getRacialBonusesHtml includes both fixed and choose entries", () => {
			const builder = createBuilder({
				race: {
					name: "Changeling",
					source: "ERLW",
					ability: [{cha: 2, choose: {from: ["str", "dex", "con", "int", "wis"], count: 1}}],
				},
				racialAbilityChoices: {
					"Changeling|ERLW": {
						"choose_0_0": "dex",
						"choose_0_0_amount": 1,
					},
				},
			});

			const html = builder._getRacialBonusesHtml();
			// Must contain both the fixed CHA +2 and the chosen DEX +1
			expect(html).toContain("Charisma +2");
			expect(html).toContain("Dexterity +1");
		});

		test("_getRacialASITotal includes both fixed and choose from mixed ability set", () => {
			const builder = createBuilder({
				race: {
					name: "Changeling",
					source: "ERLW",
					ability: [{cha: 2, choose: {from: ["str", "dex", "con", "int", "wis"], count: 1}}],
				},
			});

			// Fixed CHA +2 plus choose 1×+1 = total 3
			expect(builder._getRacialASITotal()).toBe(3);
		});

		test("_getRacialASIBonuses includes both fixed and choose from mixed ability set", () => {
			const builder = createBuilder({
				race: {
					name: "Changeling",
					source: "ERLW",
					ability: [{cha: 2, choose: {from: ["str", "dex", "con", "int", "wis"], count: 1}}],
				},
			});

			const bonuses = builder._getRacialASIBonuses();
			// Should have 2 entries: fixed CHA +2 and choose +1
			expect(bonuses).toHaveLength(2);
			expect(bonuses.find(b => b.amount === 2 && !b.isChoose)).toBeTruthy();
			expect(bonuses.find(b => b.amount === 1 && b.isChoose)).toBeTruthy();
		});
	});

	describe("VRGR lineage weighted choose format", () => {
		// VRGR lineage races (Changeling|MPMM, Astral Elf|AAG, etc.) get auto-generated ability arrays:
		// [{choose: {weighted: {from: [...all 6], weights: [2, 1]}}}, {choose: {weighted: {from: [...all 6], weights: [1, 1, 1]}}}]
		// These are ALTERNATIVES (OR), not additive. The player picks one option.

		const VRGR_ABILITY = [
			{choose: {weighted: {from: ["str", "dex", "con", "int", "wis", "cha"], weights: [2, 1]}}},
			{choose: {weighted: {from: ["str", "dex", "con", "int", "wis", "cha"], weights: [1, 1, 1]}}},
		];

		test("_getRacialASITotal returns total for selected option (option 0: +2/+1)", () => {
			const builder = createBuilder({
				race: {name: "Changeling", source: "MPMM", ability: VRGR_ABILITY},
				racialAbilitySetIdx: {"Changeling|MPMM": 0},
			});
			// Option 0: weights [2, 1] → sum 3
			expect(builder._getRacialASITotal()).toBe(3);
		});

		test("_getRacialASITotal returns total for selected option (option 1: +1/+1/+1)", () => {
			const builder = createBuilder({
				race: {name: "Changeling", source: "MPMM", ability: VRGR_ABILITY},
				racialAbilitySetIdx: {"Changeling|MPMM": 1},
			});
			// Option 1: weights [1, 1, 1] → sum 3
			expect(builder._getRacialASITotal()).toBe(3);
		});

		test("_getRacialASIBonuses returns entries for selected option only", () => {
			const builder = createBuilder({
				race: {name: "Changeling", source: "MPMM", ability: VRGR_ABILITY},
				racialAbilitySetIdx: {"Changeling|MPMM": 0},
			});
			const bonuses = builder._getRacialASIBonuses();
			// Option 0: [2, 1] → 2 bonuses
			expect(bonuses).toHaveLength(2);
			expect(bonuses.find(b => b.amount === 2)).toBeTruthy();
			expect(bonuses.find(b => b.amount === 1)).toBeTruthy();
			expect(bonuses.every(b => b.isChoose)).toBe(true);
		});

		test("_getRacialASIBonuses for option 1 returns three +1 entries", () => {
			const builder = createBuilder({
				race: {name: "Changeling", source: "MPMM", ability: VRGR_ABILITY},
				racialAbilitySetIdx: {"Changeling|MPMM": 1},
			});
			const bonuses = builder._getRacialASIBonuses();
			expect(bonuses).toHaveLength(3);
			expect(bonuses.every(b => b.amount === 1 && b.isChoose)).toBe(true);
		});

		test("_getRacialBonus reads stored weighted amounts for selected option", () => {
			const builder = createBuilder({
				race: {name: "Astral Elf", source: "AAG", ability: VRGR_ABILITY},
				racialAbilitySetIdx: {"Astral Elf|AAG": 0},
				racialAbilityChoices: {
					"Astral Elf|AAG": {
						"choose_0_0": "int",
						"choose_0_0_amount": 2,
						"choose_0_1": "wis",
						"choose_0_1_amount": 1,
					},
				},
			});

			expect(builder._getRacialBonus("int")).toBe(2);
			expect(builder._getRacialBonus("wis")).toBe(1);
			expect(builder._getRacialBonus("dex")).toBe(0);
			expect(builder._getRacialBonus("str")).toBe(0);
		});

		test("_getRacialBonus with option 1 selected uses index 1 choices", () => {
			const builder = createBuilder({
				race: {name: "Astral Elf", source: "AAG", ability: VRGR_ABILITY},
				racialAbilitySetIdx: {"Astral Elf|AAG": 1},
				racialAbilityChoices: {
					"Astral Elf|AAG": {
						"choose_1_0": "dex",
						"choose_1_0_amount": 1,
						"choose_1_1": "con",
						"choose_1_1_amount": 1,
						"choose_1_2": "cha",
						"choose_1_2_amount": 1,
					},
				},
			});

			expect(builder._getRacialBonus("dex")).toBe(1);
			expect(builder._getRacialBonus("con")).toBe(1);
			expect(builder._getRacialBonus("cha")).toBe(1);
			expect(builder._getRacialBonus("int")).toBe(0);
		});

		test("_applyRacialAbilityBonuses applies only selected option (option 0)", () => {
			const state = createMockState();
			const builder = createBuilder({
				state,
				race: {name: "Changeling", source: "MPMM", ability: VRGR_ABILITY},
				racialAbilitySetIdx: {"Changeling|MPMM": 0},
				racialAbilityChoices: {
					"Changeling|MPMM": {
						"choose_0_0": "cha",
						"choose_0_0_amount": 2,
						"choose_0_1": "dex",
						"choose_0_1_amount": 1,
					},
				},
			});

			builder._currentStep = 1;
			builder._applyCurrentStep();

			expect(state.bonuses.cha).toBe(2);
			expect(state.bonuses.dex).toBe(1);
			expect(state.bonuses.str).toBe(0);
			expect(state.bonuses.con).toBe(0);
			expect(state.bonuses.wis).toBe(0);
			expect(state.bonuses.int).toBe(0);
		});

		test("_applyRacialAbilityBonuses applies only selected option (option 1)", () => {
			const state = createMockState();
			const builder = createBuilder({
				state,
				race: {name: "Changeling", source: "MPMM", ability: VRGR_ABILITY},
				racialAbilitySetIdx: {"Changeling|MPMM": 1},
				racialAbilityChoices: {
					"Changeling|MPMM": {
						"choose_1_0": "str",
						"choose_1_0_amount": 1,
						"choose_1_1": "con",
						"choose_1_1_amount": 1,
						"choose_1_2": "wis",
						"choose_1_2_amount": 1,
					},
				},
			});

			builder._currentStep = 1;
			builder._applyCurrentStep();

			expect(state.bonuses.str).toBe(1);
			expect(state.bonuses.con).toBe(1);
			expect(state.bonuses.wis).toBe(1);
			expect(state.bonuses.cha).toBe(0);
			expect(state.bonuses.dex).toBe(0);
			expect(state.bonuses.int).toBe(0);
		});

		test("_getRacialBonusesHtml shows weighted bonuses for selected option", () => {
			const builder = createBuilder({
				race: {name: "Changeling", source: "MPMM", ability: VRGR_ABILITY},
				racialAbilitySetIdx: {"Changeling|MPMM": 0},
				racialAbilityChoices: {
					"Changeling|MPMM": {
						"choose_0_0": "cha",
						"choose_0_0_amount": 2,
						"choose_0_1": "dex",
						"choose_0_1_amount": 1,
					},
				},
			});

			const html = builder._getRacialBonusesHtml();
			expect(html).toContain("Charisma +2");
			expect(html).toContain("Dexterity +1");
			// Should NOT contain Choose 3 more (that's from option 1 which is not selected)
			expect(html).not.toContain("Choose 3 more");
		});

		test("defaults to option 0 when no selection stored", () => {
			const builder = createBuilder({
				race: {name: "Changeling", source: "MPMM", ability: VRGR_ABILITY},
			});
			// Default to option 0: weights [2, 1] → total 3
			expect(builder._getRacialASITotal()).toBe(3);
		});

		test("weighted choose with single ability set (weights [2, 1] only)", () => {
			const builder = createBuilder({
				race: {
					name: "Custom Lineage",
					source: "TCE",
					ability: [{choose: {weighted: {from: ["str", "dex", "con", "int", "wis", "cha"], weights: [2, 1]}}}],
				},
				racialAbilityChoices: {
					"Custom Lineage|TCE": {
						"choose_0_0": "str",
						"choose_0_0_amount": 2,
						"choose_0_1": "con",
						"choose_0_1_amount": 1,
					},
				},
			});

			expect(builder._getRacialASITotal()).toBe(3);
			expect(builder._getRacialBonus("str")).toBe(2);
			expect(builder._getRacialBonus("con")).toBe(1);
		});
	});

	describe("TGTT races with ability data get Tasha's toggle", () => {
		test("_raceUses2024ASI returns false for TGTT race with fixed ASI", () => {
			const builder = createBuilder({
				race: {name: "Nyuidj", source: "TGTT", ability: [{int: 2, wis: 1}]},
			});
			expect(builder._raceUses2024ASI()).toBe(false);
		});

		test("_raceUses2024ASI returns true for XPHB race with no ability field", () => {
			const builder = createBuilder({
				race: {name: "Aasimar", source: "XPHB", edition: "one"},
			});
			expect(builder._raceUses2024ASI()).toBe(true);
		});

		test("_raceUses2024ASI returns true for race with empty ability array", () => {
			const builder = createBuilder({
				race: {name: "Test", source: "XPHB", ability: []},
			});
			expect(builder._raceUses2024ASI()).toBe(true);
		});

		test("TGTT race with fixed ASI applies bonuses normally (no Tasha's)", () => {
			const state = createMockState();
			const builder = createBuilder({
				state,
				race: {name: "Nyuidj", source: "TGTT", ability: [{int: 2, wis: 1}]},
			});

			builder._currentStep = 1;
			builder._applyCurrentStep();
			expect(state.bonuses.int).toBe(2);
			expect(state.bonuses.wis).toBe(1);
			expect(state.bonuses.str).toBe(0);
		});

		test("TGTT race with Tasha's enabled reassigns bonuses", () => {
			const state = createMockState();
			const builder = createBuilder({
				state,
				race: {name: "Nyuidj", source: "TGTT", ability: [{int: 2, wis: 1}]},
			});

			builder._useTashasRules = true;
			builder._tashasAbilityBonuses = {
				tasha_0: "cha",
				tasha_0_amount: 2,
				tasha_1: "dex",
				tasha_1_amount: 1,
			};
			builder._tashasSkillReplacements = [];
			builder._tashasLanguageReplacements = [];

			builder._currentStep = 1;
			builder._applyCurrentStep();
			expect(state.bonuses.cha).toBe(2);
			expect(state.bonuses.dex).toBe(1);
			expect(state.bonuses.int).toBe(0); // Original INT +2 reassigned
			expect(state.bonuses.wis).toBe(0); // Original WIS +1 reassigned
		});

		test("TGTT race with mixed fixed+choose ASI applies correctly", () => {
			const state = createMockState();
			// Dendulra: +2 CHA (fixed) + choose +1 from [wis, dex]
			const builder = createBuilder({
				state,
				race: {
					name: "Dendulra",
					source: "TGTT",
					ability: [{cha: 2, choose: {from: ["wis", "dex"], count: 1, amount: 1}}],
				},
				racialAbilityChoices: {
					"Dendulra|TGTT": {
						"choose_0_0": "wis",
						"choose_0_0_amount": 1,
					},
				},
			});

			builder._currentStep = 1;
			builder._applyCurrentStep();
			expect(state.bonuses.cha).toBe(2);
			expect(state.bonuses.wis).toBe(1);
			expect(state.bonuses.dex).toBe(0);
		});

		test("_getRacialASITotal works for TGTT race", () => {
			const builder = createBuilder({
				race: {name: "Nyuidj", source: "TGTT", ability: [{int: 2, wis: 1}]},
			});
			expect(builder._getRacialASITotal()).toBe(3);
		});
	});
});
