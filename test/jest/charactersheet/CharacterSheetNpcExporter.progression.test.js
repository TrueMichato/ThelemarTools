import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";

const State = globalThis.CharacterSheetState;
const Exporter = globalThis.CharacterSheetNpcExporter;
const MODES = ["complete", "compact"];
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const barbarian = read("data/class/class-barbarian.json");
const monk = read("data/class/class-monk.json");
const cleric = read("data/class/class-cleric.json");
const warlock = read("data/class/class-warlock.json");
const feats = read("data/feats.json").feat;
const tgtt = read("homebrew/TravelersGuidetoThelemar.json");
const rows = monster => ["trait", "action", "bonus", "reaction"].flatMap(section => monster[section] || []);
const text = monster => Exporter._getPlainMatchTextCased(JSON.stringify(rows(monster)));

const toHtml = value => {
	if (typeof value === "string") return `<p>${value}</p>`;
	if (Array.isArray(value)) return value.map(toHtml).join("");
	if (!value || typeof value !== "object") return "";
	return `${value.name ? `<h3>${value.name}</h3>` : ""}${toHtml(value.entries || value.items || [])}`;
};
const add = (state, definition, overrides = {}) => {
	expect(definition).toBeDefined();
	state.addFeature({...definition, description: toHtml(definition.entries), ...overrides});
};
const exportAll = (state, presentationMode) => Exporter.convertStateToMonster(state, {
	presentationMode,
	includeFeatures: "manual",
	selectedFeatureIds: state.getFeatures().map(feature => feature.id),
});

describe.each(MODES)("NPC export source-qualified progression (%s)", presentationMode => {
	it("F09: keeps XPHB Rage upkeep and casting restrictions rather than substituting PHB rules", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Barbarian", source: "XPHB", level: 8});
		add(state, barbarian.classFeature.find(feature => feature.name === "Rage" && feature.source === "XPHB"));
		const output = text(exportAll(state, presentationMode));
		expect(output).toMatch(/can't (?:maintain|cast)|can't[^.]*cast/i);
		expect(output).toMatch(/10 minutes/i);
		expect(output).not.toContain("taken damage since the last turn");
	});

	it("F09: keeps XPHB Alert's initiative swap without inventing PHB surprise immunity", () => {
		const state = new State({isDetached: true});
		add(state, feats.find(feat => feat.name === "Alert" && feat.source === "XPHB"), {featureType: "Feat"});
		const output = text(exportAll(state, presentationMode));
		expect(output).toMatch(/swap/i);
		expect(output).toMatch(/willing ally/i);
		expect(output).not.toMatch(/can't be surprised|unseen attackers/i);
	});

	it.each(["PHB", "XPHB"])("F09: preserves %s Reckless Attack's Strength requirement", source => {
		const state = new State({isDetached: true});
		state.addClass({name: "Barbarian", source, level: 8});
		add(state, barbarian.classFeature.find(feature => feature.name === "Reckless Attack" && feature.source === source));
		const output = text(exportAll(state, presentationMode));
		expect(output).toMatch(/Strength/i);
		expect(output).toMatch(source === "XPHB" ? /next turn/i : /melee weapon/i);
	});

	it("F10: retains both PHB Great Weapon Master options", () => {
		const state = new State({isDetached: true});
		add(state, feats.find(feat => feat.name === "Great Weapon Master" && feat.source === "PHB"), {featureType: "Feat"});
		const output = text(exportAll(state, presentationMode));
		expect(output).toContain("-5");
		expect(output).toContain("+10");
		expect(output).toMatch(/bonus action/i);
	});

	it("F10: retains PHB Sentinel's Disengage bypass and ordinary reaction attack", () => {
		const state = new State({isDetached: true});
		add(state, feats.find(feat => feat.name === "Sentinel" && feat.source === "PHB"), {featureType: "Feat"});
		const output = text(exportAll(state, presentationMode));
		expect(output).toMatch(/Disengage/i);
		expect(output).toMatch(/reaction to make a melee weapon attack/i);
	});

	it("F10: preserves PHB Shield Master's single-target save bonus and reaction cost", () => {
		const state = new State({isDetached: true});
		add(state, feats.find(feat => feat.name === "Shield Master" && feat.source === "PHB"), {featureType: "Feat"});
		const output = text(exportAll(state, presentationMode));
		expect(output).toMatch(/targets only/i);
		expect(output).toMatch(/reaction to take no damage/i);
	});

	it("F21: does not promote a Warlock-3 tentacle to the total-level-13 damage", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Fighter", source: "PHB", level: 10});
		state.addClass({name: "Warlock", source: "TGTT", level: 3});
		add(state, warlock.subclassFeature.find(feature => feature.name === "Tentacle of the Deeps" && feature.source === "TCE"));
		const output = text(exportAll(state, presentationMode));
		expect(output).toContain("1d8");
		expect(output).not.toContain("2d8");
	});

	it("F22: leaves the sub-20 PHB Divine Intervention percentile procedure in force", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Cleric", source: "PHB", level: 13});
		add(state, cleric.classFeature.find(feature => feature.name === "Divine Intervention" && feature.source === "PHB"));
		const output = text(exportAll(state, presentationMode));
		expect(output).toMatch(/percentile dice|d100/i);
		expect(output).not.toMatch(/succeeds automatically|no roll required/i);
	});

	it("F22: does not treat an unresolved future gate as permission to delete the percentile procedure", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Fighter", source: "PHB", level: 20});
		add(state, cleric.classFeature.find(feature => feature.name === "Divine Intervention" && feature.source === "PHB"));
		const output = text(exportAll(state, presentationMode));
		expect(output).toMatch(/percentile dice|d100/i);
		expect(output).toMatch(/20th level/i);
	});

	it("F23: projects a numeric spell attack after the NPC's possessive and range prose are substituted", () => {
		const state = new State({isDetached: true});
		state.setName("Arthur");
		state.addClass({name: "Fighter", source: "PHB", level: 20});
		state.setAbilityBase("int", 20);
		state.addFeature({
			name: "Orbital Attack",
			source: "TEST",
			className: "Fighter",
			classSource: "PHB",
			description: "You can use a bonus action to make a ranged spell attack against a target you can see within 30 feet of you. Intelligence is your ability modifier for this attack. On a hit, it deals force damage equal to 1d4 + your Intelligence modifier. Being within 5 feet of a hostile creature does not impose disadvantage. When you reach 10th level in this class, the range of this spell attack increases to 60 feet. The damage increases when you reach certain levels in this class: 10th level (1d6) and 18th level (1d8).",
		});
		const output = JSON.stringify(rows(exportAll(state, presentationMode)));
		expect(output).toMatch(/\{@atk rs\} \{@hit \+?11\} to hit, range 60 ft/);
		expect(output).toContain("{@damage 1d8+5}");
	});

	it("F23: updates an attack's range and die without rewriting its hostile-proximity exception", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Fighter", source: "PHB", level: 20});
		state.addFeature({
			name: "Orbital Attack",
			className: "Fighter",
			classSource: "PHB",
			source: "TEST",
			description: "As a bonus action, you make a ranged spell attack against a target you can see within 30 feet of you. Intelligence is your ability modifier for this attack. On a hit, it deals force damage equal to 1d4 + your Intelligence modifier. Being within 5 feet of a hostile creature does not impose disadvantage. When you reach 10th level in this class, the range of this spell attack increases to 60 feet. The damage increases when you reach certain levels in this class: 10th level (1d6) and 18th level (1d8).",
		});
		const output = text(exportAll(state, presentationMode));
		expect(output).toContain("within 5 feet of a hostile creature");
		expect(output).toMatch(/(?:range 60 ft|within 60 feet)/);
		expect(output).toContain("1d8");
		expect(output).not.toMatch(/(?:damage equal to|Hit:)[^.]*1d4/);
	});

	it("F21/F23: applies the latest eligible die row, not the greatest face-count product", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Fighter", source: "PHB", level: 14});
		state.addFeature({name: "Growing Lash", source: "TEST", className: "Fighter", classSource: "PHB", description: "As an action, you deal 1d8 force damage. The damage increases to 1d12 at 10th level, and 2d6 at 14th level."});
		const output = text(exportAll(state, presentationMode));
		expect(output).toMatch(/deal(?:s)? 2d6 force damage/);
		expect(output).not.toMatch(/deal(?:s)? 1d12 force damage/);
	});

	it("F38: retains an independent benefit alongside a level-gated quantity upgrade", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Fighter", source: "PHB", level: 10});
		state.addFeature({name: "Growing Bolt", source: "TEST", className: "Fighter", classSource: "PHB", description: "As an action, you deal 1d6 force damage. When you reach 10th level in this class, the damage becomes 1d10 and you can ignore half cover."});
		const output = text(exportAll(state, presentationMode));
		expect(output).toMatch(/ignore half cover/i);
	});

	it("F14: reconciles current XPHB Flurry attack count", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Monk", source: "XPHB", level: 13});
		add(state, monk.classFeature.find(feature => feature.name === "Flurry of Blows" && feature.source === "XPHB"));
		add(state, monk.classFeature.find(feature => feature.name === "Heightened Focus" && feature.source === "XPHB"));
		expect(state.getFeatureCalculations().heightenedFlurryAttacks).toBe(3);
		const output = text(exportAll(state, presentationMode));
		expect(output).toMatch(/(?:three|3) Unarmed Strikes/i);
		expect(output).not.toMatch(/make two Unarmed Strikes/i);
	});

	it("F14: reconciles both current Brutal Strike damage and selectable effects", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Barbarian", source: "XPHB", level: 20});
		for (const feature of barbarian.classFeature.filter(feature => feature.source === "XPHB" && /^(?:Improved )?Brutal Strike$/.test(feature.name))) add(state, feature);
		const output = text(exportAll(state, presentationMode));
		expect(output).toContain("2d10");
		expect(output).not.toContain("1d10");
		expect(output).toMatch(/two (?:different )?Brutal Strike effects/i);
		expect(output).not.toMatch(/cause one Brutal Strike effect/i);
	});

	it("F14: resolves the reported XPHB Warrior of the Gods pool to seven d12s", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Barbarian", source: "XPHB", level: 20, subclass: {name: "Path of the Zealot", shortName: "Zealot", source: "XPHB"}});
		add(state, barbarian.subclassFeature.find(feature => feature.name === "Warrior of the Gods" && feature.source === "XPHB"));
		const output = text(exportAll(state, presentationMode));
		expect(output).toMatch(/7d12|seven d12|7 d12/i);
		expect(output).not.toMatch(/pool of four d12/i);
	});

	it("F14: uses canonical Chained Fury damage and reach throughout its source rules", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Barbarian", source: "TGTT", level: 20, subclass: {name: "Path of the Chained Fury", shortName: "Chained Fury", source: "TGTT"}});
		for (const feature of tgtt.subclassFeature.filter(feature => ["Manifest Chains", "Chain Imprisonment", "Unchained Fury"].includes(feature.name))) add(state, feature);
		const calc = state.getFeatureCalculations();
		expect(calc.chainDamageDie).toBe("2d6");
		expect(calc.chainRange).toBe(30);
		const output = text(exportAll(state, presentationMode));
		expect(output).not.toMatch(/range of (?:15|20) feet/);
		expect(output).not.toMatch(/deal (?:1d8|1d10|1d12) force damage/i);
	});

	it("F38: applying a die upgrade does not erase the other benefit in the same sentence", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Sorcerer", source: "XPHB", level: 14});
		state.addFeature({name: "Radiant Fire", source: "FRHoF", className: "Sorcerer", classSource: "XPHB", description: "As a bonus action, a target takes 1d4 radiant damage."});
		state.addFeature({name: "Honed Spellfire", source: "FRHoF", className: "Sorcerer", classSource: "XPHB", description: "You add your Sorcerer level to the temporary hit points gained from Bolstering Flames, and the damage of Radiant Fire increases to 1d8."});
		const output = text(exportAll(state, presentationMode));
		expect(output).toContain("1d8");
		expect(output).toMatch(/(?:Sorcerer level \(14\)|14)[^.]*temporary hit points/i);
		expect(output).not.toMatch(/target takes 1d4 radiant damage/i);
	});
});
