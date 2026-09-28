import {expect, Page} from "@playwright/test";

export class QuickBuildPage {
	readonly page: Page;

	constructor (page: Page) {
		this.page = page;
	}

	get overlay () { return this.page.locator(".charsheet__quickbuild-overlay"); }
	get content () { return this.overlay.locator("#quickbuild-content"); }
	get nextButton () { return this.overlay.locator("#quickbuild-next"); }
	get levelSelector () { return this.content.locator("#quickbuild-known-spell-level"); }
	get spellSearch () { return this.content.locator(".charsheet__spell-picker-search"); }

	async open (): Promise<void> {
		await this.page.locator("#charsheet-btn-quickbuild").click();
		await expect(this.overlay).toBeVisible();
	}

	async setTargetLevel (level: number): Promise<void> {
		const slider = this.content.locator(".charsheet__quickbuild-section input[type=range]").first();
		await slider.evaluate((element: HTMLInputElement, target) => {
			element.value = String(target);
			element.dispatchEvent(new Event("input", {bubbles: true}));
		}, level);
		await expect(this.content.locator(".charsheet__quickbuild-level-display")).toHaveText(String(level));
		await expect(this.content.locator("#quickbuild-target-summary")).toContainText(`Character Level`);
		await expect(this.content.locator("#quickbuild-target-summary")).not.toContainText("Level allocation must equal target");
	}

	async getCurrentStep (): Promise<string> {
		return (await this.overlay.locator(".charsheet__builder-step.active .charsheet__builder-step-label").textContent())?.trim() || "";
	}

	async next (): Promise<void> {
		const current = await this.getCurrentStep();
		await this.nextButton.click();
		await expect.poll(() => this.getCurrentStep()).not.toBe(current);
	}

	async advanceToSpells (): Promise<void> {
		for (let i = 0; i < 10; i++) {
			const step = await this.getCurrentStep();
			if (step === "Spells") return;
			if (step === "Expertise") await this.selectRequiredExpertise();
			else if (!["Target Level", "Hit Points"].includes(step)) {
				throw new Error(`Quick Build reached an unhandled required step before Spells: ${step}`);
			}
			await this.next();
		}
		throw new Error("Quick Build did not reach Spells");
	}

	async selectRequiredExpertise (): Promise<void> {
		const sections = this.content.locator(".charsheet__quickbuild-section");
		for (let i = 0; i < await sections.count(); i++) {
			const section = sections.nth(i);
			const heading = section.locator("h5");
			if (!await heading.count()) continue;
			const title = (await heading.textContent()) || "";
			if (!title.includes("Expertise") || title.includes("Auto")) continue;
			const match = title.match(/(\d+)\/(\d+)/);
			if (!match) throw new Error(`Missing expertise progress in ${title}`);
			for (let remaining = Number(match[2]) - Number(match[1]); remaining > 0; remaining--) {
				const option = section.locator(".charsheet__quickbuild-option:not(.selected)").first();
				await expect(option).toBeVisible();
				await option.click();
			}
		}
	}

	async selectAcquisitionLevel (characterLevel: number): Promise<void> {
		await this.levelSelector.selectOption(String(characterLevel));
		await expect(this.levelSelector).toHaveValue(String(characterLevel));
	}

	async getSpellOptions (search: string): Promise<Array<{name: string; source: string; level: number}>> {
		await this.spellSearch.fill(search);
		const options = await this.content.locator(".charsheet__spell-picker-section").evaluateAll(sections =>
			sections.flatMap(section => {
				const levelText = section.querySelector(".charsheet__spell-picker-section-title")?.textContent || "";
				const level = levelText.includes("Cantrips") ? 0 : Number(levelText.match(/Level (\d+)/)?.[1]);
				return [...section.querySelectorAll(".charsheet__spell-picker-item")].map(item => ({
					name: item.querySelector(".charsheet__spell-picker-item-name")?.textContent?.trim() || "",
					source: item.querySelector(".charsheet__spell-picker-item-source")?.textContent?.trim() || "",
					level,
				}));
			}),
		);
		return options.filter(option => option.name.toLowerCase() === search.toLowerCase());
	}

	async selectSpell (name: string, source: string): Promise<void> {
		await this.spellSearch.fill(name);
		const item = this.content.locator(".charsheet__spell-picker-item")
			.filter({has: this.page.locator(".charsheet__spell-picker-item-name", {hasText: name})})
			.filter({has: this.page.locator(".charsheet__spell-picker-item-source", {hasText: source})});
		await expect(item).toHaveCount(1);
		await item.locator("button.spell-toggle").click();
		await expect(item).toHaveClass(/charsheet__spell-picker-item--selected/);
	}

	async selectFirstAvailableSpell (): Promise<{name: string; source: string}> {
		await this.spellSearch.fill("");
		const item = this.content.locator(".charsheet__spell-picker-section")
			.filter({has: this.page.locator(".charsheet__spell-picker-section-title", {hasText: /Level \d/})})
			.locator(".charsheet__spell-picker-item")
			.filter({has: this.page.locator("button.spell-toggle", {hasText: "+"})}).first();
		await expect(item).toBeVisible();
		const name = (await item.locator(".charsheet__spell-picker-item-name").textContent())?.trim() || "";
		const source = (await item.locator(".charsheet__spell-picker-item-source").textContent())?.trim() || "";
		await item.locator("button.spell-toggle").click();
		return {name, source};
	}

	async selectFirstAvailableCantrip (): Promise<{name: string; source: string}> {
		await this.spellSearch.fill("");
		const item = this.content.locator(".charsheet__spell-picker-section")
			.filter({has: this.page.locator(".charsheet__spell-picker-section-title", {hasText: "Cantrips"})})
			.locator(".charsheet__spell-picker-item")
			.filter({has: this.page.locator("button.spell-toggle", {hasText: "+"})}).first();
		await expect(item).toBeVisible();
		const name = (await item.locator(".charsheet__spell-picker-item-name").textContent())?.trim() || "";
		const source = (await item.locator(".charsheet__spell-picker-item-source").textContent())?.trim() || "";
		await item.locator("button.spell-toggle").click();
		return {name, source};
	}

	async getLevelProgress (characterLevel: number): Promise<string> {
		return (await this.content.locator(`.charsheet__qb-known-level-count[data-character-level="${characterLevel}"]`).textContent()) || "";
	}

	async getRecordedLevelSpells (characterLevel: number): Promise<{
		choices: Array<{name: string; source: string; level: number}>;
		live: Array<{name: string; source: string; sourceClass: string; sourceClassSource: string}>;
	}> {
		return this.page.evaluate(level => {
			const state: any = (globalThis as any).charSheet._state;
			const choices = state.getLevelHistoryEntry(level)?.choices?.knownSpells || [];
			const ids = new Set(choices.map((spell: any) => `${spell.name}|${spell.source}`));
			return {
				choices,
				live: state.getSpellsKnown()
					.filter((spell: any) => ids.has(`${spell.name}|${spell.source}`))
					.map((spell: any) => ({
						name: spell.name, source: spell.source,
						sourceClass: spell.sourceClass, sourceClassSource: spell.sourceClassSource,
					})),
			};
		}, characterLevel);
	}

	async finish (): Promise<void> {
		await this.next();
		expect(await this.getCurrentStep()).toBe("Hit Points");
		await this.next();
		expect(await this.getCurrentStep()).toBe("Review");
		await expect(this.nextButton).toContainText("Build Character");
		await this.nextButton.click();
		await expect(this.overlay).toBeHidden({timeout: 20000});
	}
}
