import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import {jest} from "@jest/globals";
import {BrewUtil2Base} from "../../js/utils-brew/utils-brew-base.js";

describe("local homebrew index loading", () => {
	let originalLoadJson;
	let originalLoadRawJson;
	let originalDoToast;
	let originalConsoleError;
	let originalWindow;

	beforeEach(() => {
		originalLoadJson = DataUtil.loadJSON;
		originalLoadRawJson = DataUtil.loadRawJSON;
		originalDoToast = JqueryUtil.doToast;
		originalConsoleError = console.error;
		originalWindow = globalThis.window;

		globalThis.window = {};
		JqueryUtil.doToast = jest.fn();
		console.error = jest.fn();
	});

	afterEach(() => {
		DataUtil.loadJSON = originalLoadJson;
		DataUtil.loadRawJSON = originalLoadRawJson;
		JqueryUtil.doToast = originalDoToast;
		console.error = originalConsoleError;

		if (originalWindow === undefined) delete globalThis.window;
		else globalThis.window = originalWindow;
	});

	it("keeps persisted and valid local brews when an indexed local brew fails to load", async () => {
		const persistedBrew = {head: {filename: "persisted.json"}, body: {_meta: {sources: [{json: "PERSISTED"}]}}};
		const brew = new BrewUtil2Base();
		brew._PATH_LOCAL_DIR = "homebrew";
		brew._PATH_LOCAL_INDEX = "homebrew/index.json";
		brew._pGetBrewRaw = async () => [persistedBrew];

		DataUtil.loadJSON = async url => {
			if (url === "data/generated/gendata-tag-redirects.json") return {};
			if (url === "homebrew/index.json") return {toImport: ["valid.json", "missing.json"]};
			throw new Error(`Unexpected URL "${url}"`);
		};
		DataUtil.loadRawJSON = async url => {
			if (url === "homebrew/valid.json") return {_meta: {sources: [{json: "VALID"}]}};
			if (url === "homebrew/missing.json") throw new Error("404 Not Found");
			throw new Error(`Unexpected URL "${url}"`);
		};

		const brews = await brew.pGetBrew();

		expect(brews).toHaveLength(2);
		expect(brews).toEqual(expect.arrayContaining([
			persistedBrew,
			expect.objectContaining({body: {_meta: {sources: [{json: "VALID"}]}}}),
		]));
		expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({
			type: "danger",
			content: expect.stringContaining("homebrew/missing.json"),
		}));
		expect(console.error).toHaveBeenCalledWith(
			"Failed to load local homebrew from URL \"homebrew/missing.json\":",
			expect.objectContaining({message: "404 Not Found"}),
		);
	});
});
