import {expect, Page} from "@playwright/test";
import {readFileSync} from "node:fs";

interface InitiativeFeature {
	id: string;
	name: string;
	source: string;
	className: string;
	classSource: string;
	subclassShortName: string;
	subclassSource: string;
	level: number;
}
interface InitiativeComponent {name: string; value: number; isCanonical?: boolean}
interface InitiativeSheet {
	_state: {
		getFeatures(): InitiativeFeature[];
		getNamedModifiers(): Array<{name: string; type: string; sourceFeatureId?: string}>;
		getInitiative(): number;
		getInitiativeBreakdown(): {total: number; canonical: number; components: InitiativeComponent[]};
		getAbilityMod(ability: string): number;
		toJson(): object;
	};
	saveCharacter(): Promise<void>;
	_rollD20(options: object): {roll: number; mode: string};
}

export class InitiativeFeatureOwnershipPage {
	constructor (readonly page: Page) {}

	async openLocalCatalog (): Promise<void> {
		await this.page.route("**/homebrew/index.json", route => route.fulfill({
			contentType: "application/json", body: JSON.stringify({toImport: []}),
		}));
		await this.page.goto("/charactersheet.html", {waitUntil: "domcontentloaded"});
		await this.page.waitForFunction(() => Boolean((globalThis as typeof globalThis & {charSheet: InitiativeSheet}).charSheet));
		const served = await this.page.request.get("/js/charactersheet/charactersheet-state.js");
		expect(served.ok()).toBe(true);
		expect(await served.text()).toBe(readFileSync("js/charactersheet/charactersheet-state.js", "utf8"));
	}

	async assertTemporalAwareness (intModifier: number): Promise<string> {
		const evidence = await this.page.evaluate(() => {
			const state = (globalThis as typeof globalThis & {charSheet: InitiativeSheet}).charSheet._state;
			return {
				feature: state.getFeatures().find(feature => feature.name === "Temporal Awareness"),
				modifiers: state.getNamedModifiers().filter(mod => mod.type === "initiative"),
				initiative: state.getInitiative(),
				dex: state.getAbilityMod("dex"),
				int: state.getAbilityMod("int"),
				breakdown: state.getInitiativeBreakdown(),
			};
		});
		expect(evidence.feature).toMatchObject({
			source: "EGW", className: "Wizard", classSource: "PHB",
			subclassShortName: "Chronurgy", subclassSource: "EGW", level: 2,
		});
		expect(evidence.int).toBe(intModifier);
		expect(evidence.modifiers).toEqual([]);
		expect(evidence.initiative).toBe(evidence.dex + intModifier);
		expect(evidence.breakdown.total).toBe(evidence.initiative);
		expect(evidence.breakdown.canonical).toBe(evidence.initiative);
		expect(evidence.breakdown.components.filter(row => row.name === "Temporal Awareness"))
			.toEqual([expect.objectContaining({value: intModifier, isCanonical: true})]);
		await expect(this.page.locator("#charsheet-disp-initiative")).toHaveText(
			`${evidence.initiative >= 0 ? "+" : ""}${evidence.initiative}`,
		);
		const tooltip = await this.page.locator("#charsheet-box-initiative").getAttribute("title");
		expect(tooltip?.match(/Temporal Awareness/g)).toHaveLength(1);
		if (!evidence.feature) throw new Error("Temporal Awareness was not acquired");
		return evidence.feature.id;
	}

	async editIntelligence (baseScore: number): Promise<void> {
		await this.page.locator("#charsheet-edit-abilities").click();
		const input = this.page.getByRole("spinbutton", {name: "Intelligence stored score", exact: true});
		await expect(input).toBeVisible();
		await input.fill(String(baseScore));
		await input.press("Tab");
		await this.page.getByRole("button", {name: "Done", exact: true}).click();
		await expect(input).toHaveCount(0);
	}

	async save (): Promise<void> {
		await this.page.evaluate(async () => {
			await (globalThis as typeof globalThis & {charSheet: InitiativeSheet}).charSheet.saveCharacter();
		});
	}

	async rollAndAssert (): Promise<void> {
		const original = await this.page.evaluate(() => {
			const cs = (globalThis as typeof globalThis & {charSheet: InitiativeSheet}).charSheet;
			const probe = cs as InitiativeSheet & {initiativeOriginalD20?: InitiativeSheet["_rollD20"]};
			probe.initiativeOriginalD20 = cs._rollD20;
			cs._rollD20 = () => ({roll: 10, mode: "normal"});
			return cs._state.getInitiativeBreakdown().total;
		});
		try {
			await this.page.locator("#charsheet-box-initiative").click();
			const result = this.page.locator(".charsheet__dice-result").filter({hasText: "Initiative"}).last();
			await expect(result).toBeVisible();
			await expect(result.locator(".charsheet__dice-result-total")).toHaveText(String(10 + original));
		} finally {
			await this.page.evaluate(() => {
				const cs = (globalThis as typeof globalThis & {charSheet: InitiativeSheet & {initiativeOriginalD20?: InitiativeSheet["_rollD20"]}}).charSheet;
				if (!cs.initiativeOriginalD20) throw new Error("Original d20 sampler unavailable");
				cs._rollD20 = cs.initiativeOriginalD20;
				delete cs.initiativeOriginalD20;
			});
		}
	}
}
