/**
 * Regression tests for active-state id uniqueness.
 *
 * Active-state ids were `${key}_${Date.now()}`, which collides whenever two
 * states are created inside the same millisecond — trivially reachable in the
 * app (a single feature applying several conditions) and in tests. Any consumer
 * that keys per-state data by id then silently merges the colliding states, so
 * one state inherits the other's effects and its own are lost.
 *
 * That is exactly what happened when `getActiveStateEffects` began keying a
 * `Map` by `state.id`: two custom states added back to back resolved to the
 * same effect list.
 */

import "./setup.js";

let CharacterSheetState;
let charState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

beforeEach(() => {
	charState = new CharacterSheetState();
});

/** Pin `Date.now()` so every state below is created in the "same millisecond". */
function _freezeNow () {
	const real = Date.now;
	const frozen = real.call(Date);
	Date.now = () => frozen;
	return () => { Date.now = real; };
}

describe("active-state id uniqueness", () => {
	test("states added in the same millisecond get distinct ids", () => {
		const restore = _freezeNow();
		try {
			charState.addActiveState("custom", {name: "A"});
			charState.addActiveState("custom", {name: "B"});
			charState.addActiveState("custom", {name: "C"});
		} finally {
			restore();
		}

		const ids = charState._data.activeStates.map(it => it.id);
		expect(ids).toHaveLength(3);
		expect(new Set(ids).size).toBe(3);
	});

	test("each state keeps its OWN effects when ids would have collided", () => {
		const restore = _freezeNow();
		try {
			charState.addActiveState("custom", {
				name: "Hex",
				customEffects: [{type: "extraDamage", dice: "1d6", damageType: "necrotic"}],
			});
			charState.addActiveState("custom", {
				name: "Flame Tongue",
				customEffects: [{type: "extraDamage", dice: "2d6", damageType: "fire"}],
			});
		} finally {
			restore();
		}

		const extra = charState.getExtraDamageFromStates();
		expect(extra).toHaveLength(2);
		expect(extra.some(d => d.dice === "1d6" && d.damageType === "necrotic")).toBe(true);
		expect(extra.some(d => d.dice === "2d6" && d.damageType === "fire")).toBe(true);
	});

	test("opposing advantage/disadvantage from two same-millisecond states still cancel", () => {
		const restore = _freezeNow();
		try {
			charState.addActiveState("custom", {
				name: "Blessed",
				customEffects: [{type: "advantage", target: "save", ability: "dex"}],
			});
			charState.addActiveState("custom", {
				name: "Hindered",
				customEffects: [{type: "disadvantage", target: "save", ability: "dex"}],
			});
		} finally {
			restore();
		}

		const state = charState.getSaveAdvantageState("dex");
		expect(state.advantage).toBe(false);
		expect(state.disadvantage).toBe(false);
	});

	test("condition-derived states also get unique ids", () => {
		const restore = _freezeNow();
		try {
			charState.addCondition("poisoned", "Spider Bite");
			charState.addCondition("frightened", "Dragon Fear");
		} finally {
			restore();
		}

		const ids = charState._data.activeStates.map(it => it.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
