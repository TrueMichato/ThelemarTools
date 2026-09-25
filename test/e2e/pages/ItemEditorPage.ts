import {expect, Page} from "@playwright/test";

export class ItemEditorPage {
	constructor (private readonly page: Page) {}

	private get modal () {
		return this.page.locator(".ve-ui-modal__inner:visible").last();
	}

	async openCatalogClone (source: string): Promise<void> {
		await this.page.evaluate(async source => {
			const inventory = (globalThis as any).charSheet._inventory;
			const base = inventory._allItems.find((item: any) => item.name === "Boots of Speed" && item.source === source);
			if (!base) throw new Error(`Catalog Boots of Speed|${source} not loaded`);
			await inventory._showAddCustomItem({prefillItem: base});
		}, source);
		await expect(this.modal.locator("#custom-item-name")).toHaveValue("Boots of Speed");
	}

	async openOwnedItem (id: string): Promise<void> {
		await this.page.evaluate(async id => {
			await (globalThis as any).charSheet._inventory._modifyItemById(id);
		}, id);
		await expect(this.modal.locator("#custom-item-name")).toBeVisible();
	}

	async addRawItem (item: object): Promise<string> {
		return this.page.evaluate(item => {
			const state = (globalThis as any).charSheet._state;
			state.addItem(item);
			return state.getItems().find((row: any) => row.name === (item as any).name).id;
		}, item);
	}

	async getRawItem (id: string): Promise<any> {
		return this.page.evaluate(id => (globalThis as any).charSheet._state.getItemRaw(id), id);
	}

	async getItemPowerNames (id: string): Promise<string[]> {
		return this.page.evaluate(id => (globalThis as any).charSheet._state.getItemPowers()
			.filter((power: any) => power.itemId === id).map((power: any) => power.name), id);
	}

	async findOwnedIds (name: string): Promise<string[]> {
		return this.page.evaluate(name => (globalThis as any).charSheet._state.getItems()
			.filter((row: any) => row.name === name).map((row: any) => row.id), name);
	}

	async findCustomItem (name: string): Promise<any> {
		return this.page.evaluate(name => (globalThis as any).charSheet._state.getItems()
			.find((row: any) => row.name === name && row.source === "Custom"), name);
	}

	async countItems (): Promise<number> {
		return this.page.evaluate(() => (globalThis as any).charSheet._state.getItems().length);
	}

	async rename (name: string): Promise<void> {
		await this.modal.locator("#custom-item-name").fill(name);
	}

	async clear (selector: string): Promise<void> {
		await this.modal.locator(selector).fill("");
	}

	async setWalkSpeedMultiplier (value: string): Promise<void> {
		await this.modal.locator("#custom-item-multiply-walk").selectOption(value);
	}

	async uncheck (selector: string): Promise<void> {
		await this.modal.locator(".charsheet__custom-item-prop-check").filter({has: this.page.locator(selector)}).click();
	}

	async save (): Promise<void> {
		await this.modal.getByRole("button", {name: /Create Item|Save Changes/}).click();
	}

	async expectPower (name: string, isReferenceOnly: boolean): Promise<void> {
		const row = this.modal.locator("[data-power-index]").filter({has: this.page.locator(`[data-power-field="name"][value="${name}"]`)});
		await expect(row).toHaveCount(1);
		await expect(row.locator('[data-power-field="isReferenceOnly"]')).toBeChecked({checked: isReferenceOnly});
	}

	async removeSpeedPower (): Promise<void> {
		const row = this.modal.locator("[data-power-index]")
			.filter({has: this.page.locator('[data-power-field="name"][value="Boots of Speed Speed"]')});
		await row.locator("[data-power-remove]").click();
	}

	async chooseBase (name: string, source: string): Promise<void> {
		await this.modal.getByRole("button", {name: /Start from Base Item/}).click();
		const picker = this.page.locator(".ve-ui-modal__inner:visible").last();
		await picker.locator(".charsheet__item-tab").filter({hasText: "Magic Items"}).click();
		await picker.locator(".charsheet__modal-search input").fill(name);
		const row = picker.locator(".charsheet__modal-list-item")
			.filter({has: this.page.locator(".charsheet__modal-list-item-title").filter({hasText: name})})
			.filter({hasText: source === "XDMG" ? "DMG'24" : source === "DMG" ? "DMG'14" : source});
		await row.first().locator(".item-picker-add").click();
	}

	async expectPowerCount (count: number): Promise<void> {
		await expect(this.modal.locator("[data-power-index]")).toHaveCount(count);
	}

	async expectSpellUses (count: number): Promise<void> {
		await expect(this.modal.locator(".charsheet__custom-item-spell-selected-item")).toHaveCount(count);
	}

	async removeFirstSpellUse (): Promise<void> {
		await this.modal.locator(".charsheet__custom-item-spell-selected-item .charsheet__custom-item-spell-remove").first().click();
	}

	async expectName (name: string): Promise<void> {
		await expect(this.modal.locator("#custom-item-name")).toHaveValue(name);
	}

	async expectWarning (text: string): Promise<void> {
		await expect(this.page.getByText(text, {exact: false})).toBeVisible();
	}
}
