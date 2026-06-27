/**
 * Character Sheet Item Upgrade Bonuses — Mechanical Effect Tests (S6, bugs #14 & #15)
 *
 * #14 Weapon upgrades must flow their attack/damage bonuses (and non-flat riders) through
 *     `getEffectiveItemBonuses()`, which is what combat auto-attack generation consumes.
 * #15 Armor upgrades must reach the armor-upgrade consumers (Stealth/Muffled,
 *     crit-reduction/Reinforced, display notes) via a LIVE resolve of the equipped armor item,
 *     immune to the AC snapshot omitting `appliedUpgrades` and to apply-while-equipped staleness.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Item Upgrade Bonuses (#14 weapon, #15 armor)", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("str", 16);
		state.setAbilityBase("dex", 14);
		state.setCurrency("gp", 5000);
	});

	// ==========================================================================
	// #14 — Weapon upgrade attack/damage bonuses flow through getEffectiveItemBonuses
	// ==========================================================================
	describe("#14 Weapon upgrades → attack/damage", () => {
		function addWeapon () {
			state.addItem({name: "Longsword", source: "PHB", type: "M", weapon: true});
			return state.getItems()[0].id;
		}

		it("Balanced raises bonusWeaponAttack by 1; removal reverts", () => {
			const id = addWeapon();
			expect(state.getEffectiveItemBonuses(id).bonusWeaponAttack).toBe(0);

			state.applyItemUpgrade(id, {name: "Balanced", source: "TCAH", upgradeType: ["WU:1"]}, 100);
			expect(state.getEffectiveItemBonuses(id).bonusWeaponAttack).toBe(1);

			state.removeItemUpgrade(id, "Balanced", "TCAH");
			expect(state.getEffectiveItemBonuses(id).bonusWeaponAttack).toBe(0);
		});

		it("Wounding raises bonusWeaponDamage by 1; removal reverts", () => {
			const id = addWeapon();
			expect(state.getEffectiveItemBonuses(id).bonusWeaponDamage).toBe(0);

			state.applyItemUpgrade(id, {name: "Wounding: Keen", source: "TCAH", upgradeType: ["WU:1"]}, 100);
			expect(state.getEffectiveItemBonuses(id).bonusWeaponDamage).toBe(1);

			state.removeItemUpgrade(id, "Wounding: Keen", "TCAH");
			expect(state.getEffectiveItemBonuses(id).bonusWeaponDamage).toBe(0);
		});

		it("Masterwork raises both attack and damage by 1", () => {
			const id = addWeapon();
			state.applyItemUpgrade(id, {name: "Masterwork", source: "TCAH", upgradeType: ["WU:2"]}, 500);
			const bonuses = state.getEffectiveItemBonuses(id);
			expect(bonuses.bonusWeaponAttack).toBe(1);
			expect(bonuses.bonusWeaponDamage).toBe(1);
		});

		it("stacks upgrade attack/damage on top of base item bonuses", () => {
			state.addItem({name: "Longsword +1", source: "PHB", type: "M", weapon: true, bonusWeaponAttack: 1, bonusWeaponDamage: 1});
			const id = state.getItems()[0].id;
			state.applyItemUpgrade(id, {name: "Masterwork", source: "TCAH", upgradeType: ["WU:2"]}, 500);
			const bonuses = state.getEffectiveItemBonuses(id);
			expect(bonuses.bonusWeaponAttack).toBe(2);
			expect(bonuses.bonusWeaponDamage).toBe(2);
		});

		it("surfaces Saw-toothed non-flat damage rider (previously dropped at this boundary)", () => {
			const id = addWeapon();
			// Default: no rider
			let bonuses = state.getEffectiveItemBonuses(id);
			expect(bonuses.bonusDamageDice).toBeNull();
			expect(bonuses.bonusDamageType).toBeNull();

			state.applyItemUpgrade(id, {name: "Saw-toothed", source: "TCAH", upgradeType: ["WU:2"]}, 500);
			bonuses = state.getEffectiveItemBonuses(id);
			expect(bonuses.bonusDamageDice).toBe("1d4");
			expect(bonuses.bonusDamageType).toBe("slashing");

			state.removeItemUpgrade(id, "Saw-toothed", "TCAH");
			bonuses = state.getEffectiveItemBonuses(id);
			expect(bonuses.bonusDamageDice).toBeNull();
			expect(bonuses.bonusDamageType).toBeNull();
		});

		it("surfaces upgrade-granted weapon tags (Silvered / Magical)", () => {
			const id = addWeapon();
			expect(state.getEffectiveItemBonuses(id).tags).toEqual([]);

			state.applyItemUpgrade(id, {name: "Silvered", source: "TCAH", upgradeType: ["WU:1"]}, 100);
			state.applyItemUpgrade(id, {name: "Magical", source: "TCAH", upgradeType: ["WU:3"]}, 5000);
			const tags = state.getEffectiveItemBonuses(id).tags;
			expect(tags).toEqual(expect.arrayContaining(["Silvered", "Magical"]));

			state.removeItemUpgrade(id, "Silvered", "TCAH");
			state.removeItemUpgrade(id, "Magical", "TCAH");
			expect(state.getEffectiveItemBonuses(id).tags).toEqual([]);
		});
	});

	// ==========================================================================
	// #15 — Armor upgrades reach defensive consumers via live-resolve of equipped armor
	// ==========================================================================
	describe("#15 Armor upgrades → defensive consumers", () => {
		function addEquippedArmor () {
			// Equipped medium armor that imposes stealth disadvantage. The AC snapshot is set
			// WITHOUT appliedUpgrades on purpose, to prove the live-resolve fix (the old code
			// only ever read this snapshot, so every armor-upgrade mechanic was dead).
			state.addItem({name: "Half Plate", source: "PHB", type: "MA", armor: true, armorType: "medium", ac: 15}, 1, true);
			state._data.ac.armor = {type: "medium", ac: 15, stealth: true};
			return state.getItems().find(i => i.armor).id;
		}

		it("Muffled removes stealth disadvantage on already-equipped armor; removal reverts (no staleness)", () => {
			const id = addEquippedArmor();
			expect(state.hasArmorStealthDisadvantage()).toBe(true);

			// Apply WHILE equipped — must take effect without re-equipping.
			state.applyItemUpgrade(id, {name: "Muffled", source: "TCAH", upgradeType: ["AU"]}, 200);
			expect(state.hasArmorStealthDisadvantage()).toBe(false);

			state.removeItemUpgrade(id, "Muffled", "TCAH");
			expect(state.hasArmorStealthDisadvantage()).toBe(true);
		});

		it("Reinforced grants crit damage reduction of 3; removal reverts to 0", () => {
			const id = addEquippedArmor();
			expect(state.getCritDamageReduction()).toBe(0);

			state.applyItemUpgrade(id, {name: "Reinforced", source: "TCAH", upgradeType: ["AU"]}, 200);
			expect(state.getCritDamageReduction()).toBe(3);

			state.removeItemUpgrade(id, "Reinforced", "TCAH");
			expect(state.getCritDamageReduction()).toBe(0);
		});

		it("getArmorUpgradeNotes surfaces equipped-armor upgrade notes; empty after removal", () => {
			const id = addEquippedArmor();
			expect(state.getArmorUpgradeNotes()).toEqual([]);

			state.applyItemUpgrade(id, {name: "Reinforced", source: "TCAH", upgradeType: ["AU"]}, 200);
			const notes = state.getArmorUpgradeNotes();
			expect(notes.some(n => n.label === "Reinforced")).toBe(true);

			state.removeItemUpgrade(id, "Reinforced", "TCAH");
			expect(state.getArmorUpgradeNotes()).toEqual([]);
		});

		it("falls back to the AC snapshot's appliedUpgrades when no inventory armor item exists (Builder/QuickBuild path)", () => {
			// No inventory item — armor came straight from a builder snapshot that DID carry upgrades.
			state._data.ac.armor = {type: "medium", ac: 15, stealth: true, appliedUpgrades: [{name: "Muffled", source: "TCAH"}]};
			expect(state.hasArmorStealthDisadvantage()).toBe(false);
		});

		it("does NOT resurrect a stale snapshot upgrade when the live equipped armor has none", () => {
			// Live equipped armor with NO upgrades, but a stale snapshot still carrying Muffled.
			// The live item is authoritative, so stealth disadvantage must remain.
			state.addItem({name: "Half Plate", source: "PHB", type: "MA", armor: true, armorType: "medium", ac: 15}, 1, true);
			state._data.ac.armor = {type: "medium", ac: 15, stealth: true, appliedUpgrades: [{name: "Muffled", source: "TCAH"}]};
			expect(state.hasArmorStealthDisadvantage()).toBe(true);
		});

		it("flows an upgrade applied before equipping through the production equip() path", () => {
			// Add unequipped, upgrade, THEN equip via the real production method.
			state.addItem({name: "Half Plate", source: "PHB", type: "MA", armor: true, armorType: "medium", ac: 15}, 1, false);
			const id = state.getItems().find(i => i.armor).id;
			state.applyItemUpgrade(id, {name: "Reinforced", source: "TCAH", upgradeType: ["AU"]}, 200);
			expect(state.getCritDamageReduction()).toBe(0); // not equipped yet

			state.equip(id);
			expect(state.getCritDamageReduction()).toBe(3);
			// And the production equip path threaded appliedUpgrades into the AC snapshot too.
			expect(state._data.ac.armor.appliedUpgrades.some(u => u.name === "Reinforced")).toBe(true);
		});
	});
});
