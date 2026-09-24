import "./setup.js"; // Import first to set up mocks

let CharacterSheetState;
let state;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

describe("Character Sheet — Lore Skills (TGTT variant rule)", () => {
	beforeEach(() => {
		state = new CharacterSheetState();
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 10);
		state.setAbilityBase("con", 10);
		state.setAbilityBase("int", 10);
		state.setAbilityBase("wis", 10);
		state.setAbilityBase("cha", 10);
	});

	describe("addLoreSkill / data shape", () => {
		it("creates a skill with isLoreSkill, ability:null, default bonus 2, and an empty source note", () => {
			state.addLoreSkill("Heraldry");
			const lore = state.getLoreSkills();
			expect(lore).toHaveLength(1);
			expect(lore[0]).toMatchObject({
				name: "Heraldry",
				isLoreSkill: true,
				ability: null,
				bonus: 2,
				note: "",
			});
		});

		describe("setLoreSkillNote", () => {
			it("edits and clears multiline plain text without changing the name or roll bonus", () => {
				state.addClass({name: "Wizard", source: "PHB", level: 1});
				state.addLoreSkill("Heraldry", 4);
				const before = state.getSkillMod("heraldry");

				expect(state.setLoreSkillNote("HERALDRY", "Granted by background\nStudied in the library")).toBe(true);
				expect(state.getLoreSkills()[0]).toMatchObject({
					name: "Heraldry",
					bonus: 4,
					note: "Granted by background\nStudied in the library",
				});
				expect(state.getSkillMod("heraldry")).toBe(before);
				expect(state.setLoreSkillNote("Heraldry", "  ")).toBe(true);
				expect(state.getLoreSkills()[0].note).toBe("");
				expect(state.getSkillMod("heraldry")).toBe(before);
			});

			it("changes only the named Lore skill and rejects invalid input", () => {
				state.addLoreSkill("Heraldry", 2);
				state.addLoreSkill("Planar Geography", 4);
				expect(state.setLoreSkillNote("Heraldry", "From my background")).toBe(true);
				expect(state.getLoreSkills().map(s => s.note)).toEqual(["From my background", ""]);
				expect(state.setLoreSkillNote("Missing", "From a book")).toBe(false);
				expect(() => state.setLoreSkillNote("Heraldry", {html: "<b>unsafe</b>"})).toThrow(TypeError);
				expect(state.getLoreSkills().map(s => s.note)).toEqual(["From my background", ""]);
			});
		});

		it("respects an explicit bonus arg", () => {
			state.addLoreSkill("Engineering Principles", 4);
			const entry = state.getLoreSkills().find(s => s.name === "Engineering Principles");
			expect(entry.bonus).toBe(4);
		});

		it("rejects duplicates against existing custom/lore skill names (case-insensitive)", () => {
			state.addLoreSkill("Heraldry", 2);
			state.addLoreSkill("HERALDRY", 4);
			const lore = state.getLoreSkills();
			expect(lore).toHaveLength(1);
			expect(lore[0].bonus).toBe(2);
		});
	});

	describe("setLoreSkillBonus / incrementLoreSkillBonus", () => {
		it("setLoreSkillBonus overwrites the bonus", () => {
			state.addLoreSkill("Heraldry", 2);
			state.setLoreSkillBonus("Heraldry", 6);
			expect(state.getLoreSkills()[0].bonus).toBe(6);
		});

		it("incrementLoreSkillBonus adds the delta", () => {
			state.addLoreSkill("Heraldry", 2);
			state.incrementLoreSkillBonus("Heraldry", 2);
			expect(state.getLoreSkills()[0].bonus).toBe(4);
			state.incrementLoreSkillBonus("Heraldry", -2);
			expect(state.getLoreSkills()[0].bonus).toBe(2);
		});
	});

	describe("removeLoreSkill", () => {
		it("removes the lore-skill entry", () => {
			state.addLoreSkill("Heraldry");
			state.addLoreSkill("Planar Geography");
			state.removeLoreSkill("Heraldry");
			const lore = state.getLoreSkills();
			expect(lore).toHaveLength(1);
			expect(lore[0].name).toBe("Planar Geography");
		});
	});

	describe("getSkillMod short-circuit (PB + flat lore bonus, no ability)", () => {
		it("scales the lore-skill total with proficiency-bonus tier (TGTT p.29)", () => {
			state.addLoreSkill("Heraldry", 4);
			// Level 1 → PB +2 → total +6
			state.addClass({name: "Wizard", source: "PHB", level: 1});
			expect(state.getSkillMod("heraldry")).toBe(6);
			// Level 5 → PB +3 → total +7
			state.removeClass("Wizard", "PHB");
			state.addClass({name: "Wizard", source: "PHB", level: 5});
			expect(state.getSkillMod("heraldry")).toBe(7);
			// Level 9 → PB +4 → total +8
			state.removeClass("Wizard", "PHB");
			state.addClass({name: "Wizard", source: "PHB", level: 9});
			expect(state.getSkillMod("heraldry")).toBe(8);
		});

		it("supports a +0 (PB-only) lore skill", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 1}); // PB +2
			state.addLoreSkill("Bookbinding Trivia", 0);
			expect(state.getSkillMod("bookbindingtrivia")).toBe(2);
		});

		it("ignores ability scores entirely (INT 20 must not boost a lore skill)", () => {
			state.setAbilityBase("int", 20);
			state.addClass({name: "Wizard", source: "PHB", level: 1}); // PB +2
			state.addLoreSkill("Heraldry", 2);
			// PB +2 + lore +2 = +4. INT mod (+5) must NOT contribute.
			expect(state.getSkillMod("heraldry")).toBe(4);
		});
	});

	describe("getSkillBreakdown short-circuit", () => {
		it("includes proficiency + lore components (no ability)", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 1}); // PB +2
			state.addLoreSkill("Heraldry", 4);
			const bd = state.getSkillBreakdown("heraldry");
			expect(bd.total).toBe(6);
			expect(bd.ability).toBeNull();
			const types = bd.components.map(c => c.type);
			expect(types).toContain("proficiency");
			expect(types).toContain("lore");
			expect(types).not.toContain("ability");
			expect(bd.components.find(c => c.type === "proficiency").value).toBe(2);
			expect(bd.components.find(c => c.type === "lore").value).toBe(4);
		});

		it("omits the lore component for a +0 (PB-only) lore skill", () => {
			state.addClass({name: "Wizard", source: "PHB", level: 1}); // PB +2
			state.addLoreSkill("Bookbinding Trivia", 0);
			const bd = state.getSkillBreakdown("bookbindingtrivia");
			expect(bd.total).toBe(2);
			const types = bd.components.map(c => c.type);
			expect(types).toEqual(["proficiency"]);
		});
	});

	describe("save / load round-trip", () => {
		it("preserves isLoreSkill + bonus across toJson/loadFromJson", () => {
			state.addLoreSkill("Heraldry", 4);
			state.addLoreSkill("Planar Geography", 2);
			const json = state.toJson();

			const fresh = new CharacterSheetState();
			fresh.loadFromJson(json);
			const lore = fresh.getLoreSkills().sort((a, b) => a.name.localeCompare(b.name));
			expect(lore).toHaveLength(2);
			expect(lore[0]).toMatchObject({name: "Heraldry", isLoreSkill: true, bonus: 4, ability: null});
			expect(lore[1]).toMatchObject({name: "Planar Geography", isLoreSkill: true, bonus: 2, ability: null});
			// PB +2 (default for level-0/1 state) + lore +4 = +6
			expect(fresh.getSkillMod("heraldry")).toBe(6);
		});

		it("persists an edited source note and a second blank note independently", () => {
			state.addLoreSkill("Heraldry", 4);
			state.addLoreSkill("Planar Geography", 2);
			state.setLoreSkillNote("Heraldry", "Granted by a feat\nLearned from a tutor");
			const fresh = new CharacterSheetState();
			fresh.loadFromJson(state.toJson());

			expect(fresh.getLoreSkills().map(s => s.note)).toEqual(["Granted by a feat\nLearned from a tutor", ""]);
			fresh.setLoreSkillNote("Heraldry", "");
			expect(fresh.toJson().customSkills.map(s => s.note)).toEqual(["", ""]);
		});

		it("loads pre-note Lore skills with a blank note without inventing an origin", () => {
			const fresh = new CharacterSheetState();
			fresh.loadFromJson({
				customSkills: [
					{name: "Heraldry", ability: null, isLoreSkill: true, bonus: 2},
					{name: "Planar Geography", ability: null, isLoreSkill: true, bonus: 4, note: "Granted by a book"},
				],
			});
			expect(fresh.getLoreSkills().map(s => s.note)).toEqual(["", "Granted by a book"]);
			expect(fresh.toJson().customSkills[0].note).toBe("");
		});
	});

	describe("_migrateLoreSkills (legacy → new shape)", () => {
		it("converts legacy WIS-ability custom skills paired with a Lore Mastery skill modifier", () => {
			// Build a legacy save: customSkills had {ability:"wis"} entries plus a paired
			// named modifier of type skill:<key> with note mentioning Lore Mastery.
			const legacyJson = {
				version: 1,
				abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
				customSkills: [{name: "Heraldry", ability: "wis"}],
				namedModifiers: [
					{
						id: "legacy-mod-1",
						name: "Lore Mastery: Heraldry",
						type: "skill:heraldry",
						value: 2,
						source: "feat",
						note: "Lore Mastery",
					},
				],
				skillProficiencies: {heraldry: 0},
			};

			const fresh = new CharacterSheetState();
			fresh.loadFromJson(legacyJson);
			const lore = fresh.getLoreSkills();
			expect(lore).toHaveLength(1);
			expect(lore[0]).toMatchObject({name: "Heraldry", isLoreSkill: true, ability: null, bonus: 2, note: ""});
			// Legacy modifier removed
			expect(fresh.getNamedModifiersByType("skill:heraldry").length).toBe(0);
			// Proficient flag set so the row will roll cleanly
			expect(fresh.getSkillProficiency("heraldry")).toBe(1);
		});

		it("is idempotent — running migrate twice does not double-up", () => {
			const legacyJson = {
				abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
				customSkills: [{name: "Heraldry", ability: "wis"}],
				namedModifiers: [
					{id: "x", name: "Lore Mastery: Heraldry", type: "skill:heraldry", value: 2, source: "feat", note: "Lore Mastery"},
				],
			};
			const fresh = new CharacterSheetState();
			fresh.loadFromJson(legacyJson);
			// Re-run by saving + reloading
			const json2 = fresh.toJson();
			const fresh2 = new CharacterSheetState();
			fresh2.loadFromJson(json2);
			expect(fresh2.getLoreSkills()).toHaveLength(1);
			expect(fresh2.getLoreSkills()[0].bonus).toBe(2);
		});
	});
});
