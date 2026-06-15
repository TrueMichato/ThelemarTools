/**
 * R19 #10 — TGTT Illrigger Specialty per-option mechanical EFFECTS.
 *
 * Round 18 shipped the L3–19 "Specialties" picker pool (selection). This suite
 * covers the per-specialty MECHANICAL EFFECTS added in R19: each of the 17
 * Illrigger specialties either changes the sheet (resistance, conditional skill
 * advantage, carry-capacity, save advantage, Interdict DC, level-scaling combat
 * riders) or is classified as "no passive sheet effect".
 *
 * Effects flow through two disjoint additions:
 *  - FeatureEffectRegistry._registerIllriggerSpecialtyEffects() — static, name-keyed.
 *  - CharacterSheetState._applyIllriggerSpecialtyCalculations() — calc-dependent
 *    (level scaling / Interdict DC) at the tail of getFeatureCalculations().
 *
 * Assertions are behavioral (getResistances / aggregateModifiers /
 * getFeatureCalculations / getSenses), never existence-only, and include
 * negative + no-double-count checks against the description parser.
 */

import "./setup.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

/** Build an Illrigger of the given level with a flat 14 stat line (Cha 16). */
function makeIllrigger (level) {
	const s = new CharacterSheetState();
	["str", "dex", "con", "int", "wis", "cha"].forEach(a => s.setAbilityBase(a, 14));
	s.setAbilityBase("cha", 16);
	s.addClass({name: "Illrigger", source: "IllriggerRevised", level});
	return s;
}

/** Add a specialty as a picked class-feature option, then re-aggregate effects. */
function addSpecialty (s, name, description, level) {
	s.addFeature({
		name,
		source: "TGTT-IllR",
		className: "Illrigger",
		classSource: "TGTT-IllR",
		level,
		featureType: "Class",
		isFeatureOption: true,
		description,
	});
	s.applyClassFeatureEffects();
}

describe("Illrigger Specialties — resistances", () => {
	test("Dark Resilience grants fire resistance", () => {
		const s = makeIllrigger(7);
		expect(s.getResistances()).not.toContain("fire");
		addSpecialty(s, "Dark Resilience", "You gain resistance to fire damage.", 3);
		expect(s.getResistances()).toContain("fire");
	});

	test("Purge Toxins grants poison resistance and advantage vs the poisoned condition", () => {
		const s = makeIllrigger(7);
		addSpecialty(
			s,
			"Purge Toxins",
			"You gain resistance to poison damage and advantage on saving throws against the poisoned condition.",
			5,
		);
		expect(s.getResistances()).toContain("poison");

		const conSaves = s.aggregateModifiers("save:con").conditionalsAvailable;
		expect(conSaves.some(c => c.name === "Purge Toxins")).toBe(true);
	});
});

describe("Illrigger Specialties — conditional skill advantage", () => {
	test("Faceless Mask surfaces conditional advantage on Stealth and Deception", () => {
		const s = makeIllrigger(7);
		addSpecialty(
			s,
			"Faceless Mask",
			"You have advantage on Stealth and Deception checks made to blend into a crowd or assume a false identity.",
			3,
		);
		const stealth = s.aggregateModifiers("skill:stealth").conditionalsAvailable;
		const deception = s.aggregateModifiers("skill:deception").conditionalsAvailable;
		expect(stealth.some(c => c.name === "Faceless Mask" && c.advantage)).toBe(true);
		expect(deception.some(c => c.name === "Faceless Mask" && c.advantage)).toBe(true);
	});

	test("Soul Reader surfaces conditional advantage on Insight", () => {
		const s = makeIllrigger(7);
		addSpecialty(
			s,
			"Soul Reader",
			"You have advantage on Insight checks against creatures you have interdicted.",
			3,
		);
		const insight = s.aggregateModifiers("skill:insight").conditionalsAvailable;
		expect(insight.some(c => c.name === "Soul Reader" && c.advantage)).toBe(true);
	});

	test("Baleful Presence adds only a value-0 conditional rider (cannot double-count its flat bonus)", () => {
		const s = makeIllrigger(7);
		const before = s.getSkillModifier("intimidation");
		addSpecialty(
			s,
			"Baleful Presence",
			"You add your proficiency bonus to Intimidation checks. Additionally, you have advantage on subsequent Intimidation checks against a creature you have intimidated for 24 hours.",
			3,
		);
		// The registry contributes ONLY the conditional advantage (value 0), so it
		// must not inflate the non-conditional Intimidation total — any flat +PB is
		// the parser's job, never double-applied here.
		expect(s.getSkillModifier("intimidation")).toBe(before);

		const conds = s.aggregateModifiers("skill:intimidation").conditionalsAvailable;
		const rider = conds.find(c => c.name === "Baleful Presence");
		expect(rider).toBeDefined();
		expect(rider.advantage).toBe(true);
	});

	test("Forked Tongue Mastery surfaces conditional advantage on Deception and Persuasion", () => {
		const s = makeIllrigger(7);
		addSpecialty(
			s,
			"Forked Tongue Mastery",
			"You add your proficiency bonus to Deception and Persuasion checks. Additionally, you have advantage on subsequent such checks against a creature for 24 hours.",
			3,
		);
		const deception = s.aggregateModifiers("skill:deception").conditionalsAvailable;
		const persuasion = s.aggregateModifiers("skill:persuasion").conditionalsAvailable;
		expect(deception.some(c => c.name === "Forked Tongue Mastery" && c.advantage)).toBe(true);
		expect(persuasion.some(c => c.name === "Forked Tongue Mastery" && c.advantage)).toBe(true);
	});
});

describe("Illrigger Specialties — carry capacity", () => {
	test("Infernal Constitution doubles carrying capacity", () => {
		const s = makeIllrigger(7);
		s.setAbilityBase("str", 16);
		addSpecialty(
			s,
			"Infernal Constitution",
			"You double your Strength score when determining your carrying capacity and the weight you can lift, push, or drag.",
			3,
		);
		expect(s._data.customModifiers.carryCapacityMultiplier).toBe(2);
	});
});

describe("Illrigger Specialties — calc-dependent upgrades", () => {
	test("Infernal Supremacy increases the Interdict save DC by 1", () => {
		const base = makeIllrigger(19);
		const baseDc = base.getFeatureCalculations().interdictDc;
		expect(typeof baseDc).toBe("number");

		const s = makeIllrigger(19);
		addSpecialty(
			s,
			"Infernal Supremacy",
			"When you reduce a creature to 0 hit points, you regain one use of Invoke Hell. Additionally, your Interdict save DC increases by 1.",
			19,
		);
		const calc = s.getFeatureCalculations();
		expect(calc.hasInfernalSupremacy).toBe(true);
		expect(calc.interdictDc).toBe(baseDc + 1);
	});

	test("Hellish Avenger scales its fire rider from 1d8 to 2d8 at level 11", () => {
		const s5 = makeIllrigger(5);
		addSpecialty(
			s5,
			"Hellish Avenger",
			"Once per turn when you hit a creature with a weapon attack, you can deal an extra 1d8 fire damage. This damage increases to 2d8 at 11th level.",
			5,
		);
		const calc5 = s5.getFeatureCalculations();
		expect(calc5.hasHellishAvenger).toBe(true);
		expect(calc5.hellishAvengerDamage).toBe("1d8");

		const s11 = makeIllrigger(11);
		addSpecialty(
			s11,
			"Hellish Avenger",
			"Once per turn when you hit a creature with a weapon attack, you can deal an extra 1d8 fire damage. This damage increases to 2d8 at 11th level.",
			5,
		);
		expect(s11.getFeatureCalculations().hellishAvengerDamage).toBe("2d8");
	});

	test("Infernal Awareness blindsight is 10 ft once and 30 ft when taken twice at level 11+", () => {
		const single = makeIllrigger(11);
		addSpecialty(single, "Infernal Awareness", "You gain blindsight with a range of 10 feet.", 7);
		const calcSingle = single.getFeatureCalculations();
		expect(calcSingle.hasInfernalAwareness).toBe(true);
		expect(calcSingle.infernalAwarenessRange).toBe(10);
		// Base sense is applied by the parser.
		expect(single.getSenses().blindsight).toBe(10);

		const twice = makeIllrigger(11);
		addSpecialty(twice, "Infernal Awareness", "You gain blindsight with a range of 10 feet.", 7);
		addSpecialty(twice, "Infernal Awareness", "You gain blindsight with a range of 10 feet.", 11);
		expect(twice.getFeatureCalculations().infernalAwarenessRange).toBe(30);
	});
});

describe("Illrigger Specialties — no passive sheet effect", () => {
	test.each([
		["Diplomatic Intervention", "As an action, you can spend 1 stamina to force a creature to listen to you."],
		["Do Without", "You can go without food and water for a number of days equal to your Constitution modifier."],
		["Endure Elements", "Once per long rest, you can ignore the effects of extreme heat or cold for one hour."],
		["Infernal Rejuvenation", "As an action, you can spend a creature's Hit Dice to heal them."],
		["Infernal Tracker", "You can use Charisma instead of Wisdom for Survival checks to track a creature you have interdicted."],
		["Negate Fall", "When you fall, you can spend stamina to reduce the falling damage you take."],
		["Suggestive Words", "You can cast suggestion a number of times equal to your proficiency bonus per long rest."],
	])("%s adds no spurious resistance or conditional skill modifier", (name, description) => {
		const s = makeIllrigger(11);
		const resBefore = s.getResistances().length;
		addSpecialty(s, name, description, 3);
		expect(s.getResistances().length).toBe(resBefore);
		// None of these grant a conditional advantage on the common social/stealth skills.
		["stealth", "deception", "persuasion", "insight", "intimidation"].forEach(skill => {
			const conds = s.aggregateModifiers(`skill:${skill}`).conditionalsAvailable;
			expect(conds.some(c => c.name === name)).toBe(false);
		});
	});
});
