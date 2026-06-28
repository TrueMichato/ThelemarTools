/**
 * S1 #4 — Combat Traditions management filter UI model.
 *
 * The traditions picker previously offered ALL 18 traditions with no grouping,
 * no locking of subclass-granted traditions, and no filtering. These tests pin
 * the pure grouping model (`buildTraditionSelectionModel`) and the combat-module
 * resolver (`_getTraditionSelectionModel`) that feeds it, including the
 * Arcane-Archer restricted choice pool (BZ/RE/UW/UH) and locked fixed grants.
 *
 * The underlying selection stays a FLAT code-string array throughout.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

let CharacterSheetState;
let CharacterSheetCombat;
let ClassUtils;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	await import("../../../js/charactersheet/charactersheet-combat.js");
	CharacterSheetCombat = globalThis.CharacterSheetCombat;
	ClassUtils = globalThis.CharacterSheetClassUtils;
});

function groupCodes (model, key) {
	return (model.groups.find(g => g.key === key)?.traditions || []).map(t => t.code).sort();
}

describe("S1 #4 buildTraditionSelectionModel (pure)", () => {
	it("restricts the choosable pool to availableCodes and keeps selection flat", () => {
		const model = ClassUtils.buildTraditionSelectionModel(["BZ"], {availableCodes: ["BZ", "RE", "UW", "UH"]});
		expect(Array.isArray(model.selected)).toBe(true);
		expect(model.selected).toEqual(["BZ"]);
		expect(groupCodes(model, "available")).toEqual(["BZ", "RE", "UH", "UW"]);
		// No granted group when there are no fixed grants.
		expect(model.groups.find(g => g.key === "granted")).toBeUndefined();
	});

	it("locks granted traditions and force-selects them", () => {
		const model = ClassUtils.buildTraditionSelectionModel([], {grantedCodes: ["SK"], availableCodes: ["SK", "MS", "BZ"]});
		expect(model.selected).toContain("SK");
		expect(groupCodes(model, "granted")).toEqual(["SK"]);
		const granted = model.groups.find(g => g.key === "granted").traditions[0];
		expect(granted.locked).toBe(true);
		// Granted code is removed from the choosable "available" group (no dup).
		expect(groupCodes(model, "available")).toEqual(["BZ", "MS"]);
	});

	it("surfaces an out-of-pool selected code in the 'other' group (never dropped)", () => {
		const model = ClassUtils.buildTraditionSelectionModel(["AM"], {availableCodes: ["BZ", "RE"]});
		expect(groupCodes(model, "other")).toEqual(["AM"]);
		expect(model.selected).toContain("AM");
	});

	it("falls back to all traditions when availableCodes is empty", () => {
		const model = ClassUtils.buildTraditionSelectionModel([], {});
		expect(model.choosableCodes.length).toBe(ClassUtils.getAllTraditions().length);
	});
});

describe("S1 #4 _getTraditionSelectionModel (combat module)", () => {
	function makeCombat (state) {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {
			getOptionalFeatures: () => [],
			getClassFeatures: () => [],
			getClasses: () => [{
				name: "Fighter",
				source: "TGTT",
				optionalfeatureProgression: [{name: "Combat Methods", featureType: ["CTM:1", "CTM:2"], progression: {"1": 1}}],
			}],
		};
		return combat;
	}

	it("restricts an Arcane Archer to the BZ/RE/UW/UH choice pool", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 9, subclass: {name: "Arcane Archer", shortName: "Arcane Archer", source: "TGTT"}});
		const combat = makeCombat(state);
		const model = combat._getTraditionSelectionModel(["BZ", "RE"]);
		expect(model.choosableCodes.sort()).toEqual(["BZ", "RE", "UH", "UW"]);
	});

	it("resolves the pool even when cls.subclass is stale null (via embedded features)", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "TGTT", level: 9});
		// Stale: subclass null but embedded subclass feature present.
		state._data.features.push({
			name: "Arcane Archer",
			isSubclassFeature: true,
			className: "Fighter",
			classSource: "TGTT",
			subclassName: "Arcane Archer",
			subclassShortName: "Arcane Archer",
			subclassSource: "TGTT",
			level: 3,
		});
		const combat = makeCombat(state);
		const model = combat._getTraditionSelectionModel([]);
		expect(model.choosableCodes.sort()).toEqual(["BZ", "RE", "UH", "UW"]);
	});
});
