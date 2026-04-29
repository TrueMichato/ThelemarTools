/**
 * Character Sheet Item Upgrades — Unit Tests
 * Tests for upgrade application, gemstone socketing, charge tracking,
 * mechanical effects, and gold deduction
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetUpgrades = globalThis.CharacterSheetUpgrades;

describe("Item Upgrades", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("cha", 14);
		state.setAbilityBase("wis", 12);
		state.setCurrency("gp", 5000);
	});

	// ==========================================================================
	// Upgrade Application
	// ==========================================================================
	describe("Upgrade Application", () => {
		it("should apply an upgrade to an inventory item", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const items = state.getItems();
			const itemId = items[0].id;

			const result = state.applyItemUpgrade(itemId, {
				name: "Balanced",
				source: "TCAH",
				upgradeType: ["WU:1"],
				cost: "100 gp (base)",
			}, 100);

			expect(result.success).toBe(true);
			expect(state.getItemUpgrades(itemId)).toHaveLength(1);
			expect(state.getItemUpgrades(itemId)[0].name).toBe("Balanced");
		});

		it("should prevent duplicate upgrades", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 100);
			const result = state.applyItemUpgrade(itemId, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 100);

			expect(result.success).toBe(false);
			expect(result.error).toContain("already applied");
		});

		it("should remove an upgrade from an item", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 100);
			expect(state.getItemUpgrades(itemId)).toHaveLength(1);

			const removed = state.removeItemUpgrade(itemId, "Balanced", "TCAH");
			expect(removed).toBe(true);
			expect(state.getItemUpgrades(itemId)).toHaveLength(0);
		});

		it("should return false when removing a non-existent upgrade", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			const removed = state.removeItemUpgrade(itemId, "Nonexistent", "TCAH");
			expect(removed).toBe(false);
		});

		it("should track multiple upgrades on one item", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 100);
			state.applyItemUpgrade(itemId, {name: "Wounding: Keen", source: "TCAH", upgradeType: ["WU:1"]}, 100);

			expect(state.getItemUpgrades(itemId)).toHaveLength(2);
		});

		it("should check if an item has a specific upgrade", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 100);

			expect(state.hasItemUpgrade(itemId, "Balanced")).toBe(true);
			expect(state.hasItemUpgrade(itemId, "balanced")).toBe(true); // case-insensitive
			expect(state.hasItemUpgrade(itemId, "Wounding: Keen")).toBe(false);
		});

		it("should track weapon upgrade tier", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			expect(state.getItemWeaponUpgradeTier(itemId)).toBe(0);

			state.applyItemUpgrade(itemId, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 100);
			expect(state.getItemWeaponUpgradeTier(itemId)).toBe(1);

			state.applyItemUpgrade(itemId, {name: "Superior", source: "TCAH", upgradeType: ["WU:2"]}, 1000);
			expect(state.getItemWeaponUpgradeTier(itemId)).toBe(2);

			state.applyItemUpgrade(itemId, {name: "Masterwork", source: "TCAH", upgradeType: ["WU:3"]}, 10000);
			expect(state.getItemWeaponUpgradeTier(itemId)).toBe(3);
		});

		it("should store cost paid with the upgrade", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 150);
			expect(state.getItemUpgrades(itemId)[0].costPaid).toBe(150);
		});
	});

	// ==========================================================================
	// Gemstone Socketing
	// ==========================================================================
	describe("Gemstone Socketing", () => {
		it("should socket a gemstone into an item", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			const result = state.socketGemstone(itemId, {
				name: "Ember Strike",
				source: "TGTT",
				gemName: "Carnelian",
				rarity: "common",
				upgradeType: ["GS:C"],
				entries: ["Extra fire damage"],
				charges: 3,
				recharge: "dawn",
			});

			expect(result.success).toBe(true);
			const gems = state.getSocketedGemstones(itemId);
			expect(gems).toHaveLength(1);
			expect(gems[0].name).toBe("Ember Strike");
			expect(gems[0].gemName).toBe("Carnelian");
			expect(gems[0].chargesMax).toBe(3);
			expect(gems[0].chargesCurrent).toBe(3);
			expect(gems[0].recharge).toBe("dawn");
		});

		it("should limit to 1 gemstone per item", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.socketGemstone(itemId, {name: "Gem 1", source: "TGTT", upgradeType: ["GS:C"]});
			const result = state.socketGemstone(itemId, {name: "Gem 2", source: "TGTT", upgradeType: ["GS:C"]});

			expect(result.success).toBe(false);
			expect(result.error).toContain("already has a gemstone");
		});

		it("should unsocket a gemstone and return it", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.socketGemstone(itemId, {name: "Ember Strike", source: "TGTT", gemName: "Carnelian", upgradeType: ["GS:C"]});
			const removed = state.unsocketGemstone(itemId, "Ember Strike");

			expect(removed).not.toBeNull();
			expect(removed.name).toBe("Ember Strike");
			expect(state.getSocketedGemstones(itemId)).toHaveLength(0);
		});

		it("should return null when unsocketing a non-existent gemstone", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			const removed = state.unsocketGemstone(itemId, "Nonexistent");
			expect(removed).toBeNull();
		});
	});

	// ==========================================================================
	// Gemstone Charge Tracking
	// ==========================================================================
	describe("Gemstone Charge Tracking", () => {
		it("should use a charge from a gemstone", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.socketGemstone(itemId, {
				name: "Ember Strike", source: "TGTT", charges: 3, recharge: "dawn", upgradeType: ["GS:C"],
			});

			const result = state.useGemstoneCharge(itemId, "Ember Strike");
			expect(result.success).toBe(true);
			expect(result.remaining).toBe(2);

			const gems = state.getSocketedGemstones(itemId);
			expect(gems[0].chargesCurrent).toBe(2);
		});

		it("should not use a charge when none remain", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.socketGemstone(itemId, {
				name: "Ember Strike", source: "TGTT", charges: 1, recharge: "dawn", upgradeType: ["GS:C"],
			});
			state.useGemstoneCharge(itemId, "Ember Strike");

			const result = state.useGemstoneCharge(itemId, "Ember Strike");
			expect(result.success).toBe(false);
			expect(result.error).toContain("No charges remaining");
		});

		it("should restore charges to a gemstone", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.socketGemstone(itemId, {
				name: "Ember Strike", source: "TGTT", charges: 3, recharge: "dawn", upgradeType: ["GS:C"],
			});
			state.useGemstoneCharge(itemId, "Ember Strike");
			state.useGemstoneCharge(itemId, "Ember Strike");

			state.restoreGemstoneCharges(itemId, "Ember Strike", 1);
			expect(state.getSocketedGemstones(itemId)[0].chargesCurrent).toBe(2);
		});

		it("should not exceed max charges when restoring", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.socketGemstone(itemId, {
				name: "Ember Strike", source: "TGTT", charges: 3, recharge: "dawn", upgradeType: ["GS:C"],
			});

			state.restoreGemstoneCharges(itemId, "Ember Strike", 10);
			expect(state.getSocketedGemstones(itemId)[0].chargesCurrent).toBe(3);
		});

		it("should recharge all dawn gemstones on long rest", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			state.addItem({name: "Shield", source: "PHB", type: "S", shield: true});
			const items = state.getItems();

			state.socketGemstone(items[0].id, {
				name: "Ember Strike", source: "TGTT", charges: 3, recharge: "dawn", upgradeType: ["GS:C"],
			});
			state.socketGemstone(items[1].id, {
				name: "Frost Ward", source: "TGTT", charges: 2, recharge: "dawn", upgradeType: ["GS:U"],
			});

			state.useGemstoneCharge(items[0].id, "Ember Strike");
			state.useGemstoneCharge(items[0].id, "Ember Strike");
			state.useGemstoneCharge(items[1].id, "Frost Ward");

			state.rechargeAllGemstones();

			expect(state.getSocketedGemstones(items[0].id)[0].chargesCurrent).toBe(3);
			expect(state.getSocketedGemstones(items[1].id)[0].chargesCurrent).toBe(2);
		});
	});

	// ==========================================================================
	// Gold Deduction
	// ==========================================================================
	describe("Gold Deduction", () => {
		it("should deduct gold from gp first", () => {
			state.setCurrency("gp", 500);
			const result = state.deductGold(100);

			expect(result.success).toBe(true);
			expect(state.getCurrency("gp")).toBe(400);
		});

		it("should fail if insufficient total funds", () => {
			state.setCurrency("gp", 50);
			state.setCurrency("sp", 0);
			state.setCurrency("cp", 0);
			state.setCurrency("pp", 0);
			state.setCurrency("ep", 0);

			const result = state.deductGold(100);
			expect(result.success).toBe(false);
			expect(result.error).toContain("Insufficient funds");
		});

		it("should convert from pp when gp is insufficient", () => {
			state.setCurrency("gp", 50);
			state.setCurrency("pp", 10);

			const result = state.deductGold(100);
			expect(result.success).toBe(true);
			// 50 gp used + 5 pp (50 gp) = 100 gp
			expect(state.getCurrency("gp")).toBe(0);
			expect(state.getCurrency("pp")).toBe(5);
		});

		it("should give change back in gp when converting from pp", () => {
			state.setCurrency("gp", 0);
			state.setCurrency("pp", 2);

			const result = state.deductGold(5);
			expect(result.success).toBe(true);
			// 1 pp = 10 gp, so spending 5 gp from 1 pp leaves 5 gp change
			expect(state.getCurrency("pp")).toBe(1);
			expect(state.getCurrency("gp")).toBe(5);
		});

		it("should refund gold via addGold", () => {
			state.setCurrency("gp", 100);
			const result = state.addGold(250);
			expect(result.success).toBe(true);
			expect(state.getCurrency("gp")).toBe(350);
		});

		it("addGold should ignore non-positive amounts", () => {
			state.setCurrency("gp", 100);
			expect(state.addGold(0).success).toBe(false);
			expect(state.addGold(-10).success).toBe(false);
			expect(state.getCurrency("gp")).toBe(100);
		});

		it("addGold should preserve fractional refunds (half-refund)", () => {
			state.setCurrency("gp", 0);
			state.addGold(50.5);
			expect(state.getCurrency("gp")).toBeCloseTo(50.5, 2);
		});
	});

	// ==========================================================================
	// Cost Parsing & Display
	// ==========================================================================
	describe("Cost Parsing", () => {
		it("should parse legacy string costs (with and without (base))", () => {
			expect(CharacterSheetUpgrades.parseGoldCost("100 gp (base)")).toBe(100);
			expect(CharacterSheetUpgrades.parseGoldCost("1,000 gp")).toBe(1000);
			expect(CharacterSheetUpgrades.parseGoldCost("10 gp")).toBe(10);
		});

		it("should parse structured object costs", () => {
			expect(CharacterSheetUpgrades.parseGoldCost({gp: 100, isBase: true})).toBe(100);
			expect(CharacterSheetUpgrades.parseGoldCost({gp: 1000})).toBe(1000);
		});

		it("should return 0 for null/undefined/invalid", () => {
			expect(CharacterSheetUpgrades.parseGoldCost(null)).toBe(0);
			expect(CharacterSheetUpgrades.parseGoldCost(undefined)).toBe(0);
			expect(CharacterSheetUpgrades.parseGoldCost("Free")).toBe(0);
			expect(CharacterSheetUpgrades.parseGoldCost({})).toBe(0);
		});

		it("should detect base-cost flag in both forms", () => {
			expect(CharacterSheetUpgrades.isBaseCost("100 gp (base)")).toBe(true);
			expect(CharacterSheetUpgrades.isBaseCost("100 gp")).toBe(false);
			expect(CharacterSheetUpgrades.isBaseCost({gp: 100, isBase: true})).toBe(true);
			expect(CharacterSheetUpgrades.isBaseCost({gp: 100})).toBe(false);
			expect(CharacterSheetUpgrades.isBaseCost(null)).toBe(false);
		});

		it("should format both string and structured costs for display", () => {
			expect(CharacterSheetUpgrades.formatCostDisplay("100 gp (base)")).toBe("100 gp (base)");
			expect(CharacterSheetUpgrades.formatCostDisplay({gp: 100, isBase: true})).toBe("100 gp (base)");
			expect(CharacterSheetUpgrades.formatCostDisplay({gp: 1000})).toBe("1,000 gp");
			expect(CharacterSheetUpgrades.formatCostDisplay({gp: 50, note: "varies"})).toBe("50 gp (varies)");
			expect(CharacterSheetUpgrades.formatCostDisplay(null)).toBe("Free");
		});
	});

	// ==========================================================================
	// Rules Reference Hover
	// ==========================================================================
	describe("Rules Reference", () => {
		it("should return Armor rule for armor items (variantrule-backed)", () => {
			const ref = CharacterSheetUpgrades.getRulesReference({type: "MA", armor: true});
			expect(ref).not.toBeNull();
			expect(ref.name).toBe("Upgrading Armor");
			expect(ref.source).toBe("TCAH");
			expect(ref.isVariantrule).toBe(true);
			expect(ref.inlineEntry).toBeUndefined();
		});

		it("should return Armor rule for shields", () => {
			const ref = CharacterSheetUpgrades.getRulesReference({type: "S", shield: true});
			expect(ref).not.toBeNull();
			expect(ref.name).toBe("Upgrading Armor");
			expect(ref.isVariantrule).toBe(true);
		});

		it("should return Weapon rule reference with inline entry", () => {
			const ref = CharacterSheetUpgrades.getRulesReference({type: "M", weapon: true});
			expect(ref).not.toBeNull();
			expect(ref.name).toBe("Upgrading Weapons");
			expect(ref.source).toBe("TCAH");
			expect(ref.inlineEntry).toBeDefined();
			expect(ref.inlineEntry.type).toBe("entries");
			expect(ref.inlineEntry.entries.length).toBeGreaterThan(0);
		});

		it("should return null for non-eligible items", () => {
			const ref = CharacterSheetUpgrades.getRulesReference({type: "P"});
			expect(ref).toBeNull();
		});
	});

	// ==========================================================================
	// Upgraded Items Finder
	// ==========================================================================
	describe("Upgraded Items Finder", () => {
		it("should find items with upgrades", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			state.addItem({name: "Dagger", source: "PHB", type: "M", weapon: true});
			const items = state.getItems();

			state.applyItemUpgrade(items[0].id, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 100);

			const upgraded = state.getUpgradedItems();
			expect(upgraded).toHaveLength(1);
			expect(upgraded[0].item.name).toBe("Longsword");
		});

		it("should find items with socketed gemstones", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.socketGemstone(itemId, {name: "Ember Strike", source: "TGTT", upgradeType: ["GS:C"]});

			const upgraded = state.getUpgradedItems();
			expect(upgraded).toHaveLength(1);
		});
	});

	// ==========================================================================
	// Mechanical Effects (Static utility)
	// ==========================================================================
	describe("Mechanical Effects", () => {
		it("should calculate Balanced bonus (+1 attack)", () => {
			const item = {
				appliedUpgrades: [
					{name: "Balanced", source: "TCAH", upgradeType: "WU:1"},
				],
			};

			const effects = CharacterSheetUpgrades.getUpgradeEffects(item);
			expect(effects.bonusWeaponAttack).toBe(1);
			expect(effects.bonusWeaponDamage).toBe(0);
		});

		it("should calculate Wounding bonus (+1 damage)", () => {
			const item = {
				appliedUpgrades: [
					{name: "Wounding: Keen", source: "TCAH", upgradeType: "WU:1"},
				],
			};

			const effects = CharacterSheetUpgrades.getUpgradeEffects(item);
			expect(effects.bonusWeaponDamage).toBe(1);
			expect(effects.bonusWeaponAttack).toBe(0);
		});

		it("should calculate Masterwork bonus (+1/+1)", () => {
			const item = {
				appliedUpgrades: [
					{name: "Masterwork", source: "TCAH", upgradeType: "WU:3"},
				],
			};

			const effects = CharacterSheetUpgrades.getUpgradeEffects(item);
			expect(effects.bonusWeaponAttack).toBe(1);
			expect(effects.bonusWeaponDamage).toBe(1);
		});

		it("should stack Balanced + Masterwork bonuses", () => {
			const item = {
				appliedUpgrades: [
					{name: "Balanced", source: "TCAH", upgradeType: "WU:1"},
					{name: "Masterwork", source: "TCAH", upgradeType: "WU:3"},
				],
			};

			const effects = CharacterSheetUpgrades.getUpgradeEffects(item);
			expect(effects.bonusWeaponAttack).toBe(2);
			expect(effects.bonusWeaponDamage).toBe(1);
		});

		it("should calculate Critical crit threshold reduction", () => {
			const item = {
				appliedUpgrades: [
					{name: "Critical: Sharpened", source: "TCAH", upgradeType: "WU:1"},
				],
			};

			const effects = CharacterSheetUpgrades.getUpgradeEffects(item);
			expect(effects.critThresholdReduction).toBe(1);
		});

		it("should calculate Enchanted spell attack bonus", () => {
			const item = {
				appliedUpgrades: [
					{name: "Enchanted", source: "TCAH", upgradeType: "WU:2"},
				],
			};

			const effects = CharacterSheetUpgrades.getUpgradeEffects(item);
			expect(effects.bonusSpellAttack).toBe(1);
		});

		it("should calculate Arcane spell save DC bonus", () => {
			const item = {
				appliedUpgrades: [
					{name: "Arcane", source: "TCAH", upgradeType: "WU:3"},
				],
			};

			const effects = CharacterSheetUpgrades.getUpgradeEffects(item);
			expect(effects.bonusSpellSaveDc).toBe(1);
		});

		it("should return zero effects for an item with no upgrades", () => {
			const effects = CharacterSheetUpgrades.getUpgradeEffects({});
			expect(effects.bonusWeaponAttack).toBe(0);
			expect(effects.bonusWeaponDamage).toBe(0);
			expect(effects.critThresholdReduction).toBe(0);
			expect(effects.bonusSpellAttack).toBe(0);
			expect(effects.bonusSpellSaveDc).toBe(0);
		});

		it("should calculate Superior damage die increase", () => {
			const item = {
				appliedUpgrades: [
					{name: "Superior", source: "TCAH", upgradeType: "WU:2"},
				],
			};

			const effects = CharacterSheetUpgrades.getUpgradeEffects(item);
			expect(effects.damageDieIncrease).toBe(1);
		});
	});

	// ==========================================================================
	// Damage Die Increase Utility
	// ==========================================================================
	describe("Damage Die Increase", () => {
		it("should increase 1d6 to 1d8", () => {
			expect(CharacterSheetUpgrades.increaseDamageDie("1d6")).toBe("1d8");
		});

		it("should increase 1d8 to 1d10", () => {
			expect(CharacterSheetUpgrades.increaseDamageDie("1d8")).toBe("1d10");
		});

		it("should increase 1d10 to 1d12", () => {
			expect(CharacterSheetUpgrades.increaseDamageDie("1d10")).toBe("1d12");
		});

		it("should cap at 1d12", () => {
			expect(CharacterSheetUpgrades.increaseDamageDie("1d12")).toBe("1d12");
		});

		it("should preserve number of dice", () => {
			expect(CharacterSheetUpgrades.increaseDamageDie("2d6")).toBe("2d8");
		});

		it("should handle null/undefined gracefully", () => {
			expect(CharacterSheetUpgrades.increaseDamageDie(null)).toBeNull();
			expect(CharacterSheetUpgrades.increaseDamageDie(undefined)).toBeUndefined();
		});
	});

	// ==========================================================================
	// Item Type Detection (Static utilities)
	// ==========================================================================
	describe("Item Type Detection", () => {
		it("should detect weapons", () => {
			expect(CharacterSheetUpgrades.isWeapon({weapon: true})).toBe(true);
			expect(CharacterSheetUpgrades.isWeapon({type: "M"})).toBe(true);
			expect(CharacterSheetUpgrades.isWeapon({type: "R"})).toBe(true);
			expect(CharacterSheetUpgrades.isWeapon({type: "G"})).toBe(false);
		});

		it("should detect armor", () => {
			expect(CharacterSheetUpgrades.isArmor({armor: true})).toBe(true);
			expect(CharacterSheetUpgrades.isArmor({type: "LA"})).toBe(true);
			expect(CharacterSheetUpgrades.isArmor({type: "MA"})).toBe(true);
			expect(CharacterSheetUpgrades.isArmor({type: "HA"})).toBe(true);
			expect(CharacterSheetUpgrades.isArmor({type: "M"})).toBe(false);
		});

		it("should detect shields", () => {
			expect(CharacterSheetUpgrades.isShield({shield: true})).toBe(true);
			expect(CharacterSheetUpgrades.isShield({type: "S"})).toBe(true);
			expect(CharacterSheetUpgrades.isShield({type: "M"})).toBe(false);
		});

		it("should detect socketable items", () => {
			expect(CharacterSheetUpgrades.isSocketable({weapon: true})).toBe(true);
			expect(CharacterSheetUpgrades.isSocketable({armor: true})).toBe(true);
			expect(CharacterSheetUpgrades.isSocketable({shield: true})).toBe(true);
			expect(CharacterSheetUpgrades.isSocketable({type: "G"})).toBe(false);
		});
	});

	// ==========================================================================
	// Utility Methods
	// ==========================================================================
	describe("Utility Methods", () => {
		it("should parse gold cost from string", () => {
			expect(CharacterSheetUpgrades.parseGoldCost("100 gp (base)")).toBe(100);
			expect(CharacterSheetUpgrades.parseGoldCost("1,000 gp")).toBe(1000);
			expect(CharacterSheetUpgrades.parseGoldCost("10,000 gp (base)")).toBe(10000);
			expect(CharacterSheetUpgrades.parseGoldCost("50 gp")).toBe(50);
			expect(CharacterSheetUpgrades.parseGoldCost(null)).toBe(0);
			expect(CharacterSheetUpgrades.parseGoldCost("")).toBe(0);
		});

		it("should get upgrade tier labels", () => {
			expect(CharacterSheetUpgrades.getUpgradeTierLabel("WU:1")).toBe("1st Tier Weapon");
			expect(CharacterSheetUpgrades.getUpgradeTierLabel("WU:2")).toBe("2nd Tier Weapon");
			expect(CharacterSheetUpgrades.getUpgradeTierLabel("WU:3")).toBe("3rd Tier Weapon");
			expect(CharacterSheetUpgrades.getUpgradeTierLabel("AU")).toBe("Armor");
			expect(CharacterSheetUpgrades.getUpgradeTierLabel("GS:C")).toBe("Common Gemstone");
		});
	});

	// ==========================================================================
	// Load/Save Migration (backward compat)
	// ==========================================================================
	describe("Load/Save Migration", () => {
		it("should add empty arrays when loading old data", () => {
			const json = state.toJSON();
			// Simulate old data without upgrade arrays
			json.inventory = [{
				id: "test-item",
				item: {name: "Longsword", source: "PHB", weapon: true},
				quantity: 1,
				equipped: false,
			}];

			const newState = new CharacterSheetState();
			newState.loadFromJson(json);

			const items = newState.getItems();
			expect(items[0].appliedUpgrades).toEqual([]);
			expect(items[0].socketedGemstones).toEqual([]);
		});

		it("should preserve existing upgrade data on load", () => {
			const json = state.toJSON();
			json.inventory = [{
				id: "test-item",
				item: {
					name: "Longsword", source: "PHB", weapon: true,
					appliedUpgrades: [{name: "Balanced", source: "TCAH", upgradeType: "WU:1", costPaid: 100}],
					socketedGemstones: [{name: "Ember Strike", source: "TGTT", chargesCurrent: 2, chargesMax: 3}],
				},
				quantity: 1,
				equipped: false,
			}];

			const newState = new CharacterSheetState();
			newState.loadFromJson(json);

			const items = newState.getItems();
			expect(items[0].appliedUpgrades).toHaveLength(1);
			expect(items[0].appliedUpgrades[0].name).toBe("Balanced");
			expect(items[0].socketedGemstones).toHaveLength(1);
			expect(items[0].socketedGemstones[0].chargesCurrent).toBe(2);
		});
	});

	// ==========================================================================
	// Effective Bonuses (with upgrades)
	// ==========================================================================
	describe("Effective Item Bonuses", () => {
		it("should include upgrade bonuses in effective bonuses", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true, bonusWeapon: 1});
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 100);

			const bonuses = state.getEffectiveItemBonuses(itemId);
			// base bonusWeapon=1 (not in bonusWeaponAttack), Balanced adds +1 to attack
			expect(bonuses.bonusWeaponAttack).toBe(1);
		});

		it("should stack upgrade and base item bonuses", () => {
			state.addItem({name: "Longsword +1", source: "PHB", type: "M", weapon: true, bonusWeaponAttack: 1, bonusWeaponDamage: 1});
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 100);
			state.applyItemUpgrade(itemId, {name: "Wounding: Keen", source: "TCAH", upgradeType: ["WU:1"]}, 100);

			const bonuses = state.getEffectiveItemBonuses(itemId);
			expect(bonuses.bonusWeaponAttack).toBe(2); // 1 base + 1 Balanced
			expect(bonuses.bonusWeaponDamage).toBe(2); // 1 base + 1 Wounding
		});

		it("should reduce crit threshold from Critical upgrade", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Critical: Sharpened", source: "TCAH", upgradeType: ["WU:1"]}, 100);

			const bonuses = state.getEffectiveItemBonuses(itemId);
			expect(bonuses.critThreshold).toBe(19);
		});

		it("should include damageDieIncrease in effective bonuses for Superior upgrade", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Superior", source: "TCAH", upgradeType: ["WU:3"]}, 10000);

			const bonuses = state.getEffectiveItemBonuses(itemId);
			expect(bonuses.damageDieIncrease).toBe(1);
		});
	});

	// ==========================================================================
	// Global Item Bonus Aggregation (_recalculateItemBonuses)
	// ==========================================================================
	describe("Global Item Bonus Aggregation", () => {
		it("should aggregate spellAttack bonus from equipped item with Enchanted upgrade", () => {
			state.addItem({name: "Magic Staff", source: "PHB", type: "ST", weapon: true, bonusSpellAttack: 0}, 1, true);
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Enchanted", source: "TCAH", upgradeType: ["WU:2"]}, 1000);

			expect(state.getItemBonuses?.()?.spellAttack || state._data?.itemBonuses?.spellAttack).toBe(1);
		});

		it("should aggregate spellSaveDc bonus from equipped item with Arcane upgrade", () => {
			state.addItem({name: "Magic Staff", source: "PHB", type: "ST", weapon: true, bonusSpellSaveDc: 0}, 1, true);
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Arcane", source: "TCAH", upgradeType: ["WU:2"]}, 1000);

			const itemBonuses = state._data?.itemBonuses || {};
			expect(itemBonuses.spellSaveDc).toBe(1);
		});

		it("should aggregate critThreshold from equipped item with Critical upgrade", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true}, 1, true);
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Critical: Sharpened", source: "TCAH", upgradeType: ["WU:1"]}, 100);

			const itemBonuses = state._data?.itemBonuses || {};
			expect(itemBonuses.critThreshold).toBe(19);
		});

		it("should NOT aggregate bonuses from unequipped items", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true}, 1, false);
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Enchanted", source: "TCAH", upgradeType: ["WU:2"]}, 1000);

			const itemBonuses = state._data?.itemBonuses || {};
			expect(itemBonuses.spellAttack).toBe(0);
		});

		it("should take max spellAttack from multiple equipped items", () => {
			state.addItem({name: "Wand A", source: "PHB", type: "WD", weapon: false, bonusSpellAttack: 1}, 1, true);
			state.addItem({name: "Wand B", source: "PHB", type: "WD", weapon: false, bonusSpellAttack: 2}, 1, true);

			const itemBonuses = state._data?.itemBonuses || {};
			expect(itemBonuses.spellAttack).toBe(2);
		});

		it("should update bonuses when an upgrade is removed", () => {
			state.addItem({name: "Staff", source: "PHB", type: "ST", weapon: true}, 1, true);
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Enchanted", source: "TCAH", upgradeType: ["WU:2"]}, 1000);
			expect(state._data?.itemBonuses?.spellAttack).toBe(1);

			state.removeItemUpgrade(itemId, "Enchanted", "TCAH");
			expect(state._data?.itemBonuses?.spellAttack).toBe(0);
		});

		it("should update bonuses when a gemstone is socketed/unsocketed", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true}, 1, true);
			const itemId = state.getItems()[0].id;

			// Socket shouldn't crash even if gemstone doesn't have direct bonuses
			const result = state.socketGemstone(itemId, {name: "Ruby of Flame", source: "TGTT", gemName: "Ruby", entries: ["Fire damage"]});
			expect(result.success).toBe(true);

			state.unsocketGemstone(itemId, "Ruby of Flame");
			expect(state.getSocketedGemstones(itemId)).toHaveLength(0);
		});

		it("should feed upgrade crit threshold into getCriticalRange()", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true}, 1, true);
			const itemId = state.getItems()[0].id;

			state.applyItemUpgrade(itemId, {name: "Critical: Sharpened", source: "TCAH", upgradeType: ["WU:1"]}, 100);

			expect(state.getCriticalRange()).toBe(19);
		});

		it("should feed upgrade spell bonuses into getSpellSaveDC()", () => {
			state.addItem({name: "Staff", source: "PHB", type: "ST", weapon: true}, 1, true);
			const itemId = state.getItems()[0].id;

			// Set up spellcasting
			state._data.spellcasting = state._data.spellcasting || {};
			state._data.spellcasting.ability = "cha";

			const baseDc = state.getSpellSaveDc();

			state.applyItemUpgrade(itemId, {name: "Arcane", source: "TCAH", upgradeType: ["WU:2"]}, 1000);

			const upgradedDc = state.getSpellSaveDc();
			expect(upgradedDc).toBe(baseDc + 1);
		});

		it("should feed upgrade spell bonuses into getSpellAttackBonus()", () => {
			state.addItem({name: "Staff", source: "PHB", type: "ST", weapon: true}, 1, true);
			const itemId = state.getItems()[0].id;

			state._data.spellcasting = state._data.spellcasting || {};
			state._data.spellcasting.ability = "cha";

			const baseAtk = state.getSpellAttackBonus();

			state.applyItemUpgrade(itemId, {name: "Enchanted", source: "TCAH", upgradeType: ["WU:2"]}, 1000);

			const upgradedAtk = state.getSpellAttackBonus();
			expect(upgradedAtk).toBe(baseAtk + 1);
		});
	});

	// ==========================================================================
	// Armor Upgrade Effects
	// ==========================================================================
	describe("Armor Upgrade Effects", () => {
		it("should return default flags for item with no upgrades", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({});
			expect(effects.muffled).toBe(false);
			expect(effects.reinforced).toBe(false);
			expect(effects.armorProofingTier).toBe(0);
			expect(effects.spiked).toBe(false);
			expect(effects.breathable).toBe(false);
			expect(effects.insulated).toBe(false);
		});

		it("should detect Muffled upgrade", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Muffled", source: "TCAH"}],
			});
			expect(effects.muffled).toBe(true);
		});

		it("should detect Reinforced upgrade", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Reinforced", source: "TCAH"}],
			});
			expect(effects.reinforced).toBe(true);
		});

		it("should detect Armor Proofing tiers", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [
					{name: "Armor Proofing: 1st Tier", source: "TCAH"},
					{name: "Armor Proofing: 2nd Tier", source: "TCAH"},
				],
			});
			expect(effects.armorProofingTier).toBe(2);
		});

		it("should detect Spiked upgrade", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Spiked", source: "TCAH"}],
			});
			expect(effects.spiked).toBe(true);
		});

		it("should detect Breathable upgrade", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Breathable", source: "TCAH"}],
			});
			expect(effects.breathable).toBe(true);
		});

		it("should detect Insulated upgrade", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Insulated", source: "TCAH"}],
			});
			expect(effects.insulated).toBe(true);
		});

		it("should detect Climbing Harness upgrade", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Climbing Harness", source: "TCAH"}],
			});
			expect(effects.climbingHarness).toBe(true);
		});

		it("should detect Locking Joints upgrade", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Locking Joints", source: "TCAH"}],
			});
			expect(effects.lockingJoints).toBe(true);
		});

		it("should detect Quick-release Clasps upgrade", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Quick-release Clasps", source: "TCAH"}],
			});
			expect(effects.quickRelease).toBe(true);
		});

		it("should detect Decorated upgrade", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Decorated", source: "TCAH"}],
			});
			expect(effects.decorated).toBe(true);
		});

		it("should detect Runic upgrade", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Runic", source: "TCAH"}],
			});
			expect(effects.runic).toBe(true);
		});

		it("should detect Burnished upgrade", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Burnished", source: "TCAH"}],
			});
			expect(effects.burnished).toBe(true);
		});

		it("should detect multiple upgrades simultaneously", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [
					{name: "Muffled", source: "TCAH"},
					{name: "Spiked", source: "TCAH"},
					{name: "Climbing Harness", source: "TCAH"},
				],
			});
			expect(effects.muffled).toBe(true);
			expect(effects.spiked).toBe(true);
			expect(effects.climbingHarness).toBe(true);
		});

		it("should remove stealth disadvantage when Muffled upgrade is applied to armor", () => {
			// Set up armor with stealth disadvantage (brigandine-like)
			state._data.ac.armor = {
				ac: 15,
				type: "medium",
				name: "Brigandine",
				stealth: true,
				appliedUpgrades: [{name: "Muffled", source: "TCAH"}],
			};

			expect(state.hasArmorStealthDisadvantage()).toBe(false);
		});

		it("should still have stealth disadvantage without Muffled upgrade", () => {
			state._data.ac.armor = {
				ac: 15,
				type: "medium",
				name: "Brigandine",
				stealth: true,
				appliedUpgrades: [],
			};

			expect(state.hasArmorStealthDisadvantage()).toBe(true);
		});

		it("should still have stealth disadvantage with unrelated upgrade", () => {
			state._data.ac.armor = {
				ac: 15,
				type: "medium",
				name: "Brigandine",
				stealth: true,
				appliedUpgrades: [{name: "Spiked", source: "TCAH"}],
			};

			expect(state.hasArmorStealthDisadvantage()).toBe(true);
		});
	});

	// ==========================================================================
	// Weapon Upgrade Notes & Tags
	// ==========================================================================
	describe("Weapon Upgrade Notes & Tags", () => {
		it("should return Silvered tag", () => {
			const eff = CharacterSheetUpgrades.getUpgradeEffects({
				appliedUpgrades: [{name: "Silvered", source: "TCAH"}],
			});
			expect(eff.tags).toContain("Silvered");
		});

		it("should return Magical tag", () => {
			const eff = CharacterSheetUpgrades.getUpgradeEffects({
				appliedUpgrades: [{name: "Magical", source: "TCAH"}],
			});
			expect(eff.tags).toContain("Magical");
		});

		it("should return Runic tag for weapon", () => {
			const eff = CharacterSheetUpgrades.getUpgradeEffects({
				appliedUpgrades: [{name: "Runic", source: "TCAH"}],
			});
			expect(eff.tags).toContain("Runic");
		});

		it("should return Saw-toothed bonus damage and note", () => {
			const eff = CharacterSheetUpgrades.getUpgradeEffects({
				appliedUpgrades: [{name: "Saw-toothed", source: "TCAH"}],
			});
			expect(eff.bonusDamageDice).toBe("1d4");
			expect(eff.bonusDamageType).toBe("slashing");
			expect(eff.notes).toHaveLength(1);
			expect(eff.notes[0]).toContain("Saw-toothed");
		});

		it("should return Brutal note", () => {
			const eff = CharacterSheetUpgrades.getUpgradeEffects({
				appliedUpgrades: [{name: "Brutal", source: "TCAH"}],
			});
			expect(eff.notes).toHaveLength(1);
			expect(eff.notes[0]).toContain("Brutal");
			expect(eff.notes[0]).toContain("Reroll max");
		});

		it("should return Flanged note", () => {
			const eff = CharacterSheetUpgrades.getUpgradeEffects({
				appliedUpgrades: [{name: "Flanged", source: "TCAH"}],
			});
			expect(eff.notes).toHaveLength(1);
			expect(eff.notes[0]).toContain("Flanged");
			expect(eff.notes[0]).toContain("AC");
		});

		it("should combine tags and notes from multiple upgrades", () => {
			const eff = CharacterSheetUpgrades.getUpgradeEffects({
				appliedUpgrades: [
					{name: "Silvered", source: "TCAH"},
					{name: "Balanced", source: "TCAH"},
					{name: "Brutal", source: "TCAH"},
				],
			});
			expect(eff.tags).toContain("Silvered");
			expect(eff.bonusWeaponAttack).toBe(1);
			expect(eff.notes).toHaveLength(1);
		});

		it("should return empty tags/notes for pure bonus upgrades", () => {
			const eff = CharacterSheetUpgrades.getUpgradeEffects({
				appliedUpgrades: [{name: "Balanced", source: "TCAH"}],
			});
			expect(eff.tags).toHaveLength(0);
			expect(eff.notes).toHaveLength(0);
			expect(eff.bonusDamageDice).toBeNull();
		});
	});

	// ==========================================================================
	// Armor Upgrade Notes
	// ==========================================================================
	describe("Armor Upgrade Notes", () => {
		it("should return notes for each armor upgrade type", () => {
			const notes = CharacterSheetUpgrades.getArmorUpgradeNotes({
				appliedUpgrades: [
					{name: "Muffled", source: "TCAH"},
					{name: "Reinforced", source: "TCAH"},
					{name: "Spiked", source: "TCAH"},
				],
			});
			expect(notes).toHaveLength(3);
			expect(notes.find(n => n.label === "Muffled")).toBeTruthy();
			expect(notes.find(n => n.label === "Reinforced")).toBeTruthy();
			expect(notes.find(n => n.label === "Spiked")).toBeTruthy();
		});

		it("should return Armor Proofing note with tier info", () => {
			const notes = CharacterSheetUpgrades.getArmorUpgradeNotes({
				appliedUpgrades: [{name: "Armor Proofing: 2nd Tier", source: "TCAH"}],
			});
			expect(notes).toHaveLength(1);
			expect(notes[0].label).toContain("Tier 2");
			expect(notes[0].description).toContain("7");
		});

		it("should return empty notes for item with no upgrades", () => {
			const notes = CharacterSheetUpgrades.getArmorUpgradeNotes({});
			expect(notes).toHaveLength(0);
		});

		it("should return Breathable note", () => {
			const notes = CharacterSheetUpgrades.getArmorUpgradeNotes({
				appliedUpgrades: [{name: "Breathable", source: "TCAH"}],
			});
			expect(notes).toHaveLength(1);
			expect(notes[0].description).toContain("heat");
		});

		it("should return Insulated note", () => {
			const notes = CharacterSheetUpgrades.getArmorUpgradeNotes({
				appliedUpgrades: [{name: "Insulated", source: "TCAH"}],
			});
			expect(notes).toHaveLength(1);
			expect(notes[0].description).toContain("cold weather");
		});

		it("should return Quick-release Clasps note", () => {
			const notes = CharacterSheetUpgrades.getArmorUpgradeNotes({
				appliedUpgrades: [{name: "Quick-release Clasps", source: "TCAH"}],
			});
			expect(notes).toHaveLength(1);
			expect(notes[0].description).toContain("Doff");
		});

		it("should return Decorated note", () => {
			const notes = CharacterSheetUpgrades.getArmorUpgradeNotes({
				appliedUpgrades: [{name: "Decorated", source: "TCAH"}],
			});
			expect(notes).toHaveLength(1);
			expect(notes[0].description).toContain("focus");
		});
	});

	// ==========================================================================
	// Reinforced Crit Damage Reduction
	// ==========================================================================
	describe("Reinforced Crit Damage Reduction", () => {
		it("should return critDamageReduction from Reinforced", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Reinforced", source: "TCAH"}],
			});
			expect(effects.critDamageReduction).toBe(3);
		});

		it("should return 0 for no Reinforced", () => {
			const effects = CharacterSheetUpgrades.getArmorUpgradeEffects({
				appliedUpgrades: [{name: "Muffled", source: "TCAH"}],
			});
			expect(effects.critDamageReduction).toBe(0);
		});

		it("should expose getCritDamageReduction on state", () => {
			expect(state.getCritDamageReduction()).toBe(0);

			state._data.ac.armor = {
				ac: 18,
				type: "heavy",
				name: "Plate",
				appliedUpgrades: [{name: "Reinforced", source: "TCAH"}],
			};

			expect(state.getCritDamageReduction()).toBe(3);
		});
	});

	// ==========================================================================
	// Gemstone Summaries
	// ==========================================================================
	describe("Gemstone Summaries", () => {
		it("should return summary for known gemstone", () => {
			const summary = CharacterSheetUpgrades.getGemstoneSummary({name: "Journey"});
			expect(summary).toContain("+10 speed");
		});

		it("should return summary for Warrior gemstone", () => {
			const summary = CharacterSheetUpgrades.getGemstoneSummary({name: "Warrior"});
			expect(summary).toContain("disarmed");
		});

		it("should return summary for Tempest gemstone", () => {
			const summary = CharacterSheetUpgrades.getGemstoneSummary({name: "Tempest"});
			expect(summary).toContain("lightning");
		});

		it("should return empty string for null gem", () => {
			expect(CharacterSheetUpgrades.getGemstoneSummary(null)).toBe("");
		});

		it("should fall back to entries for unknown gemstone", () => {
			const summary = CharacterSheetUpgrades.getGemstoneSummary({name: "Custom Gem", entries: ["Does something cool"]});
			expect(summary).toBe("Does something cool");
		});
	});

	// ==========================================================================
	// Gemstone Passive Effects
	// ==========================================================================
	describe("Gemstone Passive Effects", () => {
		it("should detect Journey speed bonus", () => {
			const effects = CharacterSheetUpgrades.getGemstonePassiveEffects({name: "Journey"});
			expect(effects.speedBonus).toBe(10);
			expect(effects.notes).toHaveLength(1);
		});

		it("should detect Overshield passive note", () => {
			const effects = CharacterSheetUpgrades.getGemstonePassiveEffects({name: "Overshield"});
			expect(effects.notes[0]).toContain("8 temp HP");
		});

		it("should detect Warrior passive note", () => {
			const effects = CharacterSheetUpgrades.getGemstonePassiveEffects({name: "Warrior"});
			expect(effects.notes[0]).toContain("disarmed");
		});

		it("should return no effects for unknown gem", () => {
			const effects = CharacterSheetUpgrades.getGemstonePassiveEffects({name: "Random Custom"});
			expect(effects.speedBonus).toBe(0);
			expect(effects.notes).toHaveLength(0);
		});

		it("should detect Volant flight speed sentinel", () => {
			const effects = CharacterSheetUpgrades.getGemstonePassiveEffects({name: "Volant"});
			expect(effects.flightSpeed).toBe(-1);
			expect(effects.notes[0]).toContain("flight");
		});

		it("should return flightSpeed 0 for non-Volant gems", () => {
			const effects = CharacterSheetUpgrades.getGemstonePassiveEffects({name: "Journey"});
			expect(effects.flightSpeed).toBe(0);
		});

		// Passive gems (always-on effects)
		it.each([
			["Featherfoot", "jump"],
			["Nondetection", "divination"],
			["Daywalker", "sunlight"],
			["Force of Will", "enchantment"],
			["Chaos", "Wild Magic"],
			["Retribution", "advantage"],
			["Alchemist", "+2 HP"],
			["Mariner", "underwater"],
			["Blood Weapon", "Critical hit"],
			["Wolfsbane", "moonlight"],
			["Dragonbane", "dragon"],
			["Giant Slayer", "Large"],
			["Superconductor", "charges"],
			["Tempest", "lightning"],
		])("should return passive note for %s containing '%s'", (gemName, keyword) => {
			const effects = CharacterSheetUpgrades.getGemstonePassiveEffects({name: gemName});
			expect(effects.notes).toHaveLength(1);
			expect(effects.notes[0].toLowerCase()).toContain(keyword.toLowerCase());
		});

		// Active/charge gems (daily/limited use)
		it.each([
			["Thief", "1/day"],
			["Arrow-catcher", "3 charges"],
			["Bound Armor", "don/doff"],
			["Bound Weapon", "disappear"],
			["Cat", "darkvision"],
			["Elemental Shield", "reduce"],
			["Knock", "Knock"],
			["Serpent", "poisoned"],
			["Bastion", "dome"],
			["Berserker", "Hit Dice"],
			["Chalice", "spell"],
			["Death", "zombie"],
			["Hunt", "mark"],
			["Magebane", "end"],
			["Phoenix", "0 HP"],
			["Soultrap", "spell slot"],
			["Warmage", "concentration"],
			["Displacement", "teleport"],
			["Earthshaker", "Earthquake"],
			["Mark/Recall", "teleport"],
			["Mime", "magic item"],
		])("should return active note for %s containing '%s'", (gemName, keyword) => {
			const effects = CharacterSheetUpgrades.getGemstonePassiveEffects({name: gemName});
			expect(effects.notes).toHaveLength(1);
			expect(effects.notes[0].toLowerCase()).toContain(keyword.toLowerCase());
		});

		it("should return notes for all 39 gemstones", () => {
			const allGems = [
				"Alchemist", "Mariner", "Thief", "Warrior",
				"Arrow-catcher", "Bound Armor", "Bound Weapon", "Cat", "Chaos",
				"Daywalker", "Elemental Shield", "Featherfoot", "Knock", "Nondetection", "Serpent",
				"Bastion", "Berserker", "Chalice", "Death", "Hunt", "Journey",
				"Magebane", "Phoenix", "Soultrap", "Superconductor", "Warmage",
				"Blood Weapon", "Displacement", "Dragonbane", "Earthshaker",
				"Giant Slayer", "Mark/Recall", "Overshield", "Retribution", "Wolfsbane",
				"Force of Will", "Mime", "Tempest", "Volant",
			];
			for (const name of allGems) {
				const effects = CharacterSheetUpgrades.getGemstonePassiveEffects({name});
				expect(effects.notes.length).toBeGreaterThan(0);
			}
		});
	});

	// ==========================================================================
	// Gemstone Speed Bonus (Journey)
	// ==========================================================================
	describe("Gemstone Speed Bonus", () => {
		it("should add Journey gemstone speed to walk speed", () => {
			state.setSpeed("walk", 30);
			const baseSpeed = state.getWalkSpeed();

			state.addItem({name: "Armor", source: "PHB", type: "LA", armor: true}, 1, true);
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Journey", source: "TGTT", gemName: "Star Ruby"});

			expect(state.getGemstoneSpeedBonus()).toBe(10);
			expect(state.getWalkSpeed()).toBe(baseSpeed + 10);
		});

		it("should not add speed for unequipped items", () => {
			state.setSpeed("walk", 30);
			state.addItem({name: "Armor", source: "PHB", type: "LA", armor: true}, 1, false);
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Journey", source: "TGTT", gemName: "Star Ruby"});

			expect(state.getGemstoneSpeedBonus()).toBe(0);
		});
	});

	// ==========================================================================
	// Volant Flight Speed
	// ==========================================================================
	describe("Volant Flight Speed", () => {
		it("should grant hover flight speed = 2x walk from Volant gem", () => {
			state.setSpeed("walk", 30);
			state.addItem({name: "Sword", source: "PHB", type: "M", weapon: true}, 1, true);
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Volant", source: "TGTT", gemName: "Diamond"});

			expect(state.getGemstoneFlightSpeed()).toBe(60);
		});

		it("should return 0 flight speed without Volant gem", () => {
			expect(state.getGemstoneFlightSpeed()).toBe(0);
		});

		it("should not grant flight for unequipped Volant gem", () => {
			state.setSpeed("walk", 30);
			state.addItem({name: "Sword", source: "PHB", type: "M", weapon: true}, 1, false);
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Volant", source: "TGTT", gemName: "Diamond"});

			expect(state.getGemstoneFlightSpeed()).toBe(0);
		});

		it("should include Volant flight in getSpeedByType fly", () => {
			state.setSpeed("walk", 30);
			state.addItem({name: "Sword", source: "PHB", type: "M", weapon: true}, 1, true);
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Volant", source: "TGTT", gemName: "Diamond"});

			const flySpeed = state.getSpeedByType("fly");
			expect(flySpeed).toBe(60);
		});

		it("should include Volant flight in getSpeed display string", () => {
			state.setSpeed("walk", 30);
			state.addItem({name: "Sword", source: "PHB", type: "M", weapon: true}, 1, true);
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Volant", source: "TGTT", gemName: "Diamond"});

			const speedStr = state.getSpeed();
			expect(speedStr).toContain("fly 60 ft.");
		});
	});

	// ==========================================================================
	// Gemstone Daily Tracking
	// ==========================================================================
	describe("Gemstone Daily Tracking", () => {
		it("should mark gemstone as used today", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Cat", source: "TGTT", gemName: "Chrysoberyl"});

			const result = state.useGemstoneDaily(itemId, "Cat");
			expect(result.success).toBe(true);

			const gems = state.getSocketedGemstones(itemId);
			expect(gems[0].usedToday).toBe(true);
		});

		it("should prevent double use", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Cat", source: "TGTT", gemName: "Chrysoberyl"});

			state.useGemstoneDaily(itemId, "Cat");
			const result = state.useGemstoneDaily(itemId, "Cat");
			expect(result.success).toBe(false);
			expect(result.error).toContain("Already used");
		});

		it("should reset daily use on recharge", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Cat", source: "TGTT", gemName: "Chrysoberyl"});

			state.useGemstoneDaily(itemId, "Cat");
			expect(state.getSocketedGemstones(itemId)[0].usedToday).toBe(true);

			state.rechargeAllGemstones();
			expect(state.getSocketedGemstones(itemId)[0].usedToday).toBe(false);
		});

		it("should reset daily use manually", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Cat", source: "TGTT", gemName: "Chrysoberyl"});

			state.useGemstoneDaily(itemId, "Cat");
			state.resetGemstoneDaily(itemId, "Cat");
			expect(state.getSocketedGemstones(itemId)[0].usedToday).toBe(false);
		});
	});

	// ==========================================================================
	// Armor Upgrade Notes on State
	// ==========================================================================
	describe("Armor Upgrade Notes on State", () => {
		it("should return armor upgrade notes from state", () => {
			state._data.ac.armor = {
				ac: 15,
				type: "medium",
				name: "Brigandine",
				appliedUpgrades: [
					{name: "Muffled", source: "TCAH"},
					{name: "Spiked", source: "TCAH"},
				],
			};

			const notes = state.getArmorUpgradeNotes();
			expect(notes).toHaveLength(2);
			expect(notes.find(n => n.label === "Muffled")).toBeTruthy();
			expect(notes.find(n => n.label === "Spiked")).toBeTruthy();
		});

		it("should return empty notes for no armor", () => {
			const notes = state.getArmorUpgradeNotes();
			expect(notes).toHaveLength(0);
		});
	});

	// ==========================================================================
	// Gemstone Passive Notes on State
	// ==========================================================================
	describe("Gemstone Passive Notes on State", () => {
		it("should return passive notes from equipped items with gemstones", () => {
			state.addItem({name: "Armor", source: "PHB", type: "LA", armor: true}, 1, true);
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Overshield", source: "TGTT", gemName: "Black Opal"});

			const notes = state.getGemstonePassiveNotes();
			expect(notes.length).toBeGreaterThan(0);
			expect(notes[0]).toContain("temp HP");
		});

		it("should not return notes from unequipped items", () => {
			state.addItem({name: "Armor", source: "PHB", type: "LA", armor: true}, 1, false);
			const itemId = state.getItems()[0].id;
			state.socketGemstone(itemId, {name: "Overshield", source: "TGTT", gemName: "Black Opal"});

			const notes = state.getGemstonePassiveNotes();
			expect(notes).toHaveLength(0);
		});
	});
});
