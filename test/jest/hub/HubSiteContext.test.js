import {jest} from "@jest/globals";
import {HubSiteContext} from "../../../js/hub/hub-site-context.js";
import {HubActiveCampaignChannel} from "../../../js/hub/hub-active-campaign-channel.js";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";

describe("HubSiteContext", () => {
	let previousBrewUtil;
	let storage;
	let location;
	let target;
	let document;

	beforeEach(() => {
		previousBrewUtil = globalThis.BrewUtil2;
		storage = {
			data: new Map(),
			getItem (key) { return this.data.get(key) || null; },
			setItem (key, value) { this.data.set(key, value); },
			removeItem (key) { this.data.delete(key); },
		};
		location = {
			href: `https://tools.example/spells.html?hubCampaign=${CAMPAIGN}`,
			pathname: "/spells.html",
			search: `?hubCampaign=${CAMPAIGN}`,
			reload: jest.fn(),
		};
		target = {addEventListener: jest.fn(), removeEventListener: jest.fn()};
		document = {
			documentElement: {dataset: {}},
			querySelectorAll: () => [],
		};
	});

	afterEach(() => {
		globalThis.BrewUtil2 = previousBrewUtil;
		globalThis.HubCampaignPageContext = null;
	});

	const getSite = api => new HubSiteContext({
		api,
		storage,
		location,
		target,
		document,
		channel: new HubActiveCampaignChannel({
			writerId: "55555555-5555-4555-8555-555555555555",
			fnCreateChannel: () => null,
			target,
		}),
	});

	it("installs only the temporary campaign overlay and policy metadata before becoming active", async () => {
		const calls = [];
		globalThis.BrewUtil2 = {
			setBrewTemporary: (docs, options) => {
				calls.push({type: "temporary-set", docs, options});
				return true;
			},
			clearBrewTemporary: () => {
				calls.push({type: "temporary-clear"});
				return true;
			},
			pSetBrew: jest.fn(),
			pAddBrew: jest.fn(),
		};
		const context = {
			rulesVersion: {id: "rules-1", version: 1, rules: {enableTgtt: true}},
			brewBundle: {
				id: "brew-1",
				version: 1,
				contentHash: "sha256-bundle",
				content: [{head: {docIdLocal: "campaign-doc"}, body: {spell: []}}],
			},
			sourcePolicy: {mode: "metadata-only"},
			editionPolicy: {mode: "metadata-only"},
		};
		const api = {
			pGetSession: async () => ({
				signedIn: true,
				account: {id: ACCOUNT},
				capabilities: ["campaign.active_context.v1"],
			}),
			pGetCampaign: async () => ({id: CAMPAIGN, name: "Ashen March", status: "active", role: "player"}),
			pGetCampaignContext: async () => context,
		};
		const site = getSite(api);

		await site.pInit();

		expect(site.coordinator.state).toBe("active");
		expect(calls[0]).toMatchObject({
			type: "temporary-set",
			options: {cacheKey: `${CAMPAIGN}::sha256-bundle`},
		});
		expect(globalThis.BrewUtil2.pSetBrew).not.toHaveBeenCalled();
		expect(globalThis.BrewUtil2.pAddBrew).not.toHaveBeenCalled();
		expect(globalThis.HubCampaignPageContext).toMatchObject({
			campaignId: CAMPAIGN,
			rulesVersion: {id: "rules-1"},
			sourcePolicy: {mode: "metadata-only"},
			editionPolicy: {mode: "metadata-only"},
		});

		site.dispose();
		expect(calls.at(-1)).toEqual({type: "temporary-clear"});
	});

	it("fails closed without touching brew when the capability is not advertised", async () => {
		globalThis.BrewUtil2 = {
			setBrewTemporary: jest.fn(),
			clearBrewTemporary: jest.fn(),
		};
		const api = {
			pGetSession: async () => ({signedIn: true, account: {id: ACCOUNT}, capabilities: []}),
			pGetCampaign: jest.fn(),
			pGetCampaignContext: jest.fn(),
		};
		const site = getSite(api);

		await site.pInit();

		expect(site.coordinator.state).toBe("blocked");
		expect(api.pGetCampaign).not.toHaveBeenCalled();
		expect(api.pGetCampaignContext).not.toHaveBeenCalled();
		expect(globalThis.BrewUtil2.setBrewTemporary).not.toHaveBeenCalled();
		site.dispose();
	});

	it("keeps an explicit local Character Sheet request-free", async () => {
		location.href = "https://tools.example/charactersheet.html?local=1";
		location.pathname = "/charactersheet.html";
		location.search = "?local=1";
		const main = {
			replaceChildren: jest.fn(),
			setAttribute: jest.fn(),
		};
		document.querySelectorAll = jest.fn(() => [main]);
		const api = {
			pGetSession: jest.fn(),
			pGetCampaign: jest.fn(),
			pGetCampaignContext: jest.fn(),
		};
		const site = getSite(api);

		await site.pInit();

		expect(site.coordinator.state).toBe("local");
		expect(api.pGetSession).not.toHaveBeenCalled();
		expect(api.pGetCampaign).not.toHaveBeenCalled();
		expect(api.pGetCampaignContext).not.toHaveBeenCalled();
		expect(globalThis.HubCampaignPageContext).toBeNull();
		expect(main.replaceChildren).not.toHaveBeenCalled();
		expect(document.documentElement.dataset.hubContextSwitching).toBeUndefined();
		expect(target.addEventListener.mock.calls.map(([type]) => type)).toEqual(["storage"]);
		site.dispose();
	});
});
