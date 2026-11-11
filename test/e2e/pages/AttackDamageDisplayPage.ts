import {expect, Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {CharacterSheetPage} from "./CharacterSheetPage";

interface CatalogEntity {name: string; source: string}
interface CatalogWeapon extends CatalogEntity {dmg1?: string}
interface WeaponRow extends CatalogWeapon {
	id: string;
	_isGamblerWeapon?: boolean;
	_gamblerWeaponId?: string;
}
interface DamageParse {numDice: number; sides: number}
interface DamageResult {title: string; modifier: number; total: number; subtitle: string}
interface DamageCombat {
	_cachedAttacks: Array<{id: string; damage: string; sourceItem?: WeaponRow}>;
	renderAttacks(): void;
	_parseDamage(formula: string, crit?: boolean, options?: {maximize?: boolean}): DamageParse;
}
interface DamageSheet {
	_state: {
		getItems(): WeaponRow[];
		getItemRaw(id: string): CatalogWeapon;
		addItem(item: CatalogEntity, quantity: number, equipped: boolean): void;
		replaceItem(id: string, item: CatalogWeapon): void;
		setItemEquipped(id: string, equipped: boolean): void;
		setItemHandsUsed(id: string, hands: number): void;
		updateInventoryItemAttackOverrides(id: string, update: {attackOverrides: {damage: string}}): void;
		getItemMaterialCatalog(): CatalogEntity[];
		setItemMaterial(id: string, material: CatalogEntity): boolean;
		getEffectiveWeaponDamage(id: string): {dice: string; diceVersatile: string | null; display: string};
		getEffectiveWeaponDamageProfile(item: WeaponRow): {dmg1: string; dmg2: string | null};
		getWeaponDamageDie(item: WeaponRow): string;
	};
	_combat: DamageCombat;
	_inventory: {render(): void};
	_upgrades: {applyUpgradesToItem(id: string, options: {upgrades: CatalogEntity[]}): {appliedUpgrades: number; socketed: boolean}};
	getItems(): CatalogEntity[];
	getItemUpgrades(): CatalogEntity[];
	showDiceResult(result: DamageResult): void;
	spawn: unknown;
	damageDisplayProbe?: {
		parse: DamageCombat["_parseDamage"];
		show: DamageSheet["showDiceResult"];
		calls: Array<{formula: string; crit: boolean; numDice: number; sides: number}>;
		results: DamageResult[];
	};
}
type DamageRuntime = typeof globalThis & {
	charSheet: DamageSheet;
	BrewUtil2: {pAddBrewFromUrl(url: string): Promise<void>};
};

interface WeaponUpdate {
	superior?: boolean;
	material?: string;
	hands?: number;
	equipped?: boolean;
	rawDice?: string;
	damageOverride?: string;
}

export class AttackDamageDisplayPage {
	readonly sheet: CharacterSheetPage;

	constructor (readonly page: Page) {
		this.sheet = new CharacterSheetPage(page);
	}

	async openLocalCatalog (): Promise<void> {
		await this.page.route("**/homebrew/index.json", route => route.fulfill({
			contentType: "application/json", body: JSON.stringify({toImport: []}),
		}));
		for (const file of ["charactersheet-state.js", "charactersheet-combat.js"]) {
			const path = `js/charactersheet/${file}`;
			const response = await this.page.request.get(`/${path}`);
			expect(response.ok()).toBe(true);
			expect(await response.text()).toBe(readFileSync(path, "utf8"));
		}
		await this.page.goto("/charactersheet.html", {waitUntil: "domcontentloaded"});
		await this.page.waitForFunction(() => Boolean((globalThis as DamageRuntime).charSheet?.spawn));
		await this.page.evaluate(async () => {
			await (globalThis as DamageRuntime).BrewUtil2.pAddBrewFromUrl("/homebrew/TravelersGuidetoThelemar.json");
		});
		await this.page.goto("/charactersheet.html?damage-display-brew=1", {waitUntil: "domcontentloaded"});
		await this.page.waitForFunction(() => Boolean((globalThis as DamageRuntime).charSheet?.spawn));
	}

	async gamblerWeapons (): Promise<Array<{id: string; key?: string}>> {
		return this.page.evaluate(() => (globalThis as DamageRuntime).charSheet._state.getItems()
			.filter(item => item._isGamblerWeapon)
			.map(item => ({id: item.id, key: item._gamblerWeaponId})));
	}

	async addCatalogItem (name: string): Promise<string> {
		return this.page.evaluate(itemName => {
			const cs = (globalThis as DamageRuntime).charSheet;
			const item = cs.getItems().find(item => item.name === itemName && item.source === "PHB");
			if (!item) throw new Error(`Missing PHB catalog item: ${itemName}`);
			cs._state.addItem(item, 1, true);
			const row = cs._state.getItems().find(row => row.name === itemName && row.source === "PHB");
			if (!row) throw new Error(`Added item not in inventory: ${itemName}`);
			return row.id;
		}, name);
	}

	async configureWeapon (id: string, update: WeaponUpdate): Promise<void> {
		await this.page.evaluate(({id, update}) => {
			const cs = (globalThis as DamageRuntime).charSheet;
			const state = cs._state;
			if (update.superior) {
				const superior = cs.getItemUpgrades().find(upgrade => upgrade.name === "Superior");
				if (!superior) throw new Error("Missing real Superior upgrade");
				if (cs._upgrades.applyUpgradesToItem(id, {upgrades: [superior]}).appliedUpgrades !== 1) throw new Error("Superior was not applied");
			}
			if (update.material) {
				const material = state.getItemMaterialCatalog().find(material => material.name === update.material && material.source === "TGTT");
				if (!material || !state.setItemMaterial(id, material)) throw new Error(`Material not applied: ${update.material}`);
			}
			if (update.rawDice !== undefined) state.replaceItem(id, {...state.getItemRaw(id), dmg1: update.rawDice});
			if (update.damageOverride !== undefined) state.updateInventoryItemAttackOverrides(id, {attackOverrides: {damage: update.damageOverride}});
			if (update.hands !== undefined) state.setItemHandsUsed(id, update.hands);
			if (update.equipped !== undefined) state.setItemEquipped(id, update.equipped);
		}, {id, update});
	}

	async assertDamage (id: string, expected: string, {crit = false} = {}) {
		const snapshot = await this.page.evaluate(id => {
			const cs = (globalThis as DamageRuntime).charSheet;
			cs._combat.renderAttacks();
			cs._inventory.render();
			const item = cs._state.getItems().find(item => item.id === id);
			const attack = cs._combat._cachedAttacks.find(attack => attack.sourceItem?.id === id);
			if (!item || !attack) throw new Error(`Missing weapon/attack: ${id}`);
			return {
				attackId: attack.id,
				rawDice: cs._state.getItemRaw(id).dmg1,
				profile: cs._state.getEffectiveWeaponDamageProfile(item),
				selectedDie: cs._state.getWeaponDamageDie(item),
				itemDamage: cs._state.getEffectiveWeaponDamage(id),
			};
		}, id);
		await this.sheet.switchToTab(this.sheet.tabInventory);
		await expect(this.page.locator(`.charsheet__item[data-item-id="${id}"]`)).toContainText(snapshot.itemDamage.display);
		await this.sheet.switchToTab(this.sheet.tabCombat);
		const row = this.page.locator(`.charsheet__attack-item[data-attack-id="${snapshot.attackId}"]`);
		await expect(row).toBeVisible();
		const badge = row.locator(".charsheet__attack-details > .badge-danger");
		const badgeText = await badge.innerText();
		const displayedDice = /^(\d+d\d+)/.exec(badgeText)?.[1];

		await this.page.evaluate(() => {
			const cs = (globalThis as DamageRuntime).charSheet;
			const probe: NonNullable<DamageSheet["damageDisplayProbe"]> = {
				parse: cs._combat._parseDamage, show: cs.showDiceResult, calls: [], results: [],
			};
			cs.damageDisplayProbe = probe;
			cs._combat._parseDamage = function (formula, crit, options) {
				const result = probe.parse.call(this, formula, crit, options);
				probe.calls.push({formula, crit: Boolean(crit), numDice: result.numDice, sides: result.sides});
				return result;
			};
			cs.showDiceResult = function (result) {
				probe.results.push(result);
				return probe.show.call(this, result);
			};
		});
		try {
			await row.locator(".charsheet__attack-damage").click({modifiers: crit ? ["Shift"] : []});
			await this.page.waitForFunction(() => Boolean((globalThis as DamageRuntime).charSheet.damageDisplayProbe?.results.length));
			const rolled = await this.page.evaluate(() => {
				const probe = (globalThis as DamageRuntime).charSheet.damageDisplayProbe;
				if (!probe) throw new Error("Damage observer missing");
				return {calls: probe.calls, result: probe.results.at(-1)};
			});
			const dice = /^(\d+)d(\d+)$/.exec(expected);
			if (!dice) throw new Error(`Not a dice expression: ${expected}`);
			if (!rolled.result) throw new Error("Damage result missing after native click");
			expect(rolled.calls[0]).toEqual({
				formula: expected, crit, numDice: Number(dice[1]) * (crit ? 2 : 1), sides: Number(dice[2]),
			});
			expect(displayedDice, `Combat badge: ${badgeText}; actual roller: ${rolled.calls[0].formula}`).toBe(expected);
			expect(badgeText).toContain(`${rolled.result.modifier >= 0 ? "+" : ""}${rolled.result.modifier} `);
			return {...snapshot, ...rolled, badgeText};
		} finally {
			await this.page.evaluate(() => {
				const cs = (globalThis as DamageRuntime).charSheet;
				const probe = cs.damageDisplayProbe;
				if (!probe) throw new Error("Original damage methods unavailable");
				cs._combat._parseDamage = probe.parse;
				cs.showDiceResult = probe.show;
				delete cs.damageDisplayProbe;
			});
		}
	}
}
