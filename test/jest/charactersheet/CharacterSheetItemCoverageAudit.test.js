import "./setup.js";

import {classifyItem, summarize} from "../../../node/audit-character-sheet-items.js";

describe("Character sheet magic-item operational coverage audit", () => {
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
