import {expect, test} from "@playwright/test";
import {CharacterImportPage} from "../pages/CharacterImportPage";

for (const posture of [
	{name: "portrait", width: 390, height: 844, mobile: true},
	{name: "landscape", width: 844, height: 320, mobile: true},
	{name: "desktop", width: 1280, height: 900, mobile: false},
]) {
	for (const night of [false, true]) {
		test.describe(`${posture.name} ${night ? "night" : "day"}`, () => {
			test.use({viewport: {width: posture.width, height: posture.height}, hasTouch: posture.mobile, isMobile: posture.mobile});

			test("real upload keeps confirmation reachable before click, after textarea focus, and persists after reload", async ({page}) => {
				test.setTimeout(120000);
				const importer = new CharacterImportPage(page);
				await importer.goto();
				const fixture = await importer.fixture();
				expect(Buffer.byteLength(fixture.text)).toBeGreaterThan(400000);
				await importer.theme(night);
				await importer.open();
				await importer.upload(fixture.text);
				await importer.expectActionsReachable("after real upload, before scroll or click");
				await importer.focusTextarea();
				await importer.expectActionsReachable("after textarea focus and internal scrolling");
				await page.screenshot({path: test.info().outputPath("focused-import.png")});
				await importer.confirmImport();
				await importer.expectPersisted(fixture);
			});
		});
	}
}

test.describe("import controls", () => {
	test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});

	test("paste and replacement preserve the intended ID and survive reload", async ({page}) => {
		test.setTimeout(120000);
		const importer = new CharacterImportPage(page);
		await importer.goto();
		const fixture = await importer.fixture();
		await importer.open();
		await importer.paste(fixture.text);
		await importer.replaceCurrent();
		await importer.confirmImport();
		await importer.expectPersisted(fixture, {replace: true});
	});

	test("Escape, focus restoration, Cancel, and reopen preserve the original character", async ({page}) => {
		test.setTimeout(120000);
		const importer = new CharacterImportPage(page);
		await importer.goto();
		const fixture = await importer.fixture();
		await importer.open();
		await importer.upload(fixture.text);
		await importer.expectFocusAndCancel(fixture);
	});

	test("empty and malformed imports retain the draft without changing persistence", async ({page}) => {
		test.setTimeout(120000);
		const importer = new CharacterImportPage(page);
		await importer.goto();
		const fixture = await importer.fixture();
		await importer.open();
		await importer.confirmImport();
		await expect(page.getByText("Please provide character data to import.", {exact: true})).toBeVisible();
		await importer.expectOriginal(fixture);
		await importer.textarea.fill("{broken");
		await importer.confirmImport();
		await expect(page.getByText("Failed to import: Invalid JSON data.", {exact: true})).toBeVisible();
		await expect(importer.textarea).toHaveValue("{broken");
		await importer.expectOriginal(fixture);
		await importer.cancel.click();
	});

	test("failed final persistence keeps the file draft and retries without a duplicate", async ({page}) => {
		test.setTimeout(120000);
		const importer = new CharacterImportPage(page);
		await importer.goto();
		const fixture = await importer.fixture();
		await importer.open();
		await importer.upload(fixture.text);
		await importer.failFinalSaveOnce(fixture.name);
		await importer.confirmImport();
		await importer.expectFailureDraft(fixture.text);
		const admitted = await importer.roster();
		expect(admitted).toHaveLength(fixture.roster.length + 1);
		await importer.confirmImport();
		await importer.expectPersisted(fixture);
		expect((await importer.roster()).map(record => record.id)).toEqual(admitted.map(record => record.id));
	});

	test("the existing JSON Export dialog is not given import layout or a new footer", async ({page}) => {
		test.setTimeout(120000);
		const importer = new CharacterImportPage(page);
		await importer.goto();
		await importer.fixture();
		await importer.open();
		await importer.cancel.click();
		await importer.expectExportUnaffected();
	});
});
