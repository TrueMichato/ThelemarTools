import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;

function getBloodHunterState ({level = 1, lycan = false} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Blood Hunter", source: "BH2022", level});
	if (lycan) state.setSubclass("Blood Hunter", {name: "Order of the Lycan", shortName: "Lycan", source: "BH2022"});
	state.setAbilityBase("int", 12);
	state.setAbilityBase("wis", 16);
	state.setAbilityBase("con", 16);
	state.setAbilityBase("str", 14);
	state.setAbilityBase("dex", 16);
	state.setMaxHp(100);
	state.setCurrentHp(100);
	return state;
}

function addResourceFeature (state, name, level) {
	state.addFeature({
		name,
		level,
		className: "Blood Hunter",
		source: "BH2022",
		description: `${name} class feature`,
	});
}

describe("Blood Hunter (BH2022)", () => {
	it.each([
		[1, "1d4", 1, 1],
		[6, "1d6", 2, 2],
		[13, "1d8", 3, 3],
		[17, "1d10", 4, 4],
		[18, "1d10", 4, 5],
	])("scales hemocraft and Blood Maledict at level %i", (level, die, uses, cursesKnown) => {
		const state = getBloodHunterState({level});
		const calc = state.getFeatureCalculations();
		expect(calc.hemocraftAbility).toBe("wis");
		expect(calc.hemocraftDie).toBe(die);
		expect(calc.hemocraftSaveDc).toBe(8 + state.getProficiencyBonus() + 3);
		expect(calc.bloodMaledictUses).toBe(uses);
		expect(calc.bloodCursesKnown).toBe(cursesKnown);
	});

	it("persists the Hemocraft ability choice instead of switching to the higher score", () => {
		const state = getBloodHunterState({level: 1});
		state.recordLevelChoice({
			level: 1,
			class: {name: "Blood Hunter", source: "BH2022"},
			choices: {featureChoices: [{featureName: "Hunter's Bane", choice: "Intelligence"}]},
		});
		expect(state.getFeatureCalculations()).toMatchObject({
			hemocraftAbility: "int",
			hemocraftModifier: 1,
			hemocraftSaveDc: 11,
		});
		state.setAbilityBase("wis", 20);
		expect(state.getFeatureCalculations().hemocraftAbility).toBe("int");
	});

	it("floats multi-attribute ability DCs through the generic feature-option engine", () => {
		const groups = CharacterSheetClassUtils.findFeatureOptions({
			name: "Hunter's Bane",
			source: "BH2022",
			entries: [{type: "abilityDc", name: "Hemocraft", attributes: ["int", "wis"]}],
		});
		expect(groups).toContainEqual(expect.objectContaining({
			count: 1,
			options: [
				expect.objectContaining({name: "Intelligence", type: "inline"}),
				expect.objectContaining({name: "Wisdom", type: "inline"}),
			],
		}));
	});

	it("floats Blood Curse, Crimson Rite, and Fighting Style choices through the generic progression engine", () => {
		const state = getBloodHunterState({level: 7});
		const classData = {
			optionalfeatureProgression: [
				{name: "Blood Curses", featureType: ["BC"], progression: [1, 1, 1, 1, 1, 2, 2]},
				{name: "Crimson Rites", featureType: ["CR"], progression: [0, 1, 1, 1, 1, 1, 2]},
				{name: "Fighting Style", featureType: ["FS:F"], progression: [0, 1, 1, 1, 1, 1, 1]},
			],
		};
		const gains = CharacterSheetClassUtils.getOptionalFeatureGains(classData, 0, 7, state);
		expect(gains).toEqual(expect.arrayContaining([
			expect.objectContaining({featureTypes: ["BC"], totalCount: 2}),
			expect.objectContaining({featureTypes: ["CR"], totalCount: 2}),
			expect.objectContaining({featureTypes: ["FS:F"], totalCount: 1}),
		]));
	});

	it("routes chosen Blood Curses through the shared Blood Maledict pool", () => {
		const activation = CharacterSheetState.detectActivatableFeature({
			name: "Blood Curse of the Marked",
			optionalFeatureTypes: ["BC"],
			entries: ["Mark a creature with your blood curse."],
		});
		expect(activation).toMatchObject({
			resourceName: "Blood Maledict",
			resourceCost: 1,
			interactionMode: "limited",
		});
	});

	it("spends and restores the shared Blood Maledict pool while amplification costs HP", () => {
		const state = getBloodHunterState({level: 6});
		addResourceFeature(state, "Blood Maledict", 1);
		state.ensureBloodHunterResources();
		expect(state.getResource("Blood Maledict")).toMatchObject({current: 2, max: 2, recharge: "short"});
		expect(state.useBloodMaledict({amplify: true, roll: 5})).toBe(true);
		expect(state.getResource("Blood Maledict").current).toBe(1);
		expect(state.getCurrentHp()).toBe(95);
		state.setResourceCurrent(state.getResource("Blood Maledict").id, state.getResource("Blood Maledict").max);
		expect(state.getResource("Blood Maledict").current).toBe(2);
	});

	it("activates a typed Crimson Rite rider and pays the hemocraft HP cost", () => {
		const state = getBloodHunterState({level: 7});
		expect(state.activateCrimsonRite("Rite of the Storm", {roll: 4, weaponId: "weapon-1", weaponName: "Longsword"})).toBe(true);
		expect(state.getCurrentHp()).toBe(96);
		expect(state.isStateTypeActive("crimsonRite")).toBe(true);
		expect(state.getExtraDamageFromStates()).toContainEqual(expect.objectContaining({
			dice: "1d6",
			damageType: "lightning",
			weaponId: "weapon-1",
		}));
	});

	it("lets Crimson Rite target an active Predatory Strike", () => {
		const state = getBloodHunterState({level: 7, lycan: true});
		addResourceFeature(state, "Hybrid Transformation", 3);
		expect(state.activateHybridTransformation()).toBe(true);
		const predatoryStrikes = state.getActiveStateAttacks().filter(attack => attack.name.startsWith("Predatory Strike"));
		expect(predatoryStrikes).toEqual(expect.arrayContaining([
			expect.objectContaining({damageType: "bludgeoning", riteWeaponId: "hybrid-predatory-strikes"}),
			expect.objectContaining({damageType: "slashing", riteWeaponId: "hybrid-predatory-strikes"}),
		]));
		expect(state.activateCrimsonRite("Rite of the Flame", {
			roll: 2,
			weaponId: predatoryStrikes[0].riteWeaponId,
			weaponName: "Predatory Strikes",
		})).toBe(true);
		expect(state.getExtraDamageFromStates()).toContainEqual(expect.objectContaining({
			weaponId: "hybrid-predatory-strikes",
		}));
	});

	it("keeps rites on multiple weapons, bypasses temporary HP, and ends rites on rest", () => {
		const state = getBloodHunterState({level: 7});
		state.setTempHp(10);
		expect(state.activateCrimsonRite("Rite of the Flame", {roll: 2, weaponId: "weapon-1", weaponName: "Longsword"})).toBe(true);
		expect(state.activateCrimsonRite("Rite of the Storm", {roll: 3, weaponId: "weapon-2", weaponName: "Longbow"})).toBe(true);
		expect(state.getCurrentHp()).toBe(95);
		expect(state.getTempHp()).toBe(10);
		expect(state.getExtraDamageFromStates()).toEqual(expect.arrayContaining([
			expect.objectContaining({damageType: "fire", weaponId: "weapon-1"}),
			expect.objectContaining({damageType: "lightning", weaponId: "weapon-2"}),
		]));
		state.onShortRest();
		expect(state.isStateTypeActive("crimsonRite")).toBe(false);
	});

	it("ends finite Hybrid Transformation on rest but preserves mastery transformations", () => {
		const finite = getBloodHunterState({level: 11, lycan: true});
		addResourceFeature(finite, "Hybrid Transformation", 3);
		expect(finite.activateHybridTransformation()).toBe(true);
		finite.onShortRest();
		expect(finite.isStateTypeActive("hybridTransformation")).toBe(false);

		const mastery = getBloodHunterState({level: 18, lycan: true});
		addResourceFeature(mastery, "Hybrid Transformation", 3);
		expect(mastery.activateHybridTransformation()).toBe(true);
		mastery.onShortRest();
		expect(mastery.isStateTypeActive("hybridTransformation")).toBe(true);
	});

	it("transforms a level 3 Lycan with AC, defenses, and a predatory strike", () => {
		const state = getBloodHunterState({level: 3, lycan: true});
		addResourceFeature(state, "Hybrid Transformation", 3);
		const baseAc = state.getAc();
		expect(state.activateHybridTransformation()).toBe(true);
		expect(state.getResource("Hybrid Transformation").current).toBe(0);
		expect(state.getAc()).toBe(baseAc + 1);
		expect(state.hasAdvantageFromStates("check:str")).toBe(true);
		expect(state.hasAdvantageFromStates("save:str")).toBe(true);
		expect(state.getEffectiveDefenses()).toMatchObject({
			resistances: [],
			conditionalResistances: expect.arrayContaining([
				{type: "bludgeoning", conditional: "nonmagical, nonsilvered attacks"},
				{type: "piercing", conditional: "nonmagical, nonsilvered attacks"},
				{type: "slashing", conditional: "nonmagical, nonsilvered attacks"},
			]),
		});
		expect(state.getActiveStateAttacks()).toContainEqual(expect.objectContaining({
			name: "Predatory Strike (Bludgeoning)",
			damage: "1d6",
		}));
	});

	it("scales Lycan transformation uses, attacks, regeneration, and mastery", () => {
		const level11 = getBloodHunterState({level: 11, lycan: true});
		addResourceFeature(level11, "Hybrid Transformation", 3);
		level11.ensureBloodHunterResources();
		expect(level11.getResource("Hybrid Transformation").max).toBe(2);
		expect(level11.getFeatureCalculations()).toMatchObject({
			hybridNaturalWeaponDamage: "1d8",
			hybridAttackBonus: 2,
			hybridDamageBonus: 2,
			hybridRegeneration: 4,
		});
		expect(level11.activateHybridTransformation()).toBe(true);
		expect(level11.getWalkSpeed()).toBe(45);
		level11.setCurrentHp(40);
		level11.startCombat();
		expect(level11.getCurrentHp()).toBe(44);
		expect(level11.getHybridBloodlustCheck()).not.toBeNull();
		level11.setCurrentHp(40);
		level11.advanceRound();
		expect(level11.getCurrentHp()).toBe(44);

		const level18 = getBloodHunterState({level: 18, lycan: true});
		addResourceFeature(level18, "Hybrid Transformation", 3);
		expect(level18.activateHybridTransformation()).toBe(true);
		level18.deactivateState("hybridTransformation");
		expect(level18.isStateTypeActive("hybridTransformation")).toBe(false);
		expect(level18.activateHybridTransformation()).toBe(true);
		expect(level18.getFeatureCalculations()).toMatchObject({
			hasHybridTransformationMastery: true,
			hybridAttackBonus: 3,
			hybridDamageBonus: 3,
			grantsBloodCurseOfTheHowl: true,
		});

		expect(level18.getFeatures()).toContainEqual(expect.objectContaining({
			name: "Blood Curse of the Howl",
			optionalFeatureTypes: ["BC"],
		}));
		expect(level18.getGenericPoolResources().some(r => r.name === "Hybrid Transformation")).toBe(false);
	});

	it("automatically reverts Hybrid Transformation at 0 HP", () => {
		const state = getBloodHunterState({level: 11, lycan: true});
		addResourceFeature(state, "Hybrid Transformation", 3);
		expect(state.activateHybridTransformation()).toBe(true);
		state.setCurrentHp(0);
		expect(state.isStateTypeActive("hybridTransformation")).toBe(false);
	});

	it("tracks Brand of Castigation as a short-rest resource with scaled retaliation", () => {
		const state = getBloodHunterState({level: 13});
		addResourceFeature(state, "Brand of Castigation", 6);
		state.ensureBloodHunterResources();
		expect(state.getResource("Brand of Castigation")).toMatchObject({current: 1, max: 1, recharge: "short"});
		expect(state.getFeatureCalculations()).toMatchObject({
			brandDamage: 6,
			brandTetherDamage: "4d6",
		});
	});

	it("applies Dark Augmentation to physical saving throws", () => {
		const state = getBloodHunterState({level: 10});
		expect(state.getWalkSpeed()).toBe(35);
		expect(state.getSaveMod("str")).toBe(5);
		expect(state.getSaveMod("dex")).toBe(6);
		expect(state.getSaveMod("con")).toBe(6);
		expect(state.getSaveMod("wis")).toBe(3);
	});

	it("surfaces Bloodlust below half HP with Voracious advantage and automatic failure", () => {
		const state = getBloodHunterState({level: 15, lycan: true});
		addResourceFeature(state, "Hybrid Transformation", 3);
		expect(state.activateHybridTransformation()).toBe(true);
		state.setCurrentHp(49);
		expect(state.getHybridBloodlustCheck()).toMatchObject({
			dc: 8,
			bonus: 3,
			advantage: true,
			automaticFailure: false,
		});
		state.setConcentrating({spellName: "Hex"});
		expect(state.getHybridBloodlustCheck().automaticFailure).toBe(true);
	});

	it("uses Sanguine Mastery to keep the lower of two Hemocraft cost rolls once per round", () => {
		const state = getBloodHunterState({level: 20});
		addResourceFeature(state, "Blood Maledict", 1);
		state.ensureBloodHunterResources();
		state.startCombat();
		const randomise = RollerUtil.randomise;
		RollerUtil.randomise = jest.fn().mockReturnValueOnce(8).mockReturnValueOnce(3).mockReturnValueOnce(7);
		try {
			expect(state.useBloodMaledict({amplify: true})).toBe(true);
			expect(state.getCurrentHp()).toBe(97);
			expect(state.useBloodMaledict({amplify: true})).toBe(true);
			expect(state.getCurrentHp()).toBe(90);
			expect(state.canUseSanguineMasteryReroll()).toBe(false);
			state.endCombat();
			state.startCombat();
			expect(state.canUseSanguineMasteryReroll()).toBe(true);
		} finally {
			RollerUtil.randomise = randomise;
		}
	});

	it("restores Blood Maledict on a rite critical at level 20", () => {
		const state = getBloodHunterState({level: 20});
		addResourceFeature(state, "Blood Maledict", 1);
		state.ensureBloodHunterResources();
		state.setResourceCurrent(state.getResource("Blood Maledict").id, 2);
		expect(state.activateCrimsonRite("Rite of the Flame", {roll: 1, weaponId: "weapon-1"})).toBe(true);
		expect(state.restoreBloodMaledictOnRiteCritical("weapon-2")).toBe(false);
		expect(state.restoreBloodMaledictOnRiteCritical("weapon-1")).toBe(true);
		expect(state.getResource("Blood Maledict").current).toBe(3);
	});
});
