/**
 * Tests for Character Sheet Remove Level functionality
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/**
 * Helper: build a character with Fighter at the given level, with full level history.
 */
function buildFighter (state, level, source = "PHB") {
	state.addClass({name: "Fighter", source, level});
	for (let i = 1; i <= level; i++) {
		state.recordLevelChoice({
			level: i,
			class: {name: "Fighter", source},
			choices: {},
		});
	}
}

/**
 * Helper: add a feature at a specific level.
 */
function addFeatureAtLevel (state, name, level, opts = {}) {
	state.addFeature({
		name,
		source: opts.source || "PHB",
		level,
		className: opts.className || "Fighter",
		description: opts.description || "",
		...opts,
	});
}

describe("CharacterSheetRemoveLevel", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// region Guards

	describe("Guards", () => {
		it("should refuse to remove below level 1", () => {
			buildFighter(state, 1);
			const result = state.removeLastLevel();
			expect(result.success).toBe(false);
			expect(result.reason).toContain("Cannot remove level 1");
			expect(state.getTotalLevel()).toBe(1);
		});

		it("should refuse for legacy characters", () => {
			// Add class directly without history — makes it legacy
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			expect(state.isLegacyCharacter()).toBe(true);

			const result = state.removeLastLevel();
			expect(result.success).toBe(false);
			expect(result.reason).toContain("legacy");
			expect(state.getTotalLevel()).toBe(3);
		});

		it("should refuse when no history entry found for last level", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			// Only record levels 1 and 2, but class is level 3
			state.recordLevelChoice({level: 1, class: {name: "Fighter", source: "PHB"}, choices: {}});
			state.recordLevelChoice({level: 2, class: {name: "Fighter", source: "PHB"}, choices: {}});

			// This is a legacy character (missing level 3 history)
			const result = state.removeLastLevel();
			expect(result.success).toBe(false);
		});
	});

	// endregion

	// region Basic Removal

	describe("Basic Removal", () => {
		it("should remove last level from single-class character", () => {
			buildFighter(state, 3);
			expect(state.getTotalLevel()).toBe(3);

			const result = state.removeLastLevel();
			expect(result.success).toBe(true);
			expect(result.removed.level).toBe(3);
			expect(result.removed.className).toBe("Fighter");
			expect(state.getTotalLevel()).toBe(2);

			const classes = state.getClasses();
			expect(classes.length).toBe(1);
			expect(classes[0].level).toBe(2);
		});

		it("should remove level history entry for removed level", () => {
			buildFighter(state, 3);
			state.removeLastLevel();

			expect(state.getLevelHistoryEntry(3)).toBeNull();
			expect(state.getLevelHistoryEntry(2)).not.toBeNull();
			expect(state.getLevelHistoryEntry(1)).not.toBeNull();
			expect(state.getLevelHistory().length).toBe(2);
		});

		it("should return removed level info", () => {
			buildFighter(state, 5);
			const result = state.removeLastLevel();

			expect(result.success).toBe(true);
			expect(result.removed.level).toBe(5);
			expect(result.removed.className).toBe("Fighter");
			expect(result.removed.classLevel).toBe(5);
		});
	});

	// endregion

	// region Feature Cleanup

	describe("Feature Cleanup", () => {
		it("should remove features gained at the removed level", () => {
			buildFighter(state, 3);
			addFeatureAtLevel(state, "Improved Critical", 3);
			addFeatureAtLevel(state, "Second Wind", 1);

			state.removeLastLevel();

			const features = state.getFeatures();
			expect(features.some(f => f.name === "Improved Critical")).toBe(false);
			expect(features.some(f => f.name === "Second Wind")).toBe(true);
		});

		it("should include removed features in result", () => {
			buildFighter(state, 3);
			addFeatureAtLevel(state, "Feature A", 3);
			addFeatureAtLevel(state, "Feature B", 3);

			const result = state.removeLastLevel();
			expect(result.removed.features).toHaveLength(2);
			expect(result.removed.features.map(f => f.name)).toContain("Feature A");
			expect(result.removed.features.map(f => f.name)).toContain("Feature B");
		});
	});

	// endregion

	// region Feat Reversal

	describe("Feat Reversal", () => {
		it("should remove feat chosen at the removed level", () => {
			buildFighter(state, 4);
			state.addFeat({name: "Alert", source: "PHB"});
			state.updateLevelChoice(4, {feat: {name: "Alert", source: "PHB"}});

			state.removeLastLevel();

			const feats = state.getFeats();
			expect(feats.some(f => f.name === "Alert")).toBe(false);
		});

		it("should include removed feat in result", () => {
			buildFighter(state, 4);
			state.addFeat({name: "Alert", source: "PHB"});
			state.updateLevelChoice(4, {feat: {name: "Alert", source: "PHB"}});

			const result = state.removeLastLevel();
			expect(result.removed.feat).toEqual({name: "Alert", source: "PHB"});
		});
	});

	// endregion

	// region ASI Reversal

	describe("ASI Reversal", () => {
		it("should reverse ASI applied at the removed level", () => {
			buildFighter(state, 4);
			state.addAbilityBonus("str", 2);
			state.updateLevelChoice(4, {asi: {str: 2}});

			const bonusBefore = state.getAbilityBonus("str");
			state.removeLastLevel();
			const bonusAfter = state.getAbilityBonus("str");

			expect(bonusAfter).toBe(bonusBefore - 2);
		});

		it("should handle multi-ability ASI reversal", () => {
			buildFighter(state, 4);
			state.addAbilityBonus("str", 1);
			state.addAbilityBonus("con", 1);
			state.updateLevelChoice(4, {asi: {str: 1, con: 1}});

			state.removeLastLevel();

			expect(state.getAbilityBonus("str")).toBe(0);
			expect(state.getAbilityBonus("con")).toBe(0);
		});

		it("should clamp ability bonus at 0", () => {
			buildFighter(state, 4);
			// Don't add the bonus, just record the choice (simulating a data inconsistency)
			state.updateLevelChoice(4, {asi: {str: 2}});

			state.removeLastLevel();
			expect(state.getAbilityBonus("str")).toBe(0);
		});
	});

	// endregion

	// region Subclass Removal

	describe("Subclass Removal", () => {
		it("should remove subclass when class level drops below subclass level", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			state.setSubclass("Fighter", {name: "Battle Master", source: "PHB"});
			for (let i = 1; i <= 3; i++) {
				state.recordLevelChoice({
					level: i,
					class: {name: "Fighter", source: "PHB"},
					choices: i === 3 ? {subclass: {name: "Battle Master", source: "PHB"}} : {},
				});
			}

			state.removeLastLevel();

			const classes = state.getClasses();
			expect(classes[0].subclass).toBeNull();
		});

		it("should not remove subclass when class level stays at or above subclass level", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 5});
			state.setSubclass("Fighter", {name: "Battle Master", source: "PHB"});
			for (let i = 1; i <= 5; i++) {
				state.recordLevelChoice({
					level: i,
					class: {name: "Fighter", source: "PHB"},
					choices: i === 3 ? {subclass: {name: "Battle Master", source: "PHB"}} : {},
				});
			}

			state.removeLastLevel(); // level 5 → 4, subclass should stay

			const classes = state.getClasses();
			expect(classes[0].subclass).not.toBeNull();
			expect(classes[0].subclass.name).toBe("Battle Master");
		});
	});

	// endregion

	// region Multiclass

	describe("Multiclass", () => {
		it("should remove level from the correct class in multiclass", () => {
			// Fighter 3 / Wizard 2, total level 5
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			state.addClass({name: "Wizard", source: "PHB", level: 2});
			for (let i = 1; i <= 3; i++) {
				state.recordLevelChoice({level: i, class: {name: "Fighter", source: "PHB"}, choices: {}});
			}
			state.recordLevelChoice({level: 4, class: {name: "Wizard", source: "PHB"}, choices: {}});
			state.recordLevelChoice({level: 5, class: {name: "Wizard", source: "PHB"}, choices: {}});

			const result = state.removeLastLevel();
			expect(result.success).toBe(true);
			expect(result.removed.className).toBe("Wizard");

			expect(state.getTotalLevel()).toBe(4);
			const classes = state.getClasses();
			const fighter = classes.find(c => c.name === "Fighter");
			const wizard = classes.find(c => c.name === "Wizard");
			expect(fighter.level).toBe(3);
			expect(wizard.level).toBe(1);
		});

		it("should remove entire class when its level drops to 0", () => {
			// Fighter 3 / Wizard 1, total level 4
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			for (let i = 1; i <= 3; i++) {
				state.recordLevelChoice({level: i, class: {name: "Fighter", source: "PHB"}, choices: {}});
			}
			state.recordLevelChoice({level: 4, class: {name: "Wizard", source: "PHB"}, choices: {}});

			const result = state.removeLastLevel();
			expect(result.success).toBe(true);
			expect(result.removed.className).toBe("Wizard");

			expect(state.getTotalLevel()).toBe(3);
			const classes = state.getClasses();
			expect(classes.length).toBe(1);
			expect(classes[0].name).toBe("Fighter");
		});
	});

	// endregion

	// region HP and Hit Dice Recalculation

	describe("HP and Hit Dice Recalculation", () => {
		it("should recalculate max HP after removal", () => {
			buildFighter(state, 3);
			const hpBefore = state.getMaxHp();
			state.removeLastLevel();
			const hpAfter = state.getMaxHp();

			// HP should decrease (or at least not increase) after removing a level
			expect(hpAfter).toBeLessThanOrEqual(hpBefore);
		});

		it("should cap current HP if it exceeds new max", () => {
			buildFighter(state, 5);
			// Set current HP to max
			const maxBefore = state.getMaxHp();
			state.setCurrentHp(maxBefore);

			state.removeLastLevel();

			expect(state.getCurrentHp()).toBeLessThanOrEqual(state.getMaxHp());
		});

		it("should recalculate hit dice after removal", () => {
			buildFighter(state, 3);
			state.removeLastLevel();

			const hitDice = state.getHitDice();
			const totalMax = Object.values(hitDice).reduce((sum, hd) => sum + hd.max, 0);
			expect(totalMax).toBe(2);
		});
	});

	// endregion

	// region Spell Slot Recalculation

	describe("Spell Slot Recalculation", () => {
		it("should recalculate spell slots for caster classes", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 3});
			for (let i = 1; i <= 3; i++) {
				state.recordLevelChoice({level: i, class: {name: "Wizard", source: "PHB"}, choices: {}});
			}

			// At level 3 wizard, should have 2nd level slots
			const slotsBefore = state.getSpellSlots();

			state.removeLastLevel();

			// At level 2 wizard, should have fewer or no 2nd level slots
			const slotsAfter = state.getSpellSlots();
			const totalBefore = Object.values(slotsBefore || {}).reduce((s, slot) => s + (slot?.max || 0), 0);
			const totalAfter = Object.values(slotsAfter || {}).reduce((s, slot) => s + (slot?.max || 0), 0);
			expect(totalAfter).toBeLessThanOrEqual(totalBefore);
		});
	});

	// endregion

	// region Spell Removal

	describe("Spell Removal", () => {
		it("should remove spellbook spells recorded at the removed level", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 2});
			state.recordLevelChoice({level: 1, class: {name: "Wizard", source: "PHB"}, choices: {}});
			state.recordLevelChoice({level: 2, class: {name: "Wizard", source: "PHB"}, choices: {
				spellbookSpells: [
					{name: "Scorching Ray", source: "PHB"},
					{name: "Misty Step", source: "PHB"},
				],
			}});

			// Add the spells to known
			state.addSpell({name: "Scorching Ray", source: "PHB", level: 2, className: "Wizard"});
			state.addSpell({name: "Misty Step", source: "PHB", level: 2, className: "Wizard"});

			state.removeLastLevel();

			const known = state.getSpellsKnown();
			expect(known.some(s => s.name === "Scorching Ray")).toBe(false);
			expect(known.some(s => s.name === "Misty Step")).toBe(false);
		});
	});

	// endregion

	// region Optional Features

	describe("Optional Features", () => {
		it("should remove optional features from the removed level", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 3});
			for (let i = 1; i <= 3; i++) {
				state.recordLevelChoice({
					level: i,
					class: {name: "Warlock", source: "PHB"},
					choices: i === 2 ? {optionalFeatures: [{name: "Agonizing Blast", source: "PHB", type: "EI"}]} : {},
				});
			}
			state.addFeature({name: "Agonizing Blast", source: "PHB", level: 2, className: "Warlock"});

			// Remove level 3, should NOT remove level 2 features
			state.removeLastLevel();
			const features = state.getFeatures();
			expect(features.some(f => f.name === "Agonizing Blast")).toBe(true);
		});

		it("should remove optional features chosen at the last level", () => {
			state.addClass({name: "Warlock", source: "PHB", level: 2});
			state.recordLevelChoice({level: 1, class: {name: "Warlock", source: "PHB"}, choices: {}});
			state.recordLevelChoice({level: 2, class: {name: "Warlock", source: "PHB"}, choices: {
				optionalFeatures: [{name: "Agonizing Blast", source: "PHB", type: "EI"}],
			}});
			state.addFeature({name: "Agonizing Blast", source: "PHB", level: 2, className: "Warlock"});

			state.removeLastLevel();
			const features = state.getFeatures();
			expect(features.some(f => f.name === "Agonizing Blast")).toBe(false);
		});
	});

	// endregion

	// region Combat Traditions

	describe("Combat Traditions", () => {
		it("should remove combat traditions from the removed level", () => {
			state.addClass({name: "Fighter", source: "TGTT", level: 2});
			state.recordLevelChoice({level: 1, class: {name: "Fighter", source: "TGTT"}, choices: {}});
			state.recordLevelChoice({level: 2, class: {name: "Fighter", source: "TGTT"}, choices: {
				combatTraditions: ["AM", "RC"],
			}});
			state.addCombatTradition("AM");
			state.addCombatTradition("RC");

			state.removeLastLevel();

			expect(state.hasCombatTradition("AM")).toBe(false);
			expect(state.hasCombatTradition("RC")).toBe(false);
		});
	});

	// endregion

	// region Weapon Masteries

	describe("Weapon Masteries", () => {
		it("should remove weapon masteries from the removed level", () => {
			state.addClass({name: "Fighter", source: "XPHB", level: 2});
			state.recordLevelChoice({level: 1, class: {name: "Fighter", source: "XPHB"}, choices: {}});
			state.recordLevelChoice({level: 2, class: {name: "Fighter", source: "XPHB"}, choices: {
				weaponMasteries: ["Longsword|XPHB"],
			}});
			state.addWeaponMastery("Longsword|XPHB");

			state.removeLastLevel();

			const masteries = state.getWeaponMasteries();
			expect(masteries).not.toContain("Longsword|XPHB");
		});
	});

	// endregion

	// region Expertise

	describe("Expertise", () => {
		it("should downgrade expertise to proficiency on removed level", () => {
			buildFighter(state, 2);
			state.setSkillProficiency("athletics", 2); // 2 = expertise
			state.updateLevelChoice(2, {expertise: ["athletics"]});

			state.removeLastLevel();

			expect(state.getSkillProficiency("athletics")).toBe(1); // downgraded to proficiency
		});
	});

	// endregion

	// region Languages

	describe("Languages", () => {
		it("should remove languages learned at the removed level", () => {
			buildFighter(state, 2);
			state.addLanguage("Elvish");
			state.updateLevelChoice(2, {languages: [{language: "Elvish"}]});

			state.removeLastLevel();

			const languages = state.getLanguages();
			expect(languages.map(l => l.toLowerCase())).not.toContain("elvish");
		});

		it("should handle string-format language choices", () => {
			buildFighter(state, 2);
			state.addLanguage("Dwarvish");
			state.updateLevelChoice(2, {languages: ["Dwarvish"]});

			state.removeLastLevel();

			const languages = state.getLanguages();
			expect(languages.map(l => l.toLowerCase())).not.toContain("dwarvish");
		});
	});

	// endregion

	// region Preview

	describe("Preview", () => {
		it("should return null when removal is not possible (level 1)", () => {
			buildFighter(state, 1);
			expect(state.getRemoveLastLevelPreview()).toBeNull();
		});

		it("should return null for legacy characters", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			expect(state.getRemoveLastLevelPreview()).toBeNull();
		});

		it("should return accurate preview of what will be removed", () => {
			buildFighter(state, 4);
			addFeatureAtLevel(state, "Extra Attack", 4);
			state.addAbilityBonus("str", 2);
			state.addFeat({name: "Alert", source: "PHB"});
			state.updateLevelChoice(4, {
				asi: {str: 2},
				feat: {name: "Alert", source: "PHB"},
			});

			const preview = state.getRemoveLastLevelPreview();
			expect(preview).not.toBeNull();
			expect(preview.level).toBe(4);
			expect(preview.className).toBe("Fighter");
			expect(preview.classLevel).toBe(4);
			expect(preview.willRemoveClass).toBe(false);
			expect(preview.features).toHaveLength(1);
			expect(preview.features[0].name).toBe("Extra Attack");
			expect(preview.feat.name).toBe("Alert");
			expect(preview.asi.str).toBe(2);
		});

		it("should predict class removal correctly", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			for (let i = 1; i <= 3; i++) {
				state.recordLevelChoice({level: i, class: {name: "Fighter", source: "PHB"}, choices: {}});
			}
			state.recordLevelChoice({level: 4, class: {name: "Wizard", source: "PHB"}, choices: {}});

			const preview = state.getRemoveLastLevelPreview();
			expect(preview.willRemoveClass).toBe(true);
			expect(preview.className).toBe("Wizard");
		});

		it("should predict subclass removal correctly", () => {
			state.addClass({name: "Fighter", source: "PHB", level: 3});
			state.setSubclass("Fighter", {name: "Battle Master", source: "PHB"});
			for (let i = 1; i <= 3; i++) {
				state.recordLevelChoice({
					level: i,
					class: {name: "Fighter", source: "PHB"},
					choices: i === 3 ? {subclass: {name: "Battle Master", source: "PHB"}} : {},
				});
			}

			const preview = state.getRemoveLastLevelPreview();
			expect(preview.willRemoveSubclass).toBe(true);
			expect(preview.subclassName).toBe("Battle Master");
		});
	});

	// endregion

	// region Sequential Removal

	describe("Sequential Removal", () => {
		it("should support removing multiple levels in sequence", () => {
			buildFighter(state, 5);
			addFeatureAtLevel(state, "F5", 5);
			addFeatureAtLevel(state, "F4", 4);
			addFeatureAtLevel(state, "F3", 3);

			const r1 = state.removeLastLevel();
			expect(r1.success).toBe(true);
			expect(state.getTotalLevel()).toBe(4);

			const r2 = state.removeLastLevel();
			expect(r2.success).toBe(true);
			expect(state.getTotalLevel()).toBe(3);

			const r3 = state.removeLastLevel();
			expect(r3.success).toBe(true);
			expect(state.getTotalLevel()).toBe(2);

			// All removed features should be gone
			const features = state.getFeatures();
			expect(features.some(f => f.name === "F5")).toBe(false);
			expect(features.some(f => f.name === "F4")).toBe(false);
			expect(features.some(f => f.name === "F3")).toBe(false);

			// History should only have levels 1-2
			expect(state.getLevelHistory().length).toBe(2);
		});

		it("should stop at level 1", () => {
			buildFighter(state, 3);

			state.removeLastLevel(); // 3 → 2
			state.removeLastLevel(); // 2 → 1
			const r = state.removeLastLevel(); // Should fail

			expect(r.success).toBe(false);
			expect(state.getTotalLevel()).toBe(1);
		});
	});

	// endregion

	// region Scholar Expertise

	describe("Scholar Expertise", () => {
		it("should clear scholar expertise on removal", () => {
			buildFighter(state, 2);
			// Set directly to avoid _saveState() which isn't available in test env
			state._data.scholarExpertise = "history";
			state.updateLevelChoice(2, {scholarSkill: "history"});

			state.removeLastLevel();

			expect(state.getScholarExpertise()).toBeNull();
		});
	});

	// endregion
});
