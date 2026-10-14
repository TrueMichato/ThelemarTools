import {jest} from "@jest/globals";
import fs from "node:fs";

const spawnSync = jest.fn();
jest.unstable_mockModule("node:child_process", () => ({spawnSync}));
jest.unstable_mockModule("../../scripts/hooks/lib-staged-files.mjs", () => ({
	REPO_ROOT: process.cwd(),
	getStagedFiles: () => ["js/hub/hub-capabilities.js"],
	filterExisting: files => files,
	classifyFiles: files => ({js: files, tgttFilterTouched: false}),
}));

describe("Git hook Jest invocation", () => {
	let exit;
	let log;
	let readFileSync;

	beforeEach(() => {
		jest.resetModules();
		spawnSync.mockReset().mockImplementation((command, args) => ({
			status: command === "git" && args.includes("add") ? 1 : 0,
			stderr: "",
		}));
		exit = jest.spyOn(process, "exit").mockImplementation(() => {});
		log = jest.spyOn(console, "log").mockImplementation(() => {});
		const originalRead = fs.readFileSync;
		readFileSync = jest.spyOn(fs, "readFileSync").mockImplementation((file, ...args) =>
			file === 0 ? "" : originalRead(file, ...args));
	});

	afterEach(() => {
		readFileSync.mockRestore();
		log.mockRestore();
		exit.mockRestore();
	});

	it("keeps related tests and their failures while exiting after open-handle suites", async () => {
		spawnSync.mockReturnValue({status: 1});
		await import("../../scripts/hooks/run-related-jest.mjs");
		expect(spawnSync).toHaveBeenCalledTimes(1);
		const [, args] = spawnSync.mock.calls[0];
		expect(args).toEqual(expect.arrayContaining([
			"--forceExit", "--no-coverage", "--bail", "--findRelatedTests",
		]));
		expect(exit).toHaveBeenCalledWith(1);
	});

	it("keeps the full pre-push suite while exiting after open-handle suites", async () => {
		await import("../../scripts/hooks/run-prepush.mjs");
		const jestInvocation = spawnSync.mock.calls.find(([command, args]) =>
			command === "npm" && args.includes("test:unit"));
		expect(jestInvocation).toBeDefined();
		expect(jestInvocation[1]).toEqual(["run", "test:unit", "--", "--no-coverage", "--forceExit"]);
	});
});
