import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;

/**
 * Bug A (Round 44) — the Builder's Weapon Mastery picker
 * (`_renderWeaponMasterySelection`) must be limited to weapons the character is
 * PROFICIENT with (2024 rules). Previously every base weapon with a `mastery`
 * property was offered, so a freshly-built L1 Rogue could pick Lance/Trident.
 *
 * Ordering note: the picker renders in `_renderClassPreview` DURING class
 * selection, BEFORE `_applyClassFeatures` puts the starting weapon
 * proficiencies on `_state`. So the filter derives the class's proficiency
 * tokens locally from `cls.startingProficiencies.weapons` (unioned with any
 * state proficiencies + the canonical `_isWeaponProficient` checker) without
 * mutating state.
 */
describe("Builder Weapon Mastery picker — proficiency filter (Bug A)", () => {
	beforeEach(() => {
		globalThis.JqueryUtil = {doToast: jest.fn()};
	});

	const LONGSWORD = {name: "Longsword", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Sap|XPHB"]};
	const LANCE = {name: "Lance", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Topple|XPHB"]};
	const TRIDENT = {name: "Trident", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Topple|XPHB"]};
	const DAGGER = {name: "Dagger", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "simple", mastery: ["Nick|XPHB"]};
	const SHORTBOW = {name: "Shortbow", source: "XPHB", _isBaseItem: true, type: "R", weaponCategory: "simple", mastery: ["Vex|XPHB"]};
	const RAPIER = {name: "Rapier", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Vex|XPHB"]};

	// Realistic `_isWeaponProficient` mirroring the state checker (category + named
	// tokens) so the proficiency filter is actually exercised.
	function makeIsWeaponProficient (weaponProfs) {
		return (weapon) => {
			if (weapon.weaponCategory === "simple" && weaponProfs.includes("simple")) return true;
			if (weapon.weaponCategory === "martial" && weaponProfs.includes("martial")) return true;
			return weaponProfs.some(p => String(p).toLowerCase() === String(weapon.name || "").toLowerCase());
		};
	}

	function makeBuilder ({
		stateWeaponProfs = [],
		items = [DAGGER, SHORTBOW, LANCE, TRIDENT],
		selectedMasteries = [],
		withProficiencyChecker = true,
	} = {}) {
		const b = Object.create(CharacterSheetBuilder.prototype);
		b._state = {
			getWeaponProficiencies: () => [...stateWeaponProfs],
		};
		if (withProficiencyChecker) b._state._isWeaponProficient = makeIsWeaponProficient(stateWeaponProfs);
		b._page = {getItems: () => items};
		b._selectedWeaponMasteries = [...selectedMasteries];
		return b;
	}

	function render (b, cls) {
		const {simpleWeapons, martialWeapons} = b._buildProficientMasteryGroups(cls);
		return [...simpleWeapons, ...martialWeapons].map(w => w.name);
	}

	// A 2024 Rogue's starting weapon profs are simple weapons only (no "martial").
	const ROGUE_CLASS = {name: "Rogue", source: "XPHB", startingProficiencies: {weapons: ["simple"]}};
	// A 2024 Fighter is proficient with simple + martial.
	const FIGHTER_CLASS = {name: "Fighter", source: "XPHB", startingProficiencies: {weapons: ["simple", "martial"]}};

	it("a freshly-built Rogue is NOT offered Lance/Trident, but sees simple weapons", () => {
		const b = makeBuilder({stateWeaponProfs: [], items: [DAGGER, SHORTBOW, LANCE, TRIDENT]});
		const names = render(b, ROGUE_CLASS);

		expect(names).toContain("Dagger"); // simple
		expect(names).toContain("Shortbow"); // simple
		expect(names).not.toContain("Lance"); // martial, not proficient
		expect(names).not.toContain("Trident"); // martial, not proficient
	});

	it("a Fighter still sees martial weapons", () => {
		const b = makeBuilder({stateWeaponProfs: [], items: [DAGGER, LANCE, LONGSWORD]});
		const names = render(b, FIGHTER_CLASS);

		expect(names).toContain("Dagger");
		expect(names).toContain("Lance");
		expect(names).toContain("Longsword");
	});

	it("derives proficiency from cls.startingProficiencies even when NOT yet on state (render-before-apply)", () => {
		// state has NO weapon proficiencies yet (class features not applied); the pool
		// must still include martial weapons for a Fighter via the class token.
		const b = makeBuilder({stateWeaponProfs: [], items: [LANCE]});
		expect(render(b, FIGHTER_CLASS)).toContain("Lance");
	});

	it("resolves a {@item}-wrapped named martial proficiency via the union", () => {
		// A class whose starting profs include a tagged named martial weapon (2014-style).
		const cls = {
			name: "Rogue",
			source: "PHB",
			startingProficiencies: {weapons: ["simple", "{@item longsword|phb|longswords}"]},
		};
		const b = makeBuilder({stateWeaponProfs: [], items: [DAGGER, LONGSWORD, LANCE, TRIDENT]});
		const names = render(b, cls);

		expect(names).toContain("Dagger"); // simple
		expect(names).toContain("Longsword"); // named prof via {@item} token union
		expect(names).not.toContain("Lance");
		expect(names).not.toContain("Trident");
	});

	it("resolves a {full: '{@item ...}'} object proficiency token", () => {
		const cls = {
			name: "Fighter",
			source: "PHB",
			startingProficiencies: {weapons: [{full: "{@item rapier|phb|rapiers}"}]},
		};
		const b = makeBuilder({stateWeaponProfs: [], items: [RAPIER, LANCE]});
		const names = render(b, cls);

		expect(names).toContain("Rapier");
		expect(names).not.toContain("Lance");
	});

	it("unions with proficiencies already on state (revisiting the step after apply)", () => {
		// The class token is absent, but state already carries "martial" (revisit case).
		const cls = {name: "Fighter", source: "XPHB", startingProficiencies: {}};
		const b = makeBuilder({stateWeaponProfs: ["martial"], items: [LANCE]});
		expect(render(b, cls)).toContain("Lance");
	});

	it("prunes a pre-seeded mastery for a now-non-proficient weapon, keeping proficient seeds", () => {
		const b = makeBuilder({
			stateWeaponProfs: [],
			items: [DAGGER, LANCE],
			selectedMasteries: ["Dagger|XPHB", "Lance|XPHB"], // Lance martial, Rogue not proficient
		});
		render(b, ROGUE_CLASS);

		expect(b._selectedWeaponMasteries).toContain("Dagger|XPHB");
		expect(b._selectedWeaponMasteries).not.toContain("Lance|XPHB");
	});

	it("_matchesWeaponProfTokens handles category, plain-name, {@item} and {full} tokens", () => {
		const b = makeBuilder();
		expect(b._matchesWeaponProfTokens(LANCE, ["martial"])).toBe(true);
		expect(b._matchesWeaponProfTokens(LANCE, ["simple"])).toBe(false);
		expect(b._matchesWeaponProfTokens(RAPIER, ["Rapier"])).toBe(true);
		expect(b._matchesWeaponProfTokens(RAPIER, ["{@item rapier|phb|rapiers}"])).toBe(true);
		expect(b._matchesWeaponProfTokens(RAPIER, [{full: "{@item rapier|phb|rapiers}"}])).toBe(true);
		expect(b._matchesWeaponProfTokens(RAPIER, [])).toBe(false);
	});

	it("backward compat — a state without _isWeaponProficient leaves the pool unfiltered", () => {
		const b = makeBuilder({
			withProficiencyChecker: false,
			items: [DAGGER, LANCE, TRIDENT],
		});
		const names = render(b, ROGUE_CLASS);

		expect(names).toContain("Dagger");
		expect(names).toContain("Lance"); // unfiltered fallback
		expect(names).toContain("Trident");
	});
});
