import {expect, Page, test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {ItemEditorPage} from "../pages/ItemEditorPage";
import {ItemPowerStatusPage} from "../pages/ItemPowerStatusPage";
import {clearCharacterStorage} from "../utils/characterStorage";

async function start (page: Page): Promise<{editor: ItemEditorPage; status: ItemPowerStatusPage}> {
	await page.goto("/charactersheet.html", {waitUntil: "domcontentloaded"});
	await page.waitForFunction(() => !!(globalThis as any).charSheet?.spawn, null, {timeout: 120_000});
	await new CharacterSheetPage(page).spawnCharacter("fighter//1");
	return {editor: new ItemEditorPage(page), status: new ItemPowerStatusPage(page)};
}

test.describe("Operational item powers in Active States", () => {
	test.beforeEach(async ({page}) => clearCharacterStorage(page));

	for (const source of ["DMG", "XDMG"]) {
		test(`${source} Boots power appears only while truly active across all three surfaces and reload`, async ({page}) => {
			test.setTimeout(180_000);
			const {editor, status} = await start(page);
			const id = await editor.addLegacyCatalogBoots(source);
			const powerName = "Boots of Speed Speed";
			const raw = await editor.getRawItem(id);
			const speedPower = raw.itemPowers.find((power: any) => power.effectType === "modifySpeed");
			expect(speedPower).toBeDefined();

			await status.expectAbsent("overview", id);
			await status.invokeFromInventory(id, powerName, "Activate");
			await status.expectWalkSpeed(60);
			for (const surface of ["overview", "combat", "play"] as const) {
				await status.expectActive(surface, id, "Boots of Speed");
			}
			await status.expectNoSyntheticStates();
			await status.waitForPersistedPower(id, speedPower.id, true);
			await status.reload(id);
			for (const surface of ["play", "combat", "overview"] as const) {
				await status.expectActive(surface, id, "Boots of Speed");
				await status.openFromStatusWithKeyboard(surface, id);
				await status.expectPowerFocused(powerName, "Deactivate");
				await status.closeModalWithEscape();
				await status.expectStatusFocus(surface, id);
			}
			await status.expectWalkSpeed(60);

			const deactivateFrom = source === "DMG" ? "overview" : "play";
			await status.expectActive(deactivateFrom, id, "Boots of Speed");
			await status.openFromStatusWithKeyboard(deactivateFrom, id);
			await status.deactivateFocusedPower(powerName);
			await status.expectAbsent(deactivateFrom, id);
			await status.expectFallbackFocus(deactivateFrom);
			await status.expectWalkSpeed(30);
			for (const surface of ["overview", "combat", "play"] as const) await status.expectAbsent(surface, id);
			await status.waitForPersistedPower(id, speedPower.id, false);
			await status.reload(id);
			for (const surface of ["overview", "combat", "play"] as const) await status.expectAbsent(surface, id);
			await status.expectNoSyntheticStates();
		});
	}

	test("custom speed items use the correct wrapper and named power; equipment changes clear the mirror", async ({page}) => {
		test.setTimeout(180_000);
		const {editor, status} = await start(page);
		const boots = {
			name: "Traveler's Swift Boots", source: "Custom", type: "W", _isCustom: true,
			reqAttune: true, requiresAttunement: true, equipped: true, attuned: true,
			modifySpeed: {multiply: {walk: 2}},
			itemPowers: [
				{id: "glimmer", name: "Glimmer", kind: "ability", actionType: "action", isReferenceOnly: false},
				{id: "quick-step", name: "Quick Step", kind: "toggle", actionType: "bonus",
					isToggle: true, effectType: "modifySpeed", isReferenceOnly: false},
			],
		};
		await editor.addRawItem(boots);
		await editor.addRawItem(boots);
		const ids = await editor.findOwnedIds(boots.name);
		expect(ids).toHaveLength(2);
		expect(ids[0]).not.toBe(ids[1]);

		await status.invokeFromInventory(ids[0], "Quick Step", "Activate");
		await status.expectWalkSpeed(60);
		await status.expectActive("combat", ids[0], boots.name);
		await status.expectAbsent("combat", ids[1]);
		await status.openFromStatusWithKeyboard("combat", ids[0]);
		await status.expectPowerFocused("Quick Step", "Deactivate");
		await status.closeModalWithEscape();
		await status.expectStatusFocus("combat", ids[0]);
		await status.openFromStatusWithKeyboard("combat", ids[0]);
		await status.deactivateFocusedPower("Quick Step");
		await status.expectAbsent("combat", ids[0]);
		await status.expectFallbackFocus("combat");
		await status.expectWalkSpeed(30);

		await status.invokeFromInventory(ids[1], "Quick Step", "Activate");
		await status.expectActive("overview", ids[1], boots.name);
		await status.expectAbsent("overview", ids[0]);
		await status.toggleEquipment(ids[1], "equip");
		await status.expectAbsent("overview", ids[1]);
		await status.expectWalkSpeed(30);
		await status.toggleEquipment(ids[1], "equip");
		await status.expectAbsent("overview", ids[1]);
		await status.invokeFromInventory(ids[1], "Quick Step", "Activate");
		await status.toggleEquipment(ids[1], "attune");
		await status.expectAbsent("overview", ids[1]);
		await status.expectWalkSpeed(30);
		await status.toggleEquipment(ids[1], "attune");
		await status.expectAbsent("overview", ids[1]);
		await status.expectNoSyntheticStates(boots.name, "Quick Step");
	});

	test("a DMG-to-XDMG base switch retains one operational speed power and its status", async ({page}) => {
		test.setTimeout(180_000);
		const {editor, status} = await start(page);
		await editor.openCatalogClone("DMG");
		await editor.chooseBase("Boots of Speed", "XDMG");
		await editor.save();
		const ids = await editor.findOwnedIds("Boots of Speed");
		expect(ids).toHaveLength(1);
		const id = ids[0];
		const raw = await editor.getRawItem(id);
		expect(raw._baseSource).toBe("XDMG");
		expect(raw.itemPowers.filter((power: any) => power.effectType === "modifySpeed")).toHaveLength(1);
		await editor.setEquipmentState(id, {equipped: true, attuned: true});

		await status.expectWalkSpeed(30);
		await status.expectAbsent("overview", id);
		await status.invokeFromInventory(id, "Boots of Speed Speed", "Activate");
		await status.expectWalkSpeed(60);
		await status.expectActive("play", id, "Boots of Speed");
		await status.openFromStatusWithKeyboard("play", id);
		await status.expectPowerFocused("Boots of Speed Speed", "Deactivate");
		await status.deactivateFocusedPower("Boots of Speed Speed");
		await status.expectAbsent("play", id);
		await status.expectWalkSpeed(30);
	});

	test("an active speed power stays visible after its last charge is spent", async ({page}) => {
		test.setTimeout(120_000);
		const {editor, status} = await start(page);
		const id = await editor.addRawItem({
			name: "Charged Swift Boots", source: "Custom", type: "W", _isCustom: true,
			equipped: true, modifySpeed: {multiply: {walk: 2}},
			charges: 1, chargesCurrent: 1,
			itemPowers: [{
				id: "charged-step", name: "Charged Step", kind: "toggle", isToggle: true,
				effectType: "modifySpeed", actionType: "bonus", isReferenceOnly: false, chargesCost: 1, chargesCostMax: 2,
			}],
		});
		await status.invokeFromInventory(id, "Charged Step", "Activate");
		await status.expectWalkSpeed(60);
		await status.expectActive("overview", id, "Charged Swift Boots");
		await status.openFromStatusWithKeyboard("overview", id);
		await status.expectPowerFocused("Charged Step", "Deactivate");
		await status.closeModalWithEscape();
		await status.expectStatusFocus("overview", id);
		await status.waitForPersistedPower(id, "charged-step", true);
		await status.reload(id);
		await status.expectActive("play", id, "Charged Swift Boots");
		await status.expectWalkSpeed(60);
		await status.expectActive("play", id, "Charged Swift Boots");
		await status.openFromStatusWithKeyboard("play", id);
		await status.expectPowerFocused("Charged Step", "Deactivate");
		await status.deactivateFocusedPower("Charged Step");
		await status.expectFallbackFocus("play");
		await status.expectAbsent("play", id);
		await status.expectWalkSpeed(30);
		await status.waitForPersistedPower(id, "charged-step", false);
		await status.reload(id);
		await status.expectAbsent("overview", id);
		await status.expectWalkSpeed(30);
		expect(await editor.getRawItem(id)).toMatchObject({chargesCurrent: 0, itemPowerStates: {"charged-step": {active: false}}});
		await status.openFromInventory(id);
		await status.expectPowerUnavailable("Charged Step");
		await status.expectNoSyntheticStates("Charged Swift Boots", "Charged Step");
	});

	test("passive and reference-only speed items never masquerade as activated states", async ({page}) => {
		test.setTimeout(120_000);
		const {editor, status} = await start(page);
		const passive = await editor.addRawItem({
			name: "Passive Swift Shoes", source: "Custom", type: "W", _isCustom: true,
			equipped: true, modifySpeed: {multiply: {walk: 2}},
		});
		const reference = await editor.addRawItem({
			name: "Reference Shoes", source: "Custom", type: "W", _isCustom: true,
			equipped: true, modifySpeed: {multiply: {walk: 2}},
			itemPowers: [{id: "speed-reference", name: "Rules reference", kind: "toggle",
				isToggle: true, effectType: "modifySpeed", actionType: "bonus", isReferenceOnly: true}],
			itemPowerStates: {"speed-reference": {active: true}},
		});
		await status.expectWalkSpeed(60);
		for (const surface of ["overview", "combat", "play"] as const) {
			await status.expectAbsent(surface, passive);
			await status.expectAbsent(surface, reference);
		}
	});
});
