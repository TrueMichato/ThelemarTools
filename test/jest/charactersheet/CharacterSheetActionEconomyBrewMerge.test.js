import "./setup.js";

globalThis.window ||= {addEventListener () {}};
globalThis.document ||= {
	getElementById: () => null,
	querySelector: () => null,
	querySelectorAll: () => [],
	body: {classList: {add () {}, remove () {}}},
};
globalThis.Renderer.item ||= {};
globalThis.Renderer.item.addPrereleaseBrewPropertiesAndTypesFrom ||= () => {};

await import("../../../js/charactersheet/charactersheet.js");

const CharacterSheetPage = globalThis.CharacterSheetPage;

describe("CharacterSheetPage action-economy brew merge", () => {
	test("merges brew actions and attaches Item Utilization to the XPHB Utilize action", () => {
		const utilize = {
			name: "Utilize",
			source: "XPHB",
			time: [{number: 1, unit: "action"}],
			entries: ["Use an object that requires an action."],
		};
		const brewAction = {
			name: "Strangle",
			source: "TGTT",
			time: [{number: 1, unit: "bonus"}],
			entries: ["Strangle a grappled target."],
		};
		const itemUtilization = {
			name: "Item Utilization",
			source: "TGTT",
			entries: ["Damage and healing items can be maximized when used as an action."],
		};
		const page = Object.create(CharacterSheetPage.prototype);
		page._actionsData = [utilize];

		page._mergeBrewData({
			action: [brewAction],
			variantrule: [itemUtilization],
		});

		const mergedStrangle = page._actionsData.find(action => action.name === "Strangle");
		expect(mergedStrangle).toEqual(brewAction);
		expect(mergedStrangle).not.toBe(brewAction);

		const mergedUtilize = page._actionsData.find(action => action.name === "Utilize");
		expect(mergedUtilize._actionEconomySupplementalRules).toEqual([itemUtilization]);
		expect(mergedUtilize._actionEconomySupplementalRules[0]).not.toBe(itemUtilization);
	});
});
