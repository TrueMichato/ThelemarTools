import "./setup.js";
import {jest} from "@jest/globals";

let CharacterSheetPage;
let previousWindow;
let previousToast;

beforeAll(async () => {
	previousWindow = globalThis.window;
	globalThis.window = {addEventListener: () => {}, location: {search: ""}};
	({CharacterSheetPage} = await import("../../../js/charactersheet/charactersheet.js"));
});

beforeEach(() => {
	previousToast = globalThis.JqueryUtil.doToast;
	globalThis.JqueryUtil.doToast = jest.fn();
	globalThis.window.location.href = "https://tools.example/charactersheet.html?local=1&localAction=create#sheet";
	globalThis.window.history = {state: {retained: true}, replaceState: jest.fn()};
});

afterEach(() => { globalThis.JqueryUtil.doToast = previousToast; });
afterAll(() => { globalThis.window = previousWindow; });

function makePage () {
	const page = new CharacterSheetPage({characterRepository: {}});
	page._onNewCharacter = jest.fn(async () => {});
	page._export = {_showImportDialog: jest.fn(async () => {})};
	return page;
}

describe("explicit local character entry", () => {
	it.each(["create", "import"])("delegates %s to the existing controller and consumes only the one-shot action", async action => {
		const page = makePage();
		await page._pHandleLocalActionUrl(new URLSearchParams({local: "1", localAction: action}));
		expect(page._onNewCharacter).toHaveBeenCalledTimes(action === "create" ? 1 : 0);
		expect(page._export._showImportDialog).toHaveBeenCalledTimes(action === "import" ? 1 : 0);
		expect(window.history.replaceState).toHaveBeenCalledWith({retained: true}, "", "/charactersheet.html?local=1#sheet");
		expect(JqueryUtil.doToast).not.toHaveBeenCalled();
	});

	it.each([false, true])("refuses the action outside explicit local authority (cloud=%s)", async isCloud => {
		const page = makePage();
		page._isHubCharacter = isCloud;
		await page._pHandleLocalActionUrl(new URLSearchParams(isCloud ? "local=1&localAction=create" : "localAction=create"));
		expect(page._onNewCharacter).not.toHaveBeenCalled();
		expect(page._export._showImportDialog).not.toHaveBeenCalled();
		expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({type: "warning", content: expect.stringContaining("campaign character is unchanged")}));
	});

	it("reports unsupported actions without invoking a character mutation", async () => {
		const page = makePage();
		await page._pHandleLocalActionUrl(new URLSearchParams("local=1&localAction=award"));
		expect(page._onNewCharacter).not.toHaveBeenCalled();
		expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({type: "warning", content: expect.stringContaining("not supported")}));
	});

	it("leaves ordinary routes and history untouched", async () => {
		const page = makePage();
		await page._pHandleLocalActionUrl(new URLSearchParams("local=1"));
		expect(window.history.replaceState).not.toHaveBeenCalled();
		expect(page._onNewCharacter).not.toHaveBeenCalled();
	});

	it("reports controller errors rather than silently succeeding", async () => {
		const page = makePage();
		const error = new Error("Local storage unavailable");
		page._onNewCharacter.mockRejectedValue(error);
		const log = jest.spyOn(console, "error").mockImplementation(() => {});
		try {
			await page._pHandleLocalActionUrl(new URLSearchParams("local=1&localAction=create"));
			expect(log).toHaveBeenCalledWith("[CharSheet Local Entry]", error);
			expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({type: "danger"}));
		} finally {
			log.mockRestore();
		}
	});
});
