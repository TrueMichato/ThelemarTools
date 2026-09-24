import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/utils-ui.js";
import {jest} from "@jest/globals";
import {EncounterWorkspaceState} from "../../js/encounterworkspace/encounterworkspace-state.js";

const oldWindow = globalThis.window;
globalThis.window = {addEventListener: jest.fn()};
const {EncounterWorkspacePage} = await import("../../js/encounterworkspace.js");
globalThis.window = oldWindow;

const makePage = async () => {
	const state = await EncounterWorkspaceState.pFromSavedList({
		exportedSublist: {name: "Night Watch", saveId: "night", items: [{h: "watcher_tst"}]},
		pResolveItem: async () => ({entity: {name: "Watcher", source: "TST", hp: {average: 8}}}),
		fnUid: () => "watcher",
	});
	const page = Object.create(EncounterWorkspacePage.prototype);
	page._state = state;
	page._handoffStore = {
		pRead: jest.fn(async () => null),
		pQueue: jest.fn(async () => ({ok: true})),
		pClear: jest.fn(async () => ({ok: true})),
	};
	page._isBusy = false;
	page._setBusy = jest.fn(isBusy => page._isBusy = isBusy);
	page._setHandoffStatus = jest.fn();
	page._pRefreshHandoff = jest.fn();
	return page;
};

describe("Encounter Workspace queue controls", () => {
	let confirm;
	beforeEach(() => confirm = jest.spyOn(InputUiUtil, "pGetUserBoolean").mockResolvedValue(true));
	afterEach(() => confirm.mockRestore());

	it("does not queue missing initiative, and sends copies without saving or mutating the source", async () => {
		const page = await makePage();
		const before = structuredClone(page._state);
		await page._pQueueHandoff();
		expect(page._handoffStore.pQueue).not.toHaveBeenCalled();
		expect(page._setHandoffStatus).toHaveBeenCalledWith(expect.stringContaining("Watcher #1"), {isError: true});
		page._state.instances[0].initiative = 12;
		await page._pQueueHandoff();
		expect(page._handoffStore.pQueue).toHaveBeenCalledWith(expect.objectContaining({
			snapshot: expect.objectContaining({entries: [expect.objectContaining({alias: "Watcher #1", initiative: 12})]}),
		}));
		expect(page._state).toEqual({...before, instances: [{...before.instances[0], initiative: 12}]});
	});

	it("reports replacement cancellation and storage failure without claiming success", async () => {
		const page = await makePage();
		page._state.instances[0].initiative = 12;
		page._handoffStore.pQueue.mockImplementationOnce(async ({pConfirmReplace}) => {
			confirm.mockResolvedValueOnce(false);
			return await pConfirmReplace({id: "old"}) ? {ok: true} : {ok: false, reason: "cancelled"};
		});
		await page._pQueueHandoff();
		expect(page._setHandoffStatus).toHaveBeenCalledWith(expect.stringContaining("nothing was replaced"));
		page._handoffStore.pQueue.mockRejectedValueOnce(new Error("Storage full"));
		await page._pQueueHandoff();
		expect(page._setHandoffStatus).toHaveBeenCalledWith(expect.stringContaining("Storage full"), {isError: true});
	});

	it("requires confirmation to clear and fences changed pending IDs", async () => {
		const page = await makePage();
		page._pendingHandoff = {id: "old"};
		page._handoffStore.pRead.mockResolvedValue({id: "new"});
		await page._pClearHandoff();
		expect(confirm).not.toHaveBeenCalled();
		expect(page._handoffStore.pClear).not.toHaveBeenCalled();
		page._handoffStore.pRead.mockResolvedValue({id: "old"});
		confirm.mockResolvedValueOnce(false);
		await page._pClearHandoff();
		expect(page._handoffStore.pClear).not.toHaveBeenCalled();
		await page._pClearHandoff();
		expect(page._handoffStore.pClear).toHaveBeenCalledWith({expectedId: "old"});
	});
});
