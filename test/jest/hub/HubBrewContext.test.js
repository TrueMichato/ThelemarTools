import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/render.js";
import {jest} from "@jest/globals";
import {BrewUtil2Base} from "../../../js/utils-brew/utils-brew-base.js";
import {BrewDocContentMigrator} from "../../../js/utils-brew/utils-brew-content-migrator.js";
import {HubBrewContext} from "../../../js/hub/hub-brew-context.js";

const getBrewDoc = ({filename, source, spellName}) => ({
	head: {filename},
	body: {
		_meta: {sources: [{json: source, abbreviation: source, full: source}]},
		spell: [{name: spellName, source, level: 1}],
	},
});

const getNames = processed => (processed.spell || []).map(it => it.name).sort();

describe("campaign brew context", () => {
	let brew;
	let context;
	let setSpy;
	let isMigratorInit;

	beforeAll(() => {
		isMigratorInit = BrewDocContentMigrator._IS_INIT;
		BrewDocContentMigrator._IS_INIT = true;
	});

	afterAll(() => BrewDocContentMigrator._IS_INIT = isMigratorInit);

	beforeEach(() => {
		brew = new BrewUtil2Base();
		brew.pGetBrew = async () => [getBrewDoc({filename: "personal.json", source: "PERS", spellName: "Personal Spell"})];
		setSpy = jest.spyOn(brew, "pSetBrew");
		context = new HubBrewContext({brewUtil: brew});
	});

	afterEach(() => setSpy.mockRestore());

	it("layers campaign brew over personal brew without persisting it", async () => {
		context.activate({
			campaignId: "campaign-a",
			bundleHash: "hash-a",
			brewDocs: [getBrewDoc({filename: "a.json", source: "CMPA", spellName: "Campaign A Spell"})],
		});

		expect(getNames(await brew.pGetBrewProcessed())).toEqual(["Campaign A Spell", "Personal Spell"]);
		expect(setSpy).not.toHaveBeenCalled();
	});

	it("invalidates processed brew when the active bundle changes", async () => {
		context.activate({
			campaignId: "campaign-a",
			bundleHash: "hash-a",
			brewDocs: [getBrewDoc({filename: "a.json", source: "CMPA", spellName: "Campaign A Spell"})],
		});
		await brew.pGetBrewProcessed();
		const iteration = brew.getCacheIteration();

		context.activate({
			campaignId: "campaign-b",
			bundleHash: "hash-b",
			brewDocs: [getBrewDoc({filename: "b.json", source: "CMPB", spellName: "Campaign B Spell"})],
		});

		expect(getNames(await brew.pGetBrewProcessed())).toEqual(["Campaign B Spell", "Personal Spell"]);
		expect(brew.getCacheIteration()).toBe(iteration + 1);
		expect(setSpy).not.toHaveBeenCalled();
	});

	it("does not invalidate an already-active immutable bundle", async () => {
		const args = {
			campaignId: "campaign-a",
			bundleHash: "hash-a",
			brewDocs: [getBrewDoc({filename: "a.json", source: "CMPA", spellName: "Campaign A Spell"})],
		};
		expect(context.activate(args)).toBe(true);
		await brew.pGetBrewProcessed();
		const iteration = brew.getCacheIteration();

		expect(context.activate(args)).toBe(false);
		expect(brew.getCacheIteration()).toBe(iteration);
	});

	it("clears only the temporary overlay", async () => {
		context.activate({
			campaignId: "campaign-a",
			bundleHash: "hash-a",
			brewDocs: [getBrewDoc({filename: "a.json", source: "CMPA", spellName: "Campaign A Spell"})],
		});
		await brew.pGetBrewProcessed();

		context.clear();

		expect(getNames(await brew.pGetBrewProcessed())).toEqual(["Personal Spell"]);
		expect(context.getActiveContext()).toBeNull();
		expect(setSpy).not.toHaveBeenCalled();
	});

	it("keeps separate page contexts independent", async () => {
		const brewOther = new BrewUtil2Base();
		brewOther.pGetBrew = async () => [getBrewDoc({filename: "personal.json", source: "PERS", spellName: "Personal Spell"})];
		const contextOther = new HubBrewContext({brewUtil: brewOther});

		context.activate({
			campaignId: "campaign-a",
			bundleHash: "hash-a",
			brewDocs: [getBrewDoc({filename: "a.json", source: "CMPA", spellName: "Campaign A Spell"})],
		});
		contextOther.activate({
			campaignId: "campaign-b",
			bundleHash: "hash-b",
			brewDocs: [getBrewDoc({filename: "b.json", source: "CMPB", spellName: "Campaign B Spell"})],
		});

		expect(getNames(await brew.pGetBrewProcessed())).toEqual(["Campaign A Spell", "Personal Spell"]);
		expect(getNames(await brewOther.pGetBrewProcessed())).toEqual(["Campaign B Spell", "Personal Spell"]);
	});

	it("rejects campaign blocklists which would persist after the overlay is cleared", () => {
		expect(() => context.activate({
			campaignId: "campaign-a",
			bundleHash: "hash-a",
			brewDocs: [{
				head: {filename: "blocked.json"},
				body: {blocklist: [{displayName: "Persistent exclusion"}]},
			}],
		})).toThrow("cannot contain persistent blocklists");
	});

	it("discards in-flight processed content after a campaign switch", async () => {
		let doReleaseFirst;
		let doNotifyFirstStarted;
		const pFirstStarted = new Promise(resolve => doNotifyFirstStarted = resolve);
		let cntCalls = 0;
		const originalMetaMerge = DataUtil.pDoMetaMerge;
		DataUtil.pDoMetaMerge = jest.fn(async (id, data) => {
			if (++cntCalls === 1) {
				doNotifyFirstStarted();
				await new Promise(resolve => doReleaseFirst = resolve);
			}
			return data;
		});
		try {
			context.activate({
				campaignId: "campaign-a",
				bundleHash: "hash-a",
				brewDocs: [getBrewDoc({filename: "a.json", source: "CMPA", spellName: "Campaign A Spell"})],
			});
			const pProcessed = brew.pGetBrewProcessed();
			await pFirstStarted;

			context.activate({
				campaignId: "campaign-b",
				bundleHash: "hash-b",
				brewDocs: [getBrewDoc({filename: "b.json", source: "CMPB", spellName: "Campaign B Spell"})],
			});
			doReleaseFirst();

			expect(getNames(await pProcessed)).toEqual(["Campaign B Spell", "Personal Spell"]);
			expect(cntCalls).toBe(2);
		} finally {
			DataUtil.pDoMetaMerge = originalMetaMerge;
		}
	});
});
