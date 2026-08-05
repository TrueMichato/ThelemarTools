import "./setup.js";
import {jest} from "@jest/globals";

import {classifyItem, summarize} from "../../../node/audit-character-sheet-items.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Character sheet magic-item operational coverage audit", () => {
	it("exposes the canonical schema adapter profile from production state", () => {
		const profile = CharacterSheetState.getItemSchemaEffectProfile({
			bonusAc: "+2",
			ability: {choose: [{from: ["str", "dex"], amount: 2}]},
			light: [{bright: 20, dim: 20}],
			containerCapacity: {weight: [500], weightless: true},
		});

		expect(profile.operational).toEqual(expect.arrayContaining([
			expect.objectContaining({field: "bonusAc", family: "ac", consumer: "inventory"}),
			expect.objectContaining({field: "containerCapacity", countsAsMagicEffect: false}),
			expect.objectContaining({field: "light", family: "light", consumer: "overview"}),
		]));
		expect(profile.choiceRequired).toEqual([
			expect.objectContaining({field: "ability.choose", family: "ability"}),
		]);
		expect(profile.storedOnly).toEqual([]);
	});

	it("counts a consumed structured passive as operational", () => {
		expect(classifyItem({
			name: "Protective Charm",
			source: "TST",
			bonusAc: "+1",
			entries: ["You gain a +1 bonus to AC."],
		})).toEqual(expect.objectContaining({
			status: "fullyFunctional",
			operationalStatus: "structuredOperational",
		}));
	});

	it("does not count bare charges as functionality", () => {
		expect(classifyItem({
			name: "Unbound Battery",
			source: "TST",
			charges: 3,
			entries: ["This item has 3 charges."],
		})).toEqual(expect.objectContaining({
			status: "surfacedOnly",
			operationalStatus: "resourceOnly",
		}));
	});

	it("recognizes schema-valid formula maxima without rolling during audit", () => {
		const randomise = jest.fn();
		globalThis.RollerUtil.randomise = randomise;
		expect(classifyItem({
			name: "Formula Battery",
			source: "TST",
			charges: "{@dice 1d8 + 1}",
			entries: ["This item has a variable number of charges."],
		})).toEqual(expect.objectContaining({
			status: "surfacedOnly",
			operationalStatus: "resourceOnly",
			reasons: ["charges have no operational power"],
		}));
		expect(randomise).not.toHaveBeenCalled();
		delete globalThis.RollerUtil.randomise;
	});

	it("requires a name before treating attached-spell resources as operational", () => {
		expect(classifyItem({
			name: "Unbound Focus",
			source: "TST",
			attachedSpells: {resource: {"1": ["magic missile"]}},
		})).toEqual(expect.objectContaining({
			status: "surfacedOnly",
			operationalStatus: "choiceRequired",
			reasons: ["choice required: attachedSpells.resourceName"],
		}));
	});

	it("accepts named attached-spell resources as a supported schema shape", () => {
		expect(classifyItem({
			name: "Bound Focus",
			source: "TST",
			attachedSpells: {
				resourceName: "Arcane Battery",
				resource: {"1": ["magic missile"]},
			},
		})).toEqual(expect.objectContaining({
			status: "fullyFunctional",
			operationalStatus: "structuredOperational",
		}));
	});

	it("reports unresolved choices instead of treating their metadata as functional", () => {
		expect(classifyItem({
			name: "Enspelled Test Weapon",
			source: "TST",
			spellScrollLevel: 3,
			entries: ["A level 3 spell is bound into this weapon."],
		})).toEqual(expect.objectContaining({
			status: "surfacedOnly",
			operationalStatus: "choiceRequired",
			reasons: ["choice required: spellScrollLevel"],
		}));
	});

	it("counts resolved language metadata while leaving ambiguous grants choice-required", () => {
		expect(classifyItem({
			name: "Draconic Mask",
			source: "TST",
			grantsLanguage: true,
			entries: ["You can speak and understand Draconic."],
		})).toEqual(expect.objectContaining({
			status: "fullyFunctional",
			operationalStatus: "structuredOperational",
		}));
		expect(classifyItem({
			name: "Polyglot Stone",
			source: "TST",
			grantsLanguage: true,
			entries: ["You learn one language of your choice."],
		})).toEqual(expect.objectContaining({
			status: "surfacedOnly",
			operationalStatus: "choiceRequired",
		}));
	});

	it("counts a resolved spell-level choice as operational", () => {
		expect(classifyItem({
			name: "Enspelled Test Weapon",
			source: "TST",
			charges: 6,
			spellScrollLevel: 3,
			selectedSpell: {name: "Fireball", source: "PHB", level: 3},
			entries: ["The item has 6 charges. You can expend 1 charge to cast its spell."],
		})).toEqual(expect.objectContaining({
			status: "fullyFunctional",
			operationalStatus: "structuredOperational",
		}));
	});

	it("distinguishes prose-derived operational effects", () => {
		expect(classifyItem({
			name: "Unarmored Ward",
			source: "TST",
			entries: ["You gain a +2 bonus to AC if you are wearing no armor and using no shield."],
		})).toEqual(expect.objectContaining({
			status: "fullyFunctional",
			operationalStatus: "proseOperational",
		}));
	});

	it("keeps a structured passive with an unresolved active clause partial", () => {
		expect(classifyItem({
			name: "Partly Automated Ring",
			source: "TST",
			bonusAc: "+1",
			entries: ["You gain a +1 bonus to AC. As an action, you can reshape the world."],
		})).toEqual(expect.objectContaining({
			status: "surfacedOnly",
			operationalStatus: "partiallyOperational",
			reasons: expect.arrayContaining(["unresolved active prose"]),
		}));
	});

	it("aggregates operational and legacy headline statuses independently", () => {
		const result = summarize({
			items: [
				{name: "Structured", source: "TST", bonusAc: "+1"},
				{name: "Battery", source: "TST", charges: 3, entries: ["Three charges."]},
			],
			documents: [],
		});

		expect(result.status).toEqual({fullyFunctional: 1, surfacedOnly: 1, unsupported: 0});
		expect(result.operationalStatus).toEqual({structuredOperational: 1, resourceOnly: 1});
	});
});
