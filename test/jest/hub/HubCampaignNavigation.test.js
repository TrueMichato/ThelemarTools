import {HubActiveCampaignSwitcher, getCampaignAwareNavUrl} from "../../../js/hub/hub-active-campaign-switcher.js";
import {getCampaignSurfaceDefaultUrl} from "../../../js/hub/hub-surface-defaults.js";

const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const OTHER_CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const BASE = "https://tools.example/spells.html?foo=bar#hash";

describe("campaign-aware navigation", () => {
	it.each([
		["spells.html#fireball", `spells.html?hubCampaign=${CAMPAIGN}#fireball`],
		["items.html?filter=weapon#longsword", `items.html?filter=weapon&hubCampaign=${CAMPAIGN}#longsword`],
		["/bestiary.html", `/bestiary.html?hubCampaign=${CAMPAIGN}`],
	])("adds context without losing the existing query or fragment for %s", (href, expected) => {
		expect(getCampaignAwareNavUrl({href, campaignId: CAMPAIGN, baseUrl: BASE})).toBe(expected);
	});

	it.each([
		["https://other.example/spells.html", "https://other.example/spells.html"],
		["#fireball", "#fireball"],
		["campaign.html?id=abc", "campaign.html?id=abc"],
		["charactersheet.html?id=local-character", "charactersheet.html?id=local-character"],
		["charactersheet.html?hubCharacter=1&id=cloud-character", "charactersheet.html?hubCharacter=1&id=cloud-character"],
		["dmscreen.html?local=1", "dmscreen.html?local=1"],
	])("does not retarget explicit resources or non-navigation URLs for %s", (href, expected) => {
		expect(getCampaignAwareNavUrl({href, campaignId: CAMPAIGN, baseUrl: BASE})).toBe(expected);
	});

	it("removes a decorated campaign context when local mode is selected", () => {
		expect(getCampaignAwareNavUrl({
			href: `spells.html?hubCampaign=${CAMPAIGN}#fireball`,
			campaignId: null,
			baseUrl: BASE,
		})).toBe("spells.html#fireball");
	});

	it("discards an old account's campaign roster when its request resolves late", async () => {
		const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";
		let accountId = "11111111-1111-4111-8111-111111111111";
		let resolveOld;
		let resolveCurrent;
		const requests = [
			new Promise(resolve => { resolveOld = resolve; }),
			new Promise(resolve => { resolveCurrent = resolve; }),
		];
		const coordinator = {
			get accountId () { return accountId; },
			subscribe: () => () => {},
		};
		const switcher = new HubActiveCampaignSwitcher({
			coordinator,
			pListCampaigns: () => requests.shift(),
		});
		switcher._campaignsAccountId = accountId;
		const oldGeneration = ++switcher._campaignsGeneration;
		const pOld = switcher._pRefreshCampaigns({accountId, generation: oldGeneration});

		accountId = OTHER_ACCOUNT;
		switcher._handleCoordinatorSnapshot({accountId});
		resolveCurrent([{id: "campaign-current", name: "Current Account", status: "active", role: "player"}]);
		await Promise.resolve();
		resolveOld([{id: "campaign-old", name: "Old Account", status: "active", role: "player"}]);
		await pOld;

		expect(switcher._campaigns).toEqual([
			{id: "campaign-current", name: "Current Account", status: "active", role: "player"},
		]);
	});

	it.each([
		["another campaign", {state: "selected", campaignId: OTHER_CAMPAIGN}],
		["local mode", {state: "cleared", campaignId: null}],
	])("reflects a pinned runtime campaign after it is reselected from %s", (_label, initialSelection) => {
		let storedSelection = {accountId: ACCOUNT, ...initialSelection};
		const coordinator = {
			state: "switch_pending",
			accountId: ACCOUNT,
			activeCampaignId: CAMPAIGN,
			pendingCampaignId: initialSelection.campaignId,
			get storedSelection () { return storedSelection; },
		};
		const switcher = new HubActiveCampaignSwitcher({
			coordinator,
			pListCampaigns: async () => [],
		});
		expect(switcher._getSelectedValue()).toBe(initialSelection.campaignId || "__local__");

		storedSelection = {accountId: ACCOUNT, state: "selected", campaignId: CAMPAIGN};
		coordinator.state = "active";
		coordinator.pendingCampaignId = null;
		expect(switcher._getSelectedValue()).toBe(CAMPAIGN);
	});
});

describe("campaign surface defaults", () => {
	const playerCampaign = {id: CAMPAIGN, name: "Ashen March", status: "active", role: "player"};

	it("defaults a bare Character Sheet to the authorized active campaign", () => {
		expect(getCampaignSurfaceDefaultUrl({
			href: "https://tools.example/charactersheet.html",
			surface: "charactersheet",
			campaign: playerCampaign,
		})).toBe(`charactersheet.html?hubCampaign=${CAMPAIGN}`);
	});

	it("defaults a bare DM Screen only for a DM or co-DM", () => {
		expect(getCampaignSurfaceDefaultUrl({
			href: "https://tools.example/dmscreen.html",
			surface: "dmscreen",
			campaign: playerCampaign,
		})).toBeNull();
		expect(getCampaignSurfaceDefaultUrl({
			href: "https://tools.example/dmscreen.html",
			surface: "dmscreen",
			campaign: {...playerCampaign, role: "co_dm"},
		})).toBe(`dmscreen.html?hubCampaign=${CAMPAIGN}`);
	});

	it.each([
		"https://tools.example/charactersheet.html?local=1",
		"https://tools.example/charactersheet.html?id=local-character",
		"https://tools.example/charactersheet.html#saved-tab",
	])("preserves explicit local and deep-link Character Sheet routes: %s", href => {
		expect(getCampaignSurfaceDefaultUrl({href, surface: "charactersheet", campaign: playerCampaign})).toBeNull();
	});
});
