import {validateCampaignBrewBundle} from "../../../server/src/campaign-content.js";
import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

describe("hub performance budgets", () => {
	it("rejects campaign brew above one megabyte", () => {
		const huge = [{
			head: {filename: "huge.json"},
			body: {
				_meta: {sources: [{json: "BIG"}]},
				spell: [{name: "Large", source: "BIG", entries: ["x".repeat(1024 * 1024)]}],
			},
		}];
		expect(() => validateCampaignBrewBundle(huge)).toThrow(expect.objectContaining({code: "BREW_TOO_LARGE"}));
	});

	it("rejects HTTP bodies above two megabytes before route handling", async () => {
		const app = await createHubApp({
			store: new MemoryHubStore(),
			oauthProvider: {getAuthorizationUrl: () => "", pExchangeCode: async () => ({})},
			config: {appOrigin: "https://tools.example", cookieSecret: "x".repeat(32), csrfSecret: "y".repeat(32)},
		});
		const response = await app.inject({
			method: "POST",
			url: "/api/campaigns",
			headers: {"content-type": "application/json"},
			payload: JSON.stringify({name: "x".repeat(2 * 1024 * 1024 + 1)}),
		});
		expect(response.statusCode).toBe(413);
		await app.close();
	});
});
