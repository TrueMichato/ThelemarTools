import {expect, Page} from "@playwright/test";
import {LevelUpPage} from "./LevelUpPage";
import {QuickBuildPage} from "./QuickBuildPage";
import {fillSpellPickers} from "./spellPickerFill";
import fs from "node:fs";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
interface FeatEvidence {
	id: string;
	name: string;
	source: string;
	sourceDecisionKey: string;
	choices: {ability: string | Partial<Record<Ability, number>>; abilityOption?: number};
	appliedEffects: {abilityDeltas: Partial<Record<Ability, number>>};
}
interface LevelEvidence {
	level: number;
	decisions?: Array<{
		type: string;
		semanticKey: string;
		className: string;
		classSource: string;
		classLevel: number;
		receipt?: {
			version: number;
			sourceDecisionKey: string;
			effects: Array<{type: string; ability?: Ability; amount?: number; before?: number; after?: number; sourceDecisionKey?: string}>;
		};
	}>;
}
interface AsiRuntime {
	charSheet: {
		spawn(spec: object): Promise<{isClean: boolean; unresolved: string[]}>;
		_quickBuild?: object;
		getClasses(): Array<{name: string; source: string}>;
		saveCharacter(): Promise<void>;
		_state: {
			setSetting(name: string, value: boolean): void;
			setPrioritySources(sources: string[]): void;
			getAbilityBase(ability: Ability): number;
			getTotalLevel(): number;
			getId(): string;
			getClasses(): Array<{name: string; source: string}>;
			getFeats(): FeatEvidence[];
			getLevelHistory(): LevelEvidence[];
			toJson(): {feats: FeatEvidence[]};
			loadFromJson(value: object): void;
		};
	};
	BrewUtil2: {pAddBrewFromUrl(url: string): Promise<unknown>};
}

/** Focused companion to the comprehensive build suite: no acquisition is auto-filled. */
export class AsiAcquisitionPage {
	readonly levelUp: LevelUpPage;

	constructor (readonly page: Page) {
		this.levelUp = new LevelUpPage(page);
	}

	async load (installedBrew = false): Promise<void> {
		const index = JSON.parse(fs.readFileSync("homebrew/index.json", "utf8")) as {toImport: string[]};
		const dependencies = index.toImport.filter(url => /Arcadia.*(?:201|202|205|208|209|2020)\.json|Illrigger|Tal'Dorei/.test(url));
		await this.page.route("**/homebrew/index.json", route => route.fulfill({
			contentType: "application/json",
			body: JSON.stringify({toImport: installedBrew ? dependencies : [...dependencies, "TravelersGuidetoThelemar.json"]}),
		}));
		await this.page.goto("/charactersheet.html");
		await this.page.waitForFunction(() => !!(window as typeof window & AsiRuntime).charSheet?._quickBuild);
		if (installedBrew) {
			await this.page.evaluate(() => (window as typeof window & AsiRuntime).BrewUtil2.pAddBrewFromUrl("/homebrew/TravelersGuidetoThelemar.json"));
			await this.page.reload();
			await this.page.waitForFunction(() => !!(window as typeof window & AsiRuntime).charSheet?._quickBuild);
		}
		await expect.poll(() => this.page.evaluate(() =>
			(window as typeof window & AsiRuntime).charSheet.getClasses().some(cls => cls.name === "Sorcerer" && cls.source === "TGTT"),
		)).toBe(true);
	}

	async spawn (name: string, source: string, level: number, both = false): Promise<void> {
		await this.page.evaluate(async ({name, source, level, both}) => {
			const cs = (window as typeof window & AsiRuntime).charSheet;
			cs._state.setSetting("thelemar_asiFeat", both);
			cs._state.setSetting("enableTgtt", source === "TGTT");
			cs._state.setPrioritySources([source, "XPHB", "PHB"]);
			const subclass = name === "Monk" ? source === "PHB" ? "Way of the Open Hand" : "Warrior of the Open Hand"
				: name === "Sorcerer" ? source === "PHB" ? "Wild Magic" : "Wild Magic Sorcery"
					: "Champion";
			const report = await cs.spawn({
				classes: [{name, source, level: 1, subclass, subclassSource: source}],
				race: "Dwarf",
				background: "Outlander",
				seed: "asi-acquisition-regression",
				name: `ASI ${name} ${source}`,
			});
			if (!report.isClean || cs._state.getTotalLevel() !== 1) {
				throw new Error(`ASI starting character failed: ${JSON.stringify(report.unresolved)}, actual level ${cs._state.getTotalLevel()}`);
			}
			const actualClass = cs._state.getClasses()[0];
			if (actualClass?.name !== name || actualClass?.source !== source) {
				throw new Error(`ASI starting class mismatch: expected ${name}|${source}, got ${JSON.stringify(actualClass)}`);
			}
			cs._state.setSetting("thelemar_asiFeat", both);
			cs._state.setSetting("enableTgtt", source === "TGTT");
			cs._state.setPrioritySources([source, "XPHB", "PHB"]);
			await cs.saveCharacter();
		}, {name, source, level, both});
		for (let current = 1; current < level; current++) {
			await this.openLevelUp();
			await this.levelUp.autoFillAllSelections();
			await this.levelUp.finish();
			await this.levelUp.expectModalClosed();
		}
		expect(await this.page.evaluate(() => (window as typeof window & AsiRuntime).charSheet._state.getTotalLevel())).toBe(level);
	}

	async openLevelUp (): Promise<void> {
		await this.page.locator("#charsheet-btn-levelup").click();
		await this.levelUp.waitForModal();
	}

	async expectOrdinaryLevelUpControls (both = false): Promise<void> {
		await expect(this.levelUp.accordionAsi).toBeVisible();
		await this.levelUp.expandAccordion("asi");
		await expect(this.levelUp.accordionAsi.locator(".asi-plus")).toHaveCount(6);
		await expect(this.levelUp.accordionAsi.locator('input[name="asi-type"]')).toHaveCount(both ? 0 : 2);
		if (both) await expect(this.levelUp.accordionAsi.getByPlaceholder("Search feats...")).toBeVisible();
	}

	async takeLevelUpAsiFeat (abilities: Ability[]): Promise<void> {
		await this.fillRequiredClassOptions();
		const featureChoices = this.page.locator('[data-accordion-id="featoptions"]');
		if (await featureChoices.count()) {
			await this.levelUp.expandAccordion("featoptions");
			const groups = featureChoices.locator(".charsheet__levelup-feat-opt-group");
			for (let index = 0; index < await groups.count(); index++) {
				const group = groups.nth(index);
				const progress = (await group.innerText()).match(/Selected:\s*(\d+)\s*\/\s*(\d+)/);
				if (!progress) throw new Error("Feature-choice group has no selection progress");
				for (let chosen = Number(progress[1]); chosen < Number(progress[2]); chosen++) {
					await group.locator("input[type=checkbox]:not(:disabled):not(:checked)").first().check();
				}
			}
		}
		if (await this.levelUp.accordionKnownSpells.count()) {
			await this.levelUp.expandAccordion("knownspells");
			await fillSpellPickers(this.page, ".charsheet__levelup-wizard", {context: "ASI acquisition preconditions"});
		}
		await this.levelUp.selectAsiFeat();
		await this.levelUp.setFeatAbilityMode(abilities.length === 1 ? 0 : 1);
		for (const ability of abilities) await this.levelUp.pickFeatAbility(ability);
		await this.levelUp.expectFeatAbilitySelection(abilities);
		await this.levelUp.finish();
		await this.levelUp.expectModalClosed();
	}

	async fillRequiredClassOptions (): Promise<void> {
		const accordion = this.levelUp.accordionOptFeatures;
		if (!await accordion.count()) return;
		await this.levelUp.expandAccordion("optfeatures");
		const groups = accordion.locator(".charsheet__levelup-opt-gain");
		for (let groupIndex = 0; groupIndex < await groups.count(); groupIndex++) {
			const group = groups.nth(groupIndex);
			const progress = (await group.innerText()).match(/Selected:\s*(\d+)\s*\/\s*(\d+)/);
			if (!progress) throw new Error("Class-option group has no selection progress");
			for (let chosen = Number(progress[1]); chosen < Number(progress[2]); chosen++) {
				await group.locator("input[type=checkbox]:not(:disabled):not(:checked)").first().check();
			}
		}
	}

	async allocateOrdinaryLevelUpAsi (ability: Ability): Promise<void> {
		await this.levelUp.expandAccordion("asi");
		await this.levelUp.accordionAsi.locator(`.asi-plus[data-ability="${ability}"]`).click();
		await this.levelUp.accordionAsi.locator(`.asi-plus[data-ability="${ability}"]`).click();
	}

	async advanceWithoutImprovement (): Promise<void> {
		await this.openLevelUp();
		await expect(this.levelUp.accordionAsi).toHaveCount(0);
		await this.levelUp.autoFillAllSelections();
		await this.levelUp.finish();
		await this.levelUp.expectModalClosed();
	}

	async makeSavedFeatMetadataShallow (): Promise<void> {
		await this.page.evaluate(() => {
			const state = (window as typeof window & AsiRuntime).charSheet._state;
			const document = state.toJson();
			document.feats = document.feats.map(feat => ({
				id: feat.id, name: feat.name, source: feat.source, sourceDecisionKey: feat.sourceDecisionKey,
				choices: feat.choices, appliedEffects: feat.appliedEffects,
			}));
			state.loadFromJson(document);
		});
		await this.reload();
	}

	async openQuickBuild (target: number): Promise<void> {
		await this.page.locator("#charsheet-btn-quickbuild").click();
		const quickBuild = new QuickBuildPage(this.page);
		await expect(quickBuild.overlay).toBeVisible();
		await quickBuild.setTargetLevel(target);
		await quickBuild.next();
	}

	async expectQuickBuildImprovement (name: string, level: number): Promise<void> {
		await expect(this.page.locator(".charsheet__quickbuild-step-header")).toContainText("Ability Score Improvements & Feats");
		const section = this.page.locator(".charsheet__quickbuild-section").filter({
			has: this.page.locator("h5", {hasText: `${name} Level ${level} —`}),
		});
		await expect(section).toBeVisible();
		await expect(section.locator(".qb-asi-plus")).toHaveCount(6);
	}

	async takeQuickBuildAsiFeat (name: string, level: number, abilities: Ability[]): Promise<void> {
		const section = this.page.locator(".charsheet__quickbuild-section").filter({
			has: this.page.locator("h5", {hasText: `${name} Level ${level} —`}),
		});
		await expect(section).toBeVisible();
		const featMode = section.locator('input[value="feat"]');
		if (await featMode.count()) await featMode.check();
		await section.getByPlaceholder("Search feats...").fill("Ability Score Improvement");
		const row = section.locator(".charsheet__quickbuild-option").filter({hasText: "Ability Score Improvement"});
		await expect(row).toHaveCount(1);
		await row.click();
		await section.locator("[data-feat-ability-mode]").selectOption(`${abilities.length === 1 ? 0 : 1}`);
		for (const ability of abilities) await section.locator(`[data-feat-ability="${ability}"]`).click();
		await expect(section.locator('[data-feat-ability][aria-pressed="true"]')).toHaveCount(abilities.length);
	}

	async finishQuickBuild (): Promise<void> {
		await this.page.locator("#quickbuild-next").click();
		if (await this.page.locator(".charsheet__quickbuild-step-header").filter({hasText: "Class Options"}).count()) {
			const groups = this.page.locator(".charsheet__quickbuild-section").filter({has: this.page.locator("h5 .badge")});
			for (let index = 0; index < await groups.count(); index++) {
				const group = groups.nth(index);
				const traditions = group.locator(".qb-trad-count");
				if (await traditions.count()) {
					const progress = (await traditions.locator("..").innerText()).match(/Selected:\s*(\d+)\s*\/\s*(\d+)/);
					if (!progress) throw new Error("Combat-tradition group has no selection progress");
					for (let chosen = Number(progress[1]); chosen < Number(progress[2]); chosen++) {
						await group.locator(".charsheet__tradition-row input:not(:checked)").first().check();
					}
				}
				const [chosen, target] = (await group.locator("h5 .badge").textContent() || "").split("/").map(Number);
				for (let pick = chosen; pick < target; pick++) {
					await group.locator(".charsheet__quickbuild-option input[type=checkbox]:not(:disabled):not(:checked)").first().check();
				}
			}
			await this.page.locator("#quickbuild-next").click();
		}
		if (await this.page.locator(".charsheet__quickbuild-step-header").filter({hasText: "Feature Choices"}).count()) {
			const groups = this.page.locator(".charsheet__quickbuild-section").filter({has: this.page.locator('input[name^="qb-featopt-"]')});
			for (let index = 0; index < await groups.count(); index++) {
				const group = groups.nth(index);
				const [chosen, target] = (await group.locator(".badge-primary").textContent() || "").split("/").map(Number);
				for (let pick = chosen; pick < target; pick++) {
					await group.locator(".charsheet__quickbuild-option")
						.filter({has: this.page.locator("input:not(:disabled):not(:checked)")}).first().click();
					await expect(group.locator(".badge-primary")).toHaveText(`${pick + 1}/${target}`);
				}
			}
			await this.page.locator("#quickbuild-next").click();
		}
		if (await this.page.locator(".charsheet__quickbuild-step-header").filter({hasText: "Weapon Mastery"}).count()) {
			await this.page.locator(".charsheet__quickbuild-option:not(.selected)").first().click();
			await this.page.locator("#quickbuild-next").click();
		}
		if (await this.page.locator(".charsheet__quickbuild-step-header").filter({hasText: /Spell/}).count()) {
			const levels = this.page.locator("#quickbuild-known-spell-level");
			if (await levels.count()) {
				const values = await levels.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
				for (const value of values) {
					await levels.selectOption(value);
					await fillSpellPickers(this.page, ".charsheet__quickbuild-overlay", {context: `ASI preconditions at character level ${value}`});
				}
			}
			await this.page.locator("#quickbuild-next").click();
		}
		await expect(this.page.locator(".charsheet__quickbuild-step-header")).toContainText("Hit Points");
		await this.page.locator("#quickbuild-next").click();
		await expect(this.page.locator("#quickbuild-next")).toContainText("Build");
		await this.page.locator("#quickbuild-next").click();
		await expect(this.page.locator(".charsheet__quickbuild-overlay")).not.toBeVisible();
	}

	async addManualAsi (abilities: Ability[]): Promise<void> {
		await this.page.locator('a[href="#charsheet-tab-features"]').click();
		await this.page.locator("#charsheet-add-feat").click();
		await this.page.getByPlaceholder("🔍 Search feats by name...").fill("Ability Score Improvement");
		const row = this.page.locator(".charsheet__modal-list-item").filter({hasText: "Ability Score Improvement"});
		await expect(row.locator(".feat-picker-add")).toBeVisible();
		await row.locator(".feat-picker-add").click();
		const modal = this.page.locator(".ve-ui-modal__inner:visible").last();
		await modal.locator("[data-feat-ability-mode]").selectOption(`${abilities.length === 1 ? 0 : 1}`);
		for (const ability of abilities) await modal.locator(`[data-feat-ability="${ability}"]`).click();
		await modal.getByRole("button", {name: "Confirm Choices", exact: true}).click();
		await expect(row.locator(".feat-picker-add")).toBeVisible();
		await expect(row).toContainText("Repeatable");
	}

	async evidence () {
		return this.page.evaluate(() => {
			const state = (window as typeof window & AsiRuntime).charSheet._state;
			const abilities: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
			return {
				bases: Object.fromEntries(abilities.map(ability => [ability, state.getAbilityBase(ability)])),
				feats: state.getFeats().filter(feat => feat.name === "Ability Score Improvement" && feat.source === "XPHB")
					.map(feat => ({id: feat.id, name: feat.name, source: feat.source, sourceDecisionKey: feat.sourceDecisionKey,
						choices: feat.choices, appliedEffects: feat.appliedEffects})),
				history: state.getLevelHistory(),
			};
		});
	}

	async reload (): Promise<void> {
		const level = await this.page.evaluate(() => (window as typeof window & AsiRuntime).charSheet._state.getTotalLevel());
		const id = await this.page.evaluate(() => (window as typeof window & AsiRuntime).charSheet._state.getId());
		await this.page.evaluate(() => (window as typeof window & AsiRuntime).charSheet.saveCharacter());
		await this.page.reload();
		await this.page.waitForFunction(() => !!(window as typeof window & AsiRuntime).charSheet?._quickBuild);
		await this.page.locator("#charsheet-sel-character").selectOption(id);
		await this.page.waitForFunction(level => (window as typeof window & AsiRuntime).charSheet?._state.getTotalLevel() === level, level);
	}
}
