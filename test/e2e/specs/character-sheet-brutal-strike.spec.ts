import {test} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";

test("2024 Barbarian applies two manual Brutal Strike effects and critical typed damage through Combat", async ({page}) => {
	const sheet = new CharacterSheetPage(page);
	await sheet.goto();
	await sheet.probeBrutalStrikePlayerPath("XPHB");
});

test("PHB Barbarian keeps Reckless off Unarmed Strikes in the Overview and Combat rolls", async ({page}) => {
	const sheet = new CharacterSheetPage(page);
	await sheet.goto();
	await sheet.probePhbRecklessUnarmed();
});

test("2024 Brutal Strike rejects invalid clicks and resets a noncombat turn from Play Mode", async ({page}) => {
	const sheet = new CharacterSheetPage(page);
	await sheet.goto();
	await sheet.probeBrutalStrikeOutOfCombatTurn();
});
