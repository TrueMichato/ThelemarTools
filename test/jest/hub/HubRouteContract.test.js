import {createHubApp} from "../../../server/src/app.js";
import {MemoryHubStore} from "../../../server/src/memory-hub-store.js";

describe("hub route registration contract", () => {
	it("registers every planned API and WebSocket surface before the app becomes ready", async () => {
		const app = await createHubApp({
			store: new MemoryHubStore(),
			oauthProvider: {getAuthorizationUrl: () => "", pExchangeCode: async () => ({})},
			config: {appOrigin: "https://tools.example", cookieSecret: "x".repeat(32), csrfSecret: "y".repeat(32)},
		});
		await app.ready();
		for (const route of [
			["GET", "/api/campaigns/:campaignId"],
			["POST", "/api/campaigns/:campaignId/archive"],
			["GET", "/api/campaigns/:campaignId/context"],
			["GET", "/api/campaigns/:campaignId/dm-workspace"],
			["POST", "/api/campaigns/:campaignId/actions"],
			["POST", "/api/campaigns/:campaignId/transfers"],
			["GET", "/api/account/export"],
			["GET", "/ws/campaign/:campaignId"],
		]) {
			expect(app.hasRoute({method: route[0], url: route[1]})).toBe(true);
		}
		await app.close();
	});
});
