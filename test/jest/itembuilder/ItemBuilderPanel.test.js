import "../charactersheet/setup.js";
import {jest} from "@jest/globals";
import {ItemBuilderPanel} from "../../../js/dmscreen/itembuilder/dmscreen-itembuilder.js";
import {ItemBuilderCore} from "../../../js/itembuilder/itembuilder-core.js";
import {ItemBuilderHandoff} from "../../../js/itembuilder/itembuilder-handoff.js";

String.prototype.qq ||= function () { return String(this); };
globalThis.DataUtil ||= {};

function getFakeElement () {
	return {
		_handlers: {},
		_children: [],
		isConnected: true,
		append (...children) { this._children.push(...children); return this; },
		appendTo (parent) { parent.append(this); return this; },
		attr () { return this; },
		empty () { this._children = []; return this; },
		focus: jest.fn(),
		focuse () { this.focus(); return this; },
		onn (event, handler) { this._handlers[event] = handler; return this; },
		prop () { return this; },
		querySelector () { return null; },
		txt (value) { this.textContent = value; return this; },
		val (value) {
			if (arguments.length) {
				this._value = value;
				return this;
			}
			return this._value || "";
		},
	};
}

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

	test("keeps the embedded panel compact and reserves the catalog and real card for focused mode", () => {
		const eeOriginal = globalThis.ee;
		const pickerRender = jest.fn();
		const Picker = jest.fn().mockImplementation(() => ({render: pickerRender}));
		const renderItem = jest.fn(() => "<tr><td>Preview</td></tr>");
		globalThis.ee = () => getFakeElement();
		globalThis.BrewUtil2 = {getSources: () => []};
		globalThis.Renderer.item = {getCompactRenderedString: renderItem};
		const panel = new ItemBuilderPanel({
			board: {doSaveStateDebounced: jest.fn()},
			savedState: {draft: {item: {name: "Compact", source: "HB", type: "W"}}},
			compositionPickerClass: Picker,
		});
		panel._isLoading = false;
		panel._root = getFakeElement();

		try {
			panel._render();
			expect(Picker).not.toHaveBeenCalled();
			expect(renderItem).not.toHaveBeenCalled();

			panel._renderEditor({
				wrp: getFakeElement(),
				item: ItemBuilderCore.serialize(panel._draft, panel._catalogs),
				validation: ItemBuilderCore.validate(panel._draft, panel._catalogs),
				isFocused: true,
				doClose: jest.fn(),
			});
			expect(Picker).toHaveBeenCalledTimes(1);
			expect(pickerRender).toHaveBeenCalledTimes(1);
			expect(renderItem).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.ee = eeOriginal;
		}
	});

	test("does not mutate advanced JSON until Apply, then persists and refreshes both views", async () => {
		const board = {doSaveStateDebounced: jest.fn()};
		const panel = new ItemBuilderPanel({
			board,
			savedState: {draft: {item: {name: "Original", source: "HB", type: "W"}}},
		});
		panel._render = jest.fn();
		const edited = JSON.stringify({...panel._draft.item, name: "Applied", bonusAc: 2});
		const confirmOriginal = InputUiUtil.pGetUserBoolean;
		InputUiUtil.pGetUserBoolean = jest.fn(async () => false);

		try {
			expect(panel._draft.item.name).toBe("Original");
			await expect(panel._pConfirmAdvancedDiscard({
				original: JSON.stringify(panel._draft.item),
				current: edited,
			})).resolves.toBe(false);
			expect(panel._draft.item.name).toBe("Original");

			panel._applyAdvancedJson(edited);
			expect(panel._draft.item).toEqual(expect.objectContaining({name: "Applied", bonusAc: 2}));
			expect(board.doSaveStateDebounced).toHaveBeenCalledTimes(1);
			expect(panel._render).toHaveBeenCalledTimes(1);
		} finally {
			InputUiUtil.pGetUserBoolean = confirmOriginal;
		}
	});

	test("returns focus to the surviving embedded trigger after the focused editor closes", () => {
		const panel = new ItemBuilderPanel({board: {doSaveStateDebounced: jest.fn()}, savedState: {}});
		const fallback = {focus: jest.fn()};
		panel._root = {querySelector: jest.fn(() => fallback)};

		panel._restoreFocus({
			trigger: {isConnected: false},
			selector: ".dm-item-builder__open-editor",
		});

		expect(panel._root.querySelector).toHaveBeenCalledWith(".dm-item-builder__open-editor");
		expect(fallback.focus).toHaveBeenCalledTimes(1);
	});

	test("hands the complete draft to Makebrew without writing Brew", async () => {
		const navigate = jest.fn();
		const brewPersist = jest.fn();
		globalThis.BrewUtil2 = {...globalThis.BrewUtil2, pPersistEditableBrewEntity: brewPersist};
		const panel = new ItemBuilderPanel({
			board: {doSaveStateDebounced: jest.fn()},
			savedState: {
				draft: {
					preset: {name: "Longsword", source: "PHB"},
					material: {name: "Starsteel", source: "TGTT"},
					upgrades: [{name: "Balanced", source: "TCAH"}],
					gemstone: {name: "Journey", source: "TGTT"},
					item: {name: "Handoff Blade", source: "HB", type: "M", entries: ["Advanced."], bonusAc: 1},
				},
			},
			fnNavigateToMakebrew: navigate,
		});
		const store = jest.spyOn(ItemBuilderHandoff, "pStore").mockResolvedValue(panel._draft);

		await panel._pContinueInMakebrew();

		expect(store).toHaveBeenCalledWith({draft: expect.objectContaining({
			preset: {name: "Longsword", source: "PHB"},
			material: {name: "Starsteel", source: "TGTT"},
			upgrades: [{name: "Balanced", source: "TCAH"}],
			gemstone: {name: "Journey", source: "TGTT"},
			item: expect.objectContaining({entries: ["Advanced."], bonusAc: 1}),
		})});
		expect(navigate).toHaveBeenCalledTimes(1);
		expect(brewPersist).not.toHaveBeenCalled();
		store.mockRestore();
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

	test("keeps Brew save success and failure visible and clears stale success after mutation", async () => {
		const board = {doSaveStateDebounced: jest.fn()};
		const panel = new ItemBuilderPanel({
			board,
			savedState: {draft: {item: {name: "Saved Item", source: "HB", type: "W"}}},
		});
		panel._render = jest.fn();
		globalThis.DataUtil.cleanJson = value => value;
		globalThis.JqueryUtil.doToast = jest.fn();
		globalThis.BrewUtil2 = {
			...globalThis.BrewUtil2,
			pPersistEditableBrewEntity: jest.fn(async () => {}),
		};

		await panel._pSaveToBrew();
		expect(panel._saveStatus).toBe("Saved \"Saved Item\" to homebrew.");
		expect(panel._draft.item.uniqueId).toBeTruthy();
		expect(board.doSaveStateDebounced).toHaveBeenCalledTimes(1);

		panel._draft.item.name = "Changed Again";
		panel._doUpdate({isRender: false});
		expect(panel._saveStatus).toBe("");

		BrewUtil2.pPersistEditableBrewEntity.mockRejectedValueOnce(new Error("storage unavailable"));
		await panel._pSaveToBrew();
		expect(panel._saveStatus).toBe("Save failed: storage unavailable");
	});

	test("reloads a serialized focused preview without changing its canonical item", () => {
		const catalogs = {
			items: [{name: "Longsword", source: "PHB", type: "M", dmg1: "1d8"}],
			materials: [{name: "Starsteel", source: "TGTT", appliesTo: ["weapon"], entries: ["Material."]}],
			upgrades: [{name: "Balanced", source: "TCAH", upgradeType: ["WU:1"], entries: ["Upgrade."]}],
		};
		const panel = new ItemBuilderPanel({
			board: {doSaveStateDebounced: jest.fn()},
			savedState: {
				draft: {
					preset: {name: "Longsword", source: "PHB"},
					material: {name: "Starsteel", source: "TGTT"},
					upgrades: [{name: "Balanced", source: "TCAH"}],
					item: {name: "Reloaded Blade", source: "HB", type: "M", entries: ["Advanced."]},
				},
			},
		});
		panel._catalogs = catalogs;
		const expected = ItemBuilderCore.serialize(panel._draft, catalogs);

		const reloaded = new ItemBuilderPanel({
			board: {doSaveStateDebounced: jest.fn()},
			savedState: panel.getState(),
		});
		reloaded._catalogs = catalogs;
		expect(ItemBuilderCore.serialize(reloaded._draft, catalogs)).toEqual(expected);
	});
});
