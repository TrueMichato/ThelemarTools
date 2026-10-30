import {expect, Locator, Page} from "@playwright/test";
import {CharacterSheetPage} from "./CharacterSheetPage";

type Source = "PHB" | "XPHB";
type Hp = {current: number; max: number; temp: number};
type LearnedSpell = {id: string; name: string; source: string; prepared: boolean; alwaysPrepared?: boolean};
interface Companion {
	id: string;
	hp: Hp;
	ac: number;
	actorSnapshot: {
		actorId: string;
		lifecycle: string;
		revision: number;
		spell: {source: Source};
		frozen: {level: number; proficiencyBonus: number};
		state: {
			inventory: unknown[];
			resources: unknown;
			spellcasting: {spellSlots: Record<string, {current: number; max: number}>};
		};
	};
}
interface SheetHandle {
	spawn?: unknown;
	_renderCompanions(): void;
	saveCharacter(): Promise<unknown>;
	getState(): {
		addClass(data: Record<string, unknown>): void;
		addCompanion(data: Record<string, unknown>): string;
		getCompanion(id: string): {hp: Hp; hpArray: {current: number; max: number}[] | null};
		getFeatureCompanionSummonerContext(uid: string): unknown;
		reconcileFeatureOwnedCompanion(id: string, options: {summonerContext: unknown}): void;
		getSpells(): LearnedSpell[];
		getCompanions(): Companion[];
		getHp(): Hp;
		getAc(): number;
		getSpellSlotsCurrent(level: number): number;
		getCurrency(): {gp: number};
		getInventory(): {item: {name: string}; quantity: number}[];
	};
}
type BrowserScope = typeof globalThis & {charSheet: SheetHandle};

/** Feature-workflow driver; build progression remains in the character factory suites. */
export class SimulacrumPage {
	readonly sheet: CharacterSheetPage;

	constructor (readonly page: Page) {
		this.sheet = new CharacterSheetPage(page);
		page.on("pageerror", error => console.error(`[Simulacrum browser] ${error.stack || error.message}`));
		page.on("console", message => { if (message.type() === "error") console.error(`[Simulacrum console] ${message.text()}`); });
	}

	async spawnCaster (source: Source): Promise<void> {
		await this.sheet.goto();
		await this.page.waitForFunction(() => typeof (globalThis as BrowserScope).charSheet?.spawn === "function");
		await this.sheet.spawnSavedCharacter(JSON.stringify({
			classes: [{name: "Wizard", source, level: 13}],
			race: "Human",
			background: "Sage",
			seed: `simulacrum-${source}`,
		}), `Simulacrum ${source} caster`);
		await this.prepareSpell("Shield", source);
		await this.prepareSpell("Simulacrum", source);
		await this.addRuby();
		await this.sheet.switchToTab(this.sheet.tabInventory);
		const gold = this.page.locator("#charsheet-inv-ipt-gp");
		await gold.fill("5000");
		await gold.press("Tab");
		await expect.poll(async () => (await this.snapshot()).owner.gp).toBe(5000);
	}

	async prepareSpell (name: string, source: Source | "TGTT"): Promise<void> {
		let spell = await this.findSpell(name, source);
		if (!spell) {
			await this.sheet.openAddSpellModal();
			await this.sheet.searchAddSpellPicker(name);
			await this.sheet.addMountedSpell(name, source);
			await this.sheet.closeAddSpellModal();
			spell = await this.findSpell(name, source);
		}
		expect(spell, `${name}|${source} must be learned through the real picker`).toBeTruthy();
		if (!spell!.prepared && !spell!.alwaysPrepared) {
			await this.sheet.switchToTab(this.sheet.tabSpells);
			await this.page.locator(`.charsheet__spell-item[data-spell-id="${spell!.id}"] .charsheet__spell-prepared`).click();
			await expect.poll(async () => (await this.findSpell(name, source))?.prepared).toBe(true);
		}
	}

	private findSpell (name: string, source: Source | "TGTT"): Promise<LearnedSpell | null> {
		return this.page.evaluate(({spellName, spellSource}) => (globalThis as BrowserScope).charSheet.getState().getSpells()
			.find(spell => spell.name === spellName && spell.source === spellSource) || null, {spellName: name, spellSource: source});
	}

	async addRuby (): Promise<void> {
		const before = (await this.snapshot()).owner.rubies;
		await this.sheet.openAddItemModal();
		const modal = this.sheet.itemPickerModal();
		await modal.getByRole("button", {name: /Components/}).click();
		await modal.locator(".charsheet__modal-search input").fill("Simulacrum");
		const row = modal.locator(".charsheet__modal-list-item")
			.filter({has: this.page.locator(".charsheet__modal-list-item-title").filter({hasText: /^Powdered Ruby \(1500 gp\)$/})}).first();
		await expect(row).toBeVisible();
		await row.locator(".item-picker-add").click();
		await expect.poll(async () => (await this.snapshot()).owner.rubies).toBe(before + 1);
		await modal.locator(".cs-modal__btn-close").click();
	}

	async snapshot () {
		return this.page.evaluate(() => {
			const state = (globalThis as BrowserScope).charSheet.getState();
			return {
				owner: {
					hp: state.getHp(), ac: state.getAc(), slot1: state.getSpellSlotsCurrent(1),
					slot7: state.getSpellSlotsCurrent(7), gp: state.getCurrency().gp,
					rubies: state.getInventory().filter(row => row.item.name === "Powdered Ruby (1500 gp)").reduce((sum, row) => sum + row.quantity, 0),
				},
				companions: state.getCompanions().filter(row => !!row.actorSnapshot).map(row => ({
					id: row.id, actorId: row.actorSnapshot.actorId, source: row.actorSnapshot.spell.source,
					lifecycle: row.actorSnapshot.lifecycle, revision: row.actorSnapshot.revision, hp: row.hp, ac: row.ac,
					level: row.actorSnapshot.frozen.level, pb: row.actorSnapshot.frozen.proficiencyBonus,
					slot1: row.actorSnapshot.state.spellcasting.spellSlots[1].current,
					slot7: row.actorSnapshot.state.spellcasting.spellSlots[7].current,
					inventoryCount: row.actorSnapshot.state.inventory.length,
					spellcasting: JSON.stringify(row.actorSnapshot.state.spellcasting),
					resources: JSON.stringify(row.actorSnapshot.state.resources),
				})),
			};
		});
	}

	async openCreation (source: Source, {play = false} = {}): Promise<Locator> {
		if (play) {
			await this.sheet.enterPlayMode();
			await this.page.locator(".pm-status__tool-btn").filter({hasText: /^Spells$/}).click();
			const drawer = this.page.locator(".pm-drawer--open");
			const spell = await this.findSpell("Simulacrum", source);
			expect(spell).toBeTruthy();
			const row = drawer.locator(`.pm-spell[data-spell-id="${spell!.id}"]`);
			await expect(row).toHaveCount(1);
			await expect(row.locator(".pm-spell__meta")).toContainText(new RegExp(`\\b${source}\\b`));
			await row.locator(".pm-spell__cast").click();
		} else {
			await this.sheet.exitPlayMode();
			await this.sheet.switchToTab(this.sheet.tabSpells);
			const spell = await this.findSpell("Simulacrum", source);
			expect(spell).toBeTruthy();
			await this.page.locator(`.charsheet__spell-item[data-spell-id="${spell!.id}"] .charsheet__spell-cast`).click();
		}
		const preview = this.page.locator(".cs-simulacrum--creation");
		await expect(preview).toBeVisible();
		await expect(preview.getByRole("radio", {name: "Specific creature", exact: true})).toBeDisabled();
		return preview;
	}

	async create (source: Source, {play = false} = {}): Promise<string> {
		const before = await this.snapshot();
		const preview = await this.openCreation(source, {play});
		await preview.locator(".cs-simulacrum__create").click();
		await expect(preview).toBeHidden();
		await expect.poll(async () => (await this.snapshot()).companions.filter(row => row.lifecycle === "active").map(row => row.id))
			.toHaveLength(1);
		await expect.poll(async () => (await this.snapshot()).owner.slot7).toBe(before.owner.slot7 - 1);
		const snapshot = await this.snapshot();
		expect(snapshot.owner.slot7).toBe(before.owner.slot7 - 1);
		expect(snapshot.owner.rubies).toBe(before.owner.rubies - 1);
		return snapshot.companions.find(row => row.lifecycle === "active")!.id;
	}

	async cancelCreation (source: Source): Promise<void> {
		const preview = await this.openCreation(source);
		await preview.getByRole("button", {name: "Cancel", exact: true}).click();
		await expect(preview).toBeHidden();
	}

	async expectPlayModeControls (id: string, source: Source): Promise<void> {
		const manager = await this.openManager(id, {play: true});
		await expect(manager).toContainText("Level 1: 3/4");
		await expect(manager).toContainText("manual resolution");
		const rest = manager.getByRole("button", {name: "Short Rest", exact: true});
		if (source === "XPHB") await expect(rest).toHaveCount(0);
		else await expect(rest).toBeVisible();
		await this.closeManager();
	}

	async openManager (id: string, {play = false} = {}): Promise<Locator> {
		if (play) {
			await this.sheet.enterPlayMode();
			await this.page.locator(".pm-status__tool-btn").filter({hasText: /^More$/}).click();
			await this.page.locator(".pm-context-menu__item").filter({hasText: /^Companions$/}).click();
			await expect(this.page.locator(".pm-drawer--open")).toBeVisible();
		}
		else {
			await this.sheet.exitPlayMode();
			await this.sheet.switchToTab(this.sheet.tabCompanions);
		}
		const card = this.page.locator(`.cs-simulacrum__card[data-companion-id="${id}"]:visible`);
		await expect(card).toBeVisible();
		await card.getByRole("button", {name: "Manage / cast", exact: true}).click();
		const manager = this.page.locator(".cs-simulacrum--manager");
		await expect(manager).toBeVisible();
		return manager;
	}

	async closeManager (): Promise<void> {
		await this.page.locator(".ve-ui-modal__inner:visible").last().getByRole("button", {name: "Close", exact: true}).click();
		await expect(this.page.locator(".cs-simulacrum--manager")).toBeHidden();
	}

	async castShield (id: string): Promise<void> {
		const before = (await this.snapshot()).companions.find(row => row.id === id)!;
		const manager = await this.openManager(id);
		const row = manager.locator(".cs-simulacrum__spell").filter({hasText: "Shield"});
		await row.locator(".cs-simulacrum__slot").selectOption("slot:1");
		await row.getByRole("button", {name: "Cast", exact: true}).click();
		await expect.poll(async () => (await this.snapshot()).companions.find(row => row.id === id)?.slot1).toBe(before.slot1 - 1);
		await this.closeManager();
	}

	async damage (id: string, amount: number): Promise<void> {
		await this.sheet.exitPlayMode();
		await this.sheet.switchToTab(this.sheet.tabCompanions);
		const before = (await this.snapshot()).companions.find(row => row.id === id)!.hp.current;
		await this.page.locator(`.cs-simulacrum__card[data-companion-id="${id}"]:visible`).getByRole("button", {name: "Damage", exact: true}).click();
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		await modal.getByRole("textbox").fill(String(amount));
		await modal.getByRole("button", {name: /^OK$/i}).click();
		await expect.poll(async () => (await this.snapshot()).companions.find(row => row.id === id)?.hp.current).toBe(Math.max(0, before - amount));
	}

	async repair (id: string, source: Source): Promise<void> {
		await this.sheet.switchToTab(this.sheet.tabCompanions);
		await this.page.locator(`.cs-simulacrum__card[data-companion-id="${id}"]:visible`).getByRole("button", {name: "Repair", exact: true}).click();
		if (source === "PHB") {
			const dialog = this.page.locator(".cs-simulacrum--repair");
			await expect(dialog.locator(".cs-simulacrum__repair-confirm")).toBeDisabled();
			await dialog.locator(".cs-simulacrum__repair-amount").fill("20");
			await dialog.locator(".cs-simulacrum__laboratory").check();
			await expect(dialog).toContainText("Restore 3 HP for 300 gp");
			await dialog.getByRole("button", {name: "Pay and repair"}).click();
			await expect(dialog).toBeHidden();
		} else {
			const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
			const section = modal.locator(".charsheet__simulacrum-repairs");
			await section.locator("input[type=number]").fill("20");
			await expect(modal.getByRole("button", {name: /Finish Long Rest/})).toBeDisabled();
			await section.locator("input[type=checkbox]").check();
			await expect(section).toContainText("300");
			await modal.getByRole("button", {name: /Finish Long Rest/}).click();
			await expect(modal).toBeHidden();
		}
	}

	async ownerLongRest (): Promise<void> {
		await this.sheet.exitPlayMode();
		await this.sheet.switchToTab(this.sheet.tabOverview);
		await this.sheet.btnLongRest.click();
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		await modal.getByRole("button", {name: /Finish Long Rest/}).click();
		await expect(modal).toBeHidden();
		await expect.poll(async () => (await this.snapshot()).owner.slot7).toBe(1);
	}

	async expectTerminal (id: string): Promise<void> {
		await this.sheet.exitPlayMode();
		await this.sheet.switchToTab(this.sheet.tabCompanions);
		const card = this.page.locator(`.cs-simulacrum__card[data-companion-id="${id}"]:visible`);
		await expect(card).toContainText("Destroyed / melted");
		await expect(card.getByRole("button", {name: "Damage", exact: true})).toBeDisabled();
		await expect(card.getByRole("button", {name: "Repair", exact: true})).toBeDisabled();
		await card.getByRole("button", {name: "View statblock", exact: true}).click();
		await expect(this.page.locator(".cs-simulacrum--manager details")).toHaveAttribute("open");
		await this.closeManager();
	}

	async dismiss (id: string): Promise<void> {
		await this.sheet.exitPlayMode();
		await this.sheet.switchToTab(this.sheet.tabCompanions);
		await this.page.locator(`.cs-simulacrum__card[data-companion-id="${id}"]:visible`).getByRole("button", {name: "Dismiss", exact: true}).click();
		await this.page.locator(".ve-ui-modal__inner:visible").last().getByRole("button", {name: /Dismiss$/}).click();
		await expect.poll(async () => (await this.snapshot()).companions.some(row => row.id === id)).toBe(false);
	}

	async captureResponsiveManager (id: string, pathFor: (name: string) => string) {
		const toastClose = this.page.locator(".toast__btn-close:visible");
		if (await toastClose.count()) await toastClose.first().dispatchEvent("click", {ctrlKey: true});
		const results = [];
		for (const width of [1440, 390]) {
			for (const night of [false, true]) {
				await this.page.setViewportSize({width, height: 844});
				await this.page.evaluate(isNight => {
					(globalThis as typeof globalThis & {styleSwitcher: {_setActiveStyleTheme(style: string): void}})
						.styleSwitcher._setActiveStyleTheme(isNight ? "night" : "day");
				}, night);
				const manager = await this.openManager(id);
				await this.page.waitForTimeout(300);
				const name = `simulacrum-${width}-${night ? "night" : "day"}`;
				await this.page.screenshot({path: pathFor(`${name}.png`), animations: "disabled"});
				const metrics = await manager.evaluate(root => {
					const channels = (color: string) => (color.match(/[\d.]+/g) || []).map(Number);
					const luminance = (color: string) => channels(color).slice(0, 3).map(value => {
						const channel = value / 255;
						return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
					}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
					const contrast = Array.from(root.querySelectorAll<HTMLElement>("h3,h4,p,summary"))
						.filter(element => element.getClientRects().length && element.textContent?.trim())
						.map(element => {
							const style = getComputedStyle(element);
							let background: Element | null = element;
							while (background?.parentElement && (channels(getComputedStyle(background).backgroundColor)[3] ?? 1) === 0) background = background.parentElement;
							const foregroundLuminance = luminance(style.color);
							const backgroundLuminance = luminance(background ? getComputedStyle(background).backgroundColor : "rgb(255,255,255)");
							const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
							const size = Number.parseFloat(style.fontSize);
							const minimum = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
							return {text: element.textContent!.trim().slice(0, 70), ratio, minimum};
						}).filter(result => result.ratio < result.minimum);
					const bounds = root.getBoundingClientRect();
					const firstCast = Array.from(root.querySelectorAll<HTMLButtonElement>(".cs-simulacrum__spell button"))
						.find(button => button.textContent === "Cast" && !button.disabled);
					const castBounds = firstCast?.getBoundingClientRect();
					const rectangle = (element: Element) => {
						const bounds = element.getBoundingClientRect();
						const style = getComputedStyle(element);
						return {
							tag: element.tagName, classes: element.className,
							top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right,
							height: bounds.height, overflowY: style.overflowY,
							cssHeight: style.height, maxHeight: style.maxHeight,
							scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
						};
					};
					const ancestors = [];
					let visibleTop = 0;
					let visibleBottom = innerHeight;
					for (let ancestor = firstCast?.parentElement; ancestor; ancestor = ancestor.parentElement) {
						ancestors.push(rectangle(ancestor));
						if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(ancestor).overflowY)) continue;
						const bounds = ancestor.getBoundingClientRect();
						visibleTop = Math.max(visibleTop, bounds.top);
						visibleBottom = Math.min(visibleBottom, bounds.bottom);
					}
					const smallControls = Array.from(root.querySelectorAll<HTMLElement>("button,select,input[type=number]"))
						.filter(element => element.getClientRects().length && element.getBoundingClientRect().height < 43.9)
						.map(element => element.textContent?.trim().slice(0, 50) || element.tagName);
					return {
						overflow: root.scrollWidth > root.clientWidth + 1 || bounds.left < 0 || bounds.right > innerWidth + 1,
						contrast, smallControls, firstCastVisible: !!castBounds && castBounds.top >= visibleTop && castBounds.bottom <= visibleBottom,
						diagnostics: {
							viewport: {width: innerWidth, height: innerHeight},
							firstCast: firstCast ? {...rectangle(firstCast), text: firstCast.textContent, disabled: firstCast.disabled} : null,
							visibleTop, visibleBottom, ancestors,
							leadingElements: Array.from(root.querySelectorAll(".cs-simulacrum__summary, .cs-simulacrum__content > .cs-simulacrum__hint, .charsheet__companion-readiness, .cs-simulacrum__toolbar, .cs-simulacrum__jumps, .cs-simulacrum__casting > section:first-child, .cs-simulacrum__field, .cs-simulacrum__rolls"))
								.map(rectangle),
						},
					};
				});
				results.push({name, ...metrics});
				console.log(`[Companion manager geometry] ${JSON.stringify({name, ...metrics})}`);
				await this.closeManager();
				await this.openManager(id, {play: true});
				await this.closeManager();
				const drawer = this.page.locator(".pm-drawer--open");
				await expect(drawer.locator(".btn-companion-save")).toHaveCount(6);
				expect(await drawer.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
				await this.page.screenshot({path: pathFor(`${name}-play.png`), animations: "disabled"});
			}
		}
		return results;
	}

	async expectMountedCompanionDashboard (): Promise<void> {
		// Presentation fixtures use real State registration; creation/payment stay covered by the lifecycle tests.
		const ids = await this.page.evaluate(async () => {
			const sheet = (globalThis as BrowserScope).charSheet;
			const state = sheet.getState();
			const statistics = {abilities: {str: 12, dex: 14, con: 12, int: 6, wis: 12, cha: 6}, ac: 12, speed: {walk: 30}};
			const ordinary = state.addCompanion({name: "Dashboard Owl", type: "familiar", ...statistics, hp: {max: 10, current: 10}});
			const grouped = state.addCompanion({
				name: "Dashboard Pack", type: "conjured", ...statistics, count: 3, hp: {max: 8, current: 8},
				hpArray: Array.from({length: 3}, () => ({current: 8, max: 8})),
			});
			const mount = state.addCompanion({name: "Dashboard Horse", type: "mount", ...statistics, hp: {max: 20, current: 20}});
			state.addClass({name: "Artificer", source: "EFA", level: 5, subclass: {name: "Battle Smith", shortName: "Battle Smith", source: "EFA"}});
			const uid = "Steel Defender|Artificer|EFA|Battle Smith|EFA|3|EFA";
			const feature = state.addCompanion({
				name: "Steel Defender", source: "EFA", type: "class_summon", origin: "Battle Smith", creatureType: "construct",
				hp: {max: 30, current: 30, temp: 0}, featureGrant: {uid}, lifecycle: {status: "alive"},
				uses: {repair: {current: 3, max: 3, recharge: "longRest"}}, hitDice: {die: "d8", current: 5, max: 5},
			});
			state.reconcileFeatureOwnedCompanion(feature, {summonerContext: state.getFeatureCompanionSummonerContext(uid)});
			await sheet.saveCharacter();
			sheet._renderCompanions();
			return {ordinary, grouped, mount, feature};
		});
		await this.sheet.switchToTab(this.sheet.tabCompanions);
		const sheetGroup = this.page.locator(`.charsheet__grouped-companion[data-companion-id="${ids.grouped}"]:visible`);
		await expect(sheetGroup).toHaveCount(1);
		expect(await sheetGroup.evaluate(element => element.tagName)).toBe("ARTICLE");
		await expect(sheetGroup.locator(".charsheet__grouped-creature")).toHaveCount(3);
		await expect(sheetGroup.locator(".btn-companion-save")).toHaveCount(6);
		await expect(sheetGroup.locator(".btn-heal-all")).toBeVisible();
		await expect(sheetGroup.locator(".btn-damage-all")).toBeVisible();
		await expect(sheetGroup.locator("details")).not.toHaveAttribute("open");
		await this.changeCompanionHpThroughPrompt(sheetGroup.locator(".btn-damage-all"), 2);
		await expect.poll(() => this.groupHp(ids.grouped)).toEqual([6, 6, 6]);
		await sheetGroup.locator("summary").click();
		await this.changeCompanionHpThroughPrompt(sheetGroup.getByRole("button", {name: "Damage creature 1", exact: true}), 3);
		await expect.poll(() => this.groupHp(ids.grouped)).toEqual([3, 6, 6]);
		await expect(sheetGroup.locator("details")).toHaveAttribute("open");
		await this.changeCompanionHpThroughPrompt(sheetGroup.getByRole("button", {name: "Heal creature 1", exact: true}), 1);
		await expect.poll(() => this.groupHp(ids.grouped)).toEqual([4, 6, 6]);
		await this.changeCompanionHpThroughPrompt(sheetGroup.locator(".btn-heal-all"), 1);
		await expect.poll(() => this.groupHp(ids.grouped)).toEqual([5, 7, 7]);
		const mount = this.page.locator(`.charsheet__companion-card[data-companion-id="${ids.mount}"]:visible`);
		await expect(mount).toHaveCount(1);
		await expect(mount.locator(".btn-companion-save")).toHaveCount(6);
		const manager = this.page.locator(".charsheet__feature-companion-manager:visible").filter({hasText: "Steel Defender"});
		await expect(manager).toHaveCount(1);
		await expect(manager.locator(".charsheet__feature-companion-readiness")).toHaveCount(1);
		await expect(manager.getByText("Setup and provenance", {exact: true})).toBeVisible();
		const featureCard = this.page.locator(`.charsheet__companion-card[data-companion-id="${ids.feature}"]:visible`);
		const operations = featureCard.getByRole("group", {name: "Steel Defender feature operations", exact: true});
		await expect(operations.getByRole("button", {name: /Force-Empowered Rend/})).toBeVisible();
		await expect(operations.getByRole("button", {name: /Repair/})).toBeVisible();
		await expect(operations.getByRole("button", {name: /Deflect Attack/})).toBeVisible();
		await expect(manager.locator(".charsheet__feature-companion-diagnostics")).toHaveCount(0);

		await this.sheet.enterPlayMode();
		await this.page.locator(".pm-status__tool-btn").filter({hasText: /^More$/}).click();
		await this.page.locator(".pm-context-menu__item").filter({hasText: /^Companions$/}).click();
		const drawer = this.page.locator(".pm-drawer--open");
		const ordinary = drawer.locator(`[data-companion-id="${ids.ordinary}"]`);
		await expect(ordinary.locator(".charsheet__companion-readiness")).toHaveCount(1);
		await expect(ordinary.locator(".pm-companion__controls")).toHaveCount(1);
		await expect(ordinary.locator(".btn-companion-save")).toHaveCount(6);
		const controls = await ordinary.locator(".pm-companion__controls").elementHandle();
		for (const value of [8, 4, 9]) {
			await ordinary.locator(".pm-companion__hp-input").fill(String(value));
			await ordinary.locator(".pm-companion__hp-input").press("Tab");
			await expect.poll(() => this.page.evaluate(id => (globalThis as BrowserScope).charSheet.getState().getCompanion(id).hp.current, ids.ordinary)).toBe(value);
			await expect(ordinary.locator(".charsheet__companion-readiness")).toHaveCount(1);
			await expect(ordinary.locator(".pm-companion__controls")).toHaveCount(1);
			expect(await controls!.evaluate(element => element.isConnected)).toBe(true);
		}
		await expect(drawer.locator(`[data-companion-id="${ids.mount}"] .btn-companion-save`)).toHaveCount(6);
		const feature = drawer.locator(`[data-companion-id="${ids.feature}"]`);
		await expect(feature.locator(".charsheet__companion-readiness")).toHaveCount(1);
		await expect(feature.locator(".btn-companion-save")).toHaveCount(6);
		await expect(feature.locator(".btn-companion-attack-roll")).toHaveCount(0);
		const group = drawer.locator(`.charsheet__grouped-companion[data-companion-id="${ids.grouped}"]`);
		await expect(group.locator(".pm-companion__hp-input")).toHaveCount(0);
		await expect(group.locator(".charsheet__grouped-creature")).toHaveCount(3);
		await this.changeCompanionHpThroughPrompt(group.locator(".btn-damage-all"), 1);
		await expect.poll(() => this.groupHp(ids.grouped)).toEqual([4, 6, 6]);
		await expect(group.locator(".charsheet__grouped-creature")).toHaveCount(3);
		await expect(group.locator(".btn-companion-save")).toHaveCount(6);
		console.log("[Companion mounted DOM] grouped initial/individual+bulk HP and PlayMode refresh; ordinary initial/repeated-HP readiness+toolbar counts; mount and source-qualified feature controls passed.");
	}

	private groupHp (id: string): Promise<number[]> {
		return this.page.evaluate(companionId => (globalThis as BrowserScope).charSheet.getState().getCompanion(companionId).hpArray!.map(row => row.current), id);
	}

	private async changeCompanionHpThroughPrompt (button: Locator, amount: number): Promise<void> {
		await button.click();
		const dialog = this.page.locator(".ve-ui-modal__inner:visible").last();
		await dialog.getByRole("textbox").fill(String(amount));
		await dialog.getByRole("button", {name: /^OK$/i}).click();
		await expect(dialog).toBeHidden();
	}

	async expectFastPlayPreservation (id: string): Promise<void> {
		const manager = await this.openManager(id);
		const casting = manager.locator(".cs-simulacrum__casting");
		const rules = manager.locator(".cs-simulacrum__rules");
		expect(await casting.evaluate((element, other) => !!other && !!(element.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING), await rules.elementHandle())).toBe(true);
		await expect(rules).not.toHaveAttribute("open");
		await expect(manager.locator(".btn-companion-save")).toHaveCount(6);
		const shield = manager.locator(".cs-simulacrum__spell").filter({hasText: "Shield"});
		const slot = shield.locator(".cs-simulacrum__slot");
		const target = manager.locator(".cs-simulacrum__target");
		await slot.selectOption("slot:1");
		await target.selectOption({index: 1});
		const targetValue = await target.inputValue();
		const search = manager.getByRole("searchbox");
		await search.fill("Shield");
		await expect(manager.locator(".cs-simulacrum__spell:visible")).toHaveCount(1);
		const mode = manager.locator(".charsheet__companion-roll-mode");
		await mode.selectOption("advantage");
		const handles = await manager.locator(".cs-simulacrum__casting select, .charsheet__companion-roll-mode").elementHandles();
		const before = await this.snapshot();
		const initiative = manager.locator(".btn-companion-initiative");
		await initiative.click();
		await expect(manager.locator(".charsheet__companion-roll-status")).toContainText(/Initiative/i);
		for (const handle of handles) expect(await handle.evaluate(element => element.isConnected)).toBe(true);
		await expect(initiative).toBeFocused();
		await expect(slot).toHaveValue("slot:1");
		await expect(target).toHaveValue(targetValue);
		await expect(mode).toHaveValue("advantage");
		expect(await this.snapshot()).toEqual(before);
		await rules.locator("summary").click();
		await manager.getByRole("button", {name: "Start combat", exact: true}).click();
		await expect(manager.getByRole("button", {name: "Start next turn", exact: true})).toBeEnabled();
		await expect(slot).toHaveValue("slot:1");
		await expect(target).toHaveValue(targetValue);
		await expect(mode).toHaveValue("advantage");
		await expect(search).toHaveValue("Shield");
		await expect(rules).toHaveAttribute("open");
		await expect(manager.getByRole("button", {name: "Start next turn", exact: true})).toBeFocused();
		const after = await this.snapshot();
		expect(after.owner).toEqual(before.owner);
		expect(after.companions.find(row => row.id === id)!.revision).toBe(before.companions.find(row => row.id === id)!.revision + 1);
		await this.closeManager();
	}

	async reload (): Promise<void> {
		await this.page.reload();
		await this.page.waitForFunction(() => !!(globalThis as BrowserScope).charSheet?.getState().getSpells().length);
	}
}
