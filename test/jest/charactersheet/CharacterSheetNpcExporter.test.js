import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetNpcExporter} from "../../../js/charactersheet/charactersheet-npc-exporter.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("CharacterSheetNpcExporter", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.setName("Aelar");
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAlignment("NG");
		state.setAbilityBase("str", 16);
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("con", 14);
		state.setAbilityBase("int", 12);
		state.setAbilityBase("wis", 10);
		state.setAbilityBase("cha", 8);
		state.setMaxHp(44);
		state.setCurrentHp(44);
		state.setArmor({name: "Chain Mail", ac: 16, type: "heavy"});
		state.addLanguage("Common");
		state.addLanguage("Elvish");
		state.addSaveProficiency("str");
		state.addSaveProficiency("con");
		state.setSkillProficiency("athletics", 1);
		state.setSkillProficiency("perception", 1);

		state.addAttack({
			name: "Longsword",
			isMelee: true,
			attackBonus: 6,
			damage: "1d8+3",
			damageType: "slashing",
			range: "reach 5 ft., one target",
		});
	});

	it("should convert a character state to bestiary-compatible NPC JSON", () => {
		const out = CharacterSheetNpcExporter.convertStateToMonster(state);

		expect(out.name).toBe("Aelar (NPC)");
		expect(out.source).toBe("CSHEET");
		expect(out.size).toEqual(["M"]);
		expect(out.type).toEqual({type: "humanoid"});
		expect(out.alignment).toEqual(["N", "G"]);
		expect(out.ac[0].ac).toBe(16);
		expect(out.hp.average).toBe(44);
		expect(out.str).toBe(16);
		expect(out.dex).toBe(14);
		expect(out.con).toBe(14);
		expect(out.languages).toContain("Common");
		expect(out.languages).toContain("Elvish");
		expect(out.save.str).toMatch(/^\+/);
		expect(out.skill.athletics).toMatch(/^\+/);
		expect(out.trait.some(t => t.name === "Level Signal")).toBe(true);
		expect(Array.isArray(out.action)).toBe(true);
		expect(out.action.some(a => a.name === "Longsword")).toBe(true);
		expect(out.cr).toBeDefined();
	});

	it("should include spellcasting tiers when the character has spells", () => {
		state.setSpellcastingAbility("int");
		state.setSpellSlots(1, 4, 4);
		state.setSpellSlots(2, 2, 2);
		state.addCantrip({name: "fire bolt", source: "XPHB", level: 0, sourceClass: "Wizard"});
		state.addSpell({name: "shield", source: "XPHB", level: 1, sourceClass: "Wizard"}, true);
		state.addSpell({name: "sleep", source: "XPHB", level: 1, sourceClass: "Wizard"}, false);
		state.addSpell({name: "misty step", source: "XPHB", level: 2, sourceClass: "Wizard"}, true);

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);

		expect(out.spellcasting).toBeDefined();
		expect(out.spellcasting[0].type).toBe("spellcasting");
		expect(out.spellcasting[0].name).toBe("Spellcasting");
		expect(out.spellcasting[0].will.length).toBeGreaterThan(0);
		expect(out.spellcasting[0].spells[1].slots).toBe(4);
		expect(out.spellcasting[0].spells[2].slots).toBe(2);
		expect(out.spellcasting[0].spells[1].spells.some(s => s.includes("shield"))).toBe(true);
		expect(out.spellcasting[0].spells[1].spells.some(s => s.includes("sleep"))).toBe(true);
	});

	it("should include combat methods grouped by stamina cost", () => {
		state.addFeature({
			name: "Flowing Strike",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["CTM:2RC"],
			description: "As an Action (1 Stamina Point), make a quick strike.",
		});
		state.addFeature({
			name: "Rooted Stance",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["CTM:1AM"],
			description: "As a Bonus Action (0 Stamina Points), you enter a stance. This stance lasts until dismissed.",
		});
		state.addFeature({
			name: "Crushing Wave",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["CTM:3SM"],
			description: "As an Action (2 Stamina Points), force a Strength save.",
		});
		state.setStaminaMax(6);

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const methodsTrait = out.trait.find(t => t.name === "Combat Methods");

		expect(methodsTrait).toBeDefined();
		expect(methodsTrait.entries.join(" ")).toContain("Cost 0:");
		expect(methodsTrait.entries.join(" ")).toContain("Cost 1:");
		expect(methodsTrait.entries.join(" ")).toContain("Cost 2:");
		expect(methodsTrait.entries.join(" ")).toContain("Rooted Stance");
		expect(methodsTrait.entries.join(" ")).toContain("Flowing Strike");
		expect(methodsTrait.entries.join(" ")).toContain("Crushing Wave");
		expect(methodsTrait.entries.join(" ")).toContain("{@combatmethod");
		expect(methodsTrait.entries.join(" ")).toContain("save {@dc");

		const methodsText = methodsTrait.entries.join(" ");
		expect(methodsText.indexOf("Cost 0:")).toBeLessThan(methodsText.indexOf("Cost 1:"));
		expect(methodsText.indexOf("Cost 1:")).toBeLessThan(methodsText.indexOf("Cost 2:"));
		expect(methodsText).toContain("Rooted Stance|TGTT} (Bonus Action)");
		expect(methodsText).toContain("Flowing Strike|TGTT} (Action)");
	});

	it("should include weapon attacks derived from equipped inventory weapons", () => {
		const warrior = new CharacterSheetState();
		warrior.setName("Weapon Tester");
		warrior.addClass({name: "Fighter", source: "PHB", level: 5});
		warrior.setAbilityBase("str", 16);
		warrior.setAbilityBase("dex", 12);
		warrior.setWeaponMasteries(["Battleaxe|XPHB"]);
		warrior.addItem({
			name: "Battleaxe",
			source: "XPHB",
			dmg1: "1d8",
			dmgType: "slashing",
			range: "5 ft.",
			weaponCategory: "martial",
			type: "M",
			mastery: ["Topple|XPHB"],
			bonusWeapon: 1,
			bonusWeaponAttack: 1,
			equipped: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(warrior);
		expect(out.action.some(a => a.name === "Battleaxe")).toBe(true);
		const battleaxe = out.action.find(a => a.name === "Battleaxe");
		expect(battleaxe.entries[0]).toContain("{@hit +8}");
		expect(battleaxe.entries[0]).toContain("{@damage 1d8+4}");
		expect(battleaxe.entries[0]).toContain("Magic weapon (+2 attack, +1 damage)");
		expect(battleaxe.entries[0]).toContain("Mastery: {@itemMastery Topple|XPHB}");
	});

	it("should place magic items under special equipment and route uses by activation", () => {
		state.addItem({
			name: "Wand of Bolts",
			source: "XDMG",
			rarity: "rare",
			equipped: true,
			activation: [{type: "action", cost: 1}],
			charges: 7,
			chargesCurrent: 4,
			entries: ["As an action, you can expend 1 charge to cast a bolt."],
		});
		state.addItem({
			name: "Boots of Burst",
			source: "XDMG",
			requiresAttunement: true,
			attuned: true,
			equipped: true,
			activation: [{type: "bonus", cost: 1}],
			entries: ["As a bonus action, you can surge forward."],
		});
		state.addItem({
			name: "Ring of Riposte",
			source: "XDMG",
			requiresAttunement: true,
			attuned: true,
			equipped: true,
			activation: [{type: "reaction", cost: 1}],
			entries: ["As a reaction, gain +2 AC against one attack."],
		});
		state.setItemGrantedSpells?.([
			{name: "fireball", sourceItem: "Wand of Bolts", usageType: "charges", chargesCost: 3},
			{name: "shield", sourceItem: "Wand of Bolts", usageType: "rest", usesMax: 1, isEach: true},
		]);

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const specialEquipment = out.trait.find(t => t.name === "Special Equipment");
		expect(specialEquipment).toBeDefined();
		expect(specialEquipment.entries.join(" ")).toContain("Wand of Bolts");
		expect(specialEquipment.entries.join(" ")).toContain("Boots of Burst");
		expect(specialEquipment.entries.join(" ")).toContain("Ring of Riposte");

		expect(out.action.some(a => (a.name || "").includes("Wand of Bolts"))).toBe(true);
		expect((out.bonus || []).some(a => (a.name || "").includes("Boots of Burst"))).toBe(true);
		expect((out.reaction || []).some(a => (a.name || "").includes("Ring of Riposte"))).toBe(true);
		expect(out.action.some(a => (a.entries || []).join(" ").includes("1/rest each"))).toBe(true);
	});

	it("should export magic-item defenses in persistent mode", () => {
		state._data.itemDefenses = {
			resist: [{type: "fire"}],
			conditionImmune: [{type: "frightened"}],
		};

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect(out.resist || []).toContain("fire");
		expect(out.conditionImmune || []).toContain("frightened");
	});

	it("should support active defense mode using effective defenses", () => {
		state.getEffectiveDefenses = () => ({
			resistances: ["cold"],
			immunities: ["poison"],
			vulnerabilities: ["radiant"],
			conditionImmunities: ["charmed"],
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {defenseMode: "active"});
		expect(out.resist).toEqual(["cold"]);
		expect(out.immune).toEqual(["poison"]);
		expect(out.vulnerable).toEqual(["radiant"]);
		expect(out.conditionImmune).toEqual(["charmed"]);
	});

	it("should omit empty optional fields and keep hp formula dice-only", () => {
		const bare = new CharacterSheetState();
		bare.setName("Barebones");
		bare.addClass({name: "Fighter", source: "PHB", level: 1});
		bare.setMaxHp(12);
		bare.setCurrentHp(12);

		const out = CharacterSheetNpcExporter.convertStateToMonster(bare);

		expect(out.save).toBeUndefined();
		expect(out.skill).toBeUndefined();
		expect(out.senses).toBeUndefined();
		expect(out.hp.formula).toMatch(/^\d+d\d+(?:\s*[+\-]\s*\d+)?$/);
		expect(out.pbNote).toMatch(/^\+\d+$/);
	});

	it("should sanitize source json and parse object creature types", () => {
		state.setRace({
			name: "Spritekin",
			source: "HB",
			creatureTypes: [{type: "fey"}],
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {sourceJson: "my_source*& weird"});

		expect(out.source).toBe("MYSOURCE& WEIRD");
		expect(out.type).toEqual({type: "fey"});
	});

	it("should sanitize attack names and ranges", () => {
		state.addAttack({
			name: "<script>alert(1)</script> Spear",
			isMelee: true,
			attackBonus: 5,
			damage: "1d6+3",
			damageType: "piercing",
			range: "reach 5 ft., <img src=x onerror=alert(1)> one target",
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const spear = out.action.find(a => (a.name || "").includes("Spear"));

		expect(spear).toBeDefined();
		expect(spear.name).not.toContain("<");
		expect(spear.entries[0]).not.toContain("<img");
	});

	it("should sanitize languages and level signal class summary", () => {
		state.addLanguage("<img src=x onerror=alert(1)> Giant");
		state.getClassSummary = () => "<script>alert(1)</script> Fighter";

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect(out.languages.some(it => it.includes("<"))).toBe(false);

		const levelSignal = out.trait.find(it => it.name === "Level Signal");
		expect(levelSignal).toBeDefined();
		expect(levelSignal.entries[0]).not.toContain("<script>");
	});

	it("should sanitize source config fields", () => {
		const cfg = CharacterSheetNpcExporter.getSanitizedSourceConfig({
			sourceJson: "my_source*& weird",
			abbreviation: "<b>brew</b>",
			full: "<i>My Export Source</i>",
			version: "v1.0.0 beta!",
		});

		expect(cfg.sourceJson).toBe("MYSOURCE& WEIRD");
		expect(cfg.abbreviation).toBe("brew");
		expect(cfg.full).toBe("My Export Source");
		expect(cfg.version).toBe("v1.0.0beta");
	});

	it("should rewrite second-person feature text to NPC-name references", () => {
		state.addFeature({
			name: "Battle Focus",
			source: "PHB",
			description: "You can reroll one attack roll on your turn.",
			important: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const trait = out.trait.find(t => t.name === "Battle Focus");

		expect(trait).toBeDefined();
		expect(trait.entries[0]).toContain("Aelar can reroll one attack roll on Aelar's turn");
		expect(trait.entries[0].toLowerCase()).not.toContain("you can");
	});

	it("should omit features already represented by derived modifier effects", () => {
		state.addFeature({
			id: "feat_expertise_test",
			name: "Skill Expertise",
			source: "PHB",
			description: "You gain expertise in one skill.",
			important: true,
		});
		state.addNamedModifier({
			name: "Skill Expertise Applied",
			type: "skill:perception",
			value: 2,
			sourceFeatureId: "feat_expertise_test",
			enabled: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect(out.trait.some(t => t.name === "Skill Expertise")).toBe(false);
	});

	it("should include configured custom abilities and named modifiers in traits and actions", () => {
		state.addCustomAbility({
			name: "Arc Burst",
			description: "You unleash force in a line.",
			mode: "toggleable",
			activationAction: "action",
		});
		state.addCustomAbility({
			name: "Stone Skin",
			description: "Your skin hardens against blows.",
			mode: "passive",
		});
		state.addNamedModifier({
			name: "Ward Shield",
			type: "ac",
			value: 2,
			note: "You gain this bonus while your ward is active",
			enabled: false,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);

		expect(out.action.some(a => a.name === "Arc Burst")).toBe(true);
		const customTrait = out.trait.find(t => t.name === "Custom Abilities");
		expect(customTrait).toBeDefined();
		expect(customTrait.entries.join(" ")).toContain("Stone Skin");
		expect(customTrait.entries.join(" ")).toContain("Aelar's skin hardens");

		const modifierTrait = out.trait.find(t => t.name === "Custom Modifiers");
		expect(modifierTrait).toBeDefined();
		expect(modifierTrait.entries.join(" ")).toContain("Ward Shield");
		expect(modifierTrait.entries.join(" ")).toContain("Armor Class");
		expect(modifierTrait.entries.join(" ")).toContain("disabled");
	});

	it("should route activatable features into action economy sections", () => {
		state.addFeature({
			name: "Sudden Step",
			source: "PHB",
			description: "As a bonus action, you teleport up to 10 feet.",
		});
		state.addFeature({
			name: "Riposte Guard",
			source: "PHB",
			description: "As a reaction, you gain +2 AC against one attack.",
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);

		expect((out.bonus || []).some(it => it.name === "Sudden Step")).toBe(true);
		expect((out.reaction || []).some(it => it.name === "Riposte Guard")).toBe(true);
		expect((out.trait || []).some(it => it.name === "Sudden Step")).toBe(false);
		expect((out.trait || []).some(it => it.name === "Riposte Guard")).toBe(false);
	});

	it("should suppress non-combat background features from statblock", () => {
		state.addFeature({
			name: "Shelter of the Faithful",
			source: "Acolyte",
			featureType: "Background",
			description: "You and your companions can expect free healing and care at temples.",
			important: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect((out.trait || []).some(it => it.name === "Shelter of the Faithful")).toBe(false);
		expect((out.action || []).some(it => it.name === "Shelter of the Faithful")).toBe(false);
		expect((out.bonus || []).some(it => it.name === "Shelter of the Faithful")).toBe(false);
		expect((out.reaction || []).some(it => it.name === "Shelter of the Faithful")).toBe(false);
	});

	it("should suppress background features even if they mention action economy", () => {
		state.addFeature({
			name: "Street Runner",
			source: "Urchin",
			featureType: "Background",
			description: "As a bonus action, you can blend into a crowd in urban terrain.",
			important: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect((out.trait || []).some(it => it.name === "Street Runner")).toBe(false);
		expect((out.action || []).some(it => it.name === "Street Runner")).toBe(false);
		expect((out.bonus || []).some(it => it.name === "Street Runner")).toBe(false);
		expect((out.reaction || []).some(it => it.name === "Street Runner")).toBe(false);
	});

	it("should report validation issues for malformed monster payloads", () => {
		const issues = CharacterSheetNpcExporter.getValidationIssues({
			name: "Bad",
			source: "<bad>",
			alignment: [],
			action: [],
			languages: ["<img src=x onerror=alert(1)>"],
		});

		expect(issues.errors.length).toBeGreaterThan(0);
		expect(issues.warnings.some(it => it.includes("Source JSON was normalized"))).toBe(true);
		expect(issues.warnings.some(it => it.includes("Potentially unsafe markup"))).toBe(true);
	});

	it("should be consumable by activateWildShapeFromBestiary", () => {
		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const wsState = new CharacterSheetState();

		wsState.activateWildShapeFromBestiary(out);

		expect(wsState.isInWildShape()).toBe(true);

		const beastData = wsState.getWildShapeBeastData();
		expect(beastData.name).toBe(out.name);
		expect(beastData.hp.max).toBe(out.hp.average);
		expect(beastData.ac).toBe(out.ac[0].ac);
	});

	it("should be consumable by addCompanionFromBestiary", () => {
		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const compState = new CharacterSheetState();

		const id = compState.addCompanionFromBestiary(
			out,
			CharacterSheetState.COMPANION_TYPES.BEAST_COMPANION,
			"Export Test",
		);

		expect(id).toBeTruthy();

		const companion = compState.getCompanion(id);
		expect(companion.name).toBe(out.name);
		expect(companion.hp.max).toBe(out.hp.average);
		expect(companion.ac).toBe(out.ac[0].ac);
		expect(companion.type).toBe(CharacterSheetState.COMPANION_TYPES.BEAST_COMPANION);
	});

	it("should omit empty spellcasting sections", () => {
		const caster = new CharacterSheetState();
		caster.setName("Cantrip Only");
		caster.addClass({name: "Wizard", source: "PHB", level: 1});
		caster.setSpellcastingAbility("int");
		caster.addCantrip({name: "light", source: "XPHB", level: 0, sourceClass: "Wizard"});

		const out = CharacterSheetNpcExporter.convertStateToMonster(caster);
		expect(out.spellcasting).toBeDefined();
		expect(out.spellcasting[0].will).toBeDefined();
		expect(out.spellcasting[0].spells).toBeUndefined();
	});
});
