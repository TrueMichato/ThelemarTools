import {expect, type Page} from "@playwright/test";

export class CreatureTransformationPage {
	constructor (readonly page: Page) {}

	get root () { return this.page.locator(".bqa__transformation:visible"); }

	templateChoice (id: string) {
		return this.root.locator(`.bqa__transformation-choice[data-recipe-id="${id}"]`);
	}

	recipeInfo (id: string) {
		return this.templateChoice(id).locator("..").locator(".bqa__transformation-info");
	}

	optionInfo (group: string, value: string) {
		return this.optionControl(group, value).locator("..").locator("..").locator(".bqa__transformation-info");
	}

	selectedRecipeInfo () {
		return this.root.locator(".bqa__transformation-selected .bqa__transformation-info");
	}

	optionByName (group: string, name: string) {
		return this.root.getByRole("group", {name: new RegExp(`^${group}(?: \\(required\\))?$`)})
			.locator(".bqa__transformation-option", {hasText: name}).locator("input");
	}

	get beforeStatblock () { return this.root.locator(".bqa__transformation-statblock").first(); }
	get afterStatblock () { return this.root.locator(".bqa__transformation-statblock").nth(1); }

	async deltaLayout () {
		return this.root.locator(".bqa__transformation-config").evaluate(node => {
			const delta = node.querySelector(".bqa__transformation-delta");
			if (!delta) throw new Error("Selected recipe has no mechanical delta.");
			return {
				isFullWidth: node.classList.contains("bqa__transformation-config--no-options"),
				widthRatio: delta.getBoundingClientRect().width / node.getBoundingClientRect().width,
				fontSize: parseFloat(getComputedStyle(delta.querySelector("li") || delta).fontSize),
			};
		});
	}

	get nativeHover () {
		return this.page.locator(".ve-hwin:visible").last();
	}

	async dismissNativeHover () {
		await this.page.mouse.move(0, 0);
		for (let ix = 0; ix < 5 && await this.page.locator(".ve-hwin:visible").count(); ix++) {
			await this.nativeHover.locator('[title="Close (CTRL to Close All)"]').click();
			await this.page.mouse.move(0, 0);
		}
		await expect(this.page.locator(".ve-hwin:visible")).toHaveCount(0);
	}

	optionControl (group: string, value: string) {
		return this.root.getByRole("group", {name: new RegExp(`^${group}(?: \\(required\\))?$`)})
			.locator(`.bqa__transformation-option input[value="${value}"]`);
	}

	async textContrast (foregroundSelector: string, backgroundSelector: string) {
		return this.root.locator(foregroundSelector).first().evaluate((node, selector) => {
			const foreground = getComputedStyle(node).color;
			const surface = node.closest(selector);
			if (!surface) throw new Error(`No background surface for ${selector}`);
			const background = getComputedStyle(surface).backgroundColor;
			const luminance = (color: string) => {
				const channels = color.match(/\d+/g)!.slice(0, 3).map(value => {
					const channel = Number(value) / 255;
					return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
				});
				return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
			};
			const a = luminance(foreground);
			const b = luminance(background);
			return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
		}, backgroundSelector);
	}

	async templateContrast (id: string) {
		return this.templateChoice(id).evaluate(node => {
			const background = getComputedStyle(node).backgroundColor;
			const luminance = (value: string) => {
				const channels = value.match(/\d+/g)!.slice(0, 3).map(channel => {
					const normalized = Number(channel) / 255;
					return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
				});
				return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
			};
			const base = luminance(background);
			return ["name", "meta"].map(part => {
				const foreground = luminance(getComputedStyle(node.querySelector(`.bqa__transformation-choice-${part}`)!).color);
				return (Math.max(base, foreground) + 0.05) / (Math.min(base, foreground) + 0.05);
			});
		});
	}

	async expectLongTemplateTitleFits (id: string) {
		const choice = this.templateChoice(id);
		const fits = await choice.evaluate(node => {
			const name = node.querySelector(".bqa__transformation-choice-name");
			if (!name) return false;
			name.textContent = "The Ancient Shadow Dragon of the SupercalifragilisticexpialidociousMountainPass";
			return node.scrollWidth <= node.clientWidth + 1 && name.scrollWidth <= name.clientWidth + 1;
		});
		expect(fits).toBe(true);
	}

	async choose (id: string) {
		await this.chooseCategory(id.startsWith("race:") ? "Species" : "Templates");
		await this.root.getByRole("combobox", {name: "Creature transformation"}).selectOption(id);
	}

	async chooseCategory (category: "Species" | "Templates") {
		await this.categoryButton(category).press("Enter");
	}

	async selectSource (source: string) {
		await this.root.getByRole("combobox", {name: "Source book"}).selectOption(source);
	}

	async search (term: string) {
		await this.root.getByRole("searchbox", {name: "Find a template or species"}).fill(term);
	}

	async installHomebrew (brew: object) {
		await this.page.route("**/__transformation-test-brew.json", route => route.fulfill({
			contentType: "application/json",
			body: JSON.stringify(brew),
		}));
		await this.page.evaluate(async () => {
			const {BrewUtil2} = globalThis as typeof globalThis & {BrewUtil2: {pAddBrewFromUrl: (url: string) => Promise<unknown>}};
			await BrewUtil2.pAddBrewFromUrl("/__transformation-test-brew.json");
		});
	}

	async useNightMode () {
		await this.page.evaluate(() => {
			document.documentElement.classList.add("ve-night-mode", "ve-night-mode--standard");
		});
	}

	async injectRepeatedRaceDefinitions () {
		await this.page.evaluate(() => {
			const raceUtil = (globalThis as typeof globalThis & {DataUtil: {race: {loadBrew: (...args: unknown[]) => Promise<{race?: object[]}>}}}).DataUtil.race;
			const loadBrew = raceUtil.loadBrew.bind(raceUtil);
			raceUtil.loadBrew = async (...args) => {
				const loaded = await loadBrew(...args);
				const gnoll = {name: "Gnoll", source: "FoEQuickstone", page: 23, resist: ["fire"]};
				return {...loaded, race: [...(loaded.race || []), gnoll, {...gnoll}, {...gnoll, resist: ["cold"]}]};
			};
		});
	}

	async pauseCatalogReload () {
		await this.page.evaluate(() => {
			const raceUtil = (globalThis as typeof globalThis & {DataUtil: {race: {loadBrew: (...args: unknown[]) => Promise<unknown>}}}).DataUtil.race;
			const loadBrew = raceUtil.loadBrew.bind(raceUtil);
			let release: () => void = () => {};
			const gate = new Promise<void>(resolve => { release = resolve; });
			raceUtil.loadBrew = async (...args) => {
				await gate;
				return loadBrew(...args);
			};
			(globalThis as typeof globalThis & {releaseTransformationCatalogReload?: () => void}).releaseTransformationCatalogReload = () => {
				raceUtil.loadBrew = loadBrew;
				release();
			};
		});
	}

	async resumeCatalogReload () {
		await this.page.evaluate(() => {
			const globals = globalThis as typeof globalThis & {releaseTransformationCatalogReload?: () => void};
			globals.releaseTransformationCatalogReload?.();
			delete globals.releaseTransformationCatalogReload;
		});
	}

	categoryButton (category: "Species" | "Templates") {
		return this.root.getByRole("group", {name: "Browse recipes"}).getByRole("button", {name: new RegExp(`^${category} \\(`)});
	}

	async categoryColors (category: "Species" | "Templates") {
		return this.categoryButton(category).evaluate(node => {
			const style = getComputedStyle(node);
			return {background: style.backgroundColor, foreground: style.color};
		});
	}

	async expectReadableDiscoveryLabels () {
		for (const selector of [
			".bqa__transformation-category legend",
			".bqa__transformation-input .bqa__field-label",
			".bqa__transformation-count",
		]) await expect(this.root.locator(selector).first()).toHaveCSS("font-size", "12px");
	}

	async chooseOption (group: string, value: string) {
		await this.optionControl(group, value).check();
	}

	async expectLivePreview ({targets = 1}: {targets?: number} = {}) {
		await expect(this.root.locator(".bqa__transformation-target")).toHaveCount(targets);
		await expect(this.root.locator(".bqa__transformation-statblock")).toHaveCount(targets * 2);
		await expect(this.root.locator(".bqa__transformation-delta")).toBeVisible();
		await expect(this.root.getByRole("button", {name: /Preview (transformation|selected monsters)/})).toHaveCount(0);
	}

	async pickIncomingWinners () {
		const selectors = this.root.locator(".bqa__transformation-target select[data-conflict-id]");
		const count = await selectors.count();
		expect(count).toBeGreaterThan(0);
		for (let ix = 0; ix < count; ix++) await selectors.nth(ix).selectOption("incoming");
	}

	async apply ({bulk = false, count = 1}: {bulk?: boolean, count?: number} = {}) {
		const apply = this.root.getByRole("button", {name: bulk ? `Apply to ${count} · one save` : "Apply transformation"});
		const confirmation = this.root.getByRole("group", {name: "Confirm before applying"});
		if (await confirmation.isHidden()) await apply.click();
		if (await confirmation.isVisible()) {
			const checks = confirmation.getByRole("checkbox", {includeHidden: false});
			for (let ix = 0; ix < await checks.count(); ix++) await checks.nth(ix).check();
			await apply.click();
		}
		if (bulk) await expect(this.page.locator("#ew-status")).toContainText("Saved statblock edits");
	}

	async requestConfirmation () {
		await this.root.getByRole("button", {name: "Apply transformation"}).click();
		await expect(this.root.getByRole("group", {name: "Confirm before applying"})).toBeVisible();
	}

	async confirmPrerequisites () {
		const checks = this.root.getByRole("group", {name: "Confirm before applying"}).getByRole("checkbox", {includeHidden: false});
		for (let ix = 0; ix < await checks.count(); ix++) await checks.nth(ix).check();
	}

	async savedEncounter () {
		return this.page.evaluate(async () => {
			const {StorageUtil} = globalThis as typeof globalThis & {
				StorageUtil: {pGetForPage: (key: string, options: {page: string}) => Promise<unknown>},
			};
			return StorageUtil.pGetForPage("encounterWorkspaceState", {page: "encounterworkspace.html"});
		});
	}

	async failEncounterWrites () {
		await this.page.evaluate(() => {
			const {StorageUtil} = globalThis as typeof globalThis & {
				StorageUtil: {pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>},
			};
			const save = StorageUtil.pSetForPage.bind(StorageUtil);
			StorageUtil.pSetForPage = async (key, value, options) => {
				if (key === "encounterWorkspaceState") throw new Error("Simulated storage failure");
				return save(key, value, options);
			};
		});
	}

	async monitorOperationCreation () {
		await this.page.evaluate(async () => {
			const moduleUrl = "/js/bestiary/bestiary-quick-actions-engine.js";
			const {BestiaryQuickActionsUtil} = await import(moduleUrl);
			const original = BestiaryQuickActionsUtil.createCreatureTransformationOperation;
			const globals = globalThis as typeof globalThis & {transformationOperationsCreated?: number};
			globals.transformationOperationsCreated = 0;
			BestiaryQuickActionsUtil.createCreatureTransformationOperation = function (...args) {
				globals.transformationOperationsCreated!++;
				return original.apply(this, args);
			};
		});
	}

	async createdOperations () {
		return this.page.evaluate(() => (globalThis as typeof globalThis & {transformationOperationsCreated?: number}).transformationOperationsCreated);
	}
}
