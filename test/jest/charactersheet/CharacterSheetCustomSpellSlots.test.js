import "./setup.js"; // Import first to set up mocks

let CharacterSheetState;
let CharacterSheetCustomAbilities;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	await import("../../../js/charactersheet/charactersheet-customabilities.js");
	CharacterSheetCustomAbilities = globalThis.CharacterSheetCustomAbilities;
});

/**
 * Covers the "grant N extra spell slots of level X" capability shared by custom abilities and
 * custom items (via the Modifiers & Effects catalog → named-modifier pipeline →
 * calculateSpellSlots).
 */
describe("Custom ability / item extra spell slots", () => {
	const mkWizard5 = () => {
		const s = new CharacterSheetState();
		s.setAbilityBase("int", 16);
		s.addClass({name: "Wizard", level: 5, casterProgression: "full"});
		s.calculateSpellSlots();
		return s;
	};

	describe("Effect catalog", () => {
		it("exposes a spell-slot option for each slot level 1-9", () => {
			const groups = CharacterSheetCustomAbilities.getModifierGroups({getSkillsList: () => []});
			const group = groups.find(g => g.options.some(o => o.value.startsWith("spellSlots:")));
			expect(group).toBeDefined();
			for (let lvl = 1; lvl <= 9; lvl++) {
				expect(group.options.some(o => o.value === `spellSlots:${lvl}`)).toBe(true);
			}
		});

		it("keeps the spell-slot options available for items (forItems)", () => {
			const html = CharacterSheetCustomAbilities.getEffectTypeOptionsHtml({getSkillsList: () => []}, {forItems: true});
			expect(html).toContain("value=\"spellSlots:3\"");
		});
	});

	describe("Custom abilities", () => {
		it("passive ability adds extra slots on top of the caster's base slots", () => {
			const s = mkWizard5();
			expect(s.getSpellSlotsMax(3)).toBe(2); // wizard 5 baseline

			s.addCustomAbility({
				name: "Reservoir",
				mode: "passive",
				effects: [{type: "spellSlots:3", value: 2}],
			});
			s.calculateSpellSlots();

			expect(s.getSpellSlotsMax(3)).toBe(4);
			expect(s.getSpellSlotsCurrent(3)).toBe(4);
		});

		it("is idempotent — repeated recalcs never double-count the bonus", () => {
			const s = mkWizard5();
			s.addCustomAbility({name: "Reservoir", mode: "passive", effects: [{type: "spellSlots:1", value: 1}]});

			for (let i = 0; i < 5; i++) s.calculateSpellSlots();

			// Wizard 5 has 4 first-level slots + 1 granted = 5 (not 4 + 5×1).
			expect(s.getSpellSlotsMax(1)).toBe(5);
		});

		it("grants slots to a non-caster (materialises the level only when granted)", () => {
			const s = new CharacterSheetState();
			s.addClass({name: "Fighter", level: 5});
			s.calculateSpellSlots();
			expect(s.getSpellSlotsMax(2)).toBeFalsy();

			s.addCustomAbility({name: "Gift", mode: "passive", effects: [{type: "spellSlots:2", value: 1}]});
			s.calculateSpellSlots();

			expect(s.getSpellSlotsMax(2)).toBe(1);
			expect(s.getSpellSlotsCurrent(2)).toBe(1);
			expect(s.getSpellSlotsMax(3)).toBeFalsy(); // untouched levels stay absent
		});

		it("toggleable ability only grants slots while active", () => {
			const s = mkWizard5();
			const id = s.addCustomAbility({
				name: "Arcane Surge",
				mode: "toggleable",
				effects: [{type: "spellSlots:3", value: 1}],
			});
			s.calculateSpellSlots();
			expect(s.getSpellSlotsMax(3)).toBe(2); // inactive → no bonus

			s.toggleCustomAbility(id);
			s.calculateSpellSlots();
			expect(s.getSpellSlotsMax(3)).toBe(3); // active → +1

			s.toggleCustomAbility(id);
			s.calculateSpellSlots();
			expect(s.getSpellSlotsMax(3)).toBe(2); // back off → removed
		});

		it("removing the ability removes its granted slots", () => {
			const s = mkWizard5();
			const id = s.addCustomAbility({name: "Reservoir", mode: "passive", effects: [{type: "spellSlots:3", value: 2}]});
			s.calculateSpellSlots();
			expect(s.getSpellSlotsMax(3)).toBe(4);

			s.removeCustomAbility(id);
			s.calculateSpellSlots();
			expect(s.getSpellSlotsMax(3)).toBe(2);
		});

		it("preserves spent slots across a recalculation", () => {
			const s = mkWizard5();
			s.addCustomAbility({name: "Reservoir", mode: "passive", effects: [{type: "spellSlots:1", value: 1}]});
			s.calculateSpellSlots();
			expect(s.getSpellSlotsMax(1)).toBe(5);

			// Spend two first-level slots, then force a recompute.
			s.setSpellSlotCurrent(1, 3);
			s.calculateSpellSlots();

			expect(s.getSpellSlotsMax(1)).toBe(5);
			expect(s.getSpellSlotsCurrent(1)).toBe(3); // spent slots stay spent
		});
	});

	describe("getBonusSpellSlotsForLevel — UI shading source", () => {
		it("reports 0 bonus for every level with no grants", () => {
			const s = mkWizard5();
			for (let lvl = 1; lvl <= 9; lvl++) expect(s.getBonusSpellSlotsForLevel(lvl)).toBe(0);
		});

		it("reports the granted count per level (from a custom ability)", () => {
			const s = mkWizard5();
			s.addCustomAbility({name: "Reservoir", mode: "passive", effects: [{type: "spellSlots:3", value: 2}]});
			s.calculateSpellSlots();

			expect(s.getBonusSpellSlotsForLevel(3)).toBe(2);
			expect(s.getBonusSpellSlotsForLevel(2)).toBe(0);
			// The bonus never exceeds the level's max (base 2 + bonus 2 = 4).
			expect(s.getBonusSpellSlotsForLevel(3)).toBeLessThanOrEqual(s.getSpellSlotsMax(3));
		});

		it("drops back to 0 when a toggleable grant is inactive", () => {
			const s = mkWizard5();
			const id = s.addCustomAbility({name: "Surge", mode: "toggleable", effects: [{type: "spellSlots:1", value: 1}]});
			s.calculateSpellSlots();
			expect(s.getBonusSpellSlotsForLevel(1)).toBe(0); // inactive

			s.toggleCustomAbility(id);
			s.calculateSpellSlots();
			expect(s.getBonusSpellSlotsForLevel(1)).toBe(1); // active
		});

		it("ignores out-of-range levels", () => {
			const s = mkWizard5();
			expect(s.getBonusSpellSlotsForLevel(0)).toBe(0);
			expect(s.getBonusSpellSlotsForLevel(10)).toBe(0);
			expect(s.getBonusSpellSlotsForLevel("nope")).toBe(0);
		});
	});

	describe("Custom items", () => {
		it("an equipped custom item grants extra slots and unequipping removes them", () => {
			const s = mkWizard5();
			expect(s.getSpellSlotsMax(4)).toBe(0);

			const itemId = "ring-of-slots";
			s.addItem({
				id: itemId,
				name: "Ring of Extra Slots",
				source: "Custom",
				_isCustom: true,
				equipped: true,
				effects: [{type: "spellSlots:4", value: 1}],
			});
			s.calculateSpellSlots();
			expect(s.getSpellSlotsMax(4)).toBe(1);

			s.setItemEquipped(itemId, false);
			s.calculateSpellSlots();
			expect(s.getSpellSlotsMax(4)).toBe(0);
		});
	});
});
