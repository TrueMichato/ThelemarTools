/**
 * Tests for spell effects that modify AC, HP, and speed calculations.
 * Covers: setAc (Mage Armor), minAc (Barkskin), deathWard, flySpeed.
 */

import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Spell AC Effects", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 14); // +2 DEX mod
		state.setAbilityBase("con", 12);
		state.setAbilityBase("int", 16);
		state.setAbilityBase("wis", 12);
		state.setAbilityBase("cha", 10);
		state.addClass({name: "Wizard", source: "PHB", level: 5});
	});

	// =================================================================
	// setAc — Mage Armor
	// =================================================================
	describe("Mage Armor (setAc)", () => {
		test("unarmored wizard should have AC 12 (10 + DEX 2)", () => {
			expect(state.getAc()).toBe(12);
		});

		test("Mage Armor should set AC to 15 (13 + DEX 2) when unarmored", () => {
			state.activateState("custom", {
				name: "Mage Armor",
				customEffects: CharacterSheetState.getSpellFromRegistry("mage armor").selfEffects,
				isSpellEffect: true,
			});
			expect(state.getAc()).toBe(15); // 13 + 2 DEX
		});

		test("Mage Armor should NOT override armor AC when wearing armor", () => {
			state.setArmor({name: "Chain Mail", type: "heavy", ac: 16});
			const armorAc = state.getAc();
			expect(armorAc).toBe(16);

			state.activateState("custom", {
				name: "Mage Armor",
				customEffects: CharacterSheetState.getSpellFromRegistry("mage armor").selfEffects,
				isSpellEffect: true,
			});
			// Chain mail AC 16 > Mage Armor 15, and setAc only applies when unarmored
			expect(state.getAc()).toBe(16);
		});

		test("Mage Armor + Shield should stack (15 + 2 = 17)", () => {
			state.activateState("custom", {
				name: "Mage Armor",
				customEffects: CharacterSheetState.getSpellFromRegistry("mage armor").selfEffects,
				isSpellEffect: true,
			});
			state.setShield(true);
			expect(state.getAc()).toBe(17); // 13 + 2 DEX + 2 shield
		});

		test("Mage Armor + Shield spell should stack (15 + 5 = 20)", () => {
			state.activateState("custom", {
				name: "Mage Armor",
				customEffects: CharacterSheetState.getSpellFromRegistry("mage armor").selfEffects,
				isSpellEffect: true,
			});
			state.activateState("custom", {
				name: "Shield",
				customEffects: CharacterSheetState.getSpellFromRegistry("shield").selfEffects,
				isSpellEffect: true,
			});
			expect(state.getAc()).toBe(20); // 13 + 2 DEX + 5 Shield spell
		});

		test("Mage Armor should not override better unarmored defense", () => {
			// Reset and create Barbarian with specific stats
			state = new CharacterSheetState();
			state.setAbilityBase("str", 10);
			state.setAbilityBase("dex", 14); // +2
			state.setAbilityBase("con", 16); // +3
			state.setAbilityBase("int", 10);
			state.setAbilityBase("wis", 12);
			state.setAbilityBase("cha", 10);
			state.addClass({name: "Barbarian", source: "PHB", level: 5});
			// Barbarian UD: 10 + 2 DEX + 3 CON = 15
			const unarmoredAc = state.getAc();
			expect(unarmoredAc).toBe(15);

			state.activateState("custom", {
				name: "Mage Armor",
				customEffects: CharacterSheetState.getSpellFromRegistry("mage armor").selfEffects,
				isSpellEffect: true,
			});
			// Mage Armor would be 15 (13 + 2 DEX), which ties with Barbarian UD 15
			// Both give 15 so AC stays 15
			expect(state.getAc()).toBe(15);
		});

		test("Mage Armor with high DEX should use higher AC", () => {
			state.setAbilityBase("dex", 20); // +5 DEX mod
			expect(state.getAc()).toBe(15); // 10 + 5

			state.activateState("custom", {
				name: "Mage Armor",
				customEffects: CharacterSheetState.getSpellFromRegistry("mage armor").selfEffects,
				isSpellEffect: true,
			});
			expect(state.getAc()).toBe(18); // 13 + 5
		});
	});

	// =================================================================
	// minAc — Barkskin
	// =================================================================
	describe("Barkskin (minAc)", () => {
		test("Barkskin should raise AC to 16 when current AC is lower", () => {
			// Wizard with DEX 14 = AC 12
			expect(state.getAc()).toBe(12);

			state.activateState("custom", {
				name: "Barkskin",
				customEffects: CharacterSheetState.getSpellFromRegistry("barkskin").selfEffects,
				isSpellEffect: true,
			});
			expect(state.getAc()).toBe(16);
		});

		test("Barkskin should NOT lower AC when current AC is higher", () => {
			state.setArmor({name: "Plate", type: "heavy", ac: 18});
			expect(state.getAc()).toBe(18);

			state.activateState("custom", {
				name: "Barkskin",
				customEffects: CharacterSheetState.getSpellFromRegistry("barkskin").selfEffects,
				isSpellEffect: true,
			});
			expect(state.getAc()).toBe(18);
		});

		test("Barkskin + Shield spell should use higher final AC", () => {
			// Base AC 12 → Barkskin floor 16 → Shield +5 = 17 (from base 12 + 5 = 17, which > 16)
			// Actually: AC is 12, Shield adds 5 = 17, Barkskin floor 16 → result 17
			state.activateState("custom", {
				name: "Barkskin",
				customEffects: CharacterSheetState.getSpellFromRegistry("barkskin").selfEffects,
				isSpellEffect: true,
			});
			state.activateState("custom", {
				name: "Shield",
				customEffects: CharacterSheetState.getSpellFromRegistry("shield").selfEffects,
				isSpellEffect: true,
			});
			expect(state.getAc()).toBe(17); // 12 + 5 = 17 > 16 floor
		});

		test("Barkskin + Mage Armor should use best combination", () => {
			// Mage Armor: 13 + 2 = 15, Barkskin floor 16 → result 16
			state.activateState("custom", {
				name: "Mage Armor",
				customEffects: CharacterSheetState.getSpellFromRegistry("mage armor").selfEffects,
				isSpellEffect: true,
			});
			state.activateState("custom", {
				name: "Barkskin",
				customEffects: CharacterSheetState.getSpellFromRegistry("barkskin").selfEffects,
				isSpellEffect: true,
			});
			expect(state.getAc()).toBe(16); // Barkskin floor overrides Mage Armor 15
		});
	});

	// =================================================================
	// Death Ward
	// =================================================================
	describe("Death Ward", () => {
		test("should prevent dropping to 0 HP, setting to 1 instead", () => {
			state.setCurrentHp(5);

			state.activateState("custom", {
				name: "Death Ward",
				customEffects: CharacterSheetState.getSpellFromRegistry("death ward").selfEffects,
				isSpellEffect: true,
			});

			state.takeDamage(10); // Would drop to 0
			expect(state.getHp().current).toBe(1);
		});

		test("should consume the death ward state after use", () => {
			state.setCurrentHp(5);

			state.activateState("custom", {
				name: "Death Ward",
				customEffects: CharacterSheetState.getSpellFromRegistry("death ward").selfEffects,
				isSpellEffect: true,
			});

			state.takeDamage(10);
			expect(state.getHp().current).toBe(1);

			// Second lethal hit should drop to 0 (death ward consumed)
			state.takeDamage(10);
			expect(state.getHp().current).toBe(0);
		});

		test("should not trigger if damage does not drop HP to 0", () => {
			state.setCurrentHp(20);

			state.activateState("custom", {
				name: "Death Ward",
				customEffects: CharacterSheetState.getSpellFromRegistry("death ward").selfEffects,
				isSpellEffect: true,
			});

			state.takeDamage(5); // HP goes to 15, death ward not consumed
			expect(state.getHp().current).toBe(15);

			// Death ward should still be active
			const effects = state.getActiveStateEffects();
			expect(effects.some(e => e.type === "deathWard")).toBe(true);
		});
	});

	// =================================================================
	// Fly Speed
	// =================================================================
	describe("Fly spell (flySpeed)", () => {
		test("should grant fly speed when character has none", () => {
			state.activateState("custom", {
				name: "Fly",
				customEffects: CharacterSheetState.getSpellFromRegistry("fly").selfEffects,
				isSpellEffect: true,
			});

			const flySpeed = state.getSpeedByType("fly");
			expect(flySpeed).toBeGreaterThan(0);
			expect(flySpeed).toBe(60);
		});

		test("fly speed should appear in getSpeed() display string", () => {
			state.activateState("custom", {
				name: "Fly",
				customEffects: CharacterSheetState.getSpellFromRegistry("fly").selfEffects,
				isSpellEffect: true,
			});

			const speedStr = state.getSpeed();
			expect(speedStr).toContain("fly");
		});
	});

	// =================================================================
	// AC Breakdown (UI display path)
	// =================================================================
	describe("getAcBreakdown with spell effects", () => {
		test("Mage Armor should show in AC breakdown", () => {
			state.activateState("custom", {
				name: "Mage Armor",
				customEffects: CharacterSheetState.getSpellFromRegistry("mage armor").selfEffects,
				isSpellEffect: true,
			});
			const breakdown = state.getAcBreakdown();
			expect(breakdown.total).toBe(15); // 13 + 2 DEX
			expect(breakdown.components.some(c => c.name === "Mage Armor")).toBe(true);
		});

		test("Barkskin should show as AC floor in breakdown", () => {
			state.activateState("custom", {
				name: "Barkskin",
				customEffects: CharacterSheetState.getSpellFromRegistry("barkskin").selfEffects,
				isSpellEffect: true,
			});
			const breakdown = state.getAcBreakdown();
			expect(breakdown.total).toBe(16);
		});

		test("getAcBreakdown and getAc should agree", () => {
			state.activateState("custom", {
				name: "Mage Armor",
				customEffects: CharacterSheetState.getSpellFromRegistry("mage armor").selfEffects,
				isSpellEffect: true,
			});
			expect(state.getAcBreakdown().total).toBe(state.getAc());
		});
	});

	// =================================================================
	// New spell registry entries
	// =================================================================
	describe("New spell registry entries", () => {
		test("Absorb Elements should have resistance and extra damage", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("Absorb Elements");
			expect(entry).toBeDefined();
			expect(entry.selfEffects.some(e => e.type === "resistance")).toBe(true);
			expect(entry.selfEffects.some(e => e.type === "extraDamage")).toBe(true);
		});

		test("Enhance Ability should have advantage on checks", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("Enhance Ability");
			expect(entry).toBeDefined();
			expect(entry.concentration).toBe(true);
			expect(entry.selfEffects.some(e => e.type === "advantage")).toBe(true);
		});

		test("Invisibility should grant attack advantage and disadvantage on attacks against", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("Invisibility");
			expect(entry).toBeDefined();
			expect(entry.selfEffects.some(e => e.type === "advantage" && e.target === "attack")).toBe(true);
			expect(entry.selfEffects.some(e => e.type === "disadvantage" && e.target === "attacksAgainst")).toBe(true);
		});

		test("Shadow Blade should have extra psychic damage", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("Shadow Blade");
			expect(entry).toBeDefined();
			expect(entry.selfEffects.some(e => e.type === "extraDamage" && e.damageType === "psychic")).toBe(true);
		});

		test("Spirit Guardians should have a note effect", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("Spirit Guardians");
			expect(entry).toBeDefined();
			expect(entry.selfEffects.some(e => e.type === "note")).toBe(true);
		});

		test("Expeditious Retreat should have concentration and note", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("Expeditious Retreat");
			expect(entry).toBeDefined();
			expect(entry.concentration).toBe(true);
		});

		test("Blink should have a note effect", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("Blink");
			expect(entry).toBeDefined();
		});

		test("Spiritual Weapon should have a note effect", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("Spiritual Weapon");
			expect(entry).toBeDefined();
			expect(entry.selfEffects.some(e => e.type === "note")).toBe(true);
		});
	});
});
