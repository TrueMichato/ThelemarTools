import {expect, Locator, Page} from "@playwright/test";
import {CharacterSheetPage} from "./CharacterSheetPage";

type Surface = "overview" | "combat" | "play";

export class ItemPowerStatusPage {
	private readonly sheet: CharacterSheetPage;

	constructor (private readonly page: Page) {
		this.sheet = new CharacterSheetPage(page);
	}

	private get modal (): Locator {
		return this.page.locator(".ve-ui-modal__inner:visible").last();
	}

	private status (surface: Surface, itemId: string): Locator {
		const root = {
			overview: "#charsheet-active-states",
			combat: "#charsheet-combat-states",
			play: "#charsheet-play-mode .pm-active-states",
		}[surface];
		return this.page.locator(`${root} .charsheet__active-item-power[data-item-id="${itemId}"]`);
	}

	private powerButton (powerName: string): Locator {
		const title = this.page.locator(".charsheet__item-power-name").filter({hasText: powerName});
		return this.modal.locator(".charsheet__item-power").filter({has: title}).getByRole("button");
	}

	async openFromInventory (itemId: string): Promise<void> {
		await this.sheet.exitPlayMode();
		await this.sheet.tabInventory.click();
		const item = this.page.locator(`.charsheet__item[data-item-id="${itemId}"]`);
		await item.locator(".charsheet__item-powers").click();
		await expect(this.modal).toBeVisible();
	}

	async invokeFromInventory (itemId: string, powerName: string, action: "Activate" | "Deactivate"): Promise<void> {
		await this.openFromInventory(itemId);
		const use = this.powerButton(powerName);
		await expect(use).toHaveText(action);
		await use.click();
		await expect(this.modal).not.toBeVisible();
	}

	async showSurface (surface: Surface): Promise<void> {
		if (surface === "play") await this.sheet.enterPlayMode();
		else {
			await this.sheet.exitPlayMode();
			await (surface === "overview" ? this.sheet.tabOverview : this.sheet.tabCombat).click();
		}
	}

	async expectActive (surface: Surface, itemId: string, itemName: string): Promise<void> {
		await this.showSurface(surface);
		const row = this.status(surface, itemId);
		await expect(row).toBeVisible();
		await expect(row).toContainText(itemName);
		await expect(row).toContainText(/active/i);
		await expect(row.getByRole("button")).toHaveCount(1);
		await expect(row.getByRole("button", {name: /Manage .* power/i})).toBeEnabled();
	}

	async expectAbsent (surface: Surface, itemId: string): Promise<void> {
		await this.showSurface(surface);
		await expect(this.status(surface, itemId)).toHaveCount(0);
	}

	async openFromStatusWithKeyboard (surface: Surface, itemId: string): Promise<void> {
		const manage = this.status(surface, itemId).getByRole("button", {name: /Manage .* power/i});
		await expect(manage).toBeVisible();
		await manage.focus();
		await expect(manage).toBeFocused();
		await this.page.keyboard.press("Enter");
		await expect(this.modal).toBeVisible();
	}

	async expectPowerFocused (powerName: string, action: "Activate" | "Deactivate"): Promise<void> {
		await expect(this.powerButton(powerName)).toHaveText(action);
		await expect(this.powerButton(powerName)).toBeFocused();
	}

	async expectPowerUnavailable (powerName: string): Promise<void> {
		await expect(this.powerButton(powerName)).toHaveText("Deactivate");
		await expect(this.powerButton(powerName)).toBeDisabled();
	}

	async closeModalWithEscape (): Promise<void> {
		await this.page.keyboard.press("Escape");
		await expect(this.modal).not.toBeVisible();
	}

	async expectStatusFocus (surface: Surface, itemId: string): Promise<void> {
		await expect(this.status(surface, itemId).getByRole("button", {name: /Manage .* power/i})).toBeFocused();
	}

	async deactivateFocusedPower (powerName: string): Promise<void> {
		await this.powerButton(powerName).click();
		await expect(this.modal).not.toBeVisible();
	}

	async expectFallbackFocus (surface: Surface): Promise<void> {
		if (surface === "play") {
			await expect(this.page.locator(".pm-status__tool-btn").filter({hasText: /^Full Sheet$/})).toBeFocused();
			return;
		}
		const tab = surface === "overview" ? this.sheet.tabOverview : this.sheet.tabCombat;
		await expect(tab).toBeFocused();
	}

	async expectWalkSpeed (feet: number): Promise<void> {
		await this.showSurface("overview");
		await expect(this.sheet.dispSpeed).toHaveAttribute("data-speed-text", new RegExp(`\\b${feet}\\b`));
	}

	async toggleEquipment (itemId: string, control: "equip" | "attune"): Promise<void> {
		await this.showSurface("overview");
		await this.sheet.tabInventory.click();
		await this.page.locator(`.charsheet__item[data-item-id="${itemId}"] .charsheet__item-${control}`).click();
	}

	async expectNoSyntheticStates (itemName = "Boots of Speed", powerName = "Boots of Speed Speed"): Promise<void> {
		const activeStates = await this.page.evaluate(() => (globalThis as any).charSheet._state.toJson().activeStates);
		expect(activeStates.filter((state: any) => [itemName, powerName].includes(state.name))).toHaveLength(0);
	}

	async waitForPersistedPower (itemId: string, powerId: string, active: boolean): Promise<void> {
		await this.page.waitForFunction(async ({itemId, powerId, active}) => {
			const cs = (globalThis as any).charSheet;
			const saved = await (globalThis as any).StorageUtil.pGet("charsheet-characters") || [];
			const character = saved.find((it: any) => it.id === cs._currentCharacterId);
			const item = character?.inventory?.find((it: any) => it.id === itemId)?.item;
			return !!item && !!item.itemPowerStates?.[powerId]?.active === active;
		}, {itemId, powerId, active});
	}

	async reload (itemId: string): Promise<void> {
		const characterId = await this.page.evaluate(() => (globalThis as any).charSheet._currentCharacterId);
		if (!characterId) throw new Error("Cannot reload a character without a saved identity");
		await this.page.evaluate(id => {
			window.history.replaceState(window.history.state, "", `?id=${encodeURIComponent(id)}`);
		}, characterId);
		await this.page.reload({waitUntil: "domcontentloaded"});
		await this.page.waitForFunction(({characterId, itemId}) => {
			const cs = (globalThis as any).charSheet;
			return cs?._currentCharacterId === characterId && !!cs._state?.getItemRaw?.(itemId)
				&& !document.querySelector("#charsheet-loading-overlay");
		}, {characterId, itemId}, {timeout: 120_000});
	}
}
