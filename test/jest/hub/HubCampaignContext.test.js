import {HubCampaignContext} from "../../../js/hub/hub-campaign-context.js";

const CAMPAIGN_A = "33333333-3333-4333-8333-333333333333";

function makeBrewUtil () {
	const calls = [];
	return {
		calls,
		setBrewTemporary: (docs, {cacheKey}) => { calls.push({name: "set", cacheKey, count: docs.length}); return true; },
		clearBrewTemporary: () => { calls.push({name: "clear"}); return true; },
	};
}

function makeApi () {
	const calls = [];
	return {
		calls,
		countOf: name => calls.filter(call => call === name).length,
		pGetSession: async () => { calls.push("session"); return {signedIn: true, account: {id: "a"}}; },
		pGetCampaignContext: async () => { calls.push("context"); return {rulesVersion: {rules: {}}, brewBundle: null}; },
	};
}

const bundleContext = {
	rulesVersion: {rules: {variantEncumbrance: true}},
	brewBundle: {contentHash: "hash-1", content: [{head: {}, body: {}}]},
};

describe("HubCampaignContext", () => {
	it("issues no request when a verified session and context are injected", async () => {
		const api = makeApi();
		const brewUtil = makeBrewUtil();
		const context = new HubCampaignContext({
			campaignId: CAMPAIGN_A,
			api,
			brewUtil,
			session: {signedIn: true, account: {id: "a"}},
			context: bundleContext,
		});

		const activated = await context.pActivate();
		expect(api.calls).toEqual([]);
		expect(activated.rulesVersion.rules).toEqual({variantEncumbrance: true});
		expect(brewUtil.calls).toEqual([{name: "set", cacheKey: `${CAMPAIGN_A}::hash-1`, count: 1}]);
	});

	it("still bootstraps its own session and context when nothing is injected", async () => {
		const api = makeApi();
		const context = new HubCampaignContext({campaignId: CAMPAIGN_A, api, brewUtil: makeBrewUtil()});
		await context.pActivate();
		expect(api.countOf("session")).toBe(1);
		expect(api.countOf("context")).toBe(1);
	});

	it("reuses an injected session but still reads the context when only the session is supplied", async () => {
		const api = makeApi();
		const context = new HubCampaignContext({
			campaignId: CAMPAIGN_A,
			api,
			brewUtil: makeBrewUtil(),
			session: {signedIn: true, account: {id: "a"}},
		});
		await context.pActivate();
		expect(api.countOf("session")).toBe(0);
		expect(api.countOf("context")).toBe(1);
	});

	it("clears the temporary overlay when the campaign has no brew bundle", async () => {
		const brewUtil = makeBrewUtil();
		const context = new HubCampaignContext({
			campaignId: CAMPAIGN_A,
			api: makeApi(),
			brewUtil,
			session: {signedIn: true, account: {id: "a"}},
			context: {rulesVersion: {rules: {}}, brewBundle: null},
		});
		await context.pActivate();
		expect(brewUtil.calls).toEqual([{name: "clear"}]);
	});

	it("refuses to activate without a signed-in session", async () => {
		const context = new HubCampaignContext({
			campaignId: CAMPAIGN_A,
			api: makeApi(),
			brewUtil: makeBrewUtil(),
			session: {signedIn: false},
		});
		await expect(context.pActivate()).rejects.toThrow(/Sign in/);
	});

	it("disposes idempotently, clearing only the campaign overlay", async () => {
		const brewUtil = makeBrewUtil();
		const context = new HubCampaignContext({
			campaignId: CAMPAIGN_A,
			api: makeApi(),
			brewUtil,
			session: {signedIn: true, account: {id: "a"}},
			context: bundleContext,
		});
		await context.pActivate();
		brewUtil.calls.length = 0;

		context.dispose();
		context.dispose();
		expect(brewUtil.calls).toEqual([{name: "clear"}, {name: "clear"}]);
		expect(context.isDisposed).toBe(true);
		expect(context.context).toBeNull();
		// A disposed context must not silently reinstall brew.
		await expect(context.pActivate()).rejects.toThrow(/disposed/);
	});

	it("does not reinstall campaign brew when an in-flight refresh resolves after disposal", async () => {
		let resolveRefresh;
		const refresh = new Promise(resolve => resolveRefresh = resolve);
		const brewUtil = makeBrewUtil();
		const context = new HubCampaignContext({
			campaignId: CAMPAIGN_A,
			api: {pGetCampaignContext: () => refresh},
			brewUtil,
			session: {signedIn: true, account: {id: "a"}},
			context: bundleContext,
		});
		await context.pActivate();
		brewUtil.calls.length = 0;

		const pending = context.pRefresh();
		context.dispose();
		resolveRefresh({
			rulesVersion: {id: "rules-2", rules: {}},
			brewBundle: {contentHash: "hash-2", content: [{head: {}, body: {new: true}}]},
		});

		await expect(pending).resolves.toBeNull();
		expect(context.context).toBeNull();
		expect(brewUtil.calls).toEqual([{name: "clear"}]);
	});
});
