import {expect, Page} from "@playwright/test";

interface FeatEvidence {
	id: string;
	name: string;
	source: string;
	sourceDecisionKey?: string;
	choices: {ability?: string | Record<string, number>; abilityOption?: number};
	appliedEffects?: {abilityDeltas: Record<string, number>};
}

interface ProbeSheet {
	_state: {
		getAbilityBase(ability: string): number;
		getAbilityScore(ability: string): number;
		getFeats(): FeatEvidence[];
		getClasses(): Array<{name: string; source: string; level: number}>;
		getLevelHistory(): Array<{level: number; choices: unknown}>;
	};
}

interface CharacterEvidence {
	scores: Record<string, number>;
	effectiveScores: Record<string, number>;
	feats: FeatEvidence[];
	classes: Array<{name: string; source: string; level: number}>;
	history: Array<{level: number; choices: unknown}>;
}

export class FeatAbilityChoicesPage {
	constructor (readonly page: Page) {}

	async evidence (): Promise<CharacterEvidence> {
		return this.page.evaluate(() => {
			const state = (globalThis as typeof globalThis & {charSheet: ProbeSheet}).charSheet._state;
			return {
				scores: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(ability => [ability, state.getAbilityBase(ability)])),
				effectiveScores: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map(ability => [ability, state.getAbilityScore(ability)])),
				feats: state.getFeats().filter(feat => feat.name === "Ability Score Improvement" && feat.source === "XPHB"),
				classes: state.getClasses().map(cls => ({name: cls.name, source: cls.source, level: cls.level})),
				history: state.getLevelHistory().map(entry => ({level: entry.level, choices: entry.choices})),
			};
		});
	}

	async historicalScores (characterLevel: number): Promise<Record<string, number>> {
		return this.page.evaluate(level => {
			const globals = globalThis as typeof globalThis & {
				charSheet: ProbeSheet;
				CharacterSheetClassUtils: {
					getHistoricalAbilityScores(args: {state: ProbeSheet["_state"]; history: CharacterEvidence["history"]; characterLevel: number}): Record<string, number>;
				};
			};
			const state = globals.charSheet._state;
			return globals.CharacterSheetClassUtils.getHistoricalAbilityScores({state, history: state.getLevelHistory(), characterLevel: level});
		}, characterLevel);
	}

	async freeAddSplitFeat (abilities: [string, string]): Promise<void> {
		await this.page.locator("#charsheet-add-feat").click();
		await this.page.getByPlaceholder("🔍 Search feats by name...").fill("Ability Score Improvement");
		const row = this.page.locator(".charsheet__modal-list-item")
			.filter({hasText: "Ability Score Improvement"}).filter({hasText: "PHB'24"});
		await expect(row).toHaveCount(1);
		await row.locator(".feat-picker-add").click();
		const modal = this.page.locator(".ve-ui-modal__inner").filter({has: this.page.locator("[data-feat-ability-mode]")});
		await modal.locator("[data-feat-ability-mode]").selectOption("1");
		await modal.locator(`[data-feat-ability="${abilities[0]}"]`).click();
		await expect(modal.getByRole("button", {name: "Confirm Choices", exact: true})).toBeDisabled();
		await modal.locator(`[data-feat-ability="${abilities[1]}"]`).click();
		await modal.getByRole("button", {name: "Confirm Choices", exact: true}).click();
		await expect(modal).toHaveCount(0);
	}
}
