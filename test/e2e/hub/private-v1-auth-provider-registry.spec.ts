import {expect, test} from "@playwright/test";

test("GitHub sign-in uses the durable provider registry through the real stack", async ({page}) => {
	const meta = await page.request.get("/api/meta");
	expect(meta.ok()).toBe(true);
	expect(await meta.json()).toEqual(expect.objectContaining({
		protocolVersion: "3",
		capabilities: ["auth.provider_registry.v1"],
		authProviders: [{
			slug: "github",
			label: "GitHub",
			startPath: "/auth/github/start",
			status: "available",
		}],
	}));
	expect((await page.request.get("/auth/discord/start")).status()).toBe(404);

	await page.goto("/auth/github/start?returnTo=/hub.html");
	await page.waitForURL(/\/hub\.html$/);

	const session = await page.request.get("/api/session");
	expect(session.ok()).toBe(true);
	expect(await session.json()).toEqual(expect.objectContaining({
		signedIn: true,
		account: expect.objectContaining({displayName: "Hub E2E GitHub"}),
	}));
	const exported = await page.request.get("/api/account/export");
	expect(exported.ok()).toBe(true);
	const exportJson = await exported.json();
	expect(exportJson.externalIdentities).toEqual([
		expect.objectContaining({
			provider: "github",
			subject: "0",
			handle: "hub-e2e-github",
		}),
	]);
	expect(exportJson.sessions).toEqual([
		expect.objectContaining({authenticatedViaIdentityId: exportJson.externalIdentities[0].id}),
	]);
	expect(JSON.stringify(exportJson)).not.toMatch(/access.?token|refresh.?token|pkce|nonce/i);
});
