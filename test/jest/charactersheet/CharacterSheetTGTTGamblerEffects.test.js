/**
 * Effect-level coverage for the TGTT Gambler (Rogue subclass).
 *
 * Deliberately complements `CharacterSheetTGTTGambler.test.js`, which asserts
 * that the Gambler's accessors EXIST and return plausible shapes. This file
 * asserts that each feature actually DOES something to the sheet:
 *
 *  - Gambler's Tools  -> weapons injected AND equipped (so they reach Attacks),
 *                        plus the coin ricochet rider surfaced structurally.
 *  - Gambler's Spellcasting -> the exact published slot table drives
 *                        `calculateSpellSlots`, the breakdown card reports a
 *                        rolled formula (not a fake CHA DC), and the cantrip
 *                        picks are actually queued for the player.
 *  - Extra Luck / Master of Fortune -> real, spendable, long-rest resources
 *                        AND real post-roll d20 interventions.
 *  - Versatile Gambler -> both dice upgrades.
 *
 * The published Gambler Spell Slots table (TravelersGuidetoThelemar.json,
 * `subclassTableGroups[1].rowsSpellProgression`) intentionally deviates from
 * generic third-caster math at levels 10-12 (4/2 rather than 4/3), which is why
 * it is asserted row by row here.
 */

import "./setup.js";

let CharacterSheetState;
let state;

/** The authoritative L1-20 slot rows from the homebrew, as [L1, L2, L3, L4]. */
const PUBLISHED_SLOTS = [
	[0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 0], [3, 0, 0, 0], [3, 0, 0, 0],
	[3, 0, 0, 0], [4, 2, 0, 0], [4, 2, 0, 0], [4, 2, 0, 0], [4, 2, 0, 0],
	[4, 2, 0, 0], [4, 2, 0, 0], [4, 3, 2, 0], [4, 3, 2, 0], [4, 3, 2, 0],
	[4, 3, 3, 0], [4, 3, 3, 0], [4, 3, 3, 0], [4, 3, 3, 1], [4, 3, 3, 1],
];

const SUBCLASS_TABLE_GROUPS = [
	{
		colLabels: ["Cantrips Known"],
		rows: [[0], [0], [3], [3], [3], [3], [3], [3], [3], [4], [4], [4], [4], [4], [4], [4], [4], [4], [4], [4]],
	},
	{
		title: "Spell Slots per Spell Level",
		colLabels: ["1st", "2nd", "3rd", "4th"],
		rowsSpellProgression: PUBLISHED_SLOTS.map(r => [...r]),
	},
];

/**
 * `calculateSpellSlots()` writes into state rather than returning; read the
 * resulting `{level: {current, max}}` map back as a plain `{level: max}`.
 * @param {*} st
 * @returns {Record<number, number>}
 */
const slotCounts = (st) => {
	const out = {};
	const slots = st.getSpellSlots() || {};
	for (let lvl = 1; lvl <= 9; lvl++) out[lvl] = slots[lvl]?.max || 0;
	return out;
};

const CANTRIP_PROGRESSION = [0, 0, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

/**
 * Build a Gambler at `level` with a realistically-persisted subclass (the shape
 * Builder / Level-Up / Quick Build actually write), then add the subclass
 * features that are live at that level.
 * @param {number} level
 * @param {object} [opts]
 * @returns {void}
 */
const buildGambler = (level, opts = {}) => {
	state.addClass({
		name: "Rogue",
		source: "TGTT",
		level,
		subclass: {
			name: "Gambler",
			shortName: "Gambler",
			source: "TGTT",
			casterProgression: "1/3",
			spellcastingAbility: "str",
			additionalSpells: [{expanded: {3: [{all: "level=0|class=Warlock"}, {all: "level=1|class=Warlock"}]}}],
			...(opts.omitTables ? {} : {subclassTableGroups: SUBCLASS_TABLE_GROUPS}),
			...(opts.omitCantripProgression ? {} : {cantripProgression: CANTRIP_PROGRESSION}),
		},
	});

	const feature = (name, lvl, description) => state.addFeature({
		name,
		source: "TGTT",
		featureType: "Subclass",
		className: "Rogue",
		subclassShortName: "Gambler",
		level: lvl,
		description,
	});

	if (level >= 3) {
		feature("Gambler's Tools", 3, "You gain proficiency with card sets and dice sets.");
		feature("Gambler's Folly", 3, "Every time you cast a spell using a spell slot, roll a gambling dice.");
		feature("Gambler's Spellcasting", 3, "You learn cantrips from the warlock spell list.");
	}
	if (level >= 9) feature("Extra Luck", 9, "As a bonus action, you can grant yourself advantage on an attack roll, ability check, or saving throw.");
	if (level >= 13) feature("Versatile Gambler", 13, "You prepare 3d6 spells and your Gambling Modifier becomes 2d4.");
	if (level >= 17) feature("Master of Fortune", 17, "You may treat a natural 1 as a natural 20.");

	state.applyClassFeatureEffects();
};

beforeEach(() => {
	state = new CharacterSheetState();
});

// =========================================================================
// L3 - GAMBLER'S TOOLS
// =========================================================================
describe("Gambler's Tools (L3)", () => {
	it("injects all three implements EQUIPPED so they reach the Attacks panel", () => {
		buildGambler(3);
		const gamblerItems = state.getItems().filter(i => i._isGamblerWeapon);
		expect(gamblerItems).toHaveLength(3);
		// The Attacks panel only auto-generates rows for `weapon && equipped` items;
		// an unequipped implement is invisible to the whole combat surface.
		for (const item of gamblerItems) {
			expect(item.weapon).toBe(true);
			expect(item.equipped).toBe(true);
		}
		const names = gamblerItems.map(i => i.name).sort();
		expect(names.some(n => /coins/i.test(n))).toBe(true);
		expect(names.some(n => /dice/i.test(n))).toBe(true);
		expect(names.some(n => /cards/i.test(n))).toBe(true);
	});

	it("surfaces the coin ricochet as a structured attack rider (not just item prose)", () => {
		buildGambler(3);
		const coins = state.getItems().find(i => i._isGamblerWeapon && /coins/i.test(i.name));
		expect(coins).toBeTruthy();

		const riders = state.getAttackRiderNotes({id: `auto_${coins.id}`, name: coins.name, sourceItem: coins});
		const ricochet = riders.find(r => r.id === "gamblerCoinRicochet");
		expect(ricochet).toBeTruthy();
		expect(ricochet.label).toMatch(/half cover/i);
		expect(ricochet.description).toMatch(/no cover/i);
	});

	it("does not attach the ricochet rider to the dice or cards", () => {
		buildGambler(3);
		for (const item of state.getItems().filter(i => i._isGamblerWeapon && !/coins/i.test(i.name))) {
			const riders = state.getAttackRiderNotes({id: `auto_${item.id}`, name: item.name, sourceItem: item});
			expect(riders.some(r => r.id === "gamblerCoinRicochet")).toBe(false);
		}
	});

	it("returns no riders for spell attacks or plain weapons", () => {
		buildGambler(3);
		expect(state.getAttackRiderNotes({isSpell: true, name: "Eldritch Blast"})).toEqual([]);
		expect(state.getAttackRiderNotes({name: "Dagger", sourceItem: {name: "Dagger", id: "x"}})).toEqual([]);
	});

	it("honours structured `attackRiders` declared on any item (generic path)", () => {
		buildGambler(3);
		const riders = state.getAttackRiderNotes({
			name: "Homebrew Blade",
			sourceItem: {
				id: "hb1",
				name: "Homebrew Blade",
				attackRiders: [{label: "Ignores resistance", description: "This blade ignores slashing resistance."}],
			},
		});
		expect(riders).toHaveLength(1);
		expect(riders[0].label).toBe("Ignores resistance");
		expect(riders[0].icon).toBeTruthy();
	});
});

// =========================================================================
// L3 - GAMBLER'S SPELLCASTING (slots)
// =========================================================================
describe("Gambler's Spellcasting - spell slots (L3+)", () => {
	it("matches the published subclass slot table at every level 1-20", () => {
		for (let level = 1; level <= 20; level++) {
			state = new CharacterSheetState();
			buildGambler(Math.max(1, level));
			state.calculateSpellSlots();
			const slots = slotCounts(state);
			const expected = PUBLISHED_SLOTS[level - 1];
			for (let sl = 1; sl <= 4; sl++) {
				expect([level, sl, slots[sl] || 0]).toEqual([level, sl, expected[sl - 1]]);
			}
			// Nothing above 4th ever.
			for (let sl = 5; sl <= 9; sl++) expect(slots[sl] || 0).toBe(0);
		}
	});

	it("deviates from generic third-caster math at L10-12 (4/2, not 4/3)", () => {
		for (const level of [10, 11, 12]) {
			state = new CharacterSheetState();
			buildGambler(level);
			state.calculateSpellSlots();
			const slots = slotCounts(state);
			expect([level, slots[1], slots[2]]).toEqual([level, 4, 2]);
		}
	});

	it("falls back to the built-in table for saves that never persisted subclassTableGroups", () => {
		buildGambler(11, {omitTables: true});
		state.calculateSpellSlots();
		const slots = slotCounts(state);
		expect([slots[1], slots[2]]).toEqual([4, 2]);
	});

	it("keeps `calculations.gamblerSpellSlots` in agreement with the real slot grid", () => {
		for (const level of [3, 5, 7, 10, 12, 13, 16, 19, 20]) {
			state = new CharacterSheetState();
			buildGambler(level);
			state.calculateSpellSlots();
			const slots = slotCounts(state);
			const calc = state.getFeatureCalculations().gamblerSpellSlots;
			expect([level, calc.level1, calc.level2, calc.level3, calc.level4])
				.toEqual([level, slots[1], slots[2], slots[3], slots[4]]);
		}
	});

	it("does not disturb a subclass with no declared slot table (Eldritch Knight)", () => {
		state.addClass({
			name: "Fighter",
			source: "PHB",
			level: 11,
			casterProgression: "1/3",
			spellcastingAbility: "int",
			subclass: {name: "Eldritch Knight", shortName: "EK", source: "PHB", casterProgression: "1/3"},
		});
		state.calculateSpellSlots();
		const slots = slotCounts(state);
		// Generic third-caster math at L11 is 4/3, NOT the Gambler's 4/2.
		expect([slots[1], slots[2]]).toEqual([4, 3]);
	});
});

// =========================================================================
// L3 - GAMBLER'S SPELLCASTING (rolled DC / attack, cantrip prompting)
// =========================================================================
describe("Gambler's Spellcasting - rolled mechanic + cantrip picks", () => {
	it("reports a rolled formula on the breakdown card instead of a fake ability DC", () => {
		buildGambler(5);
		const card = state.getSpellcastingClassBreakdown().find(c => c.subclassName === "Gambler");
		expect(card).toBeTruthy();
		expect(card.mechanic).toBe("rolled");
		// The homebrew is explicit: the Gambler has NO spellcasting ability.
		expect(card.ability).toBeNull();
		expect(card.saveDc).toBeNull();
		expect(card.attackBonus).toBeNull();
		expect(card.abilityLabel).toBe("Rolled");
		expect(card.modifierDice).toBe("1d6");
		expect(card.saveDcFormula).toBe(`8 + ${state.getProficiencyBonus()} + 1d6`);
		expect(card.attackBonusFormula).toBe(`${state.getProficiencyBonus()} + 1d6`);
	});

	it("upgrades the card's Gambling Modifier dice at L13 (Versatile Gambler)", () => {
		buildGambler(13);
		const card = state.getSpellcastingClassBreakdown().find(c => c.subclassName === "Gambler");
		expect(card.modifierDice).toBe("2d4");
		expect(card.saveDcFormula).toBe(`8 + ${state.getProficiencyBonus()} + 2d4`);
	});

	it("queues 3 warlock cantrip picks at L3 so every build flow prompts for them", () => {
		buildGambler(3);
		const pending = state.getPendingSpellChoices().filter(c => c.level === 0);
		expect(pending).toHaveLength(3);
		for (const choice of pending) {
			expect(choice.filter).toBe("level=0|class=Warlock");
			// "Cantrips Known" is the attribution that counts toward the card's chip.
			expect(choice.featureName).toBe("Cantrips Known");
			expect(choice.sourceClass).toBe("Gambler");
		}
	});

	it("queues a 4th cantrip pick at L10 and no more", () => {
		buildGambler(10);
		expect(state.getPendingSpellChoices().filter(c => c.level === 0)).toHaveLength(4);
	});

	it("stops offering picks the player has already filled, and never re-offers them", () => {
		buildGambler(3);
		const pending = state.getPendingSpellChoices().filter(c => c.level === 0);
		state.fulfillSpellChoice(pending[0].id, {name: "Eldritch Blast", source: "PHB", level: 0, school: "V"});

		const after = state.getPendingSpellChoices().filter(c => c.level === 0);
		expect(after).toHaveLength(2);

		// Idempotent across repeated reads (the ensure-pass runs on every read).
		expect(state.getPendingSpellChoices().filter(c => c.level === 0)).toHaveLength(2);
	});

	it("offers nothing before L3 and nothing when the cantrip table was never persisted", () => {
		buildGambler(2);
		expect(state.getPendingSpellChoices().filter(c => c.level === 0)).toHaveLength(0);

		state = new CharacterSheetState();
		buildGambler(5, {omitCantripProgression: true});
		expect(state.getPendingSpellChoices().filter(c => c.level === 0)).toHaveLength(0);
	});

	it("resolves the spell list from the subclass's own expansion filters (generic)", () => {
		const gambler = {
			name: "Gambler",
			shortName: "Gambler",
			source: "TGTT",
			additionalSpells: [{expanded: {3: [{all: "level=0|class=Warlock"}, {all: "level=1|class=Warlock"}]}}],
		};
		expect(CharacterSheetState.getSubclassSpellListClass(gambler, {name: "Rogue"})).toBe("Warlock");

		// Explicit override wins.
		expect(CharacterSheetState.getSubclassSpellListClass(
			{spellcastingSpellList: "Wizard"}, {name: "Fighter"},
		)).toBe("Wizard");

		// No hints at all -> the parent class.
		expect(CharacterSheetState.getSubclassSpellListClass({}, {name: "Fighter"})).toBe("Fighter");
	});

	it("leaves full casters alone (their class declares its own cantrip table)", () => {
		state.addClass({
			name: "Wizard",
			source: "PHB",
			level: 5,
			casterProgression: "full",
			spellcastingAbility: "int",
			cantripProgression: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
			subclass: {
				name: "School of Evocation",
				shortName: "Evocation",
				source: "PHB",
				cantripProgression: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
			},
		});
		expect(state.getSubclassCantripChoiceSlots()).toHaveLength(0);
	});
});

// =========================================================================
// L9 / L17 - RESOURCES
// =========================================================================
describe("Extra Luck + Master of Fortune resources", () => {
	const findRes = (name) => state.getResources().find(r => r.name === name);

	it("does not create either pool before the granting level", () => {
		buildGambler(3);
		expect(findRes("Extra Luck")).toBeUndefined();
		expect(findRes("Master of Fortune")).toBeUndefined();
	});

	it("creates Extra Luck at L9 sized to proficiency bonus, recharging on a long rest", () => {
		buildGambler(9);
		const res = findRes("Extra Luck");
		expect(res).toBeTruthy();
		expect(res.max).toBe(state.getProficiencyBonus());
		expect(res.current).toBe(res.max);
		expect(res.recharge).toBe("long");
		expect(findRes("Master of Fortune")).toBeUndefined();
	});

	it("scales Extra Luck with proficiency bonus at L13", () => {
		buildGambler(13);
		expect(findRes("Extra Luck").max).toBe(state.getProficiencyBonus());
		expect(findRes("Extra Luck").max).toBe(5);
	});

	it("creates Master of Fortune at L17 alongside Extra Luck", () => {
		buildGambler(17);
		expect(findRes("Extra Luck").max).toBe(6);
		expect(findRes("Master of Fortune").max).toBe(6);
	});

	it("spends and restores both pools on a long rest", () => {
		buildGambler(17);
		expect(state.useExtraLuck()).toBeTruthy();
		expect(state.useMasterOfFortune()).toBeTruthy();
		expect(findRes("Extra Luck").current).toBe(5);
		expect(findRes("Master of Fortune").current).toBe(5);

		state.resetGamblerDailyResources();
		expect(findRes("Extra Luck").current).toBe(6);
		expect(findRes("Master of Fortune").current).toBe(6);
	});

	it("refuses to spend an exhausted pool", () => {
		buildGambler(9);
		const max = state.getProficiencyBonus();
		for (let i = 0; i < max; i++) expect(state.useExtraLuck()).toBeTruthy();
		expect(state.getExtraLuckUses().remaining).toBe(0);
		expect(state.useExtraLuck()).toBeFalsy();
		expect(findRes("Extra Luck").current).toBe(0);
	});

	it("preserves expended uses when proficiency bonus raises the maximum", () => {
		buildGambler(9);
		state.useExtraLuck();
		expect(state.getExtraLuckUses().remaining).toBe(3);

		state.getClasses()[0].level = 13;
		// Re-read forces the ensure-pass to rescale.
		expect(findRes("Extra Luck").max).toBe(5);
		expect(findRes("Extra Luck").current).toBe(4);
	});

	it("round-trips both pools through save/load", () => {
		buildGambler(17);
		state.useExtraLuck();
		state.useMasterOfFortune();
		state.useMasterOfFortune();

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getExtraLuckUses().remaining).toBe(5);
		expect(restored.getMasterOfFortuneUses().remaining).toBe(4);
		expect(restored.getResources().find(r => r.name === "Extra Luck").current).toBe(5);
	});
});

// =========================================================================
// GENERIC POST-ROLL D20 INTERVENTION API
// =========================================================================
describe("d20 fortune interventions (generic API)", () => {
	it("offers nothing to a Gambler below L9", () => {
		buildGambler(5);
		expect(state.getD20InterventionOffers({naturalRoll: 1, effectiveRoll: 1, rollType: "attack"})).toEqual([]);
	});

	it("offers Extra Luck on a low die at L9, but not on a high one", () => {
		buildGambler(9);
		const low = state.getD20InterventionOffers({naturalRoll: 4, effectiveRoll: 4, rollType: "check"});
		expect(low.map(o => o.id)).toContain("gamblerExtraLuck");
		expect(low[0].kind).toBe("advantage");
		expect(low[0].remaining).toBe(4);

		const high = state.getD20InterventionOffers({naturalRoll: 17, effectiveRoll: 17, rollType: "check"});
		expect(high).toEqual([]);
	});

	it("does not offer advantage on a roll that already has advantage", () => {
		buildGambler(9);
		expect(state.getD20InterventionOffers({naturalRoll: 3, effectiveRoll: 3, isAdvantage: true, rollType: "attack"})).toEqual([]);
	});

	it("offers BOTH interventions on a natural 1 at L17", () => {
		buildGambler(17);
		const offers = state.getD20InterventionOffers({naturalRoll: 1, effectiveRoll: 1, rollType: "save"});
		expect(offers.map(o => o.id).sort()).toEqual(["gamblerExtraLuck", "gamblerMasterOfFortune"]);
		expect(offers.find(o => o.id === "gamblerMasterOfFortune").kind).toBe("natOneToTwenty");
	});

	it("offers nothing on a natural 20", () => {
		buildGambler(17);
		expect(state.getD20InterventionOffers({naturalRoll: 20, effectiveRoll: 20, rollType: "attack"})).toEqual([]);
	});

	it("stops offering once the backing pool is exhausted", () => {
		buildGambler(17);
		for (let i = 0; i < 6; i++) state.useMasterOfFortune();
		const offers = state.getD20InterventionOffers({naturalRoll: 1, effectiveRoll: 1, rollType: "attack"});
		expect(offers.map(o => o.id)).toEqual(["gamblerExtraLuck"]);
	});

	it("applies Master of Fortune by turning the natural 1 into a natural 20", () => {
		buildGambler(17);
		const before = state.getMasterOfFortuneUses().remaining;
		const res = state.applyD20Intervention("gamblerMasterOfFortune", {naturalRoll: 1, effectiveRoll: 1});
		expect(res.applied).toBe(true);
		expect(res.effectiveRoll).toBe(20);
		expect(state.getMasterOfFortuneUses().remaining).toBe(before - 1);
		// The homebrew requires a Gambling Table roll on each use.
		expect(res.tableRoll).toBeTruthy();
	});

	it("applies Extra Luck by rolling a second die and keeping the higher", () => {
		buildGambler(9);
		const before = state.getExtraLuckUses().remaining;
		const res = state.applyD20Intervention("gamblerExtraLuck", {naturalRoll: 4, effectiveRoll: 4});
		expect(res.applied).toBe(true);
		expect(res.secondDie).toBeGreaterThanOrEqual(1);
		expect(res.secondDie).toBeLessThanOrEqual(20);
		expect(res.effectiveRoll).toBe(Math.max(4, res.secondDie));
		expect(state.getExtraLuckUses().remaining).toBe(before - 1);
		expect(res.tableRoll).toBeTruthy();
	});

	it("refuses to apply an intervention with no uses left", () => {
		buildGambler(9);
		for (let i = 0; i < 4; i++) state.useExtraLuck();
		const res = state.applyD20Intervention("gamblerExtraLuck", {naturalRoll: 2, effectiveRoll: 2});
		expect(res.applied).toBe(false);
	});

	it("rejects an unknown intervention id rather than silently succeeding", () => {
		buildGambler(17);
		expect(state.applyD20Intervention("noSuchThing", {naturalRoll: 1, effectiveRoll: 1}).applied).toBe(false);
	});
});

// =========================================================================
// L17 - MASTER OF FORTUNE: ROLL TWICE AND CHOOSE
// =========================================================================
describe("Master of Fortune - double Gambling Table roll", () => {
	it("produces a second roll and flags that a choice is owed at L17", () => {
		buildGambler(17);
		const result = state.rollGamblingTable();
		expect(result.secondRoll).toBeGreaterThanOrEqual(1);
		expect(result.needsChoice).toBe(true);
		expect(result.chosenRoll).toBe(result.roll);
	});

	it("does NOT roll twice below L17", () => {
		buildGambler(13);
		const result = state.rollGamblingTable();
		expect(result.secondRoll == null || result.needsChoice === false).toBe(true);
	});

	it("records the player's choice and clears the pending flag", () => {
		buildGambler(17);
		const rolled = state.rollGamblingTable();
		const chosen = state.chooseGamblingTableResult(2);
		expect(chosen.roll).toBe(rolled.secondRoll);
		expect(state.getGamblerLastTableRoll().chosenRoll).toBe(rolled.secondRoll);
		expect(state.getGamblerLastTableRoll().needsChoice).toBe(false);
	});

	it("persists the recorded choice through save/load", () => {
		buildGambler(17);
		state.rollGamblingTable();
		const chosen = state.chooseGamblingTableResult(2);

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getGamblerLastTableRoll().chosenRoll).toBe(chosen.roll);
		expect(restored.getGamblerLastTableRoll().needsChoice).toBe(false);
	});
});

// =========================================================================
// L13 - VERSATILE GAMBLER
// =========================================================================
describe("Versatile Gambler (L13)", () => {
	it("upgrades both the prepared dice and the Gambling Modifier dice", () => {
		buildGambler(12);
		let calcs = state.getFeatureCalculations();
		expect(calcs.gamblerSpellsPreparedDice).toBe("2d4");
		expect(calcs.gamblerModifierDice).toBe("1d6");

		state = new CharacterSheetState();
		buildGambler(13);
		calcs = state.getFeatureCalculations();
		expect(calcs.gamblerSpellsPreparedDice).toBe("3d6");
		expect(calcs.gamblerModifierDice).toBe("2d4");
		expect(calcs.gamblerSpellDcFormula).toBe(`8 + ${state.getProficiencyBonus()} + 2d4`);
		expect(calcs.gamblerSpellAttackFormula).toBe(`${state.getProficiencyBonus()} + 2d4`);
	});

	it("keeps the rolled prepared count inside the upgraded dice range", () => {
		buildGambler(13);
		for (let i = 0; i < 40; i++) {
			const rolled = state.rollGamblerPreparedSpells();
			const count = typeof rolled === "number" ? rolled : rolled?.total;
			expect(count).toBeGreaterThanOrEqual(3);
			expect(count).toBeLessThanOrEqual(18);
		}
	});
});
