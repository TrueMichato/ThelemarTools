import {expect, test} from "@playwright/test";
import {HubCampaignPage} from "../pages/HubCampaignPage";

const providers = [
	{slug: "github", label: "GitHub", subject: "101", handle: "hub-e2e-github"},
	{slug: "discord", label: "Discord", subject: "202", handle: "hub-e2e-discord"},
	{slug: "google", label: "Google", subject: "google-e2e-303", handle: null},
] as const;

test("publishes bounded provider metadata and accessible signed-out guidance", async ({page}) => {
	const meta = await page.request.get("/api/meta");
	expect(meta.ok()).toBe(true);
	expect(await meta.json()).toEqual(expect.objectContaining({
		protocolVersion: "5",
		capabilities: expect.arrayContaining([
			"auth.provider_registry.v1",
			"campaign.active_context.v1",
			"account.entitlements.v1",
			"account.identity_linking.v1",
			"campaign.rules_policy.v1",
		]),
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
	await expect(page.getByText(/New provider links will require account reauthentication/)).toBeVisible();
});

test("operator reauthentication grants and revokes campaign creation through the real stack", async ({browser, page}) => {
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const targetDisplayName = `Duplicate Creator Name ${Date.now()}`;
	const targetContext = await browser.newContext({ignoreHTTPSErrors: true});
	const targetPage = await targetContext.newPage();
	const duplicateContext = await browser.newContext({ignoreHTTPSErrors: true});
	const duplicatePage = await duplicateContext.newPage();
	try {
		const targetHub = new HubCampaignPage(targetPage);
		const targetSession = await targetHub.signInSynthetic({
			providerSubject: `creator-target-${Date.now()}`,
			displayName: targetDisplayName,
			secret,
			grantCampaignCreate: false,
		});
		expect(targetSession.entitlements).not.toContain("campaign:create");
		const duplicateHub = new HubCampaignPage(duplicatePage);
		const duplicateSession = await duplicateHub.signInSynthetic({
			providerSubject: `creator-duplicate-${Date.now()}`,
			displayName: targetDisplayName,
			secret,
			grantCampaignCreate: false,
		});

		await page.goto("/hub.html");
		await page.getByRole("link", {name: "Sign in with GitHub"}).click();
		await page.waitForURL(/\/hub\.html$/);
		await expect(page.locator("#hub-operator-panel")).toBeVisible();
		await page.getByRole("button", {name: "Reauthenticate"}).click();
		await expect(page.getByRole("button", {name: "Reauthenticate with Discord"})).toHaveCount(0);
		await expect(page.getByRole("button", {name: "Reauthenticate with Google"})).toHaveCount(0);
		await page.getByRole("button", {name: "Reauthenticate with GitHub"}).click();
		await page.waitForURL(/\/hub\.html$/);

		const targetRow = page.locator("#hub-operator-account-list .hub-data-row").filter({
			hasText: targetSession.account.id,
		});
		const duplicateRow = page.locator("#hub-operator-account-list .hub-data-row").filter({
			hasText: duplicateSession.account.id,
		});
		await expect(targetRow).toBeVisible();
		await expect(duplicateRow).toBeVisible();
		await expect(targetRow).toContainText(targetDisplayName);
		await expect(duplicateRow).toContainText(targetDisplayName);
		await targetRow.getByRole("button", {name: "Grant creator"}).click();
		await expect(targetRow.getByRole("button", {name: "Revoke creator"})).toBeVisible();
		await expect(duplicateRow.getByRole("button", {name: "Grant creator"})).toBeVisible();

		await targetPage.goto("/hub.html");
		await expect(targetPage.locator("#hub-create-form")).toBeVisible();
		const created = await targetPage.evaluate(async () => {
			const session = await fetch("/api/session").then(response => response.json());
			const response = await fetch("/api/campaigns", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-csrf-token": session.csrfToken,
					"x-hub-protocol-version": "5",
					"idempotency-key": crypto.randomUUID(),
				},
				body: JSON.stringify({name: "Entitled Campaign"}),
			});
			return {status: response.status, body: await response.json()};
		});
		expect(created.status).toBe(201);
		expect(created.body.campaign.name).toBe("Entitled Campaign");

		await targetRow.getByRole("button", {name: "Revoke creator"}).click();
		await expect(targetRow.getByRole("button", {name: "Grant creator"})).toBeVisible();

		const denied = await targetPage.evaluate(async () => {
			const session = await fetch("/api/session").then(response => response.json());
			const response = await fetch("/api/campaigns", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-csrf-token": session.csrfToken,
					"x-hub-protocol-version": "5",
					"idempotency-key": crypto.randomUUID(),
				},
				body: JSON.stringify({name: "Denied Campaign"}),
			});
			return {status: response.status, body: await response.json()};
		});
		expect(denied).toEqual({
			status: 403,
			body: {error: "CAMPAIGN_CREATE_NOT_ENTITLED"},
		});
	} finally {
		await targetContext.close();
		await duplicateContext.close();
	}
});

for (const provider of providers.filter(({slug}) => slug !== "google")) {
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
		expect(exportJson.sessions).toEqual(expect.arrayContaining([
			expect.objectContaining({authenticatedViaIdentityId: exportJson.externalIdentities[0].id}),
		]));
		expect(JSON.stringify(exportJson)).not.toMatch(/access.?token|refresh.?token|id.?token|code|state|pkce|nonce|email/i);

		await page.locator("#hub-logout").click();
		await page.waitForURL(/\/hub\.html$/);
		await expect(page.getByRole("group", {name: "Sign-in providers"})).toBeVisible();
		expect((await page.request.get("/api/session")).json()).resolves.toEqual({signedIn: false});
	});
}

test("ordinary accounts reauthenticate before requesting deletion", async ({page}) => {
	await page.goto("/hub.html");
	await page.getByRole("link", {name: "Sign in with Discord"}).click();
	await page.waitForURL(/\/hub\.html$/);
	await expect(page.locator("#hub-account-reauth")).toBeVisible();
	await expect(page.getByRole("button", {name: "Reauthenticate with Discord"})).toBeVisible();

	page.on("dialog", dialog => dialog.accept("DELETE"));
	await page.locator("#hub-request-deletion").click();
	await expect(page.locator("#hub-account-reauth-status")).toContainText("Reauthentication complete");
	await expect(page.locator("#hub-request-deletion")).toBeFocused();
	await page.locator("#hub-request-deletion").click();
	await page.waitForURL(/\/hub\.html\?accountAction=cancel-deletion$/);
	await expect(page.getByRole("group", {name: "Sign-in providers"})).toBeVisible();
	await page.getByRole("link", {name: "Sign in with Discord"}).click();
	await expect(page.locator("#hub-account-deletion-pending")).toBeVisible();
	await expect(page.locator("#hub-deletion-reauth-status")).toContainText("Reauthentication complete");
	await page.locator("#hub-cancel-deletion").click();
	await expect(page.locator("#hub-account-active")).toBeVisible();
});

test("links a new provider to the same account, signs in through it, then unlinks with session rotation", async ({browser, page}) => {
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const linkedGoogleSubject = `google-linked-${Date.now()}`;
	await page.goto("/hub.html");
	await page.getByRole("link", {name: "Sign in with GitHub"}).click();
	await page.waitForURL(/\/hub\.html$/);
	const initialSession = await page.request.get("/api/session").then(response => response.json());

	await page.getByRole("button", {name: "Link Google"}).click();
	await expect(page.getByText("Reauthenticate before linking another sign-in provider.")).toBeVisible();
	await page.getByRole("button", {name: "Reauthenticate with GitHub"}).click();
	await page.waitForURL(/\/hub\.html$/);
	await page.request.post("/auth/__test/google/next-subject", {
		headers: {"x-hub-test-auth": secret},
		data: {subject: linkedGoogleSubject},
	});
	await page.getByRole("button", {name: "Link Google"}).click();
	await expect(page.getByText("Sign-in method linked. Every previous device was signed out.")).toBeVisible();
	const linkedSession = await page.request.get("/api/session").then(response => response.json());
	expect(linkedSession.account.id).toBe(initialSession.account.id);

	const secondContext = await browser.newContext({ignoreHTTPSErrors: true});
	const secondPage = await secondContext.newPage();
	try {
		await secondPage.request.post("/auth/__test/google/next-subject", {
			headers: {"x-hub-test-auth": secret},
			data: {subject: linkedGoogleSubject},
		});
		await secondPage.goto("/hub.html");
		await secondPage.getByRole("link", {name: "Sign in with Google"}).click();
		await secondPage.waitForURL(/\/hub\.html$/);
		const sameAccountSession = await secondPage.request.get("/api/session").then(response => response.json());
		expect(sameAccountSession.account.id).toBe(initialSession.account.id);

		await page.getByRole("button", {name: "Reauthenticate"}).click();
		await page.getByRole("button", {name: "Reauthenticate with GitHub"}).click();
		await page.waitForURL(/\/hub\.html$/);
		const googleRow = page.locator("#hub-identity-list .hub-data-row").filter({hasText: "Google"});
		await googleRow.getByRole("button", {name: "Unlink"}).click();
		await expect(page.getByText("Sign-in method removed. Every other device was signed out.")).toBeVisible();
		await expect.poll(async () => (await secondPage.request.get("/api/session")).json())
			.toEqual({signedIn: false});
	} finally {
		await secondContext.close();
	}
});
test("Google first access requires and atomically redeems a campaign invite", async ({page}) => {
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const hub = new HubCampaignPage(page);
	await hub.signInSynthetic({
		providerSubject: "provider-invite-owner",
		displayName: "Provider Invite Owner",
		secret,
	});
	const campaignName = "Provider Invite Admission";
	const campaignId = await hub.createCampaign(campaignName);
	const inviteToken = await hub.createInviteViaApi(campaignId);

	await page.goto("/hub.html");
	await page.locator("#hub-logout").click();
	await page.waitForURL(/\/hub\.html$/);
	await expect(page.getByRole("group", {name: "Sign-in providers"})).toBeVisible();
	await page.goto(`/hub.html?flow=first-access#invite=${encodeURIComponent(inviteToken)}`);
	const signInGroup = page.getByRole("group", {name: "Sign-in providers"});
	await expect(signInGroup).toBeVisible();
	await signInGroup.getByRole("button", {name: "Sign in with Google"}).click();
	await page.waitForURL(/\/hub\.html$/);

	const session = await page.request.get("/api/session");
	expect(session.ok()).toBe(true);
	expect(await session.json()).toEqual(expect.objectContaining({
		signedIn: true,
		account: expect.objectContaining({displayName: "Hub E2E Google"}),
	}));
	const campaign = await page.request.get(`/api/campaigns/${campaignId}`);
	expect(campaign.ok()).toBe(true);
	expect(await campaign.json()).toEqual(expect.objectContaining({
		campaign: expect.objectContaining({
			id: campaignId,
			name: campaignName,
			role: "player",
			status: "active",
		}),
	}));
	const exported = await page.request.get("/api/account/export");
	expect(exported.ok()).toBe(true);
	expect((await exported.json()).externalIdentities).toEqual([
		expect.objectContaining({
			provider: "google",
			subject: "google-e2e-303",
			handle: null,
		}),
	]);
});

test("session expiry offers only currently available sign-in providers", async ({page}) => {
	const secret = process.env.HUB_TEST_AUTH_SECRET;
	if (!secret) throw new Error("HUB_TEST_AUTH_SECRET is required.");
	const hub = new HubCampaignPage(page);
	await hub.signInSynthetic({
		providerSubject: "provider-expiry-dm",
		displayName: "Provider Expiry DM",
		secret,
	});
	const campaignId = await hub.createCampaign("Provider Expiry Recovery");

	await page.route("**/api/meta", route => route.fulfill({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify({
			authProviders: providers.map(provider => ({
				slug: provider.slug,
				label: provider.label,
				startPath: `/auth/${provider.slug}/start`,
				status: provider.slug === "github" ? "configuration_error" : "available",
			})),
		}),
	}));
	await page.route(`**/api/campaigns/${campaignId}/invites`, route => {
		if (route.request().method() !== "POST") return route.continue();
		return route.fulfill({
			status: 401,
			contentType: "application/json",
			body: JSON.stringify({error: "AUTH_REQUIRED"}),
		});
	});

	const people = page.locator(".hub-disclosure").filter({
		has: page.locator(":scope > summary").filter({hasText: "People and invitations"}),
	});
	await people.locator(":scope > summary").click();
	await page.locator("#campaign-invite-form button[type='submit']").click();

	const signInGroup = page.getByRole("group", {name: "Sign-in providers"});
	await expect(signInGroup).toBeVisible();
	await expect(signInGroup.getByRole("link", {name: "Sign in with GitHub"})).toHaveCount(0);
	await expect(signInGroup.getByRole("link", {name: "Sign in with Discord"})).toBeVisible();
	await expect(signInGroup.getByRole("link", {name: "Sign in with Google"})).toBeVisible();
	await expect(page.getByText("One sign-in provider is temporarily unavailable.")).toBeVisible();
	await expect(page.locator("#hub-signed-in")).toBeVisible();
	await expect(page.locator("#campaign-content")).toBeVisible();
	await expect(page.locator("#campaign-name")).toHaveText("Provider Expiry Recovery");
	await expect(page.locator("#campaign-connection-status")).toHaveText("Signed out · data is read only");
	await expect(page.locator("#campaign-invite-form button[type='submit']")).toBeDisabled();
	await expect(page.locator("#hub-logout")).toBeEnabled();
});
