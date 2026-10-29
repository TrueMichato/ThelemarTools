import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";

const State = globalThis.CharacterSheetState;
const Exporter = globalThis.CharacterSheetNpcExporter;
const tgtt = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));
const cleric = JSON.parse(fs.readFileSync("data/class/class-cleric.json", "utf8"));
const makeState = () => {
	const state = new State({isDetached: true});
	state.setAbilityBase("str", 18);
	state.setAbilityBase("dex", 18);
	return state;
};
const addWeapon = (state, item = {}) => state.addItem({
	name: "Sword", source: "TEST", type: "M", dmg1: "1d8", dmgType: "S", equipped: true, ...item,
});
const sleepRule = "When you hit a creature using this ammunition, instead of dealing damage roll {@dice 5d8}. If its hit points are below the total, it falls {@condition unconscious} for 1 hour, until it takes damage, or until someone uses an action to wake it. Undead and creatures immune to being {@condition charmed} are unaffected. After one hit, the ammunition becomes a normal dart.";

describe.each(["complete", "compact"])("attack procedures and riders (%s)", presentationMode => {
	const exportState = state => Exporter.convertStateToMonster(state, {presentationMode});
	const action = (monster, name) => monster.action.find(entry => entry.name === name);

	it.each([false, true])("F03: replaces Sleep Dart damage and preserves its complete procedure (nested=%s)", nested => {
		const state = makeState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		addWeapon(state, {name: "Sleep Dart", type: "R", dmg1: "1d4", dmgType: "P", entries: nested ? [{type: "entries", name: "Sleep", entries: [{type: "list", items: [sleepRule]}]}] : [sleepRule]});
		const monster = exportState(state);
		expect(Exporter.getValidationIssues(monster).errors).toEqual([]);
		const dart = JSON.stringify(action(monster, "Sleep Dart"));
		expect(dart).toContain("{@dice 5d8}");
		expect(dart).toContain("1 hour");
		expect(dart).toContain("Undead");
		expect(dart).toContain("normal dart");
		expect(dart).not.toMatch(/\{@damage 1d4/);
	});

	it("does not replace ordinary dart damage or lift an optional replacement into automatic damage", () => {
		const state = makeState();
		addWeapon(state, {name: "Ordinary Dart", type: "R", dmg1: "1d4", dmgType: "P"});
		addWeapon(state, {name: "Optional Dart", type: "R", dmg1: "1d4", dmgType: "P", entries: ["On a hit, you can expend 1 charge to roll {@dice 5d8} instead of dealing damage."]});
		const monster = exportState(state);
		expect(JSON.stringify(action(monster, "Ordinary Dart"))).toContain("{@damage 1d4+4}");
		const optional = JSON.stringify(action(monster, "Optional Dart"));
		expect(optional).toContain("{@damage 1d4+4}");
		expect(optional).toContain("1 charge");
		expect(optional).toContain("instead of dealing damage");
	});

	it("uses an explicitly acquired, catalog-owned Blessed Strikes option on ranged weapon hits", () => {
		const state = makeState();
		state.setClassCatalog([...tgtt.class]);
		state.addClass({name: "Cleric", source: "TGTT", level: 13});
		const definition = cleric.classFeature.find(feature => feature.name === "Divine Strike" && feature.source === "XPHB");
		expect(definition).toBeDefined();
		state.addFeature({...definition, parentFeature: "Blessed Strikes", isFeatureOption: true});
		addWeapon(state, {name: "Bow", type: "R", dmgType: "P"});
		expect(state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBe("Divine Strike");
		const line = action(exportState(state), "Bow").entries[0];
		expect(line).toMatch(/\{@damage 1d8\} necrotic or radiant damage/i);
		expect(line).toMatch(/Divine Strike, once (?:on each of its turns|per turn on its turn)/);
	});

	it("does not infer an unrecorded modern Blessed Strikes choice", () => {
		const state = makeState();
		state.setClassCatalog([...tgtt.class]);
		state.addClass({name: "Cleric", source: "TGTT", level: 13});
		addWeapon(state);
		expect(state.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBeNull();
		expect(action(exportState(state), "Sword").entries[0]).not.toContain("Divine Strike");
	});

	it("does not retire a rider source when its only weapon replaces damage", () => {
		const state = makeState();
		state.addClass({name: "Cleric", source: "PHB", level: 8, subclass: {name: "Tempest Domain", shortName: "Tempest", source: "PHB"}});
		state.addFeature({name: "Divine Strike", source: "PHB", description: "Once on each of your turns when you hit with a weapon attack, deal an extra {@damage 1d8} thunder damage."});
		addWeapon(state, {name: "Sleep Dart", type: "R", dmg1: "1d4", entries: [sleepRule]});
		const monster = exportState(state);
		expect(action(monster, "Sleep Dart").entries[0]).not.toContain("Divine Strike");
		expect(monster.trait.some(entry => /Divine Strike/.test(entry.name))).toBe(true);
	});

	it("F45: treats Divine Fury as first-hit raging damage, not an independent attack", () => {
		const state = makeState();
		state.addClass({name: "Barbarian", source: "PHB", level: 20, subclass: {name: "Path of the Zealot", shortName: "Zealot", source: "XGE"}});
		state.addFeature({name: "Divine Fury", source: "XGE", description: "While raging, the first creature you hit on each of your turns with a weapon attack takes an extra 1d6 plus half your barbarian level in necrotic or radiant damage."});
		state.addAttack({name: "Divine Fury", damage: "1d6+10", damageType: "radiant", isMelee: true});
		addWeapon(state);
		const monster = exportState(state);
		const line = action(monster, "Sword").entries[0];
		expect(line).toContain("{@damage 1d6+10} necrotic or radiant damage");
		expect(line).toMatch(/Divine Fury, .*first hit.*its turns.*raging/);
		expect(action(monster, "Divine Fury")).toBeUndefined();
	});

	it.each([13, 14])("F13: limits the third attack to source-owned chains at level %i", level => {
		const state = makeState();
		state.addClass({name: "Barbarian", source: "TGTT", level, subclass: {name: "Path of the Chained Fury", shortName: "Chained Fury", source: "TGTT"}});
		for (const feature of tgtt.subclassFeature.filter(feature => feature.subclassShortName === "Chained Fury" && feature.level <= level)) state.addFeature(feature);
		addWeapon(state, {name: "Greatsword", dmg1: "2d6"});
		const monster = exportState(state);
		const routine = JSON.stringify(action(monster, "Multiattack"));
		if (level === 14) {
			expect(routine).toMatch(/three Spectral Chains attacks/i);
			expect(routine).toMatch(/all (?:three )?attacks.*chains/i);
			expect(routine).toMatch(/rag(?:e|ing)/i);
			expect(routine).not.toMatch(/three Greatsword attacks/i);
		} else expect(routine).not.toContain("three");
	});

	it("F51: preserves every composite weapon procedure without making paid damage automatic", () => {
		const state = makeState();
		state.addClass({name: "Fighter", source: "PHB", level: 12});
		addWeapon(state, {
			name: "Composite Bow",
			type: "R",
			dmgType: "P",
			entries: [{type: "entries",
				name: "Composite Rules",
				entries: [
					"On a hit, the weapon deals an extra {@damage 1d4} force damage and deals an extra {@damage 2d8} radiant damage.",
					{type: "list", items: [{type: "item", name: "Ethereal Shot", entries: ["On a hit, you can expend 2 charges to deal an extra {@damage 6d6} force damage. The target must be on the Ethereal Plane."]}]},
					"The wielder can leap 20 feet as a bonus action. A fiend slain by this weapon cannot return for 24 hours.",
				]}],
		});
		const bow = action(exportState(state), "Composite Bow");
		expect(bow.entries[0]).toContain("{@damage 1d4} force damage");
		expect(bow.entries[0]).toContain("{@damage 2d8} radiant damage");
		expect(bow.entries[0]).not.toContain("{@damage 6d6}");
		const text = JSON.stringify(bow);
		expect(text).toContain("Ethereal Shot");
		expect(text).toContain("2 charges");
		expect(text).toContain("Ethereal Plane");
		expect(text).toContain("20 feet");
		expect(text).toContain("24 hours");
	});

	it("does not turn a conditional second damage clause into an automatic rider", () => {
		const state = makeState();
		addWeapon(state, {entries: ["On a hit, the weapon deals an extra {@damage 1d4} force damage. If the target fails a saving throw, it takes an extra {@damage 2d8} radiant damage."]});
		const sword = action(exportState(state), "Sword");
		expect(sword.entries[0]).not.toContain("{@damage 2d8}");
		expect(JSON.stringify(sword)).toContain("saving throw");
		expect(JSON.stringify(sword)).toContain("{@damage 2d8}");
	});
});
