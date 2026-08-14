import "../charactersheet/setup.js";
import {jest} from "@jest/globals";
import {ItemBuilderPanel} from "../../../js/dmscreen/itembuilder/dmscreen-itembuilder.js";

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
});
