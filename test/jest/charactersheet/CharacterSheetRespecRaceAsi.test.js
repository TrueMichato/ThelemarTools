/**
 * Bug 10 regression — Respec ASI display must reflect the user's chosen
 * racial ASI when Tasha's optional rules are in effect (not the race
 * defaults), and must combine race defaults + Variant-style picked
 * choices when standard rules are in effect.
 */
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetRespec = globalThis.CharacterSheetRespec;

describe("CharacterSheetRespec race ASI rendering (Bug 10)", () => {
	function makeRespec ({race = null, background = null} = {}) {
		const respec = Object.create(CharacterSheetRespec.prototype);
		respec._state = {
			getRace: () => race,
			getSubrace: () => null,
			getRaceName: () => race?.name || null,
			getBackground: () => background,
			getBackgroundName: () => background?.name || null,
		};
		return respec;
	}

	const dragonborn = {
		name: "Dragonborn",
		source: "PHB",
		ability: [{str: 2, cha: 1}],
	};
	const variantHuman = {
		name: "Variant Human",
		source: "PHB",
		ability: [{choose: {from: ["str", "dex", "con", "int", "wis", "cha"], count: 2}}],
	};

	test("standard rules — race ability defaults rendered", () => {
		const respec = makeRespec({race: dragonborn});
		const out = respec._renderRaceBackgroundGrants({choices: {raceUserChoices: {}}});
		expect(out).not.toBeNull();
		const html = out.outerHTML;
		expect(html).toContain("ASI:");
		expect(html).toContain("Strength +2");
		expect(html).toContain("Charisma +1");
		expect(html).not.toContain("Tasha");
	});

	test("standard rules — user-chosen ability picks combined with race defaults", () => {
		const respec = makeRespec({race: variantHuman});
		const out = respec._renderRaceBackgroundGrants({choices: {raceUserChoices: {
			selectedAbilityChoices: {
				choice_0: "str",
				choice_0_weight: 1,
				choice_1: "dex",
				choice_1_weight: 1,
			},
		}}});
		const html = out.outerHTML;
		expect(html).toContain("ASI:");
		expect(html).toContain("Strength +1");
		expect(html).toContain("Dexterity +1");
	});

	test("Tasha's rules — race defaults are HIDDEN, Tasha's distribution rendered", () => {
		const respec = makeRespec({race: dragonborn});
		const out = respec._renderRaceBackgroundGrants({choices: {raceUserChoices: {
			useTashasRules: true,
			tashasAbilityBonuses: {
				tasha_0: "dex",
				tasha_0_amount: 2,
				tasha_1: "int",
				tasha_1_amount: 1,
			},
		}}});
		const html = out.outerHTML;
		expect(html).toContain("ASI (Tasha's):");
		expect(html).toContain("Dexterity +2");
		expect(html).toContain("Intelligence +1");
		// Race defaults must NOT leak through.
		expect(html).not.toContain("Strength +2");
		expect(html).not.toContain("Charisma +1");
	});

	test("Tasha's rules — duplicate ability picks are summed", () => {
		const respec = makeRespec({race: dragonborn});
		const out = respec._renderRaceBackgroundGrants({choices: {raceUserChoices: {
			useTashasRules: true,
			tashasAbilityBonuses: {
				tasha_0: "con",
				tasha_0_amount: 2,
				tasha_1: "con",
				tasha_1_amount: 1,
			},
		}}});
		const html = out.outerHTML;
		expect(html).toContain("Constitution +3");
	});

	test("no ability bonuses at all — ASI line is omitted", () => {
		const respec = makeRespec({race: {name: "Bland", source: "PHB"}});
		const out = respec._renderRaceBackgroundGrants({choices: {raceUserChoices: {}}});
		const html = out.outerHTML;
		expect(html).not.toContain("ASI:");
	});
});
