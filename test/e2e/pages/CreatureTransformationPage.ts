import {expect, type Page} from "@playwright/test";

export class CreatureTransformationPage {
	constructor (readonly page: Page) {}

	get root () { return this.page.locator(".bqa__transformation:visible"); }

	templateChoice (id: string) {
		return this.root.locator(`.bqa__transformation-choice[data-recipe-id="${id}"]`);
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
			return ["name", "meta", "detail"].map(part => {
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
		await this.categoryButton(category).click();
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
		await this.root.getByRole("combobox", {name: group}).selectOption(value);
	}

	async acknowledge () {
		const group = this.root.getByRole("group", {name: "Confirm before preview"});
		const checks = group.getByRole("checkbox");
		for (let ix = 0; ix < await checks.count(); ix++) await checks.nth(ix).check();
	}

	async preview ({bulk = false}: {bulk?: boolean} = {}) {
		await this.root.getByRole("button", {name: bulk ? "Preview selected monsters" : "Preview transformation"}).click();
		await expect(this.root.locator(".bqa__transformation-target").first()).toBeVisible();
		await expect(this.root.locator(".bqa__transformation-statblock")).toHaveCount(bulk ? 4 : 2);
	}

	async acknowledgeReview () {
		await this.root.getByRole("checkbox", {name: /I understand these items still require manual DM review/}).check();
	}

	async pickIncomingWinners () {
		const selectors = this.root.locator(".bqa__transformation-target select[data-conflict-id]");
		const count = await selectors.count();
		expect(count).toBeGreaterThan(0);
		for (let ix = 0; ix < count; ix++) await selectors.nth(ix).selectOption("incoming");
	}

	async apply ({bulk = false, count = 1}: {bulk?: boolean, count?: number} = {}) {
		await this.acknowledgeReview();
		await this.root.getByRole("button", {name: bulk ? `Apply to ${count} · one save` : "Apply transformation"}).click();
		if (bulk) await expect(this.page.locator("#ew-status")).toContainText("Saved statblock edits");
	}
}
