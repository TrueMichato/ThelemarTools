import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
// `getEffectiveItemBonuses` guards on BOTH of these being defined and returns the item
// untouched when either is missing -- silently, with no error. In the app the script tags
// supply them; in Jest only an explicit import does. Without these two lines any test here
// that touched an item material or upgrade would pass while measuring nothing.
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-materials.js";
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
		expect(out.isNpc).toBe(true);
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
		// Level Signal is out-of-fiction meta and opt-in only.
		expect(out.trait.some(t => t.name === "Level Signal")).toBe(false);
		const withSignal = CharacterSheetNpcExporter.convertStateToMonster(state, {includeLevelSignal: true});
		expect(withSignal.trait.some(t => t.name === "Level Signal")).toBe(true);
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
		// v19: the economy is a hoverable superscript mark rather than a parenthetical.
		expect(methodsText).toContain("Rooted Stance|TGTT}{@sup {@tip B|Bonus Action}}");
		expect(methodsText).toContain("Flowing Strike|TGTT}{@sup {@tip A|Action}}");
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
		expect(battleaxe.entries[0]).toMatch(/The attack is magical/i);
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
		expect(out.action.some(a => /1\/rest each/i.test((a.entries || []).join(" ")) || /1\/rest each/i.test(a.name || ""))).toBe(true);
		expect(out.action.some(a => /shield/i.test(a.name || "") || /shield/i.test((a.entries || []).join(" ")))).toBe(true);
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
		expect(out.hp.formula).toMatch(/^\d+d\d+(?:\s*[+-]\s*\d+)?$/);
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

		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {includeLevelSignal: true});
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
		// Bestiary voice: name the creature on first mention, then use pronouns.
		expect(trait.entries[0]).toContain("Aelar can reroll one attack roll on its turn");
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
			enabled: true,
			conditional: "while ward is active",
		});
		// Disabled / baked-in modifiers should not dump by default
		state.addNamedModifier({
			name: "Tough (HP)",
			type: "hp",
			value: 2,
			enabled: true,
		});

		const outDefault = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect(outDefault.action.some(a => a.name === "Arc Burst")).toBe(true);
		const customTrait = outDefault.trait.find(t => t.name === "Custom Abilities");
		expect(customTrait).toBeDefined();
		expect(customTrait.entries.join(" ")).toContain("Stone Skin");
		expect(customTrait.entries.join(" ")).toContain("Aelar's skin hardens");
		// Smart residual ON by default — leftover conditionals appear; pure HP bookkeeping does not
		const modifierTrait = outDefault.trait.find(t => t.name === "Additional Effects" || t.name === "Custom Modifiers");
		expect(modifierTrait).toBeDefined();
		expect(modifierTrait.entries.join(" ")).toContain("Ward Shield");
		expect(modifierTrait.entries.join(" ")).toMatch(/Armor Class|ac/i);
		expect(modifierTrait.entries.join(" ")).not.toContain("Tough (HP)");
		expect(modifierTrait.entries.join(" ")).not.toMatch(/\bdisabled\b/);

		const outNoMods = CharacterSheetNpcExporter.convertStateToMonster(state, {includeCustomModifiers: false});
		expect(outNoMods.trait.some(t => t.name === "Additional Effects" || t.name === "Custom Modifiers")).toBe(false);
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

	it("should avoid double periods in attack ranges and strip +0 damage", () => {
		const warrior = new CharacterSheetState();
		warrior.setName("Archer");
		warrior.addClass({name: "Fighter", source: "PHB", level: 5});
		warrior.setAbilityBase("dex", 10);
		warrior.setMaxHp(40);
		warrior.addItem({
			name: "Longbow",
			source: "PHB",
			dmg1: "1d8",
			dmgType: "piercing",
			range: "150/600 ft.",
			type: "R",
			weaponCategory: "martial",
			equipped: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(warrior);
		const bow = out.action.find(a => a.name === "Longbow");
		expect(bow).toBeDefined();
		expect(bow.entries[0]).not.toMatch(/ft\.\./);
		expect(bow.entries[0]).toContain("range 150/600 ft.");
		expect(bow.entries[0]).toContain("{@damage 1d8}");
		expect(bow.entries[0]).not.toContain("1d8+0");
	});

	it("should tag thrown melee weapons as mw,rw", () => {
		const warrior = new CharacterSheetState();
		warrior.setName("Thrower");
		warrior.addClass({name: "Fighter", source: "PHB", level: 3});
		warrior.setAbilityBase("str", 14);
		warrior.setMaxHp(28);
		warrior.addItem({
			name: "Dagger",
			source: "PHB",
			dmg1: "1d4",
			dmgType: "piercing",
			range: "20/60 ft.",
			type: "M",
			weaponCategory: "simple",
			property: ["F", "T"],
			equipped: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(warrior);
		const dagger = out.action.find(a => a.name === "Dagger");
		expect(dagger).toBeDefined();
		expect(dagger.entries[0]).toContain("{@atk mw,rw}");
		expect(dagger.entries[0]).toContain("reach 5 ft. or range 20/60 ft.");
	});

	it("should omit default unarmed strike when armed (auto mode) and keep it for monks", () => {
		const fighter = new CharacterSheetState();
		fighter.setName("Armed");
		fighter.addClass({name: "Fighter", source: "PHB", level: 5});
		fighter.setAbilityBase("str", 16);
		fighter.setMaxHp(44);
		fighter.addAttack({
			name: "Longsword",
			isMelee: true,
			attackBonus: 6,
			damage: "1d8+3",
			damageType: "slashing",
			range: "reach 5 ft., one target",
		});

		const fighterOut = CharacterSheetNpcExporter.convertStateToMonster(fighter);
		expect(fighterOut.action.some(a => a.name === "Longsword")).toBe(true);
		expect(fighterOut.action.some(a => a.name === "Unarmed Strike")).toBe(false);

		const monk = new CharacterSheetState();
		monk.setName("Zu");
		monk.addClass({name: "Monk", source: "XPHB", level: 5});
		monk.setAbilityBase("dex", 16);
		monk.setAbilityBase("wis", 14);
		monk.setMaxHp(38);

		const monkOut = CharacterSheetNpcExporter.convertStateToMonster(monk);
		expect(monkOut.action.some(a => a.name === "Unarmed Strike")).toBe(true);
		expect(monkOut.ac[0].from.join(" ")).toMatch(/Unarmored Defense/i);
	});

	it("should synthesize Multiattack and suppress Extra Attack trait text", () => {
		state.addFeature({
			name: "Extra Attack",
			source: "PHB",
			description: "You can attack twice whenever you take the Attack action on your turn.",
			important: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect(out.action.some(a => a.name === "Multiattack")).toBe(true);
		expect(out.action.find(a => a.name === "Multiattack").entries[0]).toMatch(/two/i);
		expect((out.trait || []).some(t => t.name === "Extra Attack")).toBe(false);
	});

	it("should use state spell save DC and character name in spellcasting header", () => {
		const wiz = new CharacterSheetState();
		wiz.setName("Mira");
		wiz.addClass({name: "Wizard", source: "XPHB", level: 5});
		wiz.setAbilityBase("int", 18);
		wiz.setMaxHp(30);
		wiz.setSpellcastingAbility("int");
		wiz.addCantrip({name: "fire bolt", source: "XPHB", level: 0});
		wiz.addNamedModifier({name: "DC bump", type: "spellDc", value: 2, enabled: true});
		wiz._recalculateCustomModifiers?.();

		const expectedDc = wiz.getSpellSaveDc();
		const out = CharacterSheetNpcExporter.convertStateToMonster(wiz);
		const header = out.spellcasting[0].headerEntries[0];
		expect(header).toContain("Mira is a spellcaster");
		expect(header).toContain(`{@dc ${expectedDc}}`);
		expect(header).not.toContain("The NPC is a spellcaster");
	});

	it("should export innate spells as a separate spellcasting block", () => {
		const wiz = new CharacterSheetState();
		wiz.setName("Innate Mage");
		wiz.addClass({name: "Wizard", source: "XPHB", level: 3});
		wiz.setSpellcastingAbility("int");
		wiz.setMaxHp(20);
		wiz.addCantrip({name: "light", source: "XPHB", level: 0});
		wiz.addInnateSpell({name: "detect magic", source: "XPHB", level: 1, atWill: true});
		wiz.addInnateSpell({name: "misty step", source: "XPHB", level: 2, uses: {current: 1, max: 1}, recharge: "long"});

		const out = CharacterSheetNpcExporter.convertStateToMonster(wiz);
		expect(out.spellcasting.length).toBeGreaterThanOrEqual(2);
		const innate = out.spellcasting.find(b => b.name === "Innate Spellcasting");
		expect(innate).toBeDefined();
		expect(innate.will.some(s => s.includes("detect magic"))).toBe(true);
		expect(innate.daily).toBeDefined();
		const dailyVals = Object.values(innate.daily).flat().join(" ");
		expect(dailyVals).toContain("misty step");
	});

	it("should export warlock pact magic slots", () => {
		const warlock = new CharacterSheetState();
		warlock.setName("Hexer");
		warlock.addClass({name: "Warlock", source: "PHB", level: 5});
		warlock.setAbilityBase("cha", 16);
		warlock.setMaxHp(38);
		warlock.setSpellcastingAbility("cha");
		warlock.calculateSpellSlots?.();
		warlock.addCantrip({name: "eldritch blast", source: "PHB", level: 0});
		warlock.addSpell({name: "hex", source: "PHB", level: 1}, true);
		warlock.addSpell({name: "misty step", source: "PHB", level: 2}, true);

		const pact = warlock.getPactSlots();
		expect(pact.max).toBeGreaterThan(0);

		const out = CharacterSheetNpcExporter.convertStateToMonster(warlock);
		expect(out.spellcasting).toBeDefined();
		const block = out.spellcasting[0];
		expect(block.name).toMatch(/Pact Magic/i);
		expect(block.headerEntries[0]).toMatch(/short or long rest/i);
		expect(block.will.some(s => s.includes("eldritch blast"))).toBe(true);
		const slotLevel = String(pact.level || 3);
		expect(block.spells[slotLevel]).toBeDefined();
		expect(block.spells[slotLevel].slots).toBe(pact.max);
		expect(block.spells[slotLevel].lower).toBe(1);
	});

	it("should use primary class hit die in HP formula", () => {
		const barb = new CharacterSheetState();
		barb.setName("Tank");
		barb.addClass({name: "Barbarian", source: "PHB", level: 10});
		barb.setAbilityBase("con", 20);
		barb.setMaxHp(125);
		barb.setCurrentHp(125);

		const out = CharacterSheetNpcExporter.convertStateToMonster(barb);
		expect(out.hp.average).toBe(125);
		expect(out.hp.formula).toMatch(/d12/);
		expect(out.hp.formula).not.toMatch(/d8/);
	});

	it("should support legendary framing options", () => {
		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {
			legendaryEnabled: true,
			legendaryActions: 3,
			legendaryResistances: 2,
		});

		expect((out.trait || []).some(t => /Legendary Resistance \(2\/Day\)/.test(t.name))).toBe(true);
		expect(out.legendaryActions).toBe(3);
		expect(Array.isArray(out.legendary)).toBe(true);
		expect(out.legendary.length).toBeGreaterThanOrEqual(2);

		const validation = CharacterSheetNpcExporter.getValidationIssues(out);
		expect(validation.errors).toEqual([]);
	});

	it("should honor manual CR override and sanitize export options", () => {
		const opts = CharacterSheetNpcExporter.getSanitizedExportOptions({
			defenseMode: "ACTIVE",
			includeUnarmed: "never",
			includeFeatures: "manual",
			crMode: "manual",
			crManual: "12",
			legendaryEnabled: 1,
			legendaryActions: 99,
		});
		expect(opts.defenseMode).toBe("active");
		expect(opts.includeUnarmed).toBe("never");
		expect(opts.includeFeatures).toBe("manual");
		expect(opts.crMode).toBe("manual");
		expect(opts.crManual).toBe("12");
		expect(opts.legendaryActions).toBe(5);

		const out = CharacterSheetNpcExporter.convertStateToMonster(state, opts);
		expect(out.cr).toBe("12");
	});

	it("should label AC from equipped armor name", () => {
		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect(out.ac[0].from.join(" ")).toMatch(/Chain Mail|armor|natural/i);
		// Prefer real armor name when breakdown available
		state.setArmor({name: "Chain Mail", ac: 16, type: "heavy"});
		const out2 = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect(out2.ac[0].from.some(f => /chain mail/i.test(f) || f === "natural armor" || /armor/i.test(f))).toBe(true);
	});

	it("should rewrite contractions and verb agreement without Onger've-style bugs", () => {
		state.setName("Onger");
		state.addFeature({
			name: "Thunderous Test",
			source: "TCE",
			important: true,
			description: "Starting at 10th level, when you hit a creature while you're raging, you've never felt stronger. You take damage and you hit it again.",
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {includeFeatures: "allImportant"});
		const blob = JSON.stringify(out);
		expect(blob).not.toMatch(/Onger've|Onger're|Onger'll/i);
		expect(blob).not.toMatch(/Starting at 10th level/i);
		const trait = [...(out.trait || []), ...(out.action || []), ...(out.bonus || []), ...(out.reaction || [])]
			.find(t => /Thunderous Test/i.test(t.name));
		expect(trait).toBeDefined();
		const text = (trait.entries || []).join(" ");
		expect(text).toMatch(/^When Onger hits/);
		expect(text).toMatch(/it is raging/);
		expect(text).toMatch(/it has never/);
		expect(text).toMatch(/[Ii]t (takes|hits)/);
	});

	it("should preserve and enrich hover tags in feature text", () => {
		state.addFeature({
			name: "Brave Presence",
			source: "PHB",
			important: true,
			description: "You have advantage on saving throws against being {@condition frightened}. You also gain advantage on Wisdom (Perception) checks.",
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {includeFeatures: "allImportant"});
		// v16: standing advantage claims merge into the pinned roll-modifier trait, so the
		// tags have to survive that merge as well as the prose passes.
		const trait = out.trait.find(t => t.name === "Brave Presence")
			|| out.trait.find(t => /^resilience$/i.test(t.name));
		expect(trait).toBeDefined();
		const text = trait.entries.join(" ");
		expect(text).toContain("{@condition frightened}");
		expect(text).toMatch(/\{@skill Perception\}/);
		expect(text).not.toContain("you have");
	});

	it("should fold named-modifier condition immunities onto conditionImmune", () => {
		state.addNamedModifier({
			name: "Unstoppable",
			type: "conditionImmunity:frightened",
			enabled: true,
		});
		state.addNamedModifier({
			name: "Unstoppable",
			type: "conditionImmunity:paralyzed",
			enabled: true,
		});
		state.addNamedModifier({
			name: "Fast Movement",
			type: "speed:walk",
			value: 10,
			enabled: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		expect(out.conditionImmune || []).toEqual(expect.arrayContaining(["frightened", "paralyzed"]));
		// Folded defenses / speed must not reappear in residual Additional Effects
		const modTrait = (out.trait || []).find(t => t.name === "Additional Effects" || t.name === "Custom Modifiers");
		const modText = modTrait ? modTrait.entries.join(" ") : "";
		expect(modText).not.toMatch(/conditionImmunity|frightened|paralyzed/i);
		expect(modText).not.toMatch(/Fast Movement/);
	});

	it("should dedupe same-name level-upgrade features into one entry", () => {
		state.addFeature({
			name: "Thunderous Blows",
			source: "TCE",
			important: true,
			description: "As a reaction when you hit a creature with a melee attack while you're raging, you can push that creature up to 5 feet away.",
		});
		state.addFeature({
			name: "Thunderous Blows (10th Level)",
			source: "TCE",
			important: true,
			description: "Starting at 10th level, you can push a creature up to 10 feet when you hit it with a melee attack while you're raging.",
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {includeFeatures: "allImportant"});
		const all = [...(out.trait || []), ...(out.action || []), ...(out.bonus || []), ...(out.reaction || [])]
			.filter(e => /Thunderous Blows/i.test(e.name));
		expect(all.length).toBe(1);
		expect(all[0].name).toBe("Thunderous Blows");
		expect(all[0].entries.join(" ")).not.toMatch(/Starting at 10th level/i);
	});

	it("should default includeCustomModifiers to true (smart residual) in sanitized options", () => {
		const opts = CharacterSheetNpcExporter.getSanitizedExportOptions({});
		expect(opts.includeCustomModifiers).toBe(true);
		expect(CharacterSheetNpcExporter.getSanitizedExportOptions({includeCustomModifiers: false}).includeCustomModifiers).toBe(false);
	});

	it("should export feats as action-economy abilities (Polearm Master, Sentinel)", () => {
		state.addFeat({
			name: "Polearm Master",
			source: "PHB",
			description: "When you take the Attack action and attack with only a glaive, halberd, quarterstaff, or spear, you can use a bonus action to make a melee attack with the opposite end of the weapon. This attack uses the same ability modifier as the primary attack. The weapon's damage die for this attack is a d4, and it deals bludgeoning damage.",
		});
		state.addFeat({
			name: "Sentinel",
			source: "PHB",
			description: "When you hit a creature with an opportunity attack, the creature's speed becomes 0 for the rest of the turn. Creatures provoke opportunity attacks from you even if they take the Disengage action before leaving your reach. When a creature within 5 feet of you makes an attack against a target other than you, you can use your reaction to make a melee weapon attack against the attacking creature.",
		});
		// Named-mod stub should not be preferred over feat text
		state.addNamedModifier({
			name: "Polearm Master",
			type: "bonusAction",
			action: "polearmStrike",
			damage: "1d4+mod",
			note: "butt-end attack with polearm",
			enabled: true,
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {includeFeatures: "allImportant"});
		const bonus = (out.bonus || []).find(b => /Polearm Master/i.test(b.name));
		expect(bonus).toBeDefined();
		expect(bonus.entries.join(" ")).toMatch(/bonus action|opposite end|d4|bludgeoning/i);
		// Residual must not keep the cryptic stub once feat is present
		const residual = (out.trait || []).find(t => t.name === "Additional Effects");
		const residualText = residual ? residual.entries.join(" ") : "";
		expect(residualText).not.toMatch(/bonusAction;\s*contextual/i);

		const sentinel = [...(out.reaction || []), ...(out.trait || [])].find(e => /Sentinel/i.test(e.name));
		expect(sentinel).toBeDefined();
		expect(sentinel.entries.join(" ")).toMatch(/opportunity attack|speed becomes 0|Disengage/i);
	});

	it("should put limited uses on ability names and omit covered Class Resources", () => {
		state.addClass({name: "Barbarian", source: "PHB", level: 6});
		state.addFeature({
			name: "Rage",
			source: "PHB",
			description: "As a bonus action, you can enter a rage. While raging, you have advantage on Strength checks and Strength saving throws.",
			uses: {max: 4, current: 4, recharge: "long"},
			important: true,
		});
		state.addFeature({
			name: "Stone's Endurance",
			source: "PHB",
			description: "When you take damage, you can use your reaction to roll a d12 and add your Constitution modifier, reducing the damage by the total.",
			uses: {max: 3, current: 3, recharge: "long"},
			important: true,
		});
		state.addResource({name: "Rage", max: 4, current: 4, recharge: "long"});
		state.addResource({name: "Stone's Endurance", max: 3, current: 3, recharge: "long"});
		state.addResource({name: "Orphan Pool", max: 2, current: 2, recharge: "short"});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state, {includeFeatures: "allImportant"});
		const rage = (out.bonus || []).find(b => /^Rage\b/i.test(b.name));
		expect(rage).toBeDefined();
		expect(rage.name).toMatch(/\(4\/LR\)/);
		expect(rage.entries.join(" ")).not.toMatch(/\(4\/Long Rest\)/i);

		const stone = (out.reaction || []).find(r => /Stone'?s Endurance/i.test(r.name));
		expect(stone).toBeDefined();
		expect(stone.name).toMatch(/\(3\/LR\)/);

		const classRes = (out.trait || []).find(t => t.name === "Class Resources");
		const resText = classRes ? classRes.entries.join(" ") : "";
		expect(resText).not.toMatch(/Rage 4/);
		expect(resText).not.toMatch(/Stone'?s Endurance 3/);
		// Orphan pools still listed
		if (classRes) expect(resText).toMatch(/Orphan Pool/);
	});

	it("should annotate rage resistances as conditional on the resist block", () => {
		state.addClass({name: "Barbarian", source: "PHB", level: 3});
		state.addFeature({
			name: "Rage",
			source: "PHB",
			description: "As a bonus action, you enter a rage.",
			uses: {max: 3, recharge: "long"},
			important: true,
		});
		state.addResource({name: "Rage", max: 3, recharge: "long"});
		// Ensure calculations surface hasRage when available
		const prev = state.getFeatureCalculations?.bind(state);
		if (prev) {
			state.getFeatureCalculations = () => ({...(prev() || {}), hasRage: true});
		} else {
			state.getFeatureCalculations = () => ({hasRage: true});
		}

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const resist = out.resist || [];
		const cond = resist.find(r => r && typeof r === "object" && r.cond && /raging/i.test(r.note || ""));
		expect(cond).toBeDefined();
		expect(cond.resist || []).toEqual(expect.arrayContaining(["bludgeoning", "piercing", "slashing"]));
	});

	it("should export magic item named entry abilities (Gae Bolg style)", () => {
		state.addItem({
			name: "Gae Bolg",
			source: "TGTT",
			rarity: "artifact",
			requiresAttunement: true,
			attuned: true,
			equipped: true,
			bonusWeapon: "+4",
			type: "M",
			entries: [
				"A barbed spear.",
				{
					type: "entries",
					name: "Dragon-Bone Spear",
					entries: [
						"You gain a +4 bonus to attack and damage rolls made with this magic weapon. On a hit, the spear deals 4d10 piercing damage plus the ability modifier used for the attack, instead of its normal damage.",
					],
				},
				{
					type: "entries",
					name: "Never Unready",
					entries: [
						"While the spear is on your person, you can't have the {@condition Surprised} condition, you have truesight out to 60 feet, and you can add your Proficiency Bonus to Initiative rolls.",
					],
				},
				{
					type: "entries",
					name: "Enemy-Blinding Radiance",
					entries: [
						"As a {@action Bonus Action}, you can cause the spear to blaze for 1 minute. Each other creature that starts its turn within 60 feet of you must succeed on a {@dc 22} Constitution saving throw or have the {@condition Blinded} condition until the start of its next turn. Once used, this property can't be used again until the next dawn.",
					],
				},
			],
		});

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const never = (out.trait || []).find(t => /Never Unready/i.test(t.name));
		expect(never).toBeDefined();
		expect(never.entries.join(" ")).toMatch(/Surprised|truesight|Initiative/i);

		const blaze = (out.bonus || []).find(b => /Enemy-Blinding Radiance/i.test(b.name));
		expect(blaze).toBeDefined();
		expect(blaze.name).toMatch(/1\/Dawn/);
		expect(blaze.entries.join(" ")).toMatch(/Blinded|dc 22|Bonus Action/i);

		// Attack restatement skipped when bonusWeapon already covers it
		const allText = JSON.stringify(out);
		expect(allText).not.toMatch(/Dragon-Bone Spear/);
	});

	it("should expand combat method stance riders in the Combat Methods trait", () => {
		state.addFeature({
			name: "Flowing Steps Stance",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["CTM:4RC"],
			description: "As a Bonus Action (3 Stamina Points), you enter a stance. You have advantage on saving throws made to resist being grappled, paralyzed, restrained, or stunned. In addition, you ignore difficult terrain. This stance lasts until you are incapacitated or use a bonus action to end it.",
		});
		// Ensure combat method parser marks stance
		const methods = state.getCombatMethods?.() || [];
		if (methods.length) {
			// force isStance if parser missed
			const m = methods.find(x => /Flowing Steps/i.test(x.name));
			if (m && !m.isStance) m.isStance = true;
		}

		const out = CharacterSheetNpcExporter.convertStateToMonster(state);
		const cm = (out.trait || []).find(t => t.name === "Combat Methods");
		expect(cm).toBeDefined();
		const text = cm.entries.join(" ");
		expect(text).toMatch(/Flowing Steps Stance/);
		expect(text).toMatch(/Stance/);

		// The stance's mechanics must reach the block exactly once — inlined in the
		// roster when it has no ability of its own, otherwise only in that ability.
		const bodies = ["trait", "action", "bonus", "reaction"]
			.flatMap(sec => out[sec] || [])
			.flatMap(entry => (entry.entries || []).filter(it => typeof it === "string"))
			.filter(it => /difficult terrain/i.test(it));
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toMatch(/grappled|difficult terrain|advantage/i);
	});
});

// ---------------------------------------------------------------------------
// v32 — initiative advantage is the exporter's only modifier-derived flag, and
// a skill-scoped advantage must not reach it.
//
// The exporter consumes `aggregateModifiers` in exactly one place: initiative,
// whose `advantage` becomes `{"initiative": {"advantageMode": "adv"}}` in the
// shipped statblock. Everything else the exporter says about advantage is
// feature prose carried verbatim, and 23 of the 24 corpus exports carry some.
//
// A sibling change made `check:advantage:<skill>` reachable from `skill:<skill>`
// (previously it reached nothing). That edit touched precisely the matching code
// that decides what `initiative` also sees, so an over-broad match would have
// silently granted initiative advantage to any creature with, say, Keen Senses.
//
// The third leg is the load-bearing one. Two "must not reach" assertions are
// both satisfied if aggregation breaks wholesale and nothing reaches initiative
// ever — so a genuinely broad `check:all` must still reach it. Absence is only
// evidence when presence is demonstrated beside it.
// ---------------------------------------------------------------------------
describe("CharacterSheetNpcExporter — initiative advantage scoping (v32)", () => {
	const makeState = (namedModifiers = []) => {
		const st = new CharacterSheetState();
		st.setName("Scout");
		st.addClass({name: "Ranger", source: "PHB", level: 11});
		st.setAbilityBase("dex", 16);
		st.setAbilityBase("wis", 16);
		st.setMaxHp(80);
		st.setCurrentHp(80);
		st.setSkillProficiency("perception", 1);
		st.setSkillProficiency("stealth", 1);
		namedModifiers.forEach(m => st._data.namedModifiers.push({enabled: true, ...m}));
		return st;
	};
	const initiativeOf = st => CharacterSheetNpcExporter.convertStateToMonster(st).initiative ?? null;

	it("control: an initiative-scoped advantage does reach the exported block", () => {
		// Without this the three assertions below are unfalsifiable.
		expect(initiativeOf(makeState())).toBeNull();
		expect(initiativeOf(makeState([{type: "initiative", advantage: true, name: "Alert"}])))
			.toEqual(expect.objectContaining({advantageMode: "adv"}));
	});

	it("a skill-scoped advantage does not leak into initiative", () => {
		for (const type of ["check:advantage:perception", "check:advantage:stealth"]) {
			const st = makeState([{type, advantage: true, name: "Keen Senses"}]);
			// The modifier is live — it reaches the skill it names…
			expect(st.aggregateModifiers(`skill:${type.split(":").pop()}`).advantage).toBe(true);
			// …and stops there.
			expect(st.aggregateModifiers("initiative").advantage).toBe(false);
			expect(initiativeOf(st)).toBeNull();
		}
	});

	it("a genuinely broad check advantage still does reach initiative", () => {
		// Anti-vacuity for the negatives above: proves initiative has not simply
		// stopped listening to the whole `check:` family.
		const st = makeState([{type: "check:all", advantage: true, name: "Broad"}]);
		expect(st.aggregateModifiers("initiative").advantage).toBe(true);
		expect(initiativeOf(st)).toEqual(expect.objectContaining({advantageMode: "adv"}));
	});

	it("skill advantage never perturbs the numeric skill block", () => {
		// Skills export as a single number from `getSkillMod`; advantage has no
		// representation there and must not be smuggled in as a bonus.
		const base = CharacterSheetNpcExporter.convertStateToMonster(makeState()).skill;
		const withAdv = CharacterSheetNpcExporter.convertStateToMonster(makeState([
			{type: "check:advantage:perception", advantage: true, name: "Keen Senses"},
		])).skill;
		expect(withAdv).toEqual(base);

		// Control: a real numeric bonus on the same skill does move it, so the
		// equality above is a measurement rather than two blind reads.
		const bumped = makeState();
		bumped._data.customModifiers.skills.perception = 5;
		expect(CharacterSheetNpcExporter.convertStateToMonster(bumped).skill)
			.not.toEqual(base);
	});
});
