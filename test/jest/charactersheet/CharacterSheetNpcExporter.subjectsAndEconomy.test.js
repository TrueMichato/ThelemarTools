import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {getNpcExportSchemaErrors} from "../../util-npc-export-schema.js";

const State = globalThis.CharacterSheetState;
const Exporter = globalThis.CharacterSheetNpcExporter;
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const tgtt = read("homebrew/TravelersGuidetoThelemar.json");
const cleric = read("data/class/class-cleric.json");
const bard = read("data/class/class-bard.json");
const rogue = read("data/class/class-rogue.json");
const maneuvers = read("data/optionalfeatures.json").optionalfeature;
const feats = read("data/feats.json").feat;
const toHtml = value => {
	if (typeof value === "string") return `<p>${value}</p>`;
	if (Array.isArray(value)) return value.map(toHtml).join("");
	if (!value || typeof value !== "object") return "";
	return `${value.name ? `<h3>${value.name}</h3>` : ""}${toHtml(value.entries || value.items || [])}`;
};
const add = (state, feature, overrides = {}) => {
	if (!feature) throw new Error("Missing authoritative feature fixture");
	state.addFeature({...feature, description: toHtml(feature.entries), important: true, ...overrides});
};
const all = monster => ["trait", "action", "bonus", "reaction"].flatMap(section => monster[section] || []);
const plain = entry => Exporter._getPlainMatchTextCased(JSON.stringify(entry));
const find = (monster, name) => all(monster).find(entry => entry.name.includes(name));
const makeState = () => {
	const state = new State({isDetached: true});
	state.setName("Keeper");
	state.addClass({name: "Cleric", source: "XPHB", level: 20});
	return state;
};
const power = (name, {concentration = false, reaction = false} = {}) => ({
	name,
	source: "TalPsi",
	_entityType: "psionicPower",
	_psionicOrder: 2,
	order: "2nd-Order",
	entries: [
		`{@b Manifestation Time:} ${reaction ? "1 reaction, which you take in response to being damaged by a creature within 60 feet of you that you can see" : "1 action"}`,
		`{@b Range:} ${reaction ? 60 : 30} feet`,
	],
	modes: [{
		name: "2nd-Order",
		...(concentration ? {concentration: {duration: 1, unit: "min"}} : {}),
		entries: [reaction
			? "That creature must make a Wisdom saving throw, taking {@damage 1d12} psychic damage on a failed save, or half as much damage on a successful one."
			: name === "Choke"
				? "One Large or smaller creature of your choice that you can see within range must make a Dexterity saving throw. On a failure, the target is {@condition restrained} for the duration (save ends at end of turn). A creature restrained in this way takes {@damage 1d6} force damage at the start of each of their turns."
				: "For the duration, each time a target takes damage, the damage is reduced by {@damage 1d4} (to a minimum 0 damage)."],
	}],
});

describe.each(["complete", "compact"])("NPC subjects, triggers and procedures (%s)", presentationMode => {
	const exportState = state => {
		const monster = Exporter.convertStateToMonster(state, {
			presentationMode, includeFeatures: "manual", selectedFeatureIds: state.getFeatures().map(feature => feature.id),
		});
		expect(getNpcExportSchemaErrors({data: {monster: [monster]}, kind: "bestiary", filePath: "subject-economy-regression"})).toEqual([]);
		return monster;
	};

	it("F25: Turn Undead distinguishes the caster's incapacitation/death from its affected targets", () => {
		const state = makeState();
		add(state, cleric.classFeature.find(feature => feature.name === "Turn Undead" && feature.source === "XPHB"));
		const output = plain(find(exportState(state), "Turn Undead"));
		expect(output).toMatch(/if Keeper has the Incapacitated condition/i);
		expect(output).toMatch(/if Keeper dies/i);
		expect(output).toMatch(/if (?:the creature|it) takes any damage/i);
	});

	it("F25: the Bard, not the animated item, spends the command bonus action", () => {
		const state = makeState();
		add(state, bard.subclassFeature.find(feature => feature.name === "Animating Performance"));
		const output = plain(find(exportState(state), "Animating Performance"));
		expect(output).toMatch(/unless Keeper takes a bonus action/i);
		expect(output).toMatch(/if Keeper is incapacitated/i);
		expect(output).toMatch(/item can take any action of its choice/i);
	});

	it.each([
		["Graceful Fall", "classFeature", "trait"],
		["Chain Imprisonment", "subclassFeature", "trait"],
		["Manifest Chains", "subclassFeature", "trait"],
		["Spellsword Technique", "feat", "trait"],
	])("F34: classifies %s by its primary rule, not a subordinate economy word", (name, kind, section) => {
		const state = makeState();
		state.addClass({name: "Barbarian", source: "TGTT", level: 20});
		add(state, tgtt[kind].find(feature => feature.name === name));
		const monster = exportState(state);
		expect((monster[section] || []).map(entry => entry.name).join("|")).toMatch(new RegExp(name));
	});

	it("F34: Soul Drinker's healing retains its real reaction cost", () => {
		const state = makeState();
		add(state, feats.find(feature => feature.name === "Boon of the Soul Drinker"), {featureType: "Feat"});
		const monster = exportState(state);
		const entry = (monster.reaction || []).find(row => /Soul Drinker/.test(row.name));
		expect(entry).toBeDefined();
		expect(plain(entry)).toMatch(/reaction to regain 50/i);
	});

	it("F33: Share Pain includes its visible damaging-creature reaction trigger", () => {
		const state = makeState();
		add(state, power("Share Pain", {reaction: true}));
		const entry = (exportState(state).reaction || []).find(row => row.name.startsWith("Share Pain"));
		expect(entry).toBeDefined();
		const output = plain(entry);
		expect(output).toMatch(/damaged by a creature within 60 (?:feet|ft\.)/i);
		expect(output).toMatch(/(?:Keeper|it) can see/i);
		expect(output).toContain("1d12");
		expect(output).toMatch(/half as much damage/i);
	});

	it.each(["Choke", "Intuition"])("F33: %s keeps structured one-minute concentration and its actual effect", name => {
		const state = makeState();
		add(state, power(name, {concentration: true}));
		const output = plain(find(exportState(state), name));
		expect(output).toMatch(/concentration[^.]{0,40}1 minute/i);
		if (name === "Choke") {
			expect(output).toMatch(/target is restrained/i);
			expect(output).toMatch(/1d6 force damage at the start of each/i);
		} else expect(output).toMatch(/damage is reduced by 1d4/i);
	});

	it("F39: maneuver rosters retain the ally's reaction attack and rolled AC bonus duration", () => {
		const state = makeState();
		for (const name of ["Commander's Strike", "Bait and Switch"]) {
			add(state, maneuvers.find(feature => feature.name === name && ["PHB", "TCE"].includes(feature.source)), {
				optionalFeatureTypes: ["MV:B"],
			});
		}
		const output = plain(all(exportState(state)));
		expect(output).toMatch(/creature can immediately use its reaction to make one weapon attack/i);
		expect(output).toMatch(/adding the superiority die to the attack's damage roll/i);
		expect(output).toMatch(/until the start of (?:Keeper's|its) next turn/i);
		expect(output).toMatch(/bonus to AC equal to the number rolled/i);
	});

	it("F53: keeps vs. and measurement abbreviations inside their mechanical clause", () => {
		const state = makeState();
		add(state, {name: "Primal Focus Upgrade",
			source: "TEST",
			entries: [
				"As an action, you force a Wisdom save vs. your spell save DC; on a failure, the target cannot move beyond 10 ft. of the chosen point.",
			]});
		const entry = find(exportState(state), "Primal Focus Upgrade");
		expect(entry.entries.filter(it => typeof it === "string").join(" ")).toMatch(/save vs\. (?:spell save )?\{@dc \d+\}/i);
		expect(all(exportState(state)).some(row => /^Its spell save DC/.test(row.name))).toBe(false);
	});

	it("keeps a referenced option's parent-owned save DC after primary trait classification", () => {
		const state = new State({isDetached: true});
		state.setName("Keeper");
		state.addClass({name: "Rogue", source: "TGTT", level: 13});
		state.setAbilityBase("dex", 18);
		for (const name of ["Cunning Strike", "Trip (Cost: 1d6)"]) {
			add(state, rogue.classFeature.find(feature => feature.name === name && feature.source === "XPHB"));
		}
		const entry = find(exportState(state), "Trip (Cost");
		expect(JSON.stringify(entry)).toMatch(/Dexterity saving throw \(\{@dc 17\}\)/);
		expect(plain(entry)).toMatch(/Large or smaller/);
		expect(plain(entry)).toMatch(/Prone/i);
	});

	it("does not charge a reaction for an explicitly free triggered effect", () => {
		const state = makeState();
		add(state, {name: "Free Ward",
			source: "TEST",
			entries: [
				"When a creature hits you, you gain 5 temporary hit points. This does not use your reaction.",
			]});
		const monster = exportState(state);
		expect((monster.trait || []).some(entry => entry.name.includes("Free Ward"))).toBe(true);
		expect((monster.reaction || []).some(entry => entry.name.includes("Free Ward"))).toBe(false);
	});
});
