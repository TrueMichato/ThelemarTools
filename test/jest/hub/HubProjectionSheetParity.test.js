import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {buildCharacterViewModel} from "../../../server/src/character-projection.js";

/**
 * The peer profile and the Party Tracker row must agree with the sheet the player reads.
 * These fixtures drive the real `CharacterSheetState`, so the projection is checked
 * against the authority rather than against a restatement of it.
 */
const CharacterSheetState = globalThis.CharacterSheetState;

function getSheet (overrides) {
	const state = new CharacterSheetState();
	const {customModifiers, itemBonuses, ...rest} = overrides;
	// Merge rather than replace: the sheet assumes its default sub-objects exist.
	Object.assign(state._data, rest);
	if (customModifiers) {
		for (const [key, value] of Object.entries(customModifiers)) {
			state._data.customModifiers[key] = {...(state._data.customModifiers[key] || {}), ...value};
		}
	}
	if (itemBonuses) Object.assign(state._data.itemBonuses, itemBonuses);
	return state;
}

describe("projection versus Character Sheet parity", () => {
	const cases = [
		["blanket + per-ability item save bonus", {
			abilities: {str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10},
			classes: [{name: "Rogue", level: 5}],
			saveProficiencies: ["dex"],
			itemBonuses: {savingThrow: 1, savingThrowDex: 2},
		}],
		["legacy saves key with seeded savingThrow zero", {
			abilities: {str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10},
			classes: [{name: "Fighter", level: 4}],
			saveProficiencies: ["str"],
			itemBonuses: {savingThrow: 0, saves: 3},
		}],
		["aura of protection", {
			abilities: {str: 10, dex: 10, con: 12, int: 10, wis: 10, cha: 18},
			classes: [{name: "Paladin", level: 6}],
			saveProficiencies: ["wis"],
		}],
		["item ability check bonuses", {
			abilities: {str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10},
			classes: [{name: "Rogue", level: 5}],
			skillProficiencies: {stealth: 1},
			itemBonuses: {abilityCheck: 1, abilityCheckDex: 2},
		}],
		["custom ability checks", {
			abilities: {str: 10, dex: 12, con: 12, int: 14, wis: 10, cha: 10},
			classes: [{name: "Wizard", level: 5}],
			skillProficiencies: {arcana: 1},
			customModifiers: {abilityChecks: {int: 2}, skills: {arcana: 1, _all: 1}},
		}],
		["jack of all trades", {
			abilities: {str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 14},
			classes: [{name: "Bard", level: 5}],
			skillProficiencies: {persuasion: 1},
			features: [{name: "Jack of All Trades"}],
		}],
	];

	for (const [name, data] of cases) {
		it(`matches CharacterSheetState for ${name}`, () => {
			const sheet = getSheet(data);
			const projected = buildCharacterViewModel(sheet._data);
			for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
				expect({name, ability, value: projected.saves[ability].modifier})
					.toEqual({name, ability, value: sheet.getSaveMod(ability)});
			}
			for (const skill of ["stealth", "arcana", "persuasion", "athletics", "perception"]) {
				expect({name, skill, value: projected.skills[skill].modifier})
					.toEqual({name, skill, value: sheet.getSkillMod(skill)});
			}
		});
	}

	it("excludes only transient contributions, and does so deliberately", () => {
		const sheet = getSheet({
			abilities: {str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10},
			classes: [{name: "Fighter", level: 5}],
			saveProficiencies: ["con"],
		});
		const baseline = buildCharacterViewModel(sheet._data);

		// Active states, stances and ability substitutions are what the character is doing
		// right now, not what the character is. A projection that folded them in would
		// change without any document revision and could not be cached against one.
		const withTransient = buildCharacterViewModel({
			...sheet._data,
			activeStates: {rage: true, bless: true},
			stateBonuses: {savingThrows: {con: 5}, skills: {athletics: 5}},
			combatStance: {name: "Defensive", saveBonus: 3},
		});
		expect(withTransient.saves).toEqual(baseline.saves);
		expect(withTransient.skills).toEqual(baseline.skills);
	});
});
