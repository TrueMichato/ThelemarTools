import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const originalE = globalThis.e_;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

class TestElement {
	constructor (html = "") {
		this.html = html;
		this.parent = null;
		this.children = [];
		this.events = new Map();
		this.selectors = new Map();
		this.attrs = new Map();
		this.dataset = {};
		this.hidden = false;
		this.textContent = "";
		this.value = "";
		this.tagName = html.trim().startsWith("<button") ? "BUTTON" : "DIV";
		const classes = new Set((/class="([^"]*)"/.exec(html)?.[1] || "").split(" "));
		this.classList = {contains: name => classes.has(name)};
	}

	append (...children) {
		children.forEach(child => {
			child.parent = this;
			this.children.push(child);
		});
	}

	querySelector (selector) { return this.selectors.get(selector)?.[0] || null; }
	querySelectorAll (selector) { return this.selectors.get(selector) || []; }
	setAttribute (key, value) { this.attrs.set(key, value); }
	getAttribute (key) { return this.attrs.get(key) || null; }
	hasAttribute (key) { return this.attrs.has(key); }
	addEventListener (type, listener) {
		const handlers = this.events.get(type) || [];
		handlers.push(listener);
		this.events.set(type, handlers);
	}

	focus () { TestElement.focused = this; }
	click () {
		const event = {
			target: this,
			stopped: false,
			stopPropagation () { this.stopped = true; },
		};
		for (let node = this; node && !event.stopped; node = node.parent) {
			(node.events.get("click") || []).forEach(handler => handler(event));
		}
	}
}

function makeElement (html) {
	const node = new TestElement(html);
	const attach = (parent, selector, children) => {
		parent.selectors.set(selector, children);
		parent.append(...children);
	};
	if (html.includes("class=\"charsheet__lore-skills-section\"")) {
		attach(node, ".charsheet__lore-skills-list", [new TestElement()]);
	} else if (html.includes("class=\"charsheet__lore-skill-row\"")) {
		const down = new TestElement("<button class=\"charsheet__lore-skill-bump\">");
		const up = new TestElement("<button class=\"charsheet__lore-skill-bump\">");
		down.getAttribute = () => "-2";
		up.getAttribute = () => "2";
		attach(node, ".charsheet__lore-skill-bump", [down, up]);
		attach(node, ".charsheet__lore-skill-delete", [new TestElement("<span class=\"charsheet__lore-skill-delete\">")]);
	} else if (html.includes("class=\"charsheet__lore-skill-note-area\"")) {
		const view = new TestElement();
		const editor = new TestElement();
		editor.hidden = true;
		attach(node, ".charsheet__lore-skill-note-view", [view]);
		attach(node, ".charsheet__lore-skill-note-editor", [editor]);
		const controls = [
			[".charsheet__lore-skill-note-text", view, new TestElement()],
			[".charsheet__lore-skill-note-edit", view, new TestElement("<button>")],
			[".charsheet__lore-skill-note-input", editor, new TestElement("<textarea>")],
			[".charsheet__lore-skill-note-cancel", editor, new TestElement("<button>")],
			[".charsheet__lore-skill-note-save", editor, new TestElement("<button>")],
		];
		controls.forEach(([selector, parent, child]) => {
			node.selectors.set(selector, [child]);
			parent.append(child);
		});
	}
	return node;
}

globalThis.e_ = ({outer}) => makeElement(outer);
globalThis.window = {
	addEventListener () {},
	location: {search: ""},
	matchMedia: () => ({matches: false, addEventListener () {}}),
};
globalThis.document = {
	addEventListener () {},
	querySelector: () => null,
	querySelectorAll: () => [],
	getElementById: () => null,
	body: {classList: {add () {}, remove () {}}},
};

await import("../../../js/charactersheet/charactersheet.js");
const CharacterSheetPage = globalThis.CharacterSheetPage;

afterAll(() => {
	globalThis.e_ = originalE;
	globalThis.window = originalWindow;
	globalThis.document = originalDocument;
});

function renderLore (...skills) {
	const page = Object.create(CharacterSheetPage.prototype);
	page._state = new CharacterSheetState();
	skills.forEach(([name, bonus, note]) => {
		page._state.addLoreSkill(name, bonus);
		if (note) page._state.setLoreSkillNote(name, note);
	});
	page._rollSkillCheck = jest.fn();
	page._saveCurrentCharacter = jest.fn();
	page._showAddLoreSkillModal = jest.fn();
	const container = new TestElement();
	page._renderLoreSkillsSection(container, page._state.getLoreSkills());
	const section = container.children[0];
	return {
		page,
		entries: section.querySelector(".charsheet__lore-skills-list").children,
	};
}

describe("Lore skill source notes in the Skills tab", () => {
	it("edits and clears a multiline note without triggering the roll row; preserves row activation and bonus controls", () => {
		const {page, entries} = renderLore(["Heraldry", 2]);
		const [row, noteArea] = entries[0].children;
		const edit = noteArea.querySelector(".charsheet__lore-skill-note-edit");
		const input = noteArea.querySelector(".charsheet__lore-skill-note-input");
		const save = noteArea.querySelector(".charsheet__lore-skill-note-save");
		const noteText = noteArea.querySelector(".charsheet__lore-skill-note-text");

		expect(noteText.hidden).toBe(true);
		expect(edit.textContent).toBe("Add source note");
		edit.click();
		expect(TestElement.focused).toBe(input);
		input.value = "Granted by background\nStudied in a library";
		input.click();
		save.click();
		expect(page._state.getLoreSkills()[0].note).toBe(input.value);
		expect(noteText.textContent).toBe(input.value);
		expect(edit.textContent).toBe("Edit source note");
		expect(TestElement.focused).toBe(edit);
		expect(page._rollSkillCheck).not.toHaveBeenCalled();
		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(1);

		edit.click();
		input.value = "";
		save.click();
		expect(noteText.hidden).toBe(true);
		expect(page._state.getLoreSkills()[0].note).toBe("");
		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(2);

		expect(row.getAttribute("role")).toBe("button");
		expect(row.getAttribute("tabindex")).toBe("0");
		row.click();
		expect(page._rollSkillCheck).toHaveBeenCalledTimes(1);
		page._renderSkills = jest.fn();
		row.querySelectorAll(".charsheet__lore-skill-bump")[1].click();
		expect(page._state.getLoreSkills()[0].bonus).toBe(4);
		expect(page._rollSkillCheck).toHaveBeenCalledTimes(1);
		expect(page._renderSkills).toHaveBeenCalledTimes(1);
		row.querySelector(".charsheet__lore-skill-delete").click();
		expect(page._state.getLoreSkills()).toHaveLength(0);
		expect(page._rollSkillCheck).toHaveBeenCalledTimes(1);
	});

	it("cancels unsaved edits and keeps two skills' notes separate", () => {
		const {page, entries} = renderLore(["Heraldry", 2, "A family tradition"], ["Planar Geography", 4]);
		const first = entries[0].children[1];
		const second = entries[1].children[1];
		first.querySelector(".charsheet__lore-skill-note-edit").click();
		first.querySelector(".charsheet__lore-skill-note-input").value = "Uncommitted";
		first.querySelector(".charsheet__lore-skill-note-cancel").click();
		expect(page._state.getLoreSkills()[0].note).toBe("A family tradition");
		expect(first.querySelector(".charsheet__lore-skill-note-text").textContent).toBe("A family tradition");
		expect(page._saveCurrentCharacter).not.toHaveBeenCalled();

		second.querySelector(".charsheet__lore-skill-note-edit").click();
		second.querySelector(".charsheet__lore-skill-note-input").value = "Read in a book";
		second.querySelector(".charsheet__lore-skill-note-save").click();
		expect(page._state.getLoreSkills().map(s => s.note)).toEqual(["A family tradition", "Read in a book"]);
		expect(page._rollSkillCheck).not.toHaveBeenCalled();
	});

	it("renders user text as escaped name/tooltip and literal note content, not markup", () => {
		const name = "A\"><img src=x onerror=alert(1)>";
		const note = "<script>alert(2)</script>\nA & B";
		const {entries} = renderLore([name, 2, note]);
		const [row, noteArea] = entries[0].children;
		expect(row.html).not.toContain("<img");
		expect(row.html).toContain("&lt;img");
		expect(row.html).toContain("&quot;");
		expect(noteArea.html).not.toContain(note);
		expect(noteArea.querySelector(".charsheet__lore-skill-note-text").textContent).toBe(note);
		expect(noteArea.querySelector(".charsheet__lore-skill-note-edit").getAttribute("aria-label")).toContain(name);
	});
});
