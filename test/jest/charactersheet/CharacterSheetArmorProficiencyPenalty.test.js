/**
 * Character Sheet — Armor Non-Proficiency Penalties (Bug 4, 5e RAW)
 *
 * Wearing armor / wielding a shield you lack proficiency with imposes:
 *   - Disadvantage on any STR/DEX ability check, saving throw, or attack roll.
 *   - Inability to cast spells.
 * AC is NOT reduced by RAW (not asserted here — verified elsewhere).
 *
 * Disadvantage is injected at the single aggregation choke point
 * (aggregateModifiers), so the four roll handlers consume it unchanged via
 * aggregateModifiers()/getAdvantageState(). We assert at that layer plus the
 * exposed detection flags.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

/** Build a wizard (proficient with NO armor and NO shields) wearing heavy armor. */
function buildHeavyArmorWizard () {
	const state = new CharacterSheetState();
	state.addClass({name: "Wizard", source: "PHB", level: 5});
	state.setAbilityBase("str", 14); // +2
	state.setAbilityBase("dex", 14); // +2
	state.setAbilityBase("wis", 14); // +2
	state.setAbilityBase("int", 16); // +3
	state.setAbilityBase("cha", 12); // +1
	// Wizard has no armor proficiency at all.
	state.setArmor({name: "Plate", ac: 18, type: "heavy"});
	return state;
}

describe("Armor Non-Proficiency Penalties (5e RAW)", () => {
	describe("Heavy armor without proficiency", () => {
		let state;
		beforeEach(() => { state = buildHeavyArmorWizard(); });

		it("detects the non-proficient armor and blocks spellcasting", () => {
			expect(state.isWearingNonProficientArmor()).toBe(true);
			expect(state.isWearingNonProficientShield()).toBe(false);
			expect(state.isSpellcastingBlockedByArmor()).toBe(true);
		});

		it("imposes disadvantage on STR and DEX saving throws", () => {
			expect(state.getAdvantageState("save:str").disadvantage).toBe(true);
			expect(state.getAdvantageState("save:dex").disadvantage).toBe(true);
			expect(state.aggregateModifiers("save:str").disadvantage).toBe(true);
			expect(state.aggregateModifiers("save:dex").disadvantage).toBe(true);
		});

		it("does NOT affect WIS, INT, or CHA saving throws", () => {
			expect(state.getAdvantageState("save:wis").disadvantage).toBe(false);
			expect(state.getAdvantageState("save:int").disadvantage).toBe(false);
			expect(state.getAdvantageState("save:cha").disadvantage).toBe(false);
			expect(state.aggregateModifiers("save:wis").disadvantage).toBe(false);
		});

		it("imposes disadvantage on STR/DEX ability checks but not others", () => {
			expect(state.getAdvantageState("check:str").disadvantage).toBe(true);
			expect(state.getAdvantageState("check:dex").disadvantage).toBe(true);
			expect(state.getAdvantageState("check:wis").disadvantage).toBe(false);
			expect(state.getAdvantageState("check:int").disadvantage).toBe(false);
		});

		it("imposes disadvantage on a DEX-based skill (Stealth) via skill and check pools", () => {
			// Skill roll handler ORs skill:<key> with check:<skillAbility>.
			expect(state.getAdvantageState("skill:stealth").disadvantage).toBe(true);
			expect(state.aggregateModifiers("skill:stealth").disadvantage).toBe(true);
			expect(state.aggregateModifiers("check:dex").disadvantage).toBe(true);
		});

		it("imposes disadvantage on a STR-based skill (Athletics) but not a WIS skill (Perception)", () => {
			expect(state.getAdvantageState("skill:athletics").disadvantage).toBe(true);
			expect(state.getAdvantageState("skill:perception").disadvantage).toBe(false);
		});

		it("imposes disadvantage on STR and DEX attack rolls", () => {
			expect(state.getAdvantageState("attack:melee:str").disadvantage).toBe(true);
			expect(state.getAdvantageState("attack:ranged:dex").disadvantage).toBe(true);
			expect(state.aggregateModifiers("attack:melee:str").disadvantage).toBe(true);
			// Default melee (no ability segment) resolves to STR → disadvantage.
			expect(state.getAdvantageState("attack:melee").disadvantage).toBe(true);
		});

		it("imposes disadvantage on FINESSE attack rolls (finesse resolves to STR/DEX)", () => {
			// Finesse weapons (and TGTT natural weapons) encode abilityMod "finesse",
			// producing attackType "attack:melee:finesse". Since finesse uses STR or DEX
			// (both penalised), it must also take disadvantage — previously it slipped through.
			expect(state.getAdvantageState("attack:melee:finesse").disadvantage).toBe(true);
			expect(state.aggregateModifiers("attack:melee:finesse").disadvantage).toBe(true);
		});

		it("does NOT impose disadvantage on a non-STR/DEX (spell) attack", () => {
			expect(state.getAdvantageState("attack:ranged:int").disadvantage).toBe(false);
			expect(state.getAdvantageState("attack:melee:cha").disadvantage).toBe(false);
		});

		it("names the penalty source in the aggregated breakdown", () => {
			expect(state.aggregateModifiers("save:str").sources).toContain("Non-Proficient Armor");
		});
	});

	describe("Removing the penalty", () => {
		it("clears all penalties when armor proficiency is granted", () => {
			const state = buildHeavyArmorWizard();
			expect(state.isSpellcastingBlockedByArmor()).toBe(true);

			state.addArmorProficiency("heavy");

			expect(state.isWearingNonProficientArmor()).toBe(false);
			expect(state.isSpellcastingBlockedByArmor()).toBe(false);
			expect(state.getAdvantageState("save:str").disadvantage).toBe(false);
			expect(state.getAdvantageState("skill:stealth").disadvantage).toBe(false);
			expect(state.getAdvantageState("attack:melee:str").disadvantage).toBe(false);
			expect(state.aggregateModifiers("save:str").sources).not.toContain("Non-Proficient Armor");
		});

		it("clears all penalties when the armor is unequipped", () => {
			const state = buildHeavyArmorWizard();
			expect(state.getAdvantageState("save:dex").disadvantage).toBe(true);

			state.setArmor(null);

			expect(state.isWearingNonProficientArmor()).toBe(false);
			expect(state.isSpellcastingBlockedByArmor()).toBe(false);
			expect(state.getAdvantageState("save:dex").disadvantage).toBe(false);
		});
	});

	describe("Proficient armor imposes no penalty", () => {
		it("a fighter in heavy armor has no disadvantage and can cast", () => {
			const state = new CharacterSheetState();
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state.addArmorProficiency("light");
			state.addArmorProficiency("medium");
			state.addArmorProficiency("heavy");
			state.addArmorProficiency("shields");
			state.setArmor({name: "Plate", ac: 18, type: "heavy"});
			state.setShield(true);

			expect(state.isWearingNonProficientArmor()).toBe(false);
			expect(state.isWearingNonProficientShield()).toBe(false);
			expect(state.isSpellcastingBlockedByArmor()).toBe(false);
			expect(state.getAdvantageState("save:str").disadvantage).toBe(false);
			expect(state.getAdvantageState("attack:melee:str").disadvantage).toBe(false);
			expect(state.getAdvantageState("attack:melee:finesse").disadvantage).toBe(false);
		});
	});

	describe("Non-proficient shield alone", () => {
		it("blocks casting and disadvantages STR/DEX rolls even in proficient armor", () => {
			const state = new CharacterSheetState();
			state.addClass({name: "Cleric", source: "PHB", level: 5});
			state.addArmorProficiency("light");
			state.addArmorProficiency("medium");
			// Cleric proficient with medium armor but NOT shields in this build.
			state.setArmor({name: "Half Plate", ac: 15, type: "medium"});
			state.setShield(true);

			expect(state.isWearingNonProficientArmor()).toBe(false);
			expect(state.isWearingNonProficientShield()).toBe(true);
			expect(state.isSpellcastingBlockedByArmor()).toBe(true);
			expect(state.getAdvantageState("attack:melee:str").disadvantage).toBe(true);
			expect(state.getAdvantageState("save:dex").disadvantage).toBe(true);
			expect(state.getAdvantageState("save:wis").disadvantage).toBe(false);
		});
	});

	describe("Net advantage composition", () => {
		it("cancels to normal when an advantage source is also present on the same roll", () => {
			const state = buildHeavyArmorWizard();
			// Add a STR-save advantage modifier — armor disadvantage should cancel it out.
			state.addNamedModifier?.({name: "Test Boon", type: "save:str:advantage", value: 1, enabled: true});
			const adv = state.getAdvantageState("save:str");
			expect(adv.disadvantage).toBe(false);
			expect(adv.advantage).toBe(false);
			expect(adv.cancelled).toBe(true);
		});
	});

	describe("Not gated behind TGTT (core RAW)", () => {
		it("applies identically whether enableTgtt is true or false", () => {
			const on = buildHeavyArmorWizard();
			on.setSetting("enableTgtt", true);
			const off = buildHeavyArmorWizard();
			off.setSetting("enableTgtt", false);

			for (const s of [on, off]) {
				expect(s.isSpellcastingBlockedByArmor()).toBe(true);
				expect(s.getAdvantageState("save:str").disadvantage).toBe(true);
				expect(s.getAdvantageState("attack:ranged:dex").disadvantage).toBe(true);
			}
		});
	});

	// The state layer only EXPOSES isSpellcastingBlockedByArmor(); the actual refusal
	// lives in the Spells manager's shared casting-constraint choke point
	// (_checkCastingConstraints), consumed by every real cast path via
	// _pHandleCastingConstraints. These tests drive that pure function directly.
	describe("Casting block enforcement (spells.js _checkCastingConstraints)", () => {
		const SPELL = {name: "Fireball", source: "PHB", level: 3};
		const SPELL_DATA = {name: "Fireball", source: "PHB", components: {v: true, s: true}};

		/** Minimal Spells manager with a stubbed state, mirroring CharacterSheetSpellcastingFlow. */
		const makeSpells = ({blocked = false, ignore = false} = {}) => {
			const spells = Object.create(CharacterSheetSpells.prototype);
			spells._page = {saveCharacter () {}};
			spells._allSpells = [];
			spells._state = {
				getSettings: () => ({ignoreSpellcastingRestrictions: ignore}),
				isIncapacitated: () => false,
				getConditionNames: () => [],
				getCastingConstraints: () => ({verbal: [], somatic: []}),
				getActiveStates: () => [],
				getFeatures: () => [],
				isSpellcastingBlockedByArmor: () => blocked,
			};
			return spells;
		};

		it("refuses a slot/cantrip/ritual cast (enforceMaterial) when armor blocks casting", () => {
			const spells = makeSpells({blocked: true});
			const {block} = spells._checkCastingConstraints(SPELL, SPELL_DATA, null, {enforceMaterial: true});
			expect(block).toMatch(/proficiency/i);
			expect(block).toContain("Fireball");
		});

		it("does NOT block when the character is proficient (positive guard)", () => {
			const spells = makeSpells({blocked: false});
			const result = spells._checkCastingConstraints(SPELL, SPELL_DATA, null, {enforceMaterial: true});
			expect(result.block).toBeNull();
		});

		it("does NOT block innate / item casting (no enforceMaterial) even in non-proficient armor", () => {
			const spells = makeSpells({blocked: true});
			const result = spells._checkCastingConstraints(SPELL, SPELL_DATA, null);
			expect(result.block).toBeNull();
		});

		it("respects the ignoreSpellcastingRestrictions escape hatch", () => {
			const spells = makeSpells({blocked: true, ignore: true});
			const result = spells._checkCastingConstraints(SPELL, SPELL_DATA, null, {enforceMaterial: true});
			expect(result).toEqual({block: null, checks: []});
		});
	});
});
