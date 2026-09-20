import {
	createPendingIdentityLinkReauthenticationIntent,
	getAccountReauthenticationReturnTo,
	resolvePendingIdentityLinkReauthenticationIntent,
} from "../../../js/hub/hub-api-client.js";

describe("Hub reauthentication controller", () => {
	it("returns to an explicit successful reauthentication marker", () => {
		expect(getAccountReauthenticationReturnTo())
			.toBe("/hub.html?accountAction=reauthenticated");
	});

	it("resolves only a fresh browser-stored link intent against current provider metadata", () => {
		const now = Date.parse("2026-09-20T20:00:00.000Z");
		const intent = createPendingIdentityLinkReauthenticationIntent({
			provider: "google",
			now,
		});
		const providers = [
			{slug: "github", label: "GitHub", status: "available"},
			{slug: "google", label: "Google", status: "available"},
		];

		expect(resolvePendingIdentityLinkReauthenticationIntent({
			rawIntent: JSON.stringify(intent),
			providers,
			linkedProviderSlugs: ["github"],
			now: now + 1_000,
		})).toEqual({
			provider: "google",
			label: "Google",
		});
		expect(resolvePendingIdentityLinkReauthenticationIntent({
			rawIntent: null,
			providers,
			linkedProviderSlugs: ["github"],
			now: now + 1_000,
		})).toBeNull();
	});

	it.each([
		["malformed", "not-json"],
		["stale", JSON.stringify({version: 1, operation: "link", provider: "google", createdAt: 0})],
		["wrong operation", JSON.stringify({version: 1, operation: "unlink", provider: "google", createdAt: Date.parse("2026-09-20T20:00:00.000Z")})],
		["unavailable provider", JSON.stringify({version: 1, operation: "link", provider: "discord", createdAt: Date.parse("2026-09-20T20:00:00.000Z")})],
		["already linked provider", JSON.stringify({version: 1, operation: "link", provider: "github", createdAt: Date.parse("2026-09-20T20:00:00.000Z")})],
	])("rejects a %s link intent", (_label, rawIntent) => {
		expect(resolvePendingIdentityLinkReauthenticationIntent({
			rawIntent,
			providers: [
				{slug: "github", label: "GitHub", status: "available"},
				{slug: "discord", label: "Discord", status: "unavailable"},
				{slug: "google", label: "Google", status: "available"},
			],
			linkedProviderSlugs: ["github"],
			now: Date.parse("2026-09-20T20:01:00.000Z"),
		})).toBeNull();
	});
});
