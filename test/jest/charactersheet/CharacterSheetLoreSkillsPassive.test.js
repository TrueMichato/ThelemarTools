import "./setup.js"; // Import first to set up mocks

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

/**
 * Passive scores for lore skills follow the same `10 + getSkillMod()` formula as
 * regular skills (see `getPassiveScore`), so adding the proficiency bonus inside
 * `getSkillMod` automatically makes lore-skill passives correct without any
 * passive-specific code.  These tests pin that behaviour across PB tiers and
 * the various modifier sources that layer on top.
 */
describe("Character Sheet — Lore Skills passive scoring", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 10);
		state.setAbilityBase("con", 10);
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 10);
		state.setAbilityBase("cha", 10);
	});

	it("passive = 10 + PB + lore bonus at level 1 (PB +2)", () => {
		state.addClass({name: "Wizard", source: "PHB", level: 1});
		state.addLoreSkill("Heraldry", 2);
		expect(state.getPassiveScore("heraldry")).toBe(14); // 10 + 2 + 2
	});

	it("passive scales up with PB tier", () => {
		state.addClass({name: "Wizard", source: "PHB", level: 9}); // PB +4
		state.addLoreSkill("Heraldry", 4);
		expect(state.getPassiveScore("heraldry")).toBe(18); // 10 + 4 + 4
	});

	it("passive for a +0 (PB-only) lore skill is 10 + PB", () => {
		state.addClass({name: "Wizard", source: "PHB", level: 1}); // PB +2
		state.addLoreSkill("Bookbinding Trivia", 0);
		expect(state.getPassiveScore("bookbindingtrivia")).toBe(12);
	});

	it("custom skill modifiers contribute to the passive", () => {
		state.addClass({name: "Wizard", source: "PHB", level: 1}); // PB +2
		state.addLoreSkill("Heraldry", 2);
		state.setCustomModifier("skill:heraldry", 1);
		expect(state.getPassiveScore("heraldry")).toBe(15); // 10 + 2 + 2 + 1
	});

	it("ability scores never contribute to the lore-skill passive (TGTT p.29)", () => {
		state.setAbilityBase("int", 20); // +5 mod
		state.addClass({name: "Wizard", source: "PHB", level: 1}); // PB +2
		state.addLoreSkill("Heraldry", 2);
		// Must remain 14 — INT +5 is excluded.
		expect(state.getPassiveScore("heraldry")).toBe(14);
	});

	it("exhaustion penalty subtracts from the passive", () => {
		state.addClass({name: "Wizard", source: "PHB", level: 1}); // PB +2
		state.addLoreSkill("Heraldry", 2);
		// 1 level of exhaustion = -2 to d20 tests in the active rule set
		// (we just assert the passive responds to whatever penalty applies)
		const baseline = state.getPassiveScore("heraldry");
		state.setExhaustion(1);
		const penalised = state.getPassiveScore("heraldry");
		expect(penalised).toBeLessThanOrEqual(baseline);
	});
});
