import {BestiaryQuickActionsStructuredEditor} from "../../../js/bestiary/bestiary-quick-actions-structured.js";
import {BestiaryQuickActionsUi} from "../../../js/bestiary/bestiary-quick-actions-ui.js";

describe("Bestiary Quick Actions structured editor", () => {
	it("round-trips common spellcasting rows without discarding unknown fields", () => {
		const trait = {
			name: "Innate Spellcasting",
			ability: "cha",
			customMetadata: {source: "kept"},
			will: ["{@spell detect magic}"],
			daily: {
				"1e": ["{@spell dimension door}"],
			},
			spells: {
				"3": {
					lower: 1,
					slots: 2,
					spells: ["{@spell fireball}"],
				},
			},
		};

		const rows = BestiaryQuickActionsStructuredEditor.getSpellRows(trait);
		const out = BestiaryQuickActionsStructuredEditor.applySpellRows({trait, rows});

		expect(out).toEqual(trait);
		expect(out.customMetadata).toEqual({source: "kept"});
	});

	it("validates duplicate spell groups and malformed frequency keys", () => {
		expect(() => BestiaryQuickActionsStructuredEditor.validateSpellRows({
			traitName: "Spellcasting",
			rows: [
				{type: "will", spells: ["{@spell light}"]},
				{type: "will", spells: ["{@spell mage hand}"]},
			],
		})).toThrow(/Only one at will row/i);
		expect(() => BestiaryQuickActionsStructuredEditor.validateSpellRows({
			traitName: "Spellcasting",
			rows: [{type: "daily", key: "once", spells: ["{@spell shield}"]}],
		})).toThrow(/count such as/i);
		expect(() => BestiaryQuickActionsStructuredEditor.validateSpellRows({
			traitName: "Spellcasting",
			rows: [{type: "spells", level: "", spells: ["{@spell shield}"]}],
		})).toThrow(/Spell level is required/i);
	});

	it("normalizes legendary action costs without changing the base name", () => {
		expect(BestiaryQuickActionsStructuredEditor.getLegendaryActionCost("Wing Attack (Costs 2 Actions)")).toBe(2);
		expect(BestiaryQuickActionsStructuredEditor.getLegendaryActionBaseName("Wing Attack (Costs 2 Actions)")).toBe("Wing Attack");
		expect(BestiaryQuickActionsStructuredEditor.getLegendaryActionName({name: "Wing Attack", cost: 3})).toBe("Wing Attack (Costs 3 Actions)");
		expect(BestiaryQuickActionsStructuredEditor.getLegendaryActionName({name: "Detect", cost: 1})).toBe("Detect");
	});

	it("parses Advanced JSON atomically and rejects invalid entry shapes", () => {
		expect(BestiaryQuickActionsStructuredEditor.parseEntryArrays({
			trait: `[{"name":"Keen Senses","entries":["Text"]}]`,
			action: "[]",
		})).toEqual({
			trait: [{name: "Keen Senses", entries: ["Text"]}],
			action: [],
		});
		expect(() => BestiaryQuickActionsStructuredEditor.parseEntryArrays({legendary: "{"})).toThrow(/invalid JSON/i);
		expect(() => BestiaryQuickActionsStructuredEditor.parseEntryArrays({mythic: "{}"})).toThrow(/must be a JSON array/i);
	});

	it("preserves untouched structured AC, speed, and skill values", () => {
		const current = {
			ac: [{special: "11 + the spell's level"}],
			hp: {special: "40 + 10 for each spell level above 4th"},
			speed: {
				walk: {number: 30, condition: "in humanoid form"},
				fly: {number: 60, condition: "while transformed"},
			},
			str: 10,
			dex: 12,
			con: 14,
			int: 16,
			wis: 18,
			cha: 20,
			save: {wis: "+7"},
			skill: {
				perception: "+7",
				other: [{oneOf: {arcana: "+6", history: "+6"}}],
			},
			passive: 17,
		};
		const getField = (value, label) => ({value: `${value}`, dataset: {label}});
		const fields = {
			ac: getField("", "Armor Class"),
			hpAverage: getField(current.hp.special, "Hit Points"),
			hpFormula: getField("", "Hit Dice formula"),
			walk: getField("30", "Walk speed"),
			fly: getField("60", "Fly speed"),
			cr: getField("", "Challenge Rating"),
			str: getField("10", "Strength"),
			dex: getField("12", "Dexterity"),
			con: getField("14", "Constitution"),
			int: getField("16", "Intelligence"),
			wis: getField("18", "Wisdom"),
			cha: getField("20", "Charisma"),
			save: getField(BestiaryQuickActionsUi._getKeyValueText(current.save), "Saving throws"),
			skill: getField(BestiaryQuickActionsUi._getKeyValueText(current.skill), "Skills"),
			vulnerable: getField("", "Damage vulnerabilities"),
			resist: getField("", "Damage resistances"),
			immune: getField("", "Damage immunities"),
			conditionImmune: getField("", "Condition immunities"),
			senses: getField("", "Senses"),
			passive: getField("17", "Passive Perception"),
			languages: getField("", "Languages"),
		};
		const complexValues = {
			trait: [],
			action: [],
			bonus: [],
			reaction: [],
			legendary: [],
			mythic: [],
			spellcasting: [],
			legendaryHeader: [],
			mythicHeader: [],
			isNamedCreature: false,
		};

		expect(BestiaryQuickActionsUi._getQuickEditPatch({current, fields, complexValues})).toEqual({set: {}, remove: []});
	});
});
