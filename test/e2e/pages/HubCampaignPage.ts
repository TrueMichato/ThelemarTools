import {expect, Page, Request, Route} from "@playwright/test";
import {waitForToolsLoaded} from "../utils/waitHelpers";

type HubSession = {
	signedIn: boolean;
	account: {id: string; displayName: string; status: string};
	entitlements?: string[];
	reauthenticationProviders?: string[];
	csrfToken: string;
};

type CampaignPrimaryAction = "dm" | "character" | "character-setup" | "character-choice" | "read-only";

export class HubCampaignPage {
	readonly page: Page;
	readonly _characterLeases = new Map<string, {epoch: number; expiresAt: string}>();

	constructor (page: Page) {
		this.page = page;
	}

	async signInSynthetic ({providerSubject, displayName, secret, grantCampaignCreate = true}: {
		providerSubject: string;
		displayName: string;
		secret: string;
		grantCampaignCreate?: boolean;
	}): Promise<HubSession> {
		const response = await this.page.request.post("/auth/__test/session", {
			headers: {"x-hub-test-auth": secret},
			data: {providerSubject, displayName, grantCampaignCreate},
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

	async deleteCharacterViaApi (characterId: string): Promise<void> {
		const response = await this.page.request.delete(`/api/characters/${characterId}`, {
			headers: await this.getMutationHeaders(),
		});
		expect(response.ok()).toBe(true);
	}

	async grantXpViaApi ({campaignId, characterId, amount, reason = null}: {
		campaignId: string;
		characterId: string;
		amount: number;
		reason?: string | null;
	}): Promise<void> {
		const response = await this.page.request.post(`/api/campaigns/${campaignId}/characters/${characterId}/xp-grants`, {
			headers: await this.getMutationHeaders(),
			data: {amount, reason},
		});
		expect(response.ok(), await response.text()).toBe(true);
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
			"x-hub-protocol-version": "3",
			"idempotency-key": crypto.randomUUID(),
		};
	}

	private async getLeaseReleaseHeaders (): Promise<Record<string, string>> {
		return {
			...await this.getMutationHeaders(),
			"x-hub-protocol-version": "6",
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
		const mobileOrder = await this.page.evaluate(() => [
			"campaign-inbox-panel",
			"campaign-manifest-panel",
			"campaign-activity-panel",
			"campaign-workbench",
		].map(id => Math.round(document.getElementById(id)!.getBoundingClientRect().top)));
		expect(mobileOrder).toEqual([...mobileOrder].sort((a, b) => a - b));
		await this.page.setViewportSize({width: 844, height: 390});
		await this._expectCurrentHubSurfaceAccessible();
		await this.page.setViewportSize({width: 1280, height: 720});
		const desktopPlacement = await this.page.evaluate(() => {
			const manifest = document.getElementById("campaign-manifest-panel")!.getBoundingClientRect();
			const attention = document.getElementById("campaign-inbox-panel")!.getBoundingClientRect();
			const activity = document.getElementById("campaign-activity-panel")!.getBoundingClientRect();
			return {
				isAttentionRail: attention.left >= manifest.right - 1,
				isActivityAfterBrief: activity.top >= manifest.bottom - 1,
			};
		});
		expect(desktopPlacement).toEqual({isAttentionRail: true, isActivityAfterBrief: true});
	}

	async expectRoleAdaptiveCampaignOverview ({
		campaignId,
		role,
		primaryAction,
		characterName,
		campaignStatus = "active",
	}: {
		campaignId: string;
		role: "dm" | "co_dm" | "player" | "spectator";
		primaryAction: CampaignPrimaryAction;
		characterName?: string;
		campaignStatus?: "active" | "archived";
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await expect(this.page.locator("#campaign-content")).toHaveAttribute("data-campaign-role", role);
		await expect(this.page.locator("#campaign-status")).toContainText(new RegExp(campaignStatus, "i"));
		await expect(this.page.locator("#campaign-manifest-panel")).toBeVisible();
		if (campaignStatus === "active") {
			await expect(this.page.locator("#campaign-inbox-panel")).toBeVisible();
			await expect(this.page.locator("#campaign-attention-summary")).toHaveText(/request/);
		} else await expect(this.page.locator("#campaign-inbox-panel")).toBeHidden();

		await this.expectCampaignPrimaryAction({primaryAction, characterName});

		const workbench = this.page.locator("#campaign-workbench");
		if (primaryAction === "read-only") {
			await expect(workbench).toBeHidden();
			return;
		}
		await expect(workbench).not.toHaveAttribute("open", "");
		const summary = workbench.locator(":scope > summary");
		await expect(summary).toBeVisible();
		await summary.scrollIntoViewIfNeeded();
		await summary.focus();
		await expect(summary).toBeFocused();
		await summary.press("Enter");
		await expect(workbench).toHaveJSProperty("open", true);
		await summary.press("Enter");
		await expect(workbench).toHaveJSProperty("open", false);
	}

	async expectCampaignPrimaryAction ({
		primaryAction,
		characterName,
	}: {
		primaryAction: CampaignPrimaryAction;
		characterName?: string;
	}): Promise<void> {
		const primarySelectors: Record<CampaignPrimaryAction, string> = {
			dm: "#campaign-open-dm-screen",
			character: "#campaign-open-primary-character",
			"character-setup": "#campaign-open-character-setup",
			"character-choice": "#campaign-open-character-setup",
			"read-only": "#campaign-primary-readonly",
		};
		await expect(this.page.locator(primarySelectors[primaryAction])).toBeVisible({timeout: 15_000});
		const visiblePrimaryCount = await this.page.locator(Object.values(primarySelectors).join(", ")).evaluateAll(elements =>
			elements.filter(element => (element as HTMLElement).getClientRects().length > 0).length,
		);
		expect(visiblePrimaryCount).toBe(1);
		if (primaryAction === "character") {
			if (characterName) await expect(this.page.locator(primarySelectors.character)).toContainText(characterName);
			await expect(this.page.locator(primarySelectors.character)).toHaveAttribute("href", /charactersheet\.html\?id=/);
		}
		if (primaryAction === "character-setup") {
			const setup = this.page.locator(primarySelectors["character-setup"]);
			await expect(setup).toHaveText("Add a local character copy");
			await expect(setup).toHaveAttribute("href", "#campaign-upload-local");
			await setup.click();
			await expect(this.page.locator("#campaign-upload-local")).toBeFocused();
		}
		if (primaryAction === "character-choice") {
			const chooser = this.page.locator(primarySelectors["character-choice"]);
			await expect(chooser).toHaveText("Choose a character");
			await expect(chooser).toHaveAttribute("href", "#campaign-character-list");
			await chooser.click();
			await expect(this.page.locator("#campaign-character-list")).toBeFocused();
		}
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
		if (maxRequests != null) {
			const requestPaths = networkUrls.map(url => `${url.pathname}${url.search}`);
			expect(networkUrls.length, `${path} initial request budget:\n${requestPaths.join("\n")}`).toBeLessThanOrEqual(maxRequests);
		}
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
		await expect(
			this.page.locator("#hub-campaign-list .hub-campaign-row, #hub-campaign-empty:not(.ve-hidden)").first(),
		).toBeVisible();
		await this.page.locator("#hub-campaign-name").fill(name);
		const submit = this.page.locator("#hub-create-submit");
		for (let attempt = 0; attempt < 2; ++attempt) {
			const responsePromise = this.page.waitForResponse(response =>
				response.request().method() === "POST"
				&& new URL(response.url()).pathname === "/api/campaigns",
			);
			await submit.click();
			const response = await responsePromise;
			if (response.status() === 201) break;
			if (response.status() !== 429 || attempt === 1) {
				throw new Error(`Campaign creation failed with HTTP ${response.status()}.`);
			}
			const retryAfterSeconds = Number(response.headers()["retry-after"]);
			if (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1 || retryAfterSeconds > 60) {
				throw new Error(`Campaign creation returned an invalid Retry-After value: ${response.headers()["retry-after"] || "<missing>"}.`);
			}
			await expect(submit).toBeEnabled();
			await this.page.waitForTimeout(retryAfterSeconds * 1_000 + 250);
		}
		await this.page.waitForURL(/campaign\.html\?id=/);
		const campaignId = new URL(this.page.url()).searchParams.get("id")!;
		await expect(this.page.locator("#campaign-content")).toBeVisible({timeout: 30_000});
		await this.waitForSelectedCampaign(campaignId);
		return campaignId;
	}

	async publishDefaultCampaignRulesViaApi (campaignId: string): Promise<string> {
		const created = await this.page.request.post(
			`/api/campaigns/${encodeURIComponent(campaignId)}/rules-versions`,
			{
				headers: await this.getMutationHeaders(),
				data: {
					rules: {
						enableTgtt: true,
						exhaustionRules: "thelemar",
						thelemar_carryWeight: true,
						thelemar_encumbranceTiers: true,
						thelemar_jumping: true,
						thelemar_linguisticsBonus: true,
						thelemar_criticalRolls: true,
					},
				},
			},
		);
		expect(created.ok(), await created.text()).toBe(true);
		const rulesVersionId = (await created.json()).rulesVersion.id as string;
		const activated = await this.page.request.post(
			`/api/campaigns/${encodeURIComponent(campaignId)}/rules-versions/${encodeURIComponent(rulesVersionId)}/activate`,
			{headers: await this.getMutationHeaders()},
		);
		expect(activated.ok(), await activated.text()).toBe(true);
		return rulesVersionId;
	}

	async getCampaignContext (campaignId: string): Promise<any> {
		const response = await this.page.request.get(
			`/api/campaigns/${encodeURIComponent(campaignId)}/context`,
		);
		expect(response.ok(), await response.text()).toBe(true);
		return (await response.json()).context;
	}

	async gotoCampaign (campaignId: string): Promise<void> {
		await this.page.goto(`/campaign.html?id=${encodeURIComponent(campaignId)}`);
		await expect(this.page.locator("#campaign-content")).toBeVisible({timeout: 30_000});
	}

	private async openCampaignDisclosure (name: string): Promise<void> {
		const disclosure = this.page.locator(".hub-disclosure").filter({
			has: this.page.locator(":scope > summary").filter({hasText: name}),
		});
		if (!await disclosure.evaluate(element => (element as HTMLDetailsElement).open)) {
			await disclosure.locator(":scope > summary").click();
		}
	}

	private async openCampaignWorkbench (): Promise<void> {
		await this.openCampaignDisclosure("Campaign actions");
	}

	async createInvite (campaignId: string, role = "player"): Promise<string> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignDisclosure("People and invitations");
		await this.page.locator("#campaign-invite-role").selectOption(role);
		await this.page.locator("#campaign-invite-form button[type='submit']").click();
		const output = this.page.locator("#campaign-invite-output");
		await expect(output).not.toHaveValue("");
		return output.inputValue();
	}

	async expectRulesPolicySelectionJourney (campaignId: string): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignDisclosure("Rules and homebrew");
		const manager = this.page.locator("#campaign-rules-policy-manager");
		await expect(manager).toBeVisible();
		await expect(this.page.locator("#campaign-rules-policy-loading")).toBeHidden();
		await expect(this.page.locator("#campaign-rules-form")).toBeHidden();
		await expect(this.page.locator("#campaign-rules-list .hub-rule-row")).toHaveCount(10);
		await expect(this.page.locator("#campaign-rules-list .hub-rule-status--enforced")).toHaveCount(5);
		await expect(this.page.locator(".hub-rule-status--planned")).toHaveCount(0);
		await expect(manager).toContainText("Enforced");
		await expect(this.page.locator("#campaign-rules-list .hub-rule-status--advisory")).toHaveCount(5);

		const search = this.page.locator("#campaign-rules-search");
		await search.fill("jumping");
		await expect(this.page.locator("#campaign-rules-list .hub-rule-row")).toHaveCount(1);
		await search.fill("no matching campaign rule");
		await expect(this.page.locator("#campaign-rules-empty")).toBeVisible();
		await search.fill("");
		await this.page.locator("#campaign-rules-support").selectOption("advisory");
		await expect(this.page.locator("#campaign-rules-list .hub-rule-row")).toHaveCount(5);
		await this.page.locator("#campaign-rules-support").selectOption("all");

		const jumping = this.page.locator("[data-campaign-rule-control='tgtt.jumping']");
		await jumping.uncheck();
		await expect(this.page.locator("#campaign-rules-review-list")).toContainText("Thelemar jumping");
		await expect(this.page.locator("#campaign-rules-review-list")).toContainText("On to Off");

		await this.page.setViewportSize({width: 390, height: 844});
		const mobileAudit = await manager.evaluate(element => {
			const rect = element.getBoundingClientRect();
			const labels = [...element.querySelectorAll<HTMLElement>(".hub-rule-row__control .hub-setting")];
			return {
				right: Math.ceil(rect.right),
				viewportWidth: document.documentElement.clientWidth,
				labelHeights: labels.map(label => Math.round(label.getBoundingClientRect().height)),
			};
		});
		expect(mobileAudit.right).toBeLessThanOrEqual(mobileAudit.viewportWidth);
		expect(mobileAudit.labelHeights.every(height => height >= 44)).toBe(true);
		await search.focus();
		await expect(search).toBeFocused();
		await this.page.setViewportSize({width: 1280, height: 720});

		await this.page.locator("#campaign-rules-activate").click();
		await expect(this.page.locator("#campaign-rules-policy-status")).toContainText("Version 1 is active");
		await expect(this.page.locator("#campaign-policy-summary")).toContainText("Thelemar jumping");
		await expect(this.page.locator("#campaign-policy-summary")).toContainText("Off · Advisory");

		await this.page.locator("[data-campaign-rule-control='tgtt.critical-rolls']").uncheck();
		await expect(this.page.locator("#campaign-rules-review-list")).toContainText("Thelemar critical rolls");
		await this.page.context().setOffline(true);
		await expect(this.page.locator("#campaign-rules-policy-status")).toContainText("Offline");
		await expect(this.page.locator("#campaign-rules-activate")).toBeDisabled();
		await this.page.context().setOffline(false);
		await expect(this.page.locator("#campaign-rules-policy-status")).toContainText("Back online");
		await expect(this.page.locator("#campaign-rules-activate")).toBeDisabled();
		await this.page.reload();
		await expect(this.page.locator("#campaign-content")).toBeVisible();
		await this.openCampaignDisclosure("Rules and homebrew");
		await expect(manager).toBeVisible();

		const managementResponse = await this.page.request.get(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-policy`);
		expect(managementResponse.ok()).toBe(true);
		const managementBody = await managementResponse.json();
		const active = managementBody.management.versions.find((version: any) => version.id === managementBody.management.activeRulesVersionId);
		const externalPolicy = structuredClone(active.policy);
		externalPolicy.rules.find((rule: any) => rule.id === "tgtt.linguistics-bonus").parameters.enabled = false;
		const externalPublish = await this.page.request.post(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-policy`, {
			headers: await this.getMutationHeaders(),
			data: {policy: externalPolicy, expectedActiveRulesVersionId: active.id},
		});
		expect(externalPublish.status()).toBe(201);

		await this.page.locator("[data-campaign-rule-control='tgtt.critical-rolls']").uncheck();
		await this.page.locator("#campaign-rules-activate").click();
		await expect(this.page.locator("#campaign-rules-policy-status")).toContainText("Your draft is preserved");
		await expect(this.page.locator("#campaign-rules-review-list")).toContainText("Thelemar critical rolls");

		await this.page.reload();
		await expect(this.page.locator("#campaign-content")).toBeVisible();
		await this.openCampaignDisclosure("Rules and homebrew");
		await expect(manager).toBeVisible();
		await expect(this.page.locator("#campaign-rules-history")).toBeEnabled();
		const versionOneValue = await this.page.locator("#campaign-rules-history option", {hasText: "Version 1"}).getAttribute("value");
		expect(versionOneValue).toBeTruthy();
		await this.page.locator("#campaign-rules-history").selectOption(versionOneValue!);
		await expect(this.page.locator("#campaign-rules-rollback-review")).toContainText("Linguistics bonus");
		await this.page.locator("#campaign-rules-rollback").click();
		await expect(this.page.locator("#campaign-rules-policy-status")).toContainText("Version 1 is active again");
	}

	async expectReadOnlyCampaignPolicySummary (campaignId: string): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignDisclosure("Rules and homebrew");
		const summary = this.page.locator("#campaign-policy-summary");
		await expect(summary).toBeVisible();
		await expect(summary).toContainText("Version 1");
		await expect(summary).toContainText("Thelemar jumping");
		await expect(summary).toContainText("Off · Advisory");
		await expect(this.page.locator("#campaign-rules-policy-manager")).toBeHidden();
		await expect(this.page.locator("#campaign-rules-form")).toBeHidden();
		await expect(summary).not.toContainText(/account|created by|note/i);
	}

	async publishCampaignRuleViaApi ({
		campaignId,
		ruleId,
		parameter,
		value,
	}: {
		campaignId: string;
		ruleId: string;
		parameter: string;
		value: boolean | string;
	}): Promise<void> {
		const managementResponse = await this.page.request.get(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-policy`);
		expect(managementResponse.ok()).toBe(true);
		const {management} = await managementResponse.json();
		const active = management.versions.find((version: any) => version.id === management.activeRulesVersionId);
		const policy = structuredClone(active.policy);
		policy.rules.find((rule: any) => rule.id === ruleId).parameters[parameter] = value;
		const response = await this.page.request.post(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-policy`, {
			headers: await this.getMutationHeaders(),
			data: {policy, expectedActiveRulesVersionId: active.id},
		});
		expect(response.status()).toBe(201);
	}

	async publishContentPolicyViaApi ({
		campaignId,
		sources,
		species,
		editions,
	}: {
		campaignId: string;
		sources: string[];
		species: string[];
		editions: Array<"2014" | "2024">;
	}): Promise<{rulesVersionId: string; previousRulesVersionId: string}> {
		const managementResponse = await this.page.request.get(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-policy`);
		expect(managementResponse.ok()).toBe(true);
		const {management} = await managementResponse.json();
		const active = management.versions.find((version: any) => version.id === management.activeRulesVersionId);
		expect(active).toBeTruthy();
		const policy = structuredClone(active.policy);
		policy.rules.find((rule: any) => rule.id === "content.sources.allowed").parameters.sources = sources;
		policy.rules.find((rule: any) => rule.id === "content.species.allowed").parameters.species = species;
		policy.rules.find((rule: any) => rule.id === "content.editions.allowed").parameters.editions = editions;
		const response = await this.page.request.post(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-policy`, {
			headers: await this.getMutationHeaders(),
			data: {policy, expectedActiveRulesVersionId: active.id},
		});
		const published = await response.json();
		expect(response.status(), JSON.stringify(published)).toBe(201);
		return {rulesVersionId: published.rulesVersion.id, previousRulesVersionId: active.id};
	}

	async activateRulesPolicyVersionViaApi ({
		campaignId,
		rulesVersionId,
		expectedActiveRulesVersionId,
	}: {
		campaignId: string;
		rulesVersionId: string;
		expectedActiveRulesVersionId: string;
	}): Promise<void> {
		const response = await this.page.request.post(`/api/campaigns/${encodeURIComponent(campaignId)}/rules-policy/activate`, {
			headers: await this.getMutationHeaders(),
			data: {rulesVersionId, expectedActiveRulesVersionId},
		});
		expect(response.ok(), await response.text()).toBe(true);
	}

	async expectLiveCampaignPolicySummary ({title, value}: {title: string; value: string}): Promise<void> {
		const summary = this.page.locator("#campaign-policy-summary");
		await expect(summary).toContainText(title);
		await expect(summary).toContainText(value);
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
		await this.page.waitForURL(/campaign\.html\?id=/, {timeout: 30_000});
		const campaignId = new URL(this.page.url()).searchParams.get("id")!;
		await expect(this.page.locator("#campaign-content")).toBeVisible({timeout: 30_000});
		await expect(this.page.locator("#campaign-name")).toHaveText(campaignName);
		await this.waitForSelectedCampaign(campaignId);
	}

	async createCharacter ({
		campaignId,
		name,
		hpCurrent = 12,
		features = [],
		className = "Fighter",
		classSource = "PHB",
		race = null,
		spellsKnown = [],
		rulesVersionId = null,
		inventory = null,
	}: {
		campaignId: string;
		name: string;
		hpCurrent?: number;
		features?: Array<{name: string; source: string}>;
		className?: string;
		classSource?: string;
		race?: {name: string; source: string; edition?: string} | null;
		spellsKnown?: Array<{
			id?: string;
			name: string;
			source: string;
			level: number;
			prepared?: boolean;
			sourceClass?: string;
			sourceFeature?: string;
		}>;
		rulesVersionId?: string | null;
		inventory?: Array<Record<string, unknown>> | null;
	}): Promise<any> {
		const response = await this.page.request.post("/api/characters", {
			headers: await this.getMutationHeaders(),
			data: {
				clientImportId: `e2e-${crypto.randomUUID()}`,
				campaignId,
				schemaVersion: 1,
				...(rulesVersionId ? {rulesVersionId} : {}),
				data: {
					name,
					abilities: {str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10},
					abilityBonuses: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0},
					...(race ? {race} : {}),
					classes: [{name: className, source: classSource, level: 1}],
					xp: 0,
					hp: {current: hpCurrent, max: 12, temp: 0},
					features,
					spellcasting: {
						ability: "wis",
						spellSlots: {1: {current: 2, max: 2}},
						...(spellsKnown.length ? {spellsKnown, cantripsKnown: []} : {}),
					},
					conditions: [],
					inventory: inventory || [{id: "rations", item: {name: "Rations", source: "PHB"}, quantity: 5}],
					currency: {cp: 8, sp: 6, ep: 4, gp: 10, pp: 2},
				},
			},
		});
		expect(response.ok()).toBe(true);
		return (await response.json()).character;
	}

	async cloneCharacterViaApi ({characterId, campaignId}: {characterId: string; campaignId: string}): Promise<any> {
		const response = await this.page.request.post(`/api/characters/${encodeURIComponent(characterId)}/clone`, {
			headers: await this.getMutationHeaders(),
			data: {campaignId},
		});
		expect(response.ok(), await response.text()).toBe(true);
		return (await response.json()).character;
	}

	async moveCharacterViaApi ({characterId, campaignId}: {characterId: string; campaignId: string}): Promise<any> {
		const response = await this.page.request.post(`/api/characters/${encodeURIComponent(characterId)}/move`, {
			headers: await this.getMutationHeaders(),
			data: {campaignId},
		});
		expect(response.ok(), await response.text()).toBe(true);
		return (await response.json()).character;
	}

	async archiveCharacterViaApi (characterId: string): Promise<void> {
		const response = await this.page.request.delete(`/api/characters/${encodeURIComponent(characterId)}`, {
			headers: await this.getMutationHeaders(),
		});
		expect(response.ok(), await response.text()).toBe(true);
	}

	async expectDirectCharacterAdmissionRejected ({
		campaignId,
		rulesVersionId,
		name,
		source,
	}: {
		campaignId: string;
		rulesVersionId: string;
		name: string;
		source: string;
	}): Promise<void> {
		const response = await this.page.request.post("/api/characters", {
			headers: await this.getMutationHeaders(),
			data: {
				clientImportId: `e2e-denied-${crypto.randomUUID()}`,
				campaignId,
				rulesVersionId,
				schemaVersion: 1,
				data: {
					name,
					abilities: {str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10},
					classes: [{name: "Fighter", source, level: 1}],
					hp: {current: 12, max: 12, temp: 0},
					inventory: [],
				},
			},
		});
		expect(response.status()).toBe(409);
		const body = await response.json();
		expect(body.error).toBe("CONTENT_POLICY_VIOLATION");
		expect(JSON.stringify(body)).not.toContain(name);
	}

	async createPeerEffect ({
		campaignId,
		sourceCharacterId,
		targetRef,
		amount,
	}: {
		campaignId: string;
		sourceCharacterId: string;
		targetRef: string;
		amount: number;
	}): Promise<any> {
		const commandId = crypto.randomUUID();
		const response = await this.page.request.post(`/api/campaigns/${encodeURIComponent(campaignId)}/actions`, {
			headers: {...await this.getMutationHeaders(), "idempotency-key": commandId},
			data: {
				commandId,
				sourceCharacterId,
				sourceEntity: {type: "ability", uid: "steadying word|phb", version: "tst-v1"},
				effectTemplateId: "ability.steadying-word.heal",
				choice: {amount},
				targetRef,
			},
		});
		expect(response.status()).toBe(201);
		return response.json();
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

	async expectLocalCharacterCopyRejectedByContentPolicy ({
		campaignId,
		name,
		source,
	}: {
		campaignId: string;
		name: string;
		source: string;
	}): Promise<void> {
		const localId = `local-denied-${crypto.randomUUID()}`;
		const localCharacter = {
			id: localId,
			name,
			abilities: {str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10},
			classes: [{name: "Fighter", source, level: 1}],
			hp: {current: 12, max: 12, temp: 0},
			inventory: [],
		};
		await this.page.goto("/charactersheet.html?local=1");
		await waitForToolsLoaded(this.page);
		await this.page.evaluate(
			async character => (window as any).StorageUtil.pSet("charsheet-characters", [character]),
			localCharacter,
		);
		await this._gotoCharacterSheetAndWaitForName({
			path: `/charactersheet.html?local=1&id=${encodeURIComponent(localId)}`,
			name,
		});
		const toggle = this.page.locator("#charsheet-campaign button[aria-controls='charsheet-campaign-panel']");
		await expect(toggle).toHaveText("Add to campaign");
		await toggle.click();
		await this.page.locator("#charsheet-campaign-panel select").selectOption(campaignId);
		await this.page.locator("#charsheet-campaign-panel button", {hasText: "Create cloud copy"}).click();
		await expect(this.page.locator("#charsheet-campaign [role='alert']")).toContainText("adds content the campaign does not allow");
		expect(new URL(this.page.url()).searchParams.get("id")).toBe(localId);
		expect(new URL(this.page.url()).searchParams.get("local")).toBe("1");
		const localCharacters = await this.page.evaluate(
			async () => (window as any).StorageUtil.pGet("charsheet-characters"),
		);
		expect(localCharacters).toContainEqual(expect.objectContaining({id: localId, name}));
	}

	async seedLocalCharacterForCampaignImport ({name}: {name: string}): Promise<string> {
		const localId = `local-context-${crypto.randomUUID()}`;
		await this.page.goto("/charactersheet.html?local=1");
		await waitForToolsLoaded(this.page);
		await this.page.evaluate(
			async character => (window as any).StorageUtil.pSet("charsheet-characters", [character]),
			{
				id: localId,
				name,
				abilities: {str: 10, dex: 10, con: 14, int: 10, wis: 10, cha: 10},
				classes: [{name: "Fighter", source: "PHB", level: 1}],
				race: {name: "Human (Base)", source: "PHB", edition: "classic"},
				hp: {current: 12, max: 12, temp: 0},
				inventory: [],
			},
		);
		return localId;
	}

	async expectCurrentRulesVersionUsedForImportAndAward ({
		campaignId,
		rulesVersionId,
		localCharacterName,
	}: {
		campaignId: string;
		rulesVersionId: string;
		localCharacterName: string;
	}): Promise<void> {
		await expect(this.page.locator("#campaign-policy-summary-status")).toContainText("Version 2", {timeout: 30_000});

		const createRequest = this.page.waitForRequest(request =>
			request.method() === "POST"
			&& new URL(request.url()).pathname === "/api/characters",
		);
		await this.page.locator("#campaign-upload-local").click();
		await expect(this.page.locator("#campaign-upload-local-select")).toBeFocused();
		await this.page.locator("#campaign-upload-local-select").selectOption({label: localCharacterName});
		await this.page.locator("#campaign-upload-local-confirm").click();
		expect((await createRequest).postDataJSON()).toEqual(expect.objectContaining({rulesVersionId}));
		await expect(this.page.locator("#campaign-upload-local-status")).toContainText(`${localCharacterName} was added as a cloud copy`);

		await this.openCampaignWorkbench();
		await this.page.locator("#campaign-item-search").fill("Dagger");
		await this.page.locator("#campaign-item-results").selectOption({label: "Dagger — PHB"});
		await this.page.locator("#campaign-item-use-selection").click();
		await expect(this.page.locator("#campaign-item-selection-summary")).toContainText("Dagger · PHB");
		await this.selectItemAwardTargets([localCharacterName]);
		await this.page.locator("#campaign-item-quantity").fill("1");
		await expect(this.page.locator("#campaign-item-form button[type='submit']")).toBeEnabled();
		const awardRequest = this.page.waitForRequest(request =>
			request.method() === "POST"
			&& new URL(request.url()).pathname === `/api/campaigns/${campaignId}/item-awards`,
		);
		await this.page.locator("#campaign-item-form button[type='submit']").click();
		expect((await awardRequest).postDataJSON()).toEqual(expect.objectContaining({rulesVersionId}));
		await expect(this.page.locator("#campaign-item-form-status")).toContainText("1 × Dagger awarded");
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
	}): Promise<{idempotencyKey: string; rulesVersionId: string | null}> {
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
		const requestData = moveResponse.request().postDataJSON() as {campaignId?: string; rulesVersionId?: string | null};
		expect(idempotencyKey).toBeTruthy();
		expect(requestData.campaignId).toBe(targetCampaignId);
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
		return {idempotencyKey, rulesVersionId: requestData.rulesVersionId ?? null};
	}

	async acquireCharacterLease (characterId: string): Promise<void> {
		const response = await this.page.request.post(`/api/characters/${encodeURIComponent(characterId)}/lease`, {
			headers: await this.getMutationHeaders(),
			data: {takeover: false},
		});
		expect(response.ok()).toBe(true);
		const {lease} = await response.json();
		this._characterLeases.set(characterId, lease);
	}

	async releaseCharacterLease (characterId: string): Promise<void> {
		let lease = this._characterLeases.get(characterId) || await this.page.evaluate(id => {
			const charSheet = (window as any).charSheet;
			return charSheet?._characterRepository?._leases?.get(id) || null;
		}, characterId);
		if (!lease) {
			await this.acquireCharacterLease(characterId);
			lease = this._characterLeases.get(characterId);
		}
		expect(lease).toBeTruthy();
		const response = await this.page.request.post(`/api/characters/${encodeURIComponent(characterId)}/lease/release`, {
			headers: await this.getLeaseReleaseHeaders(),
			data: {leaseEpoch: lease.epoch, expiresAt: lease.expiresAt},
		});
		const responseBody = await response.text();
		expect(
			response.ok(),
			`Lease release failed with HTTP ${response.status()}: ${responseBody}`,
		).toBe(true);
		expect(JSON.parse(responseBody).released).toEqual(expect.any(Boolean));
		this._characterLeases.delete(characterId);
	}

	async replayCharacterMove ({
		characterId,
		campaignId,
		idempotencyKey,
		rulesVersionId,
	}: {
		characterId: string;
		campaignId: string;
		idempotencyKey: string;
		rulesVersionId: string | null;
	}): Promise<any> {
		const headers = await this.getMutationHeaders();
		headers["idempotency-key"] = idempotencyKey;
		const response = await this.page.request.post(`/api/characters/${encodeURIComponent(characterId)}/move`, {
			headers,
			data: {campaignId, rulesVersionId},
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
			const failures = await Promise.all(responses.map(async (response, offset) => response.ok()
				? null
				: {
					index: chunk[offset],
					status: response.status(),
					body: await response.text(),
				}));
			expect(failures.filter(Boolean), "Every load-test roll request must commit successfully.").toEqual([]);
		}
	}

	async getEvents (campaignId: string, limit = 500): Promise<any[]> {
		const response = await this.page.request.get(`/api/campaigns/${encodeURIComponent(campaignId)}/events?afterSequence=0&limit=${limit}`, {
			headers: {"x-hub-protocol-version": "6"},
		});
		expect(response.ok()).toBe(true);
		return (await response.json()).events;
	}

	async getCampaignSnapshot (campaignId: string): Promise<any> {
		const response = await this.page.request.get(`/api/campaigns/${encodeURIComponent(campaignId)}/snapshot`, {
			headers: {"x-hub-protocol-version": "3"},
		});
		expect(response.ok()).toBe(true);
		return (await response.json()).snapshot;
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

	async getProjectionPolicy (characterId: string): Promise<any> {
		const response = await this.page.request.get(`/api/characters/${encodeURIComponent(characterId)}/projection-policy`, {
			headers: {"x-hub-protocol-version": "3"},
		});
		expect(response.ok()).toBe(true);
		return response.json();
	}

	async setProjectionPolicyRaw (
		{characterId, policy, expectedProjectionRevision}: {characterId: string; policy: any; expectedProjectionRevision: number},
	): Promise<{status: number; body: any}> {
		const response = await this.page.request.put(`/api/characters/${encodeURIComponent(characterId)}/projection-policy`, {
			headers: await this.getMutationHeaders(),
			data: {policy, expectedProjectionRevision},
		});
		return {status: response.status(), body: await response.json()};
	}

	async setProjectionPolicy (
		args: {characterId: string; policy: any; expectedProjectionRevision: number},
	): Promise<any> {
		const result = await this.setProjectionPolicyRaw(args);
		expect(result.status).toBe(200);
		return result.body;
	}

	/**
	 * Drive the real sharing controls and the real Save button.
	 *
	 * Direct API helpers cannot cover this: they attach their own mutation headers, so a
	 * client that forgets CSRF/idempotency still passes. Only clicking Save exercises the
	 * request the browser actually sends.
	 */
	async changeSharingPresetAndSave ({preset, expectPreviewText}: {preset: string; expectPreviewText: string}): Promise<void> {
		const sharing = this.page.locator(".charsheet__sharing");
		await expect(sharing).toBeVisible();
		await sharing.locator(`input[name='charsheet-sharing-preset'][value='${preset}']`).check();
		await sharing.locator(".charsheet__sharing-save").click();
		await expect(sharing.locator(".charsheet__sharing-feedback--success")).toHaveText("Sharing settings saved.");
		await expect(sharing.locator(".charsheet__sharing-preview")).toContainText(expectPreviewText);
	}

	/** Set one field to "Show instead" and save, exercising the generated typed controls. */
	async replaceSharedFieldAndSave ({field, expectPreviewText}: {field: string; expectPreviewText: string}): Promise<void> {
		const sharing = this.page.locator(".charsheet__sharing");
		await sharing.locator(`input[name='charsheet-sharing-${field}'][value='replace']`).check();
		await expect(sharing.locator(".charsheet__sharing-replacement").first()).toBeVisible();
		await sharing.locator(".charsheet__sharing-save").click();
		await expect(sharing.locator(".charsheet__sharing-feedback--success")).toHaveText("Sharing settings saved.");
		await expect(sharing.locator(".charsheet__sharing-preview")).toContainText(expectPreviewText);
	}

	/**
	 * The owner's sharing controls must be usable without reading JSON or ids, and the
	 * preview must reflect the server's own peer profile.
	 */
	async expectSharingControls ({previewText}: {previewText: string}): Promise<void> {
		const sharing = this.page.locator(".charsheet__sharing");
		await expect(sharing).toBeVisible();
		await expect(sharing.locator(".charsheet__sharing-presets legend")).toHaveText("Sharing level");
		await expect(sharing.locator("input[name='charsheet-sharing-preset'][value='minimal']")).toBeChecked();
		await expect(sharing.locator(".charsheet__sharing-preview")).toContainText(previewText);
		// Nothing on screen exposes the raw policy shape or an internal identifier.
		const text = (await sharing.innerText()).toLowerCase();
		expect(text).not.toContain("\"mode\"");
		expect(text).not.toContain("projectionrevision");
	}

	async expectSavedSharingPreview ({
		sharedText,
		replacedText,
		omittedText,
	}: {
		sharedText: string;
		replacedText: string;
		omittedText: string;
	}): Promise<void> {
		const preview = this.page.locator(".charsheet__sharing-preview");
		await expect(preview).toContainText(sharedText);
		await expect(preview.locator(".charsheet__sharing-preview-status--replace")).toHaveText("Shown instead");
		await expect(preview.locator(".charsheet__sharing-preview-status--replace").locator("xpath=..")).toContainText(replacedText);
		await expect(preview.locator(".charsheet__sharing-preview-omitted")).toContainText(omittedText);
	}

	async expectSharedProfile ({
		campaignId,
		characterName,
		expectedText,
		forbiddenText = [],
	}: {
		campaignId: string;
		characterName: string;
		expectedText: string[];
		forbiddenText?: string[];
	}): Promise<void> {
		await this.page.setViewportSize({width: 390, height: 844});
		await this.gotoCampaign(campaignId);
		const details = this.page.locator("#campaign-party-roster .hub-shared-profile").filter({hasText: characterName}).first();
		const summary = details.locator(":scope > summary");
		await expect(summary).toBeVisible();
		await expect(summary).toContainText("View shared profile");
		await expect(details.locator("a[href*='charactersheet.html']")).toHaveCount(0);
		await summary.focus();
		await summary.press("Enter");
		await expect(details).toHaveAttribute("open", "");
		for (const text of expectedText) await expect(details.locator(".hub-shared-profile__body")).toContainText(text);
		for (const text of forbiddenText) await expect(details.locator(".hub-shared-profile__body")).not.toContainText(text);
		const audit = await details.evaluate(element => {
			const summaryRect = element.querySelector("summary")!.getBoundingClientRect();
			return {
				clientWidth: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
				summaryHeight: summaryRect.height,
			};
		});
		expect(audit.scrollWidth).toBeLessThanOrEqual(audit.clientWidth);
		expect(audit.summaryHeight).toBeGreaterThanOrEqual(44);
		await this.page.setViewportSize({width: 1280, height: 720});
	}

	/** The raw ADR 0011 authorization envelope for a character. */
	async getCharacterProjection (characterId: string): Promise<any> {
		const response = await this.page.request.get(`/api/characters/${encodeURIComponent(characterId)}`, {
			headers: {"x-hub-protocol-version": "3"},
		});
		expect(response.ok()).toBe(true);
		return (await response.json()).projection;
	}

	async getCharacter (characterId: string): Promise<any> {
		const projection = await this.getCharacterProjection(characterId);
		expect(["owner_truth", "dm_truth"]).toContain(projection.kind);
		return projection.character;
	}

	async openCharacterSheet ({campaignId, characterId, name}: {campaignId: string; characterId: string; name: string}): Promise<void> {
		await this._gotoCharacterSheetAndWaitForName({
			path: `/charactersheet.html?id=${encodeURIComponent(characterId)}&hubCampaign=${encodeURIComponent(campaignId)}`,
			name,
		});
	}

	async waitForCharacterRealtimeLive (): Promise<void> {
		await expect.poll(
			() => this.page.evaluate(() => (window as any).charSheet?._hubRealtime?._active?.client?.getConnectionState?.().state),
			{timeout: 15_000},
		).toBe("live");
	}

	async waitForPeerTargetingReady (): Promise<void> {
		await expect.poll(
			() => this.page.evaluate(() => (window as any).charSheet?._peerTargeting?._hasCapability?.() === true),
			{timeout: 15_000},
		).toBe(true);
	}

	async expectPeerTargetingUnavailable (): Promise<void> {
		await expect.poll(
			() => this.page.evaluate(() => {
				const targeting = (window as any).charSheet?._peerTargeting;
				return {
					hasCapability: targeting?._hasCapability?.() === true,
					phbSupported: targeting?.isSupportedSpellCast?.({
						spell: {name: "Cure Wounds", source: "PHB", level: 1},
						selectedSlot: {level: 1},
					}) === true,
					xphbSupported: targeting?.isSupportedSpellCast?.({
						spell: {name: "Cure Wounds", source: "XPHB", level: 1},
						selectedSlot: {level: 1},
					}) === true,
				};
			}),
			{timeout: 15_000},
		).toEqual({hasCapability: false, phbSupported: false, xphbSupported: false});
	}

	async castSpellAtPeerTarget ({spellName, targetName}: {spellName: string; targetName: string}): Promise<void> {
		await this.page.locator('a[href="#charsheet-tab-spells"]').click();
		const spell = this.page.locator(".charsheet__spell-item").filter({hasText: spellName}).first();
		await expect(spell).toBeVisible();
		const castControl = spell.locator(".charsheet__spell-cast");
		await castControl.click();
		const picker = this.page.locator(".charsheet__peer-target-picker");
		await expect(picker).toBeVisible();
		const dialog = this.page.getByRole("dialog", {name: `Target ${spellName}`});
		await expect(dialog).toHaveAttribute("aria-modal", "true");
		await expect(picker).toContainText("within touch range");
		await expect(picker).toContainText("Hidden hit points and applicability are checked privately");
		if ((await this.page.viewportSize())?.width === 390) {
			const box = await dialog.boundingBox();
			expect(box).not.toBeNull();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(390);
		}
		const targetControl = picker.getByRole("button", {name: `Request ${spellName} for ${targetName}`});
		await targetControl.focus();
		await expect(targetControl).toBeFocused();
		await targetControl.press("Enter");
		await expect(picker).toBeHidden();
		await expect(castControl).toBeFocused();
		await expect.poll(
			() => this.page.evaluate(({expectedSpellName, expectedTargetName}) => {
				const targeting = (window as any).charSheet?._peerTargeting;
				return {
					outgoing: [...(targeting?._outgoing?.values?.() || [])]
						.map((action: any) => `${action.presentation?.effectLabel} -> ${action.presentation?.targetName}`),
					draftErrors: [...(targeting?._drafts?.values?.() || [])]
						.filter((draft: any) => draft.error)
						.map((draft: any) => ({code: draft.errorCode, message: draft.error})),
					expected: `${expectedSpellName} -> ${expectedTargetName}`,
				};
			}, {expectedSpellName: spellName, expectedTargetName: targetName}),
			{timeout: 20_000},
		).toMatchObject({
			outgoing: expect.arrayContaining([`${spellName} -> ${targetName}`]),
			draftErrors: [],
		});
	}

	async resolveIncomingPeerSpell ({spellName, decision}: {spellName: string; decision: "Approve" | "Reject"}): Promise<void> {
		const approvals = this.page.locator("#charsheet-hub-effects");
		await expect.poll(
			() => this.page.evaluate(async expectedSpellName => {
				const sheet = (window as any).charSheet;
				const actions = await sheet?._hubCampaignContext?.api?.pListCharacterPendingActions?.({
					campaignId: sheet?._hubCampaignId,
					characterId: sheet?._currentCharacterId,
				});
				return {
					projected: (actions || []).map((action: any) => action.presentation?.effectLabel),
					rendered: [...(sheet?._hubEffects?._actions?.values?.() || [])]
						.map((action: any) => action.presentation?.effectLabel),
					expectedSpellName,
				};
			}, spellName),
			{timeout: 20_000},
		).toMatchObject({
			projected: expect.arrayContaining([spellName]),
			rendered: expect.arrayContaining([spellName]),
		});
		const control = approvals.getByRole("button", {name: new RegExp(`^${decision} ${spellName}`)}).last();
		await expect(control).toBeVisible();
		await control.click();
		await expect(control).toBeHidden({timeout: 20_000});
	}

	async expectOutgoingPeerSpellStatus ({
		spellName,
		targetName,
		status,
	}: {
		spellName: string;
		targetName: string;
		status: "applied" | "rejected" | "cancelled" | "expired" | "failed";
	}): Promise<void> {
		await expect.poll(
			() => this.page.evaluate(({expectedSpellName, expectedTargetName}) => {
				const actions = [...((window as any).charSheet?._peerTargeting?._outgoing?.values?.() || [])];
				return actions
					.filter((action: any) =>
						action.presentation?.effectLabel === expectedSpellName
						&& action.presentation?.targetName === expectedTargetName)
					.map((action: any) => action.status);
			}, {expectedSpellName: spellName, expectedTargetName: targetName}),
			{timeout: 20_000},
		).toContain(status);
	}

	async cancelOutgoingPeerSpell ({spellName, targetName}: {spellName: string; targetName: string}): Promise<void> {
		const outgoing = this.page.locator("#charsheet-peer-targeting");
		const control = outgoing.getByRole("button", {name: `Cancel ${spellName} request for ${targetName}`}).last();
		await expect(control).toBeVisible({timeout: 20_000});
		await control.click();
		await this.expectOutgoingPeerSpellStatus({spellName, targetName, status: "cancelled"});
	}

	async expectLiveAwardArrival ({
		itemName,
		source,
		quantity,
		reason,
	}: {
		itemName: string;
		source: string;
		quantity: number;
		reason?: string;
	}): Promise<void> {
		const notice = `Received ${quantity > 1 ? `${quantity}× ` : ""}${itemName}${reason ? ` — ${reason}` : ""}.`;
		await expect(this.page.locator(".toast__wrp-content").filter({hasText: notice})).toBeVisible({timeout: 15_000});
		await expect.poll(() => this.page.evaluate(
			({itemNameNxt, sourceNxt}) => {
				const inventory = (window as any).charSheet?._state?._data?.inventory || [];
				return inventory
					.filter((entry: any) => entry.item?.name === itemNameNxt && entry.item?.source === sourceNxt)
					.reduce((total: number, entry: any) => total + Number(entry.quantity || 0), 0);
			},
			{itemNameNxt: itemName, sourceNxt: source},
		), {timeout: 15_000}).toBe(quantity);
	}

	async expectLiveXpAwardArrival ({
		amount,
		totalXp,
		reason,
	}: {
		amount: number;
		totalXp: number;
		reason?: string;
	}): Promise<void> {
		const notice = `Received ${amount} XP (${totalXp} XP total)${reason ? ` — ${reason}` : ""}.`;
		await expect(this.page.locator(".toast__wrp-content").filter({hasText: notice})).toBeVisible({timeout: 15_000});
		await expect.poll(
			() => this.page.evaluate(() => Number((window as any).charSheet?._state?._data?.xp || 0)),
			{timeout: 15_000},
		).toBe(totalXp);
	}

	async expectActivitySurvivesRefresh ({
		campaignId,
		expectedText,
	}: {
		campaignId: string;
		expectedText: string[];
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		const activity = this.page.locator("#campaign-activity-list");
		for (const text of expectedText) await expect(activity).toContainText(text);
		await this.page.reload();
		await expect(this.page.locator("#campaign-content")).toBeVisible({timeout: 30_000});
		for (const text of expectedText) await expect(activity).toContainText(text);
	}

	async editCharacterHpAndRollInitiative ({
		campaignId,
		characterId,
		name,
		hp,
		rollVisibility = "all_members",
	}: {
		campaignId: string;
		characterId: string;
		name: string;
		hp: number;
		rollVisibility?: "all_members" | "actor_and_dm";
	}): Promise<void> {
		await this.openCharacterSheet({campaignId, characterId, name});
		await this.waitForCharacterRealtimeLive();
		await this.page.locator("#charsheet-ipt-hp-current").evaluate((input: HTMLInputElement, value) => {
			input.value = `${value}`;
			input.dispatchEvent(new Event("change", {bubbles: true}));
		}, hp);
		await expect.poll(async () => (await this.getCharacter(characterId)).data.hp.current, {timeout: 15_000}).toBe(hp);
		await this.page.locator("#charsheet-btn-rolllog").click();
		const visibility = this.page.locator("#charsheet-roll-history-visibility");
		await expect(visibility).toBeVisible();
		await visibility.selectOption(rollVisibility);
		await expect.poll(async () => (await this.getCharacter(characterId)).data.settings?.hubRollVisibility).toBe(rollVisibility);
		await this.page.locator(".charsheet__roll-history-btn", {hasText: "✕"}).click();
		await this.page.locator("#charsheet-box-initiative").click();
		await expect.poll(async () => (await this.getEvents(campaignId))
			.filter(event => event.type === "roll.logged" && event.aggregateId === characterId && event.visibility === rollVisibility)
			.length).toBeGreaterThan(0);
	}

	async switchCharacterAndExpectRollVisibility ({
		characterId,
		rollVisibility,
	}: {
		characterId: string;
		rollVisibility: "all_members" | "actor_and_dm";
	}): Promise<void> {
		const traceKey = "__hubE2eCharacterSwitchTrace";
		await this.page.evaluate(({targetCharacterId, key}) => {
			const sheet = (window as any).charSheet;
			if (!sheet?._pLoadCharacter) throw new Error("Character Sheet load handler is unavailable.");
			const originalLoad = sheet._pLoadCharacter;
			sheet[key] = {
				targetCharacterId,
				generationBefore: sheet._characterLoadGeneration,
				loadCalls: 0,
				loadResult: "not-started",
				loadError: null,
			};
			sheet._pLoadCharacter = async function (nextCharacterId: string) {
				if (nextCharacterId !== targetCharacterId) return originalLoad.call(this, nextCharacterId);
				const trace = this[key];
				trace.loadCalls++;
				trace.loadResult = "pending";
				try {
					const result = await originalLoad.call(this, nextCharacterId);
					trace.loadResult = result;
					return result;
				} catch (error) {
					trace.loadError = {
						name: error instanceof Error ? error.name : null,
						message: error instanceof Error ? error.message : `${error}`,
						code: (error as any)?.code ?? null,
					};
					throw error;
				} finally {
					this._pLoadCharacter = originalLoad;
				}
			};
		}, {targetCharacterId: characterId, key: traceKey});

		await this.page.locator("#charsheet-sel-character").selectOption(characterId);
		const getSwitchState = () => this.page.evaluate(({targetCharacterId, key}) => {
			const sheet = (window as any).charSheet;
			const trace = sheet?.[key] || {};
			const generationCurrent = sheet?._characterLoadGeneration ?? null;
			return {
				selectorValue: (document.querySelector("#charsheet-sel-character") as HTMLSelectElement | null)?.value ?? null,
				urlId: new URL(window.location.href).searchParams.get("id"),
				currentCharacterId: sheet?._currentCharacterId ?? null,
				loadCalls: trace.loadCalls ?? 0,
				loadResult: trace.loadResult ?? "missing",
				loadError: trace.loadError ?? null,
				generationBefore: trace.generationBefore ?? null,
				generationCurrent,
				generationDelta: Number.isInteger(trace.generationBefore) && Number.isInteger(generationCurrent)
					? generationCurrent - trace.generationBefore
					: null,
				targetCharacterId,
			};
		}, {targetCharacterId: characterId, key: traceKey});
		try {
			await expect.poll(async () => {
				const state = await getSwitchState();
				return {
					selectorValue: state.selectorValue,
					urlId: state.urlId,
					currentCharacterId: state.currentCharacterId,
					loadCalls: state.loadCalls,
					loadResult: state.loadResult,
					loadError: state.loadError,
					generationDelta: state.generationDelta,
				};
			}, {timeout: 5_000}).toEqual({
				selectorValue: characterId,
				urlId: characterId,
				currentCharacterId: characterId,
				loadCalls: 1,
				loadResult: true,
				loadError: null,
				generationDelta: 1,
			});
		} catch (error) {
			throw new Error(`Character switch did not converge: ${JSON.stringify(await getSwitchState())}`, {cause: error});
		}

		await this.page.locator("#charsheet-btn-rolllog").click();
		const visibility = this.page.locator("#charsheet-roll-history-visibility");
		await expect(visibility).toBeVisible();
		await expect(visibility).toHaveValue(rollVisibility);
		await this.page.locator(".charsheet__roll-history-btn", {hasText: "✕"}).click();
	}

	async rollInitiativeAndExpectVisibility ({
		campaignId,
		characterId,
		rollVisibility,
	}: {
		campaignId: string;
		characterId: string;
		rollVisibility: "all_members" | "actor_and_dm";
	}): Promise<void> {
		const countMatchingEvents = async () => (await this.getEvents(campaignId))
			.filter(event => event.type === "roll.logged" && event.aggregateId === characterId && event.visibility === rollVisibility)
			.length;
		const countBefore = await countMatchingEvents();
		await this.page.locator("#charsheet-box-initiative").click();
		await expect.poll(countMatchingEvents).toBe(countBefore + 1);
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
		await this.waitForCharacterRealtimeLive();
		await this.page.locator("#charsheet-ipt-hp-current").fill(`${hp}`);
		await this.page.locator("#charsheet-ipt-hp-current").blur();
		await expect(this.page.getByText("Character Changed on Another Device", {exact: true})).toBeVisible();
		await this.page.getByRole("button", {name: new RegExp(resolution)}).click();
		await expect(this.page.getByText("Character Changed on Another Device", {exact: true})).toBeHidden();
	}

	async editCharacterHpWhileOffline ({
		campaignId,
		characterId,
		name,
		hp,
	}: {
		campaignId: string;
		characterId: string;
		name: string;
		hp: number;
	}): Promise<void> {
		if (!this.page.url().includes(`/charactersheet.html?id=${encodeURIComponent(characterId)}`)) {
			await this.openCharacterSheet({campaignId, characterId, name});
		}
		await this.waitForCharacterRealtimeLive();
		await this.page.context().setOffline(true);
		await this.page.locator("#charsheet-ipt-hp-current").fill(`${hp}`);
		await this.page.locator("#charsheet-ipt-hp-current").blur();
		await expect(this.page.locator("#charsheet-save-indicator")).toHaveClass(/charsheet__save-indicator--error/);
		await expect(this.page.locator("#charsheet-save-indicator .charsheet__save-icon")).toHaveText("✗");
		await expect(this.page.locator("#charsheet-ipt-hp-current")).toHaveValue(`${hp}`);
	}

	async reconnectAndResolveCharacterConflict ({
		hp,
		resolution,
	}: {
		hp: number;
		resolution: "Use Local" | "Use Server";
	}): Promise<void> {
		await this.page.context().setOffline(false);
		await expect(this.page.getByText("Character Changed on Another Device", {exact: true})).toBeVisible({timeout: 20_000});
		await this.page.getByRole("button", {name: new RegExp(resolution)}).click();
		await expect(this.page.getByText("Character Changed on Another Device", {exact: true})).toBeHidden();
		await expect(this.page.locator("#charsheet-ipt-hp-current")).toHaveValue(`${hp}`);
		await expect(this.page.locator("#charsheet-save-indicator")).not.toHaveClass(/charsheet__save-indicator--error/);
		await expect(this.page.locator("#charsheet-save-indicator .charsheet__save-icon")).toHaveText("✓");
	}

	async expectCampaignCharacterHp ({characterName, hp, maxHp = 12}: {characterName: string; hp: number; maxHp?: number}): Promise<void> {
		const row = this.page.locator("#campaign-party-roster .hub-data-row").filter({hasText: characterName});
		await expect(row).toContainText(`HP ${hp}/${maxHp}`, {timeout: 15_000});
	}

	async expectLiveCharacterUpdateAndRoll ({characterName, hp}: {characterName: string; hp: number}): Promise<void> {
		await expect(this.page.locator("#campaign-connection-status")).toHaveText("Live updates connected");
		await this.expectCampaignCharacterHp({characterName, hp});
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

	async expectCampaignPartyTrackerProjection ({
		campaignId,
		name,
		campaignName = "Ashen March E2E",
	}: {
		campaignId: string;
		name: string;
		campaignName?: string;
	}): Promise<void> {
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
			await expect(this.page.locator("#dm-screen-hub-status")).toContainText(campaignName);
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

	async expectCampaignPartyTrackerHp (hp: number): Promise<void> {
		await expect.poll(
			() => this.page.evaluate(() => {
				const projection = (window as any).DM_SCREEN?._hubCharacterProjections?.[0];
				const data = projection?.character?.data || projection?.data || projection;
				return data?.hp?.current;
			}),
			{timeout: 15_000},
		).toBe(hp);
		await this.page.evaluate(() => {
			(window as any).HUB_E2E_PARTY_TRACKER.setHubCharacterProjections((window as any).DM_SCREEN._hubCharacterProjections);
		});
		await expect(this.page.locator("#hub-e2e-party-tracker [aria-label^='Hit points']").first())
			.toHaveAttribute("aria-label", new RegExp(`^Hit points ${hp}/`));
	}

	async expectCampaignDmScreenDenied (campaignId: string): Promise<void> {
		await this.page.goto(`/dmscreen.html?hubCampaign=${encodeURIComponent(campaignId)}`);
		await expect(this.page.locator(".dm-hub__banner--permission_denied")).toContainText("Only the campaign DM or a co-DM");
		await expect(this.page.locator("#dm-screen-workspace")).toBeHidden();
		await expect.poll(() => this.page.evaluate(() => !!(window as any).DM_SCREEN)).toBe(false);
	}

	async grantXp ({
		campaignId,
		characterName,
		amount,
		reason,
		recipientExpectation,
	}: {
		campaignId: string;
		characterName: string;
		amount: number;
		reason?: string;
		recipientExpectation?: () => Promise<void>;
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignWorkbench();
		await this.page.locator("#campaign-xp-target").selectOption({label: characterName});
		await this.page.locator("#campaign-xp-amount").fill(`${amount}`);
		if (reason) await this.page.locator("#campaign-xp-reason").fill(reason);
		const recipientResult = recipientExpectation
			? recipientExpectation().then(() => null, error => error)
			: Promise.resolve(null);
		await this.page.locator("#campaign-xp-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-xp-form button[type='submit']")).toBeEnabled();
		const recipientError = await recipientResult;
		if (recipientError) throw recipientError;
	}

	private async selectItemAwardTargets (characterNames: string[]): Promise<void> {
		for (const checkbox of await this.page.locator("#campaign-item-targets input[type='checkbox']").all()) {
			await checkbox.uncheck();
		}
		for (const characterName of characterNames) {
			const target = this.page.locator("#campaign-item-targets .hub-item-award__target", {hasText: characterName});
			await expect(target).toHaveCount(1);
			await target.locator("input[type='checkbox']").check();
		}
	}

	async awardCatalogItems ({
		campaignId,
		characterNames,
		itemName,
		source,
		quantity,
		note,
		beforeUseSelection,
		afterUncertainResponse,
		recipientExpectation,
	}: {
		campaignId: string;
		characterNames: string[];
		itemName: string;
		source: string;
		quantity: number;
		note?: string;
		beforeUseSelection?: () => Promise<void>;
		afterUncertainResponse?: () => Promise<void>;
		recipientExpectation?: () => Promise<void>;
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignWorkbench();
		await expect(this.page.locator("#campaign-transfer-source option")).toHaveText(["Party inventory"]);
		const catalogTab = this.page.locator("#campaign-item-source-catalog");
		const stashTab = this.page.locator("#campaign-item-source-stash");
		await catalogTab.focus();
		await catalogTab.press("End");
		await expect(stashTab).toHaveAttribute("aria-selected", "true");
		await expect(stashTab).toBeFocused();
		await stashTab.press("Home");
		await expect(catalogTab).toHaveAttribute("aria-selected", "true");
		await expect(catalogTab).toBeFocused();
		const search = this.page.locator("#campaign-item-search");
		await search.fill(itemName);
		await this.page.locator("#campaign-item-results").selectOption({label: `${itemName} — ${source}`});
		await beforeUseSelection?.();
		await this.page.locator("#campaign-item-use-selection").click();
		await expect(this.page.locator("#campaign-item-selection-summary")).toContainText(`${itemName} · ${source}`);
		await this.selectItemAwardTargets(characterNames);
		await this.page.locator("#campaign-item-quantity").fill(`${quantity}`);
		if (note) await this.page.locator("#campaign-item-note").fill(note);
		await expect(this.page.locator("#campaign-item-preview-summary"))
			.toHaveText(`${quantity} × ${itemName} for ${characterNames.length} recipient${characterNames.length === 1 ? "" : "s"}.`);
		await this.page.setViewportSize({width: 390, height: 844});
		await this._expectCurrentHubSurfaceAccessible();
		await this.page.setViewportSize({width: 1280, height: 720});

		const requestUrl = `**/api/campaigns/${campaignId}/item-awards`;
		const idempotencyKeys: string[] = [];
		const requestBodies: string[] = [];
		let attempt = 0;
		await this.page.route(requestUrl, async route => {
			idempotencyKeys.push(route.request().headers()["idempotency-key"]);
			requestBodies.push(JSON.stringify(route.request().postDataJSON()));
			if (++attempt !== 1) throw new Error(`Expired item-award recovery resubmitted the command (attempts=${attempt}).`);
			const committed = await route.fetch();
			expect(committed.ok()).toBe(true);
			await route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({error: "HUB_UNAVAILABLE"}),
			});
		});
		const form = this.page.locator("#campaign-item-form");
		const submit = form.locator("button[type='submit']");
		const status = this.page.locator("#campaign-item-form-status");
		let recipientResult = Promise.resolve<unknown>(null);
		try {
			recipientResult = recipientExpectation
				? recipientExpectation().then(() => null, error => error)
				: Promise.resolve(null);
			await submit.click();
			await expect(status).toContainText("could not be confirmed");
			await expect(submit).toBeEnabled();
			await expect(submit).toHaveText("Retry previous award");
			await expect(search).toBeDisabled();
			await expect(this.page.locator("#campaign-item-note")).toBeDisabled();
			await expect(this.page.locator("#campaign-item-quantity")).toBeDisabled();
			await expect(this.page.locator("#campaign-item-targets input[type='checkbox']").first()).toBeDisabled();
			await afterUncertainResponse?.();
			await this.page.evaluate(() => {
				const storageKey = Object.keys(sessionStorage).find(key => key.startsWith("hub-item-award-draft:"));
				if (!storageKey) throw new Error("The item-award recovery draft was not persisted.");
				const draft = JSON.parse(sessionStorage.getItem(storageKey) || "null");
				draft.replayUntil = 1;
				sessionStorage.setItem(storageKey, JSON.stringify(draft));
			});
			await this.page.reload({waitUntil: "domcontentloaded"});
			await this.openCampaignWorkbench();
			await expect(status).toContainText("previous award outcome is unknown");
			await expect(submit).toBeEnabled();
			await expect(submit).toHaveText("Retry previous award");
			await expect(search).toBeDisabled();

			await submit.click();
			await expect(status)
				.toHaveText("The previously submitted award was already committed. Latest inventories are loaded.", {timeout: 15_000});
			expect(idempotencyKeys).toHaveLength(1);
			expect(new Set(requestBodies)).toEqual(new Set([requestBodies[0]]));
			await expect.poll(() => form.evaluate(element => ({
				ariaBusy: element.getAttribute("aria-busy"),
				hasMutationControlStates: !!(element as any)._hubMutationControlStates,
				hasProjectionControlStates: !!(element as any)._hubProjectionControlStates,
				isSearchDisabled: (element.querySelector("#campaign-item-search") as HTMLInputElement).disabled,
				isSubmitting: !!(element as any)._hubIsSubmitting,
			}))).toEqual({
				ariaBusy: null,
				hasMutationControlStates: false,
				hasProjectionControlStates: false,
				isSearchDisabled: false,
				isSubmitting: false,
			});
			await expect(search).toBeFocused();
			await expect(this.page.locator("#hub-error")).toBeHidden();
		} finally {
			await this.page.unroute(requestUrl);
		}
		const recipientError = await recipientResult;
		if (recipientError) throw recipientError;
	}

	async awardStashItems ({
		campaignId,
		characterNames,
		itemName,
		source,
		quantity,
	}: {
		campaignId: string;
		characterNames: string[];
		itemName: string;
		source: string;
		quantity: number;
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignWorkbench();
		await this.page.locator("#campaign-item-source-stash").click();
		await this.page.locator("#campaign-item-results").selectOption({
			label: `${itemName} — ${source} · ${quantity * characterNames.length} available`,
		});
		await this.page.locator("#campaign-item-use-selection").click();
		await this.selectItemAwardTargets(characterNames);
		await this.page.locator("#campaign-item-quantity").fill(`${quantity}`);
		await this.page.locator("#campaign-item-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-item-form-status"))
			.toHaveText(
				`${quantity} × ${itemName} awarded to ${characterNames.length} character${characterNames.length === 1 ? "" : "s"}.`,
				{timeout: 15_000},
			);
	}

	async applyDamage ({campaignId, characterName, amount}: {campaignId: string; characterName: string; amount: number}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignWorkbench();
		await this.page.locator("#campaign-action-target").selectOption({label: characterName});
		await this.page.locator("#campaign-action-type").selectOption("damage");
		await this.page.locator("#campaign-action-value").fill(`${amount}`);
		await this.page.locator("#campaign-action-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-action-form-status")).toContainText("Effect applied.");
	}

	async spendSpellSlot ({campaignId, characterName, level, amount}: {campaignId: string; characterName: string; level: number; amount: number}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignWorkbench();
		await this.page.locator("#campaign-action-target").selectOption({label: characterName});
		await this.page.locator("#campaign-action-type").selectOption("spell_slot_spend");
		await this.page.locator("#campaign-action-slot-level").selectOption(`${level}`);
		await this.page.locator("#campaign-action-slot-amount").fill(`${amount}`);
		await this.page.locator("#campaign-action-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-action-form-status")).toContainText("Effect applied.");
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
			await helper.openCampaignWorkbench();
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

	async expectInsufficientSpellSlotSpend ({campaignId, characterName, level, amount}: {campaignId: string; characterName: string; level: number; amount: number}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignWorkbench();
		await this.page.locator("#campaign-action-target").selectOption({label: characterName});
		await this.page.locator("#campaign-action-type").selectOption("spell_slot_spend");
		await this.page.locator("#campaign-action-slot-level").selectOption(`${level}`);
		await this.page.locator("#campaign-action-slot-amount").fill(`${amount}`);
		await this.page.locator("#campaign-action-form button[type='submit']").click();
		await expect(this.page.locator("#hub-error")).toContainText("no longer has enough of that resource");
	}

	async expectInsufficientTransferFeedback ({campaignId, characterName}: {campaignId: string; characterName: string}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignWorkbench();
		await this.page.locator("#campaign-transfer-source").selectOption({label: characterName});
		await this.page.locator("#campaign-transfer-target").selectOption({label: "Party inventory"});
		await this.page.locator("#campaign-transfer-gp").fill("999");
		await this.page.locator("#campaign-transfer-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-transfer-form-status")).toHaveText(/Only \d+ GP is available\./);
	}

	async expectSessionRevokedWhileOpen ({characterName}: {characterName: string}): Promise<void> {
		await expect(this.page.locator("#hub-error")).toContainText("session has expired");
		await expect(this.page.locator("#campaign-content")).toBeVisible();
		await expect(this.page.locator("#campaign-connection-status")).toHaveText("Signed out · data is read only");
		await expect(this.page.locator("#campaign-content")).toContainText(characterName);
		const mutationControls = this.page.locator(
			"#campaign-content button:not(#hub-logout), "
			+ "#campaign-content input, "
			+ "#campaign-content select, "
			+ "#campaign-content textarea",
		);
		await expect.poll(
			() => mutationControls.evaluateAll(controls => controls.every(control => (control as HTMLButtonElement).disabled)),
		).toBe(true);
		await expect(this.page.locator("#hub-logout")).toBeEnabled();
		await expect(this.page.getByRole("group", {name: "Sign-in providers"})).toBeVisible();
		const signIn = this.page.getByRole("link", {name: "Sign in with GitHub"});
		await expect(signIn).toBeVisible();
		await expect(signIn).toBeEnabled();
		const currentUrl = new URL(this.page.url());
		const signInUrl = new URL(await signIn.getAttribute("href") || "", currentUrl);
		expect(signInUrl.pathname).toBe("/auth/github/start");
		expect(signInUrl.searchParams.get("returnTo"))
			.toBe(`${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
	}

	async expectMembershipRevokedWhileOpen ({characterName}: {characterName: string}): Promise<void> {
		await expect(this.page.locator("#hub-error")).toContainText("no longer have access");
		await expect(this.page.locator("#campaign-content")).toBeHidden();
		await expect(this.page.locator("#campaign-content")).toBeEmpty();
		await expect(this.page.locator("body")).not.toContainText(characterName);
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
		await this.openCampaignWorkbench();
		await this.page.locator("#campaign-transfer-source").selectOption({label: characterName});
		expect(await this.page.locator("#campaign-transfer-target").inputValue())
			.not.toBe(await this.page.locator("#campaign-transfer-source").inputValue());
		await this.page.locator("#campaign-transfer-target").selectOption({label: "Party inventory"});
		const itemOption = this.page.locator("#campaign-transfer-entry option", {hasText: itemName}).first();
		await expect(itemOption).toContainText("available");
		await this.page.locator("#campaign-transfer-entry").selectOption(await itemOption.getAttribute("value") || "");
		await this.page.locator("#campaign-transfer-quantity").fill(`${quantity}`);
		for (const [type, amount] of Object.entries(currency)) {
			await this.page.locator(`#campaign-transfer-${type}`).fill(`${amount}`);
		}
		await this.page.locator("#campaign-transfer-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-transfer-form-status")).toContainText("Transfer reserved.");
	}

	async submitAuthoritativeItemTransfer ({
		campaignId,
		sourceName,
		targetName,
		itemName,
		quantity,
	}: {
		campaignId: string;
		sourceName: string;
		targetName: string;
		itemName: string;
		quantity: number;
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignWorkbench();
		await this.page.locator("#campaign-transfer-source").selectOption({label: sourceName});
		await this.page.locator("#campaign-transfer-target").selectOption({label: targetName});
		const itemOption = this.page.locator("#campaign-transfer-entry option", {hasText: itemName}).first();
		const itemValue = await itemOption.getAttribute("value") || "";
		await this.page.locator("#campaign-transfer-entry").selectOption(itemValue);
		await this.page.locator("#campaign-transfer-quantity").fill(`${quantity}`);
		await expect(this.page.locator("#campaign-transfer-entry")).toHaveValue(itemValue);
		const proposalPath = `/api/campaigns/${campaignId}/transfers`;
		const resolutionPathPrefix = `${proposalPath}/`;
		const proposalMatcher = `**${proposalPath}`;
		const proposalBodies: string[] = [];
		const proposalKeys: Array<string | undefined> = [];
		let proposalAttempts = 0;
		let retryTransferStatus: string | null = null;
		let resolutionCount = 0;
		const observeResolution = (request: Request) => {
			const pathname = new URL(request.url()).pathname;
			if (request.method() === "POST" && pathname.startsWith(resolutionPathPrefix) && pathname.endsWith("/resolve")) {
				resolutionCount++;
			}
		};
		const loseFirstProposalResponse = async (route: Route) => {
			const body = route.request().postData();
			if (!body) {
				await route.continue();
				return;
			}
			proposalAttempts++;
			proposalBodies.push(body);
			proposalKeys.push(route.request().headers()["idempotency-key"]);
			if (proposalAttempts === 1) {
				const committed = await route.fetch();
				expect(committed.ok()).toBe(true);
				expect((await committed.json()).transfer?.status).toBe("committed");
				await route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({error: "NETWORK_UNAVAILABLE"}),
				});
				return;
			}
			const retried = await route.fetch();
			expect(retried.ok()).toBe(true);
			retryTransferStatus = (await retried.json()).transfer?.status || null;
			await route.fulfill({response: retried});
		};
		this.page.on("request", observeResolution);
		await this.page.route(proposalMatcher, loseFirstProposalResponse);
		try {
			await this.page.locator("#campaign-transfer-form button[type='submit']").click();
			await expect(this.page.locator("#campaign-transfer-form-status")).toContainText("outcome is not yet confirmed");
			const retry = this.page.locator("#campaign-transfer-form button[type='submit']");
			await expect(retry).toHaveText("Retry transfer");
			await expect(this.page.locator("#campaign-transfer-source")).toBeDisabled();
			await expect(this.page.locator("#campaign-transfer-target")).toBeDisabled();
			await expect(this.page.locator("#campaign-transfer-entry")).toBeDisabled();
			await expect(this.page.locator("#campaign-transfer-entry")).toHaveValue(itemValue);
			await expect(this.page.locator("#campaign-transfer-quantity")).toBeDisabled();
			await expect(this.page.locator("#campaign-transfer-quantity")).toHaveValue(`${quantity}`);
			const isRetryProposalObserved = () => {
				if (proposalAttempts > 2) {
					throw new Error(`Transfer retry issued duplicate proposals (proposals=${proposalAttempts}).`);
				}
				return proposalAttempts === 2;
			};
			const pWaitForRetryProposalOrReplacement = async () => {
				await expect.poll(
					async () => isRetryProposalObserved() || await retry.isEnabled().catch(() => false),
					{timeout: 5_000},
				).toBe(true);
				return isRetryProposalObserved();
			};
			for (let attempt = 1; attempt <= 2; attempt++) {
				if (attempt === 2 && isRetryProposalObserved()) break;
				if (await pWaitForRetryProposalOrReplacement()) break;
				if (attempt === 2 && isRetryProposalObserved()) break;
				try {
					await retry.click({timeout: 5_000});
				} catch (error) {
					if (isRetryProposalObserved()) break;
					if (attempt === 1 && await pWaitForRetryProposalOrReplacement()) break;
					const isEnabled = await retry.isEnabled().catch(() => false);
					if (attempt === 1 && isEnabled) continue;
					throw new Error(
						`Transfer retry click did not issue a second proposal `
						+ `(attempt=${attempt}, proposals=${proposalAttempts}, enabled=${isEnabled}).`,
						{cause: error},
					);
				}
				try {
					await expect.poll(isRetryProposalObserved, {timeout: 5_000}).toBe(true);
					break;
				} catch (error) {
					if (isRetryProposalObserved()) break;
					if (attempt === 1 && await pWaitForRetryProposalOrReplacement()) break;
					const isEnabled = await retry.isEnabled().catch(() => false);
					if (attempt === 1 && isEnabled) continue;
					throw new Error(
						`Transfer retry did not issue a second proposal `
						+ `(attempt=${attempt}, proposals=${proposalAttempts}, enabled=${isEnabled}).`,
						{cause: error},
					);
				}
			}
			await expect.poll(isRetryProposalObserved, {timeout: 15_000}).toBe(true);
			await expect.poll(() => retryTransferStatus, {timeout: 15_000}).toBe("committed");
			await expect(this.page.locator("#campaign-transfer-form")).not.toHaveAttribute("aria-busy", "true", {timeout: 15_000});
			await expect(this.page.locator("#campaign-pending-transfers .hub-data-row")).toHaveCount(0);
			expect(proposalAttempts).toBe(2);
			expect(new Set(proposalBodies)).toEqual(new Set([proposalBodies[0]]));
			expect(new Set(proposalKeys)).toEqual(new Set([proposalKeys[0]]));
			expect(resolutionCount).toBe(0);
		} finally {
			await this.page.unroute(proposalMatcher, loseFirstProposalResponse);
			this.page.off("request", observeResolution);
		}
	}

	async reserveRepeatedItemTransfersAfterRefreshRetry ({
		campaignId,
		sourceName,
		targetName,
		itemName,
		quantity,
	}: {
		campaignId: string;
		sourceName: string;
		targetName: string;
		itemName: string;
		quantity: number;
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignWorkbench();
		await this.page.locator("#campaign-transfer-source").selectOption({label: sourceName});
		await this.page.locator("#campaign-transfer-target").selectOption({label: targetName});
		const itemOption = this.page.locator("#campaign-transfer-entry option", {hasText: itemName}).first();
		await this.page.locator("#campaign-transfer-entry").selectOption(await itemOption.getAttribute("value") || "");
		await this.page.locator("#campaign-transfer-quantity").fill(`${quantity}`);

		const transferMatcher = `**/api/campaigns/${campaignId}/transfers`;
		const partyMatcher = `**/api/campaigns/${campaignId}/party-inventory`;
		let transferPostCount = 0;
		let failedRefreshCount = 0;
		let shouldFailRefresh = true;
		const activeTransferRoutes = new Set<Promise<void>>();
		const failRefresh = (route: Route) => {
			if (!shouldFailRefresh) return route.continue();
			failedRefreshCount++;
			return route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({error: {code: "NETWORK_UNAVAILABLE"}}),
			});
		};
		const observeTransfer = (route: Route) => {
			const activeRoute = (async () => {
				if (route.request().method() === "POST") await this.page.route(partyMatcher, failRefresh);
				const response = await route.fetch();
				if (route.request().method() === "POST" && response.ok()) {
					transferPostCount++;
				}
				await route.fulfill({response});
			})();
			activeTransferRoutes.add(activeRoute);
			void activeRoute.then(
				() => activeTransferRoutes.delete(activeRoute),
				() => activeTransferRoutes.delete(activeRoute),
			);
			return activeRoute;
		};
		await this.page.route(transferMatcher, observeTransfer);
		try {
			await this.page.locator("#campaign-transfer-form button[type='submit']").click();
			await expect.poll(() => transferPostCount).toBe(1);
			await expect.poll(() => failedRefreshCount).toBeGreaterThan(0);
			const retry = this.page.getByRole("button", {name: "Retry latest balances", exact: true});
			await expect(retry).toBeVisible();
			await expect(retry).toBeEnabled();
			await expect(this.page.locator("#campaign-transfer-form button[type='submit']")).toBeDisabled();
			shouldFailRefresh = false;
			await retry.click();
			await expect(this.page.locator("#campaign-transfer-form-status")).toHaveText("Latest balances loaded. You can send another transfer.");
			await expect(this.page.locator("#campaign-transfer-form button[type='submit']")).toBeEnabled();
		} finally {
			await this.page.unroute(transferMatcher, observeTransfer).catch(() => undefined);
			await Promise.allSettled([...activeTransferRoutes]);
			await this.page.unroute(partyMatcher, failRefresh).catch(() => undefined);
		}

		await this.page.locator("#campaign-transfer-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-transfer-form-status")).toContainText("Transfer reserved.");
	}

	async expectTransferRefreshRecoveryAcrossAuthorizationFence ({
		campaignId,
		sourceName,
		targetName,
		itemName,
		quantity,
		onRetryRefreshHeld,
	}: {
		campaignId: string;
		sourceName: string;
		targetName: string;
		itemName: string;
		quantity: number;
		onRetryRefreshHeld: () => Promise<void>;
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.openCampaignWorkbench();
		await this.page.locator("#campaign-transfer-source").selectOption({label: sourceName});
		await this.page.locator("#campaign-transfer-target").selectOption({label: targetName});
		const itemOption = this.page.locator("#campaign-transfer-entry option", {hasText: itemName}).first();
		await this.page.locator("#campaign-transfer-entry").selectOption(await itemOption.getAttribute("value") || "");
		await this.page.locator("#campaign-transfer-quantity").fill(`${quantity}`);

		const transferMatcher = `**/api/campaigns/${campaignId}/transfers`;
		const partyMatcher = `**/api/campaigns/${campaignId}/party-inventory`;
		let transferRequestCount = 0;
		let transferPostCount = 0;
		let failedRefreshCount = 0;
		type RefreshPhase = "initial_failure" | "pre_fence_retry" | "post_fence_failure" | "manual_retry" | "complete";
		type HeldRefresh = {phase: "pre_fence_retry" | "manual_retry"; release: () => void; isReleased: boolean};
		let refreshPhase: RefreshPhase = "initial_failure";
		let releasedRefreshCount = 0;
		const heldSuccessfulRefreshes: HeldRefresh[] = [];
		const getHeldRefresh = (phase: HeldRefresh["phase"]) =>
			heldSuccessfulRefreshes.find(held => held.phase === phase);
		const releaseHeldRefresh = (held: HeldRefresh | undefined) => {
			if (!held || held.isReleased) return;
			held.isReleased = true;
			releasedRefreshCount++;
			held.release();
		};
		const releaseAllHeldRefreshes = () => {
			refreshPhase = "complete";
			for (const held of heldSuccessfulRefreshes) releaseHeldRefresh(held);
		};
		const pWaitForFailureQuiescence = async () => {
			const deadline = Date.now() + 10_000;
			let lastCount = failedRefreshCount;
			let stableSince = Date.now();
			while (Date.now() < deadline) {
				await this.page.waitForTimeout(100);
				if (failedRefreshCount !== lastCount) {
					lastCount = failedRefreshCount;
					stableSince = Date.now();
					continue;
				}
				if (lastCount > 0 && Date.now() - stableSince >= 500) return;
			}
			throw new Error(`Balance refresh failures did not quiesce (failed=${failedRefreshCount}).`);
		};
		const pWaitForHeldRefresh = async (phase: HeldRefresh["phase"], deadline: number) => {
			while (Date.now() < deadline) {
				const held = getHeldRefresh(phase);
				if (held) return held;
				await this.page.waitForTimeout(50);
			}
			throw new Error(`Timed out waiting for held ${phase} balance refresh (${await pGetDiagnostics()}).`);
		};
		const pGetRecoveryState = async () => ({
			retryText: await this.page.locator("#campaign-transfer-form-status button")
				.textContent({timeout: 100})
				.catch(() => null),
			hasRecovery: await this.page.locator("#campaign-transfer-form")
				.evaluate(form => !!(form as any)._hubTransferRefreshRecovery)
				.catch(() => false),
			statusText: await this.page.locator("#campaign-transfer-form-status").textContent().catch(() => null),
			isSubmitEnabled: await this.page.locator("#campaign-transfer-form button[type='submit']")
				.isEnabled()
				.catch(() => false),
		});
		const pGetDiagnostics = async () => {
			const recovery = await pGetRecoveryState();
			return JSON.stringify({
				phase: refreshPhase,
				transferRequestCount,
				transferPostCount,
				failedRefreshCount,
				heldRefreshCount: heldSuccessfulRefreshes.length,
				releasedRefreshCount,
				...recovery,
			});
		};
		const pWaitForRetryRecreated = async () => {
			const deadline = Date.now() + 15_000;
			while (Date.now() < deadline) {
				const recovery = await pGetRecoveryState();
				if (
					recovery.retryText === "Retry latest balances"
					&& recovery.hasRecovery
					&& !recovery.isSubmitEnabled
				) return;
				await this.page.waitForTimeout(50);
			}
			throw new Error(`Fenced retry was not recreated (${await pGetDiagnostics()}).`);
		};
		const failRefresh = async (route: Route) => {
			if (refreshPhase === "complete") return route.continue();
			const heldPhase = refreshPhase === "pre_fence_retry" || refreshPhase === "manual_retry"
				? refreshPhase
				: null;
			if (
				!heldPhase
				|| getHeldRefresh(heldPhase)
			) {
				failedRefreshCount++;
				return route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({error: {code: "NETWORK_UNAVAILABLE"}}),
				});
			}
			let release = () => {};
			const gate = new Promise<void>(resolve => release = resolve);
			heldSuccessfulRefreshes.push({phase: heldPhase, release, isReleased: false});
			await gate;
			return route.continue();
		};
		const pClickRetryUntilHeld = async (
			phase: HeldRefresh["phase"],
			{isAllowSuccessfulDetachment = false} = {},
		): Promise<HeldRefresh | null> => {
			for (let attempt = 1; attempt <= 2; attempt++) {
				if (getHeldRefresh(phase)) {
					throw new Error(`Automatic balance traffic consumed ${phase} before the real retry click (${await pGetDiagnostics()}).`);
				}
				const retry = this.page.getByRole("button", {name: "Retry latest balances", exact: true});
				await expect(retry).toBeVisible();
				await expect(retry).toBeEnabled();
				if (getHeldRefresh(phase)) {
					throw new Error(`Automatic balance traffic consumed ${phase} while the real retry click was being prepared (${await pGetDiagnostics()}).`);
				}
				try {
					await retry.click({timeout: 5_000});
				} catch (error) {
					const held = getHeldRefresh(phase);
					const recovery = await pGetRecoveryState();
					if (
						isAllowSuccessfulDetachment
						&& recovery.statusText === "Latest balances loaded. You can send another transfer."
						&& recovery.isSubmitEnabled
					) return null;
					if (!held && attempt === 1 && recovery.retryText === "Retry latest balances") continue;
					throw new Error(`Retry click did not start ${phase} refresh (${await pGetDiagnostics()}).`, {cause: error});
				}
				try {
					const held = await pWaitForHeldRefresh(phase, Date.now() + 5_000);
					await expect(this.page.locator("#campaign-transfer-form-status button")).toHaveText("Retrying...");
					return held;
				} catch (error) {
					const recovery = await pGetRecoveryState();
					if (
						isAllowSuccessfulDetachment
						&& recovery.statusText === "Latest balances loaded. You can send another transfer."
						&& recovery.isSubmitEnabled
					) return null;
					if (attempt === 1 && recovery.retryText === "Retry latest balances") continue;
					throw new Error(`Retry did not start ${phase} refresh (${await pGetDiagnostics()}).`, {cause: error});
				}
			}
			throw new Error(`Retry attempts exhausted for ${phase} (${await pGetDiagnostics()}).`);
		};
		const observeTransfer = async (route: Route) => {
			if (route.request().method() === "POST") {
				transferRequestCount++;
				await this.page.route(partyMatcher, failRefresh);
			}
			const response = await route.fetch();
			if (route.request().method() === "POST" && response.ok()) transferPostCount++;
			await route.fulfill({response});
		};
		await this.page.route(transferMatcher, observeTransfer);
		try {
			const form = this.page.locator("#campaign-transfer-form");
			const submit = form.locator("button[type='submit']");
			for (let attempt = 1; attempt <= 2; attempt++) {
				if (attempt === 2 && transferRequestCount !== 0) break;
				await expect(submit).toBeEnabled();
				if (attempt === 2 && transferRequestCount !== 0) break;
				await submit.click();
				try {
					await expect.poll(() => transferRequestCount, {timeout: 5_000}).toBe(1);
					break;
				} catch (error) {
					const isEnabled = await submit.isEnabled();
					if (transferRequestCount !== 0) break;
					if (attempt === 1 && isEnabled) continue;
					const state = {
						attempt,
						transferRequestCount,
						transferPostCount,
						ariaBusy: await form.getAttribute("aria-busy"),
						status: await this.page.locator("#campaign-transfer-form-status").textContent().catch(() => null),
					};
					throw new Error(`Transfer submit did not issue exactly one request: ${JSON.stringify(state)}`, {cause: error});
				}
			}
			await expect.poll(() => transferRequestCount, {timeout: 15_000}).toBe(1);
			await expect.poll(() => transferPostCount, {timeout: 15_000}).toBe(1);
			await expect.poll(() => failedRefreshCount).toBeGreaterThan(0);
			const retry = this.page.getByRole("button", {name: "Retry latest balances", exact: true});
			await expect(retry).toBeVisible();
			await expect(retry).toBeEnabled();
			await expect(this.page.locator("#campaign-transfer-form button[type='submit']")).toBeDisabled();
			await pWaitForFailureQuiescence();
			refreshPhase = "pre_fence_retry";
			const preFenceRefresh = await pClickRetryUntilHeld("pre_fence_retry");
			if (!preFenceRefresh) throw new Error(`Pre-fence retry completed without the required held request (${await pGetDiagnostics()}).`);
			refreshPhase = "post_fence_failure";
			await onRetryRefreshHeld();
			releaseHeldRefresh(preFenceRefresh);
			await pWaitForRetryRecreated();
			const deferredRetry = this.page.getByRole("button", {name: "Retry latest balances", exact: true});
			await expect(deferredRetry).toBeVisible();
			await expect(deferredRetry).toHaveText("Retry latest balances");
			await expect(deferredRetry).toBeEnabled();
			await expect.poll(() => this.page.locator("#campaign-transfer-form").evaluate(form => !!(form as any)._hubTransferRefreshRecovery)).toBe(true);
			await pWaitForFailureQuiescence();
			refreshPhase = "manual_retry";
			const manualRefresh = await pClickRetryUntilHeld("manual_retry", {isAllowSuccessfulDetachment: true});
			if (manualRefresh) releaseHeldRefresh(manualRefresh);
			await expect(this.page.locator("#campaign-transfer-form-status")).toHaveText("Latest balances loaded. You can send another transfer.");
			await expect(this.page.locator("#campaign-transfer-form button[type='submit']")).toBeEnabled();
			expect(heldSuccessfulRefreshes.map(held => held.phase)).toEqual(manualRefresh
				? ["pre_fence_retry", "manual_retry"]
				: ["pre_fence_retry"]);
			expect(releasedRefreshCount).toBe(manualRefresh ? 2 : 1);
			refreshPhase = "complete";
		} finally {
			releaseAllHeldRefreshes();
			await this.page.unroute(transferMatcher, observeTransfer).catch(() => undefined);
			await this.page.unroute(partyMatcher, failRefresh).catch(() => undefined);
		}
	}

	async acceptFirstPendingTransfer ({
		campaignId,
		expectedText,
		expectedAbsentText = [],
		buttonName = "Accept",
	}: {
		campaignId: string;
		expectedText: string[];
		expectedAbsentText?: string[];
		buttonName?: "Accept" | "Approve";
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		const transfers = this.page.locator("#campaign-pending-transfers .hub-data-row");
		const transferCount = await transfers.count();
		const transfer = transfers.first();
		for (const text of expectedText) await expect(transfer).toContainText(text);
		for (const text of expectedAbsentText) await expect(transfer).not.toContainText(text);
		const button = transfer.getByRole("button", {name: buttonName, exact: true});
		await expect(button).toBeVisible();
		await button.click();
		await expect(transfers).toHaveCount(transferCount - 1);
	}

	async resolveFirstPendingTransferAfterCommittedRefreshFailure ({
		campaignId,
		expectedText,
		buttonName,
	}: {
		campaignId: string;
		expectedText: string[];
		buttonName: "Accept" | "Approve" | "Decline" | "Reject";
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		const transfers = this.page.locator("#campaign-pending-transfers .hub-data-row");
		const transferCount = await transfers.count();
		const transfer = transfers.first();
		for (const text of expectedText) await expect(transfer).toContainText(text);

		const resolveMatcher = `**/api/campaigns/${campaignId}/transfers/*/resolve`;
		const partyMatcher = `**/api/campaigns/${campaignId}/party-inventory`;
		const idempotencyKeys: string[] = [];
		let failedRefreshCount = 0;
		let shouldFailRefresh = true;
		const failRefresh = (route: Route) => {
			if (!shouldFailRefresh) return route.continue();
			failedRefreshCount++;
			return route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({error: {code: "NETWORK_UNAVAILABLE"}}),
			});
		};
		const observeResolution = async (route: Route) => {
			idempotencyKeys.push(route.request().headers()["idempotency-key"]);
			await this.page.route(partyMatcher, failRefresh);
			const response = await route.fetch();
			expect(response.ok()).toBe(true);
			await route.fulfill({response});
		};
		await this.page.route(resolveMatcher, observeResolution);
		try {
			await transfer.getByRole("button", {name: buttonName, exact: true}).click();
			await expect.poll(() => failedRefreshCount).toBeGreaterThan(0);
			await expect(transfer).toContainText("The committed outcome is safe");
			await expect(transfer.getByRole("button", {name: buttonName, exact: true})).toHaveCount(0);
			const retry = transfer.getByRole("button", {name: "Retry inbox refresh", exact: true});
			await expect(retry).toBeVisible();
			shouldFailRefresh = false;
			await retry.click();
			await expect(transfers).toHaveCount(transferCount - 1);
			expect(idempotencyKeys).toHaveLength(1);
		} finally {
			await this.page.unroute(resolveMatcher, observeResolution);
			await this.page.unroute(partyMatcher, failRefresh);
		}
	}

	async resolveFirstPendingTransferAfterLostResponse ({
		campaignId,
		expectedText,
		buttonName,
	}: {
		campaignId: string;
		expectedText: string[];
		buttonName: "Accept" | "Approve" | "Decline" | "Reject";
	}): Promise<void> {
		await this.gotoCampaign(campaignId);
		const transfers = this.page.locator("#campaign-pending-transfers .hub-data-row");
		const transferCount = await transfers.count();
		const transfer = transfers.first();
		for (const text of expectedText) await expect(transfer).toContainText(text);

		const resolveMatcher = `**/api/campaigns/${campaignId}/transfers/*/resolve`;
		const partyMatcher = `**/api/campaigns/${campaignId}/party-inventory`;
		const idempotencyKeys: string[] = [];
		const resolutionBodies: string[] = [];
		let attempt = 0;
		let failedRefreshCount = 0;
		let shouldFailRefresh = true;
		const failRefresh = (route: Route) => {
			if (!shouldFailRefresh) return route.continue();
			failedRefreshCount++;
			return route.fulfill({
				status: 503,
				contentType: "application/json",
				body: JSON.stringify({error: {code: "NETWORK_UNAVAILABLE"}}),
			});
		};
		const loseFirstResponse = async (route: Route) => {
			const body = route.request().postData();
			if (!body) {
				await route.continue();
				return;
			}
			idempotencyKeys.push(route.request().headers()["idempotency-key"]);
			resolutionBodies.push(body);
			if (++attempt === 1) {
				await this.page.route(partyMatcher, failRefresh);
				const committed = await route.fetch();
				expect(committed.ok()).toBe(true);
				await route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({error: {code: "NETWORK_UNAVAILABLE"}}),
				});
				return;
			}
			await route.continue();
		};
		await this.page.route(resolveMatcher, loseFirstResponse);
		try {
			const decision = transfer.getByRole("button", {name: buttonName, exact: true});
			await decision.click();
			await expect.poll(() => failedRefreshCount).toBeGreaterThan(0);
			await expect(transfer).toContainText("outcome is not yet confirmed");
			await expect(transfer.getByRole("button", {name: "Retry inbox refresh", exact: true})).toBeVisible();
			await expect(decision).toBeEnabled();
			const oppositeName = {
				Accept: "Reject",
				Approve: "Decline",
				Decline: "Approve",
				Reject: "Accept",
			}[buttonName];
			await expect(transfer.getByRole("button", {name: oppositeName, exact: true})).toBeDisabled();

			shouldFailRefresh = false;
			await decision.click();
			await expect(transfers).toHaveCount(transferCount - 1);
			expect(idempotencyKeys.length).toBeGreaterThanOrEqual(2);
			expect(new Set(idempotencyKeys)).toEqual(new Set([idempotencyKeys[0]]));
			expect(new Set(resolutionBodies)).toEqual(new Set([resolutionBodies[0]]));
		} finally {
			await this.page.unroute(resolveMatcher, loseFirstResponse);
			await this.page.unroute(partyMatcher, failRefresh);
		}
	}

	async expectTransferItemAvailable ({sourceName, itemName}: {sourceName: string; itemName: string}): Promise<void> {
		await this.openCampaignWorkbench();
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
		await this.openCampaignDisclosure("People and invitations");
		const row = this.page.locator("#campaign-member-list .hub-data-row", {hasText: displayName});
		this.page.once("dialog", dialog => dialog.accept());
		await row.locator("button", {hasText: "Remove"}).click();
		await expect(row).toBeHidden();
	}

	async archiveCampaign (campaignId: string): Promise<void> {
		const response = await this.page.request.post(`/api/campaigns/${encodeURIComponent(campaignId)}/archive`, {
			headers: await this.getMutationHeaders(),
			data: {},
		});
		expect(response.ok()).toBe(true);
	}

	async changeMemberRoleViaApi ({
		campaignId,
		displayName,
		role,
	}: {
		campaignId: string;
		displayName: string;
		role: "co_dm" | "player" | "spectator";
	}): Promise<void> {
		const response = await this.page.request.get(`/api/campaigns/${encodeURIComponent(campaignId)}/members`);
		expect(response.ok()).toBe(true);
		const members = (await response.json()).members as Array<{id: string; displayName: string}>;
		const membership = members.find(member => member.displayName === displayName);
		expect(membership, `Expected campaign membership for ${displayName}`).toBeTruthy();
		const roleResponse = await this.page.request.patch(
			`/api/campaigns/${encodeURIComponent(campaignId)}/members/${encodeURIComponent(membership!.id)}`,
			{
				headers: await this.getMutationHeaders(),
				data: {role},
			},
		);
		expect(roleResponse.ok()).toBe(true);
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

	// #region Active campaign selection (ADR 0013)

	/** Read the durable device-local selection record, or `null` when nothing is stored. */
	async getActiveCampaignRecord (): Promise<ActiveCampaignRecord | null> {
		for (let attempt = 0; ; ++attempt) {
			try {
				return await this.page.evaluate(() => {
					const raw = window.localStorage.getItem("hub.activeCampaign.v1");
					if (!raw) return null;
					try {
						return JSON.parse(raw);
					} catch {
						return null;
					}
				});
			} catch (error) {
				if (attempt >= 2 || !String(error).includes("Execution context was destroyed")) throw error;
				await this.page.waitForLoadState("domcontentloaded").catch(() => {});
			}
		}
	}

	/** Poll until the stored selection satisfies `predicate`, so tests never sleep on a fixed timer. */
	async waitForActiveCampaign (predicate: (record: ActiveCampaignRecord | null) => boolean, timeout = 10_000): Promise<ActiveCampaignRecord | null> {
		await expect.poll(async () => predicate(await this.getActiveCampaignRecord()), {timeout}).toBe(true);
		return this.getActiveCampaignRecord();
	}

	async waitForSelectedCampaign (campaignId: string, timeout = 10_000): Promise<void> {
		await this.waitForActiveCampaign(record => record?.state === "selected" && record?.campaignId === campaignId, timeout);
	}

	async waitForClearedSelection (timeout = 10_000): Promise<void> {
		await this.waitForActiveCampaign(record => record?.state === "cleared", timeout);
	}

	async expectCampaignSwitcher ({
		campaignName,
		state = null,
	}: {
		campaignName: string;
		state?: string | null;
	}): Promise<void> {
		const switcher = this.page.locator(".hub-context-switcher");
		await expect(switcher).toBeVisible({timeout: 30_000});
		await expect(switcher.getByRole("combobox", {name: "Active campaign context"}))
			.toHaveValue(await switcher.locator("option", {hasText: campaignName}).getAttribute("value") || "");
		await expect(switcher.getByRole("status")).toContainText(campaignName);
		if (state) await expect(switcher).toHaveAttribute("data-state", state);
	}

	async expectCampaignSwitcherResponsive (): Promise<void> {
		for (const viewport of [{width: 390, height: 844}, {width: 844, height: 390}]) {
			await this.page.setViewportSize(viewport);
			const audit = await this.page.locator(".hub-context-switcher").evaluate(element => {
				const select = element.querySelector("select");
				const rect = select?.getBoundingClientRect();
				return {
					clientWidth: document.documentElement.clientWidth,
					scrollWidth: document.documentElement.scrollWidth,
					selectHeight: rect?.height || 0,
					ariaLabel: select?.getAttribute("aria-label"),
					statusLive: element.querySelector("[role='status']")?.getAttribute("aria-live"),
				};
			});
			expect(audit.scrollWidth).toBeLessThanOrEqual(audit.clientWidth);
			expect(audit.selectHeight).toBeGreaterThanOrEqual(44);
			expect(audit.ariaLabel).toBe("Active campaign context");
			expect(audit.statusLive).toBe("polite");
		}
		await this.page.setViewportSize({width: 1280, height: 720});
	}

	async selectLocalCampaignContext (): Promise<void> {
		await this.page.getByRole("combobox", {name: "Active campaign context"}).selectOption("__local__");
		await this.waitForClearedSelection();
	}

	async selectCampaignContext (campaignId: string): Promise<void> {
		await this.page.getByRole("combobox", {name: "Active campaign context"}).selectOption(campaignId);
		await this.waitForSelectedCampaign(campaignId);
	}

	async gotoOrdinaryPageWithCampaignContext ({path, campaignId}: {path: string; campaignId: string}): Promise<void> {
		await this.page.goto(path);
		await this.page.waitForFunction(
			expected => (window as any).HubCampaignPageContext?.campaignId === expected,
			campaignId,
			{timeout: 60_000},
		);
		await expect(this.page.getByRole("combobox", {name: "Active campaign context"})).toBeVisible();
	}

	async openBareCharacterSheetDefault (campaignId: string): Promise<void> {
		await this.page.goto("/charactersheet.html");
		await this.page.waitForURL(url => url.searchParams.get("hubCampaign") === campaignId, {timeout: 60_000});
		await this.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
	}

	async openLocalCharacterSheet (): Promise<void> {
		await this.page.goto("/charactersheet.html?local=1");
		await this.page.waitForFunction(() => !!(window as any).charSheet, undefined, {timeout: 60_000});
		expect(new URL(this.page.url()).searchParams.get("local")).toBe("1");
		expect(await this.page.evaluate(() => (window as any).charSheet?._isHubCharacter)).toBe(false);
		expect(await this.getCampaignSettingsOverlay()).toBeNull();
	}

	async openBareDmScreenDefault (campaignId: string): Promise<void> {
		await this.page.goto("/dmscreen.html");
		await this.page.waitForURL(url => url.searchParams.get("hubCampaign") === campaignId, {timeout: 60_000});
		await this.page.waitForFunction(() => !!(window as any).DM_SCREEN, undefined, {timeout: 60_000});
	}

	async openLocalDmScreen (): Promise<void> {
		await this.page.goto("/dmscreen.html?local=1");
		await this.page.waitForFunction(() => !!(window as any).DM_SCREEN, undefined, {timeout: 60_000});
		expect(new URL(this.page.url()).searchParams.get("local")).toBe("1");
		expect(await this.page.evaluate(() => !!(window as any).DM_SCREEN?._workspaceRepository?.campaignId)).toBe(false);
	}

	async revalidatePrivateSurfaceCampaignAccess (): Promise<void> {
		await this.page.evaluate(async () => {
			const coordinator = (window as any).charSheet?._hubActiveCampaign
				|| (window as any).DM_SCREEN_ACTIVE_CAMPAIGN;
			if (!coordinator) throw new Error("Private surface campaign coordinator is unavailable.");
			await coordinator.pRevalidate({trigger: "access_loss"});
		});
	}

	async expectPrivateCharacterConcealed (): Promise<void> {
		await expect.poll(
			() => this.page.evaluate(() => ({
				id: (window as any).charSheet?._currentCharacterId,
				name: (window as any).charSheet?._state?._data?.name,
			})),
			{timeout: 30_000},
		).toEqual({id: null, name: ""});
		await expect(this.page.getByRole("alert")).toContainText("Campaign access ended");
	}

	async expectPrivateCharacterOpen (name: string): Promise<void> {
		await expect.poll(
			() => this.page.evaluate(() => (window as any).charSheet?._state?._data?.name),
			{timeout: 30_000},
		).toBe(name);
	}

	async startDeferredCharacterConflictSave (): Promise<void> {
		await this.page.evaluate(() => {
			const sheet = (window as any).charSheet;
			const repository = sheet?._characterRepository;
			if (!sheet || !repository) throw new Error("Character Sheet repository is unavailable.");

			let release;
			const gate = new Promise<void>(resolve => release = resolve);
			const privateDocument = sheet._state.toJson();
			const originalUpsert = repository.pUpsert;
			const originalResolveConflict = repository.pResolveConflict;
			const originalPrompt = (window as any).InputUiUtil.pGetUserBoolean;
			const operation = {
				started: false,
				promptCount: 0,
				resolveCount: 0,
				release,
				promise: null as Promise<unknown> | null,
			};
			(window as any).__hubDeferredCharacterSave = operation;

			repository.pUpsert = async () => {
				operation.started = true;
				await gate;
				throw Object.assign(new Error("Character changed on another device."), {
					code: "CHARACTER_CONFLICT",
					recovery: {local: privateDocument, server: privateDocument},
				});
			};
			repository.pResolveConflict = async () => {
				operation.resolveCount++;
				return privateDocument;
			};
			(window as any).InputUiUtil.pGetUserBoolean = async () => {
				operation.promptCount++;
				return false;
			};

			operation.promise = sheet._saveCurrentCharacter()
				.finally(() => {
					repository.pUpsert = originalUpsert;
					repository.pResolveConflict = originalResolveConflict;
					(window as any).InputUiUtil.pGetUserBoolean = originalPrompt;
				});
		});
		await this.page.waitForFunction(() => (window as any).__hubDeferredCharacterSave?.started, undefined, {timeout: 30_000});
	}

	async releaseDeferredCharacterConflictSave (): Promise<{promptCount: number; resolveCount: number; name: string; characterId: string | null}> {
		return this.page.evaluate(async () => {
			const operation = (window as any).__hubDeferredCharacterSave;
			if (!operation?.promise || !operation.release) throw new Error("Deferred Character Sheet save is unavailable.");
			operation.release();
			await operation.promise;
			return {
				promptCount: operation.promptCount,
				resolveCount: operation.resolveCount,
				name: (window as any).charSheet?._state?._data?.name,
				characterId: (window as any).charSheet?._currentCharacterId ?? null,
			};
		});
	}

	async startDeferredDmWorkspaceConflictSave (): Promise<void> {
		await this.page.evaluate(async () => {
			const board = (window as any).DM_SCREEN;
			const repository = board?._workspaceRepository;
			if (!board || !repository) throw new Error("DM workspace repository is unavailable.");

			let release;
			const gate = new Promise<void>(resolve => release = resolve);
			const originalSet = repository.pSet;
			const originalResolveConflict = repository.pResolveConflict;
			const originalPrompt = (window as any).InputUiUtil.pGetUserBoolean;
			const state = board.getSaveableState();
			const resolved = {
				...state,
				w: state.w || 3,
				h: state.h || 2,
				sla: "1",
				sls: {
					"1": {
						ps: [{x: 0, y: 0, w: 1, h: 1, t: 99, r: "Private panel"}],
						ex: [],
					},
				},
			};
			const operation = {
				started: false,
				promptCount: 0,
				resolveCount: 0,
				release,
				promise: null as Promise<unknown> | null,
			};
			(window as any).__hubDeferredDmSave = operation;

			repository.pSet = async () => {
				operation.started = true;
				await gate;
				throw Object.assign(new Error("Workspace changed on another device."), {
					code: "WORKSPACE_CONFLICT",
					recovery: {local: resolved, server: resolved},
				});
			};
			repository.pResolveConflict = async () => {
				operation.resolveCount++;
				return resolved;
			};
			(window as any).InputUiUtil.pGetUserBoolean = async () => {
				operation.promptCount++;
				return false;
			};

			const {pDoDmScreenWorkspaceSave} = await import("/js/dmscreen/dmscreen-workspace-persistence.js");
			operation.promise = pDoDmScreenWorkspaceSave({
				board,
				saveGeneration: board._saveGeneration,
			}).finally(() => {
				repository.pSet = originalSet;
				repository.pResolveConflict = originalResolveConflict;
				(window as any).InputUiUtil.pGetUserBoolean = originalPrompt;
			});
		});
		await this.page.waitForFunction(() => (window as any).__hubDeferredDmSave?.started, undefined, {timeout: 30_000});
	}

	async releaseDeferredDmWorkspaceConflictSave (): Promise<{promptCount: number; resolveCount: number; panelCount: number}> {
		return this.page.evaluate(async () => {
			const operation = (window as any).__hubDeferredDmSave;
			if (!operation?.promise || !operation.release) throw new Error("Deferred DM workspace save is unavailable.");
			operation.release();
			await operation.promise;
			return {
				promptCount: operation.promptCount,
				resolveCount: operation.resolveCount,
				panelCount: Object.keys((window as any).DM_SCREEN?.panels || {}).length,
			};
		});
	}

	async expectPrivateDmWorkspaceConcealed (): Promise<void> {
		await expect.poll(
			() => this.page.evaluate(() => ({
				panelCount: Object.keys((window as any).DM_SCREEN?.panels || {}).length,
				projectionCount: (window as any).DM_SCREEN?._hubCharacterProjections?.length || 0,
			})),
			{timeout: 30_000},
		).toEqual({panelCount: 0, projectionCount: 0});
		await expect(this.page.locator(".dm-screen")).toContainText("Campaign access ended");
	}

	async clearActiveCampaignStorage (): Promise<void> {
		await this.page.evaluate(() => window.localStorage.removeItem("hub.activeCampaign.v1"));
	}

	/**
	 * Click Sign out and capture whether the durable selection was already a tombstone at the
	 * moment the logout request left the page.
	 */
	async signOutCapturingSelectionAtRequest (): Promise<ActiveCampaignRecord | null> {
		let recordAtRequest: ActiveCampaignRecord | null = null;
		let captureError: unknown = null;
		const routePattern = "**/api/logout";
		const onRoute = async (route: Route) => {
			try {
				recordAtRequest = await this.getActiveCampaignRecord();
			} catch (error) {
				captureError = error;
			} finally {
				await route.continue();
			}
		};
		await this.page.route(routePattern, onRoute);
		try {
			await this.page.locator("#hub-logout").click();
			await expect.poll(() => captureError !== null || recordAtRequest !== null, {timeout: 10_000}).toBe(true);
			if (captureError) throw captureError;
		} finally {
			await this.page.unroute(routePattern, onRoute);
		}
		return recordAtRequest;
	}

	/** Suspend the private page before an out-of-tab mutation, matching persisted pagehide order. */
	async suspendForBfcache (): Promise<void> {
		await this.page.evaluate(() => {
			window.dispatchEvent(new PageTransitionEvent("pagehide", {persisted: true}));
		});
		await expect.poll(
			() => this.page.evaluate(() => (window as any).charSheet?._hubActiveCampaign?._isSuspended),
			{timeout: 10_000},
		).toBe(true);
	}

	/** Resume only after the external mutation, forcing access revalidation before realtime. */
	async resumeFromBfcache (): Promise<void> {
		await this.page.evaluate(() => {
			window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true}));
		});
	}

	/** Campaign rules currently applied to the open character sheet, if any. */
	async getCampaignSettingsOverlay (): Promise<Record<string, unknown> | null> {
		return this.page.evaluate(() => {
			const sheet = (window as any).charSheet;
			return sheet?._state?._campaignSettingsOverlay ?? null;
		});
	}

	async getSheetCampaignId (): Promise<string | null> {
		return this.page.evaluate(() => (window as any).charSheet?._hubCampaignId ?? null);
	}

	async getActiveContextState (): Promise<string | null> {
		return this.page.evaluate(() => (window as any).charSheet?._hubActiveCampaign?.state ?? null);
	}

	// #endregion
}

export type ActiveCampaignRecord = {
	schemaVersion: number;
	accountId: string;
	campaignId: string | null;
	state: "selected" | "cleared";
	revision: number;
	updatedAt: number;
	writerId: string;
};
