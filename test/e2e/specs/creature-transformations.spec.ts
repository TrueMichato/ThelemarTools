import {expect, test} from "@playwright/test";
import {CreatureTransformationPage} from "../pages/CreatureTransformationPage";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("Bestiary previews immediately, leaves the source untouched, and stacks explicit conflict winners", async ({page}) => {
	test.setTimeout(120_000);
	await page.goto("/bestiary.html#goblin_mm");
	await page.locator(".bqa__btn-open:visible").first().click();
	await page.getByRole("tab", {name: "Templates"}).click();
	const editor = new CreatureTransformationPage(page);
	await editor.monitorOperationCreation();
	await editor.choose("catalog:skeleton|dmg");
	await editor.expectLivePreview();
	expect(await editor.createdOperations()).toBe(0);
	await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Creature type: Humanoid (Goblinoid) → Undead");
	await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Charisma: 8 → 4");
	await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Condition immunities: none → exhaustion, poisoned");
	await expect(editor.root.locator(".bqa__transformation-delta")).not.toContainText('"exhaustion"');
	const {isFullWidth, widthRatio, fontSize} = await editor.deltaLayout();
	expect(isFullWidth).toBe(true);
	expect(widthRatio).toBeGreaterThan(0.95);
	expect(fontSize).toBeGreaterThanOrEqual(16);
	await expect(editor.root.locator(".bqa__transformation-target")).toContainText("vulnerable");
	await expect(page.locator(".bqa__changes .bqa__row")).toHaveCount(0);
	await editor.requestConfirmation();
	await expect(page.locator(".bqa__changes .bqa__row")).toHaveCount(0);
	expect(await editor.createdOperations()).toBe(0);
	await editor.confirmPrerequisites();
	await editor.apply();
	expect(await editor.createdOperations()).toBeGreaterThan(0);
	await expect(page.locator(".bqa__changes")).toContainText("Transformation: Skeleton");

	await editor.choose("catalog:zombie|dmg");
	await editor.expectLivePreview();
	await expect(editor.root).toContainText("Choose an existing or incoming winner");
	await editor.pickIncomingWinners();
	await editor.apply();
	await expect(page.locator(".bqa__changes")).toContainText("Transformation: Zombie");
	await expect(page.locator(".bqa__changes .bqa__row-title")).toHaveCount(2);
	await page.setViewportSize({width: 390, height: 844});
	await expect(page.locator(".bqa__changes")).toBeVisible();
});

test("Encounter individual and bulk previews are read-only, skip ineligible monsters, and persist only selected effects", async ({page}) => {
	test.setTimeout(120_000);
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	const editor = new CreatureTransformationPage(page);
	const original = await editor.savedEncounter();
	await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
	await page.getByRole("tab", {name: "Templates"}).click();
	await editor.choose("catalog:skeleton|dmg");
	await editor.expectLivePreview();
	expect(await editor.savedEncounter()).toEqual(original);
	await editor.apply();
	await expect(page.locator(".ew__statblock")).toContainText("Undead");
	const afterIndividual = await editor.savedEncounter();
	expect(afterIndividual).not.toEqual(original);
	await page.getByRole("button", {name: "Done"}).click();
	await encounter.openActions();
	await page.locator("#ew-all").click();
	await page.locator(".ew__bulk-edit > summary").click();
	await page.locator("#ew-bulk-type").selectOption("transformation");
	const beforeBulk = await editor.savedEncounter();
	await editor.choose("catalog:lycanthropy|mm");
	await editor.chooseOption("Lycanthrope", "werebear");
	await editor.expectLivePreview();
	await expect(editor.root.locator(".bqa__transformation-summary")).toContainText("1 eligible · 1 skipped");
	await expect(editor.root).toContainText("Goblin #1: Creature does not satisfy transformation eligibility");
	expect(await editor.savedEncounter()).toEqual(beforeBulk);
	await editor.apply({bulk: true, count: 1});
	await page.reload();
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Undead");
	await page.getByRole("button", {name: "Next visible monster"}).click();
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("19");
	const saved = await editor.savedEncounter() as {instances: {monster: {type: string, str: number}, statblockOperations: unknown[]}[]};
	expect(saved.instances[0].monster.type).toBe("humanoid");
	expect(saved.instances[0].statblockOperations).toHaveLength(1);
	expect(saved.instances[1].monster.str).toBe(8);
	expect(saved.instances[1].statblockOperations).toHaveLength(1);
});

test("an option changes the live delta and its exact source-qualified mechanics survive encounter reload", async ({page}) => {
	test.setTimeout(120_000);
	const encounter = new EncounterRollPage(page);
	await encounter.seed({count: 1});
	const editor = new CreatureTransformationPage(page);
	const before = await editor.savedEncounter();
	await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
	await page.getByRole("tab", {name: "Templates"}).click();
	await editor.choose("catalog:half-dragon|mm");
	await expect(editor.root.locator(".bqa__transformation-target")).toHaveCount(0);
	await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Choose Dragon ancestry");
	await editor.chooseOption("Dragon ancestry", "red");
	await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Choose Breath size");
	await editor.chooseOption("Breath size", "large-or-smaller");
	await editor.expectLivePreview();
	await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Damage resistances");
	await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("fire");
	expect(await editor.savedEncounter()).toEqual(before);
	await editor.optionInfo("Dragon ancestry", "red").click();
	await expect(editor.nativeHover).toContainText("Resistance to fire");
	await expect(editor.nativeHover).toContainText("Half-Dragon (MM)");
	await editor.apply();
	await page.reload();
	const saved = await editor.savedEncounter() as {instances: {monster: {resist?: string[], senses?: string[], languages?: string[]}, statblockOperations: {data: {resolved: {selectedOptions: Record<string, string[]>}}}[]}[]};
	expect(saved.instances[0].monster.resist).toBeUndefined();
	expect(saved.instances[0].statblockOperations).toHaveLength(1);
	expect(saved.instances[0].statblockOperations[0].data.resolved.selectedOptions).toEqual({ancestry: ["red"], size: ["large-or-smaller"]});
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Res. Fire");
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Draconic");
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Blindsight 10 ft.");
	await expect(page.locator(".ew__statblock .ve-stats")).not.toContainText("Lightning");
});

test("Fairy flight previews as armor-restricted movement and survives encounter reload", async ({page}) => {
	test.setTimeout(120_000);
	await new EncounterRollPage(page).seed({count: 1});
	const editor = new CreatureTransformationPage(page);
	const before = await editor.savedEncounter();
	await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
	await page.getByRole("tab", {name: "Templates"}).click();
	await editor.choose("race:fairy|mpmm");
	await editor.chooseOption("Species spell grant and ability", "choice-1");
	await editor.expectLivePreview();
	await expect(editor.beforeStatblock).not.toContainText(/fly 30 ft/i);
	await expect(editor.afterStatblock).toContainText(/fly 30 ft\. while not wearing medium or heavy armor/i);
	expect(await editor.savedEncounter()).toEqual(before);
	await editor.apply();
	const saved = await editor.savedEncounter() as {instances: {monster: {speed: {fly?: number}}, statblockOperations: {data: {resolved: {changes: {type: string, mode?: string, relativeTo?: string, condition?: string}[]}}}[]}[]};
	expect(saved.instances[0].monster.speed.fly).toBeUndefined();
	expect(saved.instances[0].statblockOperations[0].data.resolved.changes).toEqual(expect.arrayContaining([
		{type: "grantRelativeSpeed", mode: "fly", relativeTo: "walk", condition: "noMediumOrHeavyArmor"},
	]));
	await page.reload();
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText(/fly 30 ft\. while not wearing medium or heavy armor/i);
});

test("catalog failures stay visible without a success-shaped picker or status", async ({page}) => {
	await page.route("**/data/creature-transformations.json", route => route.abort("failed"));
	await page.goto("/bestiary.html#goblin_mm");
	await page.locator(".bqa__btn-open:visible").first().click();
	await page.getByRole("tab", {name: "Templates"}).click();
	const editor = new CreatureTransformationPage(page);
	await expect(editor.root.getByRole("alert")).toContainText("Could not load creature transformations");
	await expect(editor.root.getByRole("button", {name: "Retry catalog load"})).toBeVisible();
	await expect(editor.root.getByRole("combobox", {name: "Creature transformation"})).toHaveCount(0);
	await expect(editor.root.getByRole("status")).toBeEmpty();
});

for (const surface of ["Bestiary", "Encounter Workspace"] as const) {
	test(`${surface} exposes recipe and option effects in native hover on pointer, focus, and info click`, async ({page}) => {
		test.setTimeout(120_000);
		const editor = new CreatureTransformationPage(page);
		if (surface === "Bestiary") {
			await page.goto("/bestiary.html#goblin_mm");
			await page.locator(".bqa__btn-open:visible").first().click();
		} else {
			await new EncounterRollPage(page).seed();
			await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
		}
		await page.getByRole("tab", {name: "Templates"}).click();
		const skeleton = editor.templateChoice("catalog:skeleton|dmg");
		await skeleton.hover();
		await expect(editor.nativeHover).toContainText("DM prerequisites");
		await expect(editor.nativeHover).toContainText(/Dungeon Master.s Guide/);
		await expect(editor.root.getByRole("combobox", {name: "Creature transformation"})).toHaveValue("");
		await editor.recipeInfo("catalog:skeleton|dmg").click();
		await expect(editor.nativeHover).toContainText("Mechanical effects");
		await editor.dismissNativeHover();
		await skeleton.click();
		await editor.expectLivePreview();
		await expect(editor.root.locator(".bqa__transformation-review")).toContainText("not applied automatically");
		await editor.choose("catalog:half-dragon|mm");
		const red = editor.optionControl("Dragon ancestry", "red");
		await page.keyboard.press("Tab");
		await red.focus();
		await expect(editor.nativeHover).toContainText("Resistance to fire");
		await expect(red).not.toBeChecked();
		await page.keyboard.press("Space");
		await expect(red).toBeChecked();
		await editor.optionInfo("Breath size", "huge").click();
		await expect(editor.nativeHover).toContainText("young-dragon breath");
		await editor.dismissNativeHover();
		await editor.chooseOption("Breath size", "large-or-smaller");
		await editor.expectLivePreview();
		for (const contrast of await editor.templateContrast("catalog:half-dragon|mm")) expect(contrast).toBeGreaterThanOrEqual(4.5);
	});
}

test("filters and duplicate homebrew IDs invalidate selection without blocking other templates", async ({page}) => {
	await page.goto("/bestiary.html#goblin_mm");
	const editor = new CreatureTransformationPage(page);
	await editor.injectRepeatedRaceDefinitions();
	await page.locator(".bqa__btn-open:visible").first().click();
	await page.getByRole("tab", {name: "Templates"}).click();
	await editor.chooseCategory("Species");
	await editor.selectSource("FoEQuickstone");
	await editor.search("gnoll");
	const picker = editor.root.getByRole("combobox", {name: "Creature transformation"});
	const ids = await picker.locator("option", {hasText: "Gnoll (FoEQuickstone)"}).evaluateAll(options => options.map(it => (it as HTMLOptionElement).value));
	expect(ids).toHaveLength(2);
	expect(new Set(ids).size).toBe(2);
	await editor.choose(ids[1]);
	await editor.expectLivePreview();
	await editor.search("no matching recipe");
	await expect(editor.root.locator(".bqa__transformation-target")).toHaveCount(0);
	await expect(editor.root.locator(".bqa__transformation-apply")).toHaveCount(0);
	await editor.chooseCategory("Templates");
	await editor.search("");
	await editor.choose("catalog:skeleton|dmg");
	await editor.expectLivePreview();
});

test("changing filters during an Apply reload cannot save a stale choice", async ({page}) => {
	test.setTimeout(120_000);
	await new EncounterRollPage(page).seed({count: 1});
	const editor = new CreatureTransformationPage(page);
	const before = await editor.savedEncounter();
	await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
	await page.getByRole("tab", {name: "Templates"}).click();
	await editor.choose("catalog:skeleton|dmg");
	await editor.expectLivePreview();
	await editor.requestConfirmation();
	await editor.confirmPrerequisites();
	await editor.pauseCatalogReload();
	await editor.root.getByRole("button", {name: "Apply transformation"}).click();
	await editor.search("no matching recipe");
	await editor.resumeCatalogReload();
	await expect(editor.root.getByRole("alert")).toContainText("filters, choices, or conflict winners changed");
	expect(await editor.savedEncounter()).toEqual(before);
	await expect(editor.root.locator(".bqa__transformation-status")).not.toContainText("Applied");
});

test("a failed encounter write is not reported as a save and does not change persisted state", async ({page}) => {
	test.setTimeout(120_000);
	await new EncounterRollPage(page).seed({count: 1});
	const editor = new CreatureTransformationPage(page);
	const before = await editor.savedEncounter();
	await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
	await page.getByRole("tab", {name: "Templates"}).click();
	await editor.choose("catalog:skeleton|dmg");
	await editor.expectLivePreview();
	await editor.failEncounterWrites();
	await editor.apply();
	await expect(editor.root.getByRole("alert")).toContainText("Simulated storage failure");
	await expect(editor.root.locator(".bqa__transformation-status")).not.toContainText("Applied");
	expect(await editor.savedEncounter()).toEqual(before);
	await page.reload();
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Humanoid");
});

test("a capped bulk target is named at Apply, then only the other target can be saved", async ({page}) => {
	test.setTimeout(120_000);
	const encounter = new EncounterRollPage(page);
	await encounter.seed({capFirstHistory: true});
	await encounter.openActions();
	await page.locator("#ew-all").click();
	await page.locator(".ew__bulk-edit > summary").click();
	await page.locator("#ew-bulk-type").selectOption("transformation");
	const editor = new CreatureTransformationPage(page);
	const before = await editor.savedEncounter();
	await editor.choose("catalog:skeleton|dmg");
	await editor.expectLivePreview({targets: 2});
	expect(await editor.savedEncounter()).toEqual(before);
	await editor.root.getByRole("button", {name: "Apply to 2 · one save"}).click();
	await editor.confirmPrerequisites();
	await editor.root.getByRole("button", {name: "Apply to 2 · one save"}).click();
	await expect(editor.root.getByRole("alert")).toContainText("Storage or eligibility changed the preview");
	await expect(editor.root.locator(".bqa__transformation-summary")).toContainText("1 eligible · 1 skipped");
	await expect(editor.root).toContainText("Goblin #1: This monster has reached the 100-operation statblock history limit");
	expect(await editor.savedEncounter()).toEqual(before);
	await editor.apply({bulk: true, count: 1});
	await page.reload();
	await expect(page.getByRole("button", {name: "Edit statblock for Goblin #1"})).toContainText("(100)", {timeout: 30_000});
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Humanoid");
	await page.getByRole("button", {name: "Next visible monster"}).click();
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Undead");
});

test("switching an option discards a conflict winner that no longer has a matching field", async ({page}) => {
	test.setTimeout(120_000);
	const editor = new CreatureTransformationPage(page);
	await new EncounterRollPage(page).seed({count: 1});
	await editor.installHomebrew({
		_meta: {sources: [{json: "E2ECHOICE", abbreviation: "E2E", full: "Choice E2E", authors: ["E2E"], version: "1.0.0"}]},
		race: [
			{name: "Strong Kin", source: "E2ECHOICE", ability: [{str: 2}]},
			{name: "Adaptive Kin", source: "E2ECHOICE", ability: [{choose: {from: ["str", "wis"], count: 1}}]},
		],
	});
	await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
	await page.getByRole("tab", {name: "Templates"}).click();
	await editor.choose("race:strong kin|e2echoice");
	await editor.expectLivePreview();
	await editor.apply();
	const beforeSecond = await editor.savedEncounter();
	await editor.choose("race:adaptive kin|e2echoice");
	await editor.chooseOption("Ability adjustment", "choice-1");
	await editor.expectLivePreview();
	await expect(editor.root).toContainText("Choose an existing or incoming winner");
	await editor.pickIncomingWinners();
	await expect(editor.root.getByRole("button", {name: "Apply transformation"})).toBeVisible();
	await editor.chooseOption("Ability adjustment", "choice-2");
	await editor.expectLivePreview();
	await expect(editor.root.getByRole("alert")).toBeEmpty();
	await expect(editor.root.locator("select[data-conflict-path='str']")).toHaveCount(0);
	expect(await editor.savedEncounter()).toEqual(beforeSecond);
	await editor.apply();
	const saved = await editor.savedEncounter() as {instances: {statblockOperations: {data: {resolved: {selectedOptions: Record<string, string[]>}}}[]}[]};
	expect(saved.instances[0].statblockOperations).toHaveLength(2);
	expect(saved.instances[0].statblockOperations[1].data.resolved.selectedOptions).toEqual({ability: ["choice-2"]});
	await page.reload();
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Wis");
});

for (const surface of ["Bestiary", "Encounter Workspace"] as const) {
	test(`${surface} previews and applies 2014 High Elf without altering the underlying Goblin`, async ({page}) => {
		test.setTimeout(120_000);
		const editor = new CreatureTransformationPage(page);
		if (surface === "Bestiary") {
			await page.goto("/bestiary.html#goblin_mm");
			await page.locator(".bqa__btn-open:visible").first().click();
		} else {
			await new EncounterRollPage(page).seed({count: 1});
			await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
		}
		await page.getByRole("tab", {name: "Templates"}).click();
		const before = surface === "Encounter Workspace" ? await editor.savedEncounter() : null;
		await editor.choose("race:elf (high)|phb");
		await editor.expectLivePreview();
		await expect(editor.beforeStatblock).not.toContainText("Fey Ancestry");
		await expect(editor.afterStatblock).toContainText("Fey Ancestry");
		await expect(editor.afterStatblock).toContainText("Elvish");
		await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Dexterity: 14 → 16");
		await editor.selectedRecipeInfo().click();
		await expect(editor.nativeHover).toContainText("Elf Weapon Training");
		await expect(editor.nativeHover).toContainText("Set size to Medium");
		await editor.dismissNativeHover();
		if (before) expect(await editor.savedEncounter()).toEqual(before);
		else await expect(page.locator(".bqa__changes .bqa__row")).toHaveCount(0);
		await editor.apply();
		if (before) {
			const saved = await editor.savedEncounter() as {instances: {monster: {dex: number, size: string[]}, statblockOperations: unknown[]}[]};
			expect(saved.instances[0].monster).toMatchObject({dex: 14, size: ["S"]});
			expect(saved.instances[0].statblockOperations).toHaveLength(1);
			await page.reload();
			await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Fey Ancestry");
			await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Elvish");
		} else {
			await expect(page.locator(".bqa__changes")).toContainText("Transformation: Elf (High)");
		}
	});

	test(`${surface} requires a 2024 Elf tradition before preview and shows the selected spell grant`, async ({page}) => {
		test.setTimeout(120_000);
		const editor = new CreatureTransformationPage(page);
		if (surface === "Bestiary") {
			await page.goto("/bestiary.html#goblin_mm");
			await page.locator(".bqa__btn-open:visible").first().click();
		} else {
			await new EncounterRollPage(page).seed({count: 1});
			await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
		}
		await page.getByRole("tab", {name: "Templates"}).click();
		const before = surface === "Encounter Workspace" ? await editor.savedEncounter() : null;
		await editor.choose("race:elf|xphb");
		await expect(editor.root.locator(".bqa__transformation-target")).toHaveCount(0);
		await expect(editor.root.locator(".bqa__transformation-apply")).toHaveCount(0);
		await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Choose Species spell grant and ability");
		await editor.optionByName("Species spell grant and ability", "Drow (CHA)").check();
		const selectedSpellOption = await editor.optionByName("Species spell grant and ability", "Drow (CHA)").getAttribute("value");
		await editor.expectLivePreview();
		await expect(editor.afterStatblock).toContainText("Species Magic: dancing lights (will)");
		await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Spellcasting: Added");
		await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Species Magic: dancing lights (will)");
		await expect(editor.root.locator(".bqa__transformation-delta")).not.toContainText('"will":');
		await editor.optionByName("Species spell grant and ability", "Drow (CHA)").locator("..").locator("..").locator(".bqa__transformation-info").click();
		await expect(editor.nativeHover).toContainText("Grant dancing lights (xphb) from XPHB");
		await editor.dismissNativeHover();
		if (before) expect(await editor.savedEncounter()).toEqual(before);
		await editor.apply();
		if (before) {
			const saved = await editor.savedEncounter() as {instances: {monster: {spellcasting?: unknown}, statblockOperations: {data: {resolved: {selectedOptions: Record<string, string[]>, changes: {type?: string}[]}}}[]}[]};
			expect(saved.instances[0].monster.spellcasting).toBeUndefined();
			expect(saved.instances[0].statblockOperations[0].data.resolved.selectedOptions).toEqual({spells: [selectedSpellOption]});
			expect(JSON.stringify(saved.instances[0].statblockOperations[0].data.resolved.changes.filter(change => change.type === "grantSpell"))).not.toContain("faerie fire");
			await page.reload();
			await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Species Magic: dancing lights (will)");
		} else {
			await expect(page.locator(".bqa__changes")).toContainText("Transformation: Elf");
		}
	});

	test(`${surface} previews 2024 Red Dragonborn size, fire defense, and its nested breath trait`, async ({page}) => {
		test.setTimeout(120_000);
		const editor = new CreatureTransformationPage(page);
		if (surface === "Bestiary") {
			await page.goto("/bestiary.html#goblin_mm");
			await page.locator(".bqa__btn-open:visible").first().click();
		} else {
			await new EncounterRollPage(page).seed({count: 1});
			await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
		}
		await page.getByRole("tab", {name: "Templates"}).click();
		const before = surface === "Encounter Workspace" ? await editor.savedEncounter() : null;
		await editor.choose("race:dragonborn (red)|xphb~v:dragonborn|xphb:8");
		await editor.expectLivePreview();
		await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Size: Small → Medium");
		await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("fire");
		await expect(editor.beforeStatblock).not.toContainText("Breath Weapon");
		await expect(editor.afterStatblock).toContainText("Breath Weapon");
		await editor.selectedRecipeInfo().click();
		await expect(editor.nativeHover).toContainText("Breath Weapon");
		await expect(editor.nativeHover).toContainText("Set size to Medium");
		await editor.dismissNativeHover();
		if (before) expect(await editor.savedEncounter()).toEqual(before);
		await editor.apply();
		if (before) {
			const saved = await editor.savedEncounter() as {instances: {monster: {size: string[], resist?: string[]}, statblockOperations: unknown[]}[]};
			expect(saved.instances[0].monster.size).toEqual(["S"]);
			expect(saved.instances[0].monster.resist).toBeUndefined();
			expect(saved.instances[0].statblockOperations).toHaveLength(1);
			await page.reload();
			await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Breath Weapon");
			await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Res. Fire");
		} else {
			await expect(page.locator(".bqa__changes")).toContainText("Transformation: Dragonborn (Red)");
		}
	});
}

const emberKin = {
	_meta: {sources: [{json: "E2EEMB", abbreviation: "E2E", full: "Ember Kin E2E", authors: ["E2E"], version: "1.0.0"}]},
	race: [{
		name: "Ember Kin",
		source: "E2EEMB",
		size: ["S", "M"],
		ability: [{cha: 2, choose: {from: ["str", "wis"], count: 1}}],
		blindsight: 30,
		languageProficiencies: [{common: true, choose: {from: ["draconic", "primordial"], count: 1}}],
		resist: [{choose: {from: ["cold", "fire"], count: 1}}],
		additionalSpells: [{ability: {choose: ["int", "cha"]}, known: {"1": ["light#c"]}, innate: {"_": {daily: {"1": ["burning hands|phb"]}}, "3": {daily: {"1": ["fireball|phb"]}}}}],
		entries: [{type: "entries", name: "Ancient Flame", entries: ["The kin shines.", {type: "list", items: [{type: "item", name: "Glow", entry: "It sheds dim light."}]}]}],
	}],
};

for (const surface of ["Bestiary", "Encounter Workspace"] as const) {
	test(`${surface} resolves all required homebrew choices and keeps nested entries and spell uses after Apply`, async ({page}) => {
		test.setTimeout(120_000);
		const editor = new CreatureTransformationPage(page);
		if (surface === "Bestiary") await page.goto("/bestiary.html#goblin_mm");
		else await new EncounterRollPage(page).seed({count: 1});
		await editor.installHomebrew(emberKin);
		if (surface === "Bestiary") await page.locator(".bqa__btn-open:visible").first().click();
		else await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
		await page.getByRole("tab", {name: "Templates"}).click();
		const before = surface === "Encounter Workspace" ? await editor.savedEncounter() : null;
		await editor.choose("race:ember kin|e2eemb");
		await expect(editor.root.locator(".bqa__transformation-target")).toHaveCount(0);
		await expect(editor.root.locator(".bqa__transformation-apply")).toHaveCount(0);
		for (const group of ["Species size", "Ability adjustment", "Species resist", "Species language", "Species spell grant and ability"]) {
			await editor.chooseOption(group, "choice-2");
		}
		await editor.expectLivePreview();
		await expect(editor.afterStatblock).toContainText("Ancient Flame");
		await expect(editor.afterStatblock).toContainText("Glow");
		await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("fire");
		await editor.selectedRecipeInfo().click();
		await expect(editor.nativeHover).toContainText("It sheds dim light");
		await editor.dismissNativeHover();
		await editor.optionInfo("Species resist", "choice-2").click();
		await expect(editor.nativeHover).toContainText("Resistance to fire");
		await editor.dismissNativeHover();
		if (before) expect(await editor.savedEncounter()).toEqual(before);
		else await expect(page.locator(".bqa__changes .bqa__row")).toHaveCount(0);
		await editor.apply();
		if (before) {
			const saved = await editor.savedEncounter() as {instances: {monster: {resist?: string[], spellcasting?: unknown}, statblockOperations: {data: {resolved: {changes: {type: string, spell?: string, source?: string, usage?: string, entry?: {name: string, entries: unknown[]}}[]}}}[]}[]};
			expect(saved.instances[0].monster.resist).toBeUndefined();
			expect(saved.instances[0].monster.spellcasting).toBeUndefined();
			const changes = saved.instances[0].statblockOperations[0].data.resolved.changes;
			expect(changes).toEqual(expect.arrayContaining([
				expect.objectContaining({type: "grantSpell", spell: "light|phb", source: "E2EEMB", usage: "will"}),
				expect.objectContaining({type: "grantSpell", spell: "burning hands|phb", source: "E2EEMB", usage: "daily", uses: 1}),
				expect.objectContaining({type: "addEntry", entry: expect.objectContaining({name: "Ancient Flame", entries: expect.arrayContaining([expect.objectContaining({type: "list"})])})}),
			]));
			expect(JSON.stringify(changes)).not.toContain("fireball");
			await page.reload();
			await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Ancient Flame");
			await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Species Magic: burning hands (daily)");
		} else {
			await expect(page.locator(".bqa__changes")).toContainText("Transformation: Ember Kin");
		}
	});
}

test.describe("mobile touch and night mode", () => {
	test.use({hasTouch: true, viewport: {width: 390, height: 844}});
	test("recipe and option info stay reachable without horizontal scrolling", async ({page}) => {
		await page.goto("/bestiary.html#goblin_mm");
		await page.locator(".bqa__btn-open:visible").first().tap();
		await page.getByRole("tab", {name: "Templates"}).tap();
		const editor = new CreatureTransformationPage(page);
		await editor.choose("catalog:skeleton|dmg");
		await editor.expectLivePreview();
		await expect(editor.root.locator(".bqa__transformation-delta")).toContainText("Condition immunities: none → exhaustion, poisoned");
		expect((await editor.deltaLayout()).widthRatio).toBeGreaterThan(0.95);
		await editor.useNightMode();
		expect((await editor.deltaLayout()).fontSize).toBeGreaterThanOrEqual(16);
		expect(await editor.textContrast(".bqa__transformation-delta li", ".bqa__transformation-delta")).toBeGreaterThanOrEqual(4.5);
		await editor.expectLongTemplateTitleFits("catalog:skeletal wyrmling|ar8");
		await editor.recipeInfo("catalog:half-dragon|mm").tap();
		await expect(editor.nativeHover).toContainText("Dragon");
		await editor.dismissNativeHover();
		await editor.templateChoice("catalog:half-dragon|mm").tap();
		await editor.selectedRecipeInfo().tap();
		await expect(editor.nativeHover).toContainText("Mechanical effects");
		await editor.dismissNativeHover();
		await editor.optionControl("Dragon ancestry", "red").tap();
		await editor.optionControl("Breath size", "large-or-smaller").tap();
		await editor.expectLivePreview();
		await editor.optionInfo("Dragon ancestry", "red").tap();
		await expect(editor.nativeHover).toContainText("Resistance to fire");
		await editor.useNightMode();
		await expect(editor.root.locator(".bqa__transformation-delta")).toBeVisible();
		expect(await editor.textContrast(".bqa__transformation-option-name", ".bqa__transformation-option")).toBeGreaterThanOrEqual(4.5);
		expect(await editor.textContrast(".bqa__transformation-delta h5", ".bqa__transformation-delta")).toBeGreaterThanOrEqual(4.5);
	});
});
