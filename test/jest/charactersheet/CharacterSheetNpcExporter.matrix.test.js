/**
 * Broad validation matrix for NPC export across classes and special systems.
 * Complements CharacterSheetNpcExporter.test.js (unit/regression) with
 * representative builds: PHB/XPHB/TCE classes, multiclass, divine favor,
 * combat methods, specialties, ioun stones, magic items, channel divinity.
 */
import "./setup.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-ioun.js";
import {CharacterSheetNpcExporter} from "../../../js/charactersheet/charactersheet-npc-exporter.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetIoun = globalThis.CharacterSheetIoun;

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const BREW_PATH = path.join(__dirnameLocal, "..", "..", "..", "homebrew", "TravelersGuidetoThelemar.json");

let PAN = null;
try {
	const brew = JSON.parse(fs.readFileSync(BREW_PATH, "utf8"));
	PAN = (brew.divineFavor || []).find(g => g.name === "Pan" && g.source === "TGTT");
} catch {
	// brew optional in some environments
}

function makeBase (name, {className, source = "PHB", level = 5, abilities = {}, hp = 40, spellAbility = null, subclass = null} = {}) {
	const s = new CharacterSheetState();
	s.setName(name);
	s.addClass({name: className, source, level, subclass});
	const defaults = {str: 12, dex: 12, con: 14, int: 12, wis: 12, cha: 12};
	for (const [k, v] of Object.entries({...defaults, ...abilities})) s.setAbilityBase(k, v);
	s.setMaxHp(hp);
	s.setCurrentHp(hp);
	if (spellAbility) s.setSpellcastingAbility(spellAbility);
	return s;
}

function armMelee (state, name = "Longsword") {
	state.addItem({
		name,
		source: "PHB",
		dmg1: "1d8",
		dmgType: "slashing",
		type: "M",
		weaponCategory: "martial",
		property: name === "Longsword" ? ["V"] : [],
		equipped: true,
	});
}

function addCasterSpells (state, {ability, warlock = false, half = false} = {}) {
	state.setSpellcastingAbility(ability);
	state.calculateSpellSlots?.();
	state.addCantrip({name: "light", source: "XPHB", level: 0});
	if (warlock) {
		state.addSpell({name: "hex", source: "PHB", level: 1}, true);
		state.addSpell({name: "misty step", source: "PHB", level: 2}, true);
		return;
	}
	if (half) {
		state.addSpell({name: "cure wounds", source: "PHB", level: 1}, true);
		return;
	}
	state.addSpell({name: "shield", source: "XPHB", level: 1}, true);
	state.addSpell({name: "misty step", source: "XPHB", level: 2}, true);
}

function assertValidMonster (mon, label) {
	const v = CharacterSheetNpcExporter.getValidationIssues(mon);
	if (v.errors.length) {
		throw new Error(`${label} validation failed: ${v.errors.join("; ")}`);
	}
	expect(mon.name).toBeTruthy();
	expect(mon.ac?.[0]?.ac).toBeGreaterThanOrEqual(10);
	expect(mon.hp?.average).toBeGreaterThan(0);
	expect(mon.hp?.formula).toMatch(/d\d+/);
	expect(mon.cr).toBeDefined();
	expect(Array.isArray(mon.action)).toBe(true);
	expect(mon.action.length).toBeGreaterThan(0);
}

describe("CharacterSheetNpcExporter — class matrix", () => {
	const CLASS_SPECS = [
		{className: "Barbarian", abilities: {str: 18, con: 16, dex: 14}, hp: 55, martial: true, multiattack: true, unarmored: true},
		{className: "Bard", abilities: {cha: 16, dex: 14, con: 12}, hp: 35, spellAbility: "cha"},
		{className: "Cleric", abilities: {wis: 16, str: 14, con: 14}, hp: 40, spellAbility: "wis", armor: true},
		{className: "Druid", abilities: {wis: 16, con: 14, dex: 12}, hp: 38, spellAbility: "wis"},
		{className: "Fighter", abilities: {str: 16, con: 14, dex: 14}, hp: 44, martial: true, multiattack: true, armor: true},
		{className: "Monk", source: "XPHB", abilities: {dex: 16, wis: 14, con: 14}, hp: 38, multiattack: true, unarmored: true, keepUnarmed: true},
		{className: "Paladin", abilities: {str: 16, cha: 14, con: 14}, hp: 45, spellAbility: "cha", halfCaster: true, martial: true, multiattack: true, armor: true},
		{className: "Ranger", abilities: {dex: 16, wis: 14, con: 14}, hp: 42, spellAbility: "wis", halfCaster: true, martial: true, multiattack: true},
		{className: "Rogue", abilities: {dex: 16, int: 14, con: 12}, hp: 35, martial: true},
		{className: "Sorcerer", abilities: {cha: 16, con: 14, dex: 14}, hp: 32, spellAbility: "cha"},
		{className: "Warlock", abilities: {cha: 16, con: 14, dex: 12}, hp: 38, spellAbility: "cha", warlock: true},
		{className: "Wizard", source: "XPHB", abilities: {int: 18, con: 12, dex: 14}, hp: 30, spellAbility: "int"},
		{className: "Artificer", source: "TCE", abilities: {int: 16, con: 14, dex: 14}, hp: 40, spellAbility: "int", halfCaster: true, armor: true},
	];

	it.each(CLASS_SPECS)("exports a valid $className NPC", (spec) => {
		const s = makeBase(spec.className, {
			className: spec.className,
			source: spec.source || "PHB",
			level: 5,
			abilities: spec.abilities,
			hp: spec.hp,
			spellAbility: spec.spellAbility || null,
		});

		if (spec.spellAbility) {
			addCasterSpells(s, {
				ability: spec.spellAbility,
				warlock: !!spec.warlock,
				half: !!spec.halfCaster,
			});
		}
		if (spec.martial) armMelee(s);
		if (spec.armor) s.setArmor({name: "Scale Mail", ac: 14, type: "medium"});

		const mon = CharacterSheetNpcExporter.convertStateToMonster(s);
		assertValidMonster(mon, spec.className);

		if (spec.spellAbility) {
			expect(mon.spellcasting?.length || 0).toBeGreaterThan(0);
		}
		if (spec.warlock) {
			expect(mon.spellcasting.some(b => /Pact Magic/i.test(b.name))).toBe(true);
		}
		if (spec.multiattack) {
			expect(mon.action.some(a => a.name === "Multiattack")).toBe(true);
		}
		if (spec.unarmored) {
			expect(mon.ac[0].from.join(" ")).toMatch(/Unarmored Defense|natural armor/i);
		}
		if (spec.keepUnarmed) {
			expect(mon.action.some(a => a.name === "Unarmed Strike")).toBe(true);
		}
		if (spec.martial && !spec.keepUnarmed) {
			expect(mon.action.some(a => a.name === "Longsword")).toBe(true);
			expect(mon.action.some(a => a.name === "Unarmed Strike")).toBe(false);
		}
	});

	it("exports TGTT Illrigger-style sealed resources without crashing", () => {
		const s = makeBase("Infernal", {
			className: "Illrigger",
			source: "TGTT",
			level: 5,
			abilities: {str: 16, cha: 14, con: 14},
			hp: 45,
		});
		armMelee(s, "Longsword");
		s.addResource({name: "Seals", max: 3, current: 3, recharge: "short"});
		s.addFeature({
			name: "Baleful Interdict",
			source: "TGTT",
			important: true,
			description: "As a bonus action, you place a seal on a creature you can see within 30 feet. The sealed creature takes extra necrotic damage the next time you hit it.",
		});
		s.addFeature({
			name: "Infernal Conduit",
			source: "TGTT",
			important: true,
			uses: {current: 2, max: 2, recharge: "long"},
			description: "As an action, you touch a creature and deal necrotic damage or heal, spending Hit Dice.",
		});

		const mon = CharacterSheetNpcExporter.convertStateToMonster(s, {includeFeatures: "allImportant"});
		assertValidMonster(mon, "illrigger");
		const blob = JSON.stringify(mon);
		expect(blob).toMatch(/Baleful Interdict|Infernal Conduit|Seals|Class Resources/);
		expect(mon.action.some(a => a.name === "Longsword") || mon.action.some(a => a.name === "Multiattack")).toBe(true);
	});

	it("exports multiclass Fighter 7 / Wizard 3 with weapons + slots", () => {
		const s = new CharacterSheetState();
		s.setName("Eldritch Knight");
		s.addClass({name: "Fighter", source: "PHB", level: 7});
		s.addClass({name: "Wizard", source: "PHB", level: 3});
		s.setAbilityBase("str", 16);
		s.setAbilityBase("int", 14);
		s.setAbilityBase("con", 14);
		s.setMaxHp(70);
		s.setCurrentHp(70);
		addCasterSpells(s, {ability: "int"});
		armMelee(s);
		s.setArmor({name: "Chain Mail", ac: 16, type: "heavy"});

		const mon = CharacterSheetNpcExporter.convertStateToMonster(s);
		assertValidMonster(mon, "multiclass");
		expect(mon.action.some(a => a.name === "Multiattack")).toBe(true);
		expect(mon.action.some(a => a.name === "Longsword")).toBe(true);
		expect(mon.spellcasting?.length).toBeGreaterThan(0);
		expect(mon.ac[0].from.join(" ")).toMatch(/Chain Mail/i);
		expect(mon.trait.some(t => t.name === "Level Signal" && /Fighter|Wizard/i.test(t.entries.join(" ")))).toBe(true);
	});
});

describe("CharacterSheetNpcExporter — special systems matrix", () => {
	it("exports class resource pools (ki, channel divinity, stamina, synthetic)", () => {
		const monk = makeBase("KiUser", {
			className: "Monk",
			source: "XPHB",
			level: 5,
			abilities: {dex: 16, wis: 14, con: 14},
			hp: 38,
		});
		monk.addResource({name: "Ki Points", max: 5, current: 3, recharge: "short"});
		monk.addResource({name: "Channel Divinity", max: 1, current: 1, recharge: "short"});
		monk.setStaminaMax?.(6);
		if (typeof monk.setStaminaMax === "function") monk.setStaminaMax(6);
		else monk._data.stamina = {current: 6, max: 6};

		// Fighter synthetics
		const fighter = makeBase("Surge", {
			className: "Fighter",
			level: 5,
			abilities: {str: 16, con: 14, dex: 12},
			hp: 44,
		});
		fighter.addFeature({name: "Second Wind", source: "PHB", description: "As a bonus action, regain hit points."});
		fighter.addFeature({name: "Action Surge", source: "PHB", description: "On your turn, take one additional action."});
		armMelee(fighter);

		const monMonk = CharacterSheetNpcExporter.convertStateToMonster(monk);
		assertValidMonster(monMonk, "resources-monk");
		const resTrait = monMonk.trait.find(t => t.name === "Class Resources");
		expect(resTrait).toBeDefined();
		const resText = resTrait.entries.join(" ");
		expect(resText).toMatch(/Ki Points/);
		expect(resText).toMatch(/3\/5/);
		expect(resText).toMatch(/Channel Divinity/);
		expect(resText).toMatch(/Stamina/);

		const monFighter = CharacterSheetNpcExporter.convertStateToMonster(fighter);
		assertValidMonster(monFighter, "resources-fighter");
		const fText = (monFighter.trait.find(t => t.name === "Class Resources")?.entries || []).join(" ");
		// Second Wind / Action Surge via synthetic resources when APIs exist
		if (typeof fighter.getSyntheticCombatResources === "function" && fighter.getSyntheticCombatResources().length) {
			expect(fText).toMatch(/Second Wind|Action Surge/);
		}
	});

	it("exports TGTT combat methods as a Combat Methods trait", () => {
		const s = makeBase("Methodist", {
			className: "Fighter",
			source: "TGTT",
			level: 5,
			abilities: {str: 16, con: 14, dex: 14},
			hp: 44,
		});
		s.setStaminaMax(8);
		s.addFeature({
			name: "Flowing Strike",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["CTM:2RC"],
			description: "As an Action (1 Stamina Point), make a quick strike.",
		});
		s.addFeature({
			name: "Rooted Stance",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["CTM:1AM"],
			description: "As a Bonus Action (0 Stamina Points), you enter a stance. This stance lasts until dismissed.",
		});
		armMelee(s);

		const mon = CharacterSheetNpcExporter.convertStateToMonster(s);
		assertValidMonster(mon, "combat methods");
		const methods = mon.trait.find(t => t.name === "Combat Methods");
		expect(methods).toBeDefined();
		const text = methods.entries.join(" ");
		expect(text).toContain("Cost 0:");
		expect(text).toContain("Cost 1:");
		expect(text).toContain("{@combatmethod");
		expect(text).toMatch(/stamina \(pool 8/);
		expect(text).toMatch(/save \{@dc \d+\}/);
		// combat methods should not also flood actions as generic features
		expect(mon.action.some(a => a.name === "Flowing Strike")).toBe(false);
	});

	it("exports specialty features that are activatable / important", () => {
		const s = makeBase("Specialist", {
			className: "Fighter",
			source: "TGTT",
			level: 5,
			abilities: {str: 16, con: 14, dex: 14},
			hp: 44,
		});
		s.addFeature({
			id: "spec-unyielding",
			name: "Unyielding Might",
			source: "TGTT",
			featureType: "Specialty",
			important: true,
			description: "You gain a bonus to Strength checks. As a bonus action, you can shove a creature within 5 feet.",
		});
		// Passive specialty bonus already represented as named modifier should be suppressible
		s.addNamedModifier({
			id: "nm-spec",
			name: "Unyielding Might",
			type: "check:str",
			value: 1,
			enabled: true,
			sourceFeatureId: "spec-unyielding",
		});
		armMelee(s);

		const mon = CharacterSheetNpcExporter.convertStateToMonster(s, {includeFeatures: "allImportant"});
		assertValidMonster(mon, "specialty");
		const blob = JSON.stringify(mon);
		// Either the specialty surfaces as bonus action (shove) or is summarized; must not crash and should mention shove/specialty/custom mods
		expect(/Unyielding Might|shove|Custom Modifiers/i.test(blob)).toBe(true);
	});

	it("exports divine favor innate spells and narrative features", () => {
		if (!PAN) return; // skip if brew missing

		const s = makeBase("PanDevotee", {
			className: "Cleric",
			level: 5,
			abilities: {wis: 16, str: 14, con: 14, cha: 12},
			hp: 40,
			spellAbility: "wis",
		});
		s.setDivineFavorCatalog([PAN]);
		s.setDivineFavorGod("Pan|TGTT");
		s.setDivineFavorLevel(25); // Disciple — includes narrative + multiple cast tiers
		addCasterSpells(s, {ability: "wis"});
		s.setArmor({name: "Scale Mail", ac: 14, type: "medium"});

		const mon = CharacterSheetNpcExporter.convertStateToMonster(s, {includeFeatures: "allImportant"});
		assertValidMonster(mon, "divine favor");

		const spellBlob = JSON.stringify(mon.spellcasting || []);
		expect(spellBlob).toMatch(/animal friendship|conjure animals/i);
		expect(mon.spellcasting.some(b => b.name === "Spellcasting")).toBe(true);
		expect(mon.spellcasting.some(b => b.name === "Innate Spellcasting")).toBe(true);

		// Narrative DF boons become features — should appear when important/allImportant
		const dfFeatures = (s.getFeatures() || []).filter(f => f._divineFavor);
		if (dfFeatures.length) {
			const featureBlob = JSON.stringify([...(mon.trait || []), ...(mon.action || []), ...(mon.bonus || [])]);
			// At least one divine favor feature name or Custom Modifiers for ability boosts
			expect(dfFeatures.some(f => featureBlob.includes(f.name)) || /Custom Modifiers|Divine Favor/i.test(featureBlob + spellBlob)).toBe(true);
		}
	});

	it("exports orbiting ioun stones and other magic items under Special Equipment", () => {
		const s = makeBase("Collector", {
			className: "Wizard",
			source: "XPHB",
			level: 5,
			abilities: {int: 16, con: 14, dex: 12},
			hp: 30,
			spellAbility: "int",
		});
		addCasterSpells(s, {ability: "int"});

		// Official orbiting ioun (attuned + equipped = benefit on)
		s.addItem({
			name: "Ioun Stone of Fortitude",
			source: "DMG",
			type: "W",
			rarity: "very rare",
			requiresAttunement: true,
			attuned: true,
			equipped: true,
			bonusAbilityScore: {con: 2},
			entries: ["This stone orbits your head at a distance of 1d3 feet. You gain a +2 bonus to Constitution while this stone orbits your head."],
		});
		// Homebrew bond-style stone
		s.addItem({
			name: "Ioun Stone #001, Pale Blue Rhomboid",
			source: "MECIounStones",
			type: "wondrous",
			rarity: "rare",
			requiresAttunement: true,
			attuned: true,
			equipped: true,
			entries: [
				{type: "entries", name: "Stone Effect", entries: ["It grants a +2 bonus to Strength while it orbits your head."]},
				{
					type: "entries",
					name: "General Ioun Stone Rules",
					entries: [{
						type: "entries",
						name: "Ioun Bond",
						entries: ["An Ioun bond is a special form of attunement and doesn't count against the number of magic items to which a creature can normally be attuned."],
					}],
				},
			],
		});
		s.addItem({
			name: "Cloak of Protection",
			source: "DMG",
			rarity: "uncommon",
			requiresAttunement: true,
			attuned: true,
			equipped: true,
			bonusAc: 1,
			bonusSavingThrow: 1,
		});
		s.addItem({
			name: "Staff of Fire",
			source: "DMG",
			rarity: "very rare",
			requiresAttunement: true,
			attuned: true,
			equipped: true,
			charges: 10,
			chargesCurrent: 7,
			activation: [{type: "action", cost: 1}],
			entries: ["You can use an action to expend 1 or more of the staff's charges to cast one of the following spells from it, using your spell save DC: fireball (3 charges)."],
		});
		// Stowed (not orbiting) stone — still inventory, should NOT confer but may or may not list depending on _isActiveItem
		s.addItem({
			name: "Ioun Stone of Protection",
			source: "DMG",
			type: "W",
			rarity: "rare",
			requiresAttunement: true,
			attuned: true,
			equipped: false,
			bonusAc: 1,
			entries: ["This stone orbits your head."],
		});

		s._calculateItemBonuses?.();

		const mon = CharacterSheetNpcExporter.convertStateToMonster(s);
		assertValidMonster(mon, "ioun+items");

		const special = mon.trait.find(t => t.name === "Special Equipment");
		expect(special).toBeDefined();
		const eqText = special.entries.join(" ");
		expect(eqText).toMatch(/Ioun Stone of Fortitude/);
		expect(eqText).toMatch(/orbiting/);
		expect(eqText).toMatch(/Pale Blue Rhomboid/);
		expect(eqText).toMatch(/Cloak of Protection/);
		expect(eqText).toMatch(/Staff of Fire/);
		// Stowed stone should not appear as active special equipment
		expect(eqText).not.toMatch(/Ioun Stone of Protection/);

		expect(mon.action.some(a => /Staff of Fire/i.test(a.name))).toBe(true);

		// Ioun detection still works for manager API (orbiting = equipped+attuned)
		const orbiting = (s.getItems() || []).filter(it => CharacterSheetIoun.isIounStone(it) && it.equipped && it.attuned);
		expect(orbiting.length).toBeGreaterThanOrEqual(2);
	});

	it("exports Channel Divinity style limited-use features into actions", () => {
		const s = makeBase("Priest", {
			className: "Cleric",
			level: 5,
			abilities: {wis: 16, str: 14, con: 14},
			hp: 40,
			spellAbility: "wis",
		});
		addCasterSpells(s, {ability: "wis"});
		s.addFeature({
			name: "Channel Divinity: Turn Undead",
			source: "PHB",
			important: true,
			uses: {current: 1, max: 1, recharge: "short"},
			description: "As an action, you present your holy symbol and each undead that can see or hear you within 30 feet of you must make a Wisdom saving throw. If the creature fails its saving throw, it is turned for 1 minute or until it takes any damage.",
		});
		s.addResource({name: "Channel Divinity", max: 1, current: 1, recharge: "short"});
		s.setArmor({name: "Scale Mail", ac: 14, type: "medium"});

		const mon = CharacterSheetNpcExporter.convertStateToMonster(s, {includeFeatures: "allImportant"});
		assertValidMonster(mon, "channel divinity");
		const blob = JSON.stringify([...(mon.action || []), ...(mon.trait || [])]);
		expect(blob).toMatch(/Turn Undead|Channel Divinity/);
		// Prefer action economy routing for "as an action"
		const inActions = (mon.action || []).some(a => /Turn Undead|Channel Divinity/i.test(a.name));
		const inTraits = (mon.trait || []).some(t => /Turn Undead|Channel Divinity/i.test(t.name));
		expect(inActions || inTraits).toBe(true);
	});

	it("exports gemstone / armor-upgrade notes when state provides them", () => {
		const s = makeBase("Upgraded", {
			className: "Fighter",
			level: 5,
			abilities: {str: 16, con: 14, dex: 12},
			hp: 44,
		});
		armMelee(s);
		s.setArmor({name: "Plate", ac: 18, type: "heavy"});
		// Stub upgrade APIs the exporter already calls
		s.getArmorUpgradeNotes = () => ([
			{label: "Reinforced Plating", description: "Reduce bludgeoning damage by 3."},
		]);
		s.getGemstonePassiveNotes = () => ([
			"Socketed Ruby: +1 fire damage on weapon attacks.",
		]);

		const mon = CharacterSheetNpcExporter.convertStateToMonster(s);
		assertValidMonster(mon, "upgrades");
		expect(mon.trait.some(t => t.name === "Armor Upgrades")).toBe(true);
		expect(mon.trait.some(t => t.name === "Gemstone Effects")).toBe(true);
		expect(mon.trait.find(t => t.name === "Gemstone Effects").entries.join(" ")).toMatch(/Ruby/);
	});

	it("keeps custom abilities and named modifiers in the statblock", () => {
		const s = makeBase("Custom", {
			className: "Fighter",
			level: 3,
			abilities: {str: 16, con: 14, dex: 12},
			hp: 28,
		});
		armMelee(s);
		s.addCustomAbility({
			name: "Heroic Roar",
			description: "Allies within 30 feet gain advantage on their next attack roll.",
			category: "combat",
			mode: "activatable",
			activationAction: "bonus",
		});
		s.addNamedModifier({
			name: "Lucky Charm",
			type: "save:all",
			value: 1,
			enabled: true,
		});

		const mon = CharacterSheetNpcExporter.convertStateToMonster(s);
		assertValidMonster(mon, "custom");
		expect((mon.bonus || []).some(a => a.name === "Heroic Roar")
			|| (mon.action || []).some(a => a.name === "Heroic Roar")
			|| (mon.trait || []).some(t => /Heroic Roar|Custom Abilities/i.test(t.name + (t.entries || []).join(" ")))).toBe(true);
		expect((mon.trait || []).some(t => t.name === "Custom Modifiers" || /Lucky Charm/i.test((t.entries || []).join(" ")))).toBe(true);
	});

	it("does not crash when legendary + special systems combine", () => {
		const s = makeBase("Boss", {
			className: "Paladin",
			level: 12,
			abilities: {str: 18, cha: 16, con: 16},
			hp: 120,
			spellAbility: "cha",
		});
		addCasterSpells(s, {ability: "cha", half: true});
		armMelee(s, "Greatsword");
		s.addItem({
			name: "Holy Avenger",
			source: "DMG",
			rarity: "legendary",
			requiresAttunement: true,
			attuned: true,
			equipped: true,
			bonusWeapon: 3,
			type: "M",
			dmg1: "2d6",
			dmgType: "slashing",
			weaponCategory: "martial",
			property: ["H", "2H"],
			entries: ["You have a +3 bonus to attack and damage rolls made with this magic weapon."],
		});
		s.addFeature({
			name: "Flowing Strike",
			source: "TGTT",
			featureType: "Optional Feature",
			optionalFeatureTypes: ["CTM:2RC"],
			description: "As an Action (1 Stamina Point), make a quick strike.",
		});
		s.setStaminaMax(6);
		if (PAN) {
			s.setDivineFavorCatalog([PAN]);
			s.setDivineFavorGod("Pan|TGTT");
			s.setDivineFavorLevel(10);
		}

		const mon = CharacterSheetNpcExporter.convertStateToMonster(s, {
			legendaryEnabled: true,
			legendaryActions: 3,
			legendaryResistances: 3,
			includeFeatures: "allImportant",
			includeCrBreakdown: true,
		});
		assertValidMonster(mon, "combined boss");
		expect(mon.legendaryActions).toBe(3);
		expect((mon.trait || []).some(t => /Legendary Resistance/.test(t.name))).toBe(true);
		expect((mon.trait || []).some(t => t.name === "Combat Methods" || t.name === "Special Equipment")).toBe(true);
		expect(mon.spellcasting?.length).toBeGreaterThan(0);
	});
});
