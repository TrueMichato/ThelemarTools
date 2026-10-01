import {expect, test} from "@playwright/test";
import {CreatureTransformationPage} from "../pages/CreatureTransformationPage";
import {EncounterRollPage} from "../pages/EncounterRollPage";

test("Bestiary Quick Actions previews and stacks two source-qualified templates with explicit conflict winners", async ({page}) => {
	test.setTimeout(120_000);
	await page.goto("/bestiary.html#goblin_mm");
	await page.locator(".bqa__btn-open:visible").first().click();
	await page.getByRole("tab", {name: "Templates"}).click();
	await page.getByRole("tab", {name: "Templates"}).press("ArrowRight");
	await expect(page.getByRole("tab", {name: "Area Traits"})).toHaveAttribute("aria-selected", "true");
	await page.getByRole("tab", {name: "Area Traits"}).press("ArrowLeft");
	const transformations = new CreatureTransformationPage(page);
	await transformations.choose("catalog:skeleton|dmg");
	await transformations.acknowledge();
	await transformations.preview();
	await expect(transformations.root.locator(".bqa__transformation-target")).toContainText("vulnerable");
	await expect(transformations.root.locator(".bqa__transformation-review")).toContainText("Recheck hit points");
	await transformations.apply();
	await expect(page.locator(".bqa__changes")).toContainText("Transformation: Skeleton");

	await transformations.choose("catalog:zombie|dmg");
	await transformations.acknowledge();
	await transformations.preview();
	await expect(transformations.root).toContainText("Choose an existing or incoming winner");
	await transformations.pickIncomingWinners();
	await transformations.apply();
	await expect(page.locator(".bqa__changes")).toContainText("Transformation: Zombie");
	await expect(page.locator(".bqa__changes .bqa__row-title")).toHaveCount(2);
	await page.setViewportSize({width: 390, height: 844});
	await expect(page.locator(".bqa__changes")).toBeVisible();
	const tabHeight = await page.getByRole("tab", {name: "Templates"}).evaluate(node => node.getBoundingClientRect().height);
	expect(tabHeight).toBeGreaterThanOrEqual(44);
});

test("Encounter individual templates and bulk selection preview name exact skips and survive reload", async ({page}) => {
	test.setTimeout(120_000);
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
	await page.getByRole("tab", {name: "Templates"}).click();
	const transformations = new CreatureTransformationPage(page);
	await transformations.choose("catalog:skeleton|dmg");
	await transformations.acknowledge();
	await transformations.preview();
	await transformations.apply();
	await page.getByRole("button", {name: "Done"}).click();
	await expect(page.locator(".ew__statblock")).toContainText("Undead");
	await page.reload();
	await expect(page.locator(".ew__statblock")).toContainText("Undead");
	await encounter.openActions();
	await page.locator("#ew-all").click();
	await page.locator(".ew__bulk-edit > summary").click();
	await page.locator("#ew-bulk-type").selectOption("transformation");
	await transformations.choose("catalog:lycanthropy|mm");
	await transformations.chooseOption("Lycanthrope", "werebear");
	await expect(transformations.root).toContainText("Lycanthrope · Werebear:");
	await transformations.acknowledge();
	await transformations.root.getByRole("button", {name: "Preview selected monsters"}).click();
	await expect(transformations.root.locator(".bqa__transformation-target")).toHaveCount(1);
	await expect(transformations.root).toContainText("Goblin #1: Creature does not satisfy transformation eligibility");
	await expect(transformations.root).toContainText("Goblin #2");
	await transformations.apply({bulk: true, count: 1});
	await page.reload();
	await page.getByRole("button", {name: "Next visible monster"}).click();
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("19");
	await page.getByRole("button", {name: "Previous visible monster"}).click();
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Undead");
});

test("Bestiary transformation catalog failures stay visible and do not show a loaded picker", async ({page}) => {
	await page.route("**/data/creature-transformations.json", route => route.abort("failed"));
	await page.goto("/bestiary.html#goblin_mm");
	await page.locator(".bqa__btn-open:visible").first().click();
	await page.getByRole("tab", {name: "Templates"}).click();
	const transformations = new CreatureTransformationPage(page);
	await expect(transformations.root.getByRole("alert")).toContainText("Could not load creature transformations");
	await expect(transformations.root.getByRole("button", {name: "Retry catalog load"})).toBeVisible();
	await expect(transformations.root.getByRole("combobox", {name: "Creature transformation"})).toHaveCount(0);
	await expect(transformations.root.getByRole("status")).toBeEmpty();
});

test("repeated homebrew race IDs cannot block templates or hide different definitions", async ({page}) => {
	await page.goto("/bestiary.html#goblin_mm");
	const transformations = new CreatureTransformationPage(page);
	await transformations.injectRepeatedRaceDefinitions();
	await page.locator(".bqa__btn-open:visible").first().click();
	await page.getByRole("tab", {name: "Templates"}).click();
	await expect(transformations.root.getByRole("alert")).toBeEmpty();
	await transformations.chooseCategory("Species");
	await transformations.selectSource("FoEQuickstone");
	await transformations.search("gnoll");
	await expect(transformations.root.locator(".bqa__transformation-count")).toHaveText(/Showing 2 of \d+ species/);
	await expect(transformations.root.getByRole("combobox", {name: "Source book"}).locator('option[value="FoEQuickstone"]')).toContainText("FoEQuickstone");
	const picker = transformations.root.getByRole("combobox", {name: "Creature transformation"});
	await expect(picker.locator("option", {hasText: "Gnoll (FoEQuickstone)"})).toHaveCount(2);
	const variant = await picker.locator("option", {hasText: "Gnoll (FoEQuickstone)"}).first().getAttribute("value");
	expect(variant).toMatch(/^race:gnoll\|foequickstone~d:/);
	await transformations.choose(variant!);
	await expect(transformations.root).toContainText("multiple different race definitions share this name and source");
	await transformations.acknowledge();
	await transformations.preview();
	await expect(transformations.root.locator(".bqa__transformation-target")).toContainText("Goblin");
	await transformations.chooseCategory("Templates");
	await expect(transformations.root.locator(".bqa__transformation-target")).toHaveCount(0);
	await expect(transformations.root.locator(".bqa__transformation-apply")).toHaveCount(0);
	await transformations.search("");
	await transformations.choose("catalog:skeleton|dmg");
	await transformations.acknowledge();
	await transformations.preview();
	await expect(transformations.root.locator(".bqa__transformation-target")).toContainText("Undead");
});

test("Bestiary source browsing preserves visible choices but invalidates filtered previews", async ({page}) => {
	await page.goto("/bestiary.html#goblin_mm");
	await page.locator(".bqa__btn-open:visible").first().click();
	await page.getByRole("tab", {name: "Templates"}).click();
	const transformations = new CreatureTransformationPage(page);
	const root = transformations.root;
	await expect(transformations.categoryButton("Templates")).toHaveAttribute("aria-pressed", "true");
	await expect(root.getByRole("combobox", {name: "Source book"}).locator('option[value="MM"]')).toContainText(/Monster Manual \(2014\) \(MM'14 · MM\)/);
	await transformations.search("monster manual");
	await expect(root.getByRole("combobox", {name: "Creature transformation"}).locator('option[value="catalog:shadow dragon|mm"]')).toHaveCount(1);
	await expect(root.getByRole("combobox", {name: "Creature transformation"}).locator('option[value="catalog:shadow dragon|beg"]')).toHaveCount(0);
	await transformations.search("shadow dragon");
	await transformations.selectSource("BEG");
	await expect(root.getByRole("combobox", {name: "Creature transformation"}).locator('option[value="catalog:shadow dragon|beg"]')).toHaveCount(1);
	await transformations.choose("catalog:shadow dragon|beg");
	await expect(root).toContainText("Source: Shadow Dragon · BEG · 2014 edition · p. 25.");
	await transformations.selectSource("MM");
	await expect(root.getByRole("combobox", {name: "Creature transformation"})).toHaveValue("");
	await expect(root.getByRole("button", {name: "Preview transformation"})).toBeDisabled();
	await transformations.search("");
	await transformations.choose("catalog:half-dragon|mm");
	await transformations.chooseOption("Dragon ancestry", "red");
	await transformations.chooseOption("Breath size", "large-or-smaller");
	await transformations.acknowledge();
	await transformations.preview();
	await transformations.search("half-dragon");
	await expect(root.locator(".bqa__transformation-target")).toHaveCount(0);
	await expect(root.getByRole("combobox", {name: "Dragon ancestry"})).toHaveValue("red");
	await expect(root.getByRole("combobox", {name: "Breath size"})).toHaveValue("large-or-smaller");
	await transformations.preview();
	await transformations.pauseCatalogReload();
	await transformations.acknowledgeReview();
	await root.getByRole("button", {name: "Apply transformation"}).click();
	await transformations.search("no matching recipe");
	await transformations.resumeCatalogReload();
	await expect(root.getByRole("alert")).toContainText("The filters or selection changed");
	await expect(page.locator(".bqa__changes")).not.toContainText("Transformation: Half-Dragon");
	await expect(root.locator(".bqa__transformation-count")).toHaveText(/Showing 0 of \d+ templates/);
	await expect(root.locator(".bqa__transformation-empty")).toContainText("No recipes match");
	await expect(root.locator(".bqa__transformation-apply")).toHaveCount(0);
	await expect(root.getByRole("button", {name: "Preview transformation"})).toBeDisabled();
	await transformations.search("");
	await expect(root.getByRole("combobox", {name: "Creature transformation"})).toHaveValue("");
	await expect(root.getByRole("combobox", {name: "Dragon ancestry"})).toHaveCount(0);
});

const installedBrew = {
	_meta: {sources: [{json: "E2EVillage", abbreviation: "VB", full: "Village Bestiary", authors: ["E2E"]}]},
	race: [{name: "Lantern Kin", source: "E2EVillage", page: 7, resist: ["fire"]}],
};

for (const surface of ["Bestiary", "Encounter Workspace"] as const) {
	test(`${surface} discovers installed homebrew by book name, abbreviation, and code on mobile`, async ({page}) => {
		test.setTimeout(120_000);
		const transformations = new CreatureTransformationPage(page);
		if (surface === "Bestiary") await page.goto("/bestiary.html#goblin_mm");
		else {
			const encounter = new EncounterRollPage(page);
			await encounter.seed();
		}
		await transformations.installHomebrew(installedBrew);
		await page.setViewportSize({width: 390, height: 844});
		if (surface === "Bestiary") await page.locator(".bqa__btn-open:visible").first().click();
		else await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
		await page.getByRole("tab", {name: "Templates"}).click();
		const root = transformations.root;
		await transformations.expectReadableDiscoveryLabels();
		const species = transformations.categoryButton("Species");
		await species.focus();
		await page.keyboard.press("Enter");
		await expect(species).toHaveAttribute("aria-pressed", "true");
		await expect(root.getByRole("combobox", {name: "Source book"}).locator('option[value="E2EVillage"]')).toContainText("Village Bestiary (VB · E2EVillage)");
		await transformations.selectSource("E2EVillage");
		for (const query of ["Village Bestiary", "VB", "E2EVillage"]) {
			await transformations.search(query);
			await expect(root.locator(".bqa__transformation-count")).toHaveText(/Showing 1 of \d+ species/);
			await expect(root.getByRole("combobox", {name: "Creature transformation"}).locator('option[value="race:lantern kin|e2evillage"]')).toHaveCount(1);
		}
		await transformations.choose("race:lantern kin|e2evillage");
		await expect(root).toContainText("Source: Lantern Kin · Village Bestiary (VB · E2EVillage) · Edition unverified · p. 7");
		await transformations.acknowledge();
		await transformations.preview();
		await expect(root.locator(".bqa__transformation-target")).toHaveCount(1);
		const dayColors = await transformations.categoryColors("Species");
		await transformations.useNightMode();
		await expect(root.locator(".bqa__transformation-target")).toBeVisible();
		for (const button of [transformations.categoryButton("Templates"), species]) {
			const bounds = await button.boundingBox();
			expect(bounds?.height).toBeGreaterThanOrEqual(44);
		}
		const nightColors = await transformations.categoryColors("Species");
		expect(nightColors.background).not.toBe(dayColors.background);
		expect(nightColors.foreground).not.toBe(dayColors.foreground);
		await transformations.expectReadableDiscoveryLabels();
		await transformations.categoryButton("Templates").focus();
		await page.keyboard.press("Space");
		await expect(root.locator(".bqa__transformation-apply")).toHaveCount(0);
		await expect(root.getByRole("combobox", {name: "Creature transformation"})).toHaveValue("");
	});
}

test("Encounter Workspace keeps duplicate species variants separate and cannot apply one after switching filters", async ({page}) => {
	test.setTimeout(120_000);
	const encounter = new EncounterRollPage(page);
	await encounter.seed();
	const transformations = new CreatureTransformationPage(page);
	await transformations.injectRepeatedRaceDefinitions();
	await page.getByRole("button", {name: "Edit statblock for Goblin #1"}).click();
	await page.getByRole("tab", {name: "Templates"}).click();
	await transformations.chooseCategory("Species");
	await transformations.selectSource("FoEQuickstone");
	const picker = transformations.root.getByRole("combobox", {name: "Creature transformation"});
	await expect(picker.locator("option", {hasText: "Gnoll (FoEQuickstone)"})).toHaveCount(2);
	const ids = await picker.locator("option", {hasText: "Gnoll (FoEQuickstone)"}).evaluateAll(options => options.map(it => (it as HTMLOptionElement).value));
	expect(new Set(ids).size).toBe(2);
	await transformations.choose(ids[1]);
	await transformations.acknowledge();
	await transformations.preview();
	await transformations.selectSource("");
	await expect(picker).toHaveValue(ids[1]);
	await expect(transformations.root.locator(".bqa__transformation-target")).toHaveCount(0);
	await transformations.chooseCategory("Templates");
	await expect(picker).toHaveValue("");
	await expect(transformations.root.locator(".bqa__transformation-apply")).toHaveCount(0);
	await transformations.choose("catalog:skeleton|dmg");
	await transformations.acknowledge();
	await transformations.preview();
	await expect(transformations.root.locator(".bqa__transformation-target")).toContainText("Undead");
});

test("Encounter bulk transformation names a capped target and saves only the other eligible monster", async ({page}) => {
	test.setTimeout(120_000);
	const encounter = new EncounterRollPage(page);
	await encounter.seed({capFirstHistory: true});
	await encounter.openActions();
	await page.locator("#ew-all").click();
	await page.locator(".ew__bulk-edit > summary").click();
	await page.locator("#ew-bulk-type").selectOption("transformation");
	const transformations = new CreatureTransformationPage(page);
	await transformations.choose("catalog:skeleton|dmg");
	await transformations.acknowledge();
	await transformations.root.getByRole("button", {name: "Preview selected monsters"}).click();
	await expect(transformations.root.locator(".bqa__transformation-summary")).toContainText("1 eligible · 1 skipped");
	await expect(transformations.root).toContainText("Goblin #1: This monster has reached the 100-operation statblock history limit");
	await expect(transformations.root.locator(".bqa__transformation-target")).toHaveCount(1);
	await expect(transformations.root.locator(".bqa__transformation-target")).toContainText("Goblin #2");
	await transformations.apply({bulk: true, count: 1});
	await page.reload();
	await expect(page.getByRole("button", {name: "Edit statblock for Goblin #1"})).toContainText("(100)");
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Humanoid");
	await page.getByRole("button", {name: "Next visible monster"}).click();
	await expect(page.locator(".ew__statblock .ve-stats")).toContainText("Undead");
});
