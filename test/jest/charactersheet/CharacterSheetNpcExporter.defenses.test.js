import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {getNpcExportSchemaErrors} from "../../util-npc-export-schema.js";

const State = globalThis.CharacterSheetState;
const Exporter = globalThis.CharacterSheetNpcExporter;
const Upgrades = globalThis.CharacterSheetUpgrades;
const brew = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));
const blessed = brew.itemUpgrade.find(upgrade => upgrade.name === "Blessed" && upgrade.source === "TGTT");
const ioun = JSON.parse(fs.readFileSync("homebrew/Moorchlyne Ioun Stones.json", "utf8")).item.find(item => /Dark Blue Rhomboid/.test(item.name));
const makeState = () => {
	const state = new State({isDetached: true});
	state.setName("Keeper");
	state.addClass({name: "Fighter", source: "PHB", level: 10});
	state.setCurrency("gp", 2000);
	state.setAbilityBase("dex", 14);
	return state;
};
const syncItems = state => {
	const inventory = Object.create(globalThis.CharacterSheetInventory.prototype);
	inventory._state = state;
	state.setItemDefenses(inventory._getItemDefenses(state.getItems()));
};
const values = (monster, property) => (monster[property] || []).flatMap(value => typeof value === "string" ? value : value[property] || []);
const stone = () => ({...ioun});

beforeEach(() => Upgrades.setUpgradeCatalog(brew.itemUpgrade));
afterEach(() => Upgrades.resetUpgradeCatalog());

describe.each(["complete", "compact"])("NPC canonical initiative and defenses (%s)", presentationMode => {
	const exportState = (state, defenseMode = "persistent") => {
		const monster = Exporter.convertStateToMonster(state, {presentationMode, defenseMode});
		expect(getNpcExportSchemaErrors({data: {monster: [monster]}, kind: "bestiary", filePath: "defense-regression"})).toEqual([]);
		return monster;
	};

	it("F42: item prose grants the same structured advantage as the sheet's initiative roll", () => {
		const state = makeState();
		state.addItem(stone(), 1, true, true);
		syncItems(state);
		expect(state.getInitiativeRollMode()).toEqual({advantage: true, disadvantage: false});
		expect(exportState(state).initiative).toEqual({advantageMode: "adv"});
	});

	it.each(["stowed", "unattuned"])("F42: an %s item cannot grant initiative advantage", gate => {
		const state = makeState();
		state.addItem(stone(), 1, gate !== "stowed", gate !== "unattuned");
		syncItems(state);
		expect(state.getInitiativeRollMode()).toEqual({advantage: false, disadvantage: false});
		expect(exportState(state).initiative).toBeUndefined();
	});

	it("F42: a numeric initiative bonus does not hide advantage, and disadvantage cancels it", () => {
		const state = makeState();
		state.addItem(stone(), 1, true, true);
		state.addItem({name: "Quickness", source: "TEST", effects: [{type: "initiative", value: 2}]}, 1, true);
		syncItems(state);
		expect(exportState(state).initiative).toEqual({initiative: 4, advantageMode: "adv"});
		state.addItem({name: "Sluggishness", source: "TEST", effects: [{type: "initiative", disadvantage: true}]}, 1, true);
		expect(state.getInitiativeRollMode()).toEqual({advantage: false, disadvantage: false});
		expect(exportState(state).initiative).toBe(4);
	});

	it.each([
		"As an action, you have advantage on initiative rolls for 1 minute while wearing this ring.",
		"While wearing this ring, you have advantage on initiative rolls if you are in darkness.",
	])("does not turn a gated initiative rule into a permanent benefit: %s", description => {
		const state = makeState();
		state.addItem({name: "Gated Initiative Ring", source: "TEST", entries: [description]}, 1, true);
		expect(state.getInitiativeRollMode()).toEqual({advantage: false, disadvantage: false});
		expect(exportState(state).initiative).toBeUndefined();
	});

	it("uses the canonical roll mode for active-state initiative advantage", () => {
		const state = makeState();
		state.activateState("rage", {customEffects: [{type: "advantage", target: "initiative"}]});
		expect(state.getInitiativeRollMode()).toEqual({advantage: true, disadvantage: false});
		expect(exportState(state).initiative).toEqual({advantageMode: "adv"});
	});

	it("F43: real Blessed armor upgrade reaches canonical and exported persistent resistance", () => {
		const state = makeState();
		state.addItem({name: "Test Armor", source: "TEST", type: "LA", armor: true, ac: 11, resist: ["fire"]}, 1, true);
		const id = state.getItems()[0].id;
		expect(state.applyItemUpgrade(id, blessed, 500)).toEqual({success: true});
		syncItems(state);
		expect(state.getResistances()).toEqual(expect.arrayContaining(["fire", "necrotic"]));
		for (const mode of ["persistent", "active"]) {
			expect(values(exportState(state, mode), "resist")).toEqual(expect.arrayContaining(["fire", "necrotic"]));
		}
		state.setItemEquipped(id, false);
		syncItems(state);
		expect(values(exportState(state), "resist")).not.toContain("necrotic");
	});

	it("F43: a same-named foreign upgrade cannot borrow TGTT Blessed mechanics", () => {
		const state = makeState();
		state.addItem({name: "Test Armor", source: "TEST", type: "LA", armor: true, ac: 11}, 1, true);
		expect(state.applyItemUpgrade(state.getItems()[0].id, {name: "Blessed", source: "TEST", upgradeType: ["AU"]}, 500)).toEqual({success: true});
		expect(values(exportState(state), "resist")).not.toContain("necrotic");
	});

	it("F46: overlapping source-shaped storm resistances stay resistances, not immunity", () => {
		const state = makeState();
		state.addFeature({name: "Storm-Born", source: "TEST", resistances: ["lightning", "thunder"], description: "You have resistance to lightning and thunder damage."});
		state.addItem({name: "Storm Cloak",
			source: "TEST",
			effects: [
				{type: "resistance:lightning"}, {type: "resistance:thunder"},
			]}, 1, true);
		syncItems(state);
		for (const mode of ["persistent", "active"]) {
			const monster = exportState(state, mode);
			expect(values(monster, "resist")).toEqual(expect.arrayContaining(["lightning", "thunder"]));
			for (const type of ["lightning", "thunder"]) expect(values(monster, "immune")).not.toContain(type);
		}
		expect(state.getImmunities()).toEqual([]);
	});

	it("F46: an explicit immunity is preserved even when resistance also exists", () => {
		const state = makeState();
		state.addFeature({name: "Cold Resistance", source: "TEST", resistances: ["cold"], description: "You have resistance to cold damage."});
		state.addItem({name: "Cold Ward", source: "TEST", effects: [{type: "immunity:cold"}]}, 1, true);
		expect(state.getImmunities()).toContain("cold");
		expect(values(exportState(state), "immune")).toContain("cold");
	});

	it("persistent projection retains manual defenses without baking in an active state", () => {
		const state = makeState();
		state.addManualDefense("resistances", "acid");
		state.activateState("rage", {customEffects: [{type: "resistance", target: "cold"}]});
		const monster = exportState(state);
		expect(values(monster, "resist")).toContain("acid");
		expect((monster.resist || []).filter(value => typeof value === "string")).not.toContain("cold");
		expect(values(exportState(state, "active"), "resist")).toContain("cold");
	});
});
