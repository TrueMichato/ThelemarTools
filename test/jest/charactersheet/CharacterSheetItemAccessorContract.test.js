import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";

/**
 * A family of accessors resolves its row with `find(i => i.id === itemId)`. Passing the *item*
 * instead of its id matches nothing and returns an empty result with no error, which is
 * indistinguishable from "this character has no such item".
 *
 * That silent empty has caused three separate false findings across two sessions -- in each case
 * a probe returned nothing, and nothing was read as evidence about the code rather than about the
 * probe. The guard makes the mis-call audible in the run that causes it.
 *
 * These tests pin the guard *and* its limits: it must stay warn-only, so a mis-call still degrades
 * exactly as it did before rather than throwing mid-render.
 */

const CharacterSheetState = globalThis.CharacterSheetState;

const WEAPON = {
	id: "w1",
	name: "Probe Blade",
	type: "weapon",
	weapon: true,
	dmg1: "1d8",
	dmgType: "S",
};

const makeState = () => {
	const state = new CharacterSheetState();
	state.loadFromJson({
		name: "Probe",
		classes: [{name: "Fighter", source: "PHB", level: 5}],
		abilities: {str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10},
		hp: {max: 44, current: 44},
		inventory: [{id: WEAPON.id, quantity: 1, equipped: true, item: {...WEAPON}}],
	});
	return state;
};

describe("An item accessor called with the item instead of its id says so", () => {
	let warn;

	beforeEach(() => {
		CharacterSheetState._warnedItemIdMisuse?.clear();
		warn = jest.spyOn(globalThis.console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
		CharacterSheetState._warnedItemIdMisuse?.clear();
	});

	it("names the method and the correction when handed an item", () => {
		const state = makeState();
		state.getEffectiveItemBonuses({...WEAPON});

		expect(warn).toHaveBeenCalledTimes(1);
		const msg = String(warn.mock.calls[0][0]);
		expect(msg).toContain("getEffectiveItemBonuses");
		expect(msg).toContain("getEffectiveItemBonuses(item.id)");
	});

	it("guards the second, independent lookup site too", () => {
		const state = makeState();
		state.getItemRaw({...WEAPON});

		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][0])).toContain("getItemRaw");
	});

	/**
	 * Anti-vacuity. Without this, "a correct call does not warn" would also pass if the accessor
	 * had stopped working entirely -- the silent-empty failure the guard exists to catch, wearing
	 * the guard's own clothes.
	 */
	it("stays silent on a correct call, which really does return the item", () => {
		const state = makeState();
		const bonuses = state.getEffectiveItemBonuses(WEAPON.id);
		const raw = state.getItemRaw(WEAPON.id);

		expect(raw).not.toBeNull();
		expect(raw.name).toBe("Probe Blade");
		expect(bonuses).toBeTruthy();
		expect(warn).not.toHaveBeenCalled();
	});

	it("warns once per method, not once per call", () => {
		const state = makeState();
		state.getEffectiveItemBonuses({...WEAPON});
		state.getEffectiveItemBonuses({...WEAPON});
		state.getEffectiveItemBonuses({...WEAPON});

		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("degrades exactly as before rather than throwing", () => {
		const state = makeState();

		expect(() => state.getEffectiveItemBonuses({...WEAPON})).not.toThrow();
		expect(() => state.getItemRaw({...WEAPON})).not.toThrow();
		expect(state.getEffectiveItemBonuses({...WEAPON})).toEqual({});
		expect(state.getItemRaw({...WEAPON})).toBeNull();
	});

	/**
	 * `getEffectiveWeaponDamage` is a THIRD lookup site, not a consumer of the other two. It runs
	 * its own `find` and returns `null` before it ever reaches `getEffectiveItemBonuses`, so it
	 * does not inherit that guard by delegation -- measured silent before this was added.
	 *
	 * It is also the accessor whose mis-call is cited as one of the three false findings that
	 * motivated the guard, and the one the NPC-export corpus walk reads for every weapon.
	 */
	it("guards the third lookup site, which delegates too late to inherit the others", () => {
		const state = makeState();
		state.getEffectiveWeaponDamage({...WEAPON});

		expect(warn).toHaveBeenCalledTimes(1);
		const msg = String(warn.mock.calls[0][0]);
		expect(msg).toContain("getEffectiveWeaponDamage");
		expect(msg).toContain("getEffectiveWeaponDamage(item.id)");
	});

	it("stays silent on a correct weapon-damage call, which really does return a die", () => {
		const state = makeState();
		const dmg = state.getEffectiveWeaponDamage(WEAPON.id);

		expect(dmg).not.toBeNull();
		expect(dmg.dice).toBe("1d8");
		expect(warn).not.toHaveBeenCalled();
	});

	it("does not warn for a plain missing id, which is a legitimate question", () => {
		const state = makeState();

		expect(state.getItemRaw("no-such-item")).toBeNull();
		expect(state.getEffectiveItemBonuses("no-such-item")).toEqual({});
		expect(warn).not.toHaveBeenCalled();
	});
});
