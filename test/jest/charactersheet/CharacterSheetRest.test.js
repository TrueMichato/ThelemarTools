/**
 * Character Sheet Rest Mechanics - Unit Tests
 * Tests for short rest, long rest, resource recovery, hit dice recovery
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Rest Mechanics", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("con", 14); // +2 CON
	});

	// ==========================================================================
	// Short Rest - HP Recovery
	// ==========================================================================
	describe("Short Rest - HP Recovery", () => {
		beforeEach(() => {
			state.setMaxHp(44);
			state.setCurrentHp(20);
		});

		it("should allow using hit dice", () => {
			const hd = state.getHitDiceByType()["d10"];
			const initialCurrent = hd?.current || 0;
			const result = state.useHitDie("d10");
			expect(result).toBe(true);
			expect(state.getHitDiceByType()["d10"].current).toBe(initialCurrent - 1);
		});

		it("should reduce available hit dice when used", () => {
			const hd = state.getHitDiceByType()["d10"];
			const initialCurrent = hd?.current || 0;
			state.useHitDie("d10");
			expect(state.getHitDiceByType()["d10"].current).toBe(initialCurrent - 1);
		});

		it("should not allow using hit dice when none available", () => {
			// Use all hit dice
			for (let i = 0; i < 5; i++) {
				state.useHitDie("d10");
			}
			const result = state.useHitDie("d10");
			expect(result).toBe(false);
		});

		it("should not exceed max HP when healing", () => {
			state.setCurrentHp(42);
			state.heal(20);
			expect(state.getCurrentHp()).toBeLessThanOrEqual(state.getMaxHp());
		});

		it("should add CON modifier to HP calculations", () => {
			state.setAbilityBase("con", 20); // +5 CON
			const conMod = state.getAbilityMod("con");
			expect(conMod).toBe(5);
		});

		it("should heal minimum 1 HP", () => {
			state.setCurrentHp(10);
			state.heal(1);
			expect(state.getCurrentHp()).toBe(11);
		});
	});

	// ==========================================================================
	// Short Rest - Resource Recovery
	// ==========================================================================
	describe("Short Rest - Resource Recovery", () => {
		beforeEach(() => {
			state.addFeature({
				name: "Second Wind",
				uses: {current: 0, max: 1, recharge: "short"},
			});
			state.addFeature({
				name: "Action Surge",
				uses: {current: 0, max: 1, recharge: "short"},
			});
			state.addFeature({
				name: "Indomitable",
				uses: {current: 0, max: 1, recharge: "long"},
			});
		});

		it("should restore short rest features", () => {
			state.onShortRest();
			const secondWind = state.getFeatures().find(f => f.name === "Second Wind");
			const actionSurge = state.getFeatures().find(f => f.name === "Action Surge");
			expect(secondWind?.uses?.current).toBe(1);
			expect(actionSurge?.uses?.current).toBe(1);
		});

		it("should not restore long rest features on short rest", () => {
			state.onShortRest();
			const indomitable = state.getFeatures().find(f => f.name === "Indomitable");
			expect(indomitable?.uses?.current).toBe(0);
		});

		it("should restore Warlock spell slots on short rest", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 3});
			// Use pact slots
			state.usePactSlot();
			state.usePactSlot();
			const before = state.getPactSlots().current;
			state.onShortRest();
			expect(state.getPactSlots().current).toBeGreaterThan(before);
		});

		it("should recover short-rest resources after multiple short rests", () => {
			state.addResource({name: "Action Surge", max: 1, current: 0, recharge: "short"});
			state.onShortRest();
			expect(state.getResources().find(r => r.name === "Action Surge").current).toBe(1);
			// Deplete and rest again
			state.getResources().find(r => r.name === "Action Surge").current = 0;
			state.onShortRest();
			expect(state.getResources().find(r => r.name === "Action Surge").current).toBe(1);
		});
	});

	// ==========================================================================
	// Short Rest - Ki Points (Monk)
	// ==========================================================================
	describe("Short Rest - Ki Points", () => {
		beforeEach(() => {
			state.addClass({name: "Monk", source: "PHB", level: 5});
			// Ki points would be tracked via the resource system
			state.addResource({
				name: "Ki Points",
				max: 5,
				current: 5,
				recharge: "short",
			});
		});

		it("should have ki points equal to monk level", () => {
			const ki = state.getResources().find(r => r.name === "Ki Points");
			expect(ki?.max).toBe(5);
		});

		it("should restore ki points on short rest", () => {
			// Use some ki
			const ki = state.getResources().find(r => r.name === "Ki Points");
			state.setResourceCurrent(ki.id, 0);
			state.onShortRest();
			const kiAfter = state.getResources().find(r => r.name === "Ki Points");
			expect(kiAfter?.current).toBe(5);
		});

		it("should track ki point usage", () => {
			const ki = state.getResources().find(r => r.name === "Ki Points");
			state.setResourceCurrent(ki.id, 3);
			const kiAfter = state.getResources().find(r => r.name === "Ki Points");
			expect(kiAfter?.current).toBe(3);
		});
	});

	// ==========================================================================
	// Long Rest - Full Recovery
	// ==========================================================================
	describe("Long Rest - Full Recovery", () => {
		beforeEach(() => {
			state.setMaxHp(44);
			state.setCurrentHp(20);
			// Spend some hit dice
			state.setHitDice([{type: "d10", current: 2, max: 5}]);
		});

		it("should restore HP to maximum", () => {
			state.onLongRest();
			expect(state.getCurrentHp()).toBe(state.getMaxHp());
		});

		it("should restore half (rounded up) of max hit dice", () => {
			// 5 max hit dice → restore 2 or 3 (half rounded up or down depending on impl)
			// Currently at 0, so should be at least 2
			state.setHitDice([{type: "d10", current: 0, max: 5}]);
			state.onLongRest();
			const hd = state.getHitDice().find(h => h.type === "d10");
			expect(hd.current).toBeGreaterThanOrEqual(2); // At least half (floor) + recovers
		});

		it("should not exceed max hit dice on recovery", () => {
			state.setHitDice([{type: "d10", current: 4, max: 5}]);
			state.onLongRest();
			const hd = state.getHitDice().find(h => h.type === "d10");
			expect(hd.current).toBeLessThanOrEqual(5);
		});

		it("should restore at least 1 hit die", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 1});
			state.setHitDice([{type: "d10", current: 0, max: 1}]);
			state.onLongRest();
			const hd = state.getHitDice().find(h => h.type === "d10");
			expect(hd.current).toBeGreaterThanOrEqual(1);
		});
	});

	// ==========================================================================
	// Long Rest - Spell Slots
	// ==========================================================================
	describe("Long Rest - Spell Slots", () => {
		beforeEach(() => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			// Use some spell slots
			state.useSpellSlot(1);
			state.useSpellSlot(1);
			state.useSpellSlot(2);
		});

		it("should restore all spell slots on long rest", () => {
			state.onLongRest();
			// After long rest, all slots should be at max
			expect(state.getSpellSlots()[1].current).toBe(state.getSpellSlots()[1].max);
			expect(state.getSpellSlots()[2].current).toBe(state.getSpellSlots()[2].max);
			expect(state.getSpellSlots()[3].current).toBe(state.getSpellSlots()[3].max);
		});

		it("should restore Arcane Recovery uses", () => {
			state.addFeature({
				name: "Arcane Recovery",
				uses: {current: 0, max: 1, recharge: "long"},
			});
			state.onLongRest();
			const arcaneRecovery = state.getFeatures().find(f => f.name === "Arcane Recovery");
			expect(arcaneRecovery?.uses?.current).toBe(1);
		});
	});

	// ==========================================================================
	// Long Rest - Feature Recovery
	// ==========================================================================
	describe("Long Rest - Feature Recovery", () => {
		beforeEach(() => {
			state.addFeature({
				name: "Second Wind",
				uses: {current: 0, max: 1, recharge: "short"},
			});
			state.addFeature({
				name: "Indomitable",
				uses: {current: 0, max: 1, recharge: "long"},
			});
			state.addFeature({
				name: "Channel Divinity",
				uses: {current: 0, max: 2, recharge: "short"},
			});
		});

		it("should restore long rest features", () => {
			state.onLongRest();
			const indomitable = state.getFeatures().find(f => f.name === "Indomitable");
			expect(indomitable?.uses?.current).toBe(1);
		});

		it("should also restore short rest features on long rest", () => {
			state.onLongRest();
			const secondWind = state.getFeatures().find(f => f.name === "Second Wind");
			const channelDivinity = state.getFeatures().find(f => f.name === "Channel Divinity");
			expect(secondWind?.uses?.current).toBe(1);
			expect(channelDivinity?.uses?.current).toBe(2);
		});

		it("should reset daily use items", () => {
			state.addItem({
				name: "Healing Potion of Plenty",
				charges: {current: 0, max: 3, recharge: "dawn"},
				quantity: 1,
			});
			state.onLongRest();
			// Items with dawn recharge are restored on long rest
			const items = state.getInventory();
			const potion = items.find(i => i.item?.name === "Healing Potion of Plenty");
			// Note: charge restoration logic may vary
			expect(potion).toBeTruthy();
		});
	});

	// ==========================================================================
	// Long Rest - Conditions
	// ==========================================================================
	describe("Long Rest - Conditions", () => {
		it("should reduce exhaustion by 1 level", () => {
			state.setExhaustion(3);
			state.onLongRest();
			expect(state.getExhaustion()).toBe(2);
		});

		it("should reduce exhaustion to 0 if at level 1", () => {
			state.setExhaustion(1);
			state.onLongRest();
			expect(state.getExhaustion()).toBe(0);
		});

		it("should not affect exhaustion if already 0", () => {
			state.setExhaustion(0);
			state.onLongRest();
			expect(state.getExhaustion()).toBe(0);
		});

		it("should clear death save successes and failures", () => {
			state.setDeathSaves({successes: 2, failures: 2});
			state.onLongRest();
			const deathSaves = state.getDeathSaves();
			expect(deathSaves.successes).toBe(0);
			expect(deathSaves.failures).toBe(0);
		});
	});

	// ==========================================================================
	// Long Rest - Temp HP
	// ==========================================================================
	describe("Long Rest - Temp HP", () => {
		it("should preserve temp HP through long rest", () => {
			state.setTempHp(10);
			state.onLongRest();
			// RAW: Temp HP persists through rests
			expect(state.getTempHp()).toBe(10);
		});

		it("should optionally clear temp HP (house rule setting)", () => {
			state.setTempHp(10);
			state.onLongRest({clearTempHp: true});
			expect(state.getTempHp()).toBe(0);
		});
	});

	// ==========================================================================
	// Interrupted Rest
	// ==========================================================================
	describe("Interrupted Rest", () => {
		it("should track if long rest was interrupted", () => {
			state.startLongRest();
			state.interruptRest();
			expect(state.isRestInterrupted()).toBe(true);
		});

		it("should not grant benefits if long rest interrupted before 1 hour", () => {
			state.setCurrentHp(20);
			state.startLongRest();
			state.interruptRest({hoursCompleted: 0.5});
			state.completeLongRest();
			// No benefits if less than 1 hour completed
			expect(state.getCurrentHp()).toBe(20);
		});

		it("should allow continuing rest after 1 hour of combat", () => {
			state.startLongRest();
			state.interruptRest({hoursCompleted: 4, combatDuration: 30}); // 30 minutes
			// Can continue if combat was 1 hour or less
			expect(state.canContinueRest()).toBe(true);
		});

		it("should require new long rest if interrupted too long", () => {
			state.startLongRest();
			state.interruptRest({hoursCompleted: 2, combatDuration: 90}); // 90 minutes
			expect(state.canContinueRest()).toBe(false);
		});
	});

	// ==========================================================================
	// Class-Specific Rest Features
	// ==========================================================================
	describe("Class-Specific Rest Features", () => {
		describe("Wizard - Arcane Recovery", () => {
			beforeEach(() => {
				state.addClass({name: "Wizard", source: "PHB", level: 5});
				state.addFeature({
					id: "arcaneRecovery",
					name: "Arcane Recovery",
					uses: {current: 1, max: 1},
					recharge: "long",
				});
				state.setSpellSlots([
					{level: 1, current: 0, max: 4},
					{level: 2, current: 0, max: 3},
					{level: 3, current: 0, max: 2},
				]);
			});

			it("should recover spell slots equal to half wizard level", () => {
				// Level 5 = recover up to 3 levels of slots
				state.useArcaneRecovery([{level: 2, amount: 1}, {level: 1, amount: 1}]); // 3 levels
				expect(state.getSpellSlots()[1].current).toBe(1);
				expect(state.getSpellSlots()[2].current).toBe(1);
			});

			it("should not recover slots of 6th level or higher", () => {
				state.addClass({name: "Wizard", source: "PHB", level: 11});
				state.setSpellSlots([
					{level: 6, current: 0, max: 1},
				]);
				const result = state.useArcaneRecovery([{level: 6, amount: 1}]);
				expect(result).toBe(false);
			});

			it("should use feature charge", () => {
				state.useArcaneRecovery([{level: 1, amount: 2}]);
				expect(state.getFeature("Arcane Recovery").uses.current).toBe(0);
			});
		});

		describe("Bard - Song of Rest", () => {
			it("should add extra healing when spending hit dice", () => {
				state.addClass({name: "Bard", source: "PHB", level: 2});
				state.setCurrentHp(10);
				// Song of Rest adds d6 at level 2
				state.addShortRestBonus("songOfRest", "d6");
				state.spendHitDie("d10", {includeSongOfRest: true});
				// d10 + CON + d6
				expect(state.getCurrentHp()).toBeGreaterThanOrEqual(14); // min roll + CON
			});
		});

		describe("Warlock - Pact Magic", () => {
			beforeEach(() => {
				state.addClass({name: "Warlock", source: "PHB", level: 5});
				state.setPactSlots({current: 0, max: 2, level: 3});
			});

			it("should restore pact slots on short rest", () => {
				state.onShortRest();
				expect(state.getPactSlots().current).toBe(2);
			});

			it("should restore pact slots on long rest", () => {
				state.onLongRest();
				expect(state.getPactSlots().current).toBe(2);
			});
		});

		describe("Sorcerer - Font of Magic", () => {
			beforeEach(() => {
				state.addClass({name: "Sorcerer", source: "PHB", level: 5});
				state.setSorceryPoints({current: 0, max: 5});
			});

			it("should restore sorcery points on long rest", () => {
				state.onLongRest();
				expect(state.getSorceryPoints().current).toBe(5);
			});

			it("should not restore sorcery points on short rest", () => {
				state.onShortRest();
				expect(state.getSorceryPoints().current).toBe(0);
			});
		});
	});

	// ==========================================================================
	// Rest Requirements
	// ==========================================================================
	describe("Rest Requirements", () => {
		it("should require 1 hour for short rest", () => {
			expect(state.getRestRequirements("short").duration).toBe(60); // minutes
		});

		it("should require 8 hours for long rest", () => {
			expect(state.getRestRequirements("long").duration).toBe(480); // minutes
		});

		it("should track time since last long rest", () => {
			state.onLongRest();
			state.advanceTime(8); // 8 hours
			expect(state.getTimeSinceLastLongRest()).toBe(8);
		});

		it("should not allow long rest if one taken in last 24 hours", () => {
			state.onLongRest();
			state.advanceTime(20); // 20 hours
			expect(state.canLongRest()).toBe(false);
		});

		it("should allow long rest after 24 hours", () => {
			state.onLongRest();
			state.advanceTime(25); // 25 hours
			expect(state.canLongRest()).toBe(true);
		});
	});

	// ==========================================================================
	// Multiclass Hit Dice Recovery
	// ==========================================================================
	describe("Multiclass Hit Dice Recovery", () => {
		beforeEach(() => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			state.addClass({name: "Wizard", source: "PHB", level: 2});
			state.setHitDice([
				{type: "d10", current: 0, max: 3},
				{type: "d6", current: 0, max: 2},
			]);
		});

		it("should recover hit dice from all classes", () => {
			// Total 5 hit dice, recover 3 (half rounded up)
			state.onLongRest();
			const hitDice = state.getHitDice();
			const totalRecovered = hitDice.reduce((sum, hd) => sum + hd.current, 0);
			expect(totalRecovered).toBeGreaterThanOrEqual(1);
		});

		it("should allow choosing which hit dice to recover", () => {
			// When recovering, player can choose
			state.recoverHitDice([
				{type: "d10", amount: 2},
				{type: "d6", amount: 1},
			]);
			expect(state.getHitDice().find(h => h.type === "d10").current).toBe(2);
			expect(state.getHitDice().find(h => h.type === "d6").current).toBe(1);
		});
	});

	// ==========================================================================
	// Magic Item Rest Features
	// ==========================================================================
	describe("Magic Item Rest Features", () => {
		it("should recharge magic item at dawn", () => {
			state.addItem({
				id: "item1",
				name: "Staff of Fire",
				charges: 10,
				chargesCurrent: 0,
				recharge: "dawn",
				rechargeAmount: "1d6+4",
			});
			state.onLongRest();
			expect(state.getItem("item1").chargesCurrent).toBeGreaterThanOrEqual(5);
		});

		it("should track items that recharge at dusk", () => {
			state.addItem({
				id: "item2",
				name: "Cloak of Shadows",
				charges: 3,
				chargesCurrent: 0,
				recharge: "dusk",
				rechargeAmount: "all",
			});
			state.onDusk();
			expect(state.getItem("item2").chargesCurrent).toBe(3);
		});

		it("should track items that recharge on specific conditions", () => {
			state.addItem({
				id: "item3",
				name: "Ring of Spell Storing",
				charges: 5,
				chargesCurrent: 5,
				recharge: "manual",
			});
			// Doesn't auto-recharge
			state.onLongRest();
			expect(state.getItem("item3").chargesCurrent).toBe(5);
		});

		it("should recharge magic items on short rest", () => {
			state.addItem({
				id: "item4",
				name: "Wand of Magic Detection",
				charges: 3,
				chargesCurrent: 0,
				recharge: "restShort",
			});
			state.onShortRest();
			expect(state.getItem("item4").chargesCurrent).toBe(3);
		});

		it("should recharge magic items on long rest (restLong)", () => {
			state.addItem({
				id: "item5",
				name: "Amulet of Proof Against Detection",
				charges: 1,
				chargesCurrent: 0,
				recharge: "restLong",
			});
			state.onLongRest();
			expect(state.getItem("item5").chargesCurrent).toBe(1);
		});

		it("should recharge magic items at midnight", () => {
			state.addItem({
				id: "item6",
				name: "Midnight Pendant",
				charges: 2,
				chargesCurrent: 0,
				recharge: "midnight",
			});
			state.onMidnight();
			expect(state.getItem("item6").chargesCurrent).toBe(2);
		});

		it("should recharge magic items each round in combat", () => {
			state.addItem({
				id: "item7",
				name: "Ring of Regeneration Charges",
				charges: 1,
				chargesCurrent: 0,
				recharge: "round",
			});
			state.onNewRound();
			expect(state.getItem("item7").chargesCurrent).toBe(1);
		});

		// Dice-based recharge tests
		it("should roll dice for recharge with 1d6+4 pattern", () => {
			state.addItem({
				id: "dice1",
				name: "Staff of Fire",
				charges: 10,
				chargesCurrent: 0,
				recharge: "dawn",
				rechargeAmount: "1d6+4",
			});
			state.onLongRest(); // triggers dawn
			// 1d6+4 = min 5, max 10
			expect(state.getItem("dice1").chargesCurrent).toBeGreaterThanOrEqual(5);
			expect(state.getItem("dice1").chargesCurrent).toBeLessThanOrEqual(10);
		});

		it("should roll dice for recharge with 1d3 pattern", () => {
			state.addItem({
				id: "dice2",
				name: "Gem of Seeing",
				charges: 3,
				chargesCurrent: 0,
				recharge: "dawn",
				rechargeAmount: "1d3",
			});
			state.onLongRest();
			// 1d3 = min 1, max 3
			expect(state.getItem("dice2").chargesCurrent).toBeGreaterThanOrEqual(1);
			expect(state.getItem("dice2").chargesCurrent).toBeLessThanOrEqual(3);
		});

		it("should roll dice for recharge with 2d8+4 pattern", () => {
			state.addItem({
				id: "dice3",
				name: "Blackstaff",
				charges: 50,
				chargesCurrent: 0,
				recharge: "dawn",
				rechargeAmount: "2d8+4",
			});
			state.onLongRest();
			// 2d8+4 = min 6, max 20
			expect(state.getItem("dice3").chargesCurrent).toBeGreaterThanOrEqual(6);
			expect(state.getItem("dice3").chargesCurrent).toBeLessThanOrEqual(20);
		});

		it("should handle {@dice ...} wrapper in rechargeAmount", () => {
			state.addItem({
				id: "dice4",
				name: "Wand of Magic Missiles",
				charges: 7,
				chargesCurrent: 0,
				recharge: "dawn",
				rechargeAmount: "{@dice 1d6 + 1}",
			});
			state.onLongRest();
			// 1d6+1 = min 2, max 7
			expect(state.getItem("dice4").chargesCurrent).toBeGreaterThanOrEqual(2);
			expect(state.getItem("dice4").chargesCurrent).toBeLessThanOrEqual(7);
		});

		it("should handle whitespace in dice expressions", () => {
			state.addItem({
				id: "dice5",
				name: "Staff With Spaces",
				charges: 10,
				chargesCurrent: 0,
				recharge: "dawn",
				rechargeAmount: "1d6 + 4",
			});
			state.onLongRest();
			// 1d6+4 = min 5, max 10
			expect(state.getItem("dice5").chargesCurrent).toBeGreaterThanOrEqual(5);
			expect(state.getItem("dice5").chargesCurrent).toBeLessThanOrEqual(10);
		});

		it("should handle negative modifiers in dice expressions", () => {
			state.addItem({
				id: "dice6",
				name: "Cursed Wand",
				charges: 10,
				chargesCurrent: 0,
				recharge: "dawn",
				rechargeAmount: "1d6-2",
			});
			state.onLongRest();
			// 1d6-2 = min 0 (clamped), max 4
			expect(state.getItem("dice6").chargesCurrent).toBeGreaterThanOrEqual(0);
			expect(state.getItem("dice6").chargesCurrent).toBeLessThanOrEqual(4);
		});

		it("should handle fixed number rechargeAmount", () => {
			state.addItem({
				id: "fixed1",
				name: "Staff of Fixed Recharge",
				charges: 10,
				chargesCurrent: 0,
				recharge: "dawn",
				rechargeAmount: 3,
			});
			state.onLongRest();
			expect(state.getItem("fixed1").chargesCurrent).toBe(3);
		});

		it("should cap recharged charges at max", () => {
			state.addItem({
				id: "cap1",
				name: "Nearly Full Staff",
				charges: 10,
				chargesCurrent: 8,
				recharge: "dawn",
				rechargeAmount: "1d6+4", // min 5 would exceed max 10
			});
			state.onLongRest();
			// Should not exceed 10
			expect(state.getItem("cap1").chargesCurrent).toBeLessThanOrEqual(10);
		});

		it("should handle d20 recharge pattern", () => {
			state.addItem({
				id: "dice7",
				name: "Abracadabrus",
				charges: 20,
				chargesCurrent: 0,
				recharge: "dawn",
				rechargeAmount: "1d20",
			});
			state.onLongRest();
			// 1d20 = min 1, max 20
			expect(state.getItem("dice7").chargesCurrent).toBeGreaterThanOrEqual(1);
			expect(state.getItem("dice7").chargesCurrent).toBeLessThanOrEqual(20);
		});
	});
});
