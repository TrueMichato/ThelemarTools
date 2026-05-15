/**
 * Regression test for the "HP = 0 after building character" bug.
 *
 * Builder._finishCharacter() must:
 *   1. Recalculate HP and sync current to max (so freshly built chars are at full HP)
 *   2. Save the character
 *   3. Update tab visibility
 *   4. Render the character so the HP card actually shows the new value
 *      (without this step the HP `<input>` keeps its hardcoded `value="0"`)
 *   5. Switch to the Overview tab
 *
 * The bug was that step 4 was missing — state was correct, UI showed 0.
 */

import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;

function makeBuilder ({quickBuildTargetLevel = 1} = {}) {
	const builder = Object.create(CharacterSheetBuilder.prototype);

	const calls = [];
	const trackedFn = (name, impl) => jest.fn(function (...args) {
		calls.push(name);
		return impl ? impl.apply(this, args) : undefined;
	});

	const state = {
		hp: {current: 0, max: 0},
	};
	state.recalculateHp = trackedFn("recalculateHp", function ({syncCurrent} = {}) {
		state.hp.max = 12;
		if (syncCurrent) state.hp.current = state.hp.max;
	});

	const page = {
		saveCharacter: trackedFn("saveCharacter", async () => {}),
		_updateTabVisibility: trackedFn("_updateTabVisibility"),
		renderCharacter: trackedFn("renderCharacter"),
		switchToTab: trackedFn("switchToTab"),
		_quickBuild: null,
	};

	builder._state = state;
	builder._page = page;
	builder._quickBuildTargetLevel = quickBuildTargetLevel;
	builder._selectedClass = null;
	builder._selectedSubclass = null;
	builder._divineSoulAffinity = null;

	return {builder, state, page, calls};
}

describe("CharacterSheetBuilder._finishCharacter — HP refresh contract", () => {
	test("syncs current HP to recalculated max", async () => {
		const {builder, state} = makeBuilder();

		await builder._finishCharacter();

		expect(state.hp.max).toBe(12);
		expect(state.hp.current).toBe(12);
		expect(state.hp.current).not.toBe(0);
	});

	test("calls renderCharacter exactly once after saveCharacter", async () => {
		const {builder, page} = makeBuilder();

		await builder._finishCharacter();

		// The bug was a missing renderCharacter() call — lock it in.
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);

		const saveOrder = page.saveCharacter.mock.invocationCallOrder[0];
		const renderOrder = page.renderCharacter.mock.invocationCallOrder[0];
		expect(renderOrder).toBeGreaterThan(saveOrder);
	});

	test("invokes finish steps in the correct order", async () => {
		const {builder, calls} = makeBuilder();

		await builder._finishCharacter();

		// recalc → save → updateTabs → render → switchToTab
		const idx = name => calls.indexOf(name);
		expect(idx("recalculateHp")).toBeGreaterThanOrEqual(0);
		expect(idx("saveCharacter")).toBeGreaterThan(idx("recalculateHp"));
		expect(idx("_updateTabVisibility")).toBeGreaterThan(idx("saveCharacter"));
		expect(idx("renderCharacter")).toBeGreaterThan(idx("_updateTabVisibility"));
		expect(idx("switchToTab")).toBeGreaterThan(idx("renderCharacter"));
	});

	test("renders before Quick Build hand-off too", async () => {
		const {builder, page} = makeBuilder({quickBuildTargetLevel: 5});
		// Even with a Quick Build target level, _selectedClass is null here so
		// the hand-off branch is skipped and we go down the plain-finish path.
		// The render must happen regardless of which branch we take.

		await builder._finishCharacter();

		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
	});
});
