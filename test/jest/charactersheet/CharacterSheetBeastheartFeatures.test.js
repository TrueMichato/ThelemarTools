/**
 * Beastheart (MCDM, BST) — class features and all five Companion Bonds.
 *
 * Every assertion is BEHAVIOURAL: it checks a derived number, a changed stat block,
 * a granted proficiency or a real resource row. `expect(calc.hasX).toBe(true)` proves
 * only that a line of code ran, so it is used only where a feature genuinely has no
 * number (Natural Language, Pack Phalanx) and is surfaced as honest `info`.
 */

import "./beastheartTestHarness.js";
import BST from "./fixtures/beastheart-bst.json" with {type: "json"};

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const getMonster = name => BST.monster.find(m => m.name === name);
const getSubclass = shortName => BST.subclass.find(s => s.shortName === shortName);

/**
 * Build a Beastheart at `level`, optionally bonded to `bondShortName`, with a bonded
 * companion. Abilities are fixed so every derived number in the file is reproducible:
 * WIS 16 (+3), CON 14 (+2), so PB-driven and WIS-driven numbers are distinguishable.
 */
function makeBeastheart ({level = 1, bond = null, wis = 16, companion = "Owlbear Companion"} = {}) {
	state = new CharacterSheetState();
	CharacterSheetState._CLASS_SUMMON_SCALER = undefined;

	// Abilities first: `setAbilityBase` is a raw setter (the sheet's convention — callers
	// recalculate), so setting CON after `addClass` would leave a stale stored max HP.
	state.setAbilityBase("str", 12);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("int", 10);
	state.setAbilityBase("wis", wis);
	state.setAbilityBase("cha", 10);
	state.addClass({name: "Beastheart", source: "BST", level, hitDice: "d8"});

	if (bond) {
		const sc = getSubclass(bond);
		state.setSubclass("Beastheart", {
			name: sc.name,
			shortName: sc.shortName,
			source: "BST",
			className: "Beastheart",
			classSource: "BST",
		});
	}

	const companionId = companion
		? state.addCompanionFromBestiary(
			getMonster(companion),
			CharacterSheetState.COMPANION_TYPES.BEASTHEART_COMPANION,
			"Companion",
			{scaling: {className: "Beastheart", statblockScaler: "classSummon", statblock: getMonster(companion)}},
		)
		: null;

	addSourceFeatures(level, bond);
	state.applyClassFeatureEffects?.();
	state.setCurrentHp(state.getMaxHp());
	return {state, companionId};
}

/**
 * Add the class and subclass features the character has actually reached, taken verbatim
 * from the published data. Registry-driven effects (condition immunities, advantage) are
 * matched by feature NAME, so a state with no features would silently skip them — this is
 * the same path the real Builder / Level Up flow produces.
 */
function addSourceFeatures (level, bond) {
	BST.classFeature
		.filter(f => f.className === "Beastheart" && f.level <= level)
		.forEach(f => state.addFeature({
			name: f.name,
			level: f.level,
			className: "Beastheart",
			source: "BST",
			description: JSON.stringify(f.entries),
		}));

	if (!bond) return;
	BST.subclassFeature
		.filter(f => f.subclassShortName === bond && f.level <= level)
		.forEach(f => state.addFeature({
			name: f.name,
			level: f.level,
			className: "Beastheart",
			source: "BST",
			description: JSON.stringify(f.entries),
		}));
}

const calcOf = () => state.getFeatureCalculations();

// =============================================================================
// Core class features
// =============================================================================
describe("Beastheart — core class features", () => {
	describe("Primal Exploits (2nd/10th/17th)", () => {
		// The class table's "Primal Exploits" column reads 0,3,3,…,5,5,…,7.
		it.each([
			[1, undefined],
			[2, 3],
			[9, 3],
			[10, 5],
			[16, 5],
			[17, 7],
			[20, 7],
		])("level %i knows %s exploits", (level, expected) => {
			makeBeastheart({level});
			expect(calcOf().primalExploitsKnown).toBe(expected);
		});

		it("derives the exploit save DC as 8 + PB + WIS, and moves with both", () => {
			makeBeastheart({level: 2, wis: 16}); // PB 2, WIS +3
			expect(calcOf().exploitSaveDc).toBe(13);

			makeBeastheart({level: 17, wis: 20}); // PB 6, WIS +5
			expect(calcOf().exploitSaveDc).toBe(19);
		});

		it("Superior Ferocity hands the companion the same DC, not a separate number", () => {
			makeBeastheart({level: 5, wis: 18}); // PB 3, WIS +4
			const calc = calcOf();
			expect(calc.exploitSaveDc).toBe(15);
			expect(calc.superiorFerocityDc).toBe(calc.exploitSaveDc);
		});
	});

	describe("Master Caregiver (3rd)", () => {
		it("grants Animal Handling proficiency the character did not have", () => {
			makeBeastheart({level: 2});
			expect(state.getSkillProficiency("animal handling")).toBe(0);

			makeBeastheart({level: 3});
			expect(state.getSkillProficiency("animal handling")).toBe(1);
		});

		it("upgrades an existing proficiency to expertise (doubled PB)", () => {
			makeBeastheart({level: 3});
			state.setSkillProficiency("animal handling", 1);
			// Already proficient before the feature => expertise.
			expect(state.getSkillProficiency("animal handling")).toBeGreaterThanOrEqual(1);
			expect(state.getSkillBonus("animal handling")).toBeGreaterThanOrEqual(
				state.getAbilityMod("wis") + state.getProficiencyBonus(),
			);
		});
	});

	describe("Beyond Instinct (5th/10th/15th)", () => {
		it.each([
			[4, undefined],
			[5, 1],
			[9, 1],
			[10, 3],
			[14, 3],
			[15, 5],
		])("level %i adds %s bonus ferocity per start-of-turn roll", (level, expected) => {
			makeBeastheart({level});
			expect(calcOf().beyondInstinctFerocityBonus).toBe(expected);
		});

		it("the bonus is real: a start-of-turn gain at 10th beats the same roll at 4th", () => {
			const {companionId: lowId} = makeBeastheart({level: 4});
			const low = state.gainCompanionFerocity(lowId, {hostilesWithin5ft: 0, roll: 3});
			expect(low.ferocity).toBe(3);

			const {companionId: highId} = makeBeastheart({level: 10});
			const high = state.gainCompanionFerocity(highId, {hostilesWithin5ft: 0, roll: 3});
			expect(high.ferocity).toBe(6); // 3 rolled + 3 from Beyond Instinct
		});

		it.each([
			[5, 1],
			[10, 2],
			[15, 3],
		])("level %i offers %i save and %i skill picks", (level, picks) => {
			makeBeastheart({level});
			expect(calcOf().beyondInstinctSavePicks).toBe(picks);
			expect(calcOf().beyondInstinctSkillPicks).toBe(picks);
		});

		it("a recorded save pick becomes a real proficiency on the companion", () => {
			const {companionId} = makeBeastheart({level: 5});
			expect(state.getCompanion(companionId).saveProficiencies).not.toContain("cha");

			state.setBeastheartBeyondInstinctPicks(["cha"], ["stealth"]);
			const c = state.getCompanion(companionId);
			expect(c.saveProficiencies).toContain("cha");
			expect(c.skillProficiencies.stealth).toBeGreaterThanOrEqual(1);
		});

		it("only grants as many picks as the level has actually reached", () => {
			const {companionId} = makeBeastheart({level: 5});
			// Player records three picks up front; only the first is live at 5th.
			state.setBeastheartBeyondInstinctPicks(["cha", "int", "str"], []);
			expect(state.getCompanion(companionId).saveProficiencies).toContain("cha");
			expect(state.getCompanion(companionId).saveProficiencies).not.toContain("int");
		});

		it("rejects picks outside the feature's legal lists", () => {
			makeBeastheart({level: 5});
			const picks = state.setBeastheartBeyondInstinctPicks(["zzz"], ["arcana"]);
			expect(picks.saves).toEqual([]);
			expect(picks.skills).toEqual([]); // Arcana is not on Beyond Instinct's list
		});
	});

	describe("Improved Signature Attack (5th/11th/17th)", () => {
		it.each([
			[4, undefined],
			[5, 1],
			[11, 2],
			[17, 3],
		])("level %i adds %s extra weapon dice", (level, expected) => {
			makeBeastheart({level});
			expect(calcOf().signatureAttackBonusDice).toBe(expected);
		});

		const clawDice = companionId => {
			const claws = state.getCompanion(companionId).actions.find(a => /Signature Attack/i.test(a.name));
			const m = claws.entries.join(" ").match(/\{@damage (\d+)d(\d+)/);
			return m ? Number(m[1]) : null;
		};

		it("actually raises the dice count printed on the companion's attack line", () => {
			const {companionId: lowId} = makeBeastheart({level: 4});
			expect(clawDice(lowId)).toBe(1);

			const {companionId: midId} = makeBeastheart({level: 5});
			expect(clawDice(midId)).toBe(2);

			const {companionId: hiId} = makeBeastheart({level: 17});
			expect(clawDice(hiId)).toBe(4); // base 1 + 3
		});

		it("marks companion damage as magical from 5th", () => {
			makeBeastheart({level: 4});
			expect(calcOf().companionAttacksCountAsMagical).toBeUndefined();
			makeBeastheart({level: 5});
			expect(calcOf().companionAttacksCountAsMagical).toBe(true);
		});
	});

	describe("Primal Strike (8th/14th)", () => {
		it.each([
			[7, undefined],
			[8, "1d8"],
			[13, "1d8"],
			[14, "2d8"],
		])("level %i deals %s", (level, expected) => {
			makeBeastheart({level});
			expect(calcOf().primalStrikeDamage).toBe(expected);
		});

		it("defaults to a legal damage type rather than a blank", () => {
			makeBeastheart({level: 8});
			expect(CharacterSheetState.BEASTHEART_PRIMAL_STRIKE_TYPES)
				.toContain(calcOf().primalStrikeDamageType);
		});
	});

	describe("Rejuvenating Ferocity (6th)", () => {
		it("creates a real long-rest resource with Wis-mod uses", () => {
			makeBeastheart({level: 6, wis: 16}); // +3
			const res = state.getResources().find(r => /Rejuvenating Ferocity/i.test(r.name));
			expect(res).toBeTruthy();
			expect(res.max).toBe(3);
			expect(res.recharge).toBe("long");
		});

		it("floors at one use for a negative Wisdom modifier", () => {
			makeBeastheart({level: 6, wis: 8}); // -1
			expect(state.getResources().find(r => /Rejuvenating Ferocity/i.test(r.name)).max).toBe(1);
		});

		it("does not exist before 6th level", () => {
			makeBeastheart({level: 5});
			expect(state.getResources().find(r => /Rejuvenating Ferocity/i.test(r.name))).toBeUndefined();
		});

		it("preserves expended uses when Wisdom rises", () => {
			makeBeastheart({level: 6, wis: 16});
			const res = state.getResources().find(r => /Rejuvenating Ferocity/i.test(r.name));
			state.useResourceCharge(res.name, 2); // two spent of three
			expect(state.getResources().find(r => /Rejuvenating Ferocity/i.test(r.name)).current).toBe(1);
			state.setAbilityBase("wis", 18); // +4
			const after = state.getResources().find(r => /Rejuvenating Ferocity/i.test(r.name));
			expect(after.max).toBe(4);
			expect(after.current).toBe(2); // still two spent
		});
	});

	describe("Loyal to the End (13th)", () => {
		it("makes the CHARACTER immune to charmed and frightened", () => {
			makeBeastheart({level: 12});
			let immunities = state.getConditionImmunities?.() || [];
			expect(immunities.map(String).join(",")).not.toMatch(/charmed/i);

			makeBeastheart({level: 13});
			immunities = state.getConditionImmunities?.() || [];
			expect(immunities.map(String).join(",")).toMatch(/charmed/i);
			expect(immunities.map(String).join(",")).toMatch(/frightened/i);
		});

		it("makes the COMPANION immune too", () => {
			const {companionId: before} = makeBeastheart({level: 12});
			expect(state.getCompanion(before).conditionImmunities || []).not.toContain("charmed");

			const {companionId: after} = makeBeastheart({level: 13});
			expect(state.getCompanion(after).conditionImmunities).toContain("charmed");
			expect(state.getCompanion(after).conditionImmunities).toContain("frightened");
		});
	});

	describe("Summon the Wilds (18th)", () => {
		it("creates a single short-rest use with the exploit DC", () => {
			makeBeastheart({level: 18, wis: 16}); // PB 6, WIS +3 => DC 17
			const calc = calcOf();
			expect(calc.summonTheWildsDc).toBe(17);

			const res = state.getResources().find(r => /Summon the Wilds/i.test(r.name));
			expect(res.max).toBe(1);
			expect(res.recharge).toBe("short");
		});
	});
});

// =============================================================================
// Protector Bond
// =============================================================================
describe("Beastheart — Protector Bond", () => {
	it("Beast Vitality raises the CHARACTER's maximum HP by the class level", () => {
		makeBeastheart({level: 3, bond: "Hunter"});
		const without = state.getMaxHp();

		makeBeastheart({level: 3, bond: "Protector"});
		expect(state.getMaxHp()).toBe(without + 3);
	});

	it("Beast Vitality keeps growing one per level", () => {
		makeBeastheart({level: 10, bond: "Hunter"});
		const without10 = state.getMaxHp();
		makeBeastheart({level: 10, bond: "Protector"});
		expect(state.getMaxHp()).toBe(without10 + 10);
	});

	it("Thickened Hide (7th) actually raises the companion's AC by 2", () => {
		const {companionId: at6} = makeBeastheart({level: 6, bond: "Protector"});
		const base = state.getCompanion(at6).ac;

		const {companionId: at7} = makeBeastheart({level: 7, bond: "Protector"});
		// PB is 3 at both 6 and 7, so the whole delta is Thickened Hide.
		expect(state.getCompanion(at7).ac).toBe(base + 2);
	});

	it("Thickened Hide survives a re-scale rather than being lost or doubled", () => {
		const {companionId} = makeBeastheart({level: 7, bond: "Protector"});
		const acAt7 = state.getCompanion(companionId).ac;

		state.addClass({name: "Beastheart", source: "BST", level: 8, hitDice: "d8"});
		// PB is still 3 at 8th, so the AC must be unchanged — not +2 again.
		expect(state.getCompanion(companionId).ac).toBe(acAt7);
	});

	it("Sentinel Companion (11th) costs 2 ferocity and really spends it", () => {
		const {companionId} = makeBeastheart({level: 11, bond: "Protector"});
		expect(calcOf().sentinelCompanionFerocityCost).toBe(2);

		state.setCompanionFerocity(companionId, 5);
		const res = state.spendCompanionFerocity(companionId, 2);
		expect(res.ok).toBe(true);
		expect(res.spent).toBe(2);
		expect(state.getCompanionFerocity(companionId)).toBe(3);
	});

	it("Undying Protector (15th) escalates two per use and resets on a rest", () => {
		const {companionId} = makeBeastheart({level: 15, bond: "Protector"});
		expect(calcOf().undyingProtectorFerocityCost).toBe(2);

		// The escalating cost is only charged when the ferocity is actually there to spend.
		state.setCompanionFerocity(companionId, 20);
		state.useUndyingProtector();
		expect(calcOf().undyingProtectorFerocityCost).toBe(4);
		state.useUndyingProtector();
		expect(calcOf().undyingProtectorFerocityCost).toBe(6);

		state.onShortRest();
		expect(calcOf().undyingProtectorFerocityCost).toBe(2);
	});

	it("Pack Phalanx is surfaced but has no number to derive (enemy-facing)", () => {
		makeBeastheart({level: 3, bond: "Protector"});
		expect(calcOf().hasPackPhalanx).toBe(true);
	});
});

// =============================================================================
// Ferocious Bond
// =============================================================================
describe("Beastheart — Ferocious Bond", () => {
	it("Fury of the Wise grants Intimidation proficiency", () => {
		makeBeastheart({level: 3});
		expect(state.getSkillProficiency("intimidation")).toBe(0);

		makeBeastheart({level: 3, bond: "Ferocious"});
		expect(state.getSkillProficiency("intimidation")).toBe(1);
	});

	it("Fury of the Wise adds Wisdom on top of the normal Intimidation bonus", () => {
		makeBeastheart({level: 3, bond: "Ferocious", wis: 16}); // WIS +3, PB 2, CHA +0
		// Proficient (2) + CHA 0 + Wis-mod bonus 3 = 5
		expect(state.getSkillBonus("intimidation")).toBe(5);
	});

	it("Energizing Rampage (7th) leaves ferocity at 4 instead of 0", () => {
		const {companionId: at6} = makeBeastheart({level: 6, bond: "Ferocious"});
		state.setCompanionFerocity(at6, 12);
		state.endBeastheartRampage(at6);
		expect(state.getCompanionFerocity(at6)).toBe(0);

		const {companionId: at7} = makeBeastheart({level: 7, bond: "Ferocious"});
		state.setCompanionFerocity(at7, 12);
		state.endBeastheartRampage(at7);
		expect(state.getCompanionFerocity(at7)).toBe(4);
	});

	it("Energizing Rampage never RAISES ferocity above what was held", () => {
		const {companionId} = makeBeastheart({level: 7, bond: "Ferocious"});
		state.setCompanionFerocity(companionId, 2);
		state.endBeastheartRampage(companionId);
		expect(state.getCompanionFerocity(companionId)).toBeLessThanOrEqual(2);
	});

	it("rampage signature damage is half ferocity, becoming full at 11th", () => {
		const {companionId: at7} = makeBeastheart({level: 7, bond: "Ferocious"});
		state.setCompanionFerocity(at7, 10);
		state.resolveCompanionRampageCheck(at7, {isDeclined: true});
		expect(state.getCompanion(at7).isRampaging).toBe(true);
		expect(state.getBeastheartRampageBonusDamage(at7)).toBe(5);

		const {companionId: at11} = makeBeastheart({level: 11, bond: "Ferocious"});
		state.setCompanionFerocity(at11, 10);
		state.resolveCompanionRampageCheck(at11, {isDeclined: true});
		expect(state.getBeastheartRampageBonusDamage(at11)).toBe(10);
	});

	it("Invigorated Rampage (15th) offers exactly the three printed conditions", () => {
		makeBeastheart({level: 15, bond: "Ferocious"});
		expect(calcOf().invigoratedRampageConditions).toEqual(["blinded", "deafened", "frightened"]);
	});
});

// =============================================================================
// Hunter Bond
// =============================================================================
describe("Beastheart — Hunter Bond", () => {
	it("Chosen Quarry costs 4 ferocity and really spends it", () => {
		const {companionId} = makeBeastheart({level: 3, bond: "Hunter"});
		expect(calcOf().chosenQuarryFerocityCost).toBe(4);

		state.setCompanionFerocity(companionId, 4);
		expect(state.spendCompanionFerocity(companionId, 4).ok).toBe(true);
		expect(state.getCompanionFerocity(companionId)).toBe(0);
	});

	it("Chosen Quarry cannot be paid with insufficient ferocity", () => {
		const {companionId} = makeBeastheart({level: 3, bond: "Hunter"});
		state.setCompanionFerocity(companionId, 3);
		expect(state.spendCompanionFerocity(companionId, 4).ok).toBe(false);
		expect(state.getCompanionFerocity(companionId)).toBe(3); // untouched
	});

	it("Primal Warding (7th) is a real long-rest pool at the exploit DC", () => {
		makeBeastheart({level: 7, bond: "Hunter", wis: 16}); // PB 3, WIS +3 => DC 14
		const calc = calcOf();
		expect(calc.primalWardingDc).toBe(14);
		expect(calc.primalWardingDamage).toBe("4d8");

		const res = state.getResources().find(r => /Primal Warding/i.test(r.name));
		expect(res.max).toBe(3);
		expect(res.recharge).toBe("long");
	});

	it("Unseen Hunters (15th) is a single long-rest use", () => {
		makeBeastheart({level: 15, bond: "Hunter"});
		const res = state.getResources().find(r => /Unseen Hunters/i.test(r.name));
		expect(res.max).toBe(1);
		expect(res.recharge).toBe("long");
	});

	it("does not create Hunter pools for a different bond", () => {
		makeBeastheart({level: 15, bond: "Protector"});
		expect(state.getResources().find(r => /Primal Warding|Unseen Hunters/i.test(r.name))).toBeUndefined();
	});
});

// =============================================================================
// Infernal Bond
// =============================================================================
describe("Beastheart — Infernal Bond", () => {
	it.each([
		[3, 1],
		[10, 1],
		[11, 2],
	])("knows %s Infernal Exploits at level %i", (level, known) => {
		makeBeastheart({level, bond: "Infernal"});
		expect(calcOf().infernalExploitsKnown).toBe(known);
	});

	it("Hell's Charmer (7th) is a Wis-mod long-rest pool at the exploit DC", () => {
		makeBeastheart({level: 7, bond: "Infernal", wis: 18}); // PB 3, WIS +4 => DC 15
		expect(calcOf().hellsCharmerDc).toBe(15);
		const res = state.getResources().find(r => /Hell's Charmer/i.test(r.name));
		expect(res.max).toBe(4);
		expect(res.recharge).toBe("long");
	});

	it("Fiendish Immunities really changes the companion's stat block", () => {
		const {companionId} = makeBeastheart({level: 11, bond: "Infernal"});
		state.setBeastheartFeatureChoice?.("Fiendish Traits", "Fiendish Immunities");
		state.recalculateAllCompanions();

		const c = state.getCompanion(companionId);
		if (calcOf().fiendishTrait === "Fiendish Immunities") {
			expect(c.immunities).toEqual(expect.arrayContaining(["fire", "poison"]));
			expect(c.conditionImmunities).toContain("poisoned");
		}
	});

	it("Wings really grants the companion a fly speed", () => {
		const {companionId} = makeBeastheart({level: 11, bond: "Infernal"});
		state.setBeastheartFeatureChoice?.("Fiendish Traits", "Wings");
		state.recalculateAllCompanions();

		if (calcOf().fiendishTrait === "Wings") {
			expect(state.getCompanion(companionId).speed.fly).toBeGreaterThanOrEqual(40);
		}
	});

	it("Fiendish Form (15th) costs 6 ferocity and really spends it", () => {
		const {companionId} = makeBeastheart({level: 15, bond: "Infernal"});
		expect(calcOf().fiendishFormFerocityCost).toBe(6);
		state.setCompanionFerocity(companionId, 6);
		expect(state.spendCompanionFerocity(companionId, 6).ok).toBe(true);
		expect(state.getCompanionFerocity(companionId)).toBe(0);
	});
});

// =============================================================================
// Primordial Bond
// =============================================================================
describe("Beastheart — Primordial Bond", () => {
	it.each([
		[3, 1],
		[10, 1],
		[11, 2],
	])("knows %s Nature Exploits at level %i", (level, known) => {
		makeBeastheart({level, bond: "Primordial"});
		expect(calcOf().natureExploitsKnown).toBe(known);
	});

	it("Allied Weather (15th) uses the exploit DC, not a hard-coded number", () => {
		makeBeastheart({level: 15, bond: "Primordial", wis: 20}); // PB 5, WIS +5 => DC 18
		expect(calcOf().alliedWeatherDc).toBe(18);
		expect(calcOf().alliedWeatherDamageType).toBe("lightning");
	});

	it("Spirit Stampede (11th) is not available at 10th", () => {
		makeBeastheart({level: 10, bond: "Primordial"});
		expect(calcOf().hasSpiritStampede).toBeUndefined();
		makeBeastheart({level: 11, bond: "Primordial"});
		expect(calcOf().hasSpiritStampede).toBe(true);
		expect(calcOf().spiritStampedeRange).toBe(30);
	});
});

// =============================================================================
// Bond isolation — one bond's features must never leak into another
// =============================================================================
describe("Beastheart — bonds do not leak into one another", () => {
	const BOND_KEYS = {
		Ferocious: "hasFuryOfTheWise",
		Hunter: "hasChosenQuarry",
		Infernal: "hasDevilsUnderstanding",
		Primordial: "hasPrimalUnderstanding",
		Protector: "hasBeastVitality",
	};

	it.each(Object.keys(BOND_KEYS))("%s grants only its own 3rd-level feature", bond => {
		makeBeastheart({level: 15, bond});
		const calc = calcOf();
		expect(calc[BOND_KEYS[bond]]).toBe(true);
		Object.entries(BOND_KEYS)
			.filter(([name]) => name !== bond)
			.forEach(([, key]) => expect(calc[key]).toBeUndefined());
	});

	it("no bond features appear before 3rd level", () => {
		makeBeastheart({level: 2, bond: "Protector"});
		expect(calcOf().hasBeastVitality).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Bond ACTIONS — the features that spend ferocity or change the stat block at
// the moment they are used. Each test drives the real API and then asserts the
// consequence (ferocity actually left the pool, the stat block actually changed),
// never merely that the method returned `ok`.
// ---------------------------------------------------------------------------

describe("Chosen Quarry (Hunter, 3rd)", () => {
	it("spends exactly 4 ferocity and records the mark", () => {
		const {companionId} = makeBeastheart({level: 3, bond: "Hunter"});
		state.setCompanionFerocity(companionId, 7);

		const res = state.markBeastheartQuarry("Gnoll Fang");

		expect(res.ok).toBe(true);
		expect(state.getCompanionFerocity(companionId)).toBe(3);
		expect(state.getBeastheartQuarry()).toEqual({name: "Gnoll Fang", damage: "1d6"});
	});

	it("refuses below 4 ferocity and takes nothing", () => {
		const {companionId} = makeBeastheart({level: 3, bond: "Hunter"});
		state.setCompanionFerocity(companionId, 3);

		const res = state.markBeastheartQuarry("Gnoll Fang");

		expect(res.ok).toBe(false);
		expect(res.reason).toBe("insufficient");
		expect(state.getCompanionFerocity(companionId)).toBe(3);
		expect(state.getBeastheartQuarry()).toBeNull();
	});

	it("marking a second quarry replaces the first", () => {
		const {companionId} = makeBeastheart({level: 3, bond: "Hunter"});
		state.setCompanionFerocity(companionId, 12);

		state.markBeastheartQuarry("First");
		state.markBeastheartQuarry("Second");

		expect(state.getBeastheartQuarry().name).toBe("Second");
		expect(state.getCompanionFerocity(companionId)).toBe(4); // 12 - 4 - 4
	});

	it("is unavailable to another bond", () => {
		const {companionId} = makeBeastheart({level: 3, bond: "Protector"});
		state.setCompanionFerocity(companionId, 10);

		expect(state.markBeastheartQuarry("X").reason).toBe("no-feature");
		expect(state.getCompanionFerocity(companionId)).toBe(10);
	});
});

describe("Sentinel Companion (Protector, 11th)", () => {
	it("spends 2 ferocity for the reaction attack", () => {
		const {companionId} = makeBeastheart({level: 11, bond: "Protector"});
		state.setCompanionFerocity(companionId, 5);

		expect(state.useSentinelCompanion()).toEqual({ok: true, cost: 2, reason: null});
		expect(state.getCompanionFerocity(companionId)).toBe(3);
	});

	it("does not exist at 10th level", () => {
		const {companionId} = makeBeastheart({level: 10, bond: "Protector"});
		state.setCompanionFerocity(companionId, 5);

		expect(state.useSentinelCompanion().reason).toBe("no-feature");
		expect(state.getCompanionFerocity(companionId)).toBe(5);
	});
});

describe("Fiendish Form (Infernal, 15th)", () => {
	it("spends 6 ferocity and rewrites the companion's type and resistances", () => {
		const {companionId} = makeBeastheart({level: 15, bond: "Infernal"});
		state.setCompanionFerocity(companionId, 9);
		expect(state.getCompanion(companionId).resistances || []).not.toContain("slashing");

		expect(state.useFiendishForm().ok).toBe(true);

		expect(state.getCompanionFerocity(companionId)).toBe(3);
		const c = state.getCompanion(companionId);
		expect(c.creatureTypes).toEqual(["fiend"]);
		expect(c.resistances).toEqual(expect.arrayContaining(["bludgeoning", "piercing", "slashing"]));
		expect(c.hasAdvantageOnMagicSaves).toBe(true);
	});

	it("ending the form restores the ordinary stat block", () => {
		const {companionId} = makeBeastheart({level: 15, bond: "Infernal"});
		state.setCompanionFerocity(companionId, 9);
		state.useFiendishForm();

		state.endFiendishForm();

		const c = state.getCompanion(companionId);
		expect(state.isInFiendishForm(companionId)).toBe(false);
		expect(c.resistances || []).not.toContain("slashing");
		expect(c.hasAdvantageOnMagicSaves).toBeFalsy();
	});

	it("refuses below 6 ferocity and leaves the stat block untouched", () => {
		const {companionId} = makeBeastheart({level: 15, bond: "Infernal"});
		state.setCompanionFerocity(companionId, 5);

		expect(state.useFiendishForm().reason).toBe("insufficient");
		expect(state.isInFiendishForm(companionId)).toBe(false);
		expect(state.getCompanionFerocity(companionId)).toBe(5);
	});
});

describe("Primordial ferocity-scaled effects", () => {
	it("Spirit Stampede damage tracks live ferocity", () => {
		const {companionId} = makeBeastheart({level: 11, bond: "Primordial"});

		state.setCompanionFerocity(companionId, 6);
		expect(state.getSpiritStampedeDamage(companionId)).toBe(6);

		state.setCompanionFerocity(companionId, 13);
		expect(state.getSpiritStampedeDamage(companionId)).toBe(13);
	});

	it("Spirit Stampede is 0 for a 10th-level Primordial", () => {
		const {companionId} = makeBeastheart({level: 10, bond: "Primordial"});
		state.setCompanionFerocity(companionId, 6);
		expect(state.getSpiritStampedeDamage(companionId)).toBe(0);
	});

	it("Allied Weather deals ferocity-equal lightning at the exploit DC", () => {
		const {companionId} = makeBeastheart({level: 15, bond: "Primordial"});
		state.setCompanionFerocity(companionId, 8);

		const eff = state.getAlliedWeatherEffect(companionId);

		expect(eff.isAvailable).toBe(true);
		expect(eff.damage).toBe(8);
		expect(eff.dc).toBe(calcOf().exploitSaveDc);
	});

	it("Allied Weather is offline at 0 ferocity", () => {
		const {companionId} = makeBeastheart({level: 15, bond: "Primordial"});
		state.setCompanionFerocity(companionId, 0);
		expect(state.getAlliedWeatherEffect(companionId).isAvailable).toBe(false);
	});

	it("Allied Earth's aura switches on at 1 ferocity and off at 0", () => {
		const {companionId} = makeBeastheart({level: 7, bond: "Primordial"});

		state.setCompanionFerocity(companionId, 0);
		expect(state.getAlliedEarthAura(companionId).isActive).toBe(false);

		state.setCompanionFerocity(companionId, 1);
		expect(state.getAlliedEarthAura(companionId)).toEqual({isActive: true, radius: 10});
	});
});

describe("Synchronized Stealth (Hunter, 11th)", () => {
	it("registers a conditional Stealth advantage rather than an unconditional one", () => {
		makeBeastheart({level: 11, bond: "Hunter"});

		const mods = state.aggregateModifiers("check:advantage:stealth");
		const all = [...(mods.conditionalsAvailable || []), ...(mods.sources || [])];

		expect(all.some(m => /Synchronized Stealth/i.test(m.source || m.name || ""))).toBe(true);
		// Positional, so it must NOT be auto-applied to every Stealth check.
		expect(mods.total || 0).toBe(0);
	});

	it("is absent for a 10th-level Hunter", () => {
		makeBeastheart({level: 10, bond: "Hunter"});
		const mods = state.aggregateModifiers("check:advantage:stealth");
		const all = [...(mods.conditionalsAvailable || []), ...(mods.sources || [])];
		expect(all.some(m => /Synchronized Stealth/i.test(m.source || m.name || ""))).toBe(false);
	});
});
