import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

function makeShadowKnight (level, {wis = 16} = {}) {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 18);
	state.setAbilityBase("wis", wis);
	state.addClass({
		name: "Fighter",
		source: "PHB",
		level,
		subclass: {
			name: "Shadow Knight",
			shortName: "Shadow Knight",
			source: "GriffonsSaddlebag4",
		},
	});
	return state;
}

describe("Fighter: Shadow Knight (TGS4)", () => {
	it("is source- and level-gated", () => {
		expect(makeShadowKnight(2).getFeatureCalculations().hasShadowKnight).toBeUndefined();

		const wrongSource = new CharacterSheetState();
		wrongSource.addClass({
			name: "Fighter",
			source: "PHB",
			level: 20,
			subclass: {shortName: "Shadow Knight", source: "OtherBrew"},
		});
		expect(wrongSource.getFeatureCalculations().hasShadowKnight).toBeUndefined();
	});

	it("grants exact Dark Gaze and Manifest Shadow mechanics at level 3", () => {
		const state = makeShadowKnight(3);
		const calc = state.getFeatureCalculations();
		expect(calc.darkGazeRange).toBe(60);
		expect(calc.darkGazeSeesMagicalDarkness).toBe(true);
		expect(state.getSenses().darkvision).toBe(60);

		expect(state.getFeatureGrantedAttacks()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "Shadow Weapon (One-Handed)",
				damage: "1d8",
				damageType: "psychic",
				abilityMod: "finesse",
				range: "Melee or 20/60 ft.",
				properties: expect.arrayContaining(["Finesse", "Light", "Thrown"]),
				ignoresLongRangeDisadvantage: true,
				isShadowWeapon: true,
			}),
			expect.objectContaining({
				name: "Shadow Weapon (Two-Handed)",
				damage: "1d10",
				damageType: "psychic",
				properties: expect.arrayContaining(["Two-Handed"]),
			}),
		]));
	});

	it("calculates Wisdom Shadowcasting DC and proficiency-bonus short-rest uses", () => {
		const state = makeShadowKnight(10, {wis: 16});
		const calc = state.getFeatureCalculations();
		expect(calc.shadowcastingSaveDc).toBe(15);
		expect(state.getShadowcastingResource()).toEqual(expect.objectContaining({
			name: "Shadowcasting",
			current: 4,
			max: 4,
			recharge: "short",
		}));
	});

	it("applies Shadowbite's exact damage, save, advantage interaction, and target rider", () => {
		const state = makeShadowKnight(3);
		const result = state.useShadowbite({hadAttackAdvantage: true});
		expect(result).toEqual({
			damage: "1d8",
			damageType: "psychic",
			saveAbility: "con",
			saveDc: 13,
			saveDisadvantage: true,
			targetNextAttackDisadvantage: true,
			targetEffectExpires: "end of your next turn",
		});
		expect(state.getShadowcastingResource().current).toBe(1);
	});

	it("coats a selected physical weapon as a one-hour shadow weapon", () => {
		const state = makeShadowKnight(3);
		expect(state.coatShadowWeapon({weaponId: "auto_sword", weaponName: "Longsword"})).toBe(true);
		expect(state.getUmbralCoatedWeapon()).toEqual({weaponId: "auto_sword", weaponName: "Longsword"});
		expect(state.isStateTypeActive("umbralCoating")).toBe(true);
		expect(state.getShadowcastingResource().current).toBe(1);
		expect(state.coatShadowWeapon({weaponId: "auto_bow", weaponName: "Shortbow"})).toBe(true);
		expect(state.coatShadowWeapon({weaponId: "auto_dagger", weaponName: "Dagger"})).toBe(false);
	});

	it("removes armor Stealth disadvantage and applies dim-light Dexterity-save advantage at level 7", () => {
		const state = makeShadowKnight(7);
		state._data.ac.armor = {name: "Plate", type: "heavy", stealth: true};
		expect(state.hasArmorStealthDisadvantage()).toBe(false);
		expect(state.setShadowKnightDimLightActive(true)).toBe(true);
		expect(state.hasAdvantageFromStates("save:dex")).toBe(true);
	});

	it("surfaces and executes all three level-10 Shadowcasting options", () => {
		const state = makeShadowKnight(10);
		expect(state.getFeatureCalculations().shadowcastingOptions).toEqual([
			"Shadowbite",
			"Umbral Coating",
			"Cloak of Shadow",
			"Darkness",
			"Eyes of the Dark",
		]);

		expect(state.useShadowcastingOption("Cloak of Shadow")).toEqual(expect.objectContaining({
			actionType: "action",
			grantsBonusActionAttack: true,
		}));
		expect(state.hasAdvantageFromStates("skill:stealth")).toBe(true);
		expect(state.isStateTypeActive("improvedShadowcastingAttack")).toBe(true);

		expect(state.useShadowcastingOption("Darkness")).toEqual(expect.objectContaining({actionType: "action"}));
		expect(state.isConcentrating()).toBe(true);
		expect(state.getConcentration().name).toBe("Darkness");

		expect(state.useShadowcastingOption("Eyes of the Dark")).toEqual(expect.objectContaining({
			actionType: "bonus",
			grantsBonusActionAttack: false,
		}));
		expect(state.getSenseBonusFromStates("darkvision")).toBe(60);
	});

	it("tracks Shadow Sneak and ends its invisibility on an attack or spell", () => {
		const state = makeShadowKnight(15);
		expect(state.getShadowSneakResource()).toEqual(expect.objectContaining({current: 1, max: 1, recharge: "short"}));
		expect(state.useShadowSneak()).toBe(true);
		expect(state.isStateTypeActive("shadowSneak")).toBe(true);
		expect(state.getConditions()).toEqual(expect.arrayContaining([expect.objectContaining({name: "invisible"})]));

		state.consumeStatesEndingOnSpellCast();
		expect(state.isStateTypeActive("shadowSneak")).toBe(false);
		expect(state.getConditions()).not.toEqual(expect.arrayContaining([expect.objectContaining({name: "invisible"})]));
		expect(state.useShadowSneak()).toBe(false);
	});

	it("treats Shadowcasting Darkness as a concentration spell cast", () => {
		const state = makeShadowKnight(15);
		expect(state.useShadowSneak()).toBe(true);
		expect(state.useShadowcastingOption("Darkness")).toEqual(expect.objectContaining({option: "Darkness"}));
		expect(state.isStateTypeActive("shadowSneak")).toBe(false);
		expect(state.isStateTypeActive("shadowKnightDarkness")).toBe(true);

		state.breakConcentration();
		expect(state.isStateTypeActive("shadowKnightDarkness")).toBe(false);
	});

	it("applies Cover of Darkness as real half-cover bonuses at level 18", () => {
		const state = makeShadowKnight(18);
		const baseAcStateBonus = state.getBonusFromStates("ac");
		expect(state.setShadowKnightDimLightActive(true)).toBe(true);
		expect(state.getBonusFromStates("ac") - baseAcStateBonus).toBe(2);
		expect(state.getBonusFromStates("save:dex")).toBe(2);
		expect(state.hasAdvantageFromStates("save:dex")).toBe(true);
	});
});
