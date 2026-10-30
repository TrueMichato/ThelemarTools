import {expect, test} from "@playwright/test";
import {SpellMaterialsPage} from "../pages/SpellMaterialsPage";
import {clearCharacterStorage} from "../utils/characterStorage";

test.describe("Required spell materials and committed display refresh", () => {
	test.setTimeout(180_000);
	test.use({actionTimeout: 10_000});
	test.beforeEach(async ({page}) => { await clearCharacterStorage(page); });

	test("scoped DM permission, real supply consumption/reuse, keyboard cancellation and responsive popup", async ({page}, testInfo) => {
		const sheet = new SpellMaterialsPage(page);
		await sheet.spawn();
		const audit = await sheet.auditCatalog();
		console.log("Material catalog coverage:", JSON.stringify(audit));
		await testInfo.attach("runtime-material-coverage", {body: JSON.stringify(audit), contentType: "application/json"});
		expect(audit.missing).toEqual([]);
		const before = await sheet.snapshot();
		for (const method of ["button", "escape", "close"] as const) {
			await sheet.cast("Continual Flame");
			await sheet.cancelPermission(method);
			expect(await sheet.snapshot()).toEqual(before);
		}
		await sheet.cast("Continual Flame");
		const layouts = await sheet.capturePermissionLayouts(name => testInfo.outputPath(name));
		await testInfo.attach("permission-layouts", {body: JSON.stringify(layouts), contentType: "application/json"});
		expect(layouts).toEqual(layouts.map(({name}) => ({name, overflow: false, wrappedControlsFit: true, mobileTargetsFit: true})));
		await sheet.override();
		await expect.poll(async () => (await sheet.snapshot()).slot2).toBe(before.slot2 - 1);
		expect((await sheet.snapshot()).inventory).toEqual(before.inventory);
		expect((await sheet.snapshot()).ignored).toBe(false);
		await sheet.cast("Continual Flame");
		await sheet.cancelPermission("escape");
		expect((await sheet.snapshot()).slot2).toBe(before.slot2 - 1);
		await sheet.cast("Continual Flame", {play: true});
		await sheet.cancelPermission("button");
		expect((await sheet.snapshot()).slot2).toBe(before.slot2 - 1);
		await sheet.cast("Continual Flame", {play: true});
		await sheet.override();
		await expect.poll(async () => (await sheet.snapshot()).slot2).toBe(before.slot2 - 2);
		expect((await sheet.snapshot()).inventory).toEqual(before.inventory);

		await sheet.addSupply("Continual Flame", "Powdered Ruby (50 gp)");
		await sheet.cast("Continual Flame");
		await expect.poll(async () => (await sheet.snapshot()).inventory.some(row => row.name === "Powdered Ruby (50 gp)")).toBe(false);
		expect((await sheet.snapshot()).slot2).toBe(before.slot2 - 3);
		await sheet.addSupply("Identify", "Pearl (100 gp)");
		const supplied = await sheet.snapshot();
		await sheet.cast("Identify");
		await expect.poll(async () => (await sheet.snapshot()).slot1).toBe(before.slot1 - 1);
		expect((await sheet.snapshot()).inventory).toEqual(supplied.inventory);
	});

	test("normal Shield Cast refreshes visible desktop/Play Mode AC and expires normally", async ({page}) => {
		const sheet = new SpellMaterialsPage(page);
		await sheet.spawn();
		await sheet.startCombat();
		const before = await sheet.snapshot();
		await sheet.cancelPlaySlotChoice("Shield");
		expect(await sheet.snapshot()).toEqual(before);
		await sheet.cast("Shield");
		await sheet.expectVisibleAc(before.ac + 5);
		expect((await sheet.snapshot()).slot1).toBe(before.slot1 - 1);
		await sheet.nextRound();
		await sheet.expectVisibleAc(before.ac);
		await sheet.cast("Shield", {play: true});
		await sheet.expectVisibleAc(before.ac + 5, {play: true});
		expect((await sheet.snapshot()).slot1).toBe(before.slot1 - 2);
		await sheet.nextRound();
		await sheet.expectVisibleAc(before.ac);
	});

	test("missing ruby does not prevent Simulacrum preview; explicit permission completes one saved actor", async ({page}) => {
		const sheet = new SpellMaterialsPage(page);
		await sheet.spawn();
		const before = await sheet.snapshot();
		const preview = await sheet.simulacrum.openCreation("XPHB");
		await preview.locator(".cs-simulacrum__create").click();
		await sheet.override();
		await expect.poll(async () => (await sheet.snapshot()).companions).toHaveLength(1);
		expect((await sheet.snapshot()).companions[0]).toMatchObject({version: 1, lifecycle: "active"});
		expect((await sheet.snapshot()).slot7).toBe(before.slot7 - 1);
		expect((await sheet.snapshot()).inventory).toEqual(before.inventory);
		await sheet.simulacrum.reload();
		expect((await sheet.snapshot()).companions).toHaveLength(1);
	});
});
