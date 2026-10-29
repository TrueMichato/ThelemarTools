import {test} from "@playwright/test";
import {NpcExportPage} from "../pages/NpcExportPage";

test("NPC export preserves mechanics, preferences, manual CR, files, real brew save, and live State", async ({page}) => {
	test.setTimeout(180_000);
	await new NpcExportPage(page).verifyWorkflow();
});
