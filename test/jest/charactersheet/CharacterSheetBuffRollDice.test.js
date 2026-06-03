/**
 * Buff dice bonuses (rollBonus / rollPenalty) must be surfaced for d20 rolls
 * so the roll handlers can roll the die and fold it into the total.
 *
 * Regression: Gift of Alacrity tracked a {@dice 1d8} initiative bonus as a
 * buff, but no roll handler consumed the dice — every buff die (Bless 1d4,
 * Guidance 1d4, Resistance 1d4, Gift of Alacrity 1d8) was cosmetic-only.
 *
 * These tests cover the generic state surface:
 *   - getRollBonusDiceFromStates(rollType) returns the applicable dice with
 *     correct sign and hierarchical target matching.
 *   - getInitiativeBreakdown() exposes diceBonuses without altering the
 *     canonical / effective numbers.
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

/** Push a minimal active buff state carrying the given effects. */
const addBuff = (st, name, effects) => {
	st._data.activeStates.push({
		id: `buff-${name.toLowerCase().replace(/\s+/g, "-")}`,
		name,
		active: true,
		customEffects: effects,
	});
};

describe("CharacterSheetState.getRollBonusDiceFromStates", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	test("returns no dice when no buffs are active", () => {
		expect(state.getRollBonusDiceFromStates("initiative")).toEqual([]);
	});

	test("surfaces Gift of Alacrity's 1d8 on initiative", () => {
		addBuff(state, "Gift of Alacrity", [{type: "rollBonus", dice: "1d8", target: "initiative"}]);
		const dice = state.getRollBonusDiceFromStates("initiative");
		expect(dice).toHaveLength(1);
		expect(dice[0]).toMatchObject({dice: "1d8", sign: 1, source: "Gift of Alacrity"});
	});

	test("does not apply an initiative buff to attacks or saves", () => {
		addBuff(state, "Gift of Alacrity", [{type: "rollBonus", dice: "1d8", target: "initiative"}]);
		expect(state.getRollBonusDiceFromStates("attack:melee:str")).toEqual([]);
		expect(state.getRollBonusDiceFromStates("save:dex")).toEqual([]);
		expect(state.getRollBonusDiceFromStates("check:str")).toEqual([]);
	});

	test("generic 'attack' target matches any specific attack roll", () => {
		addBuff(state, "Bless", [{type: "rollBonus", dice: "1d4", target: "attack"}]);
		expect(state.getRollBonusDiceFromStates("attack:melee:str")).toHaveLength(1);
		expect(state.getRollBonusDiceFromStates("attack:ranged:dex")).toHaveLength(1);
	});

	test("generic 'save' target matches any saving throw", () => {
		addBuff(state, "Bless", [{type: "rollBonus", dice: "1d4", target: "save"}]);
		expect(state.getRollBonusDiceFromStates("save:wis")).toHaveLength(1);
		expect(state.getRollBonusDiceFromStates("save:con")).toHaveLength(1);
	});

	test("generic 'check' target matches any ability check", () => {
		addBuff(state, "Guidance", [{type: "rollBonus", dice: "1d4", target: "check"}]);
		expect(state.getRollBonusDiceFromStates("check:int")).toHaveLength(1);
		expect(state.getRollBonusDiceFromStates("check:str")).toHaveLength(1);
	});

	test("rollPenalty yields a negative sign", () => {
		addBuff(state, "Bane", [{type: "rollPenalty", dice: "1d4", target: "save"}]);
		const dice = state.getRollBonusDiceFromStates("save:dex");
		expect(dice).toHaveLength(1);
		expect(dice[0]).toMatchObject({dice: "1d4", sign: -1, source: "Bane"});
	});

	test("aggregates multiple applicable buffs", () => {
		addBuff(state, "Bless", [{type: "rollBonus", dice: "1d4", target: "attack"}]);
		addBuff(state, "Heroism", [{type: "rollBonus", dice: "1d6", target: "attack"}]);
		const dice = state.getRollBonusDiceFromStates("attack:melee:str");
		expect(dice.map(d => d.dice).sort()).toEqual(["1d4", "1d6"]);
	});

	test("ignores inactive buffs", () => {
		state._data.activeStates.push({
			id: "buff-off",
			name: "Gift of Alacrity",
			active: false,
			customEffects: [{type: "rollBonus", dice: "1d8", target: "initiative"}],
		});
		expect(state.getRollBonusDiceFromStates("initiative")).toEqual([]);
	});

	test("ignores numeric bonus effects (only dice effects surface here)", () => {
		addBuff(state, "Some Aura", [{type: "bonus", target: "attack", value: 2}]);
		expect(state.getRollBonusDiceFromStates("attack:melee:str")).toEqual([]);
	});

	test("returns empty for a falsy roll type", () => {
		addBuff(state, "Bless", [{type: "rollBonus", dice: "1d4", target: "attack"}]);
		expect(state.getRollBonusDiceFromStates("")).toEqual([]);
	});
});

describe("CharacterSheetState.getInitiativeBreakdown — diceBonuses", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
	});

	test("exposes an empty diceBonuses array by default", () => {
		const bd = state.getInitiativeBreakdown();
		expect(Array.isArray(bd.diceBonuses)).toBe(true);
		expect(bd.diceBonuses).toHaveLength(0);
	});

	test("surfaces Gift of Alacrity without changing canonical/effective totals", () => {
		const before = state.getInitiativeBreakdown();
		addBuff(state, "Gift of Alacrity", [{type: "rollBonus", dice: "1d8", target: "initiative"}]);
		const after = state.getInitiativeBreakdown();

		expect(after.total).toBe(before.total);
		expect(after.canonical).toBe(before.canonical);
		expect(after.diceBonuses).toEqual([{dice: "1d8", sign: 1, source: "Gift of Alacrity"}]);
	});
});
