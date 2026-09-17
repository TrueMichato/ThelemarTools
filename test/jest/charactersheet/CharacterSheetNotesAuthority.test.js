import "./setup.js";
import {jest} from "@jest/globals";
import {CharacterSheetNotes} from "../../../js/charactersheet/charactersheet-notes.js";

function makeNoteElement () {
	const handlers = {};
	const classes = new Set();
	const header = {
		style: {},
		addEventListener: (name, handler) => { handlers[name] = handler; },
	};
	const note = {
		style: {left: "10px", top: "20px"},
		classList: {
			add: name => classes.add(name),
			remove: name => classes.delete(name),
			contains: name => classes.has(name),
		},
		querySelector: selector => selector === ".charsheet__sticky-note-header" ? header : null,
	};
	return {note, header, handlers};
}

function makeMouseEvent ({clientX, clientY}) {
	return {
		clientX,
		clientY,
		target: {closest: () => null},
		preventDefault () {},
	};
}

function makeHarness () {
	const page = {
		_currentCharacterId: "character-a",
		_characterLoadGeneration: 1,
		_currentCharacterAccess: "owner",
		isCurrentCharacterReadOnly () {
			return this._currentCharacterAccess === "dm_readonly";
		},
		_getCharacterScopeSnapshot () {
			return {
				characterId: this._currentCharacterId,
				loadGeneration: this._characterLoadGeneration,
				accessMode: this._currentCharacterAccess,
			};
		},
		_isCharacterScopeSnapshotCurrent (snapshot, {isRequireOwner = false} = {}) {
			return snapshot.characterId === this._currentCharacterId
				&& snapshot.loadGeneration === this._characterLoadGeneration
				&& snapshot.accessMode === this._currentCharacterAccess
				&& (!isRequireOwner || !this.isCurrentCharacterReadOnly());
		},
		saveCharacter: jest.fn(),
	};
	const state = {updateStickyNote: jest.fn()};
	const notes = Object.create(CharacterSheetNotes.prototype);
	notes._page = page;
	notes._state = state;
	notes._activeDrag = null;
	return {notes, page, state};
}

describe("CharacterSheetNotes authority fencing", () => {
	it("still persists a completed owner drag", () => {
		const {notes, page, state} = makeHarness();
		const {note, handlers} = makeNoteElement();
		notes._makeDraggable(note, "note-1");

		handlers.mousedown(makeMouseEvent({clientX: 20, clientY: 30}));
		notes._handleStickyNoteDragMove(makeMouseEvent({clientX: 60, clientY: 80}));
		notes._handleStickyNoteDragEnd();

		expect(note.style.left).toBe("50px");
		expect(note.style.top).toBe("70px");
		expect(state.updateStickyNote).toHaveBeenCalledWith("note-1", {position: {x: 50, y: 70}});
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
	});

	it("does not move or persist a sticky note in a DM read-only projection", () => {
		const {notes, page, state} = makeHarness();
		const {note, handlers} = makeNoteElement();
		page._currentCharacterAccess = "dm_readonly";
		notes._makeDraggable(note, "note-1");

		handlers.mousedown(makeMouseEvent({clientX: 20, clientY: 30}));
		notes._handleStickyNoteDragMove(makeMouseEvent({clientX: 60, clientY: 80}));
		notes._handleStickyNoteDragEnd();

		expect(note.style.left).toBe("10px");
		expect(note.style.top).toBe("20px");
		expect(state.updateStickyNote).not.toHaveBeenCalled();
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	it("cancels an active owner drag and restores its visible position when authority changes", () => {
		const {notes, page, state} = makeHarness();
		const {note, handlers} = makeNoteElement();
		notes._makeDraggable(note, "note-1");

		handlers.mousedown(makeMouseEvent({clientX: 20, clientY: 30}));
		notes._handleStickyNoteDragMove(makeMouseEvent({clientX: 60, clientY: 80}));
		expect(note.style.left).toBe("50px");
		expect(note.style.top).toBe("70px");

		page._currentCharacterAccess = "dm_readonly";
		notes.cancelActiveDrag();

		expect(note.style.left).toBe("10px");
		expect(note.style.top).toBe("20px");
		expect(note.classList.contains("charsheet__sticky-note--dragging")).toBe(false);
		expect(state.updateStickyNote).not.toHaveBeenCalled();
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	it("cancels instead of persisting when the character changes before mouseup", () => {
		const {notes, page, state} = makeHarness();
		const {note, handlers} = makeNoteElement();
		notes._makeDraggable(note, "note-1");

		handlers.mousedown(makeMouseEvent({clientX: 20, clientY: 30}));
		notes._handleStickyNoteDragMove(makeMouseEvent({clientX: 60, clientY: 80}));
		page._currentCharacterId = "character-b";
		page._characterLoadGeneration++;
		notes._handleStickyNoteDragEnd();

		expect(note.style.left).toBe("10px");
		expect(note.style.top).toBe("20px");
		expect(state.updateStickyNote).not.toHaveBeenCalled();
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});
});
