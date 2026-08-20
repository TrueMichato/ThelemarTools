import "./setup.js";
import {jest} from "@jest/globals";
import {readFileSync} from "fs";
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

/**
 * The guard above was attached by hand, one call site at a time, and so covered 6 of the 94
 * `itemId`-taking accessors. The other 88 resolved their row with their own inline
 * `find(i => i.id === itemId)` and stayed silent -- including three that had already eaten a
 * false finding.
 *
 * Routing every lookup through `_findInventoryRow` makes the guard structural rather than
 * remembered: an accessor cannot resolve a row without passing it. These tests pin that
 * property, so the next accessor someone adds inherits the guard instead of re-opening the hole.
 */
describe("The misuse guard is structural, not attached by hand", () => {
	let warn;

	const SOURCE = readFileSync(new URL("../../../js/charactersheet/charactersheet-state.js", import.meta.url), "utf8");

	/** Accessors that resolve a row through the shared helper, read off the source itself so the
	 * list cannot drift as accessors are added or removed. */
	const routed = () => Object.getOwnPropertyNames(CharacterSheetState.prototype)
		.filter(n => !n.startsWith("_") && n !== "constructor")
		.filter(n => {
			const fn = Object.getOwnPropertyDescriptor(CharacterSheetState.prototype, n)?.value;
			return typeof fn === "function" && fn.toString().includes("_findInventoryRow(itemId)");
		});

	beforeEach(() => {
		CharacterSheetState._warnedItemIdMisuse?.clear();
		warn = jest.spyOn(globalThis.console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
		CharacterSheetState._warnedItemIdMisuse?.clear();
	});

	it("covers a broad family of accessors, not a handful", () => {
		// A bound derived from the file rather than written down, so it cannot record the day it
		// was authored. If someone re-inlines the lookups this drops and the test says so.
		expect(routed().length).toBeGreaterThan(20);
	});

	it("names the accessor the caller actually called, never the one it delegates to", () => {
		const mislabelled = [];
		for (const name of routed()) {
			CharacterSheetState._warnedItemIdMisuse?.clear();
			warn.mockClear();
			const state = makeState();
			try {
				state[name]({...WEAPON});
			} catch (ignored) {
				// Mutators may fail on a bogus row; the guard fires at the lookup, before that.
			}
			const msg = warn.mock.calls.map(c => String(c[0])).find(m => m.includes("expects an item id"));
			if (msg && !msg.includes(`${name}()`)) mislabelled.push(`${name} -> ${msg.slice(18, 60)}`);
		}
		expect(mislabelled).toEqual([]);
	});

	it("makes accessors audible that were silent before it existed", () => {
		// Each of these resolved its own row inline and said nothing when handed an item.
		for (const name of ["getMaterialRole", "getItemUpgrades", "getSocketedGemstones", "getItemActivation", "getItem", "getItemMaterialNotes"]) {
			CharacterSheetState._warnedItemIdMisuse?.clear();
			warn.mockClear();
			makeState()[name]({...WEAPON});

			const msg = warn.mock.calls.map(c => String(c[0])).find(m => m.includes("expects an item id"));
			expect(`${name}: ${msg ? "warned" : "SILENT"}`).toBe(`${name}: warned`);
			expect(msg).toContain(`${name}(item.id)`);
		}
	});

	it("leaves no inventory id lookup inlined for the guard to miss", () => {
		// Matches any lambda name: the first mechanical sweep keyed on `i =>` and missed a site
		// that used `it =>`, which this leg is what caught.
		const lines = SOURCE.split("\n");
		const helperAt = lines.findIndex(l => l.includes("_findInventoryRow (itemId) {"));
		const inlined = lines
			.map((line, i) => [i + 1, line])
			// The helper's own lookup is the one that is supposed to exist.
			.filter(([n]) => helperAt < 0 || n <= helperAt || n > helperAt + 4)
			.filter(([, line]) => /_data\.inventory[^;]*\.find\(\s*\w+\s*=>\s*\w+\.id === itemId\s*\)/.test(line));

		expect(inlined.map(([n, l]) => `${n}: ${l.trim()}`)).toEqual([]);
	});
});

/**
 * The hint half of the message (`Did you mean f(item.id)?`) is conditional on the argument
 * carrying an `.id`, and an inventory *row*'s nested `.item` does not always. A detector -- or a
 * test -- keyed on the hint therefore reads "silent" for a call that warned perfectly well.
 *
 * So pin the invariant half separately: the warning fires on the *shape* of the argument, and
 * only the correction is conditional on being able to offer one.
 */
describe("The warning fires on the argument shape, not on the hint being available", () => {
	let warn;

	beforeEach(() => {
		CharacterSheetState._warnedItemIdMisuse?.clear();
		warn = jest.spyOn(globalThis.console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
		CharacterSheetState._warnedItemIdMisuse?.clear();
	});

	it("still warns for an object with no `id` to suggest", () => {
		makeState().getEffectiveItemBonuses({name: "Nameless", type: "weapon"});

		const msg = String(warn.mock.calls[0]?.[0] || "");
		expect(msg).toContain("getEffectiveItemBonuses() expects an item id");
		// No `.id`, so there is nothing to correct to -- and that absence must not be mistaken
		// for silence by anything reading this channel.
		expect(msg).not.toContain("Did you mean");
	});

	it("offers the correction when there is one, which is the only difference", () => {
		makeState().getEffectiveItemBonuses({...WEAPON});

		const msg = String(warn.mock.calls[0]?.[0] || "");
		expect(msg).toContain("getEffectiveItemBonuses() expects an item id");
		expect(msg).toContain("Did you mean `getEffectiveItemBonuses(item.id)`?");
	});
});
