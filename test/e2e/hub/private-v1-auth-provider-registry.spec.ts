import {expect, test} from "@playwright/test";

const providers = [
	{slug: "github", label: "GitHub", subject: "101", handle: "hub-e2e-github"},
	{slug: "discord", label: "Discord", subject: "202", handle: "hub-e2e-discord"},
	{slug: "google", label: "Google", subject: "google-e2e-303", handle: null},
] as const;

test("publishes bounded provider metadata and accessible signed-out guidance", async ({page}) => {
	const meta = await page.request.get("/api/meta");
	expect(meta.ok()).toBe(true);
	expect(await meta.json()).toEqual(expect.objectContaining({
		protocolVersion: "3",
		capabilities: [
			"auth.provider_registry.v1",
			"campaign.active_context.v1",
		],
		authProviders: providers.map(({slug, label}) => ({
			slug,
			label,
			startPath: `/auth/${slug}/start`,
			status: "available",
		})),
	}));

	await page.goto("/hub.html");
	const signInGroup = page.getByRole("group", {name: "Sign-in providers"});
	await expect(signInGroup).toBeVisible();
	for (const provider of providers) {
		await expect(signInGroup.getByRole("link", {name: `Sign in with ${provider.label}`})).toBeVisible();
	}
	await expect(page.getByText(/Using an unlinked provider creates a separate account/)).toBeVisible();
});

for (const provider of providers) {
	test(`${provider.label} sign-in uses the durable provider registry through the real stack`, async ({page}) => {
		const returnPath = `/hub.html?provider=${provider.slug}#auth-return`;
		await page.goto(returnPath);
		const link = page.getByRole("link", {name: `Sign in with ${provider.label}`});
		await link.focus();
		await expect(link).toBeFocused();
		await link.press("Enter");
		await page.waitForURL(`**${returnPath}`);

		const session = await page.request.get("/api/session");
		expect(session.ok()).toBe(true);
		expect(await session.json()).toEqual(expect.objectContaining({
			signedIn: true,
			account: expect.objectContaining({displayName: `Hub E2E ${provider.label}`}),
		}));
		const exported = await page.request.get("/api/account/export");
		expect(exported.ok()).toBe(true);
		const exportJson = await exported.json();
		expect(exportJson.externalIdentities).toEqual([
			expect.objectContaining({
				provider: provider.slug,
				subject: provider.subject,
				handle: provider.handle,
			}),
		]);
		expect(exportJson.sessions).toEqual([
			expect.objectContaining({authenticatedViaIdentityId: exportJson.externalIdentities[0].id}),
		]);
		expect(JSON.stringify(exportJson)).not.toMatch(/access.?token|refresh.?token|id.?token|code|state|pkce|nonce|email/i);

		await page.locator("#hub-logout").click();
		await page.waitForURL(/\/hub\.html$/);
		await expect(page.getByRole("group", {name: "Sign-in providers"})).toBeVisible();
		expect((await page.request.get("/api/session")).json()).resolves.toEqual({signedIn: false});
	});
}
