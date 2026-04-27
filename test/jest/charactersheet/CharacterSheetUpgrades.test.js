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
});
