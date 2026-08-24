import {isHubNetworkOnlyUrl} from "../../../js/hub/hub-route-policy.js";

describe("hub service-worker route policy", () => {
	const appOrigin = "https://tools.example";

	it.each([
		"https://tools.example/api",
		"https://tools.example/api/campaigns/c1",
		"https://tools.example/auth",
		"https://tools.example/auth/callback?code=secret",
	])("keeps authenticated same-origin routes network-only: %s", url => {
		expect(isHubNetworkOnlyUrl({url, appOrigin})).toBe(true);
	});

	it.each([
		"https://tools.example/charactersheet.html",
		"https://tools.example/data/spells/spells-phb.json",
		"https://tools.example/js/hub/hub-route-policy.js",
		"https://cdn.example/api/public.json",
		"https://tools.example/apiary",
	])("does not change existing cache handling for non-hub routes: %s", url => {
		expect(isHubNetworkOnlyUrl({url, appOrigin})).toBe(false);
	});
});
