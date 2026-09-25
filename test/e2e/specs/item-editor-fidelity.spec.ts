import {expect, Page, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {ItemEditorPage} from "../pages/ItemEditorPage";
import {clearCharacterStorage} from "../utils/characterStorage";

async function start (page: Page): Promise<ItemEditorPage> {
	await page.goto("/charactersheet.html", {waitUntil: "domcontentloaded"});
	await page.waitForFunction(() => !!(globalThis as any).charSheet?.spawn, null, {timeout: 120_000});
	await new CharacterSheetPage(page).spawnCharacter("fighter//1");
	return new ItemEditorPage(page);
}

test.describe("Item editor raw draft and catalog fidelity", () => {
	test.beforeEach(async ({page}) => clearCharacterStorage(page));

	test("XDMG Boots clone keeps its operational speed power through the real modal and re-edit", async ({page}) => {
		const editor = await start(page);
		const before = await editor.countItems();
		await editor.openCatalogClone("XDMG");
		await editor.expectPowerCount(1);
		await editor.expectPower("Boots of Speed Speed", false);
		await editor.rename("Custom XDMG Boots");
		expect(await editor.countItems()).toBe(before);
		await editor.save();
		const rows = await editor.findOwnedIds("Custom XDMG Boots");
		expect(rows).toHaveLength(1);
		const id = rows[0];
		const initial = await editor.getRawItem(id);
		expect(initial).toMatchObject({source: "Custom", _baseSource: "XDMG", modifySpeed: {multiply: {walk: 2}}});
		const speed = initial.itemPowers.find((power: any) => power.effectType === "modifySpeed");
		expect(speed).toMatchObject({kind: "toggle", isToggle: true, effectType: "modifySpeed",
			actionType: "bonus", isReferenceOnly: false});
		await editor.openOwnedItem(id);
		await editor.expectPowerCount(1);
		await editor.rename("Retitled XDMG Boots");
		await editor.save();
		const edited = await editor.getRawItem(id);
		expect(edited.itemPowers.find((power: any) => power.effectType === "modifySpeed")).toMatchObject({
			id: speed.id, kind: "toggle", isToggle: true, effectType: "modifySpeed", isReferenceOnly: false,
		});
		expect(edited.entries).toEqual(initial.entries);
	});

	test("edit no-op and explicit clears preserve raw nested entries until their field changes", async ({page}) => {
		const editor = await start(page);
		const id = await editor.addRawItem({name: "Nested Keepsake", source: "PHB", type: "W",
			bonusSavingThrow: 1, resist: ["fire"], entries: [{
				type: "entries", name: "Story", entries: ["{@b Old lore}", {type: "table", rows: [["1", "Treasure"]]}],
			}], catalogExtra: {marker: 42}});
		const before = await editor.getRawItem(id);
		await editor.openOwnedItem(id);
		await editor.save();
		expect(await editor.getRawItem(id)).toEqual(before);
		await editor.openOwnedItem(id);
		await editor.clear("#custom-item-desc");
		await editor.clear("#custom-item-bonus-save-all");
		await editor.uncheck(".resist-check:checked");
		await editor.save();
		const after = await editor.getRawItem(id);
		expect(after).toMatchObject({id, name: "Nested Keepsake", _baseSource: "PHB",
			catalogExtra: {marker: 42}, bonusSavingThrow: 0});
		expect(after.entries).toEqual([]);
		expect(after.resist).toBeNull();
	});

	test("switching catalog bases discards stale powers and does not make speed passive", async ({page}) => {
		const editor = await start(page);
		await editor.openCatalogClone("DMG");
		await editor.expectPowerCount(1);
		await editor.chooseBase("Cloak of Protection", "DMG");
		await editor.expectName("Cloak of Protection");
		await editor.expectPowerCount(0);
		await editor.chooseBase("Boots of Speed", "XDMG");
		await editor.expectName("Boots of Speed");
		await editor.expectPowerCount(1);
		await editor.expectPower("Boots of Speed Speed", false);
		await editor.save();
		const row = await editor.findCustomItem("Boots of Speed");
		expect(row._baseSource).toBe("XDMG");
		expect(row.itemPowers.filter((power: any) => power.effectType === "modifySpeed")).toHaveLength(1);
	});

	test("editable spell uses seed from the owned item and clearing one keeps advanced grants", async ({page}) => {
		const editor = await start(page);
		const id = await editor.addRawItem({
			name: "Spell Token", source: "Homebrew", type: "W",
			attachedSpells: {will: ["light|phb"], daily: {"2e": ["misty step|phb"]},
				charges: {"1": ["shield|phb"]}, ritual: ["identify|phb"]},
		});
		const before = await editor.getRawItem(id);
		await editor.openOwnedItem(id);
		await editor.expectSpellUses(3);
		await editor.save();
		expect((await editor.getRawItem(id)).attachedSpells).toEqual(before.attachedSpells);
		await editor.openOwnedItem(id);
		await editor.removeFirstSpellUse();
		await editor.expectSpellUses(2);
		await editor.save();
		expect((await editor.getRawItem(id)).attachedSpells).toEqual({
			daily: {"2e": ["misty step|phb"]},
			charges: {"1": ["shield|phb"]},
			ritual: ["identify|phb"],
		});
		expect(await editor.getItemPowerNames(id)).not.toContain("Light");
	});

	test("removing an active speed power requires clearing its multiplier before Save", async ({page}) => {
		const editor = await start(page);
		const before = await editor.countItems();
		await editor.openCatalogClone("XDMG");
		await editor.removeSpeedPower();
		await editor.save();
		await editor.expectWarning("Removing the active speed power would make its speed bonus passive");
		expect(await editor.countItems()).toBe(before);
		await editor.setWalkSpeedMultiplier("");
		await editor.save();
		const row = await editor.findCustomItem("Boots of Speed");
		expect(row.modifySpeed).toBeNull();
		expect(row.itemPowers.some((power: any) => power.isToggle && power.effectType === "modifySpeed")).toBe(false);
	});

	test("a rejected real character save retains the draft but rolls back the owned item and success feedback", async ({page}) => {
		const editor = await start(page);
		const id = await editor.addRawItem({name: "Kept Blade", source: "Custom", type: "M",
			weapon: true, dmg1: "1d8", dmgType: "S", equipped: true});
		const before = await editor.getRawItem(id);
		await editor.openOwnedItemFromInventory(id);
		await editor.rename("Saved Blade");
		await editor.failNextCharacterSave();
		await editor.save();
		await editor.expectWarning("could not be saved");
		expect(await editor.getRawItem(id)).toEqual(before);
		expect(await editor.getSaveFeedback()).not.toContain("success");
		expect(await editor.getPersistedItemNames(id)).toEqual({canonical: "Kept Blade", mirror: null});
		await editor.save();
		expect((await editor.getRawItem(id)).name).toBe("Saved Blade");
		expect(await editor.getSaveFeedback()).toContain("success");
	});

	for (const source of ["DMG", "XDMG"]) {
		test(`a saved ${source} Boots row repairs legacy powers and stays off after unequip/unattune and Modify`, async ({page}) => {
			const editor = await start(page);
			const id = await editor.addLegacyCatalogBoots(source);
			const original = await editor.getRawItem(id);
			const speed = original.itemPowers.filter((power: any) => power.effectType === "modifySpeed");
			expect(speed).toHaveLength(1);
			expect(speed[0]).toMatchObject({kind: "toggle", isToggle: true, actionType: "bonus", isReferenceOnly: false});
			expect(original.itemPowers.map((power: any) => power.id)).toContain("unrelated-lore");
			expect(original.itemPowers.map((power: any) => power.id)).not.toContain("reference:boots-of-speed:bonus");
			await editor.exportAndReload();
			expect(await editor.readWalkSpeed()).toBe(30);
			expect(await editor.getOverviewSpeedText()).toContain("30");
			expect(await editor.invokeSpeed(id)).toMatchObject({speed: 60, active: true});
			expect(await editor.getOverviewSpeedText()).toContain("60");
			expect(await editor.invokeSpeed(id)).toMatchObject({speed: 30, active: false});
			await editor.invokeSpeed(id);
			await editor.setEquipmentState(id, {equipped: false});
			expect(await editor.readWalkSpeed()).toBe(30);
			await editor.setEquipmentState(id, {equipped: true});
			expect(await editor.readWalkSpeed()).toBe(30);
			expect((await editor.getRawItem(id)).itemPowerStates[speed[0].id].active).toBe(false);
			await editor.invokeSpeed(id);
			await editor.setEquipmentState(id, {attuned: false});
			expect(await editor.readWalkSpeed()).toBe(30);
			await editor.setEquipmentState(id, {attuned: true});
			expect(await editor.readWalkSpeed()).toBe(30);
			await editor.openOwnedItemFromInventory(id);
			await editor.expectPowerCount(2);
			await editor.rename(`Retitled ${source} Boots`);
			await editor.save();
			const edited = await editor.getRawItem(id);
			expect(edited.itemPowers.find((power: any) => power.effectType === "modifySpeed").id).toBe(speed[0].id);
			expect(edited.itemPowers.map((power: any) => power.id)).toContain("unrelated-lore");
			expect(await editor.invokeSpeed(id)).toMatchObject({speed: 60, active: true});
			expect(await editor.invokeSpeed(id)).toMatchObject({speed: 30, active: false});
		});
	}
});
