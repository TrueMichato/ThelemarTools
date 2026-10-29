import {expect, test} from "@playwright/test";
import {SimulacrumPage} from "../pages/SimulacrumPage";
import {clearCharacterStorage} from "../utils/characterStorage";

// Spell-workflow integration, not another comprehensive class-progression archetype.
test.describe("Simulacrum actor companions", () => {
	test.setTimeout(180_000);
	test.use({actionTimeout: 10_000});
	test.beforeEach(async ({page}) => { await clearCharacterStorage(page); });

	for (const source of ["PHB", "XPHB"] as const) {
		test(`${source}: preview, isolated casting, paid repair, persistence and replacement`, async ({page}) => {
			const sheet = new SimulacrumPage(page);
			await sheet.spawnCaster(source);
			const before = await sheet.snapshot();
			await sheet.cancelCreation(source);
			expect(await sheet.snapshot()).toEqual(before);

			const id = await sheet.create(source);
			const created = await sheet.snapshot();
			const actor = created.companions.find(row => row.id === id)!;
			expect(actor).toMatchObject({
				source, lifecycle: "active", level: 13, pb: 5, slot1: 4, slot7: 1, inventoryCount: 0,
			});
			expect(actor.hp.current).toBe(actor.hp.max);
			expect(actor.hp.max).toBe(Math.floor(before.owner.hp.max / 2));
			expect(created.owner.hp).toEqual(before.owner.hp);

			await sheet.castShield(id);
			const cast = await sheet.snapshot();
			expect(cast.companions.find(row => row.id === id)!.ac).toBe(actor.ac + 5);
			expect(cast.owner.ac).toBe(created.owner.ac);
			expect(cast.owner.slot1).toBe(created.owner.slot1);
			await sheet.damage(id, 3);
			const damaged = await sheet.snapshot();
			await sheet.repair(id, source);
			const repaired = await sheet.snapshot();
			expect(repaired.owner.gp).toBe(damaged.owner.gp - 300);
			expect(repaired.companions.find(row => row.id === id)).toMatchObject({
				hp: {current: actor.hp.max}, slot1: 3,
				resources: damaged.companions.find(row => row.id === id)!.resources,
				spellcasting: damaged.companions.find(row => row.id === id)!.spellcasting,
			});

			await sheet.reload();
			expect((await sheet.snapshot()).companions).toEqual(repaired.companions);
			await sheet.expectPlayModeControls(id, source);

			await sheet.ownerLongRest();
			expect((await sheet.snapshot()).companions.find(row => row.id === id)!.slot1).toBe(3);
			await sheet.addRuby();
			const replacementId = await sheet.create(source, {play: true});
			expect(replacementId).not.toBe(id);
			const replaced = await sheet.snapshot();
			expect(replaced.companions.find(row => row.id === id)?.lifecycle).toBe("destroyed");
			expect(replaced.companions.find(row => row.id === replacementId)?.lifecycle).toBe("active");
			await sheet.expectTerminal(id);
			await sheet.damage(replacementId, 10_000);
			await sheet.expectTerminal(replacementId);
			await sheet.dismiss(id);
			await sheet.reload();
			const terminal = await sheet.snapshot();
			expect(terminal.companions).toHaveLength(1);
			expect(terminal.companions[0]).toMatchObject({id: replacementId, lifecycle: "destroyed", hp: {current: 0}});
		});
	}

	test("manager fits desktop/mobile in day/night without changing actor pools", async ({page}, testInfo) => {
		const sheet = new SimulacrumPage(page);
		await sheet.spawnCaster("PHB");
		const id = await sheet.create("PHB");
		const before = await sheet.snapshot();
		const layouts = await sheet.captureResponsiveManager(id, name => testInfo.outputPath(name));
		await testInfo.attach("responsive-layouts", {body: JSON.stringify(layouts, null, 2), contentType: "application/json"});
		expect(layouts).toEqual(layouts.map(({name}) => ({name, overflow: false, contrast: [], smallControls: []})));
		expect(await sheet.snapshot()).toEqual(before);
	});
});
