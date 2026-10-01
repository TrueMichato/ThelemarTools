import fs from "node:fs";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-levelup.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;
const ranger = JSON.parse(fs.readFileSync("data/class/class-ranger.json", "utf8"))
	.class.find(cls => cls.name === "Ranger" && cls.source === "PHB");
const druid = JSON.parse(fs.readFileSync("data/class/class-druid.json", "utf8"))
	.class.find(cls => cls.name === "Druid" && cls.source === "PHB");
const fighter = JSON.parse(fs.readFileSync("data/class/class-fighter.json", "utf8"))
	.class.find(cls => cls.name === "Fighter" && cls.source === "PHB");

let CharacterSheetPage;

beforeAll(async () => {
	globalThis.window ||= {addEventListener: () => {}};
	await import("../../../js/charactersheet/charactersheet.js");
	CharacterSheetPage = globalThis.CharacterSheetPage;
});

const makeRangerDruid = () => {
	const state = new CharacterSheetState();
	state.addClass({name: ranger.name, source: ranger.source, level: 1});
	state.applyFirstClassStartingProficiencies(ranger);
	state.addClass({name: druid.name, source: druid.source, level: 1});
	const levelUp = Object.create(CharacterSheetLevelUp.prototype);
	levelUp._state = state;
	const grants = levelUp._applyMulticlassProficiencies(druid);
	return {state, grants};
};

describe("multiclass proficiency identity and provenance", () => {
	it("does not double-store Ranger's armor when Druid grants equivalent proficiencies", () => {
		const {state, grants} = makeRangerDruid();
		expect(grants.armor).toContain("Light armor");
		for (const token of ["light", "medium", "shields"]) {
			expect(state.getArmorProficiencies()
				.filter(value => state._normalizeArmorProfToken(value) === token)).toHaveLength(1);
		}
		expect(state.getProficiencies().armor).toHaveLength(3);

		state.applyClassFeatureEffects();
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getProficiencies().armor).toHaveLength(3);
		expect(loaded.toJson()._firstClassStartGrants.armor).toEqual(state.toJson()._firstClassStartGrants.armor);

		// The multiclass grant ledger may record an attempted grant which did not add
		// a new row. Removing it must not remove the first class's raw token.
		for (const armor of grants.armor) loaded.removeArmorProficiency(armor);
		for (const token of ["light", "medium", "shields"]) expect(loaded.hasArmorProficiency(token)).toBe(true);
	});

	it("collapses descriptive and canonical weapon categories but keeps named grants", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 1});
		state.addWeaponProficiency("simple");
		state.addWeaponProficiency("martial");
		state.addWeaponProficiency("Simple weapons");
		state.addWeaponProficiency("Martial Weapons");
		state.addWeaponProficiency("Longsword");
		state.addWeaponProficiency("Shortsword");
		expect(state.getWeaponProficiencies()).toEqual(["simple", "martial", "Longsword", "Shortsword"]);
		expect(state.hasWeaponProficiency("Simple weapons")).toBe(true);
		expect(state.hasWeaponProficiency("martial")).toBe(true);
	});

	it("does not reverse a first-class proficiency when a same-label multiclass grant was already owned", () => {
		const firstClass = {
			...fighter,
			source: "HB",
			startingProficiencies: {armor: ["Light armor"], weapons: ["Simple weapons"]},
		};
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "HB", level: 1});
		state.applyFirstClassStartingProficiencies(firstClass);
		state.recordLevelChoice({level: 1, class: {name: "Fighter", source: "HB"}, classLevel: 1});
		state.addClass({name: "Druid", source: "PHB", level: 1});
		const levelUp = Object.create(CharacterSheetLevelUp.prototype);
		levelUp._state = state;
		const multiclassProficiencies = levelUp._applyMulticlassProficiencies(druid);
		state.recordLevelChoice({
			level: 2,
			class: {name: "Druid", source: "PHB"},
			classLevel: 1,
			choices: {multiclassProficiencies},
		});

		expect(state.getArmorProficiencies()).toContain("Light armor");
		expect(state.getWeaponProficiencies()).toContain("Simple weapons");
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.removeClassLastLevel("Druid", "PHB").success).toBe(true);
		expect(loaded.hasArmorProficiency("light")).toBe(true);
		expect(loaded.getWeaponProficiencies()).toContain("Simple weapons");
	});

	it("keeps class-feature grants after the first class changes and recalculates", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 1});
		state.applyFirstClassStartingProficiencies(fighter);
		state.addClass({name: "Druid", source: "PHB", level: 1});
		state.addFeature({
			id: "druid-heavy-armor",
			name: "Druid Armor Training",
			source: "HB",
			className: "Druid",
			classSource: "PHB",
			featureType: "Class",
			level: 1,
			description: "You gain proficiency with heavy armor.",
		});
		state.applyClassFeatureEffects();
		expect(state.hasArmorProficiency("heavy")).toBe(true);
		expect(state.getProficiencies().armor.filter(a => state._normalizeArmorProfToken(a) === "heavy")).toHaveLength(1);

		state.removeClass("Fighter", "PHB");
		state.applyFirstClassStartingProficiencies(druid);
		expect(state.hasArmorProficiency("heavy")).toBe(true);
		expect(state.getProficiencies().armor.filter(a => state._normalizeArmorProfToken(a) === "heavy")).toHaveLength(1);
	});

	it("projects a polluted legacy save without changing raw entries or ownership", () => {
		const {state} = makeRangerDruid();
		const save = state.toJson();
		save.armorProficiencies = ["light", "Light Armor", "shield", "Shields", "medium", "Mithril Shell"];
		save.weaponProficiencies = ["simple", "Simple weapons", "Longsword", "Shortsword"];
		save.toolProficiencies = ["Thieves' Tools", "Thieves Tools", "Herbalism Kit"];
		save.languages = ["Common", "common", "Auran", "Primordial"];
		save.grantedProficiencies.armor.light = ["base:race", "feature:second"];
		save.grantedProficiencies.weapons.simple = ["base:class"];
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(save);

		expect(loaded.getProficiencies()).toEqual({
			armor: ["light", "shield", "medium", "Mithril Shell"],
			weapons: ["simple", "Longsword", "Shortsword"],
			tools: ["Thieves' Tools", "Herbalism Kit"],
			languages: ["Common", "Auran", "Primordial"],
		});
		expect(loaded.toJson().armorProficiencies).toEqual(save.armorProficiencies);
		expect(loaded.toJson().grantedProficiencies.armor.light).toEqual(["base:race", "feature:second"]);
		expect(loaded.toJson().grantedProficiencies.weapons.simple).toEqual(["base:class"]);
	});

	it("retains distinct named tool objects and their metadata across save/load", () => {
		const state = new CharacterSheetState();
		state.addToolProficiency({full: "Navigator's Tools", source: "PHB"});
		state.addToolProficiency({full: "Cartographer's Tools", source: "XPHB"});
		state.addToolProficiency("Navigator's Tools");
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getProficiencies().tools).toEqual([
			{full: "Navigator's Tools", source: "PHB"},
			{full: "Cartographer's Tools", source: "XPHB"},
		]);
	});
});

describe("Overview proficiency display", () => {
	const originalDocument = globalThis.document;
	afterEach(() => { globalThis.document = originalDocument; });

	it("shows each proficiency once and leaves distinct tool check candidates available", () => {
		const {state} = makeRangerDruid();
		const save = state.toJson();
		save.armorProficiencies.push("Light Armor");
		save.weaponProficiencies = ["simple", "Simple weapons", "Longsword"];
		save.toolProficiencies = ["Thieves' Tools", "Thieves Tools", "Herbalism Kit"];
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(save);
		const elements = Object.fromEntries([
			"charsheet-prof-armor", "charsheet-prof-weapons", "charsheet-prof-tools",
			"charsheet-prof-languages", "charsheet-roll-tool-check",
		].map(id => [id, {innerHTML: "", textContent: "", disabled: false, title: ""}]));
		globalThis.document = {getElementById: id => elements[id]};
		const page = Object.create(CharacterSheetPage.prototype);
		page._state = loaded;
		page._dialectParentMap = {};
		page._renderWeaponMasteries = jest.fn();
		page._getToolCheckMetadata = name => ({name, toolKey: CharacterSheetState.normalizeToolKey(name)});

		page._renderProficiencies();
		expect(elements["charsheet-prof-armor"].innerHTML).toBe("Light Armor, Medium Armor, Shields");
		expect(elements["charsheet-prof-weapons"].innerHTML).toBe("Simple Weapons, Longsword");
		expect(elements["charsheet-prof-tools"].innerHTML).toBe("Thieves' Tools, Herbalism Kit");
		expect(page._getToolCheckCandidates().map(it => it.name)).toEqual(["Herbalism Kit", "Thieves' Tools"]);
		expect(elements["charsheet-roll-tool-check"].disabled).toBe(false);
		expect(elements["charsheet-roll-tool-check"].title).toContain("Roll a tool check");
	});
});
