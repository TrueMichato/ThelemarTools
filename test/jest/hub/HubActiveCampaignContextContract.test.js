import fs from "node:fs";

const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("device-scoped active campaign context contract", () => {
	const adr = read("docs/hub/adr/0013-device-scoped-active-campaign-context.md");
	const adrCompact = adr.replace(/\s+/g, " ");
	const campaignContext = read("js/hub/hub-campaign-context.js");
	const brewContext = read("js/hub/hub-brew-context.js");
	const realtimeClient = read("js/hub/hub-realtime-client.js");
	const hubPage = read("js/hub/hub-page.js");
	const characterSheet = read("js/charactersheet/charactersheet.js");
	const dmScreen = read("js/dmscreen.js");
	const dmController = read("js/dmscreen/dmscreen-hub-controller.js");
	const routePolicy = read("js/hub/hub-route-policy.js");

	it("records an accepted, implementation-pending decision with every required contract surface", () => {
		expect(adr).toMatch(/^Status: Accepted contract; production implementation pending$/m);
		for (const heading of [
			"## Persistence contract",
			"## Context precedence",
			"## URL and navigation contract",
			"## State machine",
			"## Startup and API sequence",
			"## Mandatory switching and teardown order",
			"## Same-browser synchronization",
			"## Rules and brew application",
			"## Cache and offline behavior",
			"## Failure and recovery contract",
			"## Observability",
			"## Performance budget",
			"## Acceptance tests",
		]) expect(adr).toContain(heading);
		expect(adr).toContain("ADR 0011");
	});

	it("defines account-bound device persistence and deterministic same-browser convergence", () => {
		for (const value of [
			"`hub.activeCampaign.v1`",
			"`accountId`",
			"`campaignId`",
			"`revision`",
			"`updatedAt`",
			"`writerId`",
			"`BroadcastChannel`",
			"`storage` event",
			"`hub:active-campaign:v1`",
			"not synchronized between devices",
		]) expect(adr).toContain(value);
		expect(adrCompact).toContain("records larger than 1 KiB are removed");
		expect(adrCompact).toContain("different `account.id` treats the stored record as no selection");
	});

	it("requires durable ordering and restart-safe repair for concurrent selection races", () => {
		for (const value of [
			"ordered tombstone",
			"`hub:active-campaign-write:v1`",
			"compare-and-repair protocol",
			"full `revision` / state precedence / `updatedAt` / `writerId` ordering tuple",
			"write the exact winning record back without incrementing its revision",
			"convergence **and durable convergence**",
			"restart cannot resurrect that campaign",
		]) expect(adrCompact).toContain(value);
		expect(adr).toContain("A valid selection or clear is never represented by `localStorage.removeItem()`.");
		expect(adrCompact).toContain("Records are comparable only when their `accountId` matches.");
		expect(adrCompact).toContain("At the same revision, `cleared` beats `selected`.");
		expect(adrCompact).toContain("Equal-revision select/select races must converge in memory and durable storage; after both tabs close, a new coordinator must recover the same ordered winner.");
		expect(adrCompact).toContain("Equal-revision select/clear races must converge in memory and durable storage with the clear tombstone as the ordered winner.");
		expect(adrCompact).toContain("Closing every tab and restarting must remain cleared; the losing selection must not resurrect.");
	});

	it("keeps explicit/resource URL context ahead of persisted selection without unsafe fallback", () => {
		const resourceIx = adr.indexOf("Authoritative campaign of the requested cloud resource");
		const explicitIx = adr.indexOf("Explicit page URL");
		const persistedIx = adr.indexOf("Account-matching persisted selection");
		const localIx = adr.indexOf("No candidate");
		expect(resourceIx).toBeGreaterThan(-1);
		expect(resourceIx).toBeLessThan(explicitIx);
		expect(explicitIx).toBeLessThan(persistedIx);
		expect(persistedIx).toBeLessThan(localIx);
		expect(adrCompact).toContain("must not fall through to a different persisted campaign");

		expect(hubPage).toContain("new URLSearchParams(window.location.search).get(\"id\")");
		expect(characterSheet).toContain("hubParams.get(\"hubCampaign\")");
		expect(dmScreen).toContain("new URLSearchParams(window.location.search).get(\"hubCampaign\")");
	});

	it("anchors activation and teardown in the existing context owners", () => {
		expect(campaignContext).toContain("new HubBrewContext");
		expect(campaignContext).toContain("await this._api.pGetSession()");
		expect(campaignContext).toContain("await this._api.pGetCampaignContext");
		expect(brewContext).toContain("setBrewTemporary");
		expect(brewContext).toContain("clearBrewTemporary");
		expect(realtimeClient).toContain("close ()");
		expect(dmController).toContain("detach ()");
		expect(dmController).toContain("type: \"hubCharacterProjections\"");

		const markers = [
			"`teardown-generation`",
			"`teardown-realtime`",
			"`teardown-projections`",
			"`teardown-rules`",
			"`teardown-brew`",
			"`activate-next`",
		];
		const positions = markers.map(marker => adr.indexOf(marker));
		expect(positions.every(position => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it("keeps context activation ahead of heavy Character Sheet and DM Screen startup", () => {
		const characterActivate = characterSheet.indexOf("this._hubCampaignContext.pActivate()");
		const characterData = characterSheet.indexOf("await this._pLoadData()");
		expect(characterActivate).toBeGreaterThan(-1);
		expect(characterActivate).toBeLessThan(characterData);

		const dmActivate = dmScreen.indexOf("new HubCampaignContext({campaignId, api}).pActivate()");
		const dmBoard = dmScreen.indexOf("new Board({workspaceRepository})");
		const dmRealtime = dmScreen.indexOf("new HubRealtimeClient({campaignId})");
		expect(dmActivate).toBeGreaterThan(-1);
		expect(dmActivate).toBeLessThan(dmBoard);
		expect(dmBoard).toBeLessThan(dmRealtime);
	});

	it.each(["hub.html", "campaign.html"])("preserves the lightweight %s boot graph", page => {
		const html = read(page);
		const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(([, src]) => src);
		expect(scripts).toEqual([
			"js/styleswitch.js",
			"js/hub/hub-page.js",
		]);
		for (const forbidden of [
			"navigation.js",
			"utils-dataloader",
			"utils-brew",
			"render.js",
			"filter.js",
			"omnisearch",
		]) expect(html).not.toContain(forbidden);
		expect(adrCompact).toContain("They MUST NOT load `navigation.js`, `BrewUtil2`, renderer, filter, search, font, or general data-loader");
	});

	it("keeps authenticated context and Hub shells network-only while preserving heavy-page local mode", () => {
		for (const path of [
			"\"/api\"",
			"\"/auth\"",
			"\"/campaign.html\"",
			"\"/hub.html\"",
			"\"/js/hub/\"",
		]) expect(routePolicy).toContain(path);
		expect(adr).toContain("`NetworkOnly`");
		expect(adrCompact).toContain("cold/reloaded offline page enters `offline_unverified`");
		expect(adrCompact).toContain("Ordinary heavy static pages may still load from their existing precache in local mode.");
	});

	it("sets measurable privacy, propagation, request, and dependency budgets", () => {
		for (const budget of [
			"<=1 KiB",
			"<=10 ms p95",
			"<=250 ms p95",
			"no duplicate `GET /api/session`",
			"<=8 KiB minified + gzip",
			"Exactly `js/styleswitch.js` and `js/hub/hub-page.js`",
			"<=500 ms p95",
		]) expect(adr).toContain(budget);
		expect(adrCompact).toContain("Campaign id must not be a metric label.");
		expect(adrCompact).toContain("campaign/account ids, names, URLs, rules, brew, characters, workspace data, cookies, and tokens are not telemetry fields");
	});
});
