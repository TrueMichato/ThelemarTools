import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";

const originalGlobals = {
	window: globalThis.window,
	document: globalThis.document,
	PrereleaseUtil: globalThis.PrereleaseUtil,
	BrewUtil2: globalThis.BrewUtil2,
	ExcludeUtil: globalThis.ExcludeUtil,
};

let EncounterWorkspacePage;

const getElements = () => {
	const elements = new Map();
	return {
		elements,
		document: {
			getElementById: id => {
				if (!elements.has(id)) {
					elements.set(id, {
						addEventListener: jest.fn(),
						setAttribute: jest.fn(),
						classList: {add: jest.fn(), remove: jest.fn()},
						replaceChildren: jest.fn(),
						options: [],
						value: "",
						disabled: false,
						textContent: "",
					});
				}
				return elements.get(id);
			},
		},
	};
};

beforeAll(async () => {
	globalThis.window = {addEventListener: jest.fn()};
	({EncounterWorkspacePage} = await import("../../js/encounterworkspace.js"));
});

afterAll(() => {
	Object.entries(originalGlobals).forEach(([key, value]) => globalThis[key] = value);
});

beforeEach(() => {
	globalThis.PrereleaseUtil = {pInit: jest.fn(async () => {})};
	globalThis.BrewUtil2 = {pInit: jest.fn(async () => {})};
	globalThis.ExcludeUtil = {pInitialise: jest.fn(async () => {})};
});

describe("Encounter Workspace initialization failures", () => {
	it("keeps Bestiary import enabled and reports fallback when optional references fail", async () => {
		const {elements, document} = getElements();
		globalThis.document = document;
		const page = new EncounterWorkspacePage({
			store: {pLoad: jest.fn(async () => ({version: 2, sourceList: null, instances: [], selectedIds: [], omissions: []}))},
			pGetReferenceData: jest.fn(async () => { throw new Error("Definitions offline"); }),
		});
		await page.pInit();

		expect(elements.get("ew-choose").disabled).toBe(false);
		expect(elements.get("ew-status").textContent).toMatch(/Condition and skill reference data could not be loaded: Definitions offline/);
		expect(elements.get("ew-status").textContent).toMatch(/still choose a saved Bestiary list/);
		expect(elements.get("ew-status").setAttribute).toHaveBeenCalledWith("role", "alert");
		expect(page._referenceData.conditions.length).toBeGreaterThan(0);
		expect(page._isBusy).toBe(false);
	});

	it("disables import only when Bestiary sources fail, while loading the existing workspace", async () => {
		const {elements, document} = getElements();
		globalThis.document = document;
		globalThis.PrereleaseUtil.pInit.mockRejectedValue(new Error("Bestiary offline"));
		const pGetReferenceData = jest.fn();
		const pLoad = jest.fn(async () => ({version: 2, sourceList: null, instances: [], selectedIds: [], omissions: []}));
		const page = new EncounterWorkspacePage({store: {pLoad}, pGetReferenceData});
		await page.pInit();

		expect(elements.get("ew-choose").disabled).toBe(true);
		expect(elements.get("ew-status").textContent).toMatch(/Bestiary sources could not be initialized: Bestiary offline/);
		expect(elements.get("ew-status").textContent).toMatch(/Importing another list is disabled/);
		expect(pGetReferenceData).not.toHaveBeenCalled();
		expect(pLoad).toHaveBeenCalledTimes(1);
	});

	it("does not hide an unreadable save behind a reference-data failure", async () => {
		const {elements, document} = getElements();
		globalThis.document = document;
		const page = new EncounterWorkspacePage({
			store: {pLoad: jest.fn(async () => { throw new Error("Encounter storage damaged"); })},
			pGetReferenceData: jest.fn(async () => { throw new Error("Definitions offline"); }),
		});
		await page.pInit();

		expect(elements.get("ew-choose").disabled).toBe(false);
		expect(elements.get("ew-status").textContent).toMatch(/Condition and skill reference data could not be loaded/);
		expect(elements.get("ew-status").textContent).toMatch(/saved encounter also could not be opened; choose a saved list to replace it/);
		expect(page._hasUnreadableSave).toBe(true);
	});
});
