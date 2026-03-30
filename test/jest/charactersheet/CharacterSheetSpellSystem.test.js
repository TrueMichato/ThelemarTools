
import "./setup.js";

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Spell System Improvements", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 16);
		state.setAbilityBase("wis", 16);
		state.setAbilityBase("cha", 14);
	});

	// ===================================================================
	// sourceClass ON SPELLS
	// ===================================================================
	describe("sourceClass Tracking", () => {
		test("addSpell should store sourceClass", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.addSpell({name: "Fireball", source: "PHB", level: 3, sourceClass: "Wizard"});
			const spells = state.getSpellsKnown();
			expect(spells[0].sourceClass).toBe("Wizard");
		});

		test("addSpell should default sourceClass to null", () => {
			state.addSpell({name: "Fireball", source: "PHB", level: 3});
			const spells = state.getSpellsKnown();
			expect(spells[0].sourceClass).toBeNull();
		});

		test("addCantrip should store sourceClass", () => {
			state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: "Wizard"});
			const cantrips = state.getCantripsKnown();
			expect(cantrips[0].sourceClass).toBe("Wizard");
		});

		test("addCantrip should default sourceClass to null", () => {
			state.addCantrip({name: "Fire Bolt", source: "PHB"});
			const cantrips = state.getCantripsKnown();
			expect(cantrips[0].sourceClass).toBeNull();
		});

		test("addInnateSpell should store sourceClass", () => {
			state.addInnateSpell({name: "Darkness", source: "PHB", level: 2, atWill: true, sourceFeature: "Drow Magic", sourceClass: "Drow"});
			const innate = state._data.spellcasting.innateSpells;
			expect(innate[0].sourceClass).toBe("Drow");
		});

		test("addInnateSpell should default sourceClass to null for racial spells", () => {
			state.addInnateSpell({name: "Darkness", source: "PHB", level: 2, atWill: true, sourceFeature: "Drow Magic"});
			const innate = state._data.spellcasting.innateSpells;
			expect(innate[0].sourceClass).toBeNull();
		});

		test("addInnateSpell at-will should not have uses property", () => {
			state.addInnateSpell({name: "Detect Magic", source: "PHB", level: 1, atWill: true, sourceFeature: "Firbolg Magic"});
			const innate = state._data.spellcasting.innateSpells[0];
			expect(innate.atWill).toBe(true);
			expect(innate.uses).toBeUndefined();
		});

		test("addInnateSpell with uses should have correct uses tracking", () => {
			state.addInnateSpell({name: "Disguise Self", source: "PHB", level: 1, atWill: false, uses: 2, recharge: "long", sourceFeature: "Firbolg Magic"});
			const innate = state._data.spellcasting.innateSpells[0];
			expect(innate.atWill).toBe(false);
			expect(innate.uses).toEqual({current: 2, max: 2});
			expect(innate.recharge).toBe("long");
		});

		test("addSpell should preserve sourceClass when merging existing spell", () => {
			state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceClass: "Cleric"});
			// Add same spell again from a feature — sourceClass should be preserved
			state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceFeature: "Life Domain"});
			const spell = state.getSpellsKnown().find(s => s.name === "Cure Wounds");
			expect(spell.sourceClass).toBe("Cleric");
		});

		test("addSpell should set sourceClass on existing spell if not already set", () => {
			state.addSpell({name: "Shield", source: "PHB", level: 1});
			state.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Wizard"});
			const spell = state.getSpellsKnown().find(s => s.name === "Shield");
			expect(spell.sourceClass).toBe("Wizard");
		});

		test("addCantrip should set sourceClass on existing cantrip if not already set", () => {
			state.addCantrip({name: "Light", source: "PHB"});
			state.addCantrip({name: "Light", source: "PHB", sourceClass: "Cleric"});
			const cantrip = state.getCantripsKnown().find(c => c.name === "Light");
			expect(cantrip.sourceClass).toBe("Cleric");
		});

		test("getSpells should include sourceClass in returned objects", () => {
			state.addSpell({name: "Fireball", source: "PHB", level: 3, sourceClass: "Wizard"});
			state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: "Wizard"});
			const all = state.getSpells();
			expect(all.every(s => "sourceClass" in s)).toBe(true);
		});
	});

	// ===================================================================
	// getSpellsByClass
	// ===================================================================
	describe("getSpellsByClass", () => {
		beforeEach(() => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.addClass({name: "Cleric", source: "PHB", level: 3});

			// Wizard spells
			state.addSpell({name: "Fireball", source: "PHB", level: 3, sourceClass: "Wizard"});
			state.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Wizard"});
			state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: "Wizard"});

			// Cleric spells
			state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceClass: "Cleric"});
			state.addSpell({name: "Bless", source: "PHB", level: 1, sourceClass: "Cleric"});
			state.addCantrip({name: "Sacred Flame", source: "PHB", sourceClass: "Cleric"});
		});

		test("should return only spells from the specified class", () => {
			const wizardSpells = state.getSpellsByClass("Wizard");
			expect(wizardSpells.length).toBe(3); // Fireball, Shield, Fire Bolt
			expect(wizardSpells.every(s => s.sourceClass === "Wizard")).toBe(true);
		});

		test("should be case-insensitive", () => {
			const clericSpells = state.getSpellsByClass("cleric");
			expect(clericSpells.length).toBe(3); // Cure Wounds, Bless, Sacred Flame
		});

		test("should return empty for non-existent class", () => {
			expect(state.getSpellsByClass("Paladin")).toEqual([]);
		});
	});

	// ===================================================================
	// getCantripsByClass
	// ===================================================================
	describe("getCantripsByClass", () => {
		test("should return only cantrips from the specified class", () => {
			state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: "Wizard"});
			state.addCantrip({name: "Sacred Flame", source: "PHB", sourceClass: "Cleric"});
			state.addCantrip({name: "Mending", source: "PHB", sourceClass: "Wizard"});

			const wizardCantrips = state.getCantripsByClass("Wizard");
			expect(wizardCantrips.length).toBe(2);
			expect(wizardCantrips.every(c => c.sourceClass === "Wizard")).toBe(true);
		});
	});

	// ===================================================================
	// getPreparedSpellsByClass
	// ===================================================================
	describe("getPreparedSpellsByClass", () => {
		test("should return only prepared spells from the specified class", () => {
			state.addSpell({name: "Fireball", source: "PHB", level: 3, sourceClass: "Wizard"}, true);
			state.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Wizard"}, false);
			state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceClass: "Cleric"}, true);

			const wizardPrepared = state.getPreparedSpellsByClass("Wizard");
			expect(wizardPrepared.length).toBe(1);
			expect(wizardPrepared[0].name).toBe("Fireball");
		});

		test("should include alwaysPrepared spells", () => {
			state.addSpell({name: "Bless", source: "PHB", level: 1, sourceClass: "Cleric", alwaysPrepared: true}, true);
			const clericPrepared = state.getPreparedSpellsByClass("Cleric");
			expect(clericPrepared.length).toBe(1);
		});
	});

	// ===================================================================
	// getSpellsByLevel
	// ===================================================================
	describe("getSpellsByLevel", () => {
		test("should return spells of a specific level", () => {
			state.addCantrip({name: "Fire Bolt", source: "PHB"});
			state.addSpell({name: "Shield", source: "PHB", level: 1});
			state.addSpell({name: "Fireball", source: "PHB", level: 3});
			state.addSpell({name: "Counterspell", source: "PHB", level: 3});

			expect(state.getSpellsByLevel(0).length).toBe(1); // Fire Bolt
			expect(state.getSpellsByLevel(1).length).toBe(1); // Shield
			expect(state.getSpellsByLevel(3).length).toBe(2); // Fireball, Counterspell
			expect(state.getSpellsByLevel(5).length).toBe(0);
		});
	});

	// ===================================================================
	// getSpellCountByClass
	// ===================================================================
	describe("getSpellCountByClass", () => {
		test("should return per-class spell breakdown", () => {
			state.addSpell({name: "Fireball", source: "PHB", level: 3, sourceClass: "Wizard"}, true);
			state.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Wizard"}, false);
			state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: "Wizard"});
			state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceClass: "Cleric"}, true);

			const counts = state.getSpellCountByClass();
			expect(counts.Wizard.spells).toBe(2);
			expect(counts.Wizard.cantrips).toBe(1);
			expect(counts.Wizard.prepared).toBe(1);
			expect(counts.Cleric.spells).toBe(1);
			expect(counts.Cleric.prepared).toBe(1);
		});

		test("should track unclassed spells as Unknown", () => {
			state.addSpell({name: "Fireball", source: "PHB", level: 3}, true);
			const counts = state.getSpellCountByClass();
			expect(counts.Unknown).toBeDefined();
			expect(counts.Unknown.spells).toBe(1);
		});
	});

	// ===================================================================
	// SUBCLASS SPELL POPULATION WITH sourceClass
	// ===================================================================
	describe("Subclass Spells with sourceClass", () => {
		test("getSubclassAlwaysPreparedSpells should include sourceClass", () => {
			const cls = {
				name: "Cleric",
				source: "PHB",
				level: 3,
				subclass: {
					name: "Life",
					additionalSpells: [{
						prepared: {
							1: ["bless|PHB", "cure wounds|PHB"],
							3: ["lesser restoration|PHB", "spiritual weapon|PHB"],
						},
					}],
				},
			};

			const spells = state.getSubclassAlwaysPreparedSpells(cls);
			expect(spells.length).toBeGreaterThan(0);
			expect(spells.every(s => s.sourceClass === "Cleric")).toBe(true);
		});

		test("populateSubclassSpells should set sourceClass on both new and existing spells", () => {
			state.addClass({
				name: "Cleric",
				source: "PHB",
				level: 3,
				subclass: {
					name: "Life",
					additionalSpells: [{
						prepared: {
							1: ["bless|PHB"],
						},
					}],
				},
			});

			state.populateSubclassSpells();
			const bless = state.getSpellsKnown().find(s => s.name.toLowerCase() === "bless");
			expect(bless).toBeDefined();
			expect(bless.sourceClass).toBe("Cleric");
			expect(bless.alwaysPrepared).toBe(true);
		});
	});

	// ===================================================================
	// SPELL BUFF REGISTRY EXPANSION
	// ===================================================================
	describe("Spell Buff Registry", () => {
		test("should contain guidance", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("guidance");
			expect(entry).not.toBeNull();
			expect(entry.concentration).toBe(true);
			expect(entry.selfEffects[0].type).toBe("rollBonus");
			expect(entry.selfEffects[0].target).toBe("check");
		});

		test("should contain resistance cantrip", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("resistance");
			expect(entry).not.toBeNull();
			expect(entry.concentration).toBe(true);
			expect(entry.selfEffects[0].target).toBe("save");
		});

		test("should contain pass without trace", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("pass without trace");
			expect(entry).not.toBeNull();
			expect(entry.selfEffects[0].value).toBe(10);
			expect(entry.selfEffects[0].target).toBe("skill:stealth");
		});

		test("should contain armor of agathys with temp HP", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("armor of agathys");
			expect(entry).not.toBeNull();
			expect(entry.selfEffects.some(e => e.type === "tempHp")).toBe(true);
			expect(entry.upcastPerLevel.tempHp).toBe(5);
		});

		test("should contain false life with temp HP", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("false life");
			expect(entry).not.toBeNull();
			expect(entry.selfEffects[0].type).toBe("tempHp");
		});

		test("should contain warding bond", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("warding bond");
			expect(entry).not.toBeNull();
			expect(entry.selfEffects.some(e => e.type === "bonus" && e.target === "ac")).toBe(true);
			expect(entry.selfEffects.some(e => e.type === "bonus" && e.target === "save")).toBe(true);
			expect(entry.selfEffects.some(e => e.type === "resistance")).toBe(true);
		});

		test("should contain beacon of hope", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("beacon of hope");
			expect(entry).not.toBeNull();
			expect(entry.concentration).toBe(true);
			expect(entry.selfEffects.some(e => e.type === "advantage" && e.target === "save:wis")).toBe(true);
		});

		test("should contain magic weapon", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("magic weapon");
			expect(entry).not.toBeNull();
			expect(entry.concentration).toBe(true);
			expect(entry.selfEffects.some(e => e.type === "bonus" && e.target === "attack")).toBe(true);
			expect(entry.upcastScaling[6].value).toBe(3);
		});

		test("should contain elemental weapon", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("elemental weapon");
			expect(entry).not.toBeNull();
			expect(entry.concentration).toBe(true);
			expect(entry.selfEffects.some(e => e.type === "extraDamage")).toBe(true);
		});

		test("should contain crusader's mantle", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("crusader's mantle");
			expect(entry).not.toBeNull();
			expect(entry.selfEffects[0].damageType).toBe("radiant");
		});

		test("should contain death ward", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("death ward");
			expect(entry).not.toBeNull();
			expect(entry.selfEffects[0].type).toBe("deathWard");
		});

		test("should contain gift of alacrity", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("gift of alacrity");
			expect(entry).not.toBeNull();
			expect(entry.selfEffects[0].target).toBe("initiative");
		});

		test("should contain foresight with comprehensive advantages", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("foresight");
			expect(entry).not.toBeNull();
			expect(entry.selfEffects.length).toBe(4);
			expect(entry.selfEffects.some(e => e.target === "attack")).toBe(true);
			expect(entry.selfEffects.some(e => e.target === "check")).toBe(true);
			expect(entry.selfEffects.some(e => e.target === "save")).toBe(true);
			expect(entry.selfEffects.some(e => e.target === "attacksAgainst")).toBe(true);
		});

		test("should contain sanctuary", () => {
			const entry = CharacterSheetState.getSpellFromRegistry("sanctuary");
			expect(entry).not.toBeNull();
		});

		test("should still contain all original 24 spell entries", () => {
			const originals = [
				"shield of faith", "bless", "bane", "mage armor", "barkskin",
				"shield", "haste", "heroism", "longstrider",
				"protection from evil and good", "stoneskin", "fire shield",
				"aid", "darkvision", "enlarge/reduce", "fly",
				"freedom of movement", "greater invisibility", "blur",
				"mirror image", "hex", "hunter's mark", "divine favor",
				"spirit shroud", "holy weapon",
			];
			for (const name of originals) {
				expect(CharacterSheetState.getSpellFromRegistry(name)).not.toBeNull();
			}
		});

		test("registry should now have 39+ entries", () => {
			const keys = Object.keys(CharacterSheetState.SPELL_BUFF_REGISTRY);
			expect(keys.length).toBeGreaterThanOrEqual(39);
		});
	});

	// ===================================================================
	// MULTICLASS SPELL ISOLATION
	// ===================================================================
	describe("Multiclass Spell Isolation", () => {
		test("multiclass character should track spells per class", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.addClass({name: "Cleric", source: "PHB", level: 3});

			state.addSpell({name: "Fireball", source: "PHB", level: 3, sourceClass: "Wizard"});
			state.addSpell({name: "Counterspell", source: "PHB", level: 3, sourceClass: "Wizard"});
			state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceClass: "Cleric"});
			state.addSpell({name: "Healing Word", source: "PHB", level: 1, sourceClass: "Cleric"});
			state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: "Wizard"});
			state.addCantrip({name: "Sacred Flame", source: "PHB", sourceClass: "Cleric"});

			// Wizard should have 3 spells (2 leveled + 1 cantrip)
			expect(state.getSpellsByClass("Wizard").length).toBe(3);
			// Cleric should have 3
			expect(state.getSpellsByClass("Cleric").length).toBe(3);
			// Cantrips by class
			expect(state.getCantripsByClass("Wizard").length).toBe(1);
			expect(state.getCantripsByClass("Cleric").length).toBe(1);
		});

		test("spells without sourceClass should not appear in class-specific queries", () => {
			state.addSpell({name: "Fireball", source: "PHB", level: 3}); // No sourceClass
			expect(state.getSpellsByClass("Wizard").length).toBe(0);
		});

		test("innate spells should track sourceClass separately", () => {
			state.addInnateSpell({name: "Darkness", source: "PHB", level: 2, atWill: true, sourceFeature: "Drow Magic"});
			// Innate racial spell — sourceClass is null
			const innate = state._data.spellcasting.innateSpells[0];
			expect(innate.sourceClass).toBeNull();
		});
	});

	// ===================================================================
	// EDGE CASES
	// ===================================================================
	describe("Edge Cases", () => {
		test("getSpellsByClass should return empty for empty spell list", () => {
			expect(state.getSpellsByClass("Wizard")).toEqual([]);
		});

		test("getSpellCountByClass should return empty object for no spells", () => {
			expect(state.getSpellCountByClass()).toEqual({});
		});

		test("getSpellsByLevel should return empty for unused level", () => {
			expect(state.getSpellsByLevel(9)).toEqual([]);
		});

		test("sourceClass should survive through getSpells() spread copy", () => {
			state.addSpell({name: "Fireball", source: "PHB", level: 3, sourceClass: "Wizard"});
			const all = state.getSpells();
			const fireball = all.find(s => s.name === "Fireball");
			expect(fireball.sourceClass).toBe("Wizard");
		});

		test("fulfillSpellChoice should pass sourceClass for non-innate spells", () => {
			state._data.pendingSpellChoices = [{
				id: "test-choice",
				featureName: "Magical Secrets",
				sourceClass: "Bard",
				innate: false,
				prepared: true,
			}];

			state.fulfillSpellChoice("test-choice", {
				name: "Counterspell",
				source: "PHB",
				level: 3,
			});

			const spell = state.getSpellsKnown().find(s => s.name === "Counterspell");
			expect(spell).toBeDefined();
			expect(spell.sourceClass).toBe("Bard");
		});

		test("fulfillSpellChoice should pass sourceClass for innate spells", () => {
			state._data.pendingSpellChoices = [{
				id: "test-choice-2",
				featureName: "Fey Ancestry",
				sourceClass: "Ranger",
				innate: true,
				uses: 1,
				recharge: "long",
			}];

			state.fulfillSpellChoice("test-choice-2", {
				name: "Misty Step",
				source: "PHB",
				level: 2,
			});

			const innate = state._data.spellcasting.innateSpells.find(s => s.name === "Misty Step");
			expect(innate).toBeDefined();
			expect(innate.sourceClass).toBe("Ranger");
		});
	});
});
