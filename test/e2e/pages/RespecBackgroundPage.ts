import {expect, Page} from "@playwright/test";

interface OriginSnapshot {
	background: {name: string; source: string};
	abilities: Record<string, number>;
	abilityBonuses: Record<string, number>;
	skillProficiencies: Record<string, number>;
	languages: string[];
	toolProficiencies: string[];
	feats: Array<{name: string; source: string; sourceDecisionKey: string}>;
	pendingSpellChoices: unknown[];
	spellcasting: {cantripsKnown: OriginSpell[]};
	characterBase: {decisions: Array<{type: string; status: string; selection: unknown; semanticKey: string}>};
}

interface OriginSpell {
	name: string;
	source: string;
	spellcastingAbility: string;
	sourceFeature: string;
	uses?: {current: number; max: number};
	recharge?: string;
}

interface RespecRuntime {
	_state: {
		toJson(): OriginSnapshot;
		getInnateSpells(): OriginSpell[];
		getFeatures(): Array<{
			name: string; source: string; className?: string; classSource?: string;
			level?: number; featureType?: string; optionalFeatureTypes?: string[];
		}>;
		getLevelHistoryEntry(level: number): {
			class: {name: string; source: string};
			choices: {optionalFeatures?: Array<{name: string; source: string; type: string}>};
		} | null;
	};
	_respec: {_state: {toJson(): OriginSnapshot; getInnateSpells(): OriginSpell[]}; _engine: {getValidation(): {errors: unknown[]}}};
}

export class RespecBackgroundPage {
	private needsConfirmation = false;
	private readonly fixturePages: Page[] = [];
	private readonly onFixturePage = (page: Page) => { this.fixturePages.push(page); };

	constructor (readonly page: Page) {}

	get modal () { return this.page.locator(".ve-ui-modal__overlay:visible").last(); }

	observeFixturePages () {
		this.page.context().on("page", this.onFixturePage);
	}

	async expectSingleFighterStyleFixture () {
		this.page.context().off("page", this.onFixturePage);
		expect(this.fixturePages.map(page => page.url()), "The builder must not open optional-feature reference pages").toEqual([]);
		expect(this.page.context().pages(), "The fixture must retain only its character-sheet page").toHaveLength(1);
		expect(this.page.context().pages()[0]).toBe(this.page);
		const acquired = await this.page.evaluate(() => {
			const cs: RespecRuntime = Reflect.get(globalThis, "charSheet");
			const history = cs._state.getLevelHistoryEntry(1);
			if (!history) throw new Error("The Fighter fixture requires its actual level-1 acquisition history");
			return {
				owner: history.class,
				choices: (history.choices.optionalFeatures || [])
					.filter(feature => feature.type.split("_").includes("FS:F"))
					.map(({name, source, type}) => ({name, source, type})),
				features: cs._state.getFeatures()
					.filter(feature => feature.optionalFeatureTypes?.includes("FS:F"))
					.map(({name, source, className, classSource, level, featureType}) => ({name, source, className, classSource, level, featureType})),
			};
		});
		console.log("[respec-fighter-fixture]", JSON.stringify({pageCount: this.page.context().pages().length, ...acquired}));
		expect(acquired.owner).toEqual({name: "Fighter", source: "PHB"});
		expect(acquired.choices).toEqual([{name: "Archery", source: "PHB", type: "FS:F"}]);
		expect(acquired.features).toEqual([{
			name: "Archery", source: "PHB", className: "Fighter", classSource: "PHB", level: 1, featureType: "Optional Feature",
		}]);
	}

	async select (name: string, source: string) {
		await this.modal.locator(".charsheet__respec-search-row input").fill(name);
		const row = this.modal.locator(".charsheet__respec-feat-item")
			.filter({has: this.page.locator("strong").filter({hasText: new RegExp(`^${name}$`)})})
			.filter({has: this.page.locator("span.text-muted").filter({hasText: new RegExp(`^${source === "XPHB" ? "PHB'24" : source === "PHB" ? "PHB'14" : source}$`)})});
		await expect(row).toHaveCount(1);
		this.needsConfirmation = !await row.evaluate(element => element.classList.contains("charsheet__respec-feat-current"));
		await row.click();
		await expect(this.modal.locator(".charsheet__respec-choices-panel")).toContainText("Complete every new or changed background choice");
	}

	async choose (type: string, labels: string[], index = 0) {
		const row = this.modal.locator(`[data-background-decision="${type}"]`).nth(index);
		await row.getByRole("button", {name: /Choose|Change/}).click();
		const editor = this.modal.locator(".charsheet__respec-decision-editor").last();
		for (const label of labels) {
			const radio = editor.getByRole("radio", {name: label, exact: true});
			if (await radio.count()) await radio.check();
			else await editor.getByRole("checkbox", {name: label, exact: true}).check();
		}
		await editor.getByRole("button", {name: "Stage Choice", exact: true}).click();
		await expect(editor).toBeHidden();
	}

	async completeMissing () {
		for (let attempt = 0; attempt < 15; attempt++) {
			const row = this.modal.locator("[data-background-decision]").filter({hasText: "(missing)"}).first();
			if (!await row.count()) return;
			await row.getByRole("button", {name: "Choose", exact: true}).click();
			const editor = this.modal.locator(".charsheet__respec-decision-editor").last();
			const countText = await editor.locator(".charsheet__respec-selection-count").textContent();
			const count = Number(countText?.split("/")[1]?.split(" ")[0]);
			expect(count).toBeGreaterThan(0);
			for (let pick = 0; pick < count; pick++) await editor.locator("label input").nth(pick).check();
			await editor.getByRole("button", {name: "Stage Choice", exact: true}).click();
			await expect(editor).toBeHidden();
		}
		throw new Error("Background choices did not complete within the bounded picker pass.");
	}

	async commit () {
		const modal = this.modal;
		const button = modal.getByRole("button", {name: "Change Background", exact: true});
		await expect(button).toBeEnabled();
		await button.click();
		if (this.needsConfirmation) {
			const heading = this.page.getByRole("heading", {name: "Confirm Background Change", exact: true});
			await expect(heading).toBeVisible();
			const confirmation = this.page.locator(".ve-ui-modal__overlay:visible").filter({has: heading});
			await confirmation.getByRole("button", {name: /Change Background/}).click();
		}
		await expect.poll(async () => {
			const errors = await this.page.locator(".toast--type-danger .toast__wrp-content").allTextContents();
			if (errors.length) throw new Error(`Background replacement failed: ${errors.join(" ")}`);
			return this.page.locator(".charsheet__respec-search-row input").filter({visible: true}).count();
		}).toBe(0);
	}

	async cancel () {
		await this.modal.locator(".charsheet__respec-btn-row").last().getByRole("button", {name: "Cancel", exact: true}).click();
	}

	async evidence () {
		return this.page.evaluate(() => {
			const cs: RespecRuntime = Reflect.get(globalThis, "charSheet");
			return {live: cs._state.toJson(), draft: cs._respec._state.toJson(), liveInnateSpells: cs._state.getInnateSpells(), draftInnateSpells: cs._respec._state.getInnateSpells(), validation: cs._respec._engine.getValidation()};
		});
	}

	async undo () {
		await this.page.locator("#charsheet-respec-undo").click();
	}
}
