import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/utils.js";
import {List, ListItem} from "../../../js/list2.js";

const makeElement = () => ({
	classList: {add: jest.fn(), remove: jest.fn()},
	remove: jest.fn(),
});

describe("ListItem lazy elements", () => {
	it("keeps viewport refresh separate from logical updates in legacy mode", () => {
		const list = new List({fnSort: null});
		const renderHook = jest.fn();
		const updated = jest.fn();
		const rendered = jest.fn();
		list._sortedItems = [{runElementRenderHooks: renderHook}];
		list.on("updated", updated);
		list.on("rendered", rendered);
		list.refreshRenderedItems();
		expect(renderHook).toHaveBeenCalledTimes(1);
		expect(rendered).toHaveBeenCalledTimes(1);
		expect(updated).not.toHaveBeenCalled();
	});

	it("registers the complete logical list without prewarming row factories", () => {
		const list = new List({fnSort: null});
		list._virtualRenderer = {onMaterialize: jest.fn()};
		const factory = jest.fn(makeElement);
		for (let i = 0; i < 1000; ++i) list.addItem(new ListItem(i, factory, `Entry ${i}`));
		list.doSelect(list.items[750]);
		expect(list.items).toHaveLength(1000);
		expect(list.items[750].isSelected).toBe(true);
		expect(factory).not.toHaveBeenCalled();
		expect(list._virtualRenderer.onMaterialize).not.toHaveBeenCalled();
	});

	it("indexes search values without calling the element factory", () => {
		const factory = jest.fn(makeElement);
		const item = new ListItem(1, factory, "Fireball", {source: "PHB", level: 3});
		expect(item.searchText).toContain("fireball");
		expect(item.searchText).toContain("phb");
		expect(item.peekEle()).toBeNull();
		expect(factory).not.toHaveBeenCalled();
		expect(item.ele).toBe(item.ele);
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("updates selection without creating off-screen elements", () => {
		const factory = jest.fn(makeElement);
		const item = new ListItem(1, factory, "Selected");
		item.isSelected = true;
		expect(item.isSelected).toBe(true);
		expect(factory).not.toHaveBeenCalled();
		expect(item.ele.classList.add).toHaveBeenCalledWith("list-multi-selected");
		item.isSelected = false;
		expect(item.ele.classList.remove).toHaveBeenCalledWith("list-multi-selected");
	});

	it("reinitializes evicted elements without losing logical selection or data", () => {
		const factory = jest.fn(makeElement);
		const item = new ListItem(1, factory, "Preview", {}, {isPreviewExpanded: true});
		const initialize = jest.fn();
		item.addElementInitializer(initialize);
		item.isSelected = true;
		const first = item.ele;
		item.disposeElement();
		expect(item.peekEle()).toBeNull();
		expect(item.data.isPreviewExpanded).toBe(true);
		expect(item.ele).not.toBe(first);
		expect(item.ele.classList.add).toHaveBeenCalledWith("list-multi-selected");
		expect(initialize).toHaveBeenCalledTimes(2);
	});

	it("immediately initializes already-created elements", () => {
		const ele = makeElement();
		const item = new ListItem(1, ele, "Legacy");
		const initialize = jest.fn();
		item.addElementInitializer(initialize);
		expect(initialize).toHaveBeenCalledWith(ele);
		item.disposeElement();
		expect(item.ele).toBe(ele);
	});

	it("only notifies materialization when a row is actually created", () => {
		const item = new ListItem(1, makeElement, "Lazy");
		const notify = jest.fn();
		item.onElementCreated = notify;
		void item.ele;
		void item.ele;
		expect(notify).toHaveBeenCalledTimes(1);
		item.disposeElement();
		void item.ele;
		expect(notify).toHaveBeenCalledTimes(2);
	});
});
