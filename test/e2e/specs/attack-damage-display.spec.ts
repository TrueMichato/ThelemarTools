import {expect, test} from "@playwright/test";
import {AttackDamageDisplayPage} from "../pages/AttackDamageDisplayPage";
import {clearCharacterStorage} from "../utils/characterStorage";

test.describe("Combat weapon damage display", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	test("real Gambler tools retain item/display/roller parity through upgrades, edits and overrides", async ({page}) => {
		test.setTimeout(150_000);
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		const damage = new AttackDamageDisplayPage(page);
		await damage.openLocalCatalog();
		await damage.sheet.spawnCharacter("rogue[TGTT]/gambler[TGTT]/3/dwarf");
		const weapons = await damage.gamblerWeapons();
		expect(weapons.map(weapon => weapon.key).sort()).toEqual(["cards", "coins", "dice"]);
		for (const [key, dice] of [["coins", "1d4"], ["dice", "1d6"], ["cards", "1d8"]]) {
			const weapon = weapons.find(weapon => weapon.key === key);
			if (!weapon) throw new Error(`Gambler weapon missing: ${key}`);
			expect((await damage.assertDamage(weapon.id, dice)).itemDamage.dice).toBe(dice);
		}
		const coins = weapons.find(weapon => weapon.key === "coins");
		if (!coins) throw new Error("Gambler coins missing");
		await damage.configureWeapon(coins.id, {superior: true});
		const upgraded = await damage.assertDamage(coins.id, "1d6");
		expect(upgraded.rawDice).toBe("1d4");
		expect(upgraded.profile.dmg1).toBe("1d4");
		expect(upgraded.itemDamage.dice).toBe("1d6");
		await damage.assertDamage(coins.id, "1d6", {crit: true});
		await damage.configureWeapon(coins.id, {rawDice: "2d4", equipped: false});
		await damage.configureWeapon(coins.id, {equipped: true});
		expect((await damage.assertDamage(coins.id, "2d6")).itemDamage.dice).toBe("2d6");
		await damage.configureWeapon(coins.id, {damageOverride: "3d6"});
		expect((await damage.assertDamage(coins.id, "3d6")).itemDamage.dice).toBe("2d6");
		expect(errors).toEqual([]);
	});

	test("composes versatile hands, shield, material, Superior and Monk substitution without double stepping", async ({page}) => {
		test.setTimeout(150_000);
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		const damage = new AttackDamageDisplayPage(page);
		await damage.openLocalCatalog();
		await damage.sheet.spawnCharacter("rogue[TGTT]/gambler[TGTT]/3/dwarf");
		const sword = await damage.addCatalogItem("Longsword");
		await damage.assertDamage(sword, "1d8");
		await damage.configureWeapon(sword, {hands: 2});
		await damage.assertDamage(sword, "1d10");
		const shield = await damage.addCatalogItem("Shield");
		expect((await damage.assertDamage(sword, "1d8")).selectedDie).toBe("1d8");
		await damage.configureWeapon(shield, {equipped: false});
		await damage.configureWeapon(sword, {hands: 1, material: "Steeline"});
		expect((await damage.assertDamage(sword, "1d10")).profile.dmg1).toBe("1d10");
		await damage.configureWeapon(sword, {superior: true});
		const composed = await damage.assertDamage(sword, "1d12");
		expect(composed.rawDice).toBe("1d8");
		expect(composed.itemDamage).toMatchObject({dice: "1d12", diceVersatile: "2d6"});
		await damage.configureWeapon(sword, {hands: 2});
		await damage.assertDamage(sword, "2d6");
		await damage.sheet.spawnCharacter("monk[XPHB]/warrior of the open hand[XPHB]/5/dwarf");
		const staff = await damage.addCatalogItem("Quarterstaff");
		expect((await damage.assertDamage(staff, "1d8")).itemDamage.dice).toBe("1d6");
		await damage.configureWeapon(staff, {superior: true});
		expect((await damage.assertDamage(staff, "1d10")).itemDamage.dice).toBe("1d8");
		expect(errors).toEqual([]);
	});
});
