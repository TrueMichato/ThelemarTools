/**
 * Behavioural coverage for the three Matthew Mercer 2022 Blood Hunter orders
 * (source BH2022): Order of the Ghostslayer, Order of the Mutant, and Order of
 * the Profane Soul. The Order of the Lycan already has its own suite; this file
 * covers the other three.
 *
 * These tests assert DERIVED EFFECTS — a resource max, a resistance actually
 * returned by getResistances(), an ability score that actually changed, the
 * pact slot count/level, the immunity the getter returns — never a bare
 * `has*` calc flag.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function makeBloodHunter ({subclass, level, abilities = {}} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Blood Hunter", source: "BH2022", level});
	if (subclass) {
		state.setSubclass("Blood Hunter", {
			name: subclass,
			shortName: subclass.replace(/^Order of the /, ""),
			source: "BH2022",
		});
	}
	state.setAbilityBase("str", abilities.str ?? 12);
	state.setAbilityBase("dex", abilities.dex ?? 14);
	state.setAbilityBase("con", abilities.con ?? 14);
	state.setAbilityBase("int", abilities.int ?? 16);
	state.setAbilityBase("wis", abilities.wis ?? 12);
	state.setAbilityBase("cha", abilities.cha ?? 10);
	state.setMaxHp(80);
	state.setCurrentHp(80);
	return state;
}

function addFeature (state, name, level) {
	state.addFeature({name, level, className: "Blood Hunter", source: "BH2022", description: `${name} feature`});
}

// (CS-BUG-124) A mutagen can only be consumed if its formula is known. `getAvailableMutagens()`
// used to return every level-eligible mutagen, which made the `mutagenFormulasKnown` limit
// inert, so these tests drank mutagens they had never learned. Learn, then drink.
function drink (state, key) {
	state.learnMutagenFormula(key);
	return state.consumeMutagen(key);
}

// ---------------------------------------------------------------------------
// Order of the Ghostslayer
// ---------------------------------------------------------------------------
describe("Order of the Ghostslayer (BH2022)", () => {
	it("Curse Specialist adds a Blood Maledict use on top of the class progression", () => {
		// Base Blood Maledict at level 6 = 2 uses; Curse Specialist adds 1 -> 3.
		const state = makeBloodHunter({subclass: "Order of the Ghostslayer", level: 6});
		const calc = state.getFeatureCalculations();
		expect(calc.bloodMaledictUses).toBe(3);
		expect(calc.bloodCurseTargetsBloodless).toBe(true);

		addFeature(state, "Blood Maledict", 1);
		addFeature(state, "Curse Specialist", 3);
		state.ensureBloodHunterResources();
		expect(state.getResource("Blood Maledict").max).toBe(3);
	});

	it.each([
		[3, "1d4"],
		[5, "1d6"],
		// (CS-BUG-125) From 11th level Brand of Sundering adds a second hemocraft die to
		// every rite's extra damage, so the rite rolls 2dN rather than 1dN from here on.
		[11, "2d8"],
		[17, "2d10"],
	])("Rite of the Dawn deals radiant damage scaling with the hemocraft die at level %i", (level, die) => {
		const state = makeBloodHunter({subclass: "Order of the Ghostslayer", level});
		addFeature(state, "Rite of the Dawn", 3);
		state.setCurrentHp(50);
		const ok = state.activateCrimsonRite("rite of the dawn", {roll: 1, weaponId: "w1", weaponName: "Longsword"});
		expect(ok).toBe(true);

		const riteEffect = state.getExtraDamageFromStates().find(e => e.isCrimsonRite);
		expect(riteEffect.damageType).toBe("radiant");
		expect(riteEffect.dice).toBe(die);
		// While the dawn rite is active, the Ghostslayer resists necrotic damage.
		expect(state.getResistances()).toContain("necrotic");
	});

	it("does not grant Rite of the Dawn (or its necrotic resistance) to a non-Ghostslayer", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 3});
		state.setCurrentHp(50);
		const ok = state.activateCrimsonRite("rite of the dawn", {roll: 1, weaponId: "w1", weaponName: "Longsword"});
		expect(ok).toBe(false);
		expect(state.getResistances()).not.toContain("necrotic");
	});

	it.each([
		[7, 1],
		[14, 1],
		[15, 2],
		[18, 2],
	])("Aether Walk is a short-rest pool of %s use(s) at level %i", (level, uses) => {
		const state = makeBloodHunter({subclass: "Order of the Ghostslayer", level});
		const calc = state.getFeatureCalculations();
		expect(calc.aetherWalkUses).toBe(uses);
		expect(calc.aetherWalkDurationRounds).toBe(calc.hemocraftModifier);

		addFeature(state, "Aether Walk", 7);
		state.ensureBloodHunterResources();
		const resource = state.getResource("Aether Walk");
		expect(resource.max).toBe(uses);
		expect(resource.recharge).toBe("short");
	});

	it("Aether Walk does not exist before level 7", () => {
		const state = makeBloodHunter({subclass: "Order of the Ghostslayer", level: 6});
		expect(state.getFeatureCalculations().aetherWalkUses).toBeUndefined();
	});

	it("Brand of Sundering adds a hemocraft die of rite damage from level 11", () => {
		const state = makeBloodHunter({subclass: "Order of the Ghostslayer", level: 11});
		const calc = state.getFeatureCalculations();
		// Assert the OBSERVABLE outcome, not a mirror key. The old assertions pinned
		// `brandOfSunderingRiteBonusDamage`, which nothing read — so they stayed green
		// for the entire period the feature did nothing (CS-BUG-125). The rite's own
		// damage is the value a player actually rolls.
		expect(calc.hasBrandOfSundering).toBe(true);
		expect(calc.hemocraftDie).toBe("1d8");
		expect(calc.crimsonRiteDamage).toBe("2d8");
		const l10 = makeBloodHunter({subclass: "Order of the Ghostslayer", level: 10}).getFeatureCalculations();
		expect(l10.hasBrandOfSundering).toBeUndefined();
		expect(l10.crimsonRiteDamage).toBe("1d6");
	});

	it("auto-grants Blood Curse of the Exorcist at 15 without spending a known slot", () => {
		const state = makeBloodHunter({subclass: "Order of the Ghostslayer", level: 15});
		const calc = state.getFeatureCalculations();
		state.ensureBloodHunterResources();
		const curse = state._data.features.find(f => f.name === "Blood Curse of the Exorcist");
		expect(curse).toBeTruthy();
		expect(curse.optionalFeatureTypes).toContain("BC");
		// The auto-granted curse is not paid for from bloodCursesKnown.
		expect(calc.grantsBloodCurseOfTheExorcist).toBe(true);
		// It is granted OUTSIDE the pick budget: the row is pushed unconditionally at 15
		// rather than being chosen, and the class table's known count is untouched by it.
		expect(calc.bloodCursesKnown).toBe(4);
		expect(curse.id).toBe("bh2022-blood-curse-of-the-exorcist");
		expect(curse.description).toContain("doesn't count against your number of blood curses known");
		// Falsifiable in the direction that matters: a 14th-level Ghostslayer must NOT have it.
		const l14 = makeBloodHunter({subclass: "Order of the Ghostslayer", level: 14});
		l14.ensureBloodHunterResources();
		expect(l14._data.features.some(f => f.name === "Blood Curse of the Exorcist")).toBe(false);
		expect(l14.getFeatureCalculations().grantsBloodCurseOfTheExorcist).toBeUndefined();
	});

	it("does not auto-grant the Exorcist curse before level 15", () => {
		const state = makeBloodHunter({subclass: "Order of the Ghostslayer", level: 14});
		state.ensureBloodHunterResources();
		expect(state._data.features.find(f => f.name === "Blood Curse of the Exorcist")).toBeFalsy();
	});

	it("Rite Revival drops the Ghostslayer to 1 HP and ends their rites at 0 HP (level 18)", () => {
		const state = makeBloodHunter({subclass: "Order of the Ghostslayer", level: 18});
		addFeature(state, "Rite Revival", 18);
		addFeature(state, "Rite of the Dawn", 3);
		state.setCurrentHp(60);
		state.activateCrimsonRite("rite of the dawn", {roll: 1, weaponId: "w1", weaponName: "Longsword"});
		expect(state._hasActiveCrimsonRite()).toBe(true);

		state.takeDamage(200, {damageType: "slashing"});
		expect(state.getCurrentHp()).toBe(0);

		const pending = state.getPendingZeroHpIntervention();
		const revival = pending.interventions.find(i => i.id === "riteRevival");
		expect(revival.available).toBe(true);
		// No save, no per-rest budget: it is an automatic drop to 1 HP.
		expect(revival.saveAbility).toBeNull();

		const result = state.applyZeroHpIntervention("riteRevival", {roll: 10});
		expect(result.success).toBe(true);
		expect(result.hp).toBe(1);
		expect(state.getCurrentHp()).toBe(1);
		// Its only cost: every active crimson rite ends.
		expect(state._hasActiveCrimsonRite()).toBe(false);
	});

	it("Rite Revival is unavailable when no crimson rite is active", () => {
		const state = makeBloodHunter({subclass: "Order of the Ghostslayer", level: 18});
		addFeature(state, "Rite Revival", 18);
		state.setCurrentHp(60);
		state.takeDamage(200, {damageType: "slashing"});
		const pending = state.getPendingZeroHpIntervention();
		const revival = pending.interventions.find(i => i.id === "riteRevival");
		// Offered, but gated off because there is no active crimson rite to consume.
		expect(revival.available).toBe(false);
		expect(revival.unavailableReason).toMatch(/active crimson rite/i);
		expect(state.applyZeroHpIntervention("riteRevival", {roll: 10}).success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Order of the Mutant
// ---------------------------------------------------------------------------
describe("Order of the Mutant (BH2022)", () => {
	it.each([
		[3, 4, 1],
		[7, 5, 2],
		[11, 6, 2],
		[15, 7, 3],
		[18, 8, 3],
	])("Mutagencraft scales formulas known / mutagens per rest at level %i", (level, formulas, perRest) => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level});
		const calc = state.getFeatureCalculations();
		expect(calc.mutagenFormulasKnown).toBe(formulas);
		expect(calc.mutagensCreatedPerRest).toBe(perRest);

		addFeature(state, "Mutagencraft", 3);
		state.ensureBloodHunterResources();
		expect(state.getResource("Mutagen").max).toBe(perRest);
	});

	it("exposes all 20 mutagen formulas as learnable, gated by prerequisite level", () => {
		expect(Object.keys(CharacterSheetState.MUTAGENS)).toHaveLength(20);
		// At level 3, the four higher-level mutagens (Reconstruction 7, Aether/Cruelty/Precision 11) are unavailable.
		const lvl3 = makeBloodHunter({subclass: "Order of the Mutant", level: 3}).getLearnableMutagens();
		expect(lvl3).toHaveLength(16);
		expect(lvl3).not.toContain("aether");
		expect(lvl3).not.toContain("reconstruction");
		// At 11 every mutagen is available.
		expect(makeBloodHunter({subclass: "Order of the Mutant", level: 11}).getLearnableMutagens()).toHaveLength(20);
	});

	it.each([
		["embers", "fire", "cold"],
		["gelid", "cold", "fire"],
		["impermeable", "piercing", "slashing"],
		["shielded", "slashing", "bludgeoning"],
		["unbreakable", "bludgeoning", "piercing"],
	])("%s applies its resistance benefit AND its vulnerability drawback", (mutagen, resist, vuln) => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 3});
		expect(drink(state, mutagen)).toBe(true);
		expect(state.getResistances()).toContain(resist);
		expect(state.getVulnerabilities()).toContain(vuln);
	});

	it.each([
		["celerity", "dex"],
		["potency", "str"],
		["sagacity", "int"],
	])("%s raises %s by 3/4/5 as it scales, beyond the ability cap", (mutagen, ability) => {
		const l3 = makeBloodHunter({subclass: "Order of the Mutant", level: 3});
		const before = l3.getAbilityScore(ability);
		drink(l3, mutagen);
		expect(l3.getAbilityScore(ability)).toBe(before + 3);

		const l11 = makeBloodHunter({subclass: "Order of the Mutant", level: 11});
		const before11 = l11.getAbilityScore(ability);
		drink(l11, mutagen);
		expect(l11.getAbilityScore(ability)).toBe(before11 + 4);

		const l18 = makeBloodHunter({subclass: "Order of the Mutant", level: 18});
		const before18 = l18.getAbilityScore(ability);
		drink(l18, mutagen);
		expect(l18.getAbilityScore(ability)).toBe(before18 + 5);
	});

	it("Mobile grants condition immunities (paralyzed only from 11) with a Strength-check drawback", () => {
		const l3 = makeBloodHunter({subclass: "Order of the Mutant", level: 3});
		drink(l3, "mobile");
		expect(l3.getConditionImmunities()).toEqual(expect.arrayContaining(["grappled", "restrained"]));
		expect(l3.getConditionImmunities()).not.toContain("paralyzed");
		expect(l3.getAdvantageState("check:str").disadvantage).toBe(true);

		const l11 = makeBloodHunter({subclass: "Order of the Mutant", level: 11});
		drink(l11, "mobile");
		expect(l11.getConditionImmunities()).toContain("paralyzed");
	});

	it("Rapidity increases walking speed (+10, +15 at 15) and hampers Intelligence checks", () => {
		const l3 = makeBloodHunter({subclass: "Order of the Mutant", level: 3});
		const base = l3.getWalkSpeed();
		drink(l3, "rapidity");
		expect(l3.getWalkSpeed()).toBe(base + 10);
		expect(l3.getAdvantageState("check:int").disadvantage).toBe(true);

		const l15 = makeBloodHunter({subclass: "Order of the Mutant", level: 15});
		const base15 = l15.getWalkSpeed();
		drink(l15, "rapidity");
		expect(l15.getWalkSpeed()).toBe(base15 + 15);
	});

	it("Reconstruction reduces speed by 10 as its drawback", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 7});
		const base = state.getWalkSpeed();
		drink(state, "reconstruction");
		expect(state.getWalkSpeed()).toBe(base - 10);
	});

	it("Aether grants a flying speed as its benefit", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 11});
		expect(state.getSpeed("fly")).toBe(0);
		drink(state, "aether");
		expect(state.getSpeed("fly")).toBe(20);
		expect(state.getAdvantageState("check:str").disadvantage).toBe(true);
	});

	// Nighteye emits an ABSOLUTE darkvision value (existing + 60), not a +60 bonus,
	// because the source reads "or +60 feet if you already have it". getSense() folds
	// state senses through Math.max but SUMS namedBonus, so the absolute value is only
	// correct while mutagen senses stay on the max side. This pins the stacking case:
	// if a future refactor routes state senses into the named-contribution sum, this
	// goes to 180 and fails loudly instead of silently doubling a player's darkvision.
	it("Nighteye extends existing darkvision to 120 rather than stacking to 180", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 11});
		state.setSense("darkvision", 60);
		expect(state.getSense("darkvision")).toBe(60);
		state.learnMutagenFormula("nighteye");
		state.consumeMutagen("nighteye");
		expect(state.getSense("darkvision")).toBe(120);
		state.endMutagen("nighteye");
		expect(state.getSense("darkvision")).toBe(60);
	});

	it("Nighteye grants darkvision as its benefit", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 3});
		expect(state.getSense("darkvision")).toBe(0);
		drink(state, "nighteye");
		expect(state.getSense("darkvision")).toBe(60);
	});

	it.each([
		["alluring", "check:cha", "initiative"],
		["conversant", "check:int", "check:wis"],
		["deftness", "check:dex", "check:wis"],
		["percipient", "check:wis", "check:cha"],
	])("%s grants advantage on %s and disadvantage on %s", (mutagen, advTarget, disTarget) => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 3});
		drink(state, mutagen);
		expect(state.getAdvantageState(advTarget).advantage).toBe(true);
		expect(state.getAdvantageState(disTarget).disadvantage).toBe(true);
	});

	it("Vermillion imposes disadvantage on death saving throws", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 3});
		drink(state, "vermillion");
		expect(state.getAdvantageState("deathSave").disadvantage).toBe(true);
	});

	it("stacks multiple mutagens' effects in one shared state", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 3});
		drink(state, "embers");
		drink(state, "gelid");
		// Embers: resist fire / vuln cold. Gelid: resist cold / vuln fire. Both present.
		expect(state.getResistances()).toEqual(expect.arrayContaining(["fire", "cold"]));
		expect(state.getVulnerabilities()).toEqual(expect.arrayContaining(["fire", "cold"]));
		expect(state.getActiveMutagens()).toEqual(["embers", "gelid"]);
	});

	it("ending or flushing mutagens removes their effects", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 3});
		drink(state, "embers");
		expect(state.getResistances()).toContain("fire");
		state.endMutagen("embers");
		expect(state.getResistances()).not.toContain("fire");

		drink(state, "gelid");
		expect(state.getResistances()).toContain("cold");
		state.flushMutagens();
		expect(state.getActiveMutagens()).toEqual([]);
		expect(state.getResistances()).not.toContain("cold");
	});

	it("only an Order of the Mutant of the right level can create a mutagen", () => {
		// A Ghostslayer has no mutagen access at all: the formula is not even learnable.
		const ghostslayer = makeBloodHunter({subclass: "Order of the Ghostslayer", level: 11});
		expect(ghostslayer.getLearnableMutagens()).toEqual([]);
		expect(ghostslayer.learnMutagenFormula("embers")).toBe(false);
		expect(ghostslayer.consumeMutagen("embers")).toBe(false);

		// Aether needs level 11, so a level-3 Mutant cannot learn it and therefore cannot drink it.
		const mutant3 = makeBloodHunter({subclass: "Order of the Mutant", level: 3});
		expect(mutant3.getLearnableMutagens()).not.toContain("aether");
		expect(mutant3.learnMutagenFormula("aether")).toBe(false);
		expect(mutant3.consumeMutagen("aether")).toBe(false);
	});

	it("Strange Metabolism grants poison immunities and can suppress one mutagen drawback (level 7)", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 7});
		addFeature(state, "Strange Metabolism", 7);
		state.applyClassFeatureEffects();
		expect(state.getImmunities()).toContain("poison");
		expect(state.getConditionImmunities()).toContain("poisoned");

		state.ensureBloodHunterResources();
		expect(state.getResource("Strange Metabolism").max).toBe(1);

		drink(state, "embers");
		expect(state.getVulnerabilities()).toContain("cold");
		expect(state.ignoreMutagenDrawback("embers")).toBe(true);
		// The drawback (cold vulnerability) is suppressed; the benefit (fire resistance) remains.
		expect(state.getVulnerabilities()).not.toContain("cold");
		expect(state.getResistances()).toContain("fire");
	});

	it("Brand of Axiom surfaces the Wisdom save DC (level 11)", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 11});
		const calc = state.getFeatureCalculations();
		expect(calc.brandOfAxiomDc).toBe(calc.hemocraftSaveDc);
	});

	it("auto-grants Blood Curse of Corrosion at 15 without a known slot", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 15});
		state.ensureBloodHunterResources();
		expect(state._data.features.find(f => f.name === "Blood Curse of Corrosion")).toBeTruthy();
		expect(state.getFeatureCalculations().grantsBloodCurseOfCorrosion).toBe(true);
	});

	it("Exalted Mutation uses equal the Hemocraft modifier (level 18)", () => {
		const state = makeBloodHunter({subclass: "Order of the Mutant", level: 18, abilities: {int: 18}});
		const calc = state.getFeatureCalculations();
		expect(calc.exaltedMutationUses).toBe(calc.hemocraftModifier);
		expect(calc.exaltedMutationUses).toBe(4);

		addFeature(state, "Exalted Mutation", 18);
		state.ensureBloodHunterResources();
		const resource = state.getResource("Exalted Mutation");
		expect(resource.max).toBe(4);
		expect(resource.recharge).toBe("long");
	});
});

// ---------------------------------------------------------------------------
// Order of the Profane Soul
// ---------------------------------------------------------------------------
describe("Order of the Profane Soul (BH2022)", () => {
	function profaneSoul (level, abilities) {
		const state = makeBloodHunter({subclass: "Order of the Profane Soul", level, abilities});
		state.calculateSpellSlots();
		return state;
	}

	it("casts pact magic with the hemocraft ability (Intelligence by default)", () => {
		const state = profaneSoul(3);
		expect(state.getSpellcastingAbilityForClass("Blood Hunter")).toBe("int");
		expect(state.getFeatureCalculations().profaneSoulSpellcastingAbility).toBe("int");
	});

	it("follows the Wisdom choice for its spellcasting ability", () => {
		const state = makeBloodHunter({subclass: "Order of the Profane Soul", level: 3, abilities: {int: 10, wis: 18}});
		state.recordLevelChoice({
			level: 1,
			class: {name: "Blood Hunter", source: "BH2022"},
			choices: {featureChoices: [{featureName: "Hunter's Bane", choice: "Wisdom"}]},
		});
		expect(state.getSpellcastingAbilityForClass("Blood Hunter")).toBe("wis");
	});

	it.each([
		[3, 1, 1],
		[5, 1, 1],
		[6, 2, 1],
		[7, 2, 2],
		[12, 2, 2],
		[13, 2, 3],
		[18, 2, 3],
		[19, 2, 4],
		[20, 2, 4],
	])("has the reduced pact slot grid at level %i (%s slots of level %s)", (level, slots, slotLevel) => {
		const state = profaneSoul(level);
		expect(state._data.spellcasting.pactSlots.max).toBe(slots);
		expect(state._data.spellcasting.pactSlots.level).toBe(slotLevel);
	});

	it("has no pact slots before level 3", () => {
		const state = profaneSoul(2);
		expect(state._data.spellcasting.pactSlots.max).toBe(0);
	});

	it.each([
		[3, 2, 2],
		[5, 2, 3],
		[7, 2, 4],
		[9, 2, 5],
		[11, 3, 6],
		[15, 3, 8],
		[18, 3, 9],
		[19, 3, 10],
		[20, 3, 11],
	])("knows the reduced cantrips/spells at level %i (%s cantrips, %s spells)", (level, cantrips, spells) => {
		const calc = profaneSoul(level).getFeatureCalculations();
		expect(calc.profaneSoulCantripsKnown).toBe(cantrips);
		expect(calc.profaneSoulSpellsKnown).toBe(spells);
	});

	it("reads the chosen Otherworldly Patron", () => {
		const state = profaneSoul(3);
		expect(state.getFeatureCalculations().profaneSoulPatron).toBeNull();

		const chosen = makeBloodHunter({subclass: "Order of the Profane Soul", level: 3});
		chosen.recordLevelChoice({
			level: 3,
			class: {name: "Blood Hunter", source: "BH2022"},
			choices: {featureChoices: [{featureName: "Otherworldly Patron", choice: "The Fiend"}]},
		});
		expect(chosen.getFeatureCalculations().profaneSoulPatron).toBe("The Fiend");
	});

	it("Mystic Frenzy and Revealed Arcana come online at level 7", () => {
		expect(profaneSoul(6).getFeatureCalculations().hasMysticFrenzy).toBeUndefined();
		const calc = profaneSoul(7).getFeatureCalculations();
		expect(calc.hasMysticFrenzy).toBe(true);
		expect(calc.mysticFrenzyBonusAttack).toBe(true);
		expect(calc.hasRevealedArcana).toBe(true);
	});

	it("Brand of the Sapping Scar (11) and Unsealed Arcana (15) come online at their levels", () => {
		expect(profaneSoul(10).getFeatureCalculations().hasBrandOfTheSappingScar).toBeUndefined();
		expect(profaneSoul(11).getFeatureCalculations().hasBrandOfTheSappingScar).toBe(true);
		expect(profaneSoul(14).getFeatureCalculations().hasUnsealedArcana).toBeUndefined();
		expect(profaneSoul(15).getFeatureCalculations().hasUnsealedArcana).toBe(true);
	});

	it("auto-grants Blood Curse of the Souleater at 18 without a known slot", () => {
		const state = profaneSoul(18);
		state.ensureBloodHunterResources();
		expect(state._data.features.find(f => f.name === "Blood Curse of the Souleater")).toBeTruthy();
		expect(state.getFeatureCalculations().grantsBloodCurseOfTheSouleater).toBe(true);
	});

	it("does not perturb a real Warlock's pact slots", () => {
		const warlock = new CharacterSheetState();
		warlock.addClass({name: "Warlock", source: "PHB", level: 5, casterProgression: "pact"});
		warlock.setAbilityBase("cha", 16);
		warlock.calculateSpellSlots();
		// Warlock L5 = 2 slots of 3rd level (unchanged by the generalisation).
		expect(warlock._data.spellcasting.pactSlots.max).toBe(2);
		expect(warlock._data.spellcasting.pactSlots.level).toBe(3);
	});
});

describe("Blood Hunter — subclass-name resolution (CS-BUG-123)", () => {
	const mkCls = (cls, sub, lvl, src) => {
		const s = new CharacterSheetState();
		s._data.classes = [{name: cls, level: lvl, source: src, subclass: sub ? {name: sub, shortName: sub, source: src} : null}];
		return s;
	};

	test("warlock pact slots are NOT regressed by the table generalisation", () => {
		// Canonical warlock: L1=1 slot@1, L11=3 slots@5, L17=4 slots@5
		for (const [lvl, count, slotLvl] of [[1, 1, 1], [11, 3, 5], [17, 4, 5], [20, 4, 5]]) {
			const s = mkCls("Warlock", "The Fiend", lvl, "PHB");
			s.calculateSpellSlots();
			const pact = s._data.spellcasting.pactSlots || {};
			expect({lvl, max: pact.max, slotLvl: pact.level}).toEqual({lvl, max: count, slotLvl});
		}
	});

	test("Profane Soul gets a REDUCED pact grid, distinct from warlock", () => {
		const ps = mkCls("Blood Hunter", "Order of the Profane Soul", 19, "BH2022");
		const wl = mkCls("Warlock", "The Fiend", 19, "PHB");
		ps.calculateSpellSlots(); wl.calculateSpellSlots();
		const p = ps._data.spellcasting.pactSlots || {};
		const w = wl._data.spellcasting.pactSlots || {};
		// Profane Soul peaks at 2 slots of 4th level; warlock is far stronger.
		// Both pinned exactly: `toBeGreaterThan` would be satisfied by any wrong warlock
		// value above 4, which is precisely the loose-assertion defect CS-BUG-137 exposed.
		expect({max: p.max, level: p.level}).toEqual({max: 2, level: 4});
		expect({max: w.max, level: w.level}).toEqual({max: 4, level: 5});
	});

	test("Profane Soul pact grid resolves from shortName too (fails OPEN to warlock grid)", () => {
		const ps = mkCls("Blood Hunter", "Profane Soul", 19, "BH2022");
		ps.calculateSpellSlots();
		const p = ps._data.spellcasting.pactSlots || {};
		expect({max: p.max, level: p.level}).toEqual({max: 2, level: 4});
	});

	test("Stalker's Prowess speed is permanent, NOT hybrid-gated (CS-BUG-122)", () => {
		const s = mkCls("Blood Hunter", "Lycan", 7, "BH2022");
		// untransformed
		expect(s.getSpeedByType("walk")).toBe(40);
	});
});

/**
 * Writer/reader field-name divergence guards.
 *
 * A recurring silent-failure shape in this codebase: an effect is computed
 * correctly, then discarded by a reader that inspects a DIFFERENT field name
 * than the writer used (`{type,target,value}` vs `{damageType}` for damage
 * defences; `{type:"sense",target,value}` vs `{sense,range}` for senses). The
 * discard is a bare `continue`, indistinguishable from an unimplemented
 * feature. These tests pin the Blood Hunter effects that ride those two paths
 * so a reader change cannot silently strand them.
 */
describe("Blood Hunter — effects survive the writer/reader boundary", () => {
	const mk = (sub, lvl) => {
		const s = new CharacterSheetState();
		s._data.classes = [{name: "Blood Hunter",
			level: lvl,
			source: "BH2022",
			subclass: {name: `Order of the ${sub}`, shortName: sub, source: "BH2022"}}];
		return s;
	};

	test("sense effects actually reach getSense()", () => {
		const s = mk("Mutant", 11);
		const before = s.getSense("darkvision");
		s._data.activeMutagens = ["nighteye"];
		s._rebuildMutagenState();
		expect({before, after: s.getSense("darkvision")}).toEqual({before: 0, after: 60});
	});

	test("resistance effects actually reach getResistances()", () => {
		const s = mk("Mutant", 11);
		const names = Object.keys(CharacterSheetState.MUTAGENS);
		// find any mutagen whose benefit declares a resistance
		const withRes = names.find(n => (CharacterSheetState.MUTAGENS[n].effects(11, 0).benefit || [])
			.some(e => e.type === "resistance"));
		expect(typeof withRes).toBe("string");
		const target = CharacterSheetState.MUTAGENS[withRes].effects(11, 0).benefit.find(e => e.type === "resistance").target;
		s._data.activeMutagens = [withRes];
		s._rebuildMutagenState();
		const res = (s.getResistances?.() || []).map(String).join(",").toLowerCase();
		// The writer emits `damage:fire`; the reader normalises to `fire`. Assert the
		// NORMALISED form actually arrives — this is the exact writer/reader divergence
		// shape that silently drops effects elsewhere in the codebase.
		expect(res).toContain(String(target).toLowerCase().replace(/^damage:/, ""));
	});

	test("any PERMANENT non-walk speed grant in Blood Hunter is not silently zeroed", () => {
		// enumerate every non-walk speed BH could grant outside an active state
		const s = mk("Lycan", 20);
		const permanent = ["fly", "swim", "climb", "burrow"].map(t => [t, s.getSpeedByType(t)]);
		// Blood Hunter grants NO permanent non-walk speed; all are state-gated.
		expect(Object.fromEntries(permanent)).toEqual({fly: 0, swim: 0, climb: 0, burrow: 0});
	});

	test("hybrid form grants no climb speed, because the 2022 source grants none", () => {
		// Guards against a plausible-but-wrong "fix": the Mercer 2022 Blood Hunter text
		// contains no climbing speed anywhere. Hybrid form must not invent one.
		const s = mk("Lycan", 20);
		s._data.features = [{name: "Hybrid Transformation", className: "Blood Hunter", source: "BH2022", level: 3}];
		s.ensureBloodHunterResources?.();
		s.activateHybridTransformation?.();
		expect(s.getSpeedByType("climb")).toBe(0);
	});
});
