/**
 * Character Sheet Combat - Unit Tests
 * Tests for attack calculations, damage rolls, initiative, death saves, and combat mechanics
 *
 * NOTE: This test file uses the actual API methods:
 * - setDeathSaves({successes, failures}) instead of addDeathSaveSuccess/Failure
 * - getAc() not getAC()
 * - setAbilityBase/getAbilityMod for stat calculations
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

describe("Combat Calculations", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		// Set up a basic level 5 fighter
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 16); // +3
		state.setAbilityBase("dex", 14); // +2
		state.setAbilityBase("con", 14); // +2
		// Fighter is proficient with all simple and martial weapons
		state.addWeaponProficiency("simple");
		state.addWeaponProficiency("martial");
	});

	// ==========================================================================
	// Attack Bonus Calculations
	// ==========================================================================
	describe("Attack Bonus", () => {
		it("should calculate melee attack bonus (STR + prof) via updateAttackFromWeapon", () => {
			// Level 5 = +3 prof, STR 16 = +3
			const attack = state.updateAttackFromWeapon({
				name: "Longsword",
				weaponCategory: "martial",
				dmg1: "1d8",
				dmgType: "slashing",
			});
			expect(attack.attackBonus).toBe(6); // 3 (STR) + 3 (prof)
		});

		it("should calculate ranged attack bonus (DEX + prof)", () => {
			// Level 5 = +3 prof, DEX 14 = +2
			const attack = state.updateAttackFromWeapon({
				name: "Longbow",
				weaponCategory: "martial",
				type: "R", // Ranged
				dmg1: "1d8",
				dmgType: "piercing",
			});
			expect(attack.attackBonus).toBe(5); // 2 (DEX) + 3 (prof)
		});

		it("should use proficiency bonus based on level", () => {
			const state2 = new CharacterSheetState();
			state2.addClass({name: "Fighter", source: "PHB", level: 1});
			state2.setAbilityBase("str", 16);
			state2.addWeaponProficiency("simple");
			// Level 1 = +2 prof
			const attack = state2.updateAttackFromWeapon({name: "Sword", weaponCategory: "simple", dmg1: "1d8"});
			expect(attack.attackBonus).toBe(5); // 3 + 2
		});

		it("should scale with level progression", () => {
			const state9 = new CharacterSheetState();
			state9.addClass({name: "Fighter", source: "PHB", level: 9});
			state9.setAbilityBase("str", 16);
			state9.addWeaponProficiency("martial");
			// Level 9 = +4 prof
			const attack = state9.updateAttackFromWeapon({name: "Sword", weaponCategory: "martial", dmg1: "1d8"});
			expect(attack.attackBonus).toBe(7); // 3 + 4
		});
	});

	// ==========================================================================
	// Damage Calculations
	// ==========================================================================
	describe("Damage Calculations", () => {
		it("should add STR modifier to melee damage", () => {
			const attack = state.updateAttackFromWeapon({name: "Sword", dmg1: "1d8"});
			// STR 16 = +3, so damage should include +3
			expect(attack.damage).toBe("1d8+3");
		});

		it("should add DEX modifier to ranged damage", () => {
			const attack = state.updateAttackFromWeapon({
				name: "Shortbow",
				type: "R",
				dmg1: "1d6",
			});
			// DEX 14 = +2
			expect(attack.damage).toBe("1d6+2");
		});

		it("should use higher of STR/DEX for finesse weapons", () => {
			// With STR 16 (+3) and DEX 14 (+2), should use STR
			const attack = state.updateAttackFromWeapon({
				name: "Rapier",
				property: ["F"], // Finesse
				dmg1: "1d8",
			});
			expect(attack.damage).toBe("1d8+3"); // Uses STR since it's higher
		});
	});

	// ==========================================================================
	// Initiative
	// ==========================================================================
	describe("Initiative", () => {
		it("should calculate initiative as DEX modifier", () => {
			expect(state.getInitiative()).toBe(2); // DEX 14 = +2
		});

		it("should update with DEX changes", () => {
			state.setAbilityBase("dex", 18);
			expect(state.getInitiative()).toBe(4);
		});

		it("should include initiative bonuses from features", () => {
			state.setCustomModifier("initiative", 5); // Alert feat
			expect(state.getInitiative()).toBe(7); // 2 + 5
		});

		it("should handle negative DEX modifier", () => {
			state.setAbilityBase("dex", 6);
			expect(state.getInitiative()).toBe(-2);
		});
	});

	// ==========================================================================
	// Death Saves
	// ==========================================================================
	describe("Death Saves", () => {
		it("should start with 0 successes and failures", () => {
			const saves = state.getDeathSaves();
			expect(saves.successes).toBe(0);
			expect(saves.failures).toBe(0);
		});

		it("should track death save successes", () => {
			state.setDeathSaves({successes: 2, failures: 0});
			expect(state.getDeathSaves().successes).toBe(2);
		});

		it("should track death save failures", () => {
			state.setDeathSaves({successes: 0, failures: 1});
			expect(state.getDeathSaves().failures).toBe(1);
		});

		it("should cap successes at 3", () => {
			state.setDeathSaves({successes: 5, failures: 0});
			expect(state.getDeathSaves().successes).toBe(3);
		});

		it("should cap failures at 3", () => {
			state.setDeathSaves({successes: 0, failures: 5});
			expect(state.getDeathSaves().failures).toBe(3);
		});

		it("should reset death saves", () => {
			state.setDeathSaves({successes: 2, failures: 1});
			state.resetDeathSaves();
			const saves = state.getDeathSaves();
			expect(saves.successes).toBe(0);
			expect(saves.failures).toBe(0);
		});
	});

	// ==========================================================================
	// Armor Class
	// ==========================================================================
	describe("Armor Class in Combat", () => {
		it("should calculate unarmored AC (10 + DEX)", () => {
			expect(state.getAc()).toBe(12); // 10 + 2 DEX
		});

		it("should apply shield bonus in combat", () => {
			state.setShield(true);
			expect(state.getAc()).toBe(14); // 10 + 2 DEX + 2 shield
		});

		it("should apply item AC bonus", () => {
			state.setItemAcBonus(2);
			expect(state.getAc()).toBe(14); // 12 + 2 item bonus
		});

		it("should combine armor and custom modifiers", () => {
			state.setArmor({name: "Plate", ac: 18, type: "heavy"});
			state.setShield(true);
			expect(state.getAc()).toBe(20); // 18 + 2 shield
		});
	});

	// ==========================================================================
	// Conditions
	// ==========================================================================
	describe("Conditions", () => {
		it("should track active conditions", () => {
			state.addCondition("frightened");
			expect(state.hasCondition("frightened")).toBe(true);
		});

		it("should remove conditions", () => {
			state.addCondition("poisoned");
			state.removeCondition("poisoned");
			expect(state.hasCondition("poisoned")).toBe(false);
		});

		it("should list all active conditions", () => {
			state.addCondition("blinded");
			state.addCondition("deafened");
			const conditionNames = state.getConditionNames();
			expect(conditionNames).toContain("blinded");
			expect(conditionNames).toContain("deafened");
		});

		it("should not duplicate conditions", () => {
			state.addCondition("prone");
			state.addCondition("prone");
			const conditionNames = state.getConditionNames();
			expect(conditionNames.filter(c => c === "prone").length).toBe(1);
		});

		it("should clear all conditions", () => {
			state.addCondition("stunned");
			state.addCondition("restrained");
			state.clearConditions();
			expect(state.getConditions()).toHaveLength(0);
		});
	});

	// ==========================================================================
	// Exhaustion
	// ==========================================================================
	describe("Exhaustion", () => {
		it("should track exhaustion level", () => {
			state.setExhaustion(1);
			expect(state.getExhaustion()).toBe(1);
		});

		it("should cap exhaustion at maximum based on rules", () => {
			const maxExhaustion = state.getMaxExhaustion();
			state.setExhaustion(100); // Set way above max
			expect(state.getExhaustion()).toBe(maxExhaustion);
		});

		it("should cap exhaustion at 6 with 2024 rules", () => {
			state.setExhaustionRules("2024");
			state.setExhaustion(10);
			expect(state.getExhaustion()).toBeLessThanOrEqual(6);
		});

		it("should cap exhaustion at 10 with thelemar rules", () => {
			state.setExhaustionRules("thelemar");
			state.setExhaustion(15);
			expect(state.getExhaustion()).toBeLessThanOrEqual(10);
		});

		it("should not allow negative exhaustion", () => {
			state.setExhaustion(-1);
			expect(state.getExhaustion()).toBe(0);
		});
	});

	// ==========================================================================
	// Concentration
	// ==========================================================================
	describe("Concentration", () => {
		it("should track concentrating spell", () => {
			state.setConcentration("Bless", 1);
			expect(state.isConcentrating()).toBe(true);
		});

		it("should get concentrating spell info", () => {
			state.setConcentration("Haste", 3);
			const spell = state.getConcentration();
			expect(spell.spellName).toBe("Haste");
			expect(spell.spellLevel).toBe(3);
		});

		it("should break concentration", () => {
			state.setConcentration("Fly", 3);
			state.breakConcentration();
			expect(state.isConcentrating()).toBe(false);
		});

		it("should calculate concentration save DC", () => {
			// DC = 10 or half damage, whichever is higher
			expect(state.getConcentrationSaveDC(15)).toBe(10);
			expect(state.getConcentrationSaveDC(30)).toBe(15);
			expect(state.getConcentrationSaveDC(50)).toBe(25);
		});
	});

	// ==========================================================================
	// Resistances and Immunities
	// ==========================================================================
	describe("Resistances and Immunities", () => {
		it("should track damage resistances", () => {
			state.addResistance("fire");
			expect(state.getResistances()).toContain("fire");
		});

		it("should track damage immunities", () => {
			state.addImmunity("poison");
			expect(state.getImmunities()).toContain("poison");
		});

		it("should track damage vulnerabilities", () => {
			state.addVulnerability("radiant");
			expect(state.getVulnerabilities()).toContain("radiant");
		});

		it("should track condition immunities", () => {
			state.addConditionImmunity("charmed");
			expect(state.getConditionImmunities()).toContain("charmed");
		});

		it("should not duplicate resistances", () => {
			state.addResistance("fire");
			state.addResistance("fire");
			expect(state.getResistances().filter(r => r === "fire").length).toBe(1);
		});
	});

	// ==========================================================================
	// Temporary Hit Points
	// ==========================================================================
	describe("Temporary Hit Points in Combat", () => {
		beforeEach(() => {
			state.setMaxHp(44);
			state.setCurrentHp(44);
		});

		it("should add temp HP", () => {
			state.setTempHp(10);
			expect(state.getTempHp()).toBe(10);
		});

		it("should not allow negative temp HP", () => {
			state.setTempHp(-5);
			expect(state.getTempHp()).toBe(0);
		});
	});

	// ==========================================================================
	// Attacks and Weapons
	// ==========================================================================
	describe("Attacks", () => {
		it("should add a weapon attack", () => {
			const initialAttacks = state.getAttacks().length;
			state.addAttack({
				name: "Longsword",
				attackBonus: 6,
				damage: "1d8+3",
				damageType: "slashing",
			});
			const attacks = state.getAttacks();
			expect(attacks).toHaveLength(initialAttacks + 1);
			expect(attacks.find(a => a.name === "Longsword")).toBeTruthy();
		});

		it("should remove an attack", () => {
			state.addAttack({
				name: "Greatsword",
				attackBonus: 6,
				damage: "2d6+3",
				damageType: "slashing",
			});
			const attacks = state.getAttacks();
			const greatsword = attacks.find(a => a.name === "Greatsword");
			state.removeAttack(greatsword.id);
			expect(state.getAttacks().find(a => a.name === "Greatsword")).toBeFalsy();
		});

		it("should update attack from weapon item", () => {
			const attack = state.updateAttackFromWeapon({
				name: "Handaxe",
				weaponCategory: "simple",
				dmg1: "1d6",
				dmgType: "slashing",
			});
			expect(attack.name).toBe("Handaxe");
			expect(attack.attackBonus).toBe(6); // STR 16 (+3) + prof 5 (+3)
		});

		it("should track ranged attack range", () => {
			state.addAttack({
				name: "Longbow",
				attackBonus: 5,
				damage: "1d8+2",
				damageType: "piercing",
				range: "150/600",
			});
			const attack = state.getAttacks().find(a => a.name === "Longbow");
			expect(attack.range).toBe("150/600");
		});

		it("should track weapon properties", () => {
			state.addAttack({
				name: "Rapier",
				attackBonus: 5,
				damage: "1d8+2",
				damageType: "piercing",
				properties: ["finesse"],
			});
			const attack = state.getAttacks().find(a => a.name === "Rapier");
			expect(attack.properties).toContain("finesse");
		});
	});
});

// ==========================================================================
// Multiclass Combat Calculations
// ==========================================================================
describe("Multiclass Combat", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		// Fighter 3 / Rogue 2 multiclass
		state.addClass({name: "Fighter", source: "PHB", level: 3});
		state.addClass({name: "Rogue", source: "PHB", level: 2});
		state.setAbilityBase("str", 14); // +2
		state.setAbilityBase("dex", 16); // +3
		// Add weapon proficiencies (Fighter gets all, Rogue gets simple + martial melee)
		state.addWeaponProficiency("simple");
		state.addWeaponProficiency("martial");
	});

	it("should use total level for proficiency bonus", () => {
		// Level 5 total = +3 prof
		expect(state.getProficiencyBonus()).toBe(3);
	});

	it("should calculate melee attack via updateAttackFromWeapon", () => {
		const attack = state.updateAttackFromWeapon({
			name: "Longsword",
			weaponCategory: "martial",
			dmg1: "1d8",
		});
		// STR attack = +2 STR + 3 prof = +5
		expect(attack.attackBonus).toBe(5);
	});

	it("should calculate ranged/finesse attack via updateAttackFromWeapon", () => {
		const attack = state.updateAttackFromWeapon({
			name: "Rapier",
			weaponCategory: "martial",
			property: ["F"], // Finesse
			dmg1: "1d8",
		});
		// DEX attack = +3 DEX + 3 prof = +6 (uses DEX since it's higher)
		expect(attack.attackBonus).toBe(6);
	});

	it("should generate multiclass class summary", () => {
		const summary = state.getClassSummary();
		expect(summary).toContain("Fighter");
		expect(summary).toContain("Rogue");
	});
});

describe("Combat-tab attack exhaustion", () => {
	function makeCombat ({rules, exhaustion}) {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 16);
		state.setExhaustionRules(rules);
		state.setExhaustion(exhaustion);
		state.addAttack({id: "sword", name: "Longsword", isMelee: true, type: "melee", abilityMod: "str", range: "melee", damage: "1d8"});

		const captured = [];
		const rollD20Calls = [];
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._battleTacticToggles = {};
		combat._flankingEnabled = false;
		combat._state = state;
		combat._page = {
			rollD20: (opts) => {
				rollD20Calls.push(opts);
				return {roll: 10, roll1: 10, roll2: 10, mode: "normal"};
			},
			getModeLabel: () => "",
			formatD20Breakdown: (roll, modifier, extra = "") => `1d20 (${roll.roll}) + ${modifier}${extra}`,
			pAnimateD20: () => {},
			showDiceResult: (result) => { captured.push(result); return null; },
			_offerGuidedStrikePostAttack: () => {},
		};
		combat._renderSneakAttackToggle = () => {};
		combat._isSneakAttackAvailableThisTurn = () => false;
		combat._runPostAttackHooks = async () => {};
		combat._consumeOnAttackStates = () => {};
		combat._clearPendingSpellRider = () => {};

		return {combat, captured, rollD20Calls};
	}

	test.each([
		["2024", 1, 2],
		["2024", 2, 4],
		["2024", 3, 6],
		["thelemar", 1, 1],
		["thelemar", 2, 2],
		["thelemar", 3, 3],
		["2014", 1, 0],
		["2014", 2, 0],
		["2014", 3, 0],
	])("%s exhaustion %i reduces the live attack by %i", (rules, exhaustion, penalty) => {
		const {combat, captured, rollD20Calls} = makeCombat({rules, exhaustion});

		combat._rollAttack("sword");

		expect(captured).toHaveLength(1);
		expect(rollD20Calls[0].isAttack).toBe(true);
		expect(captured[0].modifier).toBe(6 - penalty);
		expect(captured[0].total).toBe(16 - penalty);
		if (penalty) expect(captured[0].subtitle).toContain(`- ${penalty} (exhaustion)`);
		else expect(captured[0].subtitle).not.toContain("exhaustion");
	});
});
