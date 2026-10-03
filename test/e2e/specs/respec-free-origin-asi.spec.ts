import {expect, test} from "@playwright/test";
import {clearCharacterStorage} from "../utils/characterStorage";
import {createCharacterViaWizard, PRESET_FIGHTER} from "../utils/characterBuilder";
import {gotoWithThelemar} from "../utils/homebrewLoader";

test("Builder free mixed-origin ASI is editable in Respec and survives Apply and reload", async ({page}) => {
	test.setTimeout(150_000);
	await clearCharacterStorage(page);
	await gotoWithThelemar(page);
	const {charSheet} = await createCharacterViaWizard(page, {
		...PRESET_FIGHTER,
		name: "Mixed Origin Respec",
		race: "Dwarf",
		raceSource: "PHB'24",
		background: "Outlander",
		bgSource: "PHB",
		prioritySources: ["TGTT", "XPHB", "PHB"],
		selectBackgroundAbilityBonuses: true,
	});
	await charSheet.reloadCharacterSheet();
	await charSheet.openRespec();
	const original = await charSheet.getFreeOriginAbilityEvidence();
	expect(original.live).toMatchObject({
		race: "Dwarf|XPHB",
		background: "Outlander|PHB",
		choices: {bg_0: "dex", bg_0_weight: 2, bg_1: "con", bg_1_weight: 1},
		bonuses: {dex: 2, con: 1},
	});
	expect(original.draft).toEqual(original.live);
	expect(original.decisions).toEqual([
		expect.objectContaining({type: "nestedConfiguration", status: "resolved", ownerUid: "dwarf|xphb"}),
		expect.objectContaining({type: "nestedAbility", status: "resolved", selection: "dex", ownerUid: "dwarf|xphb"}),
		expect.objectContaining({type: "nestedAbility", status: "resolved", selection: "con", ownerUid: "dwarf|xphb"}),
	]);
	expect(original.errors, JSON.stringify(original)).toEqual([
		expect.objectContaining({code: "decision-missing", message: "toolProficiencies is missing."}),
		expect.objectContaining({code: "decision-missing", message: "languageProficiencies is missing."}),
	]);

	await charSheet.openRespecBackgroundEditor();
	await charSheet.selectRespecBackgroundAndAbilities("Outlander", "PHB", ["str", "wis"]);
	const staged = await charSheet.getFreeOriginAbilityEvidence();
	expect(staged.live).toEqual(original.live);
	expect(staged.draft).toMatchObject({
		race: "Dwarf|XPHB",
		background: "Outlander|PHB",
		choices: {bg_0: "str", bg_0_weight: 2, bg_1: "wis", bg_1_weight: 1},
		bonuses: {str: 2, wis: 1, dex: 0, con: 0},
	});
	expect(staged.decisions.slice(1).map(decision => decision.effects)).toEqual([
		[expect.objectContaining({type: "abilityBonusDelta", ability: "str", amount: 2})],
		[expect.objectContaining({type: "abilityBonusDelta", ability: "wis", amount: 1})],
	]);
	expect(staged.errors).toEqual([]);
	await charSheet.cancelRespecDraft();
	await charSheet.openRespec();
	const canceled = await charSheet.getFreeOriginAbilityEvidence();
	expect(canceled.live).toEqual(original.live);
	expect(canceled.draft).toEqual(original.live);
	await charSheet.openRespecBackgroundEditor();
	await charSheet.selectRespecBackgroundAndAbilities("Outlander", "PHB", ["str", "wis"]);
	expect((await charSheet.getFreeOriginAbilityEvidence()).draft).toEqual(staged.draft);
	await charSheet.applyRespecDraft();
	await charSheet.reloadCharacterSheet();
	await charSheet.openRespec();
	const saved = await charSheet.getFreeOriginAbilityEvidence();
	expect(saved.live).toEqual(staged.draft);
	expect(saved.draft).toEqual(staged.draft);
	expect(saved.decisions.slice(1).map(decision => decision.selection)).toEqual(["str", "wis"]);
	expect(saved.errors).toEqual([]);
});
