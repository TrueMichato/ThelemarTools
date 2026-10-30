import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetItemUtils} from "../../../js/charactersheet/charactersheet-item-utils.js";
import {CharacterSheetSpellMaterials as Materials} from "../../../js/charactersheet/charactersheet-spell-materials.js";

const spells = [...fs.readdirSync("data/spells")]
	.filter(file => /^spells-.*\.json$/.test(file))
	.flatMap(file => JSON.parse(fs.readFileSync(`data/spells/${file}`, "utf8")).spell || []);
const spell = (name, source = "XPHB") => spells.find(row => row.name === name && row.source === source);
const State = globalThis.CharacterSheetState;

describe("required spell material catalog", () => {
	it("accounts for every structured site requirement without confusing ordinary ingredients with supplies", () => {
		const required = spells.filter(row => row.components?.m && typeof row.components.m === "object");
		expect(required).toHaveLength(181);
		expect(required.filter(row => row.components.m.cost > 0)).toHaveLength(172);
		expect(required.filter(row => row.components.m.consume && !row.components.m.cost)).toHaveLength(9);
		const catalog = Materials.buildCatalog(spells);
		for (const row of required) {
			const requirements = Materials.getRequirements(row);
			expect(requirements.length).toBeGreaterThan(0);
			for (const requirement of requirements) {
				expect(catalog.some(item => item.spellComponent.key === requirement.key && item.source === row.source)).toBe(true);
			}
		}
		expect(Materials.getRequirements({name: "Ordinary", source: "PHB", components: {m: "a pinch of sand"}})).toEqual([]);
	});

	it.each(["PHB", "XPHB"])("projects usable %s powdered ruby through real item normalization, matching and reload", source => {
		const data = spell("Simulacrum", source);
		const [requirement] = Materials.getRequirements(data);
		expect(requirement).toMatchObject({name: "Powdered Ruby", cost: 150000, consume: true, quantity: 1});
		const item = Materials.buildCatalog([data])[0];
		const state = new State();
		state.addItem({...CharacterSheetItemUtils.getNormalizedCatalogItem({item, state}), quantity: 2});
		const id = state.getInventory()[0].id;
		expect(CharacterSheetItemUtils.getItemType(item)).toBe("component");
		expect(state.getSpellMaterialCandidates(requirement).map(row => row.id)).toEqual([id]);
		const loaded = new State();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getSpellMaterialCandidates(requirement)).toMatchObject([{id, quantity: 2, value: 150000}]);
		expect(loaded.consumeItem(id)).toBe(true);
		expect(loaded.getInventory()[0].quantity).toBe(1);
	});

	it("preserves complete alternative/bundle identity through normalization and reload, rather than guessing one noun", () => {
		const data = spell("Magic Circle", "PHB");
		const [requirement] = Materials.getRequirements(data);
		const state = new State();
		const item = Materials.buildCatalog([data])[0];
		state.addItem(CharacterSheetItemUtils.getNormalizedCatalogItem({item, state}));
		const loaded = new State();
		loaded.loadFromJson(state.toJson());
		expect(loaded.getSpellMaterialCandidates(requirement)).toHaveLength(1);
		state.addItem({name: "Iron Sword", source: "PHB", value: 10000});
		expect(state.getSpellMaterialCandidates(requirement)).toHaveLength(1);
	});

	it.each(["PHB", "XPHB"])("requires two individually priced platinum rings for %s Warding Bond", source => {
		const [requirement] = Materials.getRequirements(spell("Warding Bond", source));
		expect(requirement).toMatchObject({cost: 5000, quantity: 2, consume: false});
		const state = new State();
		state.addItem({name: "Platinum Ring", source, value: 10000}, 1);
		expect(Materials.getMissing(state, [requirement])).toHaveLength(1);
		state.addItem({name: "Platinum Ring", source, value: 5000}, 1);
		expect(Materials.getMissing(state, [requirement])).toEqual([]);
	});

	it("recognizes priced/consumed prose-string materials in the real TGTT catalog, not just structured site materials", () => {
		const brew = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8")).spell;
		const identify = brew.find(row => row.name === "Identify" && row.source === "TGTT");
		expect(typeof identify.components.m).toBe("string");
		const state = new State();
		expect(state.getSpellMaterialComponentInfo(identify)).toMatchObject({cost: 10000, consume: false, requiresFocus: false});
		const [requirement] = Materials.getRequirements(identify);
		expect(requirement).toMatchObject({name: "Pearl", cost: 10000, consume: false});
		const item = Materials.buildCatalog([identify])[0];
		state.addItem(CharacterSheetItemUtils.getNormalizedCatalogItem({item, state}));
		expect(Materials.getMissing(state, [requirement])).toEqual([]);
		expect(Materials.getRequirements({name: "Brew supply", source: "Brew", components: {m: "silver powder worth 2 SP, which the spell consumes"}})[0]).toMatchObject({cost: 20, consume: true});
		expect(Materials.getRequirements({name: "Mixed", source: "Brew", components: {m: "a gem worth 10 GP, consumed, and a reusable rod worth 20 GP"}})[0]).toMatchObject({cost: 0, manual: true, timing: "manual"});
		expect(Materials.getRequirements(spell("Tasha's Bubbling Cauldron", "XPHB"))[0]).toMatchObject({cost: 50000, consume: false});
		const orb = brew.find(row => row.name === "Fearheart's Orb of Darkness");
		expect(Materials.getRequirements(orb)[0]).toMatchObject({cost: 100000, consume: true});
		expect(Materials.getRequirements({name: "Unknown bundle", source: "Brew", components: {m: "a gem and a rod worth 10 GP, which the spell consumes"}})[0]).toMatchObject({manual: true, timing: "manual"});
		expect(Materials.getRequirements({name: "Reusable", source: "Brew", components: {m: "a pearl worth 50 GP, which is not consumed"}})[0]).toMatchObject({cost: 5000, consume: false});
	});

	it.each(["PHB", "XPHB"])("separates consumed and reusable %s Clone supplies", source => {
		const requirements = Materials.getRequirements(spell("Clone", source));
		expect(requirements).toEqual(expect.arrayContaining([
			expect.objectContaining({cost: 100000, consume: true}),
			expect.objectContaining({cost: 200000, consume: false}),
		]));
	});

	it("preserves source differences and variable/delayed/optional requirements explicitly", () => {
		expect(Materials.getRequirements(spell("Protection from Evil and Good", "PHB"))[0]).toMatchObject({cost: 0, consume: true});
		expect(Materials.getRequirements(spell("Protection from Evil and Good"))[0]).toMatchObject({cost: 2500, consume: true});
		expect(Materials.getRequirements(spell("Imprisonment", "PHB"))[0]).toMatchObject({manual: true, cost: 0});
		expect(Materials.getRequirements(spell("Imprisonment"))[0]).toMatchObject({cost: 500000, manual: false});
		expect(Materials.getRequirements(spell("Globe of Invulnerability", "PHB"))[0]).toMatchObject({consume: true, timing: "end"});
		expect(Materials.getRequirements(spell("Summon Greater Demon", "XGE"))[0]).toMatchObject({consume: "optional"});
	});

	it("rejects incidental words, wrong physical forms, explicit underpricing and empty stacks", () => {
		const state = new State();
		const [requirement] = Materials.getRequirements(spell("Simulacrum"));
		state.addItem({id: "wrong", name: "Powdered Sapphire", source: "Custom", value: 200000});
		state.addItem({id: "jewelry", name: "Ruby Brooch", source: "Custom", value: 200000});
		state.addItem({id: "cheap", name: "Powdered Ruby", source: "Custom", value: 149999});
		state.addItem({id: "empty", name: "Empty Powdered Ruby", source: "Custom", value: 150000});
		state._data.inventory.find(row => row.id === "empty").quantity = 0;
		expect(state.getSpellMaterialCandidates(requirement)).toEqual([]);
	});

	it("deduplicates equivalent supplies but not value tiers, and preserves full unknown brew qualifications", () => {
		const inputs = [spell("Stoneskin"), spell("Greater Restoration"), spell("Revivify"), spell("Resurrection")];
		const catalog = Materials.buildCatalog(inputs);
		expect(catalog.filter(row => row.spellComponent.material === "diamond dust" && row.value === 10000)).toHaveLength(1);
		expect(catalog.filter(row => row.spellComponent.material === "diamond").map(row => row.value).sort((a, b) => a - b)).toEqual([30000, 100000]);
		const brew = {name: "Uncertain", source: "Brew", components: {m: {text: "a token whose value is determined by the DM", cost: 100}}};
		expect(Materials.getRequirements(brew)[0]).toMatchObject({manual: true, text: brew.components.m.text});
	});
});
