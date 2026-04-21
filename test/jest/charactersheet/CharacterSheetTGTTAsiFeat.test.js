/**
 * Regression tests for the Thelemar (TGTT) "ASI + Feat at level 4" rule.
 *
 * The rule MUST trigger at the level-up that brings the CHARACTER to total level 4,
 * regardless of which class is being leveled. This matters for multiclass characters,
 * where class level 4 and character level 4 can diverge.
 *
 * See bugs.md (resolved): the rule previously checked per-class level 4, so a
 * multiclass character (e.g. Fighter 3 -> Rogue 1) never received the bonus.
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Thelemar (TGTT) ASI + Feat at character level 4", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setSetting("thelemar_asiFeat", true);
	});

	describe("shouldGrantBothAsiAndFeat", () => {
		it("returns true at character level 4 when the setting is enabled", () => {
			expect(state.shouldGrantBothAsiAndFeat(4)).toBe(true);
		});

		it("returns false at character level 3, 5, 6, 8, 12, 16, 19", () => {
			[3, 5, 6, 8, 12, 16, 19, 20].forEach(lvl => {
				expect(state.shouldGrantBothAsiAndFeat(lvl)).toBe(false);
			});
		});

		it("returns false at any level when the setting is disabled", () => {
			state.setSetting("thelemar_asiFeat", false);
			[1, 2, 3, 4, 5, 8, 12, 19].forEach(lvl => {
				expect(state.shouldGrantBothAsiAndFeat(lvl)).toBe(false);
			});
		});

		it("uses the character level argument it is given (does not auto-read state)", () => {
			// Helper is pure with respect to its argument; verifying that contract
			// guarantees both the level-up wizard (newCharacterLevel = total+1) and
			// the apply path (newCharacterLevel = total) can use it correctly.
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			expect(state.shouldGrantBothAsiAndFeat(4)).toBe(true);
			expect(state.shouldGrantBothAsiAndFeat(state.getTotalLevel())).toBe(false);
		});
	});

	describe("Multiclass scenarios", () => {
		it("fires for a single-class character reaching level 4 (Fighter 3 -> 4)", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			// Apply path: targetClass.level = 4 has just happened, so total = 4.
			const totalAfterLevelUp = 4;
			expect(state.shouldGrantBothAsiAndFeat(totalAfterLevelUp)).toBe(true);
		});

		it("fires for a multiclass character reaching character level 4 via a new class (Fighter 3 + Rogue 1)", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			state.addClass({name: "Rogue", source: "PHB", level: 1});
			// After this multiclass dip, total character level is 4 even though Rogue class level is 1.
			expect(state.getTotalLevel()).toBe(4);
			expect(state.shouldGrantBothAsiAndFeat(state.getTotalLevel())).toBe(true);
		});

		it("does NOT fire when only Rogue class level reaches 4 but character level is higher (Fighter 3 + Rogue 4 = char 7)", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			state.addClass({name: "Rogue", source: "PHB", level: 4});
			expect(state.getTotalLevel()).toBe(7);
			expect(state.shouldGrantBothAsiAndFeat(state.getTotalLevel())).toBe(false);
		});

		it("does NOT fire when a Rogue class hits its own level 4 after the character already passed level 4 (Fighter 4 + Rogue 4 = char 8)", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 4});
			state.addClass({name: "Rogue", source: "PHB", level: 4});
			expect(state.getTotalLevel()).toBe(8);
			expect(state.shouldGrantBothAsiAndFeat(state.getTotalLevel())).toBe(false);
		});

		it("does NOT fire when multiclassing INTO a new class above character level 4 (Fighter 4 then Wizard 1 = char 5)", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 4});
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			expect(state.getTotalLevel()).toBe(5);
			expect(state.shouldGrantBothAsiAndFeat(state.getTotalLevel())).toBe(false);
		});

		it("fires exactly once across an entire 1-20 progression", () => {
			let triggers = 0;
			for (let lvl = 1; lvl <= 20; lvl++) {
				if (state.shouldGrantBothAsiAndFeat(lvl)) triggers++;
			}
			expect(triggers).toBe(1);
		});
	});
});
