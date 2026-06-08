/**
 * Bug #4 — 2024 (FRHoF) Bladesinger "Training in War and Song".
 *
 * The feature has TWO parts, both previously inert:
 *   1. A FIXED proficiency grant: "all Melee Martial weapons that don't have the
 *      Two-Handed or Heavy property" (a weapon-category *descriptor*, not a list of
 *      named weapons).
 *   2. A skill CHOICE: "proficiency in one of the following skills of your choice:
 *      {@skill Acrobatics}, {@skill Athletics}, {@skill Performance}, or
 *      {@skill Persuasion}."  ← list phrasing the old parser only handled as "either".
 *
 * Asserts REAL mechanics:
 *  - FeatureChoiceParser extracts the "one of the following … of your choice: …"
 *    skill list generically (and a "two of the following" count).
 *  - The martial-melee descriptor token is granted ONLY for the FRHoF subclass
 *    (not 2014 TCE "Bladesinging", not TGTT) via the class-feature-effect lifecycle,
 *    and is resolved by _isWeaponProficient against each weapon's metadata
 *    (rapier/longsword/whip yes; greatsword/maul/longbow no).
 *  - The descriptor is torn down cleanly when the subclass is swapped away.
 *  - Adding the feature queues the skill choice; fulfilling it grants exactly one.
 */

import "./setup.js";

let CharacterSheetState;
let FeatureChoiceParser;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	FeatureChoiceParser = globalThis.FeatureChoiceParser;
});

beforeEach(() => {
	state = new CharacterSheetState();
});

// The real 2024 FRHoF feature text (entries with tags intact).
function trainingInWarAndSongFeature () {
	return {
		name: "Training in War and Song",
		source: "FRHoF",
		className: "Wizard",
		level: 3,
		featureType: "Subclass",
		subclassShortName: "Bladesinger",
		subclassSource: "FRHoF",
		isSubclassFeature: true,
		entries: [
			"You gain proficiency with all Melee Martial weapons that don't have the {@itemProperty 2H|XPHB|Two-Handed} or {@itemProperty H|XPHB|Heavy} property. You can use a Melee weapon with which you have proficiency as a {@variantrule Spellcasting Focus|XPHB} for your Wizard spells.",
			"You also gain proficiency in one of the following skills of your choice: {@skill Acrobatics|XPHB}, {@skill Athletics|XPHB}, {@skill Performance|XPHB}, or {@skill Persuasion|XPHB}.",
		],
	};
}

// Raw-5etools-item-shaped weapons for proficiency probing.
const RAPIER = {name: "Rapier", weaponCategory: "martial", type: "M", property: ["F"]};
const LONGSWORD = {name: "Longsword", weaponCategory: "martial", type: "M", property: ["V"]};
const WHIP = {name: "Whip", weaponCategory: "martial", type: "M", property: ["F", "R"]};
const SHORTSWORD = {name: "Shortsword", weaponCategory: "martial", type: "M", property: ["F", "L"]};
const GREATSWORD = {name: "Greatsword", weaponCategory: "martial", type: "M", property: ["H", "2H"]};
const MAUL = {name: "Maul", weaponCategory: "martial", type: "M", property: ["H", "2H"]};
const LONGBOW = {name: "Longbow", weaponCategory: "martial", type: "R", property: ["A", "2H"]};

function makeBladesinger ({source, name, shortName, level = 3}) {
	state.addClass({
		name: "Wizard",
		source: source === "TGTT" ? "TGTT" : (source === "FRHoF" ? "XPHB" : "PHB"),
		level,
		subclass: {name, shortName, source},
	});
	state.setAbilityBase("str", 10);
	state.setAbilityBase("dex", 16);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("int", 18);
	state.setAbilityBase("wis", 10);
	state.setAbilityBase("cha", 10);
}

// =============================================================================
// PART A — skill-list choice extraction
// =============================================================================
describe("FeatureChoiceParser — 'one of the following … of your choice: …' list", () => {
	it("extracts the four skill options (count 1) from the real FRHoF prose", () => {
		const {skillChoices} = FeatureChoiceParser.extractChoices(trainingInWarAndSongFeature());
		expect(skillChoices).toHaveLength(1);
		expect(skillChoices[0].options.sort()).toEqual(["acrobatics", "athletics", "performance", "persuasion"]);
		expect(skillChoices[0].count).toBe(1);
	});

	it("does NOT mistake the fixed martial-weapon sentence for a skill choice", () => {
		const feature = {
			name: "Weapons Only",
			entries: ["You gain proficiency with all Melee Martial weapons that don't have the Two-Handed or Heavy property."],
		};
		const {skillChoices} = FeatureChoiceParser.extractChoices(feature);
		expect(skillChoices).toHaveLength(0);
	});

	it("does NOT produce a single-pick choice for unsupported 'two of the following' phrasing", () => {
		// The picker can only fulfill ONE option, so multi-pick list phrasing is left
		// untouched rather than queueing a misleading single-pick prompt.
		const feature = {
			name: "Two Skills",
			entries: ["You gain proficiency in two of the following skills of your choice: {@skill Stealth}, {@skill Perception}, or {@skill Insight}."],
		};
		const {skillChoices} = FeatureChoiceParser.extractChoices(feature);
		expect(skillChoices).toHaveLength(0);
	});

	it("still extracts legacy 'either A or B' phrasing (regression)", () => {
		const feature = {name: "Legacy", entries: ["You gain proficiency in either {@skill Stealth} or {@skill Perception}."]};
		const {skillChoices} = FeatureChoiceParser.extractChoices(feature);
		expect(skillChoices).toHaveLength(1);
		expect(skillChoices[0].options.sort()).toEqual(["perception", "stealth"]);
	});
});

// =============================================================================
// PART B — fixed martial-melee descriptor grant (FRHoF only) + teardown
// =============================================================================
describe("FRHoF Bladesinger — martial-melee weapon proficiency descriptor", () => {
	it("flags hasTrainingInWarAndSongMartialMelee ONLY for the FRHoF subclass", () => {
		makeBladesinger({source: "FRHoF", name: "Bladesinger", shortName: "Bladesinger"});
		expect(state.getFeatureCalculations().hasTrainingInWarAndSongMartialMelee).toBe(true);
	});

	it("does NOT flag it for the 2014 TCE 'Bladesinging' subclass", () => {
		makeBladesinger({source: "TCE", name: "Bladesinging", shortName: "Bladesinging", level: 3});
		expect(state.getFeatureCalculations().hasTrainingInWarAndSongMartialMelee).toBeFalsy();
	});

	it("does NOT flag it for a TGTT Bladesinger", () => {
		makeBladesinger({source: "TGTT", name: "Bladesinger", shortName: "Bladesinger"});
		expect(state.getFeatureCalculations().hasTrainingInWarAndSongMartialMelee).toBeFalsy();
	});

	describe("after applyClassFeatureEffects (FRHoF)", () => {
		beforeEach(() => {
			makeBladesinger({source: "FRHoF", name: "Bladesinger", shortName: "Bladesinger"});
			state.applyClassFeatureEffects();
		});

		it("grants the descriptor token", () => {
			const profs = state._data.weaponProficiencies.map(p => p.toLowerCase());
			expect(profs.some(p => p.includes("martial melee"))).toBe(true);
		});

		it("makes one-handed, non-heavy Melee Martial weapons proficient", () => {
			expect(state._isWeaponProficient(RAPIER)).toBe(true);
			expect(state._isWeaponProficient(LONGSWORD)).toBe(true);
			expect(state._isWeaponProficient(WHIP)).toBe(true);
			expect(state._isWeaponProficient(SHORTSWORD)).toBe(true);
		});

		it("excludes Two-Handed / Heavy melee weapons", () => {
			expect(state._isWeaponProficient(GREATSWORD)).toBe(false);
			expect(state._isWeaponProficient(MAUL)).toBe(false);
		});

		it("excludes ranged martial weapons", () => {
			expect(state._isWeaponProficient(LONGBOW)).toBe(false);
		});

		it("excludes normalized-inventory ranged weapons (Ammunition property), keeps normalized melee", () => {
			// Normalized inventory weapons carry type "weapon" + weapon:true and may not
			// set isMelee — the Ammunition (A) property must still mark them ranged.
			const normHandCrossbow = {name: "Hand Crossbow", weaponCategory: "martial", type: "weapon", weapon: true, properties: ["A", "L"]};
			const normRapier = {name: "Rapier", weaponCategory: "martial", type: "weapon", weapon: true, properties: ["F"]};
			expect(state._isWeaponProficient(normHandCrossbow)).toBe(false);
			expect(state._isWeaponProficient(normRapier)).toBe(true);
		});
	});

	it("does NOT grant the bundle to a TGTT Bladesinger (rapier stays non-proficient)", () => {
		makeBladesinger({source: "TGTT", name: "Bladesinger", shortName: "Bladesinger"});
		state.applyClassFeatureEffects();
		expect(state._isWeaponProficient(RAPIER)).toBe(false);
	});

	it("tears down the descriptor cleanly when the subclass is swapped away", () => {
		makeBladesinger({source: "FRHoF", name: "Bladesinger", shortName: "Bladesinger"});
		state.applyClassFeatureEffects();
		expect(state._isWeaponProficient(RAPIER)).toBe(true);

		// Simulate a respec to a non-FRHoF subclass and re-apply effects.
		state._data.classes[0].subclass.source = "TGTT";
		state.applyClassFeatureEffects();

		expect(state._isWeaponProficient(RAPIER)).toBe(false);
		const profs = state._data.weaponProficiencies.map(p => p.toLowerCase());
		expect(profs.some(p => p.includes("martial melee"))).toBe(false);
	});
});

// =============================================================================
// PART A+B integration — adding the feature queues the skill pick; fulfilling grants it
// =============================================================================
describe("addFeature(Training in War and Song) — skill choice pipeline", () => {
	beforeEach(() => {
		state.addFeature(trainingInWarAndSongFeature());
	});

	it("queues exactly one skill choice with the four options", () => {
		const skillChoices = state.getPendingFeatureChoices().filter(c => c.kind === "skill");
		expect(skillChoices).toHaveLength(1);
		expect(skillChoices[0].options.sort()).toEqual(["acrobatics", "athletics", "performance", "persuasion"]);
	});

	it("does NOT auto-grant any of the four skills (they are a choice)", () => {
		expect(state.getSkillProficiency("acrobatics")).toBe(0);
		expect(state.getSkillProficiency("athletics")).toBe(0);
		expect(state.getSkillProficiency("performance")).toBe(0);
		expect(state.getSkillProficiency("persuasion")).toBe(0);
	});

	it("grants only the chosen skill when fulfilled", () => {
		const id = state.getPendingFeatureChoices().find(c => c.kind === "skill").id;
		expect(state.fulfillFeatureChoice(id, "performance")).toBe(true);
		expect(state.getSkillProficiency("performance")).toBe(1);
		expect(state.getSkillProficiency("acrobatics")).toBe(0);
		expect(state.getPendingFeatureChoices().some(c => c.id === id)).toBe(false);
	});
});
