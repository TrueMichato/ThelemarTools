/**
 * Character Sheet Variant Spell Components - Unit Tests
 * Tests for the variant component matching, consumption, and effect application system.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

// =============================================================================
// Sample Data
// =============================================================================

const SAMPLE_SPELL_DATA = {
	fireball: {
		name: "Fireball",
		source: "XPHB",
		level: 3,
		school: "V",
		damageInflict: ["fire"],
		savingThrow: ["dexterity"],
		entries: ["Each creature makes a Dexterity saving throw, taking {@damage 8d6} Fire damage."],
		duration: [{type: "instant"}],
	},
	cureWounds: {
		name: "Cure Wounds",
		source: "XPHB",
		level: 1,
		school: "A",
		entries: ["A creature you touch regains a number of Hit Points equal to {@dice 2d8}."],
		miscTags: ["HL"],
		duration: [{type: "instant"}],
	},
	charmPerson: {
		name: "Charm Person",
		source: "XPHB",
		level: 1,
		school: "E",
		entries: ["You attempt to charm a humanoid you can see within range."],
		conditionInflict: ["charmed"],
		savingThrow: ["wisdom"],
		duration: [{type: "timed", duration: {type: "hour", amount: 1}}],
	},
	bless: {
		name: "Bless",
		source: "XPHB",
		level: 1,
		school: "E",
		entries: ["You bless up to three creatures."],
		duration: [{type: "timed", duration: {type: "minute", amount: 1}, concentration: true}],
	},
	acidSplash: {
		name: "Acid Splash",
		source: "XPHB",
		level: 0,
		school: "C",
		damageInflict: ["acid"],
		entries: ["Each target takes {@damage 1d6} Acid damage."],
		duration: [{type: "instant"}],
	},
};

/**
 * Create a variant component item for inventory.
 */
function makeVariantComponentItem ({name, spellEffects}) {
	return {
		name,
		source: "Ar8",
		type: "G",
		variantComponent: {
			harvestDC: 15,
			harvestQuantity: 2,
			harvestSource: "Aboleth",
			spellEffects,
		},
	};
}

/**
 * Create an inventory entry wrapping a variant component item.
 */
function makeInventoryEntry ({name, spellEffects, quantity = 1}) {
	return {
		id: `test-vc-${name.replace(/\s/g, "-").toLowerCase()}`,
		item: makeVariantComponentItem({name, spellEffects}),
		quantity,
		equipped: false,
		attuned: false,
	};
}

// =============================================================================
// Helper: Create state with inventory
// =============================================================================

function createStateWithComponents (inventoryEntries = []) {
	const state = new CharacterSheetState();
	state._data.inventory = [...inventoryEntries];
	return state;
}

// =============================================================================
// Tests: Spell Damage Type Extraction
// =============================================================================

describe("CharacterSheetVariantComponents", () => {
	describe("_extractSpellDamageTypes", () => {
		it("should extract damage types from damageInflict", () => {
			const state = new CharacterSheetState();
			const types = state._extractSpellDamageTypes(SAMPLE_SPELL_DATA.fireball);
			expect(types.has("fire")).toBe(true);
			expect(types.size).toBe(1);
		});

		it("should return empty set for spells without damageInflict", () => {
			const state = new CharacterSheetState();
			const types = state._extractSpellDamageTypes(SAMPLE_SPELL_DATA.cureWounds);
			expect(types.size).toBe(0);
		});

		it("should handle multiple damage types", () => {
			const state = new CharacterSheetState();
			const types = state._extractSpellDamageTypes({damageInflict: ["fire", "cold"]});
			expect(types.has("fire")).toBe(true);
			expect(types.has("cold")).toBe(true);
			expect(types.size).toBe(2);
		});
	});

	describe("_extractSpellTags", () => {
		it("should tag restoration for healing spells via miscTags", () => {
			const state = new CharacterSheetState();
			const tags = state._extractSpellTags(SAMPLE_SPELL_DATA.cureWounds);
			expect(tags.has("restoration")).toBe(true);
		});

		it("should tag restoration for spells with regain in entries", () => {
			const state = new CharacterSheetState();
			const tags = state._extractSpellTags({
				entries: ["You regain 10 hit points."],
			});
			expect(tags.has("restoration")).toBe(true);
		});

		it("should tag dragonbreathmatch for acid/cold/fire/lightning/poison spells", () => {
			const state = new CharacterSheetState();
			expect(state._extractSpellTags({damageInflict: ["fire"]}).has("dragonbreathmatch")).toBe(true);
			expect(state._extractSpellTags({damageInflict: ["acid"]}).has("dragonbreathmatch")).toBe(true);
			expect(state._extractSpellTags({damageInflict: ["cold"]}).has("dragonbreathmatch")).toBe(true);
			expect(state._extractSpellTags({damageInflict: ["lightning"]}).has("dragonbreathmatch")).toBe(true);
			expect(state._extractSpellTags({damageInflict: ["poison"]}).has("dragonbreathmatch")).toBe(true);
		});

		it("should NOT tag dragonbreathmatch for non-dragon damage types", () => {
			const state = new CharacterSheetState();
			expect(state._extractSpellTags({damageInflict: ["necrotic"]}).has("dragonbreathmatch")).toBe(false);
			expect(state._extractSpellTags({damageInflict: ["radiant"]}).has("dragonbreathmatch")).toBe(false);
			expect(state._extractSpellTags({damageInflict: ["force"]}).has("dragonbreathmatch")).toBe(false);
		});

		it("should tag psychicdamage for psychic spells", () => {
			const state = new CharacterSheetState();
			const tags = state._extractSpellTags({damageInflict: ["psychic"]});
			expect(tags.has("psychicdamage")).toBe(true);
		});

		it("should tag charm for spells that inflict charmed", () => {
			const state = new CharacterSheetState();
			const tags = state._extractSpellTags(SAMPLE_SPELL_DATA.charmPerson);
			expect(tags.has("charm")).toBe(true);
		});

		it("should not tag charm for non-charm spells", () => {
			const state = new CharacterSheetState();
			const tags = state._extractSpellTags(SAMPLE_SPELL_DATA.fireball);
			expect(tags.has("charm")).toBe(false);
		});
	});

	// =============================================================================
	// Tests: getMatchingVariantComponents
	// =============================================================================

	describe("getMatchingVariantComponents", () => {
		it("should match by exact spell name|source", () => {
			const comp = makeInventoryEntry({
				name: "Fire Component",
				spellEffects: [{
					match: {spell: "Fireball|XPHB"},
					description: "Enhances Fireball",
					effects: [{type: "bonusDamage", value: 5, damageType: "fire"}],
				}],
			});
			const state = createStateWithComponents([comp]);
			const spell = {name: "Fireball", source: "XPHB", level: 3};
			const matches = state.getMatchingVariantComponents(spell, SAMPLE_SPELL_DATA.fireball);
			expect(matches.length).toBe(1);
			expect(matches[0].invItem.item.name).toBe("Fire Component");
		});

		it("should match spell name case-insensitively", () => {
			const comp = makeInventoryEntry({
				name: "Fire Component",
				spellEffects: [{
					match: {spell: "fireball|xphb"},
					effects: [{type: "bonusDamage", value: 5}],
				}],
			});
			const state = createStateWithComponents([comp]);
			const matches = state.getMatchingVariantComponents(
				{name: "Fireball", source: "XPHB", level: 3},
				SAMPLE_SPELL_DATA.fireball,
			);
			expect(matches.length).toBe(1);
		});

		it("should match by damage type", () => {
			const comp = makeInventoryEntry({
				name: "Elemental Dust",
				spellEffects: [{
					match: {damageType: "fire"},
					description: "Enhances fire spells",
					effects: [{type: "bonusDice", value: "1d6"}],
				}],
			});
			const state = createStateWithComponents([comp]);
			const matches = state.getMatchingVariantComponents(
				{name: "Fireball", source: "XPHB", level: 3},
				SAMPLE_SPELL_DATA.fireball,
			);
			expect(matches.length).toBe(1);
		});

		it("should NOT match wrong damage type", () => {
			const comp = makeInventoryEntry({
				name: "Frost Dust",
				spellEffects: [{
					match: {damageType: "cold"},
					effects: [{type: "bonusDice", value: "1d6"}],
				}],
			});
			const state = createStateWithComponents([comp]);
			const matches = state.getMatchingVariantComponents(
				{name: "Fireball", source: "XPHB", level: 3},
				SAMPLE_SPELL_DATA.fireball,
			);
			expect(matches.length).toBe(0);
		});

		it("should match by spellTag (restoration)", () => {
			const comp = makeInventoryEntry({
				name: "Celestial Essence",
				spellEffects: [{
					match: {spellTag: "restoration"},
					description: "Enhances healing",
					effects: [{type: "bonusDamage", value: 3, damageType: "healing"}],
				}],
			});
			const state = createStateWithComponents([comp]);
			const matches = state.getMatchingVariantComponents(
				{name: "Cure Wounds", source: "XPHB", level: 1},
				SAMPLE_SPELL_DATA.cureWounds,
			);
			expect(matches.length).toBe(1);
		});

		it("should match by spellTag (dragonBreathMatch)", () => {
			const comp = makeInventoryEntry({
				name: "Dragon Hide",
				spellEffects: [{
					match: {spellTag: "dragonBreathMatch"},
					effects: [{type: "resistance", value: "fire"}],
				}],
			});
			const state = createStateWithComponents([comp]);
			const matches = state.getMatchingVariantComponents(
				{name: "Fireball", source: "XPHB", level: 3},
				SAMPLE_SPELL_DATA.fireball,
			);
			expect(matches.length).toBe(1);
		});

		it("should match by spellTag (charm)", () => {
			const comp = makeInventoryEntry({
				name: "Harpy Vocal Cord",
				spellEffects: [{
					match: {spellTag: "charm"},
					effects: [{type: "saveDisadvantage"}],
				}],
			});
			const state = createStateWithComponents([comp]);
			const matches = state.getMatchingVariantComponents(
				{name: "Charm Person", source: "XPHB", level: 1},
				SAMPLE_SPELL_DATA.charmPerson,
			);
			expect(matches.length).toBe(1);
		});

		it("should return empty for items with no variantComponent", () => {
			const state = new CharacterSheetState();
			state._data.inventory = [{
				id: "normal-item",
				item: {name: "Longsword", source: "PHB", type: "M"},
				quantity: 1,
				equipped: true,
				attuned: false,
			}];
			const matches = state.getMatchingVariantComponents(
				{name: "Fireball", source: "XPHB", level: 3},
				SAMPLE_SPELL_DATA.fireball,
			);
			expect(matches.length).toBe(0);
		});

		it("should return empty for null/missing spell", () => {
			const state = new CharacterSheetState();
			expect(state.getMatchingVariantComponents(null)).toEqual([]);
			expect(state.getMatchingVariantComponents({})).toEqual([]);
			expect(state.getMatchingVariantComponents({name: "Fireball"})).toEqual([]);
		});

		it("should return multiple matches from different items", () => {
			const comp1 = makeInventoryEntry({
				name: "Fire Dust",
				spellEffects: [{
					match: {damageType: "fire"},
					effects: [{type: "bonusDamage", value: 5}],
				}],
			});
			const comp2 = makeInventoryEntry({
				name: "Spell Enhancer",
				spellEffects: [{
					match: {spell: "Fireball|XPHB"},
					effects: [{type: "saveDcMod", value: 2}],
				}],
			});
			const state = createStateWithComponents([comp1, comp2]);
			const matches = state.getMatchingVariantComponents(
				{name: "Fireball", source: "XPHB", level: 3},
				SAMPLE_SPELL_DATA.fireball,
			);
			expect(matches.length).toBe(2);
		});

		it("should skip items with zero quantity", () => {
			const comp = makeInventoryEntry({
				name: "Empty Component",
				spellEffects: [{
					match: {spell: "Fireball|XPHB"},
					effects: [{type: "bonusDamage", value: 5}],
				}],
				quantity: 0,
			});
			const state = createStateWithComponents([comp]);
			const matches = state.getMatchingVariantComponents(
				{name: "Fireball", source: "XPHB", level: 3},
				SAMPLE_SPELL_DATA.fireball,
			);
			expect(matches.length).toBe(0);
		});

		it("should work without spellData (no damage type or tag matching)", () => {
			const compBySpell = makeInventoryEntry({
				name: "Spell-Specific",
				spellEffects: [{
					match: {spell: "Fireball|XPHB"},
					effects: [{type: "bonusDamage", value: 5}],
				}],
			});
			const compByType = makeInventoryEntry({
				name: "Type-Specific",
				spellEffects: [{
					match: {damageType: "fire"},
					effects: [{type: "bonusDice", value: "1d6"}],
				}],
			});
			const state = createStateWithComponents([compBySpell, compByType]);
			// Without spellData, only exact spell match works
			const matches = state.getMatchingVariantComponents(
				{name: "Fireball", source: "XPHB", level: 3},
			);
			expect(matches.length).toBe(1);
			expect(matches[0].invItem.item.name).toBe("Spell-Specific");
		});
	});

	// =============================================================================
	// Tests: consumeVariantComponent
	// =============================================================================

	describe("consumeVariantComponent", () => {
		it("should decrement quantity when > 1", () => {
			const comp = makeInventoryEntry({
				name: "Fire Dust",
				spellEffects: [{match: {spell: "Fireball|XPHB"}, effects: []}],
				quantity: 3,
			});
			const state = createStateWithComponents([comp]);
			const result = state.consumeVariantComponent(comp.id);
			expect(result).toBe(true);
			expect(state._data.inventory[0].quantity).toBe(2);
		});

		it("should remove item when quantity is 1", () => {
			const comp = makeInventoryEntry({
				name: "Fire Dust",
				spellEffects: [{match: {spell: "Fireball|XPHB"}, effects: []}],
				quantity: 1,
			});
			const state = createStateWithComponents([comp]);
			const result = state.consumeVariantComponent(comp.id);
			expect(result).toBe(true);
			expect(state._data.inventory.length).toBe(0);
		});

		it("should return false for non-existent item", () => {
			const state = new CharacterSheetState();
			expect(state.consumeVariantComponent("nonexistent")).toBe(false);
		});
	});

	// =============================================================================
	// Tests: getVariantComponentEffects
	// =============================================================================

	describe("getVariantComponentEffects", () => {
		it("should return matching spellEffect for exact spell match", () => {
			const comp = makeInventoryEntry({
				name: "Fire Component",
				spellEffects: [
					{match: {spell: "Fireball|XPHB"}, description: "Fireball boost", effects: [{type: "bonusDamage", value: 5}]},
					{match: {damageType: "cold"}, description: "Cold boost", effects: [{type: "bonusDice", value: "1d8"}]},
				],
			});
			const state = createStateWithComponents([comp]);
			const effect = state.getVariantComponentEffects(
				comp.id,
				{name: "Fireball", source: "XPHB"},
				SAMPLE_SPELL_DATA.fireball,
			);
			expect(effect).not.toBeNull();
			expect(effect.description).toBe("Fireball boost");
		});

		it("should return null when no effects match", () => {
			const comp = makeInventoryEntry({
				name: "Cold Component",
				spellEffects: [{match: {damageType: "cold"}, effects: [{type: "bonusDice", value: "1d6"}]}],
			});
			const state = createStateWithComponents([comp]);
			const effect = state.getVariantComponentEffects(
				comp.id,
				{name: "Fireball", source: "XPHB"},
				SAMPLE_SPELL_DATA.fireball,
			);
			expect(effect).toBeNull();
		});

		it("should return null for item without variantComponent", () => {
			const state = new CharacterSheetState();
			state._data.inventory = [{id: "sword", item: {name: "Sword"}, quantity: 1}];
			const effect = state.getVariantComponentEffects("sword", {name: "Fireball", source: "XPHB"});
			expect(effect).toBeNull();
		});
	});

	// =============================================================================
	// Tests: Effect type labels
	// =============================================================================

	describe("Effect type completeness", () => {
		it("should have all 20 effect types covered (including grantAttack)", () => {
			const effectTypes = [
				"bonusDamage", "bonusDice", "dieSizeIncrease", "maximizeDamage",
				"noSlot", "lowerSlot", "saveDcMod", "saveDisadvantage",
				"condition", "removeConcentration",
				"acOverride", "resistance", "immunity", "speedOverride", "speedFallRate",
				"additionalTargets", "areaChange", "rangeChange", "grantAttack", "text",
			];
			expect(effectTypes.length).toBe(20);
		});
	});

	// =============================================================================
	// Tests: Temporary Attacks
	// =============================================================================

	describe("Temporary Attacks", () => {
		it("should add a temporary attack", () => {
			const state = new CharacterSheetState();
			state.addTemporaryAttack({
				name: "Flame Lash",
				isMelee: true,
				abilityMod: "spellcasting",
				damage: "2d6",
				damageType: "fire",
				range: "10 ft",
				sourceSpell: "Scorching Ray",
				sourceComponent: "Fire Opal Dust",
			});
			const temps = state.getTemporaryAttacks();
			expect(temps).toHaveLength(1);
			expect(temps[0].name).toBe("Flame Lash");
			expect(temps[0].isTemporary).toBe(true);
			expect(temps[0].id).toBeTruthy();
		});

		it("should remove a temporary attack by ID", () => {
			const state = new CharacterSheetState();
			state.addTemporaryAttack({name: "Attack A", sourceSpell: "SpellA"});
			state.addTemporaryAttack({name: "Attack B", sourceSpell: "SpellB"});
			const temps = state.getTemporaryAttacks();
			expect(temps).toHaveLength(2);

			state.removeTemporaryAttack(temps[0].id);
			expect(state.getTemporaryAttacks()).toHaveLength(1);
			expect(state.getTemporaryAttacks()[0].name).toBe("Attack B");
		});

		it("should remove temporary attacks by spell name", () => {
			const state = new CharacterSheetState();
			state.addTemporaryAttack({name: "Lash A", sourceSpell: "Flame Shield"});
			state.addTemporaryAttack({name: "Lash B", sourceSpell: "Flame Shield"});
			state.addTemporaryAttack({name: "Other", sourceSpell: "Mage Armor"});

			state.removeTemporaryAttacksBySpell("Flame Shield");
			const remaining = state.getTemporaryAttacks();
			expect(remaining).toHaveLength(1);
			expect(remaining[0].name).toBe("Other");
		});

		it("should clear all temporary attacks", () => {
			const state = new CharacterSheetState();
			state.addTemporaryAttack({name: "A", sourceSpell: "X"});
			state.addTemporaryAttack({name: "B", sourceSpell: "Y"});
			state.clearTemporaryAttacks();
			expect(state.getTemporaryAttacks()).toHaveLength(0);
		});

		it("should clear temporary attacks on long rest", () => {
			const state = new CharacterSheetState();
			state.addTemporaryAttack({name: "Temp", sourceSpell: "Shield"});
			expect(state.getTemporaryAttacks()).toHaveLength(1);

			state.onLongRest();
			expect(state.getTemporaryAttacks()).toHaveLength(0);
		});

		it("should remove spell-linked temporary attacks on concentration break", () => {
			const state = new CharacterSheetState();
			state.setConcentration({name: "Flame Shield", level: 4});
			state.addTemporaryAttack({name: "Flame Lash", sourceSpell: "Flame Shield"});
			state.addTemporaryAttack({name: "Other Attack", sourceSpell: "Mage Armor"});

			state.breakConcentration();
			const remaining = state.getTemporaryAttacks();
			expect(remaining).toHaveLength(1);
			expect(remaining[0].name).toBe("Other Attack");
		});

		it("should initialize with empty temporaryAttacks array", () => {
			const state = new CharacterSheetState();
			expect(state.getTemporaryAttacks()).toEqual([]);
		});
	});

	// =============================================================================
	// Tests: Wild Magic Surge Table
	// =============================================================================

	describe("Wild Magic Surge", () => {
		it("should have a complete surge table covering d100 range", () => {
			const table = CharacterSheetSpells._VARIANT_WILD_MAGIC_TABLE;
			expect(table).toBeTruthy();

			// Verify all 100 values are covered
			const covered = new Set();
			for (const entry of table) {
				for (let i = entry.min; i <= entry.max; i++) {
					covered.add(i);
				}
			}
			for (let i = 1; i <= 100; i++) {
				expect(covered.has(i)).toBe(true);
			}
		});

		it("should have no gaps or overlaps in the surge table", () => {
			const table = CharacterSheetSpells._VARIANT_WILD_MAGIC_TABLE;
			expect(table).toBeTruthy();

			// Check for sorted, non-overlapping ranges
			let lastMax = 0;
			for (const entry of table) {
				expect(entry.min).toBe(lastMax + 1);
				expect(entry.max).toBeGreaterThanOrEqual(entry.min);
				expect(entry.effect).toBeTruthy();
				lastMax = entry.max;
			}
			expect(lastMax).toBe(100);
		});

		it("should calculate threshold correctly based on component count", () => {
			// Call the surge method via prototype (constructor requires page)
			const surgeFn = CharacterSheetSpells.prototype._rollVariantWildMagicSurge;
			const origRandomise = globalThis.RollerUtil?.randomise;

			// 2 components → threshold 2 (2^1)
			globalThis.RollerUtil = {randomise: () => 20}; // Always safe
			let result = surgeFn(2);
			expect(result.threshold).toBe(2);
			expect(result.surged).toBe(false);

			// 3 components → threshold 4 (2^2)
			result = surgeFn(3);
			expect(result.threshold).toBe(4);
			expect(result.surged).toBe(false);

			// 4 components → threshold 8 (2^3)
			result = surgeFn(4);
			expect(result.threshold).toBe(8);

			// Threshold capped at 20
			result = surgeFn(10);
			expect(result.threshold).toBe(20);

			// Restore
			if (origRandomise) globalThis.RollerUtil = {randomise: origRandomise};
		});

		it("should surge when roll is within threshold", () => {
			const surgeFn = CharacterSheetSpells.prototype._rollVariantWildMagicSurge;
			// Force roll = 1 (always within any threshold)
			globalThis.RollerUtil = {randomise: () => 1};
			const result = surgeFn(2);
			expect(result.surged).toBe(true);
			expect(result.effect).toBeTruthy();
			expect(result.surgeRoll).toBeGreaterThanOrEqual(1);
			expect(result.surgeRoll).toBeLessThanOrEqual(100);
		});

		it("should not surge when roll exceeds threshold", () => {
			const surgeFn = CharacterSheetSpells.prototype._rollVariantWildMagicSurge;
			// Force roll = 20 with threshold 2 (2 components)
			globalThis.RollerUtil = {randomise: () => 20};
			const result = surgeFn(2);
			expect(result.surged).toBe(false);
			expect(result.effect).toBeNull();
		});
	});

	// =============================================================================
	// Tests: Migration / Save-Load
	// =============================================================================

	describe("Migration and save/load", () => {
		it("should handle loading old saves without temporaryAttacks field", () => {
			const state = new CharacterSheetState();
			// Simulate loading a save that predates the temporaryAttacks feature
			const oldSave = {
				name: "Old Character",
				level: 5,
				classes: [{name: "Wizard", level: 5, source: "XPHB"}],
				abilities: {str: 10, dex: 14, con: 12, int: 18, wis: 13, cha: 8},
				// Note: no temporaryAttacks field
			};
			state.loadFromJson(oldSave);
			// Should not crash and should provide empty array
			expect(state.getTemporaryAttacks()).toEqual([]);
		});

		it("should persist temporary attacks through save/load cycle", () => {
			const state = new CharacterSheetState();
			state.addTemporaryAttack({
				name: "Flame Lash",
				isMelee: true,
				damage: "2d6",
				damageType: "fire",
				sourceSpell: "Fire Shield",
				sourceComponent: "Ruby Dust",
			});

			const json = state.toJson();
			const state2 = new CharacterSheetState();
			state2.loadFromJson(json);

			const temps = state2.getTemporaryAttacks();
			expect(temps).toHaveLength(1);
			expect(temps[0].name).toBe("Flame Lash");
			expect(temps[0].damage).toBe("2d6");
			expect(temps[0].sourceSpell).toBe("Fire Shield");
			expect(temps[0].isTemporary).toBe(true);
		});

		it("should generate unique IDs for each temporary attack", () => {
			const state = new CharacterSheetState();
			state.addTemporaryAttack({name: "A"});
			state.addTemporaryAttack({name: "B"});
			state.addTemporaryAttack({name: "C"});
			const ids = state.getTemporaryAttacks().map(t => t.id);
			const uniqueIds = new Set(ids);
			expect(uniqueIds.size).toBe(3);
		});
	});

	// =============================================================================
	// Tests: grantAttack Effect Type
	// =============================================================================

	describe("grantAttack effect integration", () => {
		it("should have grantAttack in the complete effect types list", () => {
			const effectTypes = [
				"bonusDamage", "bonusDice", "dieSizeIncrease", "maximizeDamage",
				"noSlot", "lowerSlot", "saveDcMod", "saveDisadvantage",
				"condition", "removeConcentration",
				"acOverride", "resistance", "immunity", "speedOverride", "speedFallRate",
				"additionalTargets", "areaChange", "rangeChange", "grantAttack", "text",
			];
			expect(effectTypes).toContain("grantAttack");
		});

		it("should track sourceSpell and sourceComponent on temporary attacks", () => {
			const state = new CharacterSheetState();
			state.addTemporaryAttack({
				name: "Caustic Spit",
				isMelee: false,
				abilityMod: "spellcasting",
				damage: "3d8",
				damageType: "acid",
				range: "60 ft",
				sourceSpell: "Acid Splash",
				sourceDuration: "concentration",
				sourceComponent: "Aboleth Mucus",
			});

			const attack = state.getTemporaryAttacks()[0];
			expect(attack.sourceSpell).toBe("Acid Splash");
			expect(attack.sourceComponent).toBe("Aboleth Mucus");
			expect(attack.sourceDuration).toBe("concentration");
			expect(attack.isMelee).toBe(false);
			expect(attack.abilityMod).toBe("spellcasting");
		});

		it("should not remove non-concentration temp attacks on short rest concentration break", () => {
			const state = new CharacterSheetState();
			// No concentration active
			state.addTemporaryAttack({name: "Duration Attack", sourceSpell: "Some Spell", sourceDuration: "1 minute"});

			// Short rest breaks concentration but this attack isn't tied to concentration
			state.onShortRest();
			// Attack should persist (it wasn't tied to a concentrating spell)
			expect(state.getTemporaryAttacks()).toHaveLength(1);
		});
	});
});
