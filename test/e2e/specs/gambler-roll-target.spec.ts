import {expect, test} from "@playwright/test";
import {AbilityScoreBreakdownPage} from "../pages/AbilityScoreBreakdownPage";
import {createCharacterViaWizard, PRESET_FULL_GAMBLER_CLAIRNIAN} from "../utils/characterBuilder";
import {clearCharacterStorage} from "../utils/characterStorage";

for (const activation of ["click", "Enter", "Space"] as const) {
	test(`Gambler ability-check ${activation} rolls without activating the score disclosure`, async ({page}, testInfo) => {
		test.setTimeout(120_000);
		await clearCharacterStorage(page);
		const {charSheet} = await createCharacterViaWizard(page, PRESET_FULL_GAMBLER_CLAIRNIAN);
		const disclosure = new AbilityScoreBreakdownPage(page);
		await charSheet.switchToTab(charSheet.tabOverview);
		await disclosure.startRollSpy();
		const before = await disclosure.evidence("str");
		await disclosure.inspect("compact", "str", "keyboard");
		await disclosure.close("compact", "str");
		expect(await disclosure.rollCount()).toBe(0);
		expect((await disclosure.evidence("str")).json).toEqual(before.json);
		expect(await charSheet.rollGamblerAbilityCheckViaUi(activation)).toBe(true);
		const rolls = await disclosure.rollCount();
		await testInfo.attach("actual-ability-check-handler-count", {
			body: JSON.stringify({activation, rolls}), contentType: "application/json",
		});
		expect(rolls).toBe(1);
		await expect(disclosure.score("compact", "str")).toHaveAttribute("aria-expanded", "false");
	});
}
