/**
 * Beastheart (MCDM, BST) — the Ferocity track.
 *
 * Ferocity is the class's central mechanic and it obeys none of the sheet's existing
 * pool conventions, so these tests assert the RULES, not the plumbing:
 *
 *   * gain is `1d4 + hostiles within 5 ft`, at the start of the shared turn, and only
 *     when the companion is not incapacitated;
 *   * there is no maximum;
 *   * a rampage is RISKED at 10+, on a DC of `5 + ferocity`, and resolving one drops
 *     ferocity to 0 WITHOUT healing;
 *   * end of combat heals the companion BY its ferocity, then zeroes the track —
 *     except for a dying companion, which gets nothing;
 *   * exploits may be fuelled while unconscious but never while rampaging.
 *
 * Every assertion is on a derived number or an observable refusal. There are no
 * `expect(calc.hasX).toBe(true)` assertions in this file by design.
 */

import "./beastheartTestHarness.js";
import BST from "./fixtures/beastheart-bst.json" with {type: "json"};

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const getMonster = name => BST.monster.find(m => m.name === name);

describe("Beastheart — Ferocity", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		CharacterSheetState._CLASS_SUMMON_SCALER = undefined;
	});

	function setLevel (level, subclass = null) {
		state.addClass({name: "Beastheart", source: "BST", level, hitDice: "d8"});
		if (subclass) {
			const cls = state.getClasses().find(c => c.name === "Beastheart");
			cls.subclass = {name: `${subclass} Bond`, shortName: subclass, source: "BST"};
		}
	}

	function makeBeastheart (level, {subclass = null, companionName = "Owlbear Companion"} = {}) {
		setLevel(level, subclass);
		state.setAbilityBase("str", 12);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 16);
		state.setAbilityBase("cha", 10);
		state.setCurrentHp(state.getMaxHp());
		return state.addCompanionFromBestiary(
			getMonster(companionName),
			CharacterSheetState.COMPANION_TYPES.BEASTHEART_COMPANION,
			"Companion",
			{
				scaling: {
					className: "Beastheart",
					statblockScaler: "classSummon",
					statblock: getMonster(companionName),
				},
			},
		);
	}

	// -------------------------------------------------------------------------
	// Gain — 1d4 + hostiles within 5 ft
	// -------------------------------------------------------------------------
	describe("gaining ferocity at the start of the turn", () => {
		it("adds the d4 result plus one per hostile within 5 feet", () => {
			const id = makeBeastheart(1);
			const res = state.gainCompanionFerocity(id, {roll: 3, hostilesWithin5: 2});
			expect(res.gained).toBe(5);
			expect(state.getCompanionFerocity(id)).toBe(5);
		});

		it("counts no hostiles as just the die", () => {
			const id = makeBeastheart(1);
			state.gainCompanionFerocity(id, {roll: 4, hostilesWithin5: 0});
			expect(state.getCompanionFerocity(id)).toBe(4);
		});

		it("accumulates across turns with no maximum", () => {
			const id = makeBeastheart(1);
			for (let i = 0; i < 8; ++i) state.gainCompanionFerocity(id, {roll: 4, hostilesWithin5: 3});
			// 8 turns x (4 + 3) = 56 — far past the rampage threshold, and not clamped.
			expect(state.getCompanionFerocity(id)).toBe(56);
		});

		it("rolls a d4 in range when no explicit roll is supplied", () => {
			const id = makeBeastheart(1);
			for (let i = 0; i < 40; ++i) {
				state.setCompanionFerocity(id, 0);
				const {roll} = state.gainCompanionFerocity(id, {hostilesWithin5: 0});
				expect(roll).toBeGreaterThanOrEqual(1);
				expect(roll).toBeLessThanOrEqual(4);
			}
		});

		it("gains nothing while the companion is incapacitated", () => {
			const id = makeBeastheart(1);
			state.setCompanionFerocity(id, 4);
			state.addCompanionCondition(id, "Unconscious");

			const res = state.gainCompanionFerocity(id, {roll: 4, hostilesWithin5: 3});
			expect(res.gained).toBe(0);
			expect(state.getCompanionFerocity(id)).toBe(4);
		});

		it("gains nothing at 0 hit points", () => {
			const id = makeBeastheart(1);
			state.setCompanionHp(id, 0);
			const res = state.gainCompanionFerocity(id, {roll: 4});
			expect(res.gained).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// Beyond Instinct — extra ferocity per gain at 5th / 10th / 15th
	// -------------------------------------------------------------------------
	describe("Beyond Instinct raises the ferocity gained per turn", () => {
		it.each([
			[1, 0],
			[4, 0],
			[5, 1],
			[9, 1],
			[10, 3],
			[14, 3],
			[15, 5],
			[20, 5],
		])("at Beastheart %i the bonus is +%i", (level, bonus) => {
			const id = makeBeastheart(level);
			const res = state.gainCompanionFerocity(id, {roll: 1, hostilesWithin5: 0});
			expect(res.bonus).toBe(bonus);
			expect(state.getCompanionFerocity(id)).toBe(1 + bonus);
		});

		it("is an increase-to, not a running sum, across the three tiers", () => {
			// If the three grants were added together a 15th-level beastheart would get
			// +9. The feature says the companion "gains 5 additional ferocity", so it is 5.
			const id = makeBeastheart(15);
			expect(state.gainCompanionFerocity(id, {roll: 1}).bonus).toBe(5);
		});
	});

	// -------------------------------------------------------------------------
	// Rampage — risk, DC, resolution
	// -------------------------------------------------------------------------
	describe("rampage", () => {
		it("is not risked below 10 ferocity", () => {
			const id = makeBeastheart(1);
			state.setCompanionFerocity(id, 9);
			expect(state.isCompanionRampageRisk(id)).toBe(false);
		});

		it("is risked at exactly 10 ferocity", () => {
			const id = makeBeastheart(1);
			state.setCompanionFerocity(id, 10);
			expect(state.isCompanionRampageRisk(id)).toBe(true);
		});

		it.each([
			[10, 15],
			[12, 17],
			[23, 28],
		])("at %i ferocity the check DC is %i", (ferocity, dc) => {
			const id = makeBeastheart(1);
			state.setCompanionFerocity(id, ferocity);
			expect(state.getCompanionRampageDc(id)).toBe(dc);
		});

		it("a successful check keeps the companion out of a rampage and keeps its ferocity", () => {
			const id = makeBeastheart(1);
			state.setCompanionFerocity(id, 12);
			const res = state.resolveCompanionRampageCheck(id, {isSuccess: true});
			expect(res.isRampaging).toBe(false);
			expect(state.getCompanionFerocity(id)).toBe(12);
		});

		it("a failed check starts a rampage", () => {
			const id = makeBeastheart(1);
			state.setCompanionFerocity(id, 12);
			expect(state.resolveCompanionRampageCheck(id, {isSuccess: false}).isRampaging).toBe(true);
		});

		it("declining the check is treated exactly like failing it", () => {
			const id = makeBeastheart(1);
			state.setCompanionFerocity(id, 11);
			expect(state.resolveCompanionRampageCheck(id, {isDeclined: true}).isRampaging).toBe(true);
		});

		it("ending a rampage discards all ferocity and heals nothing", () => {
			const id = makeBeastheart(1);
			state.setCompanionHp(id, 5);
			state.setCompanionFerocity(id, 14);
			state.resolveCompanionRampageCheck(id, {isSuccess: false});

			const discarded = state.endCompanionRampage(id);
			expect(discarded).toBe(14);
			expect(state.getCompanionFerocity(id)).toBe(0);
			expect(state.getCompanion(id).isRampaging).toBe(false);
			expect(state.getCompanion(id).hp.current).toBe(5); // no healing — that is end-of-combat
		});

		it("a rampaging signature attack deals half the ferocity as extra damage", () => {
			const id = makeBeastheart(1);
			state.setCompanionFerocity(id, 13);
			expect(state.getCompanionRampageBonusDamage(id)).toBe(6); // floor(13/2)
		});
	});

	// -------------------------------------------------------------------------
	// Spending — the two explicit legality rules
	// -------------------------------------------------------------------------
	describe("spending ferocity", () => {
		it("deducts the cost and reports what was spent", () => {
			const id = makeBeastheart(2);
			state.setCompanionFerocity(id, 7);
			const res = state.spendCompanionFerocity(id, 4);
			expect(res.ok).toBe(true);
			expect(res.spent).toBe(4);
			expect(state.getCompanionFerocity(id)).toBe(3);
		});

		it("refuses when the companion cannot afford the exploit, and spends nothing", () => {
			const id = makeBeastheart(2);
			state.setCompanionFerocity(id, 3);
			const res = state.spendCompanionFerocity(id, 4);
			expect(res.ok).toBe(false);
			expect(res.reason).toBe("insufficient");
			expect(state.getCompanionFerocity(id)).toBe(3);
		});

		it("is refused while the companion is rampaging", () => {
			const id = makeBeastheart(2);
			state.setCompanionFerocity(id, 12);
			state.resolveCompanionRampageCheck(id, {isSuccess: false});

			const res = state.spendCompanionFerocity(id, 2);
			expect(res.ok).toBe(false);
			expect(res.reason).toBe("rampaging");
			expect(state.getCompanionFerocity(id)).toBe(12);
		});

		it("is still allowed while the companion is unconscious", () => {
			// The rules call this out explicitly: exploits work on a downed companion.
			const id = makeBeastheart(2);
			state.setCompanionFerocity(id, 6);
			state.setCompanionHp(id, 0);

			const res = state.spendCompanionFerocity(id, 4);
			expect(res.ok).toBe(true);
			expect(state.getCompanionFerocity(id)).toBe(2);
		});
	});

	// -------------------------------------------------------------------------
	// End of combat — heal by ferocity, then zero
	// -------------------------------------------------------------------------
	describe("end of combat", () => {
		it("heals the companion by its ferocity and then clears the track", () => {
			const id = makeBeastheart(5); // 42 max HP
			state.setCompanionHp(id, 20);
			state.setCompanionFerocity(id, 9);

			const [res] = state.endCompanionCombat(id);
			expect(res.healed).toBe(9);
			expect(state.getCompanion(id).hp.current).toBe(29);
			expect(state.getCompanionFerocity(id)).toBe(0);
		});

		it("never heals past the companion's maximum", () => {
			const id = makeBeastheart(1); // 14 max HP
			state.setCompanionHp(id, 12);
			state.setCompanionFerocity(id, 9);

			const [res] = state.endCompanionCombat(id);
			expect(res.healed).toBe(2);
			expect(state.getCompanion(id).hp.current).toBe(14);
		});

		it("withholds the healing from a dying companion but still clears the track", () => {
			const id = makeBeastheart(5);
			state.setCompanionHp(id, 0);
			state.setCompanionFerocity(id, 11);

			const [res] = state.endCompanionCombat(id);
			expect(res.healed).toBe(0);
			expect(state.getCompanion(id).hp.current).toBe(0);
			expect(state.getCompanionFerocity(id)).toBe(0);
		});

		it("also ends any rampage in progress", () => {
			const id = makeBeastheart(5);
			state.setCompanionFerocity(id, 12);
			state.resolveCompanionRampageCheck(id, {isSuccess: false});

			state.endCompanionCombat(id);
			expect(state.getCompanion(id).isRampaging).toBe(false);
		});

		it("is applied by a short rest, since a rest means combat is over", () => {
			const id = makeBeastheart(5);
			state.setCompanionHp(id, 30);
			state.setCompanionFerocity(id, 8);

			state.onShortRest();
			expect(state.getCompanionFerocity(id)).toBe(0);
		});

		it("is applied by a long rest", () => {
			const id = makeBeastheart(5);
			state.setCompanionFerocity(id, 8);
			state.onLongRest();
			expect(state.getCompanionFerocity(id)).toBe(0);
		});
	});

	// -------------------------------------------------------------------------
	// Unbreakable Friendship (20th)
	// -------------------------------------------------------------------------
	describe("Unbreakable Friendship (20th)", () => {
		it("makes the rampage check succeed automatically while the caregiver is up", () => {
			const id = makeBeastheart(20);
			state.setCompanionFerocity(id, 30);

			const res = state.resolveCompanionRampageCheck(id, {isSuccess: false});
			expect(res.isAutomatic).toBe(true);
			expect(res.isRampaging).toBe(false);
			expect(state.getCompanionFerocity(id)).toBe(30);
		});

		it("stops applying once the caregiver is at 0 hit points", () => {
			const id = makeBeastheart(20);
			state.setCurrentHp(0);
			state.setCompanionFerocity(id, 30);

			const res = state.resolveCompanionRampageCheck(id, {isSuccess: false});
			expect(res.isAutomatic).toBe(false);
			expect(res.isRampaging).toBe(true);
		});

		it("does not apply below 20th level", () => {
			const id = makeBeastheart(19);
			state.setCompanionFerocity(id, 30);
			expect(state.resolveCompanionRampageCheck(id, {isSuccess: false}).isRampaging).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// Ferocious Bond alters two of the rules above
	// -------------------------------------------------------------------------
	describe("Ferocious Bond changes the rampage rules", () => {
		it("Energizing Rampage (7th) leaves 4 ferocity behind instead of 0", () => {
			const id = makeBeastheart(7, {subclass: "Ferocious"});
			state.setCompanionFerocity(id, 16);
			state.resolveCompanionRampageCheck(id, {isSuccess: false});

			state.endBeastheartRampage(id);
			expect(state.getCompanionFerocity(id)).toBe(4);
			expect(state.getCompanion(id).isRampaging).toBe(false);
		});

		it("never raises ferocity — the floor only ever holds ferocity back from 0", () => {
			// Unreachable in play (a rampage needs 10+ ferocity to start, and exploits
			// can't be spent while rampaging), but the floor must not invent ferocity.
			const id = makeBeastheart(7, {subclass: "Ferocious"});
			state.setCompanionFerocity(id, 2);
			state.resolveCompanionRampageCheck(id, {isSuccess: false});
			state.endBeastheartRampage(id);
			expect(state.getCompanionFerocity(id)).toBe(2);
		});

		it("Furious Rampage (11th) upgrades the bonus damage from half to full ferocity", () => {
			const id = makeBeastheart(11, {subclass: "Ferocious"});
			state.setCompanionFerocity(id, 13);
			expect(state.getBeastheartRampageBonusDamage(id)).toBe(13);
		});

		it("leaves the bonus at half ferocity before 11th level", () => {
			const id = makeBeastheart(7, {subclass: "Ferocious"});
			state.setCompanionFerocity(id, 13);
			expect(state.getBeastheartRampageBonusDamage(id)).toBe(6);
		});

		it("leaves the bonus at half ferocity for other bonds at 11th", () => {
			const id = makeBeastheart(11, {subclass: "Protector"});
			state.setCompanionFerocity(id, 13);
			expect(state.getBeastheartRampageBonusDamage(id)).toBe(6);
		});
	});

	// -------------------------------------------------------------------------
	// Persistence
	// -------------------------------------------------------------------------
	describe("persistence", () => {
		it("round-trips ferocity and rampage state through save/load", () => {
			const id = makeBeastheart(5);
			state.setCompanionFerocity(id, 12);
			state.resolveCompanionRampageCheck(id, {isSuccess: false});

			const reloaded = new CharacterSheetState();
			reloaded.loadFromJson(state.toJson());

			expect(reloaded.getCompanionFerocity(id)).toBe(12);
			expect(reloaded.getCompanion(id).isRampaging).toBe(true);
			expect(reloaded.getCompanionRampageDc(id)).toBe(17);
		});

		it("treats a companion saved before ferocity existed as being at 0", () => {
			const id = makeBeastheart(5);
			const json = state.toJson();
			delete json.companions[0].ferocity;
			delete json.companions[0].isRampaging;

			const reloaded = new CharacterSheetState();
			reloaded.loadFromJson(json);

			expect(reloaded.getCompanionFerocity(id)).toBe(0);
			expect(reloaded.getCompanionRampageDc(id)).toBe(5);
		});
	});
});
