import {expect, Locator, Page} from "@playwright/test";
import {readFileSync} from "node:fs";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
type Surface = "compact" | "hero" | "play";
interface Component {source: string; label: string; amount: number | null; isReplacement?: boolean}
interface Breakdown {ability: string; total: number; components: Component[]}
interface ProbeSheet {
	_state: {
		getAbilityScoreBreakdown(ability: string): Breakdown;
		getAbilityBase(ability: string): number;
		getInitiative(): number;
		getProficiencyBonus(): number;
		getInitiativeBreakdown(): {total: number; components: {name: string; value: number; source?: string}[]};
		toJson(): object;
	};
	_rollAbilityCheck(ability: string, event: Event): unknown;
	abilityDisclosureRollCount?: number;
	abilityDisclosureOriginalRoll?: ProbeSheet["_rollAbilityCheck"];
	renderCharacter(): void;
}

const names: Record<Ability, string> = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"};

export class AbilityScoreBreakdownPage {
	constructor (readonly page: Page) {}

	score (surface: Surface, ability: Ability): Locator {
		if (surface === "compact") return this.page.locator(`#charsheet-ability-${ability}-score`);
		if (surface === "hero") return this.page.locator(`.charsheet__ability-hero-card[data-ability="${ability}"] .charsheet__ability-hero-total`);
		return this.page.locator(`.pm-ability__score[aria-label^="${names[ability]} score"]`);
	}

	block (surface: Surface, ability: Ability): Locator {
		if (surface === "compact") return this.page.locator(`.charsheet__ability[data-ability="${ability}"]`);
		if (surface === "hero") return this.page.locator(`.charsheet__ability-hero-card[data-ability="${ability}"] .charsheet__ability-score-summary`);
		return this.score(surface, ability).locator("..");
	}

	async verifyServedWorktree (): Promise<void> {
		const response = await this.page.request.get("/js/charactersheet/charactersheet.js");
		expect(response.ok()).toBe(true);
		expect(await response.text()).toBe(readFileSync("js/charactersheet/charactersheet.js", "utf8"));
	}

	async evidence (ability: Ability): Promise<{breakdown: Breakdown; rawBase: number; json: object}> {
		return this.page.evaluate(ability => {
			const state = (globalThis as typeof globalThis & {charSheet: ProbeSheet}).charSheet._state;
			return {breakdown: state.getAbilityScoreBreakdown(ability), rawBase: state.getAbilityBase(ability), json: state.toJson()};
		}, ability);
	}

	async startRollSpy (): Promise<void> {
		await this.page.evaluate(() => {
			const cs = (globalThis as typeof globalThis & {charSheet: ProbeSheet}).charSheet;
			cs.abilityDisclosureRollCount = 0;
			if (cs.abilityDisclosureOriginalRoll) return;
			const original = cs._rollAbilityCheck;
			cs.abilityDisclosureOriginalRoll = original;
			cs._rollAbilityCheck = (ability, event) => {
				cs.abilityDisclosureRollCount = (cs.abilityDisclosureRollCount || 0) + 1;
				return original.call(cs, ability, event);
			};
		});
	}

	async rollCount (): Promise<number> {
		return this.page.evaluate(() => (globalThis as typeof globalThis & {charSheet: ProbeSheet}).charSheet.abilityDisclosureRollCount || 0);
	}

	async inspect (surface: Surface, ability: Ability, method: "hover" | "keyboard" | "touch"): Promise<string[]> {
		const score = this.score(surface, ability);
		await expect(score).toBeVisible();
		if (method === "hover") {
			const selector = surface === "compact" ? ".charsheet__ability-name"
				: surface === "hero" ? ".charsheet__ability-hero-full" : ".pm-ability__name";
			await this.block(surface, ability).locator(selector).hover();
		}
		if (method === "keyboard") {
			await score.focus();
			await score.press("Enter");
		}
		if (method === "touch") await score.tap();
		await expect(score).toHaveAttribute("aria-expanded", "true");
		const id = await score.getAttribute("aria-controls");
		if (!id) throw new Error("Score disclosure has no controlled region");
		const detail = this.page.locator(`#${id}`);
		await expect(detail).toBeVisible();
		await expect(this.page.locator(".charsheet__score-detail:popover-open")).toHaveCount(1);
		await expect(this.block(surface, ability).locator("[title], [data-tooltip]")).toHaveCount(0);
		await expect(detail).toHaveAttribute("aria-label", `${names[ability]} score breakdown`);
		const box = await detail.boundingBox();
		const viewport = this.page.viewportSize();
		if (!box || !viewport) throw new Error("Score disclosure geometry unavailable");
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
		expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
		const contrast = await detail.evaluate(el => {
			const style = getComputedStyle(el);
			const luminance = (color: string) => {
				const values = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
				if (!values || values.length !== 3) throw new Error(`Unsupported computed color: ${color}`);
				const linear = values.map(value => {
					const channel = value / 255;
					return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
				});
				return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
			};
			const text = luminance(style.color), background = luminance(style.backgroundColor);
			return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
		});
		expect(contrast).toBeGreaterThanOrEqual(4.5);
		const rows = await detail.locator(".charsheet__score-detail-row").allTextContents();
		expect(rows.every(row => !/applied amount unknown|unplaced acquisition|; acquisition \d|recorded [A-Z]{3} \+/.test(row))).toBe(true);
		await expect(detail.locator(".charsheet__score-detail-total")).toHaveText(`Total: ${(await this.evidence(ability)).breakdown.total}`);
		return rows;
	}

	async close (surface: Surface, ability: Ability): Promise<void> {
		await this.score(surface, ability).press("Escape");
		await expect(this.score(surface, ability)).toHaveAttribute("aria-expanded", "false");
	}

	async rerender (): Promise<void> {
		await this.page.evaluate(() => (globalThis as typeof globalThis & {charSheet: ProbeSheet}).charSheet.renderCharacter());
	}

	async editBase (ability: Ability, value: number): Promise<void> {
		await this.page.locator("#charsheet-edit-abilities").click();
		const input = this.page.getByRole("spinbutton", {name: `${names[ability]} base score`, exact: true});
		await input.fill(String(value));
		await input.press("Tab");
		const row = this.page.locator(".charsheet__edit-ability-row").filter({has: input});
		await row.locator(".ability-mod").hover();
		const score = row.locator(".ability-total");
		await expect(score).toHaveAttribute("aria-expanded", "true");
		await expect(row.locator(".charsheet__edit-ability-result [title]")).toHaveCount(0);
		await expect(row.locator(".ability-breakdown")).toContainText("Base / earlier adjustments");
		await expect(row.locator(".ability-breakdown")).not.toContainText("applied amount unknown");
		await score.press("Escape");
		await this.page.getByRole("button", {name: "Done", exact: true}).click();
		await expect(input).toHaveCount(0);
	}

	async addFixedFeat (name: string, sourceLabel: string): Promise<void> {
		await this.page.locator("#charsheet-add-feat").click();
		await this.page.getByPlaceholder("🔍 Search feats by name...").fill(name);
		const row = this.page.locator(".charsheet__modal-list-item")
			.filter({has: this.page.locator(".charsheet__modal-list-item-title", {hasText: name})})
			.filter({has: this.page.locator(".charsheet__modal-list-item-subtitle", {hasText: new RegExp(`(?:^| • )${sourceLabel}$`)})});
		await expect(row).toHaveCount(1);
		await row.locator(".feat-picker-add").click();
		await expect(row.locator(".feat-picker-add")).toHaveCount(0);
		await this.page.keyboard.press("Escape");
		await expect(this.page.locator(".ve-ui-modal__inner:visible")).toHaveCount(0);
	}

	async clickCheck (): Promise<void> {
		await this.page.locator('.charsheet__ability-roll-check[data-ability="str"]').click();
	}

	async verifyPinControls (surface: Surface, ability: Ability): Promise<void> {
		const score = this.score(surface, ability);
		await this.inspect(surface, ability, "hover");
		await score.click();
		await this.page.mouse.move(1, 1);
		await expect(score).toHaveAttribute("aria-expanded", "true");
		await score.click();
		await expect(score).toHaveAttribute("aria-expanded", "false");
		await score.press("Space");
		await expect(score).toHaveAttribute("aria-expanded", "true");
		await score.press("Space");
		await expect(score).toHaveAttribute("aria-expanded", "false");
		await score.press("Enter");
		await expect(score).toHaveAttribute("aria-expanded", "true");
		await this.page.getByRole("button", {name: `Close ${names[ability]} score breakdown`, exact: true}).click();
		await expect(score).toHaveAttribute("aria-expanded", "false");
		await this.inspect(surface, ability, "hover");
		await this.page.mouse.click(1, 1);
		await expect(score).toHaveAttribute("aria-expanded", "false");
	}

	async verifyBlockAndModifierRolls (surface: "compact" | "play", ability: Ability): Promise<void> {
		const before = await this.rollCount();
		const block = this.block(surface, ability);
		const name = block.locator(surface === "compact" ? ".charsheet__ability-name" : ".pm-ability__name");
		await name.click();
		expect(await this.rollCount()).toBe(before + 1);
		const modifier = block.locator(surface === "compact" ? ".charsheet__ability-mod" : ".pm-ability__mod");
		await modifier.click();
		expect(await this.rollCount()).toBe(before + 2);
		await modifier.press("Enter");
		expect(await this.rollCount()).toBe(before + 3);
		await modifier.press("Space");
		expect(await this.rollCount()).toBe(before + 4);
	}

	async verifyAlertInitiative (source: string): Promise<void> {
		const evidence = await this.page.evaluate(() => {
			const state = (globalThis as typeof globalThis & {charSheet: ProbeSheet}).charSheet._state;
			return {pb: state.getProficiencyBonus(), initiative: state.getInitiative(), breakdown: state.getInitiativeBreakdown()};
		});
		const alert = evidence.breakdown.components.filter(row => row.name === "Alert");
		expect(alert).toHaveLength(1);
		expect(alert[0]).toMatchObject({source, value: source === "XPHB" ? evidence.pb : 5});
		expect(evidence.breakdown.components.some(row => row.name === "Custom Modifier")).toBe(false);
		expect(evidence.breakdown.total).toBe(evidence.initiative);
		await expect(this.page.locator("#charsheet-box-initiative")).toHaveAttribute("title", /Alert:/);
	}

	async snapshot (path: string): Promise<void> {
		await this.page.screenshot({path});
	}

	async setNightMode (): Promise<void> {
		await this.page.evaluate(() => document.documentElement.classList.add("ve-night-mode", "ve-night-mode--standard"));
	}
}
