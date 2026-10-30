import {expect, Page} from "@playwright/test";
import {SimulacrumPage} from "./SimulacrumPage";

interface MaterialState {
	getSpells(): {id: string; name: string; source: string; ritual?: boolean}[];
	getInventory(): {id: string; quantity: number; item: {name: string; spellComponent?: {material: string}}}[];
	getAc(): number;
	getAcBreakdown(): {total: number};
	getSpellSlotsCurrent(level: number): number;
	getSettings(): {ignoreSpellcastingRestrictions?: boolean};
	getCurrency(): Record<string, number>;
	getTotalGold(): number;
	getCompanions(): {id: string; actorSnapshot?: {version: number; lifecycle: string}}[];
}
type Scope = typeof globalThis & {charSheet: {
	spawn?: unknown;
	getState(): MaterialState;
	_spellsData: {name: string; source: string; components?: {m?: string | {cost?: number; consume?: boolean | string}}}[];
	_itemsData: {source: string; name: string; spellComponent?: {key: string; spells: string[]}}[];
}};

/** Actual picker, permission, and visible-AC boundaries; no direct state mutations. */
export class SpellMaterialsPage {
	readonly simulacrum: SimulacrumPage;

	constructor (readonly page: Page) {
		this.simulacrum = new SimulacrumPage(page);
	}

	async spawn (): Promise<void> {
		const sheet = this.simulacrum.sheet;
		await sheet.goto();
		await this.page.waitForFunction(() => typeof (globalThis as Scope).charSheet?.spawn === "function");
		await sheet.spawnSavedCharacter(JSON.stringify({
			classes: [{name: "Wizard", source: "XPHB", level: 13}],
			race: "Human", background: "Sage", seed: "required-materials",
		}), "Required material caster");
		for (const name of ["Shield", "Continual Flame", "Simulacrum"]) await this.simulacrum.prepareSpell(name, "XPHB");
		await this.simulacrum.prepareSpell("Identify", "TGTT");
	}

	async snapshot () {
		return this.page.evaluate(() => {
			const state = (globalThis as Scope).charSheet.getState();
			return {
				ac: state.getAc(), breakdown: state.getAcBreakdown().total,
				slot1: state.getSpellSlotsCurrent(1), slot2: state.getSpellSlotsCurrent(2), slot7: state.getSpellSlotsCurrent(7),
				inventory: state.getInventory().map(row => ({id: row.id, name: row.item.name, quantity: row.quantity})),
				ignored: !!state.getSettings().ignoreSpellcastingRestrictions,
				wallet: state.getCurrency(), walletCp: Math.round(state.getTotalGold() * 100),
				companions: state.getCompanions().map(row => ({id: row.id, version: row.actorSnapshot?.version, lifecycle: row.actorSnapshot?.lifecycle})),
			};
		});
	}

	async auditCatalog () {
		return this.page.evaluate(async () => {
			const sheet = (globalThis as Scope).charSheet;
			type Requirement = {key: string; kind: "item" | "currency" | "choice"; manual?: boolean; options?: Requirement[]};
			const modulePath = "/js/charactersheet/charactersheet-spell-materials.js";
			const {CharacterSheetSpellMaterials: materials}: {CharacterSheetSpellMaterials: {
				getRequirements(spell: Scope["charSheet"]["_spellsData"][number]): Requirement[];
				getItemRequirements(requirement: Requirement): Requirement[];
			}} = await import(modulePath);
			const structured = sheet._spellsData.filter(row => typeof row.components?.m === "object" && (row.components.m.cost || row.components.m.consume));
			const prose = sheet._spellsData.filter(row => typeof row.components?.m === "string" && /[\d,]+\s*\+?\s*(?:CP|SP|EP|GP|PP|gold pieces?|silver pieces?|copper pieces?|electrum pieces?|platinum pieces?)\b|consum/i.test(row.components.m));
			const supplies = sheet._itemsData.filter(row => row.spellComponent);
			const coverage = sheet._spellsData.map(spell => ({spell, requirements: materials.getRequirements(spell)}));
			const physical = coverage.flatMap(({spell, requirements}) => requirements.flatMap(requirement => materials.getItemRequirements(requirement).map(row => ({spell, row}))));
			const currency = coverage.filter(({requirements}) => requirements.some(row => row.kind === "currency" || row.options?.some(option => option.kind === "currency")));
			return {
				reach: "actual loaded site+brew+prerelease pool; typed item/currency/choice projection, not every possible brew; manual qualifications/target quantities are not automatically proved",
				spells: sheet._spellsData.length, structuredRows: structured.length, proseRows: prose.length, supplies: supplies.length,
				brewSpells: sheet._spellsData.filter(row => row.source === "TGTT").length,
				currencySpells: currency.map(({spell}) => `${spell.name}|${spell.source}`),
				manualRows: physical.filter(({row}) => row.manual).length,
				vagueSets: supplies.filter(row => /Material Set/i.test(row.name)).map(row => row.name),
				missing: [
					...structured.filter(spell => !materials.getRequirements(spell).length).map(row => `${row.name}|${row.source}: no typed projection`),
					...physical.filter(({spell, row}) => !supplies.some(item => item.source === spell.source && item.spellComponent?.key === row.key)).map(({spell, row}) => `${spell.name}|${spell.source}: ${row.key}`),
				],
			};
		});
	}

	async setWallet (values: Record<"cp" | "sp" | "ep" | "gp" | "pp", number>): Promise<void> {
		await this.exitPlayMode();
		await this.simulacrum.sheet.switchToTab(this.simulacrum.sheet.tabInventory);
		for (const [type, value] of Object.entries(values)) {
			const input = this.page.locator(`#charsheet-inv-ipt-${type}`);
			await input.fill(String(value));
			await input.press("Tab");
			await expect.poll(async () => (await this.snapshot()).wallet[type]).toBe(value);
		}
	}

	async expectWalletSearch (name: string): Promise<void> {
		await this.exitPlayMode();
		await this.simulacrum.sheet.openAddItemModal();
		const modal = this.simulacrum.sheet.itemPickerModal();
		await modal.getByRole("button", {name: /Components/}).click();
		await modal.locator(".charsheet__modal-search input").fill(name);
		await expect(modal).toContainText("Wallet-backed spell requirements");
		await expect(modal).toContainText("not inventory products");
		await expect(modal.locator(".charsheet__modal-list-item")).toHaveCount(0);
		await modal.locator(".cs-modal__btn-close").click();
	}

	async cast (name: string, {play = false, chooseSlot = true} = {}): Promise<void> {
		const {id, ritual} = await this.page.evaluate(({spellName, source}) => {
			const spell = (globalThis as Scope).charSheet.getState().getSpells().find(row => row.name === spellName && row.source === source)!;
			return {id: spell.id, ritual: spell.ritual};
		}, {spellName: name, source: name === "Identify" ? "TGTT" : "XPHB"});
		const sheet = this.simulacrum.sheet;
		if (play) {
			await sheet.enterPlayMode();
			if (!(await this.page.locator('.pm-drawer--open[aria-labelledby="pm-drawer-title-spells"]').isVisible())) {
				await this.page.locator(".pm-status__tool-btn").filter({hasText: /^Spells$/}).click();
			}
			await this.page.locator(`.pm-drawer--open .pm-spell[data-spell-id="${id}"] .pm-spell__cast:not(.pm-spell__cast--ritual)`).click();
			if (ritual) await this.page.getByRole("button", {name: /Cast Normally \(use slot\)/}).click();
			if (chooseSlot && ritual) {
				const slots = this.page.locator(".ve-ui-modal__inner:visible").filter({hasText: `Cast ${name} — Choose Slot Level`});
				await slots.locator("select").selectOption({index: 1});
				await slots.getByRole("button", {name: "OK", exact: true}).click();
				await expect(slots).toBeHidden();
			} else if (chooseSlot && name !== "Identify") {
				const slots = this.page.locator(".pm-modal-overlay").filter({hasText: `Cast ${name}`});
				await slots.locator(".pm-upcast__slot").filter({has: this.page.locator(".pm-upcast__level", {hasText: name === "Shield" ? /^1st$/ : /^2nd$/})}).click();
				await expect(slots).toBeHidden();
			}
		} else {
			await this.exitPlayMode();
			await sheet.switchToTab(sheet.tabSpells);
			await this.page.locator(`.charsheet__spell-item[data-spell-id="${id}"] .charsheet__spell-cast`).click();
		}
	}

	async cancelPlaySlotChoice (name: string): Promise<void> {
		await this.cast(name, {play: true, chooseSlot: false});
		const modal = this.page.locator(".pm-modal-overlay").filter({hasText: `Cast ${name}`});
		await expect(modal).toBeVisible();
		await modal.getByRole("button", {name: "Cancel", exact: true}).click();
		await expect(modal).toBeHidden();
	}

	permission () {
		return this.page.getByRole("dialog").filter({hasText: "Missing Materials"}).last();
	}

	async cancelPermission (method: "button" | "escape" | "close"): Promise<void> {
		const modal = this.permission();
		await expect(modal).toBeVisible();
		await expect(modal.getByRole("button", {name: "Cancel", exact: true})).toBeFocused();
		if (method === "escape") await this.page.keyboard.press("Escape");
		else if (method === "close") await modal.locator(".cs-modal__btn-close").click();
		else await modal.getByRole("button", {name: "Cancel", exact: true}).click();
		await expect(modal).toBeHidden();
	}

	async override (): Promise<void> {
		const modal = this.permission();
		await expect(modal).toBeVisible();
		await expect(modal).toContainText("Only override if your DM allows");
		await modal.getByRole("button", {name: "Override for this cast (DM permission required)", exact: true}).click();
		await expect(modal).toBeHidden();
	}

	async addSupply (spell: string, name: string): Promise<void> {
		const sheet = this.simulacrum.sheet;
		await this.exitPlayMode();
		await sheet.openAddItemModal();
		const modal = sheet.itemPickerModal();
		await modal.getByRole("button", {name: /Components/}).click();
		await modal.locator(".charsheet__modal-search input").fill(spell);
		const row = modal.locator(".charsheet__modal-list-item")
			.filter({has: this.page.locator(".charsheet__modal-list-item-title").filter({hasText: name})}).first();
		await expect(row).toBeVisible();
		await expect(row).toContainText("required supply");
		await expect(row.locator('[data-vet-page="items.html"]')).toHaveCount(0);
		const before = (await this.snapshot()).inventory.reduce((sum, item) => sum + item.quantity, 0);
		await row.locator(".item-picker-add").click();
		await expect.poll(async () => (await this.snapshot()).inventory.reduce((sum, item) => sum + item.quantity, 0)).toBe(before + 1);
		await modal.locator(".cs-modal__btn-close").click();
	}

	async expectVisibleAc (expected: number, {play = false} = {}): Promise<void> {
		if (play) {
			await expect(this.page.locator(".pm-status__vital").filter({has: this.page.locator(".pm-status__vital-label", {hasText: /^AC$/})}).locator(".pm-status__vital-value")).toHaveText(String(expected));
		} else {
			await this.simulacrum.sheet.switchToTab(this.simulacrum.sheet.tabOverview);
			await expect(this.page.locator("#charsheet-disp-ac")).toHaveText(String(expected));
		}
		expect((await this.snapshot()).breakdown).toBe(expected);
	}

	async startCombat (): Promise<void> {
		const sheet = this.simulacrum.sheet;
		await this.exitPlayMode();
		await sheet.switchToTab(sheet.tabCombat);
		await this.page.locator("#charsheet-combat-start").click();
		await expect(this.page.locator("#charsheet-combat-next-round")).toBeVisible();
	}

	async nextRound (): Promise<void> {
		const sheet = this.simulacrum.sheet;
		await this.exitPlayMode();
		await sheet.switchToTab(sheet.tabCombat);
		await this.page.locator("#charsheet-combat-next-round").click();
	}

	private async exitPlayMode (): Promise<void> {
		if (await this.page.locator(".charsheet-page.charsheet--play-mode").isVisible()) {
			if (await this.page.locator(".pm-drawer--open").isVisible()) {
				await this.page.keyboard.press("Escape");
				await expect(this.page.locator(".pm-drawer--open")).toHaveCount(0);
			}
			await expect(this.page.locator(".toast__btn-close")).toHaveCount(0, {timeout: 20_000});
		}
		await this.simulacrum.sheet.exitPlayMode();
	}

	async capturePermissionLayouts (pathFor: (name: string) => string) {
		const modal = this.permission();
		const results = [];
		for (const width of [1280, 390]) {
			for (const night of [false, true]) {
				await this.page.setViewportSize({width, height: 844});
				await this.page.evaluate(isNight => {
					document.documentElement.classList.toggle("ve-night-mode", isNight);
					document.documentElement.classList.toggle("ve-night-mode--standard", isNight);
				}, night);
				const name = `material-permission-${width}-${night ? "night" : "day"}`;
				await this.page.screenshot({path: pathFor(`${name}.png`), animations: "disabled"});
				results.push(await modal.evaluate((root, label) => {
					const bounds = root.getBoundingClientRect();
					const buttons = [...root.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.offsetHeight && !button.classList.contains("cs-modal__btn-close"));
					return {
						name: label,
						overflow: root.scrollWidth > root.clientWidth + 1 || bounds.left < 0 || bounds.right > innerWidth + 1,
						wrappedControlsFit: buttons.every(button => button.scrollWidth <= button.clientWidth + 1),
						mobileTargetsFit: innerWidth > 640 || buttons.every(button => button.offsetHeight >= 44),
					};
				}, name));
			}
		}
		return results;
	}
}
