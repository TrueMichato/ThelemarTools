import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";

const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;
const CharacterSheetState = globalThis.CharacterSheetState;

// Validation toasts via JqueryUtil are fine to swallow in tests.
globalThis.JqueryUtil = {...(globalThis.JqueryUtil || {}), doToast: () => {}};

// The setup.js Parser mock omits SKILL_TO_ATB_ABV; add it so the standard-skill
// collision check in _validateLoreSkillAllocation has data to consult.
if (globalThis.Parser && !globalThis.Parser.SKILL_TO_ATB_ABV) {
	globalThis.Parser.SKILL_TO_ATB_ABV = {
		"athletics": "str",
		"acrobatics": "dex",
		"sleight of hand": "dex",
		"stealth": "dex",
		"arcana": "int",
		"history": "int",
		"investigation": "int",
		"nature": "int",
		"religion": "int",
		"animal handling": "wis",
		"insight": "wis",
		"medicine": "wis",
		"perception": "wis",
		"survival": "wis",
		"deception": "cha",
		"intimidation": "cha",
		"performance": "cha",
		"persuasion": "cha",
	};
}

function makeBuilder () {
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder._state = new CharacterSheetState();
	builder._loreSkillAllocation = {
		preset: "three",
		skills: [
			{name: "", bonus: 2},
			{name: "", bonus: 2},
			{name: "", bonus: 2},
		],
	};
	return builder;
}

describe("CharacterSheetBuilder — Lore Skills allocation", () => {
	describe("default state", () => {
		it("starts with the three-skill preset and three empty +2 slots", () => {
			const builder = makeBuilder();
			expect(builder._loreSkillAllocation.preset).toBe("three");
			expect(builder._loreSkillAllocation.skills).toHaveLength(3);
			builder._loreSkillAllocation.skills.forEach(s => {
				expect(s.name).toBe("");
				expect(s.bonus).toBe(2);
			});
		});
	});

	describe("_setLoreSkillPreset", () => {
		it("switches to the two-skill preset with bonuses [2, 4] and preserves typed names", () => {
			const builder = makeBuilder();
			builder._loreSkillAllocation.skills[0].name = "Heraldry";
			builder._loreSkillAllocation.skills[1].name = "Architecture";
			builder._renderLoreSkillSlots = () => {}; // stub DOM hook
			builder._setLoreSkillPreset("two");
			expect(builder._loreSkillAllocation.preset).toBe("two");
			expect(builder._loreSkillAllocation.skills).toHaveLength(2);
			expect(builder._loreSkillAllocation.skills[0]).toEqual({name: "Heraldry", bonus: 2});
			expect(builder._loreSkillAllocation.skills[1]).toEqual({name: "Architecture", bonus: 4});
		});

		it("switches back to the three-skill preset with three +2 slots", () => {
			const builder = makeBuilder();
			builder._renderLoreSkillSlots = () => {};
			builder._setLoreSkillPreset("two");
			builder._loreSkillAllocation.skills[0].name = "Heraldry";
			builder._setLoreSkillPreset("three");
			expect(builder._loreSkillAllocation.skills).toHaveLength(3);
			expect(builder._loreSkillAllocation.skills.map(s => s.bonus)).toEqual([2, 2, 2]);
			expect(builder._loreSkillAllocation.skills[0].name).toBe("Heraldry");
		});
	});

	describe("_validateLoreSkillAllocation", () => {
		it("accepts the empty (opt-out) allocation", () => {
			const builder = makeBuilder();
			expect(builder._validateLoreSkillAllocation()).toBe(true);
		});

		it("rejects duplicate names within the allocation", () => {
			const builder = makeBuilder();
			builder._loreSkillAllocation.skills[0].name = "Heraldry";
			builder._loreSkillAllocation.skills[1].name = "heraldry"; // case-insensitive
			expect(builder._validateLoreSkillAllocation()).toBe(false);
		});

		it("rejects names that collide with standard skills", () => {
			const builder = makeBuilder();
			builder._loreSkillAllocation.skills[0].name = "Arcana";
			expect(builder._validateLoreSkillAllocation()).toBe(false);
		});

		it("accepts a fully filled valid allocation", () => {
			const builder = makeBuilder();
			builder._loreSkillAllocation.skills[0].name = "Heraldry";
			builder._loreSkillAllocation.skills[1].name = "Architecture";
			builder._loreSkillAllocation.skills[2].name = "Planar Geography";
			expect(builder._validateLoreSkillAllocation()).toBe(true);
		});
	});

	describe("_applyLoreSkillAllocation", () => {
		it("creates lore skills on state with names + bonuses from the allocation", () => {
			const builder = makeBuilder();
			builder._loreSkillAllocation.skills[0].name = "Heraldry";
			builder._loreSkillAllocation.skills[1].name = "Architecture";
			builder._loreSkillAllocation.skills[2].name = "Planar Geography";
			builder._applyLoreSkillAllocation();

			const lore = builder._state.getLoreSkills().sort((a, b) => a.name.localeCompare(b.name));
			expect(lore).toHaveLength(3);
			expect(lore.map(s => s.name)).toEqual(["Architecture", "Heraldry", "Planar Geography"]);
			lore.forEach(s => {
				expect(s.bonus).toBe(2);
				expect(s.isLoreSkill).toBe(true);
				expect(s.ability).toBeNull();
			});
		});

		it("applies preset 'two' with +2 / +4 bonuses", () => {
			const builder = makeBuilder();
			builder._renderLoreSkillSlots = () => {};
			builder._setLoreSkillPreset("two");
			builder._loreSkillAllocation.skills[0].name = "Heraldry";
			builder._loreSkillAllocation.skills[1].name = "Architecture";
			builder._applyLoreSkillAllocation();

			const heraldry = builder._state.getLoreSkills().find(s => s.name === "Heraldry");
			const architecture = builder._state.getLoreSkills().find(s => s.name === "Architecture");
			expect(heraldry.bonus).toBe(2);
			expect(architecture.bonus).toBe(4);
		});

		it("empty allocation adds nothing", () => {
			const builder = makeBuilder();
			builder._applyLoreSkillAllocation();
			expect(builder._state.getLoreSkills()).toHaveLength(0);
		});

		it("re-applying with changed names removes stale lore skills", () => {
			const builder = makeBuilder();
			builder._loreSkillAllocation.skills[0].name = "Heraldry";
			builder._loreSkillAllocation.skills[1].name = "Architecture";
			builder._applyLoreSkillAllocation();
			expect(builder._state.getLoreSkills().map(s => s.name).sort()).toEqual(["Architecture", "Heraldry"]);

			// User edits step 4 again — drops Architecture, adds Planar Geography
			builder._loreSkillAllocation.skills[1].name = "Planar Geography";
			builder._applyLoreSkillAllocation();
			expect(builder._state.getLoreSkills().map(s => s.name).sort()).toEqual(["Heraldry", "Planar Geography"]);
		});
	});
});
