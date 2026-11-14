import {expect, test} from "@playwright/test";
import {SpellPickerFiltersPage, type PickerSpell, type SpellFacet, type SpellQuickFilter} from "../pages/SpellPickerFiltersPage";
import {clearCharacterStorage} from "../utils/characterStorage";
import {gotoWithThelemar} from "../utils/homebrewLoader";

const EBON_TIDES_URL = "https://raw.githubusercontent.com/TheGiddyLimit/homebrew/refs/heads/master/collection/Kobold%20Press%3B%20Book%20of%20Ebon%20Tides.json";
const ids = (spells: PickerSpell[]) => spells.map(spell => spell.id).sort();

test.describe("Add Spell picker — rarity dictionary and filter results", () => {
	test.use({serviceWorkers: "block", storageState: {cookies: [], origins: []}});
	test.setTimeout(300_000);

	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
		await gotoWithThelemar(page, ["/homebrew/TravelersGuidetoThelemar.json", EBON_TIDES_URL]);
	});

	test("Book of Ebon Tides is Rare, never a Common result; combined filters and reset stay coherent", async ({page}) => {
		const picker = new SpellPickerFiltersPage(page);
		await picker.open();
		const initial = await picker.resultIds();
		const catalog = await picker.catalog();
		const book = catalog.filter(spell => spell.source === "BookOfEbonTides");
		expect(book.length).toBeGreaterThan(0);
		expect(book.every(spell => spell.tags.includes("rarity:rare") && !spell.tags.includes("rarity:common"))).toBe(true);
		expect(await picker.hasSiteFilterWidget()).toBe(false);

		await picker.browseAllClasses();
		await picker.select("rarity", ["rarity:common"]);
		await picker.search("Bitter Wind");
		expect(await picker.resultIds()).toEqual([]);

		await picker.select("rarity", ["rarity:rare"]);
		await picker.select("source", ["BookOfEbonTides"]);
		await picker.select("level", ["3"]);
		expect(await picker.resultIds()).toEqual(["Bitter Wind|BookOfEbonTides"]);

		await picker.select("rarity", []);
		expect(await picker.resultIds()).toEqual([]);
		await picker.reset();
		expect(await picker.resultIds()).toEqual(initial);
		await picker.closeAndReopen();
		expect(await picker.resultIds()).toEqual(initial);
	});

	test("each facet and quick filter changes the complete actual result set", async ({page}) => {
		const picker = new SpellPickerFiltersPage(page);
		await picker.open();
		const catalog = await picker.catalog();
		const subclass = catalog.flatMap(spell => spell.subclasses)[0];
		const tag = catalog.flatMap(spell => spell.tags).find(value => !/^(rarity|legality):/.test(value));
		expect(subclass).toBeTruthy();
		expect(tag).toBeTruthy();
		if (!subclass || !tag) throw new Error("The real catalog must include expanded lists and non-rarity tags");

		const facets: {kind: SpellFacet; value: string; matches: (spell: PickerSpell) => boolean}[] = [
			{kind: "class", value: "Bard", matches: spell => spell.classes.includes("Bard")},
			{kind: "subclass", value: subclass, matches: spell => spell.subclasses.includes(subclass)},
			{kind: "level", value: "1", matches: spell => spell.level === 1},
			{kind: "school", value: "C", matches: spell => spell.school === "C"},
			{kind: "source", value: "BookOfEbonTides", matches: spell => spell.source === "BookOfEbonTides"},
			{kind: "rarity", value: "rarity:rare", matches: spell => spell.tags.includes("rarity:rare")},
			{kind: "legality", value: "legality:legal", matches: spell => spell.tags.includes("legality:legal")},
			{kind: "tag", value: tag, matches: spell => spell.tags.includes(tag)},
		];
		for (const facet of facets) {
			await test.step(facet.kind, async () => {
				await picker.browseAllClasses();
				if (facet.kind === "subclass") await picker.select("class", []);
				await picker.select(facet.kind, [facet.value]);
				const expected = catalog.filter(facet.matches);
				expect(expected.length).toBeGreaterThan(0);
				expect(expected.length).toBeLessThan(catalog.length);
				expect(await picker.resultIds()).toEqual(ids(expected));
				await picker.select(facet.kind, []);
				expect(await picker.resultIds()).toEqual([]);
			});
		}

		const quickFilters: {kind: SpellQuickFilter; matches: (spell: PickerSpell) => boolean}[] = [
			{kind: "Ritual", matches: spell => spell.ritual},
			{kind: "Concentration", matches: spell => spell.concentration},
			{kind: "Verbal", matches: spell => spell.verbal},
			{kind: "Somatic", matches: spell => spell.somatic},
			{kind: "Material", matches: spell => spell.material},
		];
		for (const filter of quickFilters) {
			await test.step(filter.kind, async () => {
				await picker.browseAllClasses();
				await picker.toggleQuickFilter(filter.kind);
				const expected = catalog.filter(filter.matches);
				expect(expected.length).toBeGreaterThan(0);
				expect(expected.length).toBeLessThan(catalog.length);
				expect(await picker.resultIds()).toEqual(ids(expected));
			});
		}
	});
});
