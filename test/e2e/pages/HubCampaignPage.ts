import {expect, Page, Request} from "@playwright/test";
import {waitForToolsLoaded} from "../utils/waitHelpers";

type HubSession = {
	signedIn: boolean;
	account: {id: string; displayName: string; status: string};
	csrfToken: string;
};

export class HubCampaignPage {
	readonly page: Page;

	constructor (page: Page) {
		this.page = page;
	}

	async signInSynthetic ({providerSubject, displayName, secret}: {providerSubject: string; displayName: string; secret: string}): Promise<HubSession> {
		const response = await this.page.request.post("/auth/__test/session", {
			headers: {"x-hub-test-auth": secret},
			data: {providerSubject, displayName},
		});
		expect(response.ok()).toBe(true);
		return response.json();
	}

	async getSession (): Promise<HubSession> {
		const response = await this.page.request.get("/api/session");
		expect(response.ok()).toBe(true);
		const session = await response.json();
		expect(session.signedIn).toBe(true);
		return session;
	}

	private async getMutationHeaders (): Promise<Record<string, string>> {
		const session = await this.getSession();
		const currentUrl = new URL(this.page.url());
		const origin = ["http:", "https:"].includes(currentUrl.protocol)
			? currentUrl.origin
			: (process.env.HUB_E2E_ORIGIN || "https://localhost:8443");
		return {
			origin,
			"x-csrf-token": session.csrfToken,
			"x-hub-protocol-version": "2",
			"idempotency-key": crypto.randomUUID(),
		};
	}

	async gotoHub (): Promise<void> {
		await this.page.goto("/hub.html");
		await expect(this.page.locator("#hub-signed-in")).toBeVisible();
	}

	async expectLightweightSignedOutBoot (): Promise<void> {
		await this._expectLightweightBoot({
			path: "/hub.html",
			readySelector: "#hub-signed-out",
			maxRequests: 25,
			maxLcpMs: 1_500,
		});
	}

	async expectAccessibleResponsiveHub (): Promise<void> {
		await this.page.setViewportSize({width: 390, height: 844});
		await this.page.goto("/hub.html");
		await expect(this.page.locator("#hub-signed-out")).toBeVisible();
		await expect(this.page.locator("main h1")).toHaveText("Campaign Hub");
		await this.page.keyboard.press("Tab");
		const skipLink = this.page.getByRole("link", {name: "Skip to campaign content"});
		await expect(skipLink).toBeFocused();
		await this.page.keyboard.press("Enter");
		await expect(this.page.locator("#main-content")).toBeFocused();
		await this._expectCurrentHubSurfaceAccessible({expectTouchTargets: true});

		await this.page.setViewportSize({width: 844, height: 390});
		await this._expectCurrentHubSurfaceAccessible({expectTouchTargets: true});
		await this.page.setViewportSize({width: 1280, height: 720});
	}

	async expectLightweightCampaignBoot (campaignId: string): Promise<void> {
		await this._expectLightweightBoot({
			path: `/campaign.html?id=${encodeURIComponent(campaignId)}`,
			readySelector: "#campaign-content",
		});
	}

	async expectAccessibleResponsiveCampaign (campaignId: string): Promise<void> {
		await this.page.setViewportSize({width: 390, height: 844});
		await this.gotoCampaign(campaignId);
		await expect(this.page.locator("main h1")).toHaveText("Campaign Hub");
		await this._expectCurrentHubSurfaceAccessible();
		await this.page.setViewportSize({width: 844, height: 390});
		await this._expectCurrentHubSurfaceAccessible();
		await this.page.setViewportSize({width: 1280, height: 720});
	}

	async expectOfflineReconnectPosture (campaignId: string): Promise<void> {
		await this.gotoCampaign(campaignId);
		const campaignName = await this.page.locator("#campaign-name").textContent();
		try {
			await this.page.context().setOffline(true);
			await expect(this.page.locator("#campaign-connection-status")).toHaveText("Offline · shown data may be stale");
			await expect(this.page.locator("#hub-error")).toContainText("changes cannot be saved until the connection returns");
			await expect(this.page.locator("#campaign-name")).toHaveText(campaignName || "");
		} finally {
			await this.page.context().setOffline(false);
		}
		await expect(this.page.locator("#campaign-connection-status")).toHaveText("Back online · reload to refresh");
		const reload = this.page.getByRole("button", {name: "Reload campaign"});
		await expect(reload).toBeVisible();
		await reload.click();
		await expect(this.page.locator("#campaign-connection-status")).toHaveText(/(?:Campaign data|Live updates) connected/);
	}

	private async _expectCurrentHubSurfaceAccessible ({expectTouchTargets = false}: {expectTouchTargets?: boolean} = {}): Promise<void> {
		const audit = await this.page.evaluate(expectTouchTargets_ => {
			const isVisible = (element: HTMLElement) => {
				const style = getComputedStyle(element);
				return element.getClientRects().length > 0
					&& style.visibility !== "hidden"
					&& style.display !== "none";
			};
			const getAccessibleName = (element: HTMLElement) => {
				const labelledBy = element.getAttribute("aria-labelledby")
					?.split(/\s+/g)
					.map(id => document.getElementById(id)?.textContent?.trim() || "")
					.filter(Boolean)
					.join(" ");
				const labels = "labels" in element
					? [...((element as HTMLInputElement).labels || [])].map(label => label.textContent?.trim() || "").filter(Boolean).join(" ")
					: "";
				return element.getAttribute("aria-label")?.trim()
					|| labelledBy
					|| labels
					|| element.textContent?.trim()
					|| element.getAttribute("title")?.trim()
					|| element.getAttribute("placeholder")?.trim()
					|| "";
			};
			const controls = [...document.querySelectorAll<HTMLElement>("a[href], button, input:not([type='hidden']), select, textarea")]
				.filter(isVisible);
			const unlabeled = controls
				.filter(element => !getAccessibleName(element))
				.map(element => `${element.tagName.toLowerCase()}#${element.id || "(no-id)"}`);
			const undersized = expectTouchTargets_
				? controls
					.filter(element => {
						const rect = element.getBoundingClientRect();
						return rect.width < 44 || rect.height < 44;
					})
					.map(element => `${element.tagName.toLowerCase()}#${element.id || "(no-id)"}`)
				: [];
			return {
				clientWidth: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
				unlabeled,
				undersized,
			};
		}, expectTouchTargets);
		expect(audit.scrollWidth, "Hub surface should reflow without horizontal overflow").toBeLessThanOrEqual(audit.clientWidth);
		expect(audit.unlabeled, "Hub-owned controls should have accessible names").toEqual([]);
		expect(audit.undersized, "Hub entry controls should have 44px touch targets").toEqual([]);
	}

	private async _expectLightweightBoot ({path, readySelector, maxRequests = null, maxLcpMs = null}: {path: string; readySelector: string; maxRequests?: number | null; maxLcpMs?: number | null}): Promise<void> {
		await this.page.addInitScript(() => {
			(window as any).__hubLargestContentfulPaint = 0;
			new PerformanceObserver(entries => {
				for (const entry of entries.getEntries()) (window as any).__hubLargestContentfulPaint = entry.startTime;
			}).observe({type: "largest-contentful-paint", buffered: true});
		});
		const requests: string[] = [];
		const onRequest = (request: Request) => requests.push(request.url());
		this.page.on("request", onRequest);
		try {
			await this.page.goto(path);
			await expect(this.page.locator(readySelector)).toBeVisible({timeout: 30_000});
			await this.page.waitForLoadState("networkidle");
		} finally {
			this.page.off("request", onRequest);
		}

		const pageOrigin = new URL(this.page.url()).origin;
		const networkUrls = requests.map(url => new URL(url)).filter(url => ["http:", "https:"].includes(url.protocol));
		expect(networkUrls.filter(url => url.origin !== pageOrigin), `${path} should not make third-party requests`).toEqual([]);
		expect(networkUrls.filter(url => /^\/(?:data|fonts|homebrew|prerelease|search)\//.test(url.pathname)), `${path} should not load the general data graph`).toEqual([]);
		if (maxRequests != null) expect(networkUrls.length, `${path} initial request budget`).toBeLessThanOrEqual(maxRequests);
		if (maxLcpMs != null) {
			const lcpMs = await this.page.evaluate(() => (window as any).__hubLargestContentfulPaint);
			expect(lcpMs, `${path} should report an LCP entry`).toBeGreaterThan(0);
			expect(lcpMs, `${path} unthrottled LCP budget`).toBeLessThanOrEqual(maxLcpMs);
		}
	}

	async expectOrdinaryReadLatency (maxP95Ms = 300): Promise<void> {
		const durations = [];
		for (let i = 0; i < 10; ++i) {
			const startedAt = performance.now();
			const response = await this.page.request.get("/api/session");
			expect(response.ok()).toBe(true);
			durations.push(performance.now() - startedAt);
		}
		durations.sort((a, b) => a - b);
		const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
		expect(p95, "ordinary API read p95 budget").toBeLessThanOrEqual(maxP95Ms);
	}

	async expectReleaseAssets (): Promise<void> {
		for (const {path, contentType} of [
			{path: "/hub.html", contentType: "text/html"},
			{path: "/favicon.ico", contentType: "image/"},
			{path: "/thelemar_symbol_wip_2_icon.ico", contentType: "image/"},
			{path: "/manifest.webmanifest", contentType: "application/manifest+json"},
			{path: "/sw.js", contentType: "javascript"},
			{path: "/sw-injector.js", contentType: "javascript"},
		]) {
			const response = await this.page.request.head(path);
			expect(response.ok(), `${path} should be present in the release image`).toBe(true);
			expect(response.headers()["content-type"]).toContain(contentType);
			expect(response.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
		}
	}

	async createCampaign (name: string): Promise<string> {
		await this.gotoHub();
		await this.page.locator("#hub-campaign-name").fill(name);
		await this.page.locator("#hub-create-submit").click();
		await this.page.waitForURL(/campaign\.html\?id=/);
		return new URL(this.page.url()).searchParams.get("id")!;
	}

	async gotoCampaign (campaignId: string): Promise<void> {
		await this.page.goto(`/campaign.html?id=${encodeURIComponent(campaignId)}`);
		await expect(this.page.locator("#campaign-content")).toBeVisible({timeout: 30_000});
	}

	private async openCampaignAdministration (name: string): Promise<void> {
		const disclosure = this.page.locator(".hub-disclosure", {hasText: name});
		if (!await disclosure.evaluate(element => (element as HTMLDetailsElement).open)) {
			await disclosure.locator("summary").click();
		}
	}

	async createInvite (campaignId: string, role = "player"): Promise<string> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignAdministration("People and invitations");
		await this.page.locator("#campaign-invite-role").selectOption(role);
		await this.page.locator("#campaign-invite-form button[type='submit']").click();
		const output = this.page.locator("#campaign-invite-output");
		await expect(output).not.toHaveValue("");
		return output.inputValue();
	}

	async createInviteViaApi (campaignId: string, role = "player"): Promise<string> {
		const response = await this.page.request.post(`/api/campaigns/${encodeURIComponent(campaignId)}/invites`, {
			headers: await this.getMutationHeaders(),
			data: {role},
		});
		expect(response.ok()).toBe(true);
		return (await response.json()).token;
	}

	async redeemInviteTokenViaApi (token: string): Promise<void> {
		const response = await this.page.request.post("/api/invites/redeem", {
			headers: await this.getMutationHeaders(),
			data: {token},
		});
		expect(response.ok()).toBe(true);
	}

	async getMembers (campaignId: string): Promise<any[]> {
		const response = await this.page.request.get(`/api/campaigns/${encodeURIComponent(campaignId)}/members`);
		expect(response.ok()).toBe(true);
		return (await response.json()).members;
	}

	async redeemInvite (inviteUrl: string, campaignName: string): Promise<void> {
		await this.page.goto(inviteUrl);
		await expect(this.page.locator("#hub-campaign-list")).toContainText(campaignName);
	}

	async createCharacter ({campaignId, name}: {campaignId: string; name: string}): Promise<any> {
		const response = await this.page.request.post("/api/characters", {
			headers: await this.getMutationHeaders(),
			data: {
				clientImportId: `e2e-${crypto.randomUUID()}`,
				campaignId,
				schemaVersion: 1,
				data: {
					name,
					abilities: {str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10},
					classes: [{name: "Fighter", source: "PHB", level: 1}],
					xp: 0,
					hp: {current: 12, max: 12, temp: 0},
					spellcasting: {spellSlots: {1: {current: 2, max: 2}}},
					conditions: [],
					inventory: [{id: "rations", item: {name: "Rations", source: "PHB"}, quantity: 5}],
					currency: {cp: 8, sp: 6, ep: 4, gp: 10, pp: 2},
				},
			},
		});
		expect(response.ok()).toBe(true);
		return (await response.json()).character;
	}

	async copyLocalCharacterFromSheet ({campaignId, name}: {campaignId: string; name: string}): Promise<any> {
		const localId = `local-${crypto.randomUUID()}`;
		const localCharacter = {
			id: localId,
			name,
			abilities: {str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10},
			classes: [{name: "Fighter", source: "PHB", level: 1}],
			xp: 0,
			hp: {current: 12, max: 12, temp: 0},
			spellcasting: {spellSlots: {1: {current: 2, max: 2}}},
			conditions: [],
			inventory: [{id: "rations", item: {name: "Rations", source: "PHB"}, quantity: 5}],
			currency: {cp: 8, sp: 6, ep: 4, gp: 10, pp: 2},
		};
		await this.page.goto("/charactersheet.html");
		await waitForToolsLoaded(this.page);
		await this.page.evaluate(
			async character => (window as any).StorageUtil.pSet("charsheet-characters", [character]),
			localCharacter,
		);
		await this._gotoCharacterSheetAndWaitForName({
			path: `/charactersheet.html?id=${encodeURIComponent(localId)}`,
			name,
		});
		await expect(this.page.locator("#charsheet-campaign .charsheet__campaign-title")).toHaveText("Local character");
		await expect(this.page.locator("#charsheet-campaign .charsheet__campaign-detail")).toContainText("original stays local");
		const toggle = this.page.locator("#charsheet-campaign button[aria-controls='charsheet-campaign-panel']");
		await expect(toggle).toHaveText("Add to campaign");
		await toggle.click();
		await expect(this.page.locator("#charsheet-campaign-panel")).toContainText("Your local original stays on this device");
		await expect(this.page.locator("#charsheet-campaign-panel select")).toBeFocused();
		await expect(toggle).toHaveText("Close");
		await toggle.click();
		await expect(this.page.locator("#charsheet-campaign-panel")).toBeHidden();
		await expect(toggle).toHaveText("Add to campaign");
		await expect(toggle).toBeFocused();
		await toggle.click();
		await this.page.locator("#charsheet-campaign-panel select").selectOption(campaignId);
		await this.page.locator("#charsheet-campaign-panel button", {hasText: "Create cloud copy"}).click();
		await this.page.waitForURL(url => url.searchParams.get("hubCampaign") === campaignId, {timeout: 30_000});
		const characterId = new URL(this.page.url()).searchParams.get("id");
		expect(characterId).toBeTruthy();
		const character = await this.getCharacter(characterId!);
		expect(character.clientImportId).toBe(localId);
		expect(character.data.name).toBe(name);
		expect(character.data.hp).toEqual(expect.objectContaining({current: 12, max: 12, temp: 0}));
		expect(character.data.currency).toEqual(expect.objectContaining({gp: 10}));
		expect(character.data.inventory).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "rations", quantity: 5}),
		]));
		const localCharacters = await this.page.evaluate(
			async () => (window as any).StorageUtil.pGet("charsheet-characters"),
		);
		expect(localCharacters).toContainEqual(expect.objectContaining({id: localId, name}));
		return character;
	}

	async expectDetachedCharacterInHub ({characterId, name}: {characterId: string; name: string}): Promise<void> {
		await this.gotoHub();
		const section = this.page.locator("#hub-detached-characters");
		await expect(section).toBeVisible();
		const row = section.locator(".hub-data-row", {hasText: name});
		await expect(row).toContainText("Stored online · choose a campaign");
		await expect(row).toHaveAttribute("href", `charactersheet.html?id=${characterId}&hubCharacter=1`);
	}

	async attachDetachedCharacterFromSheet ({characterId, campaignId, name}: {characterId: string; campaignId: string; name: string}): Promise<void> {
		await this._gotoCharacterSheetAndWaitForName({
			path: `/charactersheet.html?id=${encodeURIComponent(characterId)}&hubCharacter=1`,
			name,
		});
		await expect(this.page.locator("#charsheet-campaign .charsheet__campaign-title")).toHaveText("Cloud character");
		await expect(this.page.locator("#charsheet-campaign .charsheet__campaign-detail")).toContainText("not attached to a campaign");
		await this.page.locator("#charsheet-campaign button", {hasText: "Add to campaign"}).click();
		await expect(this.page.locator("#charsheet-campaign-panel")).toContainText("No local or cloud copy will be deleted");
		await this.page.locator("#charsheet-campaign-panel select").selectOption(campaignId);
		await this.page.locator("#charsheet-campaign-panel button", {hasText: "Add character"}).click();
		await this.page.waitForURL(url =>
			url.searchParams.get("id") === characterId
			&& url.searchParams.get("hubCampaign") === campaignId,
		{timeout: 30_000});
	}

	async cloneCharacterFromSheet ({
		characterId,
		sourceCampaignId,
		targetCampaignId,
		name,
	}: {
		characterId: string;
		sourceCampaignId: string;
		targetCampaignId: string;
		name: string;
	}): Promise<any> {
		await this.openCharacterSheet({campaignId: sourceCampaignId, characterId, name});
		await this.page.locator("#charsheet-campaign button", {hasText: "Campaign options"}).click();
		const panel = this.page.locator("#charsheet-campaign-panel");
		await expect(panel).toContainText("A separate character will be created");
		await panel.locator("select").selectOption(targetCampaignId);
		await expect(panel.locator("button", {hasText: "Create cloud copy"})).toBeVisible();
		await panel.locator("button", {hasText: "Create cloud copy"}).click();
		await this.page.waitForURL(url =>
			url.searchParams.get("hubCampaign") === targetCampaignId
			&& url.searchParams.get("id") !== characterId,
		{timeout: 30_000});
		const cloneId = new URL(this.page.url()).searchParams.get("id");
		expect(cloneId).toBeTruthy();
		return this.getCharacter(cloneId!);
	}

	async prepareCharacterMove ({
		characterId,
		sourceCampaignId,
		targetCampaignId,
		name,
	}: {
		characterId: string;
		sourceCampaignId: string;
		targetCampaignId: string;
		name: string;
	}): Promise<void> {
		await this.openCharacterSheet({campaignId: sourceCampaignId, characterId, name});
		await this.page.locator("#charsheet-campaign button", {hasText: "Campaign options"}).click();
		const panel = this.page.locator("#charsheet-campaign-panel");
		await panel.locator("select").selectOption(targetCampaignId);
		await panel.locator("button", {hasText: "Review move instead"}).click();
		await expect(panel).toContainText("Move compatibility");
		await expect(panel).toContainText("Campaign rules match.");
		await expect(panel).toContainText("Campaign homebrew matches.");
		await expect(panel).toContainText("Pending incoming actions are cancelled");
		await expect(panel.locator("button", {hasText: "Move character"})).toBeDisabled();
	}

	async attemptPreparedCharacterMoveExpectingLeaseRefusal (): Promise<void> {
		const panel = this.page.locator("#charsheet-campaign-panel");
		await panel.getByLabel("I understand that this moves the character instead of creating a copy.").check();
		await panel.locator("button", {hasText: "Move character"}).click();
		await expect(this.page.locator("#charsheet-campaign .charsheet__campaign-feedback--error"))
			.toContainText("Another device is editing this character");
		await expect(panel).toContainText("Move compatibility");
	}

	async completePreparedCharacterMove ({
		characterId,
		targetCampaignId,
	}: {
		characterId: string;
		targetCampaignId: string;
	}): Promise<{idempotencyKey: string}> {
		const panel = this.page.locator("#charsheet-campaign-panel");
		await panel.getByLabel("I understand that this moves the character instead of creating a copy.").check();
		const responsePromise = this.page.waitForResponse(response =>
			response.request().method() === "POST"
			&& new URL(response.url()).pathname === `/api/characters/${characterId}/move`
			&& response.status() === 200,
		);
		await panel.locator("button", {hasText: "Move character"}).click();
		const moveResponse = await responsePromise;
		const idempotencyKey = moveResponse.request().headers()["idempotency-key"];
		expect(idempotencyKey).toBeTruthy();
		await this.page.waitForURL(url =>
			url.searchParams.get("id") === characterId
			&& url.searchParams.get("hubCampaign") === targetCampaignId,
		{timeout: 30_000});
		await expect.poll(
			() => this.page.evaluate(() => {
				const charSheet = (window as any).charSheet;
				return !!charSheet && !charSheet._characterRepository?.hasPendingWrites?.();
			}),
			{timeout: 30_000},
		).toBe(true);
		return {idempotencyKey};
	}

	async acquireCharacterLease (characterId: string): Promise<void> {
		const response = await this.page.request.post(`/api/characters/${encodeURIComponent(characterId)}/lease`, {
			headers: await this.getMutationHeaders(),
			data: {takeover: false},
		});
		expect(response.ok()).toBe(true);
	}

	async releaseCharacterLease (characterId: string): Promise<void> {
		const response = await this.page.request.post(`/api/characters/${encodeURIComponent(characterId)}/lease/release`, {
			headers: await this.getMutationHeaders(),
			data: {},
		});
		expect(response.ok()).toBe(true);
		expect((await response.json()).released).toEqual(expect.any(Boolean));
	}

	async replayCharacterMove ({
		characterId,
		campaignId,
		idempotencyKey,
	}: {
		characterId: string;
		campaignId: string;
		idempotencyKey: string;
	}): Promise<any> {
		const headers = await this.getMutationHeaders();
		headers["idempotency-key"] = idempotencyKey;
		const response = await this.page.request.post(`/api/characters/${encodeURIComponent(characterId)}/move`, {
			headers,
			data: {campaignId},
		});
		expect(response.ok()).toBe(true);
		return response.json();
	}

	async createNearLimitCharacter ({campaignId, name}: {campaignId: string; name: string}): Promise<any> {
		const response = await this.page.request.post("/api/characters", {
			headers: await this.getMutationHeaders(),
			data: {
				clientImportId: `e2e-large-${crypto.randomUUID()}`,
				campaignId,
				schemaVersion: 1,
				data: {name, notes: "x".repeat(1_400_000), inventory: [], currency: {}},
			},
		});
		expect(response.ok()).toBe(true);
		return (await response.json()).character;
	}

	async logRolls ({campaignId, characterId, count}: {campaignId: string; characterId: string; count: number}): Promise<void> {
		const chunks = Array.from({length: Math.ceil(count / 20)}, (_, chunkIndex) =>
			Array.from({length: Math.min(20, count - chunkIndex * 20)}, (_, offset) => chunkIndex * 20 + offset),
		);
		for (const chunk of chunks) {
			const headers = await Promise.all(chunk.map(() => this.getMutationHeaders()));
			const responses = await Promise.all(chunk.map((index, offset) => this.page.request.post(`/api/campaigns/${encodeURIComponent(campaignId)}/rolls`, {
				headers: headers[offset],
				data: {
					characterId,
					formula: "1d20+5",
					total: 6 + (index % 20),
					context: `Load roll ${index}`,
					visibility: "all_members",
					detail: {},
				},
			})));
			responses.forEach(response => expect(response.ok()).toBe(true));
		}
	}

	async getEvents (campaignId: string, limit = 500): Promise<any[]> {
		const response = await this.page.request.get(`/api/campaigns/${encodeURIComponent(campaignId)}/events?afterSequence=0&limit=${limit}`);
		expect(response.ok()).toBe(true);
		return (await response.json()).events;
	}

	async waitForOutboxDrain ({token, timeout = 90_000}: {token: string; timeout?: number}): Promise<void> {
		await expect.poll(async () => {
			const response = await this.page.request.get("/api/metrics", {
				headers: {authorization: `Bearer ${token}`},
			});
			expect(response.ok()).toBe(true);
			const match = (await response.text()).match(/^hub_outbox_pending\s+(\d+)$/m);
			return Number(match?.[1] ?? -1);
		}, {timeout, intervals: [500, 1_000, 2_000]}).toBe(0);
	}

	async reserveGoldConcurrently ({campaignId, characterId, partyInventoryId, amount}: {campaignId: string; characterId: string; partyInventoryId: string; amount: number}): Promise<number[]> {
		const headers = await Promise.all([0, 1].map(() => this.getMutationHeaders()));
		const responses = await Promise.all(headers.map(header => this.page.request.post(`/api/campaigns/${encodeURIComponent(campaignId)}/transfers`, {
			headers: header,
			data: {
				sourceKind: "character",
				sourceId: characterId,
				targetKind: "party_inventory",
				targetId: partyInventoryId,
				payload: {currency: {gp: amount}},
			},
		})));
		return responses.map(response => response.status()).sort();
	}

	async getCharacter (characterId: string): Promise<any> {
		const response = await this.page.request.get(`/api/characters/${encodeURIComponent(characterId)}`);
		expect(response.ok()).toBe(true);
		return (await response.json()).character;
	}

	async openCharacterSheet ({campaignId, characterId, name}: {campaignId: string; characterId: string; name: string}): Promise<void> {
		await this._gotoCharacterSheetAndWaitForName({
			path: `/charactersheet.html?id=${encodeURIComponent(characterId)}&hubCampaign=${encodeURIComponent(campaignId)}`,
			name,
		});
	}

	async editCharacterHpAndRollInitiative ({campaignId, characterId, name, hp}: {campaignId: string; characterId: string; name: string; hp: number}): Promise<void> {
		await this.openCharacterSheet({campaignId, characterId, name});
		await this.page.locator("#charsheet-ipt-hp-current").fill(`${hp}`);
		await this.page.locator("#charsheet-ipt-hp-current").blur();
		await expect.poll(async () => (await this.getCharacter(characterId)).data.hp.current).toBe(hp);
		await this.page.locator("#charsheet-box-initiative").click();
		await expect.poll(async () => (await this.getEvents(campaignId))
			.filter(event => event.type === "roll.logged" && event.aggregateId === characterId)
			.length).toBeGreaterThan(0);
	}

	async editCharacterHpAndResolveDeviceConflict ({
		campaignId,
		characterId,
		name,
		hp,
		resolution,
	}: {
		campaignId: string;
		characterId: string;
		name: string;
		hp: number;
		resolution: "Use Local" | "Use Server";
	}): Promise<void> {
		if (!this.page.url().includes(`/charactersheet.html?id=${encodeURIComponent(characterId)}`)) {
			await this.openCharacterSheet({campaignId, characterId, name});
		}
		await this.page.locator("#charsheet-ipt-hp-current").fill(`${hp}`);
		await this.page.locator("#charsheet-ipt-hp-current").blur();
		await expect(this.page.getByText("Character Changed on Another Device", {exact: true})).toBeVisible();
		await this.page.getByRole("button", {name: new RegExp(resolution)}).click();
		await expect(this.page.getByText("Character Changed on Another Device", {exact: true})).toBeHidden();
	}

	async expectLiveCharacterUpdateAndRoll ({characterName, hp}: {characterName: string; hp: number}): Promise<void> {
		await expect(this.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		const row = this.page.locator("#campaign-party-roster .hub-data-row").filter({hasText: characterName});
		await expect(row).toContainText(`HP ${hp}/12`, {timeout: 15_000});
		const roll = this.page.locator("#campaign-activity-list .hub-activity-row")
			.filter({hasText: characterName})
			.filter({hasText: "Initiative"})
			.first();
		await expect(roll).toContainText(/Result: -?\d+/, {timeout: 15_000});
	}

	async signOutAndExpectLocalCharacter ({characterId, name}: {characterId: string; name: string}): Promise<void> {
		await this.gotoHub();
		await this.page.locator("#hub-logout").click();
		await expect(this.page.locator("#hub-signed-out")).toBeVisible();
		await this._gotoCharacterSheetAndWaitForName({
			path: `/charactersheet.html?id=${encodeURIComponent(characterId)}`,
			name,
		});
		await expect(this.page.locator(".charsheet__campaign-title")).toHaveText("Local character");
		await expect(this.page.locator(".charsheet__campaign-detail")).toHaveText("Saved only on this device");
	}

	private async _gotoCharacterSheetAndWaitForName ({path, name}: {path: string; name: string}): Promise<void> {
		await this.page.goto(path);
		await waitForToolsLoaded(this.page);
		await expect(this.page.locator("#charsheet-ipt-name")).toHaveValue(name);
	}

	async expectCampaignPartyTrackerProjection ({campaignId, name}: {campaignId: string; name: string}): Promise<void> {
		const pageErrors: string[] = [];
		const failedResponses: string[] = [];
		const onPageError = (error: Error) => pageErrors.push(error.message);
		const onResponse = (response: import("@playwright/test").Response) => {
			if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
		};
		this.page.on("pageerror", onPageError);
		this.page.on("response", onResponse);
		try {
			await this.page.goto(`/dmscreen.html?hubCampaign=${encodeURIComponent(campaignId)}`);
			await expect.poll(
				() => this.page.evaluate(() => (window as any).DM_SCREEN?._hubCharacterProjections?.length || 0),
				{timeout: 30_000},
			).toBeGreaterThan(0);
			await expect(this.page.locator("#dm-screen-hub-status")).toContainText("Ashen March E2E");
			await expect(this.page.locator(".dm-hub__status-pill--live")).toContainText("Live party sync");
			await this.page.evaluate(async () => {
				const {PartyTrackerRoot} = await import("/js/dmscreen/partytracker/dmscreen-partytracker.js");
				const ee = (window as any).ee;
				const host = ee`<div id="hub-e2e-party-tracker"></div>`;
				Object.assign(host.style, {
					position: "fixed",
					inset: "0",
					zIndex: "10000",
					overflow: "auto",
					background: "white",
				});
				const hubStatus = (window as any).DM_SCREEN.getHubCampaignStatus();
				const root = new PartyTrackerRoot({
					fireBoardEvent () {},
					doSaveStateDebounced () {},
					getHubCampaignStatus: () => hubStatus,
				}, host);
				root.setStateFrom({
					characters: [{
						id: "manual-e2e",
						n: "Manual reference",
						ab: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
						cl: [{n: "Fighter", l: 1, s: "PHB"}],
					}],
				});
				root.render(host);
				root.setHubCharacterProjections((window as any).DM_SCREEN._hubCharacterProjections);
				for (const character of root._characters) {
					character._isExpanded = true;
					character._renderExpandedForm();
				}
				(window as any).HUB_E2E_PARTY_TRACKER = root;
				document.body.append(host);
			});
			await expect(this.page.locator("#hub-e2e-party-tracker .dm-party__group--linked .dm-party__char-name")).toContainText(name);
			await expect(this.page.locator("#hub-e2e-party-tracker .dm-party__linked-badge")).toHaveText("Campaign live");
			await expect(this.page.locator("#hub-e2e-party-tracker .dm-party__group-title")).toHaveText([
				"Live campaign characters",
				"Manual workspace characters",
			]);
			await expect(this.page.locator("#hub-e2e-party-tracker .dm-party__group--linked button[aria-label^='Remove']")).toHaveCount(0);
			await expect(this.page.locator("#hub-e2e-party-tracker .dm-party__card--linked")).toContainText("Abilities");
			await expect(this.page.locator("#hub-e2e-party-tracker .dm-party__card--linked")).toContainText("Movement and proficiencies");
			await expect(this.page.locator("#hub-e2e-party-tracker .dm-party__card--linked input, #hub-e2e-party-tracker .dm-party__card--linked select, #hub-e2e-party-tracker .dm-party__card--linked textarea")).toHaveCount(0);
			const manualName = this.page.locator("#hub-e2e-party-tracker .dm-party__group--manual input[aria-label='Character name']");
			await manualName.fill("Uncommitted manual draft");
			await this.page.evaluate(() => {
				(window as any).HUB_E2E_PARTY_TRACKER.setHubCharacterProjections((window as any).DM_SCREEN._hubCharacterProjections);
			});
			await expect(manualName).toHaveValue("Uncommitted manual draft");
			const unexpectedPageErrors = pageErrors.filter(message =>
				!/^Failed to register a ServiceWorker .* An SSL certificate error occurred when fetching the script\.$/.test(message),
			);
			expect({pageErrors: unexpectedPageErrors, failedResponses}).toEqual({pageErrors: [], failedResponses: []});
		} finally {
			this.page.off("pageerror", onPageError);
			this.page.off("response", onResponse);
		}
	}

	async expectCampaignDmScreenDenied (campaignId: string): Promise<void> {
		await this.page.goto(`/dmscreen.html?hubCampaign=${encodeURIComponent(campaignId)}`);
		await expect(this.page.locator(".dm-hub__banner--permission_denied")).toContainText("Only the campaign DM or a co-DM");
		await expect(this.page.locator("#dm-screen-workspace")).toBeHidden();
		await expect.poll(() => this.page.evaluate(() => !!(window as any).DM_SCREEN)).toBe(false);
	}

	async grantXp ({campaignId, characterName, amount}: {campaignId: string; characterName: string; amount: number}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.page.locator("#campaign-xp-target").selectOption({label: characterName});
		await this.page.locator("#campaign-xp-amount").fill(`${amount}`);
		await this.page.locator("#campaign-xp-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-xp-form button[type='submit']")).toBeEnabled();
	}

	async grantCatalogItem ({campaignId, characterName, itemName, source}: {campaignId: string; characterName: string; itemName: string; source: string}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await expect(this.page.locator("#campaign-transfer-source option")).toHaveText(["Party inventory"]);
		await this.page.locator("#campaign-item-target").selectOption({label: characterName});
		await this.page.locator("#campaign-item-catalog-open").click();
		await expect(this.page.locator("#campaign-item-catalog")).toBeVisible();
		await this.page.locator("#campaign-item-catalog-search").fill(itemName);
		await this.page.locator("#campaign-item-catalog-results").selectOption({label: `${itemName} — ${source}`});
		await expect(this.page.locator("#campaign-item-selection-summary")).toContainText(`${itemName} · ${source}`);
		await this.page.locator("#campaign-item-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-item-form-status")).toHaveText("Item granted.");
	}

	async proposeDamage ({campaignId, characterName, amount}: {campaignId: string; characterName: string; amount: number}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.page.locator("#campaign-action-target").selectOption({label: characterName});
		await this.page.locator("#campaign-action-type").selectOption("damage");
		await this.page.locator("#campaign-action-value").fill(`${amount}`);
		await this.page.locator("#campaign-action-form button[type='submit']").click();
	}

	async proposeSpellSlotSpend ({campaignId, characterName, context, level, amount}: {campaignId: string; characterName: string; context: string; level: number; amount: number}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.page.locator("#campaign-action-target").selectOption({label: characterName});
		await this.page.locator("#campaign-action-type").selectOption("spell_slot_spend");
		await this.page.locator("#campaign-action-context").fill(context);
		await this.page.locator("#campaign-action-slot-level").selectOption(`${level}`);
		await this.page.locator("#campaign-action-slot-amount").fill(`${amount}`);
		await this.page.locator("#campaign-action-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-action-form-status")).toContainText("Effect proposal sent.");
	}

	async expectProtocolUpgradeRecovery ({campaignId, characterName}: {campaignId: string; characterName: string}): Promise<void> {
		const browser = this.page.context().browser();
		if (!browser) throw new Error("A browser-backed page is required.");
		const context = await browser.newContext({
			baseURL: new URL(this.page.url()).origin,
			ignoreHTTPSErrors: true,
			serviceWorkers: "block",
			storageState: await this.page.context().storageState(),
		});
		try {
			const page = await context.newPage();
			const helper = new HubCampaignPage(page);
			await helper.gotoCampaign(campaignId);
			const apiUrl = "**/api/**";
			let intercepted = false;
			await page.route(apiUrl, async route => {
				const request = route.request();
				if (request.method() !== "POST" || !request.url().endsWith(`/api/campaigns/${campaignId}/actions`)) return route.continue();
				intercepted = true;
				return route.fulfill({
					status: 426,
					contentType: "application/json",
					body: JSON.stringify({error: "PROTOCOL_UPDATE_REQUIRED", protocolVersion: "1"}),
				});
			});
			await page.locator("#campaign-action-target").selectOption({label: characterName});
			await page.locator("#campaign-action-type").selectOption("damage");
			await page.locator("#campaign-action-value").fill("1");
			await page.locator("#campaign-action-form button[type='submit']").click();
			await expect.poll(() => intercepted).toBe(true);
			await expect(page.locator("#campaign-connection-status")).toHaveText("Update required · data is read only");
			await expect(page.locator("#hub-error")).toContainText("page is out of date");
			const reload = page.getByRole("button", {name: "Reload now"});
			await expect(reload).toBeVisible();
			await page.unroute(apiUrl);
			await reload.click();
			await expect(page.locator("#campaign-connection-status")).toHaveText(/(?:Campaign data|Live updates) connected/);
		} finally {
			await context.close();
		}
	}

	async applyFirstPendingAction (campaignId: string): Promise<void> {
		await this.gotoCampaign(campaignId);
		const button = this.page.locator("#campaign-pending-actions button", {hasText: "Apply"}).first();
		await expect(button).toBeVisible();
		await button.click();
		await expect(button).toBeHidden();
	}

	async expectInsufficientActionAndReject (campaignId: string): Promise<void> {
		await this.gotoCampaign(campaignId);
		const row = this.page.locator("#campaign-pending-actions .hub-data-row").first();
		await row.locator("button", {hasText: "Apply"}).click();
		await expect(this.page.locator("#hub-error")).toContainText("no longer has enough of that resource");
		await expect(row).toBeVisible();
		await row.locator("button", {hasText: "Reject"}).click();
		await expect(row).toBeHidden();
	}

	async expectInsufficientTransferFeedback ({campaignId, characterName}: {campaignId: string; characterName: string}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.page.locator("#campaign-transfer-source").selectOption({label: characterName});
		await this.page.locator("#campaign-transfer-target").selectOption({label: "Party inventory"});
		await this.page.locator("#campaign-transfer-gp").fill("999");
		await this.page.locator("#campaign-transfer-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-transfer-form-status")).toHaveText(/Only \d+ GP is available\./);
	}

	async expectSessionRevokedWhileOpen ({characterName}: {characterName: string}): Promise<void> {
		await expect(this.page.locator("#campaign-party-roster")).toContainText(characterName);
		await expect(this.page.locator("#hub-error")).toContainText("session has expired");
		await expect(this.page.locator("#campaign-connection-status")).toHaveText("Signed out · data is read only");
		await expect(this.page.locator("#campaign-content")).toBeVisible();
		await expect(this.page.locator("#campaign-action-form button[type='submit']")).toBeDisabled();
	}

	async expectMembershipRevokedWhileOpen ({characterName}: {characterName: string}): Promise<void> {
		await expect(this.page.locator("#campaign-party-roster")).toContainText(characterName);
		await expect(this.page.locator("#hub-error")).toContainText("no longer have access");
		await expect(this.page.locator("#campaign-connection-status")).toHaveText("Access removed · data is read only");
		await expect(this.page.locator("#campaign-content")).toBeVisible();
		await expect(this.page.locator("#campaign-action-form button[type='submit']")).toBeDisabled();
	}

	async reserveItemAndCurrencyToParty ({
		campaignId,
		characterName,
		itemName,
		quantity,
		currency,
	}: {
		campaignId: string;
		characterName: string;
		itemName: string;
		quantity: number;
		currency: Partial<Record<"cp" | "sp" | "ep" | "gp" | "pp", number>>;
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.page.locator("#campaign-transfer-source").selectOption({label: characterName});
		expect(await this.page.locator("#campaign-transfer-target").inputValue())
			.not.toBe(await this.page.locator("#campaign-transfer-source").inputValue());
		await this.page.locator("#campaign-transfer-target").selectOption({label: "Party inventory"});
		const itemOption = this.page.locator("#campaign-transfer-entry option", {hasText: itemName});
		await expect(itemOption).toContainText("available");
		await this.page.locator("#campaign-transfer-entry").selectOption(await itemOption.getAttribute("value") || "");
		await this.page.locator("#campaign-transfer-quantity").fill(`${quantity}`);
		for (const [type, amount] of Object.entries(currency)) {
			await this.page.locator(`#campaign-transfer-${type}`).fill(`${amount}`);
		}
		await this.page.locator("#campaign-transfer-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-transfer-form-status")).toContainText("Transfer reserved.");
	}

	async acceptFirstPendingTransfer ({campaignId, expectedText}: {campaignId: string; expectedText: string[]}): Promise<void> {
		await this.gotoCampaign(campaignId);
		const transfer = this.page.locator("#campaign-pending-transfers .hub-data-row").first();
		for (const text of expectedText) await expect(transfer).toContainText(text);
		const button = this.page.locator("#campaign-pending-transfers button", {hasText: "Accept"}).first();
		await expect(button).toBeVisible();
		await button.click();
		await expect(button).toBeHidden();
	}

	async expectTransferItemAvailable ({sourceName, itemName}: {sourceName: string; itemName: string}): Promise<void> {
		await this.page.locator("#campaign-transfer-source").selectOption({label: sourceName});
		await expect(this.page.locator("#campaign-transfer-entry option", {hasText: itemName})).toContainText("available");
	}

	async getPartyInventory (campaignId: string): Promise<any> {
		const response = await this.page.request.get(`/api/campaigns/${encodeURIComponent(campaignId)}/party-inventory`);
		expect(response.ok()).toBe(true);
		return (await response.json()).partyInventory;
	}

	async expectStaleCharacterUrlCanonicalized ({
		characterId,
		staleCampaignId,
		canonicalCampaignId,
	}: {
		characterId: string;
		staleCampaignId: string;
		canonicalCampaignId: string;
	}): Promise<void> {
		await this.page.goto(`/charactersheet.html?id=${encodeURIComponent(characterId)}&hubCampaign=${encodeURIComponent(staleCampaignId)}`);
		await this.page.waitForURL(url => url.searchParams.get("hubCampaign") === canonicalCampaignId, {timeout: 30_000});
		await expect(this.page.locator("#charsheet-campaign"))
			.toContainText("Online · changes sync to this campaign", {timeout: 30_000});
	}

	async revokeOtherSession (): Promise<string> {
		const sessions = await (await this.page.request.get("/api/account/sessions")).json();
		const target = sessions.sessions.find((session: any) => !session.isCurrent && !session.revokedAt);
		expect(target).toBeTruthy();
		const response = await this.page.request.post(`/api/account/sessions/${target.id}/revoke`, {
			headers: await this.getMutationHeaders(),
		});
		expect(response.ok()).toBe(true);
		return target.id;
	}

	async removeMember ({campaignId, displayName}: {campaignId: string; displayName: string}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignAdministration("People and invitations");
		const row = this.page.locator("#campaign-member-list .hub-data-row", {hasText: displayName});
		this.page.once("dialog", dialog => dialog.accept());
		await row.locator("button", {hasText: "Remove"}).click();
		await expect(row).toBeHidden();
	}

	async requestDeletion (): Promise<void> {
		const response = await this.page.request.post("/api/account/deletion/request", {
			headers: await this.getMutationHeaders(),
			data: {confirmation: "DELETE"},
		});
		expect(response.ok()).toBe(true);
	}

	async cancelDeletion (): Promise<void> {
		const response = await this.page.request.post("/api/account/deletion/cancel", {
			headers: await this.getMutationHeaders(),
		});
		expect(response.ok()).toBe(true);
	}
}
