import "./setup.js";

let CharacterSheetState;
let CharacterSheetPdf;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetPdf = (await import("../../../js/charactersheet/charactersheet-pdf.js")).CharacterSheetPdf;
});

describe("CharacterSheetPdf", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	// ===================================================================
	// Core generate() API
	// ===================================================================
	describe("generate()", () => {
		test("should return a complete HTML document string", () => {
			const pdf = new CharacterSheetPdf(state);
			const html = pdf.generate();

			expect(html).toContain("<!DOCTYPE html>");
			expect(html).toContain("</html>");
			expect(html).toContain("<style>");
			expect(html).toContain("</style>");
		});

		test("should include the character name in the title", () => {
			state._data.name = "Aragorn";
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("<title>Aragorn");
		});

		test("should not throw for a default empty character", () => {
			expect(() => new CharacterSheetPdf(state).generate()).not.toThrow();
		});
	});

	// ===================================================================
	// Header Section
	// ===================================================================
	describe("Header", () => {
		test("should render character name", () => {
			state._data.name = "Gandalf";
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Gandalf");
		});

		test("should render class and level", () => {
			state._data.classes = [{name: "Wizard", source: "PHB", level: 10, subclass: {name: "School of Evocation", source: "PHB"}}];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Wizard");
			expect(html).toContain("School of Evocation");
			expect(html).toContain("10");
		});

		test("should render multiclass info", () => {
			state._data.classes = [
				{name: "Fighter", source: "PHB", level: 5, subclass: {name: "Champion", source: "PHB"}},
				{name: "Rogue", source: "PHB", level: 3, subclass: {name: "Thief", source: "PHB"}},
			];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Fighter");
			expect(html).toContain("Rogue");
		});

		test("should render proficiency bonus", () => {
			state._data.classes = [{name: "Fighter", source: "PHB", level: 5}];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("+3"); // Level 5 = +3 prof bonus
		});
	});

	// ===================================================================
	// Ability Scores
	// ===================================================================
	describe("Ability Scores", () => {
		test("should render all six ability scores", () => {
			state._data.abilities = {str: 16, dex: 14, con: 12, int: 10, wis: 8, cha: 13};
			const html = new CharacterSheetPdf(state).generate();

			expect(html).toContain("Strength");
			expect(html).toContain("Dexterity");
			expect(html).toContain("Constitution");
			expect(html).toContain("Intelligence");
			expect(html).toContain("Wisdom");
			expect(html).toContain("Charisma");
		});

		test("should render correct modifiers", () => {
			state._data.abilities = {str: 16, dex: 14, con: 12, int: 10, wis: 8, cha: 13};
			const html = new CharacterSheetPdf(state).generate();

			// STR 16 = +3
			expect(html).toContain("+3");
			// WIS 8 = -1
			expect(html).toContain("-1");
		});
	});

	// ===================================================================
	// Combat Stats
	// ===================================================================
	describe("Combat Stats", () => {
		test("should render AC", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Armor Class");
		});

		test("should render HP", () => {
			state._data.hp = {current: 25, max: 40, temp: 5};
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("25");
			expect(html).toContain("40");
			expect(html).toContain("+5 temp");
		});

		test("should render initiative", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Initiative");
		});

		test("should render speed", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Speed");
		});

		test("should render exhaustion pips", () => {
			state._data.exhaustion = 3;
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Exhaustion");
			// 3 filled, 3 empty for classic (6 total)
			expect(html).toContain("●●●○○○");
		});
	});

	// ===================================================================
	// Saving Throws
	// ===================================================================
	describe("Saving Throws", () => {
		test("should render all six saves", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Saving Throws");
			expect(html).toContain("Strength");
			expect(html).toContain("Charisma");
		});

		test("should mark proficient saves with filled dot", () => {
			state._data.saveProficiencies = ["str", "con"];
			const html = new CharacterSheetPdf(state).generate();
			// Saving throws section should contain ● for proficient saves
			expect(html).toContain("●");
			expect(html).toContain("○");
		});
	});

	// ===================================================================
	// Skills
	// ===================================================================
	describe("Skills", () => {
		test("should render all 18 skills", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Acrobatics");
			expect(html).toContain("Perception");
			expect(html).toContain("Stealth");
			expect(html).toContain("Survival");
		});

		test("should mark expertise with diamond", () => {
			state._data.skillProficiencies = {stealth: 2};
			const html = new CharacterSheetPdf(state).generate();
			// Expertise should use ◆
			expect(html).toContain("◆");
		});

		test("should include TGTT homebrew skills when character has proficiency", () => {
			state._data.skillProficiencies = {might: 1, endurance: 1, engineering: 1, linguistics: 1};
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Might");
			expect(html).toContain("Endurance");
			expect(html).toContain("Engineering");
			expect(html).toContain("Linguistics");
		});

		test("should not show TGTT homebrew skills without proficiency", () => {
			// Default state has no TGTT skill proficiencies
			state._data.skillProficiencies = {};
			const html = new CharacterSheetPdf(state).generate();
			expect(html).not.toContain("Might");
			expect(html).not.toContain("Endurance");
		});

		test("should strip |source suffix from proficiency keys", () => {
			state._data.skillProficiencies = {"culture|tgtt": 1, "might|tgtt": 1};
			const html = new CharacterSheetPdf(state).generate();
			// Should show clean names, not suffixed keys
			expect(html).not.toContain("culture|tgtt");
			expect(html).not.toContain("might|tgtt");
			expect(html).not.toContain("|tgtt");
			// Should show discovered proficient skills
			expect(html).toContain("Culture");
			expect(html).toContain("Might");
		});

		test("should use skillsList abilities when provided", () => {
			state._data.skillProficiencies = {"culture|tgtt": 1};
			const skillsList = [
				{name: "Acrobatics", ability: "dex"},
				{name: "Culture", ability: "wis"},
			];
			const html = new CharacterSheetPdf(state, {skillsList}).generate();
			// Culture should use WIS from skillsList
			expect(html).toContain("Culture");
			expect(html).toContain("(WIS)");
			// Should show proficiency dot for culture (● = proficient)
			const cultureSection = html.split("Culture")[0].split("pdf-skill-row").pop();
			expect(cultureSection).toContain("\u25CF");
		});
	});

	// ===================================================================
	// Senses
	// ===================================================================
	describe("Senses", () => {
		test("should not render senses section without special senses", () => {
			const html = new CharacterSheetPdf(state).generate();
			// Senses section title should not appear in the body when no special senses
			const bodyContent = html.split("<body>")[1] || "";
			expect(bodyContent).not.toContain(">Senses<");
		});

		test("should render darkvision when present", () => {
			state._data.senses = {darkvision: 60};
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Darkvision");
			expect(html).toContain("60 ft.");
		});

		test("should render passive scores inline with skills", () => {
			const html = new CharacterSheetPdf(state).generate();
			// Passive scores should appear as badges next to Perception, Investigation, Insight
			expect(html).toContain("pdf-skill__passive");
		});
	});

	// ===================================================================
	// Defenses (conditional)
	// ===================================================================
	describe("Defenses", () => {
		test("should not render defenses section when empty", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).not.toContain("Defenses");
		});

		test("should render resistances when present", () => {
			state._data.resistances = ["fire", "cold"];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Resistances");
			expect(html).toContain("fire");
			expect(html).toContain("cold");
		});
	});

	// ===================================================================
	// Attacks
	// ===================================================================
	describe("Attacks", () => {
		test("should not render attacks section when empty", () => {
			const html = new CharacterSheetPdf(state).generate();
			// No attack table rows should be rendered
			expect(html).not.toContain("pdf-atk__name");
		});

		test("should render attack rows", () => {
			state._data.attacks = [
				{id: "a1", name: "Longsword", bonus: 5, damage: "1d8+3", damageType: "slashing", range: "5 ft."},
			];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Longsword");
			expect(html).toContain("+5");
			expect(html).toContain("1d8+3");
			expect(html).toContain("slashing");
		});
	});

	// ===================================================================
	// Features
	// ===================================================================
	describe("Features", () => {
		test("should not render features section when empty", () => {
			state._data.features = [];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).not.toContain("Features &amp; Traits");
		});

		test("should render features grouped by type with proper ordering", () => {
			state._data.features = [
				{name: "Second Wind", featureType: "Class", className: "Fighter", level: 1, uses: {current: 1, max: 1, recharge: "short rest"}},
				{name: "Darkvision", featureType: "Race"},
			];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Second Wind");
			expect(html).toContain("Darkvision");
			expect(html).toContain("1/1");
			// Race should appear before Class features
			const raceIdx = html.indexOf("Darkvision");
			const classIdx = html.indexOf("Second Wind");
			expect(raceIdx).toBeLessThan(classIdx);
		});

		test("should clean rendered HTML from feature descriptions", () => {
			state._data.features = [
				{name: "Test Feature", description: '<div class="rd__b"><p>Deal <span class="roller">2d6</span> fire damage with <a href="spells.html">fireball</a>.</p></div>'},
			];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("2d6");
			expect(html).toContain("fireball");
			expect(html).not.toContain('class="rd__b"');
			expect(html).not.toContain('<a href');
		});
	});

	// ===================================================================
	// Spellcasting
	// ===================================================================
	describe("Spellcasting", () => {
		test("should not render spellcasting section header when no spells", () => {
			const html = new CharacterSheetPdf(state).generate();
			// Should not have the spellcasting section title in the body
			expect(html).not.toContain("pdf-section--spells");
		});

		test("should render spellcasting with cantrips and spell list", () => {
			state._data.spellcasting = {
				ability: "int",
				spellSlots: {1: {current: 4, max: 4}, 2: {current: 3, max: 3}},
				cantripsKnown: [
					{name: "Fire Bolt", school: "V", time: "1 action", range: "120 ft.", components: "V, S"},
				],
				spellsKnown: [
					{name: "Shield", level: 1, school: "A", time: "1 reaction", range: "Self", components: "V, S"},
					{name: "Magic Missile", level: 1, school: "V", time: "1 action", range: "120 ft.", components: "V, S"},
				],
				innateSpells: [],
			};
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Spellcasting");
			expect(html).toContain("Fire Bolt");
			expect(html).toContain("Shield");
			expect(html).toContain("Magic Missile");
			expect(html).toContain("Spell Save DC");
			expect(html).toContain("Spell Attack");
		});

		test("should render spell slots as pips", () => {
			state._data.spellcasting = {
				ability: "wis",
				spellSlots: {1: {current: 2, max: 4}},
				cantripsKnown: [],
				spellsKnown: [{name: "Cure Wounds", level: 1, school: "V"}],
				innateSpells: [],
			};
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Spell Slots");
			expect(html).toContain("●●○○"); // 2 used out of 4
		});
	});

	// ===================================================================
	// Inventory
	// ===================================================================
	describe("Inventory", () => {
		test("should not render inventory when empty", () => {
			state._data.inventory = [];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).not.toContain("Equipment");
		});

		test("should render inventory items", () => {
			state._data.inventory = [
				{id: "i1", item: {name: "Chain Mail"}, quantity: 1, equipped: true, attuned: false},
				{id: "i2", item: {name: "Healing Potion"}, quantity: 3, equipped: false, attuned: false},
			];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Chain Mail");
			expect(html).toContain("Healing Potion");
			expect(html).toContain("3"); // qty
		});

		test("should render currency", () => {
			state._data.currency = {gp: 150, sp: 30, cp: 0, ep: 0, pp: 5};
			state._data.inventory = [{id: "i1", item: {name: "Rope"}, quantity: 1}];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("150 GP");
			expect(html).toContain("30 SP");
			expect(html).toContain("5 PP");
		});
	});

	// ===================================================================
	// TGTT Sections (conditional)
	// ===================================================================
	describe("TGTT Combat Traditions", () => {
		test("should not render TGTT sections when no traditions present", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).not.toContain("Thelemar Homebrew");
			expect(html).not.toContain("Combat Traditions");
		});

		test("should render combat traditions when present", () => {
			state._data.combatTraditions = [
				{code: "TI", name: "Tempered Iron"},
				{code: "GH", name: "Gallant Heart"},
			];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Thelemar Homebrew");
			expect(html).toContain("Combat Traditions");
			expect(html).toContain("Tempered Iron");
			expect(html).toContain("Gallant Heart");
		});

		test("should render exertion pool when traditions exist", () => {
			state._data.combatTraditions = [{code: "TI", name: "Tempered Iron"}];
			state._data.exertionMax = 6;
			state._data.exertionCurrent = 4;
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Exertion");
			// 4 filled, 2 empty
			expect(html).toContain("●●●●○○");
		});
	});

	describe("TGTT Dreamwalker", () => {
		test("should not render dreamwalker when no focus pool", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).not.toContain("Dreamwalker");
		});

		test("should render dreamwalker when character has Dreamwalker class", () => {
			state._data.classes = [{name: "Dreamwalker", source: "TGTT", level: 5}];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Dreamwalker");
			expect(html).toContain("Focus Pool");
			expect(html).toContain("Dream DC");
		});
	});

	describe("TGTT Primal Focus", () => {
		test("should not render primal focus for non-TGTT rangers", () => {
			state._data.classes = [{name: "Ranger", source: "PHB", level: 3}];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).not.toContain("Primal Focus");
		});
	});

	// ===================================================================
	// Companions (conditional)
	// ===================================================================
	describe("Companions", () => {
		test("should not render companions when none exist", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).not.toContain("pdf-section--companions");
		});

		test("should render companion statblock when present", () => {
			state._data.companions = [{
				id: "c1",
				name: "Shadow",
				creatureType: "beast",
				size: "M",
				ac: 13,
				hp: {max: 11, current: 11},
				speed: {walk: 40},
				abilities: {str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6},
				traits: [{name: "Keen Hearing and Smell", description: "Advantage on Perception checks using hearing or smell."}],
				actions: [{name: "Bite", description: "Melee Weapon Attack: +4 to hit, 2d4+2 piercing."}],
			}];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Companions");
			expect(html).toContain("Shadow");
			expect(html).toContain("beast");
			expect(html).toContain("Keen Hearing and Smell");
			expect(html).toContain("Bite");
		});
	});

	// ===================================================================
	// Utility Methods
	// ===================================================================
	describe("Utility Methods", () => {
		test("should escape HTML entities in character name", () => {
			state._data.name = "Tom & Jerry <b>Bold</b>";
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Tom &amp; Jerry &lt;b&gt;Bold&lt;/b&gt;");
		});

		test("should format positive modifiers with +", () => {
			state._data.abilities = {str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10};
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("+3");
		});

		test("should format negative modifiers correctly", () => {
			state._data.abilities = {str: 8, dex: 10, con: 10, int: 10, wis: 10, cha: 10};
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("-1");
		});

		test("should strip @tags from feature descriptions", () => {
			state._data.features = [
				{name: "Test Feature", description: "Deal {@damage 2d6} fire damage with {@spell fireball}."},
			];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("2d6");
			expect(html).toContain("fireball");
			expect(html).not.toContain("{@damage");
			expect(html).not.toContain("{@spell");
		});

		test("should strip [-] and [\u2013] collapsible markers from descriptions", () => {
			state._data.features = [
				{name: "Combat Methods", description: "Exertion Pool[\u2013]\nYour exertion pool equals twice your proficiency bonus. Method DC[-]\nYour Method DC equals 8 + prof."},
			];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Exertion Pool");
			expect(html).toContain("Method DC");
			expect(html).not.toContain("[\u2013]");
			expect(html).not.toContain("[-]");
		});

		test("should preserve tables in feature descriptions", () => {
			state._data.features = [
				{name: "Gambler's Tools", description: '<table><tr><th>Name</th><th>Damage</th></tr><tr><td>Coins</td><td>1d4 Piercing</td></tr></table>'},
			];
			const html = new CharacterSheetPdf(state).generate();
			// Should render as a proper table, not flattened text
			expect(html).toContain("pdf-table--inline");
			expect(html).toContain("<th>");
			expect(html).toContain("Coins");
			expect(html).toContain("1d4 Piercing");
		});

		test("should exclude combat methods from features (render under TGTT)", () => {
			state._data.features = [
				{name: "Sneak Attack", featureType: "Class", className: "Rogue", level: 1},
				{name: "Farshot Stance", featureType: "Optional Feature", optionalFeatureTypes: ["CTM:1AM"]},
			];
			state._data.combatTraditions = [{code: "AM", name: "Adamant Mountain"}];
			const html = new CharacterSheetPdf(state).generate();
			// Features section should NOT contain "Optional Feature" group (Farshot Stance was filtered out)
			const featuresSection = html.split("Features &amp; Traits")[1]?.split("Thelemar Homebrew")[0] || "";
			expect(featuresSection).not.toContain("Farshot Stance");
			// But should appear under TGTT Combat Traditions > Methods
			const tgttSection = html.split("Thelemar Homebrew")[1] || "";
			expect(tgttSection).toContain("Farshot Stance");
			expect(tgttSection).toContain("Methods");
		});

		test("should handle subclass as string for backwards compatibility", () => {
			state._data.classes = [{name: "Fighter", source: "PHB", level: 5, subclass: "Champion"}];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Champion");
			expect(html).not.toContain("[object Object]");
		});

		test("should strip pipe-source from language names", () => {
			state._data.languages = ["Common", "Mictlanian|Tgtt", "Elvish"];
			state._data.armorProficiencies = ["light"];
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Mictlanian");
			expect(html).not.toContain("Mictlanian|Tgtt");
		});
	});

	// ===================================================================
	// Carry Weight & Jump
	// ===================================================================
	describe("Carry Weight & Jump Distances", () => {
		test("should render carrying capacity", () => {
			state._data.abilities = {str: 15, dex: 10, con: 10, int: 10, wis: 10, cha: 10};
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Carry");
			expect(html).toContain("lb.");
		});

		test("should render jump distances", () => {
			state._data.abilities = {str: 15, dex: 10, con: 10, int: 10, wis: 10, cha: 10};
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Long Jump");
			expect(html).toContain("High Jump");
		});

		test("should use Thelemar athletics-based jump when setting enabled", () => {
			state._data.abilities = {str: 8, dex: 13, con: 14, int: 15, wis: 11, cha: 12};
			state._data.skillProficiencies = {athletics: 1};
			state._data.classes = [{name: "Rogue", source: "PHB", level: 3}];
			// Thelemar jumping defaults to true
			// Athletics mod: STR -1 + prof +2 = +1
			// Long jump = 8 + 1 = 9
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("9 ft."); // 8 + athletics (+1)
		});
	});

	// ===================================================================
	// CSS Inclusion
	// ===================================================================
	describe("CSS", () => {
		test("should include all critical CSS classes", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain(".pdf-header");
			expect(html).toContain(".pdf-ability");
			expect(html).toContain(".pdf-section__title");
			expect(html).toContain("@page");
		});

		test("should include TGTT-specific CSS classes", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain(".pdf-tgtt-wrapper");
			expect(html).toContain(".pdf-section__title--tgtt");
		});

		test("should include parchment background color", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("#fdf1dc");
		});

		test("should include maroon accent color", () => {
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("#58180d");
		});
	});

	// ===================================================================
	// Edge Cases
	// ===================================================================
	describe("Edge Cases", () => {
		test("should handle level 20 character with all fields populated", () => {
			state._data.name = "Epic Hero";
			state._data.classes = [{name: "Paladin", source: "PHB", level: 20, subclass: {name: "Oath of Devotion", source: "PHB"}}];
			state._data.abilities = {str: 20, dex: 14, con: 16, int: 10, wis: 13, cha: 18};
			state._data.hp = {current: 180, max: 180, temp: 0};
			state._data.attacks = [{id: "a1", name: "Holy Avenger", bonus: 11, damage: "2d6+7", damageType: "radiant"}];
			state._data.features = [{name: "Divine Smite", featureType: "Class", level: 2}];
			state._data.inventory = [{id: "i1", item: {name: "Holy Avenger"}, quantity: 1, equipped: true, attuned: true}];
			state._data.resistances = ["necrotic"];
			state._data.conditionImmunities = ["frightened"];

			expect(() => new CharacterSheetPdf(state).generate()).not.toThrow();
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Epic Hero");
			expect(html).toContain("Holy Avenger");
		});

		test("should handle character with no name gracefully", () => {
			state._data.name = "";
			const html = new CharacterSheetPdf(state).generate();
			expect(html).toContain("Unnamed Character");
		});
	});
});
