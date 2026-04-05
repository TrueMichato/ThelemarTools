import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

describe("CharacterSheetQuickBuild Feat Ability Score Stacking", () => {
	/**
	 * Bug: Feats that add ability score increases don't take into account previous increases
	 * from race, other feats, or ASIs in the same QuickBuild session.
	 *
	 * The fix adds feat ability choices to computeRunningScores() so subsequent levels
	 * see the correct cumulative ability totals.
	 */

	describe("_getFeatAbilityAmount helper", () => {
		let qb;

		beforeEach(() => {
			qb = Object.create(CharacterSheetQuickBuild.prototype);
		});

		test("returns 0 for feat without ability field", () => {
			const feat = {name: "Alert", source: "PHB"};
			expect(qb._getFeatAbilityAmount(feat)).toBe(0);
		});

		test("returns 0 for feat with fixed ability bonus (no choose)", () => {
			// Fixed ability bonuses like {str: 1} don't have a choose field
			const feat = {
				name: "Custom",
				source: "PHB",
				ability: [{str: 1}],
			};
			expect(qb._getFeatAbilityAmount(feat)).toBe(0);
		});

		test("returns amount from feat with choosable ability", () => {
			const feat = {
				name: "Athlete",
				source: "PHB",
				ability: [{choose: {from: ["str", "dex"], amount: 1}}],
			};
			expect(qb._getFeatAbilityAmount(feat)).toBe(1);
		});

		test("returns default amount of 1 when choose.amount is not specified", () => {
			const feat = {
				name: "Custom",
				source: "HB",
				ability: [{choose: {from: ["str", "dex"]}}],
			};
			expect(qb._getFeatAbilityAmount(feat)).toBe(1);
		});

		test("returns higher amount for feats that grant +2", () => {
			const feat = {
				name: "Custom",
				source: "HB",
				ability: [{choose: {from: ["str", "dex"], amount: 2}}],
			};
			expect(qb._getFeatAbilityAmount(feat)).toBe(2);
		});

		test("returns 0 for null/undefined feat", () => {
			expect(qb._getFeatAbilityAmount(null)).toBe(0);
			expect(qb._getFeatAbilityAmount(undefined)).toBe(0);
		});
	});

	describe("Running scores include feat ability choices", () => {
		/**
		 * Test scenario:
		 * - Level 4: Choose feat "Athlete" with +1 to STR
		 * - Level 8: Running scores should show STR increased by that +1
		 */

		test("running scores include feat ability choice from previous level", () => {
			const qb = Object.create(CharacterSheetQuickBuild.prototype);

			// Mock state that returns base ability scores (e.g., 14 STR with racial bonus)
			qb._state = {
				getAbilityScore: jest.fn((abl) => {
					// Simulate racial +2 STR making total 12
					if (abl === "str") return 12;
					return 10;
				}),
			};

			// ASI levels at 4 and 8
			const asiLevels = [
				{className: "Fighter", classLevel: 4},
				{className: "Fighter", classLevel: 8},
			];

			// Level 4: Chose feat mode with Athlete (+1 STR)
			qb._selections = {
				asi: {
					"Fighter_4": {
						mode: "feat",
						isBoth: false,
						abilityChoices: {},
						feat: {
							name: "Athlete",
							source: "PHB",
							ability: [{choose: {from: ["str", "dex"], amount: 1}}],
						},
						featChoices: {ability: "str"},
					},
				},
			};

			// Manually test the computeRunningScores logic
			const computeRunningScores = (upToIdx) => {
				const scores = {};
				["str", "dex", "con", "int", "wis", "cha"].forEach(abl => {
					scores[abl] = qb._state.getAbilityScore(abl);
				});
				for (let i = 0; i < upToIdx; i++) {
					const prevKey = `${asiLevels[i].className}_${asiLevels[i].classLevel}`;
					const prevSel = qb._selections.asi[prevKey];
					if (!prevSel) continue;

					// Include ASI ability choices
					if (prevSel.mode === "asi" || prevSel.isBoth) {
						for (const [abl, inc] of Object.entries(prevSel.abilityChoices || {})) {
							scores[abl] = (scores[abl] || 0) + inc;
						}
					}

					// Include feat ability choices
					if ((prevSel.mode === "feat" || prevSel.isBoth) && prevSel.feat && prevSel.featChoices?.ability) {
						const amount = qb._getFeatAbilityAmount(prevSel.feat);
						if (amount > 0) {
							scores[prevSel.featChoices.ability] = (scores[prevSel.featChoices.ability] || 0) + amount;
						}
					}
				}
				return scores;
			};

			// Level 4 (idx 0): Should see base scores (no prior ASI/feat)
			const scoresAtLevel4 = computeRunningScores(0);
			expect(scoresAtLevel4.str).toBe(12); // Just racial bonus

			// Level 8 (idx 1): Should see +1 STR from level 4 feat
			const scoresAtLevel8 = computeRunningScores(1);
			expect(scoresAtLevel8.str).toBe(13); // 12 + 1 from Athlete
			expect(scoresAtLevel8.dex).toBe(10); // Unchanged
		});

		test("running scores combine ASI and feat ability bonuses (isBoth mode)", () => {
			const qb = Object.create(CharacterSheetQuickBuild.prototype);

			qb._state = {
				getAbilityScore: jest.fn((abl) => {
					if (abl === "str") return 12;
					if (abl === "con") return 14;
					return 10;
				}),
			};

			const asiLevels = [
				{className: "Fighter", classLevel: 4},
				{className: "Fighter", classLevel: 8},
			];

			// Level 4: isBoth mode (Thelemar) - ASI +2 to STR AND feat with +1 CON
			qb._selections = {
				asi: {
					"Fighter_4": {
						mode: "feat", // Mode is feat but isBoth means both apply
						isBoth: true,
						abilityChoices: {str: 2}, // +2 STR from ASI
						feat: {
							name: "Resilient",
							source: "PHB",
							ability: [{choose: {from: ["str", "dex", "con", "int", "wis", "cha"], amount: 1}}],
						},
						featChoices: {ability: "con"}, // +1 CON from feat
					},
				},
			};

			const computeRunningScores = (upToIdx) => {
				const scores = {};
				["str", "dex", "con", "int", "wis", "cha"].forEach(abl => {
					scores[abl] = qb._state.getAbilityScore(abl);
				});
				for (let i = 0; i < upToIdx; i++) {
					const prevKey = `${asiLevels[i].className}_${asiLevels[i].classLevel}`;
					const prevSel = qb._selections.asi[prevKey];
					if (!prevSel) continue;

					if (prevSel.mode === "asi" || prevSel.isBoth) {
						for (const [abl, inc] of Object.entries(prevSel.abilityChoices || {})) {
							scores[abl] = (scores[abl] || 0) + inc;
						}
					}

					if ((prevSel.mode === "feat" || prevSel.isBoth) && prevSel.feat && prevSel.featChoices?.ability) {
						const amount = qb._getFeatAbilityAmount(prevSel.feat);
						if (amount > 0) {
							scores[prevSel.featChoices.ability] = (scores[prevSel.featChoices.ability] || 0) + amount;
						}
					}
				}
				return scores;
			};

			// Level 8: Should see both +2 STR (ASI) and +1 CON (feat) from level 4
			const scoresAtLevel8 = computeRunningScores(1);
			expect(scoresAtLevel8.str).toBe(14); // 12 + 2 ASI
			expect(scoresAtLevel8.con).toBe(15); // 14 + 1 feat
		});

		test("running scores accumulate across multiple ASI levels", () => {
			const qb = Object.create(CharacterSheetQuickBuild.prototype);

			qb._state = {
				getAbilityScore: jest.fn((abl) => {
					if (abl === "str") return 14;
					return 10;
				}),
			};

			const asiLevels = [
				{className: "Fighter", classLevel: 4},
				{className: "Fighter", classLevel: 6},
				{className: "Fighter", classLevel: 8},
			];

			qb._selections = {
				asi: {
					// Level 4: Athlete feat +1 STR
					"Fighter_4": {
						mode: "feat",
						isBoth: false,
						abilityChoices: {},
						feat: {
							name: "Athlete",
							source: "PHB",
							ability: [{choose: {from: ["str", "dex"], amount: 1}}],
						},
						featChoices: {ability: "str"},
					},
					// Level 6: ASI +2 STR
					"Fighter_6": {
						mode: "asi",
						isBoth: false,
						abilityChoices: {str: 2},
						feat: null,
						featChoices: {},
					},
				},
			};

			const computeRunningScores = (upToIdx) => {
				const scores = {};
				["str", "dex", "con", "int", "wis", "cha"].forEach(abl => {
					scores[abl] = qb._state.getAbilityScore(abl);
				});
				for (let i = 0; i < upToIdx; i++) {
					const prevKey = `${asiLevels[i].className}_${asiLevels[i].classLevel}`;
					const prevSel = qb._selections.asi[prevKey];
					if (!prevSel) continue;

					if (prevSel.mode === "asi" || prevSel.isBoth) {
						for (const [abl, inc] of Object.entries(prevSel.abilityChoices || {})) {
							scores[abl] = (scores[abl] || 0) + inc;
						}
					}

					if ((prevSel.mode === "feat" || prevSel.isBoth) && prevSel.feat && prevSel.featChoices?.ability) {
						const amount = qb._getFeatAbilityAmount(prevSel.feat);
						if (amount > 0) {
							scores[prevSel.featChoices.ability] = (scores[prevSel.featChoices.ability] || 0) + amount;
						}
					}
				}
				return scores;
			};

			// Level 4: Base scores only
			expect(computeRunningScores(0).str).toBe(14);

			// Level 6: +1 from level 4 feat
			expect(computeRunningScores(1).str).toBe(15);

			// Level 8: +1 from level 4 feat + 2 from level 6 ASI
			expect(computeRunningScores(2).str).toBe(17);
		});
	});

	describe("_computeRunningScoresWithCurrentASI (within-level sync for isBoth mode)", () => {
		let qb;

		beforeEach(() => {
			qb = Object.create(CharacterSheetQuickBuild.prototype);
		});

		test("adds current level ASI choices to running scores", () => {
			const runningScores = {str: 12, dex: 10, con: 14, int: 10, wis: 10, cha: 10};
			const sel = {
				abilityChoices: {str: 2},
			};

			const result = qb._computeRunningScoresWithCurrentASI(runningScores, sel);
			expect(result.str).toBe(14); // 12 + 2 from ASI
			expect(result.con).toBe(14); // Unchanged
			expect(result.dex).toBe(10); // Unchanged
		});

		test("returns copy of running scores when no ASI choices", () => {
			const runningScores = {str: 12, dex: 10, con: 14, int: 10, wis: 10, cha: 10};
			const sel = {abilityChoices: {}};

			const result = qb._computeRunningScoresWithCurrentASI(runningScores, sel);
			expect(result.str).toBe(12);
			expect(result).not.toBe(runningScores); // Should be a new object
		});

		test("handles split ASI (+1/+1) correctly", () => {
			const runningScores = {str: 12, dex: 10, con: 14, int: 10, wis: 10, cha: 10};
			const sel = {
				abilityChoices: {str: 1, dex: 1},
			};

			const result = qb._computeRunningScoresWithCurrentASI(runningScores, sel);
			expect(result.str).toBe(13);
			expect(result.dex).toBe(11);
		});

		test("handles undefined abilityChoices gracefully", () => {
			const runningScores = {str: 12, dex: 10, con: 14, int: 10, wis: 10, cha: 10};
			const sel = {};

			const result = qb._computeRunningScoresWithCurrentASI(runningScores, sel);
			expect(result.str).toBe(12);
		});
	});
});
