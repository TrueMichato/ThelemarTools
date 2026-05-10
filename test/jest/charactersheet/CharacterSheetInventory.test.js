/**
 * Character Sheet Inventory - Unit Tests
 * Tests for item management, encumbrance, AC calculation, and attunement
 *
 * NOTE: The inventory uses a wrapper structure:
 *   { id, item: {...itemData}, quantity, equipped, attuned }
 * Methods use setItemEquipped/setItemAttuned/setItemQuantity for updates.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Inventory Management", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 15); // 15 STR for encumbrance tests
		state.setAbilityBase("dex", 14);
	});

	// ==========================================================================
	// Basic Item Operations
	// ==========================================================================
	describe("Basic Item Operations", () => {
		it("should add an item to inventory", () => {
			state.addItem({
				name: "Longsword",
				source: "PHB",
				quantity: 1,
				weight: 3,
			});
			const items = state.getInventory();
			expect(items).toHaveLength(1);
			// Note: items are wrapped - actual item data is in .item
			expect(items[0].item.name).toBe("Longsword");
		});

		it("should remove an item from inventory", () => {
			state.addItem({name: "Shield", source: "PHB", quantity: 1});
			const items = state.getInventory();
			// Use the generated ID from the inventory entry
			state.removeItem(items[0].id);
			expect(state.getInventory()).toHaveLength(0);
		});

		it("should set item quantity", () => {
			state.addItem({name: "Arrows", source: "PHB", quantity: 20});
			const items = state.getInventory();
			state.setItemQuantity(items[0].id, 15);
			expect(state.getInventory()[0].quantity).toBe(15);
		});

		it("should remove item when quantity set to 0", () => {
			state.addItem({name: "Rations", source: "PHB", quantity: 5});
			const items = state.getInventory();
			state.setItemQuantity(items[0].id, 0);
			expect(state.getInventory()).toHaveLength(0);
		});

		it("should stack same items when added", () => {
			state.addItem({name: "Gold Pieces", source: "PHB", quantity: 50});
			state.addItem({name: "Gold Pieces", source: "PHB", quantity: 25});
			const items = state.getInventory();
			expect(items).toHaveLength(1);
			expect(items[0].quantity).toBe(75);
		});

		it("should get items via getItems helper (flattened structure)", () => {
			state.addItem({name: "Torch", source: "PHB", quantity: 10, weight: 1});
			const items = state.getItems();
			expect(items).toHaveLength(1);
			// getItems() returns flattened view with name directly on object
			expect(items[0].name).toBe("Torch");
			expect(items[0].quantity).toBe(10);
		});
	});

	// ==========================================================================
	// Type-Code Enrichment (builder path uses raw data-file items with type codes)
	// ==========================================================================
	describe("Type-Code Enrichment via addItem()", () => {
		it("should set shield flag for raw item with type 'S'", () => {
			state.addItem({name: "Shield", source: "PHB", type: "S"});
			const inv = state.getInventory();
			expect(inv[0].item.shield).toBe(true);
			expect(inv[0].item.armor).toBe(false);
		});

		it("should set armor flag and armorType for heavy armor type 'HA'", () => {
			state.addItem({name: "Chain Mail", source: "PHB", type: "HA", ac: 16});
			const inv = state.getInventory();
			expect(inv[0].item.armor).toBe(true);
			expect(inv[0].item.armorType).toBe("heavy");
			expect(inv[0].item.shield).toBe(false);
		});

		it("should set armor flag and armorType for medium armor type 'MA'", () => {
			state.addItem({name: "Scale Mail", source: "PHB", type: "MA", ac: 14});
			const inv = state.getInventory();
			expect(inv[0].item.armor).toBe(true);
			expect(inv[0].item.armorType).toBe("medium");
		});

		it("should set armor flag and armorType for light armor type 'LA'", () => {
			state.addItem({name: "Leather Armor", source: "PHB", type: "LA", ac: 11});
			const inv = state.getInventory();
			expect(inv[0].item.armor).toBe(true);
			expect(inv[0].item.armorType).toBe("light");
		});

		it("should not overwrite shield flag already set by inventory enrichment", () => {
			state.addItem({name: "Shield", source: "PHB", type: "S", shield: true});
			const inv = state.getInventory();
			expect(inv[0].item.shield).toBe(true);
		});

		it("should not overwrite armor flag already set by inventory enrichment", () => {
			state.addItem({name: "Breastplate", source: "PHB", type: "MA", armor: true, armorType: "medium", ac: 14});
			const inv = state.getInventory();
			expect(inv[0].item.armor).toBe(true);
			expect(inv[0].item.armorType).toBe("medium");
		});

		it("should not set shield or armor flag for non-armor types", () => {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			const inv = state.getInventory();
			expect(inv[0].item.shield).toBe(false);
			expect(inv[0].item.armor).toBe(false);
		});
	});

	// ==========================================================================
	// Equipment (Equip/Unequip)
	// ==========================================================================
	describe("Equipment", () => {
		it("should set item as equipped", () => {
			state.addItem({name: "Chain Mail", source: "PHB", equipped: false});
			const items = state.getInventory();
			state.setItemEquipped(items[0].id, true);
			expect(state.getInventory()[0].equipped).toBe(true);
		});

		it("should set item as unequipped", () => {
			state.addItem({name: "Plate Armor", source: "PHB", equipped: true});
			const items = state.getInventory();
			state.setItemEquipped(items[0].id, false);
			expect(state.getInventory()[0].equipped).toBe(false);
		});

		it("should toggle equipped status", () => {
			state.addItem({name: "Leather Armor", source: "PHB", equipped: false});
			const items = state.getInventory();
			const itemId = items[0].id;

			// Equip
			state.setItemEquipped(itemId, true);
			expect(state.getInventory()[0].equipped).toBe(true);

			// Unequip
			state.setItemEquipped(itemId, false);
			expect(state.getInventory()[0].equipped).toBe(false);
		});

		it("should filter equipped items from inventory", () => {
			state.addItem({name: "Sword", source: "PHB", quantity: 1, equipped: true});
			state.addItem({name: "Bow", source: "PHB", quantity: 1, equipped: false});
			state.addItem({name: "Shield", source: "PHB", quantity: 1, equipped: true});
			const equipped = state.getInventory().filter(i => i.equipped);
			expect(equipped).toHaveLength(2);
		});
	});

	// ==========================================================================
	// Attunement
	// ==========================================================================
	describe("Attunement", () => {
		it("should set item as attuned", () => {
			state.addItem({name: "Ring of Protection", source: "PHB", quantity: 1, requiresAttunement: true, attuned: false});
			const items = state.getInventory();
			state.setItemAttuned(items[0].id, true);
			expect(state.getInventory()[0].attuned).toBe(true);
		});

		it("should set item as unattuned", () => {
			state.addItem({name: "Cloak of Elvenkind", source: "PHB", quantity: 1, requiresAttunement: true, attuned: true});
			const items = state.getInventory();
			state.setItemAttuned(items[0].id, false);
			expect(state.getInventory()[0].attuned).toBe(false);
		});

		it("should count attuned items", () => {
			state.addItem({name: "Amulet", source: "PHB", quantity: 1, requiresAttunement: true, attuned: true});
			state.addItem({name: "Ring", source: "PHB", quantity: 1, requiresAttunement: true, attuned: true});
			state.addItem({name: "Sword", source: "PHB", quantity: 1, requiresAttunement: false, attuned: false});
			expect(state.getAttunedCount()).toBe(2);
		});

		it("should track max attunement slots (default 3)", () => {
			// Default character can attune 3 items
			expect(state.getMaxAttunement()).toBe(3);
		});

		it("should increase attunement for Artificer levels", () => {
			state = new CharacterSheetState();
			state.addClass({name: "Artificer", source: "TCE", level: 10});
			// Artificer 10+ gets 4 attunement slots (Magic Item Adept)
			expect(state.getMaxAttunement()).toBe(4);
		});

		it("should check attunement capacity", () => {
			state.addItem({name: "Item 1", source: "PHB", quantity: 1, requiresAttunement: true, attuned: true});
			expect(state.getAttunedCount()).toBeLessThan(state.getMaxAttunement());

			state.addItem({name: "Item 2", source: "PHB", quantity: 1, requiresAttunement: true, attuned: true});
			state.addItem({name: "Item 3", source: "PHB", quantity: 1, requiresAttunement: true, attuned: true});
			expect(state.getAttunedCount()).toBe(state.getMaxAttunement());
		});

		it("should filter attuned items from inventory", () => {
			state.addItem({name: "Ring", source: "PHB", quantity: 1, requiresAttunement: true, attuned: true});
			state.addItem({name: "Amulet", source: "PHB", quantity: 1, requiresAttunement: true, attuned: false});
			state.addItem({name: "Cloak", source: "PHB", quantity: 1, requiresAttunement: true, attuned: true});
			const attuned = state.getInventory().filter(i => i.attuned);
			expect(attuned).toHaveLength(2);
		});
	});

	// ==========================================================================
	// Encumbrance
	// ==========================================================================
	describe("Encumbrance", () => {
		it("should calculate total inventory weight", () => {
			state.addItem({name: "Longsword", source: "PHB", weight: 3, quantity: 1});
			state.addItem({name: "Shield", source: "PHB", weight: 6, quantity: 1});
			state.addItem({name: "Backpack", source: "PHB", weight: 5, quantity: 1});
			expect(state.getTotalWeight()).toBe(14); // 3 + 6 + 5
		});

		it("should multiply weight by quantity", () => {
			state.addItem({name: "Daggers", source: "PHB", weight: 1, quantity: 5});
			expect(state.getTotalWeight()).toBe(5);
		});

		it("should calculate carrying capacity (15 x STR)", () => {
			// Set to 2024 rules for predictable 15 x STR capacity
			state.setSetting("thelemar_carryWeight", false);
			expect(state.getCarryingCapacity()).toBe(225);
		});

		it("should handle items without weight", () => {
			state.addItem({name: "Ring", source: "PHB", quantity: 1}); // No weight specified
			state.addItem({name: "Sword", source: "PHB", weight: 3, quantity: 1});
			expect(state.getTotalWeight()).toBe(3);
		});
	});

	// ==========================================================================
	// Armor and AC
	// ==========================================================================
	describe("Armor and AC", () => {
		it("should calculate base AC (10 + DEX)", () => {
			// DEX 14 = +2, so base AC = 12
			expect(state.getAc()).toBe(12);
		});

		it("should apply light armor with full DEX", () => {
			state.setArmor({name: "Leather Armor", ac: 11, type: "light"});
			// AC = 11 + DEX (14 = +2) = 13
			expect(state.getAc()).toBe(13);
		});

		it("should cap DEX bonus for medium armor", () => {
			state.setAbilityBase("dex", 18); // +4 DEX
			state.setArmor({name: "Half Plate", ac: 15, type: "medium"});
			// AC = 15 + 2 (max DEX for medium) = 17
			expect(state.getAc()).toBe(17);
		});

		it("should ignore DEX for heavy armor", () => {
			state.setAbilityBase("dex", 18); // +4 DEX (ignored)
			state.setArmor({name: "Plate", ac: 18, type: "heavy"});
			expect(state.getAc()).toBe(18);
		});

		it("should add shield bonus", () => {
			state.setArmor({name: "Chain Mail", ac: 16, type: "heavy"});
			state.setShield(true);
			expect(state.getAc()).toBe(18);
		});

		it("should apply item AC bonus", () => {
			// Default AC = 10 + DEX(2) = 12
			state.setItemAcBonus(1);
			expect(state.getAc()).toBe(13);
		});

		it("should combine armor, shield, and item bonus", () => {
			state.setArmor({name: "Chain Mail", ac: 16, type: "heavy"});
			state.setShield(true);
			state.setItemAcBonus(2);
			expect(state.getAc()).toBe(20); // 16 + 2 (shield) + 2 (item)
		});
	});

	// ==========================================================================
	// Currency
	// ==========================================================================
	describe("Currency", () => {
		it("should initialize currency to 0", () => {
			const currency = state.getCurrency();
			expect(currency.cp).toBe(0);
			expect(currency.sp).toBe(0);
			expect(currency.ep).toBe(0);
			expect(currency.gp).toBe(0);
			expect(currency.pp).toBe(0);
		});

		it("should set currency amounts by type", () => {
			state.setCurrency("gp", 100);
			state.setCurrency("sp", 50);
			state.setCurrency("cp", 25);
			const currency = state.getCurrency();
			expect(currency.gp).toBe(100);
			expect(currency.sp).toBe(50);
			expect(currency.cp).toBe(25);
		});

		it("should get currency by type", () => {
			state.setCurrency("gp", 100);
			expect(state.getCurrency("gp")).toBe(100);
			expect(state.getCurrency("sp")).toBe(0);
		});

		it("should not allow negative currency", () => {
			state.setCurrency("gp", -50);
			expect(state.getCurrency("gp")).toBe(0);
		});

		it("should calculate total wealth in GP", () => {
			state.setCurrency("pp", 1); // 1 pp = 10 gp
			state.setCurrency("gp", 10); // 10 gp
			state.setCurrency("ep", 2); // 2 ep = 1 gp
			state.setCurrency("sp", 10); // 10 sp = 1 gp
			state.setCurrency("cp", 100); // 100 cp = 1 gp
			// Total = 10 + 10 + 1 + 1 + 1 = 23 gp
			expect(state.getTotalGold()).toBe(23);
		});
	});

	// ==========================================================================
	// Item Charges
	// ==========================================================================
	describe("Item Charges", () => {
		it("should track item charges (max is item.charges, current is item.chargesCurrent)", () => {
			state.addItem({
				name: "Wand of Magic Missiles",
				source: "DMG",
				charges: 7, // max charges stored in item data
			});
			const item = state.getInventory()[0];
			// Max charges are on the item object
			expect(item.item.charges).toBe(7);
		});

		it("should set item charges", () => {
			state.addItem({
				name: "Staff of Fire",
				source: "DMG",
				charges: 10,
			});
			const items = state.getInventory();
			state.setItemCharges(items[0].id, 7);
			expect(state.getInventory()[0].item.chargesCurrent).toBe(7);
		});

		it("should not exceed max charges", () => {
			state.addItem({
				name: "Wand of Fireballs",
				source: "DMG",
				charges: 7,
			});
			const items = state.getInventory();
			state.setItemCharges(items[0].id, 10); // Trying to set more than max
			expect(state.getInventory()[0].item.chargesCurrent).toBe(7);
		});

		it("should not go below 0 charges", () => {
			state.addItem({
				name: "Rod of Wonder",
				source: "DMG",
				charges: 10,
			});
			const items = state.getInventory();
			state.setItemCharges(items[0].id, -5);
			expect(state.getInventory()[0].item.chargesCurrent).toBe(0);
		});
	});

	// ==========================================================================
	// Item Bonuses
	// ==========================================================================
	describe("Item Bonuses", () => {
		it("should set and get item bonuses by type", () => {
			state.setItemBonuses({ac: 1, savingThrow: 1});
			expect(state.getItemBonus("ac")).toBe(1);
			expect(state.getItemBonus("savingThrow")).toBe(1);
		});

		it("should return 0 for unset bonus types", () => {
			expect(state.getItemBonus("ac")).toBe(0);
			expect(state.getItemBonus("attack")).toBe(0);
		});

		it("should get all item bonuses", () => {
			state.setItemBonuses({ac: 2, attack: 1});
			const bonuses = state.getItemBonuses();
			expect(bonuses.ac).toBe(2);
			expect(bonuses.attack).toBe(1);
		});
	});

	// ==========================================================================
	// Item Filtering and Searching
	// ==========================================================================
	describe("Item Filtering", () => {
		beforeEach(() => {
			// Note: must include quantity to trigger equipped/attuned extraction in addItem
			state.addItem({name: "Longsword", source: "PHB", type: "weapon", quantity: 1, equipped: true});
			state.addItem({name: "Chain Mail", source: "PHB", type: "armor", quantity: 1, equipped: true});
			state.addItem({name: "Healing Potion", source: "PHB", type: "potion", quantity: 1, equipped: false});
			state.addItem({name: "Dagger", source: "PHB", type: "weapon", quantity: 1, equipped: false});
		});

		it("should filter inventory by equipped status", () => {
			const equipped = state.getInventory().filter(i => i.equipped);
			expect(equipped).toHaveLength(2);
		});

		it("should filter inventory by item type", () => {
			const weapons = state.getInventory().filter(i => i.item.type === "weapon");
			expect(weapons).toHaveLength(2);
		});

		it("should search inventory by name (case-insensitive)", () => {
			const results = state.getInventory().filter(i =>
				i.item.name.toLowerCase().includes("sword"),
			);
			expect(results).toHaveLength(1);
			expect(results[0].item.name).toBe("Longsword");
		});

		it("should use getItems() helper for flattened search", () => {
			const results = state.getItems().filter(i =>
				i.name.toLowerCase().includes("chain"),
			);
			expect(results).toHaveLength(1);
		});
	});
});
