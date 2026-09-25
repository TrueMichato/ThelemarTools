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

test.describe("Shared responsive item editor", () => {
	test.beforeEach(async ({page}) => clearCharacterStorage(page));

	test("desktop Create authors typed dice, validates before Save, and rolls both lines", async ({page}) => {
		const editor = await start(page);
		await editor.openCreate();
		await editor.selectType("weapon");
		await editor.rename("Two-tone Sword");
		await editor.setBaseDamage("1d8", "slashing");
		await editor.addDamageRider("1d6", "fire");
		await editor.addDamageRider("2d4", "cold");
		expect(await editor.findOwnedIds("Two-tone Sword")).toHaveLength(0);
		expect(await editor.getSummary()).toContain("1d6 fire");
		await editor.setRiderDice(0, "not dice");
		await editor.save();
		await editor.expectRiderDiceFocused(0);
		await editor.expectValidation("dice");
		expect(await editor.findOwnedIds("Two-tone Sword")).toHaveLength(0);
		await editor.setRiderDice(0, "1d6");
		await editor.save();
		const [id] = await editor.findOwnedIds("Two-tone Sword");
		const raw = await editor.getRawItem(id);
		expect(raw.damageRiders).toMatchObject([{dice: "1d6", damageType: "fire"}, {dice: "2d4", damageType: "cold"}]);
		expect(raw.damageRiders[0].id).not.toBe(raw.damageRiders[1].id);
		await editor.equipAndAttune(id);
		expect(await editor.rollItemDamage(id)).toMatch(/\d+ slashing \+ \d+ fire \+ \d+ cold/i);
	});

	test("Modify preserves a nested raw item while editing combined damage conditions", async ({page}) => {
		const editor = await start(page);
		const id = await editor.addRawItem({
			name: "Old Ember", source: "Custom", type: "M", dmg1: "1d6", dmgType: "slashing",
			entries: [{type: "entries", name: "History", entries: ["old text"]}],
			damageRiders: [{id: "original-ember", dice: "1d4", damageType: "fire"}],
			catalogExtra: {retain: true},
		});
		await editor.openOwnedItemFromInventory(id);
		await editor.rename("New Ember");
		await editor.addDamagePower("Ignite");
		await editor.addDamageRider("2d6", "lightning", {
			powerName: "Ignite", criticalOnly: true, oncePerTurn: true, targetCreatureType: "dragon",
		});
		expect(await editor.getSummary()).toContain("AND");
		expect((await editor.getRawItem(id)).name).toBe("Old Ember");
		await editor.removeDamagePower("Ignite");
		await editor.save();
		await editor.expectRiderPowerFocused(1);
		await editor.expectValidation("operational toggle");
		expect((await editor.getRawItem(id)).name).toBe("Old Ember");
		await editor.addDamagePower("Ignite");
		await editor.selectRiderPower(1, "Ignite");
		await editor.save();
		const raw = await editor.getRawItem(id);
		const power = raw.itemPowers.find((it: any) => it.name === "Ignite");
		expect(power).toMatchObject({kind: "toggle", isToggle: true, effectType: "damageRiders", isReferenceOnly: false});
		expect(raw.damageRiders).toMatchObject([
			{id: "original-ember", dice: "1d4", damageType: "fire"},
			{dice: "2d6", damageType: "lightning", conditions: {
				powerId: power.id, criticalOnly: true, oncePerTurn: true, targetCreatureType: "dragon",
			}},
		]);
		expect(raw.entries).toEqual([{type: "entries", name: "History", entries: ["old text"]}]);
		expect(raw.catalogExtra).toEqual({retain: true});
	});

	test("a passive speed item stays passive with an unrelated reference power", async ({page}) => {
		const editor = await start(page);
		await editor.openCreate();
		await editor.selectType("wondrous");
		await editor.rename("Swift Keepsake");
		await editor.setWalkSpeedMultiplier("2");
		await editor.addReferencePower("Historical lore");
		await editor.save();
		const [id] = await editor.findOwnedIds("Swift Keepsake");
		expect((await editor.getRawItem(id)).itemPowers).toMatchObject([{name: "Historical lore", isReferenceOnly: true}]);
		expect((await editor.getRawItem(id)).itemPowers || []).not.toContainEqual(expect.objectContaining({effectType: "modifySpeed"}));
		await editor.equipAndAttune(id);
		expect(await editor.readWalkSpeed()).toBe(60);
		await editor.openOwnedItemFromInventory(id);
		await editor.setWalkSpeedMultiplier("");
		await editor.save();
		expect(await editor.readWalkSpeed()).toBe(30);
	});

	test("dirty base switching and Cancel require an explicit choice and restore focus", async ({page}) => {
		const editor = await start(page);
		await editor.openCreate();
		await editor.rename("Unsaved draft");
		await editor.startBaseSwitch();
		await editor.keepCurrentBase();
		await editor.expectName("Unsaved draft");
		await editor.chooseBase("Boots of Speed", "DMG", {replaceDirty: true});
		await editor.expectName("Boots of Speed");
		await editor.rename("Unsaved Boots");
		await editor.cancel();
		await editor.expectDiscardPrompt();
		await editor.keepEditing();
		await editor.expectName("Unsaved Boots");
		await editor.cancel();
		await editor.discard();
		await editor.expectCreateFocus();
		expect(await editor.findOwnedIds("Unsaved Boots")).toHaveLength(0);
	});

	test("editor fits desktop and narrow day/night viewports without hiding the footer", async ({page}, testInfo) => {
		const editor = await start(page);
		await editor.openCreate();
		await editor.selectType("weapon");
		await editor.rename("Viewport test");
		await editor.addDamageRider("1d6", "fire");
		const layouts: {label: string; layout: Awaited<ReturnType<ItemEditorPage["inspectEditorLayout"]>>}[] = [];
		for (const [width, height] of [[1440, 900], [390, 844]]) {
			await page.setViewportSize({width, height});
			for (const night of [false, true]) {
				const label = `${width}-${night ? "night" : "day"}`;
				const layout = await editor.inspectEditorLayout(testInfo.outputPath(`editor-${label}.png`), night);
				layouts.push({label, layout});
			}
		}
		for (const {label, layout} of layouts) {
			expect(layout.overflow, label).toBe(false);
			expect(layout.footerVisible, `${label}: ${JSON.stringify(layout)}`).toBe(true);
			expect(layout.display, label).toBe(label.startsWith("1440") ? "grid" : "flex");
			expect(layout.navHeight, `${label}: ${JSON.stringify(layout)}`).toBeGreaterThanOrEqual(layout.navButtonHeight);
		}
	});

	test("narrow layout keeps dirty draft on Escape and only activates authored speed when toggled", async ({page}) => {
		await page.setViewportSize({width: 390, height: 844});
		await page.emulateMedia({reducedMotion: "reduce"});
		const editor = await start(page);
		await editor.openCreate();
		await editor.selectType("wondrous");
		await editor.rename("Sprint Charm");
		await editor.setWalkSpeedMultiplier("2");
		await editor.setSpeedActivation("bonus", "Sprint");
		await editor.navigateGroup("Bonuses & Effects");
		await page.keyboard.press("Escape");
		await editor.expectDiscardPrompt();
		await editor.keepEditing();
		expect(await editor.findOwnedIds("Sprint Charm")).toHaveLength(0);
		await editor.expandSummary();
		expect(await editor.getSummary()).toContain("Sprint");
		expect(await editor.isEditorOverflowed()).toBe(false);
		await editor.save();
		const [id] = await editor.findOwnedIds("Sprint Charm");
		const raw = await editor.getRawItem(id);
		expect(raw.itemPowers.find((it: any) => it.effectType === "modifySpeed")).toMatchObject({
			actionType: "bonus", kind: "toggle", isToggle: true, isReferenceOnly: false,
		});
		await editor.equipAndAttune(id);
		expect(await editor.readWalkSpeed()).toBe(30);
		const on = await editor.invokeSpeed(id);
		expect(on).toMatchObject({speed: 60, active: true});
		expect(on.overview).toContain("60");
		const off = await editor.invokeSpeed(id);
		expect(off).toMatchObject({speed: 30, active: false});
		expect(off.overview).toContain("30");
	});

	for (const source of ["DMG", "XDMG"]) {
		test(`${source} Boots catalog clone starts in shared editor and stays inactive until invoked`, async ({page}) => {
			const editor = await start(page);
			await editor.openCreate();
			await editor.chooseBase("Boots of Speed", source);
			await editor.expectPowerCount(1);
			await editor.rename(`Responsive ${source} Boots`);
			expect(await editor.findOwnedIds(`Responsive ${source} Boots`)).toHaveLength(0);
			await editor.save();
			const [id] = await editor.findOwnedIds(`Responsive ${source} Boots`);
			const raw = await editor.getRawItem(id);
			expect(raw._baseSource).toBe(source);
			await editor.equipAndAttune(id);
			expect(await editor.readWalkSpeed()).toBe(30);
			expect(await editor.invokeSpeed(id)).toMatchObject({speed: 60, active: true});
			expect(await editor.invokeSpeed(id)).toMatchObject({speed: 30, active: false});
		});
	}
});
