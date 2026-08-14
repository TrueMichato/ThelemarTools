import "../charactersheet/setup.js";
import {jest} from "@jest/globals";
import {ItemBuilderPanel} from "../../../js/dmscreen/itembuilder/dmscreen-itembuilder.js";
import {ItemBuilderCore} from "../../../js/itembuilder/itembuilder-core.js";

describe("ItemBuilderPanel persistence", () => {
	test("normalizes old panel state and returns a defensive saveable draft", () => {
		const board = {doSaveStateDebounced: jest.fn()};
		const panel = new ItemBuilderPanel({
			board,
			savedState: {
				draft: {
					item: {name: "Saved Blade", source: "HB", type: "M|PHB"},
					upgrades: [{name: "Balanced", source: "TCAH"}],
				},
			},
		});

		const state = panel.getState();
		expect(state.version).toBe(1);
		expect(state.draft.item.name).toBe("Saved Blade");
		expect(state.draft.upgrades).toEqual([{name: "Balanced", source: "TCAH"}]);

		state.draft.item.name = "Mutated";
		expect(panel.getState().draft.item.name).toBe("Saved Blade");
	});

	test("signals the board save path after mutations", () => {
		const board = {doSaveStateDebounced: jest.fn()};
		const panel = new ItemBuilderPanel({board, savedState: {}});
		panel._draft.item.name = "Changed";
		panel._doUpdate({isRender: false});
		expect(board.doSaveStateDebounced).toHaveBeenCalledTimes(1);
	});

	test("normalizes malformed restored collections before panel validation and serialization", () => {
		const panel = new ItemBuilderPanel({
			board: {doSaveStateDebounced: jest.fn()},
			savedState: {
				draft: {
					item: {
						name: "Recovered",
						source: "HB",
						type: "W",
						entries: {},
						additionalEntries: "invalid",
						properties: null,
						attachedSpells: {},
						focus: "Wizard",
						effects: false,
						itemPowers: {},
						appliedUpgrades: "invalid",
						socketedGemstones: {},
					},
					upgrades: "invalid",
					materialized: {item: {entries: null}, upgrades: {}},
				},
			},
		});

		const {draft} = panel.getState();
		expect(draft.upgrades).toEqual([]);
		expect(draft.item).toEqual(expect.objectContaining({
			entries: [],
			additionalEntries: [],
			properties: [],
			attachedSpells: [],
			focus: [],
			effects: [],
			itemPowers: [],
			appliedUpgrades: [],
			socketedGemstones: [],
		}));
		expect(draft.materialized.upgrades).toEqual([]);
		expect(() => ItemBuilderCore.validate(draft)).not.toThrow();
		expect(() => ItemBuilderCore.serialize(draft)).not.toThrow();
	});

	test("uses the shared composition mutation path and persists removals", () => {
		const board = {doSaveStateDebounced: jest.fn()};
		const panel = new ItemBuilderPanel({board, savedState: {draft: {item: {name: "Blade", source: "HB", type: "M"}}}});

		panel._handleCompositionSelect({
			category: "upgrade",
			entity: {name: "Balanced", source: "TCAH"},
			isSelected: false,
		});
		expect(panel.getState().draft.upgrades).toEqual([{name: "Balanced", source: "TCAH"}]);

		panel._handleCompositionSelect({
			category: "upgrade",
			entity: {name: "Balanced", source: "TCAH"},
			isSelected: true,
		});
		expect(panel.getState().draft.upgrades).toEqual([]);
		expect(board.doSaveStateDebounced).toHaveBeenCalledTimes(2);
	});

	test("blocks invalid saves with persistent recovery feedback", async () => {
		const panel = new ItemBuilderPanel({board: {doSaveStateDebounced: jest.fn()}, savedState: {}});
		panel._draft.item.name = "";

		await panel._pSaveToBrew();

		expect(panel._saveStatus).toMatch(/^Cannot save:/);
		expect(ItemBuilderCore.validate(panel._draft, panel._catalogs).errors).toContainEqual(expect.objectContaining({
			message: "Enter an item name.",
		}));
	});
});
