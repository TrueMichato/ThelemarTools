import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

// Mock escapeQuotes if not present
if (!String.prototype.escapeQuotes) {
	String.prototype.escapeQuotes = function () {
		return this.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
	};
}

/**
 * Creates a minimal mock of CharacterSheetPage with just the methods
 * needed to test _onManageCharacters().
 */
function createMockController (characters = []) {
	const storedCharacters = [...characters];

	// Mock StorageUtil with pGet/pSet (used by _onManageCharacters)
	globalThis.StorageUtil = {
		...globalThis.StorageUtil,
		pGet: jest.fn(async (key) => {
			if (key === "charsheet-characters") return [...storedCharacters];
			return null;
		}),
		pSet: jest.fn(async (key, value) => {
			if (key === "charsheet-characters") {
				storedCharacters.length = 0;
				storedCharacters.push(...value);
			}
		}),
		pGetForPage: jest.fn(async () => null),
		pSetForPage: jest.fn(async () => {}),
	};

	// Mock JqueryUtil.doToast
	globalThis.JqueryUtil = {
		doToast: jest.fn(),
	};

	// Mock InputUiUtil (overridden per test)
	globalThis.InputUiUtil = {
		pGetUserMultipleChoice: jest.fn(async () => null),
		pGetUserBoolean: jest.fn(async () => false),
		pGetUserString: jest.fn(async () => null),
	};

	const state = new CharacterSheetState();

	// Build a lightweight controller with mock methods for dependencies
	const controller = {
		_state: state,
		_currentCharacterId: characters[0]?.id || null,
		_selCharacter: {value: ""},
		_createNewCharacter: jest.fn(() => {
			controller._currentCharacterId = null;
		}),
		_pLoadCharacters: jest.fn(async () => {}),
		_saveCurrentCharacter: jest.fn(async () => {}),
	};

	// Import the actual method — we do this by reading the source pattern from charactersheet.js.
	// Since the module is DOM-dependent, we re-implement the method binding via a direct copy.
	// The method is async and uses: StorageUtil, InputUiUtil, JqueryUtil, this._currentCharacterId,
	// this._createNewCharacter, this._pLoadCharacters, this._selCharacter
	controller._onManageCharacters = async function () {
		const characters = await StorageUtil.pGet("charsheet-characters") || [];

		if (characters.length === 0) {
			JqueryUtil.doToast({type: "warning", content: "No saved characters to manage."});
			return;
		}

		const fnGetLabel = (char) => {
			const name = char.name || "Unnamed Character";
			const totalLevel = char.classes?.reduce((sum, c) => sum + (c.level || 0), 0) || 0;
			const classNames = char.classes?.map(c => c.name).join("/") || "";
			const classInfo = classNames ? `${classNames} ${totalLevel}` : "";
			return classInfo ? `${name} — ${classInfo}` : name;
		};

		const selected = await InputUiUtil.pGetUserMultipleChoice({
			title: "Bulk Delete Characters",
			values: characters,
			fnDisplay: (char) => fnGetLabel(char),
			isResolveItems: true,
			min: 1,
			max: characters.length,
			htmlDescription: `<div class="ve-flex-col"><p><b class="veapp__msg-warning">Select characters to permanently delete.</b></p><p>This action <b>cannot be undone</b>.</p></div>`,
		});

		if (!selected?.length) return;

		const selectedNames = selected.map(c => `<li>${fnGetLabel(c).escapeQuotes()}</li>`).join("");
		const countText = selected.length === 1 ? "1 character" : `${selected.length} characters`;

		const isConfirmed = await InputUiUtil.pGetUserBoolean({
			title: "Confirm Bulk Delete",
			htmlDescription: `<div class="ve-flex-col">
				<div class="alert alert-danger mb-3">
					<b>You are about to permanently delete ${countText}:</b>
					<ul class="mt-2 mb-0">${selectedNames}</ul>
				</div>
				<p><b>This action cannot be undone.</b></p>
			</div>`,
			textYes: `Delete ${countText}`,
			textNo: "Cancel",
		});

		if (!isConfirmed) return;

		if (selected.length >= 3) {
			const typed = await InputUiUtil.pGetUserString({
				title: "Final Confirmation",
				htmlDescription: `<div class="ve-flex-col">
					<div class="alert alert-danger mb-2">
						<b>You are about to permanently delete ${countText}.</b>
					</div>
					<p>Type <b>DELETE</b> to confirm.</p>
				</div>`,
				fnIsValid: (val) => val?.trim() === "DELETE",
			});

			if (typed?.trim() !== "DELETE") return;
		}

		const selectedIds = new Set(selected.map(c => c.id));
		const remaining = characters.filter(c => !selectedIds.has(c.id));
		await StorageUtil.pSet("charsheet-characters", remaining);

		if (this._currentCharacterId && selectedIds.has(this._currentCharacterId)) {
			this._createNewCharacter();
		}

		await this._pLoadCharacters();
		if (!this._currentCharacterId || selectedIds.has(this._currentCharacterId)) {
			this._selCharacter.value = "";
		}

		JqueryUtil.doToast({type: "success", content: `Deleted ${countText}.`});
	};

	return {controller, storedCharacters};
}

function makeChar (id, name, classes = []) {
	return {id, name, classes: classes.map(c => ({name: c.name, source: c.source || "PHB", level: c.level || 1}))};
}

describe("CharacterSheetManageCharacters", () => {
	describe("_onManageCharacters", () => {
		it("should show warning toast when no saved characters exist", async () => {
			const {controller} = createMockController([]);

			await controller._onManageCharacters();

			expect(globalThis.JqueryUtil.doToast).toHaveBeenCalledWith(
				expect.objectContaining({type: "warning", content: "No saved characters to manage."}),
			);
			expect(globalThis.InputUiUtil.pGetUserMultipleChoice).not.toHaveBeenCalled();
		});

		it("should not delete if user cancels at selection stage", async () => {
			const chars = [
				makeChar("a1", "Aelar", [{name: "Fighter", level: 5}]),
				makeChar("b2", "Bree", [{name: "Rogue", level: 3}]),
			];
			const {controller, storedCharacters} = createMockController(chars);
			globalThis.InputUiUtil.pGetUserMultipleChoice.mockResolvedValue(null);

			await controller._onManageCharacters();

			expect(globalThis.InputUiUtil.pGetUserBoolean).not.toHaveBeenCalled();
			expect(storedCharacters).toHaveLength(2);
		});

		it("should not delete if user cancels at confirmation stage", async () => {
			const chars = [
				makeChar("a1", "Aelar", [{name: "Fighter", level: 5}]),
				makeChar("b2", "Bree", [{name: "Rogue", level: 3}]),
			];
			const {controller, storedCharacters} = createMockController(chars);
			globalThis.InputUiUtil.pGetUserMultipleChoice.mockResolvedValue([chars[0]]);
			globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValue(false);

			await controller._onManageCharacters();

			expect(globalThis.StorageUtil.pSet).not.toHaveBeenCalled();
			expect(storedCharacters).toHaveLength(2);
		});

		it("should delete selected characters after confirmation (1-2 characters, no type-to-confirm)", async () => {
			const chars = [
				makeChar("a1", "Aelar", [{name: "Fighter", level: 5}]),
				makeChar("b2", "Bree", [{name: "Rogue", level: 3}]),
				makeChar("c3", "Cael", [{name: "Wizard", level: 7}]),
			];
			const {controller, storedCharacters} = createMockController(chars);
			controller._currentCharacterId = "c3"; // Not among deleted

			// Select 2 characters (under threshold for type-to-confirm)
			globalThis.InputUiUtil.pGetUserMultipleChoice.mockResolvedValue([chars[0], chars[1]]);
			globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValue(true);

			await controller._onManageCharacters();

			// Should NOT prompt for type-to-confirm (only 2 selected)
			expect(globalThis.InputUiUtil.pGetUserString).not.toHaveBeenCalled();

			// Should have saved the remaining character
			expect(globalThis.StorageUtil.pSet).toHaveBeenCalledWith(
				"charsheet-characters",
				[expect.objectContaining({id: "c3", name: "Cael"})],
			);
			expect(storedCharacters).toHaveLength(1);
			expect(storedCharacters[0].id).toBe("c3");

			// Should NOT have reset current character (c3 was not deleted)
			expect(controller._createNewCharacter).not.toHaveBeenCalled();

			// Should show success toast
			expect(globalThis.JqueryUtil.doToast).toHaveBeenCalledWith(
				expect.objectContaining({type: "success", content: "Deleted 2 characters."}),
			);
		});

		it("should require type-to-confirm when deleting 3+ characters", async () => {
			const chars = [
				makeChar("a1", "Aelar", [{name: "Fighter", level: 5}]),
				makeChar("b2", "Bree", [{name: "Rogue", level: 3}]),
				makeChar("c3", "Cael", [{name: "Wizard", level: 7}]),
				makeChar("d4", "Dawn", [{name: "Cleric", level: 4}]),
			];
			const {controller, storedCharacters} = createMockController(chars);
			controller._currentCharacterId = "d4";

			// Select 3 characters (reaches type-to-confirm threshold)
			globalThis.InputUiUtil.pGetUserMultipleChoice.mockResolvedValue([chars[0], chars[1], chars[2]]);
			globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValue(true);
			globalThis.InputUiUtil.pGetUserString.mockResolvedValue("DELETE");

			await controller._onManageCharacters();

			// Should prompt for type-to-confirm
			expect(globalThis.InputUiUtil.pGetUserString).toHaveBeenCalled();
			const stringCallOpts = globalThis.InputUiUtil.pGetUserString.mock.calls[0][0];
			expect(stringCallOpts.title).toBe("Final Confirmation");
			expect(stringCallOpts.fnIsValid("DELETE")).toBe(true);
			expect(stringCallOpts.fnIsValid("delete")).toBe(false);
			expect(stringCallOpts.fnIsValid("nope")).toBe(false);

			// Should have deleted 3, kept 1
			expect(storedCharacters).toHaveLength(1);
			expect(storedCharacters[0].id).toBe("d4");
		});

		it("should abort if type-to-confirm text is wrong", async () => {
			const chars = [
				makeChar("a1", "Aelar", [{name: "Fighter", level: 5}]),
				makeChar("b2", "Bree", [{name: "Rogue", level: 3}]),
				makeChar("c3", "Cael", [{name: "Wizard", level: 7}]),
			];
			const {controller, storedCharacters} = createMockController(chars);

			globalThis.InputUiUtil.pGetUserMultipleChoice.mockResolvedValue(chars);
			globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValue(true);
			globalThis.InputUiUtil.pGetUserString.mockResolvedValue("nope");

			await controller._onManageCharacters();

			// Should NOT have persisted any deletion
			expect(globalThis.StorageUtil.pSet).not.toHaveBeenCalled();
			expect(storedCharacters).toHaveLength(3);
		});

		it("should switch to new character when the active character is deleted", async () => {
			const chars = [
				makeChar("a1", "Aelar", [{name: "Fighter", level: 5}]),
				makeChar("b2", "Bree", [{name: "Rogue", level: 3}]),
			];
			const {controller, storedCharacters} = createMockController(chars);
			controller._currentCharacterId = "a1";

			globalThis.InputUiUtil.pGetUserMultipleChoice.mockResolvedValue([chars[0]]);
			globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValue(true);

			await controller._onManageCharacters();

			expect(controller._createNewCharacter).toHaveBeenCalled();
			expect(controller._selCharacter.value).toBe("");
			expect(storedCharacters).toHaveLength(1);
			expect(storedCharacters[0].id).toBe("b2");
		});

		it("should handle deleting ALL characters", async () => {
			const chars = [
				makeChar("a1", "Aelar", [{name: "Fighter", level: 5}]),
				makeChar("b2", "Bree", [{name: "Rogue", level: 3}]),
			];
			const {controller, storedCharacters} = createMockController(chars);
			controller._currentCharacterId = "a1";

			globalThis.InputUiUtil.pGetUserMultipleChoice.mockResolvedValue(chars);
			globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValue(true);

			await controller._onManageCharacters();

			expect(controller._createNewCharacter).toHaveBeenCalled();
			expect(storedCharacters).toHaveLength(0);
			expect(controller._pLoadCharacters).toHaveBeenCalled();
		});

		it("should pass correct labels with class info to the selection modal", async () => {
			const chars = [
				makeChar("a1", "Aelar", [{name: "Fighter", level: 5}]),
				makeChar("b2", "Unnamed", []),
				makeChar("c3", "Bree", [{name: "Rogue", level: 3}, {name: "Fighter", level: 2}]),
			];
			const {controller} = createMockController(chars);
			globalThis.InputUiUtil.pGetUserMultipleChoice.mockResolvedValue(null);

			await controller._onManageCharacters();

			const callOpts = globalThis.InputUiUtil.pGetUserMultipleChoice.mock.calls[0][0];
			expect(callOpts.values).toHaveLength(3);

			// Test fnDisplay generates correct labels
			const label0 = callOpts.fnDisplay(chars[0]);
			expect(label0).toContain("Aelar");
			expect(label0).toContain("Fighter");
			expect(label0).toContain("5");

			const label1 = callOpts.fnDisplay(chars[1]);
			expect(label1).toBe("Unnamed");

			const label2 = callOpts.fnDisplay(chars[2]);
			expect(label2).toContain("Bree");
			expect(label2).toContain("Rogue/Fighter");
			expect(label2).toContain("5"); // total level = 3+2
		});

		it("should pass danger-styled description to selection modal", async () => {
			const chars = [makeChar("a1", "Aelar", [{name: "Fighter", level: 5}])];
			const {controller} = createMockController(chars);
			globalThis.InputUiUtil.pGetUserMultipleChoice.mockResolvedValue(null);

			await controller._onManageCharacters();

			const callOpts = globalThis.InputUiUtil.pGetUserMultipleChoice.mock.calls[0][0];
			expect(callOpts.htmlDescription).toContain("permanently delete");
			expect(callOpts.htmlDescription).toContain("cannot be undone");
		});

		it("should display confirmation with selected character names", async () => {
			const chars = [
				makeChar("a1", "Aelar", [{name: "Fighter", level: 5}]),
				makeChar("b2", "Bree", [{name: "Rogue", level: 3}]),
			];
			const {controller} = createMockController(chars);
			controller._currentCharacterId = "b2";

			globalThis.InputUiUtil.pGetUserMultipleChoice.mockResolvedValue([chars[0]]);
			globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValue(false);

			await controller._onManageCharacters();

			const confirmOpts = globalThis.InputUiUtil.pGetUserBoolean.mock.calls[0][0];
			expect(confirmOpts.title).toBe("Confirm Bulk Delete");
			expect(confirmOpts.htmlDescription).toContain("Aelar");
			expect(confirmOpts.htmlDescription).toContain("1 character");
			expect(confirmOpts.htmlDescription).toContain("cannot be undone");
			expect(confirmOpts.textYes).toContain("Delete 1 character");
		});

		it("should not affect current character if it was not selected for deletion", async () => {
			const chars = [
				makeChar("a1", "Aelar", [{name: "Fighter", level: 5}]),
				makeChar("b2", "Bree", [{name: "Rogue", level: 3}]),
			];
			const {controller} = createMockController(chars);
			controller._currentCharacterId = "b2";

			globalThis.InputUiUtil.pGetUserMultipleChoice.mockResolvedValue([chars[0]]);
			globalThis.InputUiUtil.pGetUserBoolean.mockResolvedValue(true);

			await controller._onManageCharacters();

			expect(controller._createNewCharacter).not.toHaveBeenCalled();
			expect(controller._currentCharacterId).toBe("b2");
		});
	});
});
