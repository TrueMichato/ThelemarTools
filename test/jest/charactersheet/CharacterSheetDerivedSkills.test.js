import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const makeState = () => {
	const state = new CharacterSheetState();
	state.setAbilityBase("int", 16);
	state.setAbilityBase("cha", 20);
	state._data.classes = [{name: "Rogue", source: "PHB", level: 5}];
	state.setSkillProficiency("arcana", 1);
	state.addCustomSkill("Spellcraft", "cha");
	return state;
};

describe("Derived skills — replacement/tracking mechanics", () => {
	test("modifier mode mirrors the fully computed source and replaces the target calculation", () => {
		const state = makeState();
		state.setSkillProficiency("spellcraft", 2);
		state.addNamedModifier({name: "All Skills", type: "skill:all", value: 1});
		state.addNamedModifier({name: "Arcana Training", type: "skill:arcana", value: 2});
		state.addNamedModifier({name: "Specialisation", type: "skill:spellcraft", value: 1});
		state.addNamedModifier({
			name: "Spellcraft Mirrors Arcana",
			type: "skill:spellcraft",
			derivedSkill: {source: "arcana", mode: "modifier", delta: 2},
		});

		expect(state.getSkillMod("arcana")).toBe(9); // INT +3, PB +3, all +1, specific +2
		expect(state.getSkillMod("spellcraft")).toBe(12); // source +9, derived +2, target-specific +1
		expect(state._data.customModifiers.skills.spellcraft).toBe(1); // descriptor/resolved value is never cached

		state.setSkillProficiency("arcana", 2);
		expect(state.getSkillMod("arcana")).toBe(12);
		expect(state.getSkillMod("spellcraft")).toBe(15);
	});

	test("score mode uses passive-style 10 + source check modifier without passive-only bonuses", () => {
		const state = makeState();
		state.addNamedModifier({name: "Keen Eye", type: "passive:arcana", value: 5});
		state.addNamedModifier({
			name: "Arcane Aptitude",
			type: "skill:spellcraft",
			derivedSkill: {source: "arcana", mode: "score", delta: -1},
		});

		expect(state.getSkillMod("arcana")).toBe(6);
		expect(state.getSkillMod("spellcraft")).toBe(15);
	});

	test("multi-hop derivation updates dynamically and corrupt cycles remain finite", () => {
		const state = makeState();
		state.addCustomSkill("Runes", "wis");
		state.addNamedModifier({
			name: "Runes from Arcana",
			type: "skill:runes",
			derivedSkill: {source: "arcana"},
		});
		state.addNamedModifier({
			name: "Spellcraft from Runes",
			type: "skill:spellcraft",
			derivedSkill: {source: "runes", delta: 1},
		});
		expect(state.getSkillMod("spellcraft")).toBe(7);

		state.addNamedModifier({
			name: "Arcana from Spellcraft",
			type: "skill:arcana",
			derivedSkill: {source: "spellcraft"},
		});
		expect(Number.isFinite(state.getSkillMod("spellcraft"))).toBe(true);
		expect(Number.isFinite(state.getSkillMod("runes"))).toBe(true);
		expect(Number.isFinite(state.getSkillMod("arcana"))).toBe(true);
	});

	test("self-reference and a second enabled derivation are rejected", () => {
		const state = makeState();
		expect(state.addNamedModifier({
			name: "Self",
			type: "skill:spellcraft",
			derivedSkill: {source: "spellcraft"},
		})).toBeNull();

		expect(state.addNamedModifier({
			name: "First",
			type: "skill:spellcraft",
			derivedSkill: {source: "arcana"},
		})).toEqual(expect.any(String));
		expect(state.addNamedModifier({
			name: "Second",
			type: "skill:spellcraft",
			derivedSkill: {source: "history"},
		})).toBeNull();
	});

	test("editing a derived modifier back to a flat modifier restores normal skill math", () => {
		const state = makeState();
		const id = state.addNamedModifier({
			name: "Spellcraft Mirror",
			type: "skill:spellcraft",
			derivedSkill: {source: "arcana"},
		});
		expect(state.getSkillMod("spellcraft")).toBe(6);

		expect(state.updateNamedModifier(id, {value: 2, derivedSkill: null})).toBe(true);
		expect(state.getNamedModifiersByType("skill:spellcraft")[0].derivedSkill).toBeUndefined();
		expect(state.getSkillMod("spellcraft")).toBe(7);
	});

	test("breakdown attributes the source and preserves the total invariant", () => {
		const state = makeState();
		state.addNamedModifier({name: "All Skills", type: "skill:all", value: 1});
		state.addNamedModifier({name: "Spellcraft Training", type: "skill:spellcraft", value: 3});
		state.addNamedModifier({
			name: "Spellcraft Mirror",
			type: "skill:spellcraft",
			derivedSkill: {source: "arcana", mode: "modifier", delta: 2},
		});
		const breakdown = state.getSkillBreakdown("spellcraft");

		expect(breakdown.components).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Derived from Arcana (modifier)", value: 7}),
			expect.objectContaining({name: "Spellcraft Mirror delta", value: 2}),
			expect.objectContaining({name: "Spellcraft Training", value: 3}),
		]));
		expect(breakdown.components).not.toContainEqual(expect.objectContaining({name: "All Skills"}));
		expect(breakdown.components).not.toContainEqual(expect.objectContaining({name: "Custom Modifier", value: -1}));
		expect(breakdown.total).toBe(state.getSkillMod("spellcraft"));
	});
});

describe("Derived skills — lifecycle and persistence", () => {
	test("custom-skill derivation round-trips and is removed with the skill", () => {
		const state = makeState();
		expect(state.addCustomSkill("Thaumaturgy", null, {
			derivedSkill: {source: "arcana", mode: "modifier", delta: 1},
		})).toBe(true);
		expect(state.getSkillMod("thaumaturgy")).toBe(7);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getSkillMod("thaumaturgy")).toBe(7);
		expect(loaded.getNamedModifiersByType("skill:thaumaturgy")[0].derivedSkill).toEqual({
			source: "arcana",
			mode: "modifier",
			delta: 1,
		});

		loaded.removeCustomSkill("Thaumaturgy");
		expect(loaded.getNamedModifiersByType("skill:thaumaturgy")).toHaveLength(0);
	});

	test("custom-ability toggle registers and removes derived metadata", () => {
		const state = makeState();
		const id = state.addCustomAbility({
			name: "Borrowed Lore",
			mode: "toggleable",
			effects: [{
				type: "skill:spellcraft",
				value: 0,
				derivedSkill: {source: "arcana", mode: "modifier"},
			}],
		});

		expect(state.getSkillMod("spellcraft")).toBe(5);
		state.toggleCustomAbility(id);
		expect(state.getSkillMod("spellcraft")).toBe(6);
		expect(state.getNamedModifiersByType("skill:spellcraft")[0].derivedSkill.source).toBe("arcana");
		state.toggleCustomAbility(id);
		expect(state.getSkillMod("spellcraft")).toBe(5);
	});

	test("equipping and unequipping an item registers and removes the same derived effect", () => {
		const state = makeState();
		state.addItem({
			id: "item-derived-skill",
			name: "Arcane Lens",
			source: "Custom",
			effects: [{
				type: "skill:spellcraft",
				value: 0,
				derivedSkill: {source: "arcana", mode: "score"},
			}],
		});

		expect(state.getSkillMod("spellcraft")).toBe(5);
		state.setItemEquipped("item-derived-skill", true);
		expect(state.getSkillMod("spellcraft")).toBe(16);
		state.setItemEquipped("item-derived-skill", false);
		expect(state.getSkillMod("spellcraft")).toBe(5);
	});
});
