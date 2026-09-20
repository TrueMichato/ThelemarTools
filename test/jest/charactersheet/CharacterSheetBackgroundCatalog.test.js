import "./setup.js";
import {readFileSync} from "node:fs";
import {CharacterSheetState} from "../../../js/charactersheet/charactersheet-state.js";

const REAL_BACKGROUNDS = JSON.parse(readFileSync(new URL("../../../data/backgrounds.json", import.meta.url), "utf8")).background;

globalThis.window = {
	addEventListener: () => {},
	dispatchEvent: () => {},
	location: {search: ""},
	matchMedia: () => ({matches: false, addEventListener: () => {}}),
};
globalThis.document = {
	querySelector: () => null,
	querySelectorAll: () => [],
	getElementById: () => null,
	addEventListener: () => {},
	body: {classList: {add () {}, remove () {}}},
};

await import("../../../js/charactersheet/charactersheet.js");
const CharacterSheetPage = globalThis.CharacterSheetPage;

describe("Character Sheet background catalog", () => {
	it("keeps the upstream PHB template in canonical data but excludes it from player choices", () => {
		expect(REAL_BACKGROUNDS).toContainEqual(expect.objectContaining({name: "Custom Background", source: "PHB"}));

		const page = Object.create(CharacterSheetPage.prototype);
		page._backgrounds = [
			...REAL_BACKGROUNDS,
			{name: "Custom Background", source: "MYBREW"},
		];

		expect(page.getBackgrounds()).not.toContainEqual(expect.objectContaining({name: "Custom Background", source: "PHB"}));
		expect(page.getBackgrounds()).toContainEqual({name: "Custom Background", source: "MYBREW"});
		expect(page._backgrounds).toContainEqual(expect.objectContaining({name: "Custom Background", source: "PHB"}));
	});

	it.each([
		{name: "Custom Background", source: "PHB", skillProficiencies: [{any: 2}]},
		{name: "Veteran Chronicler", source: "Custom", _isCustom: true, skillProficiencies: [{history: true}]},
	])("preserves and permits editing legacy saved background $name|$source", legacyBackground => {
		const state = new CharacterSheetState();
		state.loadFromJson({background: legacyBackground});
		expect(state.getBackground()).toEqual(legacyBackground);

		const edited = {...state.getBackground(), name: `${legacyBackground.name} (Edited)`};
		state.setBackground(edited);
		expect(state.getBackground()).toEqual(edited);
	});
});
