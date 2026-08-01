import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;

function getTalentState ({level = 1, chronopath = false, int = 16, con = 14, dex = 14} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Talent", source: "TalPsi", level});
	if (chronopath) state.setSubclass("Talent", {name: "Chronopath", shortName: "Chronopath", source: "TalPsi"});
	state.setAbilityBase("int", int);
	state.setAbilityBase("con", con);
	state.setAbilityBase("dex", dex);
	state.setAbilityBase("str", 10);
	state.setAbilityBase("wis", 12);
	state.setAbilityBase("cha", 10);
	state.setMaxHp(60);
	state.setCurrentHp(60);
	return state;
}

function addFeature (state, name, level, extra = {}) {
	state.addFeature({name, level, className: "Talent", source: "TalPsi", description: `${name} feature`, ...extra});
}

describe("Talent (TalPsi) — class table", () => {
	it.each([
		[1, "1d4", 2, 4, 5],
		[4, "1d4", 2, 5, 8],
		[5, "1d6", 3, 5, 9],
		[9, "1d6", 4, 5, 13],
		[10, "1d6", 4, 6, 14],
		[13, "1d8", 5, 6, 17],
		[17, "1d8", 6, 6, 21],
		[20, "1d8", 6, 6, 24],
	])("derives the level-%i row", (level, die, maxOrder, firstOrderKnown, strainMax) => {
		const state = getTalentState({level});
		const calc = state.getFeatureCalculations();
		expect(calc.manifestationDie).toBe(die);
		expect(calc.maxPowerOrder).toBe(maxOrder);
		expect(calc.firstOrderPowersKnown).toBe(firstOrderKnown);
		expect(calc.strainMaximum).toBe(strainMax);
		expect(state.getStrainMaximum()).toBe(strainMax);
		expect(state.getManifestationDie()).toBe(die);
		expect(state.getMaxPowerOrder()).toBe(maxOrder);
	});

	it("derives the power save DC and attack bonus from Intelligence", () => {
		const state = getTalentState({level: 5, int: 18});
		const calc = state.getFeatureCalculations();
		// PB +3 at level 5, INT +4.
		expect(calc.powerSaveDc).toBe(8 + 3 + 4);
		expect(calc.powerAttackBonus).toBe(3 + 4);
		expect(calc.manifestationAbility).toBe("int");
	});

	it("uses a d6 hit die", () => {
		const state = getTalentState({level: 3});
		expect(state._getClassHitDie("Talent")).toBe(6);
	});

	it.each([
		[2, undefined],
		[3, 1],
		[7, 2],
		[11, 3],
		[15, 4],
		[20, 4],
	])("knows the right number of Psionic Exertions at level %i", (level, expected) => {
		expect(getTalentState({level}).getFeatureCalculations().psionicExertionsKnown).toBe(expected);
	});

	it.each([
		[6, undefined],
		[7, 1],
		[12, 2],
		[17, 3],
	])("scales Psychic Boost uses at level %i", (level, expected) => {
		expect(getTalentState({level}).getFeatureCalculations().psychicBoostUses).toBe(expected);
	});
});

describe("Talent (TalPsi) — psionic strain applies real penalties", () => {
	it("halves speed at body tier 2 and restores it when cleared", () => {
		const state = getTalentState({level: 10});
		const base = state.getWalkSpeed();
		expect(base).toBeGreaterThan(0);
		state.addStrain(2, "body");
		expect(state.getWalkSpeed()).toBe(base); // tier 1 only
		state.addStrain(1, "body");
		expect(state.getWalkSpeed()).toBe(Math.floor(base / 2));
		state.clearStrain();
		expect(state.getWalkSpeed()).toBe(base);
	});

	it("halves the hit point maximum at body tier 4", () => {
		const state = getTalentState({level: 10});
		const base = state.getMaxHp();
		state.addStrain(6, "body");
		expect(state.getMaxHp()).toBe(base);
		state.addStrain(1, "body");
		expect(state.getMaxHp()).toBe(Math.floor(base / 2));
	});

	it("imposes disadvantage on Str/Dex checks then saves as body strain climbs", () => {
		const state = getTalentState({level: 10});
		state.addStrain(1, "body");
		expect(state.getAdvantageState("check:str").disadvantage).toBe(true);
		expect(state.getAdvantageState("check:dex").disadvantage).toBe(true);
		expect(state.getAdvantageState("save:str").disadvantage).toBeFalsy();
		state.addStrain(4, "body");
		expect(state.getAdvantageState("save:str").disadvantage).toBe(true);
		expect(state.getAdvantageState("save:dex").disadvantage).toBe(true);
		// Other ability families are untouched.
		expect(state.getAdvantageState("check:int").disadvantage).toBeFalsy();
	});

	it("applies a −5 AC penalty at mind tier 3", () => {
		const state = getTalentState({level: 10});
		const base = state.getAc();
		state.addStrain(4, "mind");
		expect(state.getAc()).toBe(base);
		state.addStrain(1, "mind");
		expect(state.getAc()).toBe(base - 5);
		state.clearStrain();
		expect(state.getAc()).toBe(base);
	});

	it("suppresses skill proficiency at mind tier 2 without erasing the underlying proficiency", () => {
		const state = getTalentState({level: 10});
		state.setSkillProficiency("arcana", true);
		const proficient = state.getSkillMod("arcana");
		state.addStrain(3, "mind");
		expect(state.getEffectiveSkillProficiency("arcana")).toBeFalsy();
		expect(state.getSkillProficiency("arcana")).toBe(true); // raw proficiency is preserved
		expect(state.getSkillMod("arcana")).toBe(proficient - state.getProficiencyBonus());
		state.clearStrain();
		expect(state.getSkillMod("arcana")).toBe(proficient);
	});

	it("suppresses saving throw proficiency at mind tier 4", () => {
		const state = getTalentState({level: 10});
		state._data.saveProficiencies.push("int");
		expect(state.hasSaveProficiency("int")).toBe(true);
		const proficient = state.getSaveMod("int");
		state.addStrain(7, "mind");
		expect(state.hasSaveProficiency("int")).toBe(false);
		expect(state.getSaveMod("int")).toBe(proficient - state.getProficiencyBonus());
	});

	it("imposes disadvantage on Wis/Cha checks, death saves, then Wis/Cha saves as soul strain climbs", () => {
		const state = getTalentState({level: 10});
		state.addStrain(1, "soul");
		expect(state.getAdvantageState("check:wis").disadvantage).toBe(true);
		expect(state.getAdvantageState("check:cha").disadvantage).toBe(true);
		expect(state.getDeathSaveRollMode().disadvantage).toBe(false);
		state.addStrain(2, "soul");
		expect(state.getDeathSaveRollMode().disadvantage).toBe(true);
		state.addStrain(2, "soul");
		expect(state.getAdvantageState("save:wis").disadvantage).toBe(true);
		expect(state.getAdvantageState("save:cha").disadvantage).toBe(true);
	});

	it("halves supernatural healing at soul tier 4 but leaves mundane healing alone", () => {
		const state = getTalentState({level: 10});
		state.addStrain(7, "soul");
		state.setCurrentHp(1);
		state.heal(10, {supernatural: true});
		expect(state.getCurrentHp()).toBe(6);
		state.setCurrentHp(1);
		state.heal(10);
		expect(state.getCurrentHp()).toBe(11);
	});

	it("refuses strain past the maximum instead of silently clamping", () => {
		const state = getTalentState({level: 1}); // strain maximum 5
		expect(state.addStrain(5, "body")).toMatchObject({applied: 5, overflow: false});
		const overflow = state.addStrain(1, "mind");
		expect(overflow.overflow).toBe(true);
		expect(overflow.applied).toBe(0);
		expect(state.getTotalStrain()).toBe(5);
	});

	it("resolves the overflow choice: manifest and die, or decline and drop to 0 hp", () => {
		const died = getTalentState({level: 1});
		died.addStrain(5, "body");
		expect(died.resolveStrainOverflow({manifest: true, strain: 2, track: "mind"})).toMatchObject({outcome: "died"});
		expect(died.getCurrentHp()).toBe(0);
		expect(died.getDeathSaves().failures).toBe(3);

		const declined = getTalentState({level: 1});
		declined.addStrain(5, "body");
		expect(declined.resolveStrainOverflow({manifest: false})).toMatchObject({outcome: "unconscious"});
		expect(declined.getCurrentHp()).toBe(0);
		expect(declined.getDeathSaves().failures).toBe(0);
	});

	it("clears all strain on a long rest", () => {
		const state = getTalentState({level: 10});
		state.addStrain(3, "body");
		state.addStrain(2, "soul");
		expect(state.getTotalStrain()).toBe(5);
		state.onLongRest();
		expect(state.getTotalStrain()).toBe(0);
	});

	it("removes one strain per Hit Die spent on a short rest", () => {
		const state = getTalentState({level: 10});
		state.addStrain(3, "mind");
		const spent = state.spendHitDieToRemoveStrain("mind");
		expect(spent).toBe(true);
		expect(state.getStrain().mind).toBe(2);
	});

	it("suppresses a chosen track entirely once Ignore Strain is online", () => {
		const state = getTalentState({level: 20});
		expect(state.getFeatureCalculations().hasIgnoreStrain).toBe(true);
		const baseAc = state.getAc();
		state.addStrain(5, "mind");
		expect(state.getAc()).toBe(baseAc - 5);
		state.setIgnoredStrainTrack("mind");
		expect(state.getAc()).toBe(baseAc);
		// The strain is still tracked against the maximum, only its effects are ignored.
		expect(state.getTotalStrain()).toBe(5);
	});

	it("summarises the live penalties for each track", () => {
		const state = getTalentState({level: 10});
		state.addStrain(5, "mind");
		expect(state.getStrainTrackEffects("mind")).toEqual([
			"can't Dash, Disengage or Dodge",
			"lose skill proficiencies",
			"−5 AC",
		]);
		expect(state.getStrainTrackEffects("soul")).toEqual([]);
	});
});

describe("Talent (TalPsi) — manifestation test", () => {
	it("never tests a 1st-order power", () => {
		const state = getTalentState({level: 10});
		const res = state.rollManifestationTest(1, {roll: 1});
		expect(res.outcome).toBe("automatic");
		expect(state.getTotalStrain()).toBe(0);
	});

	it.each([
		[2, 4, 0, "clean"],
		[2, 2, 1, "grazed"],
		[2, 1, 2, "strained"],
		[3, 2, 3, "strained"],
	])("order %i rolling %i charges %i strain", (order, roll, strain, outcome) => {
		const state = getTalentState({level: 10});
		const res = state.rollManifestationTest(order, {roll, track: "mind"});
		expect(res.strain).toBe(strain);
		expect(res.outcome).toBe(outcome);
		expect(state.getStrain().mind).toBe(strain);
	});

	it("raises the manifestation score by one per other concentrated power", () => {
		const state = getTalentState({level: 10});
		const res = state.rollManifestationTest(2, {roll: 3, concentratingOn: 2, track: "body"});
		expect(res.score).toBe(4);
		expect(res.strain).toBe(2);
	});

	it("reports overflow without applying strain", () => {
		const state = getTalentState({level: 1});
		state.addStrain(4, "body");
		const res = state.rollManifestationTest(2, {roll: 1, track: "body"});
		expect(res.overflow).toBe(true);
		expect(res.applied).toBe(0);
		expect(state.getTotalStrain()).toBe(4);
	});
});

describe("Talent (TalPsi) — class features have mechanical effects", () => {
	it("gives Psychic Boost a long-rest pool that removes strain equal to the proficiency bonus", () => {
		const state = getTalentState({level: 12});
		addFeature(state, "Psychic Boost", 7);
		state.ensureTalentResources();
		const resource = state.getResources().find(r => r.name === "Psychic Boost");
		expect(resource).toMatchObject({max: 2, current: 2, recharge: "long"});

		state.addStrain(6, "body");
		const res = state.usePsychicBoost("body");
		expect(res.removed).toBe(state.getProficiencyBonus());
		expect(state.getStrain().body).toBe(6 - state.getProficiencyBonus());
		expect(state.getResources().find(r => r.name === "Psychic Boost").current).toBe(1);
	});

	it("makes Psionic Bastion grant psychic resistance and charm/fright immunity", () => {
		const state = getTalentState({level: 11});
		addFeature(state, "Psionic Bastion", 11, {
			description: "Your mind is a fortress. You have resistance to psychic damage, and you can't be charmed or frightened.",
		});
		state.applyClassFeatureEffects();
		expect(state.getResistances()).toContain("psychic");
		const immunities = state.getConditionImmunities();
		expect(immunities).toEqual(expect.arrayContaining(["charmed", "frightened"]));
	});

	it("makes Shielded Mind grant advantage on Int/Wis/Cha saves", () => {
		const state = getTalentState({level: 18});
		addFeature(state, "Shielded Mind", 18, {
			description: "You have advantage on Intelligence, Wisdom, and Charisma saving throws.",
		});
		state.applyClassFeatureEffects();
		expect(state.getAdvantageState("save:int").advantage).toBe(true);
		expect(state.getAdvantageState("save:wis").advantage).toBe(true);
		expect(state.getAdvantageState("save:cha").advantage).toBe(true);
		expect(state.getAdvantageState("save:str").advantage).toBeFalsy();
	});

	it("charges strain for Strain to Maintain", () => {
		const state = getTalentState({level: 10});
		const res = state.payStrainToMaintain(3, "soul");
		expect(res.applied).toBe(3);
		expect(state.getStrain().soul).toBe(3);
	});
});

describe("Chronopath (TalPsi) — subclass features have mechanical effects", () => {
	it("scales Chronopathy Adept and Rapid Manifestation with Intelligence", () => {
		const state = getTalentState({level: 2, chronopath: true, int: 16});
		addFeature(state, "Chronopathy Adept", 2);
		addFeature(state, "Rapid Manifestation", 2);
		state.ensureTalentResources();
		expect(state.getFeatureCalculations().chronopathyAdeptUses).toBe(3);
		expect(state.getResources().find(r => r.name === "Chronopathy Adept")).toMatchObject({max: 3, recharge: "long"});
		expect(state.getResources().find(r => r.name === "Rapid Manifestation")).toMatchObject({max: 3, recharge: "long"});
	});

	it("never drops Chronopath pools below one use", () => {
		const state = getTalentState({level: 2, chronopath: true, int: 8});
		expect(state.getFeatureCalculations().chronopathyAdeptUses).toBe(1);
	});

	it("derives Decay's damage from the strain actually spent", () => {
		const state = getTalentState({level: 6, chronopath: true, int: 18});
		const calc = state.getFeatureCalculations();
		expect(calc.decayDamagePerStrain).toBe("2d10");
		expect(calc.decayDc).toBe(calc.powerSaveDc);
		const res = state.useDecay(2, "body");
		expect(res).toMatchObject({strain: 2, damage: "4d10", damageType: "necrotic", saveAbility: "wis"});
		expect(state.getStrain().body).toBe(2);
	});

	it("caps Decay's strain at the proficiency bonus", () => {
		const state = getTalentState({level: 6, chronopath: true});
		const res = state.useDecay(99, "body");
		expect(res.strain).toBe(state.getProficiencyBonus());
	});

	it("charges Time Pocket three strain and reports its save and damage", () => {		const state = getTalentState({level: 14, chronopath: true});
		const res = state.useTimePocket("soul");
		expect(res).toMatchObject({strain: 3, damage: "6d10", damageType: "psychic", saveAbility: "cha", duration: "1d4 + 1 rounds"});
		expect(state.getStrain().soul).toBe(3);
		expect(res.dc).toBe(state.getFeatureCalculations().powerSaveDc);
	});

	it("refuses Time Pocket when the strain would break the maximum", () => {
		const state = getTalentState({level: 14, chronopath: true});
		state.addStrain(state.getStrainMaximum(), "body");
		expect(state.useTimePocket("soul")).toMatchObject({overflow: true, strain: 0});
	});

	it("publishes the save ability and duration so the generic outcome readout needs no name matching", () => {
		const calc = getTalentState({level: 14, chronopath: true}).getFeatureCalculations();
		expect(calc.decaySaveAbility).toBe("wis");
		expect(calc.timePocketSaveAbility).toBe("cha");
		expect(calc.timePocketDuration).toBe("1d4 + 1 rounds");
		// The convention the readout relies on: <camelFeatureName><Suffix>.
		expect(calc.timePocketDamage).toBe("6d10");
		expect(calc.timePocketDamageType).toBe("psychic");
		expect(calc.decayDamagePerStrain).toBe("2d10");
	});

	it("gates the Chronopath features on level", () => {
		const l2 = getTalentState({level: 2, chronopath: true}).getFeatureCalculations();
		expect(l2.hasDecay).toBeUndefined();
		expect(l2.hasFickleReadiness).toBeUndefined();
		expect(l2.hasTimePocket).toBeUndefined();
		const l14 = getTalentState({level: 14, chronopath: true}).getFeatureCalculations();
		expect(l14.hasDecay).toBe(true);
		expect(l14.hasFickleReadiness).toBe(true);
		expect(l14.hasTimePocket).toBe(true);
	});

	it("does not leak Chronopath calculations to another Talent specialization", () => {
		const state = getTalentState({level: 14});
		state.setSubclass("Talent", {name: "Cryokineticist", shortName: "Cryokineticist", source: "TalPsi"});
		const calc = state.getFeatureCalculations();
		expect(calc.hasChronopathyAdept).toBeUndefined();
		expect(calc.hasTimePocket).toBeUndefined();
		// …but the base class table is unaffected.
		expect(calc.maxPowerOrder).toBe(5);
	});
});

describe("Talent (TalPsi) — psionic activation is detected generically", () => {
	it("treats a picked psionic power as a limited-use ability that runs a manifestation test", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Kinetic Crush",
			description: "As an action, you crush a creature with raw force.",
			optionalFeatureTypes: ["PsiPH"],
			_psionicOrder: 3,
		});
		expect(info).toMatchObject({
			isPsionicPower: true,
			psionicOrder: 3,
			requiresManifestationTest: true,
			interactionMode: "limited",
			activationAction: "action",
		});
	});

	it("does not require a manifestation test for a 1st-order power", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Psychic Stab",
			description: "As an action, you stab a mind.",
			optionalFeatureTypes: ["PsiP1"],
			_psionicOrder: 1,
		});
		expect(info.requiresManifestationTest).toBe(false);
	});

	it("reads a flat strain cost out of a feature's text", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Time Pocket",
			description: "As an action, you gain 3 strain and focus your mind on bending time around a creature.",
		});
		expect(info).toMatchObject({strainCost: 3, isVariableStrainCost: false, activationAction: "action"});
	});

	it("reads a proficiency-bonus strain cost and marks it variable", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Decay",
			description: "You can use an action to gain up to your proficiency bonus strain while touching a Construct.",
		});
		expect(info).toMatchObject({strainCost: "proficiencyBonus", isVariableStrainCost: true});
	});

	it("leaves non-psionic features to the normal detection pipeline", () => {
		expect(CharacterSheetState.detectActivatableFeature({
			name: "Second Wind",
			description: "You have a limited well of stamina.",
		})?.matchedBy).not.toBe("psionicPower");
	});
});

describe("Generic optional-feature derivation (used by the Talent's pickers)", () => {
	const talentClass = {
		name: "Talent",
		source: "TalPsi",
		classFeatures: ["Psionic Exertion|Talent|TalPsi|3"],
	};

	it("derives a progression from inline refOptionalfeature enumerations", () => {
		const classFeatures = [
			{
				name: "Psionic Exertion",
				className: "Talent",
				classSource: "TalPsi",
				source: "TalPsi",
				level: 3,
				entries: [
					"You gain one Psionic Exertion option.",
					{type: "refOptionalfeature", optionalfeature: "Destructive Power|TalPsi"},
					{type: "refOptionalfeature", optionalfeature: "Halting Power|TalPsi"},
				],
			},
			{
				name: "Psionic Exertion improvement",
				className: "Talent",
				classSource: "TalPsi",
				source: "TalPsi",
				level: 7,
				entries: ["You gain another {@classFeature Psionic Exertion|Talent|TalPsi|3} option."],
			},
		];
		const optionalFeatures = [
			{name: "Destructive Power", source: "TalPsi", featureType: ["PsiEx"]},
			{name: "Halting Power", source: "TalPsi", featureType: ["PsiEx"]},
		];
		const cls = {...talentClass};
		expect(CharacterSheetClassUtils.deriveOptionalFeatureProgressions(cls, classFeatures, optionalFeatures)).toBe(true);
		expect(cls.optionalfeatureProgression).toEqual([
			expect.objectContaining({name: "Psionic Exertion", featureType: ["PsiEx"], progression: {3: 1, 7: 2}}),
		]);
	});

	it("never shadows a hand-authored optionalfeatureProgression", () => {
		const classFeatures = [
			{
				name: "Psionic Exertion",
				className: "Talent",
				classSource: "TalPsi",
				level: 3,
				entries: [{type: "refOptionalfeature", optionalfeature: "Destructive Power|TalPsi"}],
			},
		];
		const cls = {...talentClass, optionalfeatureProgression: [{name: "Hand authored", featureType: ["PsiEx"], progression: {3: 9}}]};
		expect(CharacterSheetClassUtils.deriveOptionalFeatureProgressions(cls, classFeatures, [{name: "Destructive Power", source: "TalPsi", featureType: ["PsiEx"]}])).toBe(false);
		expect(cls.optionalfeatureProgression).toHaveLength(1);
	});

	it("republishes psionic powers as optional features split by order", () => {
		const config = CharacterSheetClassUtils.getPsionicManifesterConfig("Talent");
		expect(config).toBeTruthy();
		const powers = [
			{name: "Psychic Stab", source: "TalPsi", type: "TP", entries: [], order: "1st-Order"},
			{name: "Kinetic Crush", source: "TalPsi", type: "TK", entries: [], order: "3rd-Order"},
		];
		const built = CharacterSheetClassUtils.buildPsionicOptionalFeatures(powers, config);
		const first = built.find(it => it.name === "Psychic Stab");
		const higher = built.find(it => it.name === "Kinetic Crush");
		expect(first.featureType).toEqual([config.firstOrderType]);
		expect(first._psionicOrder).toBe(1);
		// The discipline code must not leak into the optional-feature `type` slot.
		expect(first.type).toBeUndefined();
		expect(first._psionicPowerType).toBe("TP");
		expect(higher.featureType).toEqual([config.higherOrderType]);
		expect(higher._psionicOrder).toBe(3);
		// 3rd-order powers are gated behind Talent 5.
		expect(higher.prerequisite).toEqual(expect.arrayContaining([
			expect.objectContaining({level: expect.objectContaining({level: 5})}),
		]));
	});

	it("builds progressions that grow both power pools with level", () => {
		const config = CharacterSheetClassUtils.getPsionicManifesterConfig("Talent");
		const progressions = CharacterSheetClassUtils.buildPsionicProgressions(config);
		const first = progressions.find(p => p.featureType[0] === config.firstOrderType);
		const higher = progressions.find(p => p.featureType[0] === config.higherOrderType);
		expect(first.progression[1]).toBe(4);
		expect(first.progression[4]).toBe(5);
		expect(first.progression[10]).toBe(6);
		expect(higher.progression[1]).toBe(2);
		expect(higher.progression[20]).toBe(21);
	});
});
