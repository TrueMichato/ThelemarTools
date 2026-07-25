import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import {jest} from "@jest/globals";
import {BrewUtil2Base} from "../../js/utils-brew/utils-brew-base.js";

// Regression coverage for "Update All" dying when a single brew URL 404s.
// `_pPullAllBrews_` must update the healthy brews, leave the failed brew untouched, and report it.
describe("BrewUtil2Base._pPullAllBrews_ — tolerant pull-all", () => {
	let originalLoadRawJson;

	const mkBrew = ({docIdLocal, url, dateLastModified, full}) => ({
		head: {docIdLocal, url, isEditable: false},
		body: {_meta: {dateLastModified, sources: [{full}]}},
	});

	const mkBrewUtil = ({brewsCur, pSetBrew}) => {
		const brew = new BrewUtil2Base();
		brew._pGetBrewRaw = async () => brewsCur;
		brew.pSetBrew = pSetBrew;
		return brew;
	};

	beforeEach(() => {
		originalLoadRawJson = DataUtil.loadRawJSON;
	});

	afterEach(() => {
		DataUtil.loadRawJSON = originalLoadRawJson;
	});

	it("updates the healthy brew and reports the failed one without aborting", async () => {
		const brewGood = mkBrew({docIdLocal: "good", url: "https://example.com/good.json", dateLastModified: 100, full: "Good Source"});
		const brewBad = mkBrew({docIdLocal: "bad", url: "https://example.com/bad.json", dateLastModified: 100, full: "Bad Source"});

		const pSetBrew = jest.fn(async () => {});
		const brewUtil = mkBrewUtil({brewsCur: [brewGood, brewBad], pSetBrew});

		DataUtil.loadRawJSON = jest.fn(async url => {
			if (url === "https://example.com/good.json") return {_meta: {dateLastModified: 200, sources: [{full: "Good Source"}]}};
			if (url === "https://example.com/bad.json") throw new Error("404 Not Found");
			throw new Error(`Unexpected URL "${url}"`);
		});

		const {brewDocsUpdated, failedBrews} = await brewUtil._pPullAllBrews_({lockToken: "TOKEN"});

		// The pull is performed silently (so it can't schedule an uncaught global throw) and cache-busted
		expect(DataUtil.loadRawJSON).toHaveBeenCalledWith("https://example.com/good.json", {isBustCache: true, isSilent: true});
		expect(DataUtil.loadRawJSON).toHaveBeenCalledWith("https://example.com/bad.json", {isBustCache: true, isSilent: true});

		// Healthy brew updated
		expect(brewDocsUpdated).toHaveLength(1);
		expect(brewDocsUpdated[0].body._meta.dateLastModified).toBe(200);

		// Failed brew reported, not thrown
		expect(failedBrews).toHaveLength(1);
		expect(failedBrews[0].url).toBe("https://example.com/bad.json");
		expect(failedBrews[0].error).toEqual(expect.objectContaining({message: "404 Not Found"}));

		// Persistence happened, and no `undefined` slipped into the persisted array
		expect(pSetBrew).toHaveBeenCalledTimes(1);
		const [brewsNxt] = pSetBrew.mock.calls[0];
		expect(brewsNxt).toHaveLength(2);
		expect(brewsNxt.every(b => b != null)).toBe(true);

		// Failed brew left unchanged in the persisted set
		const persistedBad = brewsNxt.find(b => b.head.docIdLocal === "bad");
		expect(persistedBad.body._meta.dateLastModified).toBe(100);
		const persistedGood = brewsNxt.find(b => b.head.docIdLocal === "good");
		expect(persistedGood.body._meta.dateLastModified).toBe(200);
	});

	it("does NOT swallow internal (conversion) errors — only download failures are tolerated", async () => {
		const brew = mkBrew({docIdLocal: "circular", url: "https://example.com/circular.json", dateLastModified: 100, full: "Circular"});

		const pSetBrew = jest.fn(async () => {});
		const brewUtil = mkBrewUtil({brewsCur: [brew], pSetBrew});

		// Newer remote (so conversion is attempted) whose body is circular -> BrewDoc.mutUpdate's
		//   JSON.stringify throws. That happens OUTSIDE the download try/catch, so it must reject.
		DataUtil.loadRawJSON = async () => {
			const json = {_meta: {dateLastModified: 999}};
			json.self = json;
			return json;
		};

		await expect(brewUtil._pPullAllBrews_({lockToken: "TOKEN"})).rejects.toThrow();
	});

	it("does not persist and reports all failures when every brew fails", async () => {
		const brewA = mkBrew({docIdLocal: "a", url: "https://example.com/a.json", dateLastModified: 100, full: "A"});
		const brewB = mkBrew({docIdLocal: "b", url: "https://example.com/b.json", dateLastModified: 100, full: "B"});

		const pSetBrew = jest.fn(async () => {});
		const brewUtil = mkBrewUtil({brewsCur: [brewA, brewB], pSetBrew});

		DataUtil.loadRawJSON = async () => { throw new Error("404 Not Found"); };

		const {brewDocsUpdated, failedBrews} = await brewUtil._pPullAllBrews_({lockToken: "TOKEN"});

		expect(brewDocsUpdated).toHaveLength(0);
		expect(failedBrews).toHaveLength(2);
		expect(pSetBrew).not.toHaveBeenCalled();
	});

	it("leaves a brew unchanged when the remote is not newer", async () => {
		const brew = mkBrew({docIdLocal: "stale", url: "https://example.com/stale.json", dateLastModified: 500, full: "Stale"});

		const pSetBrew = jest.fn(async () => {});
		const brewUtil = mkBrewUtil({brewsCur: [brew], pSetBrew});

		DataUtil.loadRawJSON = async () => ({_meta: {dateLastModified: 100, sources: [{full: "Stale"}]}});

		const {brewDocsUpdated, failedBrews} = await brewUtil._pPullAllBrews_({lockToken: "TOKEN"});

		expect(brewDocsUpdated).toHaveLength(0);
		expect(failedBrews).toHaveLength(0);
		expect(pSetBrew).not.toHaveBeenCalled();
	});
});

describe("BrewUtil2Base.pPullAllBrews — return-shape back-compat", () => {
	const mkLockedBrewUtil = () => {
		const brew = new BrewUtil2Base();
		brew._pPullAllBrews_ = async () => ({brewDocsUpdated: [{tag: "UPDATED"}], failedBrews: [{url: "x"}]});
		return brew;
	};

	it("returns the bare array by default (external-consumer compatible)", async () => {
		const brewUtil = mkLockedBrewUtil();
		const out = await brewUtil.pPullAllBrews();
		expect(Array.isArray(out)).toBe(true);
		expect(out).toEqual([{tag: "UPDATED"}]);
	});

	it("returns {brewDocsUpdated, failedBrews} when isReturnMeta is set", async () => {
		const brewUtil = mkLockedBrewUtil();
		const out = await brewUtil.pPullAllBrews({isReturnMeta: true});
		expect(out.brewDocsUpdated).toEqual([{tag: "UPDATED"}]);
		expect(out.failedBrews).toEqual([{url: "x"}]);
	});
});

// The pull-all tolerance relies on `loadRawJSON({isSilent})` NOT scheduling an uncaught global throw.
describe("DataUtil._loadJson — isSilent + error cause", () => {
	let originalPLoad;
	let setTimeoutSpy;

	beforeEach(() => {
		originalPLoad = DataUtil._pLoad;
		setTimeoutSpy = jest.spyOn(globalThis, "setTimeout").mockImplementation(() => 0);
	});

	afterEach(() => {
		DataUtil._pLoad = originalPLoad;
		setTimeoutSpy.mockRestore();
	});

	it("suppresses the deferred global throw when isSilent, and rejects with the first error as cause", async () => {
		let n = 0;
		DataUtil._pLoad = jest.fn(async () => {
			n += 1;
			throw new Error(n === 1 ? "ERR_PROC" : "ERR_FALLBACK");
		});

		await expect(DataUtil.loadRawJSON("https://example.com/x.json", {isSilent: true}))
			.rejects.toMatchObject({message: "ERR_FALLBACK", cause: expect.objectContaining({message: "ERR_PROC"})});

		// No `setTimeout(() => { throw e; })` scheduled in silent mode
		expect(setTimeoutSpy).not.toHaveBeenCalled();
	});

	it("schedules the deferred throw when NOT silent (default behaviour preserved)", async () => {
		DataUtil._pLoad = jest.fn(async () => { throw new Error("BOOM"); });

		await expect(DataUtil.loadRawJSON("https://example.com/x.json")).rejects.toThrow("BOOM");
		expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
	});
});
