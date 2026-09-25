import {expect, Page} from "@playwright/test";
import {CharacterSheetPage} from "./CharacterSheetPage";

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

	async openCreate (): Promise<void> {
		await new CharacterSheetPage(this.page).tabInventory.click();
		await this.page.locator("#charsheet-btn-add-custom-item").click();
		await expect(this.modal.locator("#custom-item-name")).toBeVisible();
	}

	async openOwnedItemFromInventory (id: string): Promise<void> {
		await new CharacterSheetPage(this.page).tabInventory.click();
		await this.page.locator(`.charsheet__item[data-item-id="${id}"] .charsheet__item-edit`).click();
		await expect(this.modal.locator("#custom-item-name")).toBeVisible();
	}

	async selectType (type: string): Promise<void> {
		await this.modal.locator(`.charsheet__custom-item-type-btn[data-type="${type}"]`).click();
	}

	async setBaseDamage (dice: string, type: string): Promise<void> {
		await this.modal.locator("#custom-item-damage").fill(dice);
		await this.modal.locator("#custom-item-dmg-type").selectOption(type);
	}

	async setRiderDice (index: number, dice: string): Promise<void> {
		await this.modal.locator(`[data-rider-index="${index}"] [data-rider-field="dice"]`).fill(dice);
	}

	async expectRiderDiceFocused (index: number): Promise<void> {
		await expect(this.modal.locator(`[data-rider-index="${index}"] [data-rider-field="dice"]`)).toBeFocused();
	}

	async expectValidation (message: string): Promise<void> {
		await expect(this.modal.locator(".charsheet__custom-item-errors")).toContainText(message);
	}

	async expectName (name: string): Promise<void> {
		await expect(this.modal.locator("#custom-item-name")).toHaveValue(name);
	}

	async navigateGroup (name: string): Promise<void> {
		await this.modal.getByRole("navigation", {name: "Item editor groups"}).getByRole("button", {name}).click();
	}

	async toggleGroup (key: string): Promise<void> {
		await this.modal.locator(`#custom-item-group-${key} .charsheet__custom-item-group-toggle`).click();
	}

	async isGroupExpanded (key: string): Promise<boolean> {
		return (await this.modal.locator(`#custom-item-group-${key} .charsheet__custom-item-group-toggle`).getAttribute("aria-expanded")) === "true";
	}

	async getRiderDiceGuidance (index: number): Promise<{placeholder: string; hint: string}> {
		const input = this.modal.locator(`[data-rider-index="${index}"] [data-rider-field="dice"]`);
		const placeholder = await input.getAttribute("placeholder") || "";
		const hint = await this.modal.locator(`[data-rider-index="${index}"] .charsheet__custom-item-hint`).innerText();
		return {placeholder, hint};
	}

	async getAttackDamagePreview (id: string): Promise<string> {
		await new CharacterSheetPage(this.page).tabCombat.click();
		const attackId = await this.page.evaluate(id => {
			const cs = (globalThis as any).charSheet;
			const attack = cs._state.getAttacks().find((it: any) => it.sourceItem?.id === id)
				|| cs._combat._cachedAttacks?.find((it: any) => it.sourceItem?.id === id);
			if (!attack) throw new Error(`No attack for owned item ${id}`);
			return attack.id;
		}, id);
		const row = this.page.locator(`.charsheet__attack-item[data-attack-id="${attackId}"]`);
		await expect(row).toBeVisible();
		return row.locator(".charsheet__attack-details").innerText();
	}

	async expectDiscardPrompt (): Promise<void> {
		await expect(this.modal.getByRole("button", {name: "Discard changes"})).toBeVisible();
	}

	async expectCreateFocus (): Promise<void> {
		await expect(this.page.locator("#charsheet-btn-add-custom-item")).toBeFocused();
	}

	async startBaseSwitch (): Promise<void> {
		await this.modal.getByRole("button", {name: /Start from Base Item/}).click();
	}

	async keepCurrentBase (): Promise<void> {
		await this.page.getByRole("button", {name: "Keep editing"}).click();
	}

	async readWalkSpeed (): Promise<number> {
		return this.page.evaluate(() => (globalThis as any).charSheet._state.getSpeed("walk"));
	}

	async isEditorOverflowed (): Promise<boolean> {
		return this.modal.evaluate(el => el.scrollWidth > el.clientWidth + 1);
	}

	async addDamageRider (dice: string, type: string, conditions: {
		powerName?: string;
		criticalOnly?: boolean;
		oncePerTurn?: boolean;
		targetCreatureType?: string;
	} = {}): Promise<void> {
		await this.modal.locator("#custom-item-add-rider").click();
		const row = this.modal.locator("[data-rider-index]").last();
		await row.locator('[data-rider-field="dice"]').fill(dice);
		await row.locator('[data-rider-field="damageType"]').selectOption(type);
		if (conditions.powerName) await row.locator('[data-rider-field="powerId"]').selectOption({label: conditions.powerName});
		if (conditions.criticalOnly) await row.locator('[data-rider-field="criticalOnly"]').check();
		if (conditions.oncePerTurn) await row.locator('[data-rider-field="oncePerTurn"]').check();
		if (conditions.targetCreatureType) await row.locator('[data-rider-field="targetCreatureType"]').selectOption(conditions.targetCreatureType);
	}

	async addDamagePower (name: string): Promise<void> {
		await this.modal.locator("#custom-item-add-power").click();
		const row = this.modal.locator("[data-power-index]").last();
		await row.locator('[data-power-field="name"]').fill(name);
		await row.locator('[data-power-field="operation"]').selectOption("damage");
	}

	async addReferencePower (name: string): Promise<void> {
		await this.modal.locator("#custom-item-add-power").click();
		await this.modal.locator("[data-power-index]").last().locator('[data-power-field="name"]').fill(name);
	}

	async removeDamagePower (name: string): Promise<void> {
		for (const row of await this.modal.locator("[data-power-index]").all()) {
			if (await row.locator('[data-power-field="name"]').inputValue() !== name) continue;
			await row.locator("[data-power-remove]").click();
			return;
		}
		throw new Error(`Power ${name} is not present in the item editor`);
	}

	async selectRiderPower (index: number, name: string): Promise<void> {
		await this.modal.locator(`[data-rider-index="${index}"] [data-rider-field="powerId"]`).selectOption({label: name});
	}

	async expectRiderPowerFocused (index: number): Promise<void> {
		await expect(this.modal.locator(`[data-rider-index="${index}"] [data-rider-field="powerId"]`)).toBeFocused();
	}

	async setSpeedActivation (action: "bonus" | "action" | "reaction", name: string): Promise<void> {
		await this.modal.locator("#custom-item-speed-mode").selectOption("activated");
		await this.modal.locator("#custom-item-speed-action").selectOption(action);
		await this.modal.locator("#custom-item-speed-power-name").fill(name);
	}

	async getSummary (): Promise<string> {
		return this.modal.locator(".charsheet__custom-item-summary-body").innerText();
	}

	async expandSummary (): Promise<void> {
		await this.modal.locator(".charsheet__custom-item-summary-toggle").click();
	}

	async inspectEditorLayout (path: string, night: boolean): Promise<{
		overflow: boolean; footerVisible: boolean; display: string; footerBottom: number; viewportHeight: number;
		navHeight: number; navButtonHeight: number;
	}> {
		await this.page.evaluate(night => {
			document.documentElement.classList.toggle("ve-night-mode", night);
			document.body.classList.toggle("ve-night-mode", night);
		}, night);
		await this.modal.evaluate(el => {
			const scroller = el.querySelector(".ve-ui-modal__scroller");
			if (!scroller) throw new Error("Item editor modal scroller is missing");
			scroller.scrollTop = 0;
		});
		await this.page.screenshot({path, animations: "disabled"});
		const layout = await this.modal.evaluate(el => {
			const editor = el.querySelector(".charsheet__custom-item-layout")!;
			const footer = el.querySelector(".charsheet__custom-item-footer")!;
			const nav = el.querySelector(".charsheet__custom-item-nav")!;
			const btn = nav.querySelector("button")!;
			return {
				overflow: el.scrollWidth > el.clientWidth + 1,
				footerVisible: footer.getBoundingClientRect().bottom <= window.innerHeight + 1,
				display: getComputedStyle(editor).display,
				footerBottom: footer.getBoundingClientRect().bottom,
				viewportHeight: window.innerHeight,
				navHeight: nav.getBoundingClientRect().height,
				navButtonHeight: btn.getBoundingClientRect().height,
			};
		});
		return layout;
	}

	async cancel (): Promise<void> {
		await this.modal.getByRole("button", {name: "Cancel", exact: true}).click();
	}

	async discard (): Promise<void> {
		await this.modal.getByRole("button", {name: "Discard changes"}).click();
	}

	async keepEditing (): Promise<void> {
		await this.modal.getByRole("button", {name: "Keep editing"}).click();
	}

	async equipAndAttune (id: string): Promise<void> {
		await this.page.evaluate(id => {
			const cs = (globalThis as any).charSheet;
			cs._state.setItemEquipped(id, true);
			cs._state.setItemAttuned(id, true);
			cs._inventory.syncItemDerivedState();
			cs.renderCharacter();
		}, id);
	}

	async invokeSpeed (id: string): Promise<{speed: number; overview: string; active: boolean}> {
		return this.page.evaluate(async id => {
			const cs = (globalThis as any).charSheet;
			const power = cs._state.getItemRaw(id).itemPowers.find((it: any) => it.effectType === "modifySpeed");
			if (!power) throw new Error("No operational speed power found");
			const result = await cs._inventory._pInvokeItemPower(id, power.id, {returnResult: true});
			if (!result?.ok) throw new Error(`Speed power failed: ${result?.reason}`);
			return {
				speed: cs._state.getSpeed("walk"),
				overview: document.getElementById("charsheet-disp-speed")?.getAttribute("data-speed-text") || "",
				active: !!cs._state.getItemRaw(id).itemPowerStates?.[power.id]?.active,
			};
		}, id);
	}

	async rollItemDamage (id: string, isCrit = false): Promise<string> {
		return this.page.evaluate(async ({id, isCrit}) => {
			const cs = (globalThis as any).charSheet;
			const combat = cs._combat;
			const attack = cs._state.getAttacks().find((it: any) => it.sourceItem?.id === id)
				|| combat._cachedAttacks?.find((it: any) => it.sourceItem?.id === id);
			if (!attack) throw new Error(`No attack for owned item ${id}`);
			const original = {
				rollDice: cs.rollDice,
				showDiceResult: cs.showDiceResult,
				pAnimateDamageDice: cs.pAnimateDamageDice,
			};
			let total = "";
			try {
				cs.rollDice = () => 1;
				cs.pAnimateDamageDice = async () => {};
				cs.showDiceResult = (result: any) => { total = String(result.total); };
				await combat._rollDamage(attack.id, isCrit);
				if (!total) throw new Error("Damage roll did not produce a result");
				return total;
			} finally {
				Object.assign(cs, original);
			}
		}, {id, isCrit});
	}

	async exportAndReload (): Promise<void> {
		await this.page.evaluate(() => {
			const cs = (globalThis as any).charSheet;
			const exported = cs._state.toJson();
			if (cs._state.loadFromJson(structuredClone(exported)) === false) throw new Error("Character export was rejected on load");
			cs.renderCharacter();
		});
	}

	async addLegacyCatalogBoots (source: string): Promise<string> {
		return this.page.evaluate(source => {
			const cs = (globalThis as any).charSheet;
			const base = cs._inventory._allItems.find((item: any) => item.name === "Boots of Speed" && item.source === source);
			if (!base) throw new Error(`Catalog Boots of Speed|${source} not loaded`);
			cs._state.addItem(base, 1, true, true);
			const id = cs._state.getItems().find((item: any) => item.name === base.name && item.source === source).id;
			const saved = cs._state.toJson();
			saved.inventory.find((row: any) => row.id === id).item.itemPowers = [
				{id: "unrelated-lore", name: "Unrelated lore", kind: "ability", isReferenceOnly: true},
				...(source === "XDMG" ? [{
					id: "reference:boots-of-speed:bonus",
					name: "Boots of Speed Power",
					kind: "ability",
					actionType: "bonus",
					isReferenceOnly: true,
				}] : []),
			];
			cs._state.loadFromJson(saved);
			cs._inventory.syncItemDerivedState();
			cs.renderCharacter();
			return id;
		}, source);
	}

	async setEquipmentState (id: string, {equipped, attuned}: {equipped?: boolean; attuned?: boolean}): Promise<void> {
		await this.page.evaluate(({id, equipped, attuned}) => {
			const cs = (globalThis as any).charSheet;
			if (equipped !== undefined) cs._state.setItemEquipped(id, equipped);
			if (attuned !== undefined) cs._state.setItemAttuned(id, attuned);
			cs.renderCharacter();
		}, {id, equipped, attuned});
	}

	async getOverviewSpeedText (): Promise<string> {
		return this.page.evaluate(() => document.getElementById("charsheet-disp-speed")?.getAttribute("data-speed-text") || "");
	}

	async failNextCharacterSave (): Promise<void> {
		await this.page.evaluate(async () => {
			const cs = (globalThis as any).charSheet;
			if (await cs.saveCharacter() === false) throw new Error("Test character could not be saved before failure injection");
			const storage = (globalThis as any).StorageUtil;
			const original = storage.pSet;
			storage.pSet = async function (key: string, value: unknown) {
				if (key === "charsheet-characters") {
					storage.pSet = original;
					throw new Error("Simulated character persistence failure");
				}
				return original.call(this, key, value);
			};
			(globalThis as any).__itemEditorSaveFeedback = [];
			const originalToast = (globalThis as any).JqueryUtil.doToast;
			(globalThis as any).JqueryUtil.doToast = function (message: {type: string}) {
				(globalThis as any).__itemEditorSaveFeedback.push(message.type);
				return originalToast.call(this, message);
			};
		});
	}

	async getSaveFeedback (): Promise<string[]> {
		return this.page.evaluate(() => (globalThis as any).__itemEditorSaveFeedback || []);
	}

	async getPersistedItemNames (id: string): Promise<{canonical: string | null; mirror: string | null}> {
		return this.page.evaluate(async id => {
			const cs = (globalThis as any).charSheet;
			const saved = await (globalThis as any).StorageUtil.pGet("charsheet-characters") || [];
			const canonical = saved.find((character: any) => character.id === cs._currentCharacterId);
			const mirror = cs._readActiveCharacterMirror(cs._currentCharacterId);
			const name = (character: any): string | null =>
				character?.inventory?.find((row: any) => row.id === id)?.item?.name || null;
			return {canonical: name(canonical), mirror: name(mirror)};
		}, id);
	}

	async addRawItem (item: object): Promise<string> {
		return this.page.evaluate(item => {
			const cs = (globalThis as any).charSheet;
			const state = cs._state;
			state.addItem(item);
			cs.renderCharacter();
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

	async chooseBase (name: string, source: string, {replaceDirty = false} = {}): Promise<void> {
		await this.startBaseSwitch();
		if (replaceDirty) await this.page.getByRole("button", {name: "Replace draft"}).click();
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
		await expect(this.modal.locator(".charsheet__custom-item-errors").getByText(text, {exact: false})).toBeVisible();
	}
}
