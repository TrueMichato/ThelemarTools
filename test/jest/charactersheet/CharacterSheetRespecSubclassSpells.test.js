import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-respec.js";

let CharacterSheetState;
let CharacterSheetRespec;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetRespec = globalThis.CharacterSheetRespec;
});

const SUN_SPELLS = [{
	innate: {"0": ["light#c"]},
	known: {"3": ["faerie fire", "flaming sphere"]},
}];

const STORM_SPELLS = [{
	known: {"3": ["thunderwave", "gust of wind"]},
}];

const SPELL_DB = [
	{name: "Light", source: "PHB", level: 0, school: "V"},
	{name: "Faerie Fire", source: "PHB", level: 1, school: "V"},
	{name: "Flaming Sphere", source: "PHB", level: 2, school: "V"},
	{name: "Thunderwave", source: "PHB", level: 1, school: "V"},
	{name: "Gust of Wind", source: "PHB", level: 2, school: "T"},
];

function makeRespec (state) {
	const respec = Object.create(CharacterSheetRespec.prototype);
	respec._state = state;
	respec._page = {
		getSubclassFeatures: () => [],
		getClassFeatures: () => [],
		getClasses: () => state.getClasses(),
		filterByAllowedSources: (arr) => arr,
	};
	respec._$timeline = null;
	respec._$legacyBadge = null;
	return respec;
}

describe("CharacterSheetRespec subclass change — spell cleanup", () => {
	test("changing subclass removes old subclass spells/cantrips and adds new ones", async () => {
		const state = new CharacterSheetState();
		state.setSpellData(SPELL_DB);
		state.addClass({
			name: "Sorcerer",
			source: "TGTT",
			level: 3,
			subclass: {name: "Child of the Sun Bloodline", shortName: "Sun Bloodline", source: "TGTT", additionalSpells: SUN_SPELLS},
		});

		// Sanity: old subclass spells present.
		expect(state.getCantripsKnown().some(c => c.name.toLowerCase() === "light")).toBe(true);
		expect(state.getSpellsKnown().some(s => s.name.toLowerCase() === "faerie fire")).toBe(true);

		const respec = makeRespec(state);
		const history = {level: 3, class: {name: "Sorcerer", source: "TGTT"}};
		const oldSubclass = {name: "Child of the Sun Bloodline", shortName: "Sun Bloodline", source: "TGTT"};
		const newSubclass = {name: "Storm Sorcery", shortName: "Storm", source: "PHB", additionalSpells: STORM_SPELLS};

		await respec._applySubclassChange(3, history, oldSubclass, newSubclass);

		// Old subclass spells removed.
		expect(state.getCantripsKnown().some(c => c.name.toLowerCase() === "light")).toBe(false);
		expect(state.getSpellsKnown().some(s => s.name.toLowerCase() === "faerie fire")).toBe(false);
		expect(state.getSpellsKnown().some(s => s.name.toLowerCase() === "flaming sphere")).toBe(false);

		// New subclass spells added.
		expect(state.getSpellsKnown().some(s => s.name.toLowerCase() === "thunderwave")).toBe(true);
		expect(state.getSpellsKnown().some(s => s.name.toLowerCase() === "gust of wind")).toBe(true);

		// Class entry now points at the new subclass.
		const cls = state.getClasses().find(c => c.name === "Sorcerer");
		expect(cls.subclass.name).toBe("Storm Sorcery");
	});
});
