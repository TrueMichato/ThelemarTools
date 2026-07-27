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
	const LANCE = {name: "Lance", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Topple|XPHB"]};
	const TRIDENT = {name: "Trident", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Topple|XPHB"]};
	const DAGGER = {name: "Dagger", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "simple", mastery: ["Nick|XPHB"]};
	const RAPIER = {name: "Rapier", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Vex|XPHB"]};

	// Realistic `_isWeaponProficient` mirroring the state checker (category + named
	// tokens) so the proficiency filter is actually exercised in tests.
	function makeIsWeaponProficient (weaponProfs) {
		return (weapon) => {
			if (weapon.weaponCategory === "simple" && weaponProfs.includes("simple")) return true;
			if (weapon.weaponCategory === "martial" && weaponProfs.includes("martial")) return true;
			return weaponProfs.some(p => String(p).toLowerCase() === String(weapon.name || "").toLowerCase());
		};
	}

	function makeQuickBuild ({
		currentMasteries = [],
		weaponProfs = ["simple", "martial"],
		classes = [{name: "Fighter", source: "XPHB"}],
		items = [LONGSWORD, SHORTSWORD],
		withProficiencyChecker = true,
	} = {}) {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._state = {
			getWeaponMasteries: () => currentMasteries,
			getWeaponProficiencies: () => [...weaponProfs],
			getClasses: () => classes,
		};
		if (withProficiencyChecker) qb._state._isWeaponProficient = makeIsWeaponProficient(weaponProfs);
		qb._page = {getItems: () => items};
		qb._selections = {weaponMasteries: null};
		return qb;
	}

	function masteryInfoFor (overrides = {}) {
		return {
			className: "Fighter",
			classData: null,
			currentMasteries: [],
			existingCount: 0,
			targetTotal: 3,
			newSlots: 3,
			...overrides,
		};
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

/**
 * Bug A (Round 44) — the Weapon Mastery pool must be limited to weapons the
 * character is PROFICIENT with (2024 rules). Previously every base weapon with a
 * `mastery` property was offered, so e.g. a Rogue could pick Lance/Trident.
 */
describe("QuickBuild Weapon Mastery picker — proficiency filter (Bug A)", () => {
	beforeEach(() => {
		globalThis.JqueryUtil = {doToast: jest.fn()};
	});

	const LONGSWORD = {name: "Longsword", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Sap|XPHB"]};
	const SHORTSWORD = {name: "Shortsword", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Vex|XPHB"]};
	const LANCE = {name: "Lance", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Topple|XPHB"]};
	const TRIDENT = {name: "Trident", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Topple|XPHB"]};
	const DAGGER = {name: "Dagger", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "simple", mastery: ["Nick|XPHB"]};
	const RAPIER = {name: "Rapier", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Vex|XPHB"]};

	function makeIsWeaponProficient (weaponProfs) {
		return (weapon) => {
			if (weapon.weaponCategory === "simple" && weaponProfs.includes("simple")) return true;
			if (weapon.weaponCategory === "martial" && weaponProfs.includes("martial")) return true;
			return weaponProfs.some(p => String(p).toLowerCase() === String(weapon.name || "").toLowerCase());
		};
	}

	function makeQuickBuild ({
		currentMasteries = [],
		weaponProfs = ["simple", "martial"],
		classes = [{name: "Fighter", source: "XPHB"}],
		items = [LONGSWORD, SHORTSWORD],
		withProficiencyChecker = true,
	} = {}) {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._state = {
			getWeaponMasteries: () => currentMasteries,
			getWeaponProficiencies: () => [...weaponProfs],
			getClasses: () => classes,
		};
		if (withProficiencyChecker) qb._state._isWeaponProficient = makeIsWeaponProficient(weaponProfs);
		qb._page = {getItems: () => items};
		qb._selections = {weaponMasteries: null};
		return qb;
	}

	function masteryInfoFor (overrides = {}) {
		return {
			className: "Fighter",
			classData: null,
			currentMasteries: [],
			existingCount: 0,
			targetTotal: 3,
			newSlots: 3,
			...overrides,
		};
	}

	function render (qb, masteryInfo) {
		const content = e_({outer: "<div></div>"});
		qb._renderWeaponMasteryStep(content, masteryInfo);
		return content._html;
	}

	it("a Rogue is NOT offered Lance/Trident (non-proficient martial), but sees simple + named-proficient weapons", () => {
		const qb = makeQuickBuild({
			weaponProfs: ["simple", "Rapier"], // simple + the specific martial the Rogue is proficient with
			classes: [{name: "Rogue", source: "XPHB"}],
			items: [DAGGER, LANCE, TRIDENT, RAPIER],
		});
		const html = render(qb, masteryInfoFor({className: "Rogue"}));

		expect(html).toContain("Dagger"); // simple -> proficient
		expect(html).toContain("Rapier"); // named proficiency
		expect(html).not.toContain("Lance"); // martial, not proficient
		expect(html).not.toContain("Trident"); // martial, not proficient
	});

	it("a Fighter (simple + martial) still sees martial weapons", () => {
		const qb = makeQuickBuild({
			weaponProfs: ["simple", "martial"],
			classes: [{name: "Fighter", source: "XPHB"}],
			items: [DAGGER, LANCE, LONGSWORD],
		});
		const html = render(qb, masteryInfoFor({className: "Fighter"}));

		expect(html).toContain("Lance");
		expect(html).toContain("Longsword");
		expect(html).toContain("Dagger");
	});

	// Approved refinement — 2014 named martial proficiencies are stored as
	// `{@item longsword|phb|...}` tokens that the exact-match state checker under-includes.
	// The union against `getWeaponProficiencies()` must resolve them locally so a weapon the
	// character genuinely IS proficient with stays in the pool, while Lance/Trident (no
	// "martial" and no Lance/Trident named prof) remain excluded.
	it("resolves a {@item}-wrapped named martial proficiency via the union (state checker misses the tag)", () => {
		const weaponProfs = ["simple", "{@item longsword|phb|longswords}"];
		const qb = makeQuickBuild({
			weaponProfs,
			classes: [{name: "Rogue", source: "PHB"}],
			items: [DAGGER, LONGSWORD, LANCE, TRIDENT],
		});
		// Sanity: the exact-match state checker alone does NOT recognise the tagged token.
		expect(qb._state._isWeaponProficient(LONGSWORD)).toBe(false);

		const html = render(qb, masteryInfoFor({className: "Rogue"}));

		expect(html).toContain("Dagger"); // simple
		expect(html).toContain("Longsword"); // named prof via {@item} token union
		expect(html).not.toContain("Lance"); // martial, not proficient
		expect(html).not.toContain("Trident"); // martial, not proficient
	});

	// Progressive-state case (1): existing class already applied to state.
	it("case 1 — existing Fighter: martial weapons visible from state proficiencies", () => {
		const qb = makeQuickBuild({
			weaponProfs: ["simple", "martial"],
			classes: [{name: "Fighter", source: "XPHB"}],
			items: [LANCE],
		});
		expect(render(qb, masteryInfoFor({className: "Fighter"}))).toContain("Lance");
	});

	// Progressive-state case (2): Builder->QuickBuild — starting profs already on state.
	it("case 2 — Builder->QuickBuild Fighter: martial visible (starting profs already applied)", () => {
		const qb = makeQuickBuild({
			weaponProfs: ["simple", "martial"],
			classes: [{name: "Fighter", source: "XPHB"}], // builder added the class + profs
			items: [LANCE],
		});
		expect(render(qb, masteryInfoFor({className: "Fighter"}))).toContain("Lance");
	});

	// Progressive-state case (3): pending multiclass — class NOT yet on state; its
	// weapon proficiencies must be derived from the multiclassing table.
	it("case 3 — pending multiclass into Fighter: martial visible via pending tokens (state has only simple)", () => {
		const classData = {
			name: "Fighter",
			source: "XPHB",
			multiclassing: {proficienciesGained: {weapons: ["simple", "martial"]}},
		};
		const qb = makeQuickBuild({
			weaponProfs: ["simple"], // state only has the OTHER class's profs (e.g. a Wizard)
			classes: [{name: "Wizard", source: "XPHB"}], // Fighter not added yet
			items: [DAGGER, LANCE],
		});
		const html = render(qb, masteryInfoFor({className: "Fighter", classData}));

		expect(html).toContain("Dagger"); // simple (state)
		expect(html).toContain("Lance"); // martial via pending multiclass tokens
	});

	it("case 3 negative control — pending multiclass with no multiclass weapon grants hides martial", () => {
		const classData = {name: "Fighter", source: "XPHB"}; // no multiclassing block
		const qb = makeQuickBuild({
			weaponProfs: ["simple"],
			classes: [{name: "Wizard", source: "XPHB"}],
			items: [DAGGER, LANCE],
		});
		const html = render(qb, masteryInfoFor({className: "Fighter", classData}));

		expect(html).toContain("Dagger");
		expect(html).not.toContain("Lance");
	});

	it("_getPendingWeaponProfTokens returns [] for an already-applied class and the multiclass weapons for a pending leg", () => {
		const classData = {name: "Fighter", source: "XPHB", multiclassing: {proficienciesGained: {weapons: ["simple", "martial"]}}};

		const applied = makeQuickBuild({classes: [{name: "Fighter", source: "XPHB"}]});
		expect(applied._getPendingWeaponProfTokens(masteryInfoFor({className: "Fighter", classData}))).toEqual([]);

		const pending = makeQuickBuild({classes: [{name: "Wizard", source: "XPHB"}]});
		expect(pending._getPendingWeaponProfTokens(masteryInfoFor({className: "Fighter", classData}))).toEqual(["simple", "martial"]);
	});

	it("_matchesWeaponProfTokens handles category, plain-name and {@item}-wrapped tokens", () => {
		const qb = makeQuickBuild();
		expect(qb._matchesWeaponProfTokens(LANCE, ["martial"])).toBe(true);
		expect(qb._matchesWeaponProfTokens(LANCE, ["simple"])).toBe(false);
		expect(qb._matchesWeaponProfTokens(RAPIER, ["Rapier"])).toBe(true);
		expect(qb._matchesWeaponProfTokens(RAPIER, ["{@item rapier|phb|rapiers}"])).toBe(true);
		expect(qb._matchesWeaponProfTokens(RAPIER, [])).toBe(false);
	});

	it("prunes a pre-seeded mastery for a now-non-proficient weapon, keeping proficient seeds", () => {
		const qb = makeQuickBuild({
			currentMasteries: ["Dagger|XPHB", "Lance|XPHB"], // Lance is martial, not proficient
			weaponProfs: ["simple"],
			classes: [{name: "Rogue", source: "XPHB"}],
			items: [DAGGER, LANCE],
		});
		render(qb, masteryInfoFor({className: "Rogue", currentMasteries: ["Dagger|XPHB", "Lance|XPHB"], existingCount: 2}));

		expect(qb._selections.weaponMasteries).toContain("Dagger|XPHB");
		expect(qb._selections.weaponMasteries).not.toContain("Lance|XPHB");
	});

	it("backward compat — a state without _isWeaponProficient leaves the pool unfiltered (no throw)", () => {
		const qb = makeQuickBuild({
			withProficiencyChecker: false,
			classes: [{name: "Rogue", source: "XPHB"}],
			items: [DAGGER, LANCE, TRIDENT],
		});
		const html = render(qb, masteryInfoFor({className: "Rogue"}));

		expect(html).toContain("Dagger");
		expect(html).toContain("Lance"); // unfiltered fallback
		expect(html).toContain("Trident");
	});
});
