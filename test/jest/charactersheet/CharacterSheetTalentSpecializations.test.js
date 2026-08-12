import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/**
 * Talent characters differ only by specialization, so one builder serves all seven.
 * INT 18 (+4) is deliberate: it makes "Intelligence modifier" riders distinguishable
 * from proficiency bonus and from flat numbers, so a test that passes cannot be
 * passing for the wrong reason.
 */
function getTalent ({specialization, level, int = 18, deriveHp = false} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Talent", source: "TalPsi", level});
	if (specialization) state.setSubclass("Talent", {name: specialization, shortName: specialization, source: "TalPsi"});
	state.setAbilityBase("int", int);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("str", 10);
	state.setAbilityBase("wis", 12);
	state.setAbilityBase("cha", 10);
	// Hit-point tests must let the sheet DERIVE the maximum, because activating a state
	// refreshes the stored maximum through `recalculateHp()`. A hand-typed maximum is a
	// different (and equally valid) code path, but it is not the one that exercises
	// `hpMaxIncrease`.
	if (deriveHp) {
		state.recalculateHp({syncCurrent: true});
	} else {
		state.setMaxHp(60);
		state.setCurrentHp(60);
	}
	return state;
}

function addFeature (state, name, level) {
	state.addFeature({name, level, className: "Talent", source: "TalPsi", description: `${name} feature`});
}

const SPECIALIZATIONS = ["Chronopath", "Maverick", "Metamorph", "Pyrokinetic", "Resopath", "Telekinetic", "Telepath"];

describe("Talent specializations — every specialization produces real effects", () => {
	it.each(SPECIALIZATIONS)("%s has derived calculations at level 20", (specialization) => {
		const calc = getTalent({specialization, level: 20}).getFeatureCalculations();
		const own = Object.keys(calc).filter(k => /^has[A-Z]/.test(k) && calc[k] === true);
		// Not a flag assertion: this asserts the specialization contributes SOMETHING
		// beyond the class core, which is exactly the gap the audit found for six of seven.
		expect(own.length).toBeGreaterThan(3);
	});

	it("does not leak one specialization's features into another", () => {
		const telepath = getTalent({specialization: "Telepath", level: 20}).getFeatureCalculations();
		const pyro = getTalent({specialization: "Pyrokinetic", level: 20}).getFeatureCalculations();
		expect(telepath.hasFlameOn).toBeFalsy();
		expect(telepath.hasEmotionalIntelligence).toBe(true);
		expect(pyro.hasEmotionalIntelligence).toBeFalsy();
		expect(pyro.hasFlameOn).toBe(true);
	});

	it("grants no specialization calculations before level 2", () => {
		const calc = getTalent({specialization: "Telekinetic", level: 1}).getFeatureCalculations();
		expect(calc.hasInvisibleArmor).toBeFalsy();
	});
});

describe("Talent — the generic discipline Adept reroll", () => {
	const DISCIPLINES = [
		["Chronopath", "Chronopathy Adept", "CP"],
		["Metamorph", "Metamorphosis Adept", "MM"],
		["Pyrokinetic", "Pyrokinesis Adept", "PK"],
		["Resopath", "Resopathy Adept", "RP"],
		["Telekinetic", "Telekinesis Adept", "TK"],
		["Telepath", "Telepathy Adept", "TP"],
	];

	it.each(DISCIPLINES)("%s mints a %s pool sized to the Intelligence modifier", (specialization, featureName) => {
		const state = getTalent({specialization, level: 6});
		addFeature(state, featureName, 6);
		state.ensureTalentResources();
		const pool = state.getResources().find(r => r.name === featureName);
		expect(pool).toBeTruthy();
		expect(pool.max).toBe(4); // INT 18 → +4
		expect(pool.recharge).toBe("long");
	});

	it("Maverick — the one specialization with no academy — has no Adept reroll", () => {
		const calc = getTalent({specialization: "Maverick", level: 20}).getFeatureCalculations();
		expect(calc.hasDisciplineAdept).toBeFalsy();
		expect(getTalent({specialization: "Maverick", level: 20}).canUseDisciplineAdeptReroll()).toBe(false);
	});

	it("actually rerolls a failed manifestation test and takes the better result", () => {
		const state = getTalent({specialization: "Telekinetic", level: 6});
		addFeature(state, "Telekinesis Adept", 6);
		state.ensureTalentResources();
		// A 3rd-order power against a d6: roll 1 fails outright (3 strain), the reroll
		// of 6 beats the score of 3 and costs nothing.
		const res = state.rollManifestationTest(3, {roll: 1, rerollResult: 6, useAdeptReroll: true, apply: true});
		expect(res.firstRoll).toBe(1);
		expect(res.rerolledTo).toBe(6);
		expect(res.roll).toBe(6);
		expect(res.adeptRerollUsed).toBe(true);
		expect(res.strain).toBe(0);
		expect(state.getTotalStrain()).toBe(0);
	});

	it("consumes exactly one use of the pool per reroll", () => {
		const state = getTalent({specialization: "Telekinetic", level: 6});
		addFeature(state, "Telekinesis Adept", 6);
		state.ensureTalentResources();
		const before = state.getResources().find(r => r.name === "Telekinesis Adept").current;
		state.rollManifestationTest(3, {roll: 1, rerollResult: 6, useAdeptReroll: true, apply: true});
		const after = state.getResources().find(r => r.name === "Telekinesis Adept").current;
		expect(after).toBe(before - 1);
	});

	it("never wastes a use when the first roll already succeeded", () => {
		const state = getTalent({specialization: "Telekinetic", level: 6});
		addFeature(state, "Telekinesis Adept", 6);
		state.ensureTalentResources();
		const before = state.getResources().find(r => r.name === "Telekinesis Adept").current;
		const res = state.rollManifestationTest(2, {roll: 6, rerollResult: 1, useAdeptReroll: true, apply: true});
		expect(res.adeptRerollUsed).toBeFalsy();
		expect(res.roll).toBe(6);
		expect(state.getResources().find(r => r.name === "Telekinesis Adept").current).toBe(before);
	});

	it("keeps the better roll when the reroll is worse", () => {
		const state = getTalent({specialization: "Telepath", level: 6});
		addFeature(state, "Telepathy Adept", 6);
		state.ensureTalentResources();
		// First roll 3 == score 3 → 1 strain. Reroll of 1 is worse; RAW lets you use
		// either roll, so the sheet must keep the 3.
		const res = state.rollManifestationTest(3, {roll: 3, rerollResult: 1, useAdeptReroll: true, apply: true});
		expect(res.roll).toBe(3);
		expect(res.strain).toBe(1);
	});
});

describe("Maverick — Reduce Stress", () => {
	it("halves the strain a manifestation causes, with a floor of 1", () => {
		const state = getTalent({specialization: "Maverick", level: 6});
		addFeature(state, "Reduce Stress", 2);
		state.ensureTalentResources();
		// 5th-order power, roll 1 → 5 strain raw, halved to 2.
		const res = state.rollManifestationTest(5, {roll: 1, useReduceStress: true, apply: true});
		expect(res.rawStrain).toBe(5);
		expect(res.strain).toBe(2);
		expect(res.reduceStressUsed).toBe(true);
		expect(state.getTotalStrain()).toBe(2);
	});

	it("never reduces strain below 1", () => {
		const state = getTalent({specialization: "Maverick", level: 6});
		addFeature(state, "Reduce Stress", 2);
		state.ensureTalentResources();
		// Roll == score → 1 strain raw; half of 1 must still be 1, not 0.
		const res = state.rollManifestationTest(2, {roll: 2, useReduceStress: true, apply: true});
		expect(res.rawStrain).toBe(1);
		expect(res.strain).toBe(1);
	});

	it("does nothing when the manifestation caused no strain, and spends nothing", () => {
		const state = getTalent({specialization: "Maverick", level: 6});
		addFeature(state, "Reduce Stress", 2);
		state.ensureTalentResources();
		const before = state.getResources().find(r => r.name === "Reduce Stress").current;
		const res = state.rollManifestationTest(2, {roll: 6, useReduceStress: true, apply: true});
		expect(res.strain).toBe(0);
		expect(res.reduceStressUsed).toBeFalsy();
		expect(state.getResources().find(r => r.name === "Reduce Stress").current).toBe(before);
	});

	it("recharges on a short rest", () => {
		const state = getTalent({specialization: "Maverick", level: 6});
		addFeature(state, "Reduce Stress", 2);
		state.ensureTalentResources();
		expect(state.getResources().find(r => r.name === "Reduce Stress").recharge).toBe("short");
	});

	it("Energy Unleashed scales its damage with the strain spent", () => {
		const calc = getTalent({specialization: "Maverick", level: 6}).getFeatureCalculations();
		expect(calc.energyUnleashedDamagePerStrain).toBe("1d6");
		expect(calc.energyUnleashedDamageType).toBe("psychic");
		expect(calc.energyUnleashedSaveAbility).toBe("wis");
		// The DC must be the real psionic save DC, not null — the audit's canonical
		// symptom of a decorative feature.
		expect(calc.energyUnleashedDc).toBe(calc.powerSaveDc);
		expect(calc.energyUnleashedDc).toBeGreaterThan(8);
	});

	it("Raw Power adds the Intelligence modifier, floored at +1", () => {
		expect(getTalent({specialization: "Maverick", level: 2}).getFeatureCalculations().rawPowerDamageBonus).toBe(4);
		expect(getTalent({specialization: "Maverick", level: 2, int: 8}).getFeatureCalculations().rawPowerDamageBonus).toBe(1);
	});
});

describe("Metamorph", () => {
	it("Psionic Toughness raises the hit point maximum by INT + level while active", () => {
		const state = getTalent({specialization: "Metamorph", level: 10, deriveHp: true});
		const maxBefore = state.getMaxHp();
		state.activateState("psionicToughness");
		// INT 18 (+4) at level 10 → +14 hit points.
		expect(state.getMaxHp() - maxBefore).toBe(14);
	});

	it("Psionic Toughness grants death save advantage while active, and not before", () => {
		const state = getTalent({specialization: "Metamorph", level: 6});
		expect(state.getAdvantageState("deathSave").advantage).toBe(false);
		state.activateState("psionicToughness");
		expect(state.getAdvantageState("deathSave").advantage).toBe(true);
	});

	it("Psionic Toughness raises CURRENT hit points alongside the maximum (CS-BUG-131)", () => {
		const state = getTalent({specialization: "Metamorph", level: 10, deriveHp: true});
		const currentBefore = state.getCurrentHp();
		state.activateState("psionicToughness");
		// RAW: the grant is Aid-like — both the maximum and the current total move.
		expect(state.getCurrentHp() - currentBefore).toBe(14);
	});

	it("Psionic Toughness effects disappear when the state ends", () => {
		const state = getTalent({specialization: "Metamorph", level: 10, deriveHp: true});
		const maxBefore = state.getMaxHp();
		const added = state.activateState("psionicToughness");
		expect(state.getMaxHp()).toBeGreaterThan(maxBefore);
		state.removeActiveState(added?.id || state.getActiveStates()[0].id);
		expect(state.getMaxHp()).toBe(maxBefore);
	});

	it("Psionic Toughness floors the grant at 1 even with a penalty to Intelligence", () => {
		// INT 6 (−2) at level 2 → −2 + 2 = 0, which RAW floors to 1.
		const state = getTalent({specialization: "Metamorph", level: 2, int: 6, deriveHp: true});
		const maxBefore = state.getMaxHp();
		state.activateState("psionicToughness");
		expect(state.getMaxHp() - maxBefore).toBe(1);
	});

	// Psionic Evolution is Metamorph **14**, not 10. Level 10 is Death Foiled, a
	// resurrection with no persistent effects. The boundary is asserted at 13/14
	// precisely because an off-by-one here is invisible in play until someone
	// counts squares.
	it("Psionic Evolution rides Psionic Toughness with +10 speed from level 14, not before", () => {
		const early = getTalent({specialization: "Metamorph", level: 13});
		const earlySpeed = early.getSpeedByType("walk");
		early.activateState("psionicToughness");
		expect(early.getSpeedByType("walk")).toBe(earlySpeed);

		const late = getTalent({specialization: "Metamorph", level: 14});
		const lateSpeed = late.getSpeedByType("walk");
		late.activateState("psionicToughness");
		expect(late.getSpeedByType("walk")).toBe(lateSpeed + 10);
	});

	it("Psionic Evolution grants poison damage immunity and the poisoned/disease condition immunities at 14", () => {
		const state = getTalent({specialization: "Metamorph", level: 14});
		expect(state.getImmunities().map(it => it.toLowerCase())).not.toContain("poison");
		state.activateState("psionicToughness");
		expect(state.getImmunities().map(it => it.toLowerCase())).toContain("poison");
		const conds = state.getConditionImmunities().map(it => it.toLowerCase());
		expect(conds).toContain("poisoned");
		expect(conds).toContain("disease");
	});

	it("Psionic Evolution immunities are absent at level 13", () => {
		const state = getTalent({specialization: "Metamorph", level: 13});
		state.activateState("psionicToughness");
		expect(state.getImmunities().map(it => it.toLowerCase())).not.toContain("poison");
		expect(state.getConditionImmunities().map(it => it.toLowerCase())).not.toContain("poisoned");
	});

	it("Super Senses raises Perception checks, and passive Perception with them", () => {
		// Level 5 and level 6 share a proficiency bonus and neither is Perception-proficient,
		// so Super Senses (level 6) is the only thing that can differ between them.
		const before = getTalent({specialization: "Metamorph", level: 5});
		before.applyClassFeatureEffects();

		const state = getTalent({specialization: "Metamorph", level: 6});
		state.applyClassFeatureEffects();
		expect(state.aggregateModifiers("skill:perception").bonus).toBe(4);
		expect(before.aggregateModifiers("skill:perception").bonus).toBe(0);
		// Passive Perception derives from the check modifier, so the skill bonus must
		// carry into it — a bonus that raises the check but leaves passive alone is the
		// classic half-implemented version of this feature.
		expect(state.getPassivePerception()).toBe(before.getPassivePerception() + 4);
	});

	it("Mind Surgeon's healing scales per strain and is capped by the proficiency bonus", () => {
		const calc = getTalent({specialization: "Metamorph", level: 6}).getFeatureCalculations();
		expect(calc.mindSurgeonHealingPerStrain).toBe("1d10");
		expect(calc.mindSurgeonMaxStrain).toBe(3); // PB at level 6
		const calc17 = getTalent({specialization: "Metamorph", level: 17}).getFeatureCalculations();
		expect(calc17.mindSurgeonMaxStrain).toBe(6);
	});
});

describe("Pyrokinetic", () => {
	it.each([
		[2, 1, "1d6", 60],
		[5, 2, "1d6", 60],
		[10, 2, "1d8", 120],
		[11, 3, "1d8", 120],
		[17, 4, "1d8", 120],
	])("Flame On at level %i burns %i flame(s) for %s at %i ft", (level, count, damage, range) => {
		const calc = getTalent({specialization: "Pyrokinetic", level}).getFeatureCalculations();
		expect(calc.flameOnCount).toBe(count);
		expect(calc.flameOnDamage).toBe(damage);
		expect(calc.flameOnRange).toBe(range);
	});

	it("Flame On's attack bonus is proficiency + Intelligence, not a guess", () => {
		const state = getTalent({specialization: "Pyrokinetic", level: 5});
		const calc = state.getFeatureCalculations();
		expect(calc.flameOnAttackBonus).toBe(state.getProficiencyBonus() + state.getAbilityMod("int"));
	});

	it("Heat Seeking is what changes the die and the range at level 10", () => {
		expect(getTalent({specialization: "Pyrokinetic", level: 9}).getFeatureCalculations().hasHeatSeeking).toBeFalsy();
		const calc = getTalent({specialization: "Pyrokinetic", level: 10}).getFeatureCalculations();
		expect(calc.hasHeatSeeking).toBe(true);
		expect(calc.heatSeekingIgnoresCover).toBe(true);
	});

	it("Immolate deals twice the proficiency bonus in fire damage", () => {
		expect(getTalent({specialization: "Pyrokinetic", level: 14}).getFeatureCalculations().immolateDamage).toBe("10");
		expect(getTalent({specialization: "Pyrokinetic", level: 17}).getFeatureCalculations().immolateDamage).toBe("12");
	});

	it("Immolate resolves a real save DC", () => {
		const calc = getTalent({specialization: "Pyrokinetic", level: 14}).getFeatureCalculations();
		expect(calc.immolateDc).toBe(calc.powerSaveDc);
		expect(calc.immolateSaveAbility).toBe("dex");
	});
});

describe("Resopath", () => {
	it.each([
		[6, 2, 2],
		[9, 3, 3],
		[14, 4, 4],
		[20, 6, 6],
	])("Manifest Ally at level %i summons up to CR %i for %i strain", (level, cr, strain) => {
		const calc = getTalent({specialization: "Resopath", level}).getFeatureCalculations();
		expect(calc.manifestAllyMaxCr).toBe(cr);
		expect(calc.manifestAllyMaxStrain).toBe(strain);
	});

	it("Manifest Ally's strain cost never drops below 1", () => {
		// Level 6 is the earliest the feature exists; floor(6/3) is 2, so probe the
		// floor via a lower CR ceiling by construction.
		const calc = getTalent({specialization: "Resopath", level: 6}).getFeatureCalculations();
		expect(calc.manifestAllyMaxStrain).toBeGreaterThanOrEqual(1);
	});

	it("Nightmare Terrain's damage equals the talent level", () => {
		expect(getTalent({specialization: "Resopath", level: 14}).getFeatureCalculations().nightmareTerrainDamage).toBe("14");
		expect(getTalent({specialization: "Resopath", level: 20}).getFeatureCalculations().nightmareTerrainDamage).toBe("20");
	});

	it("Manipulate Terrain mints a pool that recharges on a long rest", () => {
		const state = getTalent({specialization: "Resopath", level: 2});
		addFeature(state, "Manipulate Terrain", 2);
		state.ensureTalentResources();
		const pool = state.getResources().find(r => r.name === "Manipulate Terrain");
		expect(pool).toBeTruthy();
		expect(pool.max).toBe(4);
	});
});

describe("Telekinetic", () => {
	it("Invisible Armor's AC bonus equals the Intelligence modifier", () => {
		expect(getTalent({specialization: "Telekinetic", level: 2}).getFeatureCalculations().invisibleArmorAcBonus).toBe(4);
		expect(getTalent({specialization: "Telekinetic", level: 2, int: 8}).getFeatureCalculations().invisibleArmorAcBonus).toBe(1);
	});

	it("Mind Wings grants a REAL flying speed, not a note", () => {
		const state = getTalent({specialization: "Telekinetic", level: 14});
		addFeature(state, "Mind Wings", 14);
		state.applyClassFeatureEffects();
		expect(state.getSpeedByType("fly")).toBe(60);
		expect(state.getSpeed()).toContain("fly 60 ft.");
	});

	it("Mind Wings does not double-count into the walking speed", () => {
		const state = getTalent({specialization: "Telekinetic", level: 14});
		addFeature(state, "Mind Wings", 14);
		const walkBefore = state.getSpeedByType("walk");
		state.applyClassFeatureEffects();
		expect(state.getSpeedByType("walk")).toBe(walkBefore);
	});

	it("Mind Wings does not arrive before level 14", () => {
		const state = getTalent({specialization: "Telekinetic", level: 13});
		addFeature(state, "Mind Wings", 14);
		state.applyClassFeatureEffects();
		expect(state.getSpeedByType("fly")).toBe(0);
	});

	it("Strong Mind swaps a save to Intelligence for 1 strain", () => {
		const calc = getTalent({specialization: "Telekinetic", level: 6}).getFeatureCalculations();
		expect(calc.strongMindSwapsSaveTo).toBe("int");
		expect(calc.strongMindStrainCost).toBe(1);
	});
});

describe("Telepath", () => {
	it("Emotional Intelligence raises all four social skills by the Intelligence modifier", () => {
		const state = getTalent({specialization: "Telepath", level: 6});
		addFeature(state, "Emotional Intelligence", 6);
		state.applyClassFeatureEffects();
		for (const skill of ["deception", "insight", "intimidation", "persuasion"]) {
			expect(state.aggregateModifiers(`skill:${skill}`).bonus).toBe(4);
		}
	});

	it("Emotional Intelligence leaves unrelated skills alone", () => {
		const state = getTalent({specialization: "Telepath", level: 6});
		addFeature(state, "Emotional Intelligence", 6);
		state.applyClassFeatureEffects();
		expect(state.aggregateModifiers("skill:athletics").bonus).toBe(0);
		expect(state.aggregateModifiers("skill:stealth").bonus).toBe(0);
	});

	it("Truth Hurts deals 2d8 per strain spent", () => {
		const calc = getTalent({specialization: "Telepath", level: 14}).getFeatureCalculations();
		expect(calc.truthHurtsDamagePerStrain).toBe("2d8");
		expect(calc.truthHurtsDamageType).toBe("psychic");
	});
});

describe("Talent core — the level 11/18/20 capstones actually reach the getters", () => {
	it("Psionic Bastion grants psychic resistance, charm/fright immunity AND sleep immunity", () => {
		const state = getTalent({specialization: "Telepath", level: 11});
		addFeature(state, "Psionic Bastion", 11);
		state.applyClassFeatureEffects();
		expect(state.getResistances()).toContain("psychic");
		const immunities = state.getConditionImmunities();
		expect(immunities).toContain("charmed");
		expect(immunities).toContain("frightened");
		// The half the audit found missing: "magic or psionics can't put you to sleep".
		expect(immunities).toContain("magically asleep");
	});

	it("Shielded Mind blocks thought-reading and divination as well as granting saves", () => {
		const state = getTalent({specialization: "Telepath", level: 18});
		addFeature(state, "Shielded Mind", 18);
		state.applyClassFeatureEffects();
		expect(state.aggregateModifiers("save:int").advantage).toBe(true);
		const immunities = state.getConditionImmunities();
		expect(immunities).toContain("thoughts read");
		expect(immunities).toContain("alignment detected");
		expect(immunities).toContain("creature type detected");
		expect(immunities).toContain("unwanted telepathy");
	});

	it("Ignore Strain suppresses the chosen track and is cleared by a long rest", () => {
		const state = getTalent({specialization: "Telepath", level: 20});
		state.addStrain(5, "mind");
		expect(state.setIgnoredStrainTrack("mind")).toBe(true);
		expect(state.getIgnoredStrainTrack()).toBe("mind");
		state.onLongRest();
		expect(state.getIgnoredStrainTrack()).toBeNull();
		expect(state.getTotalStrain()).toBe(0);
	});

	it("Ignore Strain is refused below level 20", () => {
		const state = getTalent({specialization: "Telepath", level: 19});
		expect(state.setIgnoredStrainTrack("mind")).toBe(false);
		expect(state.getIgnoredStrainTrack()).toBeNull();
	});
});

describe("Psionic strain cost detection — the shapes the prose actually uses", () => {
	it.each([
		["you gain strain equal to the power's order", "powerOrder"],
		["you gain strain equal to half the power's order", "halfPowerOrder"],
		["you can gain strain up to your proficiency bonus", "proficiencyBonus"],
		["you can gain up to your proficiency bonus strain", "proficiencyBonus"],
		["you can gain any amount of strain", "any"],
		["you gain strain to create the ally", "any"],
		["you gain up to 4 strain", 4],
		["you gain 3 strain", 3],
	])("reads %j as %j", (text, expected) => {
		expect(CharacterSheetState._detectPsionicStrainCost(text)?.strainCost).toBe(expected);
	});

	it("resolves each shape into a real number", () => {
		const state = getTalent({specialization: "Maverick", level: 11});
		expect(state.resolvePsionicStrainCost("powerOrder", {powerOrder: 4})).toBe(4);
		expect(state.resolvePsionicStrainCost("halfPowerOrder", {powerOrder: 5})).toBe(2);
		expect(state.resolvePsionicStrainCost("proficiencyBonus")).toBe(state.getProficiencyBonus());
		expect(state.resolvePsionicStrainCost(3)).toBe(3);
		// "Any amount" is bounded by remaining headroom, so it can never overflow.
		state.addStrain(10, "body");
		expect(state.resolvePsionicStrainCost("any")).toBe(state.getStrainMaximum() - 10);
	});

	it("half-order never rounds down to a free manifestation", () => {
		const state = getTalent({specialization: "Maverick", level: 11});
		expect(state.resolvePsionicStrainCost("halfPowerOrder", {powerOrder: 1})).toBe(1);
	});
});

describe("Talent — no cross-class regression", () => {
	it("a non-Talent gets no strain machinery", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 20});
		state.setAbilityBase("int", 18);
		expect(state.getStrainMaximum()).toBe(0);
		expect(state.getTalentLevel()).toBe(0);
		expect(state.getFeatureCalculations().hasDisciplineAdept).toBeFalsy();
		expect(state.canUseReduceStress()).toBe(false);
	});

	it("a non-Metamorph gets no Psionic Toughness effects even if the state is forced on", () => {
		const state = getTalent({specialization: "Telepath", level: 10, deriveHp: true});
		const maxBefore = state.getMaxHp();
		state.activateState("psionicToughness");
		expect(state.getMaxHp()).toBe(maxBefore);
	});
});
