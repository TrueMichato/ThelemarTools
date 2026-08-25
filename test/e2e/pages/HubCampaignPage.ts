import {expect, Page} from "@playwright/test";

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
			"x-hub-protocol-version": "1",
			"idempotency-key": crypto.randomUUID(),
		};
	}

	async gotoHub (): Promise<void> {
		await this.page.goto("/hub.html");
		await expect(this.page.locator("#hub-signed-in")).toBeVisible();
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
		await expect(this.page.locator("#campaign-content")).toBeVisible();
	}

	async createInvite (campaignId: string, role = "player"): Promise<string> {
		await this.gotoCampaign(campaignId);
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
					xp: 0,
					hp: {current: 20, max: 20, temp: 0},
					conditions: [],
					inventory: [{id: "rations", item: {name: "Rations", source: "PHB"}, quantity: 5}],
					currency: {cp: 0, sp: 0, ep: 0, gp: 10, pp: 0},
				},
			},
		});
		expect(response.ok()).toBe(true);
		return (await response.json()).character;
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
		await this.page.goto(`/charactersheet.html?id=${encodeURIComponent(characterId)}&hubCampaign=${encodeURIComponent(campaignId)}`);
		await expect(this.page.locator("#charsheet-ipt-name")).toHaveValue(name, {timeout: 30_000});
	}

	async grantXp ({campaignId, characterName, amount}: {campaignId: string; characterName: string; amount: number}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.page.locator("#campaign-xp-target").selectOption({label: characterName});
		await this.page.locator("#campaign-xp-amount").fill(`${amount}`);
		await this.page.locator("#campaign-xp-form button[type='submit']").click();
		await expect(this.page.locator("#campaign-xp-form button[type='submit']")).toBeEnabled();
	}

	async proposeDamage ({campaignId, characterName, amount}: {campaignId: string; characterName: string; amount: number}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.page.locator("#campaign-action-target").selectOption({label: characterName});
		await this.page.locator("#campaign-action-type").selectOption("damage");
		await this.page.locator("#campaign-action-value").fill(`${amount}`);
		await this.page.locator("#campaign-action-form button[type='submit']").click();
	}

	async applyFirstPendingAction (campaignId: string): Promise<void> {
		await this.gotoCampaign(campaignId);
		const button = this.page.locator("#campaign-pending-actions button", {hasText: "Apply"}).first();
		await expect(button).toBeVisible();
		await button.click();
		await expect(button).toBeHidden();
	}

	async reserveGoldToParty ({campaignId, characterName, amount}: {campaignId: string; characterName: string; amount: number}): Promise<void> {
		await this.gotoCampaign(campaignId);
		await this.page.locator("#campaign-transfer-source").selectOption({label: characterName});
		await this.page.locator("#campaign-transfer-target").selectOption({label: "Party inventory"});
		await this.page.locator("#campaign-transfer-gp").fill(`${amount}`);
		await this.page.locator("#campaign-transfer-form button[type='submit']").click();
	}

	async acceptFirstPendingTransfer (campaignId: string): Promise<void> {
		await this.gotoCampaign(campaignId);
		const button = this.page.locator("#campaign-pending-transfers button", {hasText: "Accept"}).first();
		await expect(button).toBeVisible();
		await button.click();
		await expect(button).toBeHidden();
	}

	async getPartyInventory (campaignId: string): Promise<any> {
		const response = await this.page.request.get(`/api/campaigns/${encodeURIComponent(campaignId)}/party-inventory`);
		expect(response.ok()).toBe(true);
		return (await response.json()).partyInventory;
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
