import {expect, type Locator, type Page} from "@playwright/test";
import {CharacterSheetPage} from "./CharacterSheetPage";

export type SpellFacet = "class" | "subclass" | "level" | "school" | "rarity" | "legality" | "tag" | "source";
export type SpellQuickFilter = "Ritual" | "Concentration" | "Verbal" | "Somatic" | "Material";

export interface PickerSpell {
	id: string;
	name: string;
	source: string;
	level: number;
	school: string;
	tags: string[];
	classes: string[];
	subclasses: string[];
	ritual: boolean;
	concentration: boolean;
	verbal: boolean;
	somatic: boolean;
	material: boolean;
}

export class SpellPickerFiltersPage {
	private readonly sheet: CharacterSheetPage;

	constructor (private readonly page: Page) {
		this.sheet = new CharacterSheetPage(page);
	}

	async open (): Promise<void> {
		await this.sheet.spawnCharacter("wizard/evocation/5/gnome");
		await this.sheet.openAddSpellModal();
	}

	private modal (): Locator {
		return this.page.locator(".ve-ui-modal__inner:visible").last();
	}

	private facet (kind: SpellFacet): Locator {
		const modal = this.modal();
		if (kind === "rarity" || kind === "legality") {
			return modal.locator(".charsheet__subschool-multiselect")
				.filter({has: this.page.locator(`input[value^="${kind}:"]`)});
		}
		if (kind === "tag") {
			return modal.locator(".charsheet__subschool-multiselect")
				.filter({hasNot: this.page.locator('input[value^="rarity:"], input[value^="legality:"]')});
		}
		if (kind === "source") return modal.locator(".charsheet__source-multiselect--right");
		return modal.locator(`.charsheet__${kind}-multiselect`);
	}

	async select (kind: SpellFacet, values: string[] | "all"): Promise<void> {
		if (["school", "rarity", "legality", "tag"].includes(kind)) await this.sheet.openAddSpellMoreFilters();
		const facet = this.facet(kind);
		const menu = facet.locator(".charsheet__source-multiselect-dropdown");
		if (!/\bopen\b/.test(await menu.getAttribute("class") || "")) {
			await facet.locator(".charsheet__source-multiselect-btn").click();
		}
		await expect(menu).toHaveClass(/\bopen\b/);
		await menu.locator(values === "all" ? "[data-action=all]" : "[data-action=none]").click();
		if (values !== "all") {
			for (const value of values) {
				const label = menu.locator("label").filter({
					has: this.page.locator(`input[value=${JSON.stringify(value)}]`),
				});
				await label.click();
				await expect(label.locator("input")).toBeChecked();
			}
		}
		await facet.locator(".charsheet__source-multiselect-btn").click();
	}

	async toggleQuickFilter (kind: SpellQuickFilter): Promise<void> {
		await this.sheet.openAddSpellMoreFilters();
		const button = this.modal().locator(".charsheet__modal-filter-btn").filter({hasText: kind});
		await button.click();
		await expect(button).toHaveAttribute("aria-pressed", "true");
	}

	async reset (): Promise<void> {
		const reset = this.modal().getByRole("button", {name: "Reset filters", exact: true}).first();
		if (await reset.count()) await reset.click();
	}

	async browseAllClasses (): Promise<void> {
		await this.reset();
		await this.select("class", "all");
		await this.select("subclass", []);
	}

	async search (value: string): Promise<void> {
		await this.sheet.searchAddSpellPicker(value);
	}

	async closeAndReopen (): Promise<void> {
		await this.sheet.closeAddSpellModal();
		await this.sheet.openAddSpellModal();
	}

	async catalog (): Promise<PickerSpell[]> {
		return this.page.evaluate(() => {
			const cs = globalThis.charSheet;
			const classes = cs._state.getClasses();
			const maxLevel = cs._spells._getMaxSpellLevel(classes[0], cs._state.getTotalLevel());
			return cs.getFilteredSpellData().filter(spell => spell.level <= maxLevel).map(spell => ({
				id: `${spell.name}|${spell.source}`,
				name: spell.name,
				source: spell.source,
				level: spell.level,
				school: spell.school,
				tags: spell.subschools || [],
				classes: Renderer.spell.getCombinedClasses(spell, "fromClassList").map(cls => cls.name),
				subclasses: Renderer.spell.getCombinedClasses(spell, "fromSubclass").map(sub => `${sub.class.name}: ${sub.subclass.name}`),
				ritual: !!spell.meta?.ritual,
				concentration: !!spell.duration?.some(duration => duration.concentration),
				verbal: !!spell.components?.v,
				somatic: !!spell.components?.s,
				material: !!spell.components?.m,
			}));
		});
	}

	/** Read every actual virtualized row, not only the count or first viewport. */
	async resultIds (): Promise<string[]> {
		const list = this.modal().locator(".charsheet__modal-list");
		const settle = () => list.evaluate(() => new Promise<void>(resolve =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		await list.evaluate(el => { el.scrollTop = 0; });
		await settle();
		const ids = new Set<string>();
		const maxSteps = await list.evaluate(el =>
			Math.ceil(el.scrollHeight / Math.max(100, el.clientHeight * 0.75)) + 2);
		let reachedEnd = false;
		for (let step = 0; step < maxSteps; ++step) {
			for (const id of await list.locator(".charsheet__modal-list-item").evaluateAll(rows =>
				rows.map(row => `${(row as HTMLElement).dataset.spellName}|${(row as HTMLElement).dataset.spellSource}`))) {
				ids.add(id);
			}
			const moved = await list.evaluate(el => {
				const before = el.scrollTop;
				el.scrollTop += Math.max(100, el.clientHeight * 0.75);
				return el.scrollTop > before;
			});
			if (!moved) {
				reachedEnd = true;
				break;
			}
			await settle();
		}
		expect(reachedEnd, "The result reader must reach the actual end, not stop at a fixed row cap").toBe(true);
		const snapshot = await this.sheet.getAddSpellPickerSnapshot();
		expect(ids.size, "Every counted spell must be reachable as a real result row").toBe(snapshot.logicalCount);
		return [...ids].sort();
	}

	async hasSiteFilterWidget (): Promise<boolean> {
		return this.page.evaluate(() => !!globalThis.tgttFilter || !!document.querySelector(".tgtt-filter-section"));
	}
}
