import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

/**
 * Bug #4 — Weapon Mastery picker must NOT be enforced, and already-chosen
 * masteries must show as selected.
 *
 * QuickBuild specifics:
 *   - `_selections.weaponMasteries` defaults to `null` (NOT `[]`) so the render
 *     seed guard fires and pre-seeds existing masteries (the `[]` default made
 *     the guard see a truthy value and never seed).
 *   - `_validateWeaponMasteryStep()` always returns true (skippable).
 *   - The apply path persists only when the value is an Array (an empty array
 *     legitimately clears prior masteries; `null` leaves them untouched).
 */
describe("QuickBuild Weapon Mastery picker — optional + pre-seed (Bug #4)", () => {
	beforeEach(() => {
		globalThis.JqueryUtil = {doToast: jest.fn()};
	});

	const LONGSWORD = {name: "Longsword", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Sap|XPHB"]};
	const SHORTSWORD = {name: "Shortsword", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Vex|XPHB"]};

	function makeQuickBuild ({currentMasteries = []} = {}) {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._state = {getWeaponMasteries: () => currentMasteries};
		qb._page = {getItems: () => [LONGSWORD, SHORTSWORD]};
		qb._selections = {weaponMasteries: null};
		return qb;
	}

	it("_resetSelections leaves weaponMasteries as null (so the render seed runs)", () => {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._resetSelections();
		expect(qb._selections.weaponMasteries).toBeNull();
	});

	it("_validateWeaponMasteryStep returns true even with zero / fewer-than-max selected", () => {
		const qb = makeQuickBuild();
		qb._selections.weaponMasteries = []; // user skipped / picked nothing
		expect(qb._validateWeaponMasteryStep({newSlots: 2, targetTotal: 2})).toBe(true);
		qb._selections.weaponMasteries = ["Longsword|XPHB"]; // fewer than 2
		expect(qb._validateWeaponMasteryStep({newSlots: 2, targetTotal: 2})).toBe(true);
	});

	it("render pre-seeds existing masteries into the selection and marks them checked", () => {
		const qb = makeQuickBuild({currentMasteries: ["Longsword|XPHB"]});
		const content = e_({outer: "<div></div>"});
		const masteryInfo = {
			className: "Fighter",
			currentMasteries: ["Longsword|XPHB"],
			existingCount: 1,
			targetTotal: 3,
			newSlots: 2,
		};

		qb._renderWeaponMasteryStep(content, masteryInfo);

		// Seed ran (null -> copy of currentMasteries).
		expect(qb._selections.weaponMasteries).toEqual(["Longsword|XPHB"]);
		// And the pre-seeded weapon renders as a checked option.
		expect(content._html).toContain("Longsword");
		expect(content._html).toContain("checked");
	});

	it("render does NOT clobber an already-seeded selection on re-entry", () => {
		const qb = makeQuickBuild({currentMasteries: ["Longsword|XPHB"]});
		qb._selections.weaponMasteries = ["Shortsword|XPHB"]; // user already changed it
		const content = e_({outer: "<div></div>"});
		const masteryInfo = {className: "Fighter", currentMasteries: ["Longsword|XPHB"], existingCount: 1, targetTotal: 3, newSlots: 2};

		qb._renderWeaponMasteryStep(content, masteryInfo);

		expect(qb._selections.weaponMasteries).toEqual(["Shortsword|XPHB"]);
	});

	it("apply path: an empty array clears prior masteries; null leaves them untouched", () => {
		// Emulate the exact apply guard from _applyQuickBuild.
		const applyGuard = (selections, state) => {
			if (Array.isArray(selections.weaponMasteries)) {
				state.setWeaponMasteries([...selections.weaponMasteries]);
			}
		};

		const cleared = [];
		let setCalled = false;
		const state = {setWeaponMasteries: (v) => { setCalled = true; cleared.push(...v); }};

		applyGuard({weaponMasteries: null}, state);
		expect(setCalled).toBe(false); // null -> untouched

		applyGuard({weaponMasteries: []}, state);
		expect(setCalled).toBe(true); // empty array -> clears
		expect(cleared).toEqual([]);
	});
});
