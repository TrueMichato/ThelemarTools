import fs from "node:fs";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {buildCharacterViewModel} from "../../../server/src/character-projection.js";
import {getDerivedStats} from "../../../server/src/character-derived-stats.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SKILLS = ["stealth", "arcana", "athletics", "perception", "persuasion", "linguistics"];

/**
 * Build the stored document and the sheet a player would see after loading it.
 *
 * The comparison deliberately uses a *reloaded* sheet. `toJson()` → `loadFromJson()` is
 * exactly the round-trip a cloud character makes, and some `customModifiers` are derived
 * on load rather than persisted, so comparing against the pre-save in-memory sheet would
 * assert against a state no reader ever sees.
 */
function getFixture (mutate) {
	const authored = new CharacterSheetState();
	mutate(authored._data);
	const document = JSON.parse(JSON.stringify(authored.toJson()));
	const reloaded = new CharacterSheetState();
	reloaded.loadFromJson(JSON.parse(JSON.stringify(document)));
	return {document, sheet: reloaded};
}

/**
 * Derived statistics come from a real `CharacterSheetState`, so these fixtures assert the
 * projection cannot drift from the sheet. Three earlier review rounds each found a
 * different term missing from a hand-written port — proficiency-bonus items, Blood Hunter
 * Dark Augmentation, TGTT Linguistics, dynamic feature modifiers — which is why the port
 * was replaced by the authority itself.
 */
describe("projection versus Character Sheet parity", () => {
	const cases = {
		"proficiency bonus from a magic item": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10},
				classes: [{name: "Rogue", level: 5}],
				saveProficiencies: ["dex"],
				skillProficiencies: {stealth: 1},
			});
			data.itemBonuses.proficiencyBonus = 1;
		},
		"blood hunter dark augmentation": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 16, con: 12, int: 16, wis: 10, cha: 10},
				classes: [{name: "Blood Hunter", level: 10}],
				saveProficiencies: ["dex"],
			});
		},
		"tgtt linguistics languages": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10},
				classes: [{name: "Bard", level: 4}],
				languages: ["Common", "Elvish", "Dwarvish", "Orcish"],
			});
			data.settings.enableTgtt = true;
			data.settings.thelemar_linguisticsBonus = true;
		},
		"paladin aura of protection": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 10, con: 12, int: 10, wis: 10, cha: 18},
				classes: [{name: "Paladin", level: 6}],
				saveProficiencies: ["wis"],
			});
		},
		"jack of all trades": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 14},
				classes: [{name: "Bard", level: 5}],
				skillProficiencies: {persuasion: 1},
				features: [{name: "Jack of All Trades"}],
			});
		},
		"expertise and blanket item check bonus": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 18, con: 12, int: 10, wis: 10, cha: 10},
				classes: [{name: "Rogue", level: 7}],
				skillProficiencies: {stealth: 2, perception: 1},
			});
			data.itemBonuses.abilityCheck = 1;
			data.itemBonuses.abilityCheckDex = 2;
		},
		"blanket and per-ability save items": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10},
				classes: [{name: "Rogue", level: 5}],
				saveProficiencies: ["dex"],
			});
			data.itemBonuses.savingThrow = 1;
			data.itemBonuses.savingThrowDex = 2;
		},
		"legacy saves key beside a zeroed savingThrow": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10},
				classes: [{name: "Fighter", level: 4}],
				saveProficiencies: ["str"],
			});
			data.itemBonuses.savingThrow = 0;
			data.itemBonuses.saves = 3;
		},
		"custom ability check and skill modifiers": data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 12, con: 12, int: 14, wis: 10, cha: 10},
				classes: [{name: "Wizard", level: 5}],
				skillProficiencies: {arcana: 1},
			});
			Object.assign(data.customModifiers.abilityChecks, {int: 2});
			Object.assign(data.customModifiers.skills, {arcana: 1, _all: 1});
		},
	};

	for (const [name, mutate] of Object.entries(cases)) {
		it(`matches the Character Sheet for ${name}`, () => {
			const {document, sheet} = getFixture(mutate);
			const projected = buildCharacterViewModel(document);

			for (const ability of ABILITIES) {
				expect({name, ability, modifier: projected.saves[ability]?.modifier})
					.toEqual({name, ability, modifier: sheet.getSaveMod(ability)});
				expect({name, ability, score: projected.abilities[ability]})
					.toEqual({name, ability, score: sheet.getAbilityScore(ability)});
			}
			for (const skill of SKILLS) {
				expect({name, skill, modifier: projected.skills[skill]?.modifier})
					.toEqual({name, skill, modifier: sheet.getSkillMod(skill)});
			}
			expect({name, ac: projected.ac.value}).toEqual({name, ac: sheet.getAC()});
		});
	}

	it("omits derived fields rather than guessing when the sheet cannot read a document", () => {
		// Numbers the projection cannot stand behind are worse than absent ones: a wrong
		// modifier would silently disagree with the sheet the owner reads.
		expect(getDerivedStats({characterData: null, abilityKeys: ABILITIES, skillKeys: SKILLS})).toBeNull();
		expect(getDerivedStats({characterData: "nope", abilityKeys: ABILITIES, skillKeys: SKILLS})).toBeNull();

		const projected = buildCharacterViewModel({name: "Broken", classes: "not-an-array"});
		expect(projected.saves).toEqual({});
		expect(projected.skills).toEqual({});
		expect(projected.identity.name).toBe("Broken");
	});

	it("ships every module the derivation needs into the server image", () => {
		const dockerfile = fs.readFileSync(new URL("../../../server/Dockerfile", import.meta.url), "utf8");
		const ignore = fs.readFileSync(new URL("../../../server/Dockerfile.dockerignore", import.meta.url), "utf8");

		// Reusing the sheet couples the server image to these files. Omitting one does not
		// fail a unit test — it fails container startup, which is a far worse place to
		// find out.
		for (const module of [
			"js/parser.js",
			"js/utils.js",
			"js/charactersheet/charactersheet-state.js",
			"js/charactersheet/charactersheet-class-utils.js",
		]) {
			expect({module, copied: dockerfile.includes(module)}).toEqual({module, copied: true});
			expect({module, allowed: ignore.includes(`!${module}`)}).toEqual({module, allowed: true});
		}
	});

	it("excludes only transient contributions, and does so deliberately", () => {
		const {document} = getFixture(data => {
			Object.assign(data, {
				abilities: {str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10},
				classes: [{name: "Fighter", level: 5}],
				saveProficiencies: ["con"],
			});
		});
		const baseline = buildCharacterViewModel(document);
		const withTransient = buildCharacterViewModel({
			...document,
			activeStates: [{type: "rage"}, {type: "bless"}],
		});

		// Projected statistics are the character's baseline, not whatever is toggled on in
		// this moment. See docs/hub/data-lifecycle.md for the reconciliation.
		expect(withTransient.saves).toEqual(baseline.saves);
		expect(withTransient.skills).toEqual(baseline.skills);
	});
});
