import {expect, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {clearCharacterStorage} from "../utils/characterStorage";
import {gotoWithThelemar} from "../utils/homebrewLoader";

test.describe("Add Spell picker — complete virtualized results", () => {
	test.use({
		serviceWorkers: "block",
		storageState: {cookies: [], origins: []},
		viewport: {width: 1280, height: 700},
	});

	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
		await gotoWithThelemar(page);
	});

	test("Gambler reaches and selects Dimension Door beyond the former 100-row cap", async ({page}) => {
		const charSheet = new CharacterSheetPage(page);
		await charSheet.spawnCharacter("rogue/gambler/19");
		await charSheet.openAddSpellModal();

		const initial = await charSheet.getAddSpellPickerSnapshot("Dimension Door");
		expect(initial.logicalCount).toBeGreaterThan(100);
		expect(initial.countText).not.toMatch(/showing first/i);
		expect(initial.mountedRows).toBeLessThan(initial.logicalCount);
		expect(initial.mountedRows).toBeLessThanOrEqual(100);
		expect(initial.isSpellMounted).toBe(false);

		await charSheet.openAddSpellMoreFilters();
		const compact = await charSheet.getAddSpellPickerSnapshot();
		expect(compact.clientHeight).toBeGreaterThanOrEqual(175);
		const tab = await charSheet.tabFromLastMountedAddableSpell();
		expect(tab.from).not.toBe("");
		expect(tab.to).not.toBe("");
		expect(tab.to).not.toBe(tab.from);
		expect(tab.stayedInList).toBe(true);

		await charSheet.scrollAddSpellPickerUntilMounted("Dimension Door", "PHB");
		const revealed = await charSheet.getAddSpellPickerSnapshot("Dimension Door", "PHB");
		expect(revealed.scrollHeight).toBeGreaterThan(revealed.clientHeight);
		expect(revealed.scrollTop).toBeGreaterThan(0);
		expect(revealed.isSpellMounted).toBe(true);

		await charSheet.addMountedSpell("Dimension Door");
		expect(await page.evaluate(() => globalThis.charSheet._state.getSpells().some((spell: any) => spell.name === "Dimension Door" && spell.source === "PHB"))).toBe(true);

		await charSheet.searchAddSpellPicker("Dimension Door");
		const searched = await charSheet.getAddSpellPickerSnapshot("Dimension Door");
		expect(searched.logicalCount).toBeGreaterThanOrEqual(1);
		expect(searched.scrollTop).toBe(0);
		expect(searched.isSpellKnown).toBe(true);

		await charSheet.closeAddSpellModal();
		await charSheet.openAddSpellModal();
		const reopened = await charSheet.getAddSpellPickerSnapshot();
		expect(reopened.searchValue).toBe("");
		expect(reopened.scrollTop).toBe(0);
		expect(reopened.logicalCount).toBe(initial.logicalCount);
		expect(reopened.countText).not.toMatch(/showing first/i);

		const end = await charSheet.scrollAddSpellPickerToEnd();
		expect(end.name).not.toBe("");
		expect(end.position).toBe(end.setSize);
		const ended = await charSheet.getAddSpellPickerSnapshot();
		expect(ended.mountedRows).toBeLessThan(ended.logicalCount);
		expect(ended.mountedRows).toBeLessThanOrEqual(100);
	});
});
