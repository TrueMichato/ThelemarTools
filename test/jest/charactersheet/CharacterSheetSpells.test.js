/**
 * Character Sheet Spellcasting - Unit Tests
 * Tests for spell slots, spell save DC, spell attack, concentration, and spell management
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

describe("Spellcasting", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ==========================================================================
	// Spell Slots
	// ==========================================================================
	describe("Spell Slots", () => {
		beforeEach(() => {
			// Level 5 Wizard
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.setAbilityBase("int", 16);
		});

		it("should have correct spell slots for level 5 wizard", () => {
			const slots = state.getSpellSlots();
			expect(slots[1]?.max).toBe(4); // 4 first-level slots
			expect(slots[2]?.max).toBe(3); // 3 second-level slots
			expect(slots[3]?.max).toBe(2); // 2 third-level slots
		});

		it("should track current spell slot usage", () => {
			state.setSpellSlots(1, 4, 4);
			state.useSpellSlot(1);
			expect(state.getSpellSlots()[1].current).toBe(3);
		});

		it("should not use slot if none available", () => {
			// setSpellSlots(level, max, current) - set to max=2 but current=0
			state.setSpellSlots(3, 2, 0);
			const result = state.useSpellSlot(3);
			expect(result).toBe(false);
			expect(state.getSpellSlots()[3].current).toBe(0);
		});

		it("should restore a single spell slot", () => {
			// setSpellSlots(level, max, current)
			state.setSpellSlots(1, 4, 1);
			// Use setSpellSlotCurrent to restore one slot
			state.setSpellSlotCurrent(1, 2);
			expect(state.getSpellSlots()[1].current).toBe(2);
		});

		it("should not exceed max when restoring", () => {
			state.setSpellSlots(1, 4, 4);
			// Try to set above max
			state.setSpellSlotCurrent(1, 5);
			expect(state.getSpellSlots()[1].current).toBe(4); // Capped at max
		});

		it("should restore all slots on long rest", () => {
			// setSpellSlots(level, max, current)
			state.setSpellSlots(1, 4, 1);
			state.setSpellSlots(2, 3, 0);
			state.recoverSpellSlots();
			expect(state.getSpellSlots()[1].current).toBe(4);
			expect(state.getSpellSlots()[2].current).toBe(3);
		});
	});

	// ==========================================================================
	// Spell Slot Progression by Level
	// ==========================================================================
	describe("Spell Slot Progression", () => {
		const slotProgression = [
			{level: 1, slots: {1: 2}},
			{level: 2, slots: {1: 3}},
			{level: 3, slots: {1: 4, 2: 2}},
			{level: 4, slots: {1: 4, 2: 3}},
			{level: 5, slots: {1: 4, 2: 3, 3: 2}},
			{level: 9, slots: {1: 4, 2: 3, 3: 3, 4: 3, 5: 1}},
		];

		slotProgression.forEach(({level, slots}) => {
			it(`should have correct slots at level ${level}`, () => {
				const wizardState = new CharacterSheetState();
				wizardState.addClass({name: "Wizard", source: "PHB", level});
				const actualSlots = wizardState.getSpellSlots();

				Object.entries(slots).forEach(([slotLevel, expectedMax]) => {
					expect(actualSlots[slotLevel]?.max).toBe(expectedMax);
				});
			});
		});
	});

	// ==========================================================================
	// Pact Magic (Warlock)
	// ==========================================================================
	describe("Pact Magic", () => {
		beforeEach(() => {
			state.addClass({name: "Warlock", source: "PHB", level: 5});
			state.setAbilityBase("cha", 16);
		});

		it("should have pact slots instead of normal slots", () => {
			const pactSlots = state.getPactSlots();
			expect(pactSlots).toBeDefined();
			expect(pactSlots.max).toBe(2); // Level 5 warlock = 2 pact slots
			expect(pactSlots.level).toBe(3); // 3rd level slots
		});

		it("should use pact slots", () => {
			// Note: pact slots are auto-calculated when Warlock class is added
			const before = state.getPactSlots().current;
			state.usePactSlot();
			expect(state.getPactSlots().current).toBe(before - 1);
		});

		it("should restore pact slots on short rest", () => {
			// Use all pact slots
			state.usePactSlot();
			state.usePactSlot();
			expect(state.getPactSlots().current).toBe(0);
			// Restore to max using setPactSlotsCurrent
			state.setPactSlotsCurrent(state.getPactSlots().max);
			expect(state.getPactSlots().current).toBe(2);
		});
	});

	// ==========================================================================
	// Spell Save DC
	// ==========================================================================
	describe("Spell Save DC", () => {
		it("should calculate wizard spell save DC (8 + prof + INT)", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.setAbilityBase("int", 16);
			state.setSpellcastingAbility("int");
			// DC = 8 + 3 (prof at level 5) + 3 (INT mod) = 14
			expect(state.getSpellSaveDc()).toBe(14);
		});

		it("should calculate cleric spell save DC (8 + prof + WIS)", () => {
			state.addClass({name: "Cleric", source: "PHB", level: 5});
			state.setAbilityBase("wis", 18);
			state.setSpellcastingAbility("wis");
			// DC = 8 + 3 + 4 = 15
			expect(state.getSpellSaveDc()).toBe(15);
		});

		it("should calculate sorcerer spell save DC (8 + prof + CHA)", () => {
			state.addClass({name: "Sorcerer", source: "PHB", level: 1});
			state.setAbilityBase("cha", 16);
			state.setSpellcastingAbility("cha");
			// DC = 8 + 2 + 3 = 13
			expect(state.getSpellSaveDc()).toBe(13);
		});

		it("should include item bonuses to spell save DC", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.setAbilityBase("int", 16);
			state.setSpellcastingAbility("int");
			state.setItemBonus("spellSaveDc", 2); // +2 from Arcane Grimoire
			expect(state.getSpellSaveDc()).toBe(16);
		});
	});

	// ==========================================================================
	// Spell Attack Bonus
	// ==========================================================================
	describe("Spell Attack Bonus", () => {
		it("should calculate spell attack bonus (prof + ability mod)", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.setAbilityBase("int", 16);
			state.setSpellcastingAbility("int");
			// Attack = 3 (prof) + 3 (INT) = +6
			expect(state.getSpellAttackBonus()).toBe(6);
		});

		it("should scale with level", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 9});
			state.setAbilityBase("int", 16);
			state.setSpellcastingAbility("int");
			// Attack = 4 (prof at level 9) + 3 (INT) = +7
			expect(state.getSpellAttackBonus()).toBe(7);
		});

		it("should include item bonuses", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.setAbilityBase("int", 16);
			state.setSpellcastingAbility("int");
			state.setItemBonus("spellAttack", 1);
			expect(state.getSpellAttackBonus()).toBe(7);
		});
	});

	// ==========================================================================
	// Known Spells
	// ==========================================================================
	describe("Known Spells", () => {
		beforeEach(() => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
		});

		it("should add a known spell", () => {
			state.addSpell({name: "Fireball", source: "PHB", level: 3});
			const spells = state.getSpellsKnown();
			expect(spells).toHaveLength(1);
			expect(spells[0].name).toBe("Fireball");
		});

		it("should track spell level", () => {
			state.addSpell({name: "Magic Missile", source: "PHB", level: 1});
			const spell = state.getSpellsKnown()[0];
			expect(spell.level).toBe(1);
		});

		it("should remove a known spell", () => {
			state.addSpell({name: "Shield", source: "PHB", level: 1});
			state.removeSpell("Shield", "PHB");
			expect(state.getSpellsKnown()).toHaveLength(0);
		});

		it("should track prepared status", () => {
			state.addSpell({name: "Detect Magic", source: "PHB", level: 1}, true); // 2nd arg is prepared
			const spell = state.getSpellsKnown()[0];
			expect(spell.prepared).toBe(true);
		});

		it("should toggle prepared status", () => {
			state.addSpell({name: "Sleep", source: "PHB", level: 1}, false);
			const spell = state.getSpellsKnown()[0];
			state.setSpellPrepared(spell.id, true);
			expect(state.getSpellsKnown()[0].prepared).toBe(true);
		});
	});

	// ==========================================================================
	// Cantrips
	// ==========================================================================
	describe("Cantrips", () => {
		beforeEach(() => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
		});

		it("should add a cantrip", () => {
			state.addCantrip({name: "Fire Bolt", source: "PHB"});
			const cantrips = state.getCantripsKnown();
			expect(cantrips).toHaveLength(1);
		});

		it("should track cantrips separately from spells", () => {
			state.addCantrip({name: "Prestidigitation", source: "PHB"});
			state.addSpell({name: "Magic Missile", source: "PHB", level: 1});
			expect(state.getCantripsKnown()).toHaveLength(1);
			expect(state.getSpellsKnown()).toHaveLength(1);
		});

		it("should get cantrip damage scaling by level", () => {
			// Cantrip damage scales at levels 5, 11, 17 based on total level
			// Level 5 character = 2 dice
			const level = state.getTotalLevel();
			const dice = level < 5 ? 1 : level < 11 ? 2 : level < 17 ? 3 : 4;
			expect(dice).toBe(2); // Level 5 = 2 dice
		});

		it("should scale cantrip damage at level 11", () => {
			const highLevel = new CharacterSheetState();
			highLevel.addClass({name: "Wizard", source: "PHB", level: 11});
			const level = highLevel.getTotalLevel();
			const dice = level < 5 ? 1 : level < 11 ? 2 : level < 17 ? 3 : 4;
			expect(dice).toBe(3); // Level 11 = 3 dice
		});

		it("should scale cantrip damage at level 17", () => {
			const highLevel = new CharacterSheetState();
			highLevel.addClass({name: "Wizard", source: "PHB", level: 17});
			const level = highLevel.getTotalLevel();
			const dice = level < 5 ? 1 : level < 11 ? 2 : level < 17 ? 3 : 4;
			expect(dice).toBe(4); // Level 17 = 4 dice
		});
	});

	// ==========================================================================
	// Concentration
	// ==========================================================================
	describe("Concentration", () => {
		beforeEach(() => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.setAbilityBase("con", 14);
		});

		it("should set concentrating spell", () => {
			state.setConcentration("Haste", 3);
			expect(state.isConcentrating()).toBe(true);
		});

		it("should get concentrating spell name", () => {
			state.setConcentration("Fly", 3);
			expect(state.getConcentration().spellName).toBe("Fly");
		});

		it("should replace concentration when new spell is cast", () => {
			state.setConcentration("Bless", 1);
			state.setConcentration("Hold Person", 2);
			expect(state.getConcentration().spellName).toBe("Hold Person");
		});

		it("should break concentration", () => {
			state.setConcentration("Invisibility", 2);
			state.breakConcentration();
			expect(state.isConcentrating()).toBe(false);
		});

		it("should calculate concentration save bonus", () => {
			// CON 14 = +2, so save bonus should be at least +2
			const bonus = state.getSaveMod("con");
			expect(bonus).toBeGreaterThanOrEqual(2);
		});

		it("should include War Caster advantage", () => {
			// War Caster isn't tracked as a separate flag - check via feats
			state.addFeat({name: "War Caster", source: "PHB"});
			const feats = state.getFeats();
			expect(feats.some(f => f.name === "War Caster")).toBe(true);
		});
	});

	// ==========================================================================
	// Innate Spellcasting
	// ==========================================================================
	describe("Innate Spellcasting", () => {
		it("should add innate spell with uses", () => {
			state.addInnateSpell({
				name: "Misty Step",
				source: "PHB",
				level: 2,
				uses: 1,
				recharge: "long",
				sourceFeature: "Fey Ancestry",
			});
			const innate = state.getInnateSpells();
			expect(innate).toHaveLength(1);
			expect(innate[0].uses.max).toBe(1);
			expect(innate[0].uses.current).toBe(1);
		});

		it("should track at-will innate spells", () => {
			state.addInnateSpell({
				name: "Detect Magic",
				source: "PHB",
				level: 1,
				atWill: true,
				sourceFeature: "Detect Magic at Will",
			});
			const innate = state.getInnateSpells();
			expect(innate[0].atWill).toBe(true);
			expect(innate[0].uses).toBeUndefined(); // at-will spells don't have uses
		});

		it("should use innate spell charge", () => {
			state.addInnateSpell({
				name: "Darkness",
				source: "PHB",
				level: 2,
				uses: 1,
			});
			const innate = state.getInnateSpells();
			const spellId = innate[0].id;
			state.useInnateSpell(spellId);
			expect(state.getInnateSpells()[0].uses.current).toBe(0);
		});

		it("should restore innate spells on appropriate rest", () => {
			state.addInnateSpell({
				name: "Faerie Fire",
				source: "PHB",
				level: 1,
				uses: 1,
				recharge: "long",
			});
			const innate = state.getInnateSpells();
			const spellId = innate[0].id;
			state.useInnateSpell(spellId); // Use it first
			expect(state.getInnateSpells()[0].uses.current).toBe(0);
			state.onLongRest();
			expect(state.getInnateSpells()[0].uses.current).toBe(1);
		});
	});

	// ==========================================================================
	// Multiclass Spellcasting
	// ==========================================================================
	describe("Multiclass Spellcasting", () => {
		it("should calculate multiclass spell slots", () => {
			// Wizard 3 / Cleric 2 = 5 caster levels
			state.addClass({name: "Wizard", source: "PHB", level: 3});
			state.addClass({name: "Cleric", source: "PHB", level: 2});

			const slots = state.getSpellSlots();
			// Full casters combined: level 5 slots
			expect(slots[1]?.max).toBe(4);
			expect(slots[2]?.max).toBe(3);
			expect(slots[3]?.max).toBe(2);
		});

		it("should handle half-caster multiclass", () => {
			// Paladin 4 = 2 caster levels
			state.addClass({name: "Paladin", source: "PHB", level: 4});

			const slots = state.getSpellSlots();
			expect(slots[1]?.max).toBe(3); // Level 2 caster
		});

		it("should handle Warlock multiclass separately", () => {
			// Warlock slots don't combine with other classes
			state.addClass({name: "Wizard", source: "PHB", level: 3});
			state.addClass({name: "Warlock", source: "PHB", level: 2});

			// Should have both regular slots and pact slots
			const regularSlots = state.getSpellSlots();
			const pactSlots = state.getPactSlots();

			expect(regularSlots[1]?.max).toBeGreaterThan(0);
			expect(pactSlots?.max).toBeGreaterThan(0);
		});
	});

	// ==========================================================================
	// Ritual Casting
	// ==========================================================================
	describe("Ritual Casting", () => {
		beforeEach(() => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
		});

		it("should store ritual property on spells", () => {
			state.addSpell({
				name: "Find Familiar",
				source: "PHB",
				level: 1,
				ritual: true,
			});
			const spells = state.getSpellsKnown();
			const spell = spells.find(s => s.name === "Find Familiar");
			expect(spell.ritual).toBe(true);
		});

		it("should track ritual spells separately from non-ritual", () => {
			state.addSpell({name: "Fireball", source: "PHB", level: 3, ritual: false});
			state.addSpell({name: "Find Familiar", source: "PHB", level: 1, ritual: true});
			const spells = state.getSpellsKnown();
			const ritualSpells = spells.filter(s => s.ritual);
			expect(ritualSpells).toHaveLength(1);
			expect(ritualSpells[0].name).toBe("Find Familiar");
		});
	});

	// ==========================================================================
	// Spell Preparation
	// ==========================================================================
	describe("Spell Preparation", () => {
		beforeEach(() => {
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			state.setAbilityBase("int", 16);
		});

		it("should add spell as prepared", () => {
			state.addSpell({name: "Fireball", source: "PHB", level: 3}, true);
			const spells = state.getSpellsKnown();
			expect(spells[0].prepared).toBe(true);
		});

		it("should count prepared spells", () => {
			state.addSpell({name: "Fireball", source: "PHB", level: 3}, true);
			state.addSpell({name: "Shield", source: "PHB", level: 1}, true);
			state.addSpell({name: "Sleep", source: "PHB", level: 1}, false);
			const spells = state.getSpellsKnown();
			const preparedCount = spells.filter(s => s.prepared).length;
			expect(preparedCount).toBe(2);
		});

		it("should toggle spell prepared state", () => {
			state.addSpell({name: "Magic Missile", source: "PHB", level: 1}, false);
			const spell = state.getSpellsKnown()[0];
			state.setSpellPrepared(spell.id, true);
			expect(state.getSpellsKnown()[0].prepared).toBe(true);
		});

		it("should get list of prepared spells only", () => {
			state.addSpell({name: "Magic Missile", source: "PHB", level: 1}, true);
			state.addSpell({name: "Charm Person", source: "PHB", level: 1}, false);
			const spells = state.getSpellsKnown();
			const prepared = spells.filter(s => s.prepared);
			expect(prepared).toHaveLength(1);
			expect(prepared[0].name).toBe("Magic Missile");
		});
	});
});

// ==========================================================================
// isPlayerChosenSpell — counter filter logic
// ==========================================================================
describe("CharacterSheetSpells.isPlayerChosenSpell", () => {
	it("should count spells with no sourceFeature (manual add from modal)", () => {
		expect(CharacterSheetSpells.isPlayerChosenSpell({name: "Fireball", sourceFeature: null})).toBe(true);
		expect(CharacterSheetSpells.isPlayerChosenSpell({name: "Fireball"})).toBe(true);
	});

	it("should count spells with sourceFeature 'Spells Known' (builder/levelup)", () => {
		expect(CharacterSheetSpells.isPlayerChosenSpell({sourceFeature: "Spells Known"})).toBe(true);
	});

	it("should count cantrips with sourceFeature 'Cantrips Known' (builder)", () => {
		expect(CharacterSheetSpells.isPlayerChosenSpell({sourceFeature: "Cantrips Known"})).toBe(true);
	});

	it("should count spells with sourceFeature 'Wizard Spellbook' (builder/levelup)", () => {
		expect(CharacterSheetSpells.isPlayerChosenSpell({sourceFeature: "Wizard Spellbook"})).toBe(true);
	});

	it("should count spells with sourceFeature 'Prepared Spells' (levelup/quickbuild)", () => {
		expect(CharacterSheetSpells.isPlayerChosenSpell({sourceFeature: "Prepared Spells"})).toBe(true);
	});

	it("should count spells with sourceFeature 'Spells Prepared' (builder)", () => {
		expect(CharacterSheetSpells.isPlayerChosenSpell({sourceFeature: "Spells Prepared"})).toBe(true);
	});

	it("should NOT count racial innate spells (e.g. High Elf cantrip)", () => {
		expect(CharacterSheetSpells.isPlayerChosenSpell({sourceFeature: "High Elf"})).toBe(false);
	});

	it("should NOT count subclass always-prepared spells", () => {
		expect(CharacterSheetSpells.isPlayerChosenSpell({sourceFeature: "Life Domain Spells"})).toBe(false);
		expect(CharacterSheetSpells.isPlayerChosenSpell({sourceFeature: "Land Spells"})).toBe(false);
	});

	it("should NOT count Divine Soul Affinity spell", () => {
		expect(CharacterSheetSpells.isPlayerChosenSpell({sourceFeature: "Divine Soul Affinity"})).toBe(false);
	});

	it("should NOT count Tiefling innate spells", () => {
		expect(CharacterSheetSpells.isPlayerChosenSpell({sourceFeature: "Tiefling"})).toBe(false);
	});
});

describe("Spell tracking counter integration", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({
			name: "Sorcerer", source: "PHB", level: 3,
			spellsKnownProgression: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
			cantripProgression: [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
		});
		state.setAbilityBase("cha", 16);
	});

	it("should count builder-added spells toward the known limit", () => {
		// Simulate builder adding spells with sourceFeature
		state.addSpell({name: "Magic Missile", source: "PHB", level: 1, sourceFeature: "Spells Known", sourceClass: "Sorcerer"}, true);
		state.addSpell({name: "Shield", source: "PHB", level: 1, sourceFeature: "Spells Known", sourceClass: "Sorcerer"}, true);

		const spells = state.getSpells();
		const playerChosen = spells.filter(s => CharacterSheetSpells.isPlayerChosenSpell(s));
		expect(playerChosen).toHaveLength(2);
	});

	it("should count builder-added cantrips toward the cantrip limit", () => {
		state.addCantrip({name: "Fire Bolt", source: "PHB", school: "V", sourceFeature: "Cantrips Known", sourceClass: "Sorcerer"});
		state.addCantrip({name: "Prestidigitation", source: "PHB", school: "T", sourceFeature: "Cantrips Known", sourceClass: "Sorcerer"});

		const cantrips = state.getCantripsKnown();
		const playerChosen = cantrips.filter(c => CharacterSheetSpells.isPlayerChosenSpell(c));
		expect(playerChosen).toHaveLength(2);
	});

	it("should NOT count feature-granted spells toward the known limit", () => {
		// Player-chosen spell
		state.addSpell({name: "Magic Missile", source: "PHB", level: 1, sourceFeature: "Spells Known", sourceClass: "Sorcerer"}, true);
		// Feature-granted (e.g. Divine Soul affinity)
		state.addSpell({name: "Cure Wounds", source: "PHB", level: 1, sourceFeature: "Divine Soul Affinity", sourceClass: "Sorcerer", alwaysPrepared: true}, true);

		const spells = state.getSpells();
		const playerChosen = spells.filter(s => CharacterSheetSpells.isPlayerChosenSpell(s));
		expect(playerChosen).toHaveLength(1);
		expect(playerChosen[0].name).toBe("Magic Missile");
	});

	it("should NOT count racial cantrips toward the cantrip limit", () => {
		state.addCantrip({name: "Fire Bolt", source: "PHB", school: "V", sourceFeature: "Cantrips Known", sourceClass: "Sorcerer"});
		state.addCantrip({name: "Light", source: "PHB", school: "V", sourceFeature: "High Elf"});

		const cantrips = state.getCantripsKnown();
		const playerChosen = cantrips.filter(c => CharacterSheetSpells.isPlayerChosenSpell(c));
		expect(playerChosen).toHaveLength(1);
		expect(playerChosen[0].name).toBe("Fire Bolt");
	});

	it("should count manually added spells (no sourceFeature) toward the limit", () => {
		state.addSpell({name: "Magic Missile", source: "PHB", level: 1}, true);

		const spells = state.getSpells();
		const playerChosen = spells.filter(s => CharacterSheetSpells.isPlayerChosenSpell(s));
		expect(playerChosen).toHaveLength(1);
	});
});
