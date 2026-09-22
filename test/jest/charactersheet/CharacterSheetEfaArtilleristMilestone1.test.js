import fs from "node:fs";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-crafting.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCrafting = globalThis.CharacterSheetCrafting;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;

const artificerData = JSON.parse(fs.readFileSync("data/class/class-artificer.json", "utf8"));

const getSubclass = (source) => artificerData.subclass.find(subclass =>
	subclass.name === "Artillerist"
		&& subclass.source === source
		&& subclass.classSource === source);

const getSubclassFeature = (name, source) => artificerData.subclassFeature.find(feature =>
	feature.name === name
		&& feature.source === source
		&& feature.className === "Artificer"
		&& feature.classSource === source
		&& feature.subclassShortName === "Artillerist"
		&& feature.subclassSource === source);

const TCE_ARTILLERIST = getSubclass("TCE");
const EFA_ARTILLERIST = getSubclass("EFA");
const EFA_TOOLS = getSubclassFeature("Tools of the Trade", "EFA");

const SPELL_LEVELS = {
	"shield": 1,
	"thunderwave": 1,
	"scorching ray": 2,
	"shatter": 2,
	"fireball": 3,
	"wind wall": 3,
	"ice storm": 4,
	"wall of fire": 4,
	"cone of cold": 5,
	"wall of force": 5,
};

const SPELL_DB = Object.entries(SPELL_LEVELS).flatMap(([name, level]) => [
	{name: name.toTitleCase(), source: "PHB", level, school: "V"},
	{name: name.toTitleCase(), source: "XPHB", level, school: "V"},
]);

const makeArtilleristState = ({source = "EFA", level = 17} = {}) => {
	const state = new CharacterSheetState();
	state.setSpellData(SPELL_DB);
	const subclass = source === "EFA" ? EFA_ARTILLERIST : TCE_ARTILLERIST;
	state.addClass({
		name: "Artificer",
		source,
		level,
		subclass: {
			name: subclass.name,
			shortName: subclass.shortName,
			source: subclass.source,
			additionalSpells: subclass.additionalSpells,
		},
	});
	return state;
};

const makeToolsFeature = (overrides = {}) => CharacterSheetClassUtils.buildFeatureStateObject({
	...EFA_TOOLS,
	...overrides,
}, {
	featureType: "Subclass Feature",
	isSubclassFeature: true,
});

describe("EFA/TCE Artillerist source characterization", () => {
	test("keeps canonical subclass and feature UIDs source-distinct", () => {
		expect(TCE_ARTILLERIST.subclassFeatures).toEqual([
			"Artillerist|Artificer|TCE|Artillerist|TCE|3",
			"Arcane Firearm|Artificer|TCE|Artillerist|TCE|5",
			"Explosive Cannon|Artificer|TCE|Artillerist|TCE|9",
			"Fortified Position|Artificer|TCE|Artillerist|TCE|15",
		]);
		expect(EFA_ARTILLERIST.subclassFeatures).toEqual([
			"Artillerist|Artificer|EFA|Artillerist|EFA|3|EFA",
			"Arcane Firearm|Artificer|EFA|Artillerist|EFA|5|EFA",
			"Explosive Cannon|Artificer|EFA|Artillerist|EFA|9|EFA",
			"Fortified Position|Artificer|EFA|Artillerist|EFA|15|EFA",
		]);
		expect(CharacterSheetState._getSourceAwareSubclassFeatureUid(EFA_TOOLS))
			.toBe("Tools of the Trade|Artificer|EFA|Artillerist|EFA|3|EFA");
		expect(getSubclassFeature("Tool Proficiency", "TCE")).toBeTruthy();
		expect(getSubclassFeature("Tools of the Trade", "TCE")).toBeUndefined();
	});

	test("pins the exact TCE and EFA Tools/Explosive Cannon rule differences", () => {
		const efaToolsText = JSON.stringify(EFA_TOOLS.entries);
		expect(efaToolsText).toMatch(/Martial Ranged weapons/);
		expect(efaToolsText).toMatch(/Woodcarver's Tools/);
		expect(efaToolsText).toMatch(/amount of time required to craft it is halved/);

		const tceExplosive = JSON.stringify(getSubclassFeature("Explosive Cannon", "TCE").entries);
		const efaExplosive = JSON.stringify(getSubclassFeature("Explosive Cannon", "EFA").entries);
		expect(tceExplosive).toMatch(/As an action/);
		expect(tceExplosive).toMatch(/3d8/);
		expect(efaExplosive).toMatch(/takes damage/);
		expect(efaExplosive).toMatch(/Reaction/);
		expect(efaExplosive).toMatch(/3d10/);
	});

	test("exposes source-aware runtime calculations without adding cannon entities", () => {
		const tce = makeArtilleristState({source: "TCE", level: 9});
		const efa = makeArtilleristState({source: "EFA", level: 9});
		const tceCalc = tce.getFeatureCalculations();
		const efaCalc = efa.getFeatureCalculations();

		expect(tceCalc).toMatchObject({
			cannonDetonationDamage: "3d8",
			cannonDetonationActionType: "action",
			cannonDetonationTrigger: "command",
		});
		expect(tceCalc.hasArtilleristMartialRangedWeaponProficiency).toBeUndefined();
		expect(tceCalc.wandCraftingTimeMultiplier).toBeUndefined();

		expect(efaCalc).toMatchObject({
			cannonDetonationDamage: "3d10",
			cannonDetonationActionType: "reaction",
			cannonDetonationTrigger: "cannonTakesDamage",
			hasArtilleristMartialRangedWeaponProficiency: true,
			wandCraftingTimeMultiplier: 0.5,
		});
		expect(efa.getCompanions()).toHaveLength(0);
	});
});

describe("EFA Artillerist Tools of the Trade", () => {
	test("grants only Martial Ranged weapon proficiency for the EFA source", () => {
		const efa = makeArtilleristState({source: "EFA", level: 3});
		const tce = makeArtilleristState({source: "TCE", level: 3});
		const longbow = {name: "Longbow", source: "PHB", type: "R", weapon: true, weaponCategory: "martial", property: ["A"]};
		const longsword = {name: "Longsword", source: "PHB", type: "M", weapon: true, weaponCategory: "martial", property: ["V"]};

		expect(efa.hasWeaponProficiency("Martial Ranged Weapons")).toBe(true);
		expect(efa._isWeaponProficient(longbow)).toBe(true);
		expect(efa._isWeaponProficient(longsword)).toBe(false);
		expect(tce.hasWeaponProficiency("Martial Ranged Weapons")).toBe(false);
		expect(tce._isWeaponProficient(longbow)).toBe(false);

		const restored = new CharacterSheetState();
		restored.loadFromJson(efa.toJson());
		expect(restored.hasWeaponProficiency("Martial Ranged Weapons")).toBe(true);
		expect(restored._isWeaponProficient(longbow)).toBe(true);
	});

	test("grants Woodcarver's Tools without a replacement prompt when not already proficient", () => {
		const state = new CharacterSheetState();
		state.addFeature(makeToolsFeature());

		expect(state.hasToolProficiency("Woodcarver's Tools")).toBe(true);
		expect(state.getPendingFeatureChoices().filter(choice => choice.featureName === "Tools of the Trade")).toHaveLength(0);
		expect(state.getFeature("Tools of the Trade").description).toMatch(/craft a magic/i);

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.hasToolProficiency("Woodcarver's Tools")).toBe(true);
		expect(restored.getPendingFeatureChoices().filter(choice => choice.featureName === "Tools of the Trade")).toHaveLength(0);
	});

	test("persists a source-aware replacement artisan-tool decision and lets Respec edit it", () => {
		const state = new CharacterSheetState();
		state.addToolProficiency("Woodcarver's Tools");
		state._data.levelHistory = [{
			level: 3,
			class: {name: "Artificer", source: "EFA"},
			classLevel: 3,
			decisions: [],
		}];
		state.addFeature(makeToolsFeature({
			sourceDecisionKey: "artificer|efa|cl3|subclass|artillerist|efa",
		}));

		const [choice] = state.getPendingFeatureChoices().filter(it => it.featureName === "Tools of the Trade");
		expect(choice.featureUid).toBe("Tools of the Trade|Artificer|EFA|Artillerist|EFA|3|EFA");
		expect(choice.options).not.toContain("Woodcarver's Tools");
		expect(state.fulfillFeatureChoice(choice.id, "Smith's Tools")).toBe(true);
		expect(state.hasToolProficiency("Smith's Tools")).toBe(true);
		expect(state.hasFulfilledFeatureToolChoice({featureUid: choice.featureUid})).toBe(true);

		const [decision] = state._data.levelHistory[0].decisions.filter(it => it.type === "nestedTool");
		expect(decision.selection).toBe("Smith's Tools");
		expect(decision.options).toContain("Weaver's Tools");
		expect(decision.provenance.ownerUid).toBe(choice.featureUid);

		const restored = new CharacterSheetState();
		restored.loadFromJson(state.toJson());
		expect(restored.getPendingFeatureChoices().filter(it => it.featureName === "Tools of the Trade")).toHaveLength(0);
		expect(restored.hasToolProficiency("Smith's Tools")).toBe(true);

		const [restoredDecision] = restored._data.levelHistory[0].decisions.filter(it => it.type === "nestedTool");
		expect(restoredDecision.options).toContain("Weaver's Tools");

		const respec = Object.create(CharacterSheetRespec.prototype);
		respec._state = restored;
		respec._applyDecisionMechanicsProficiencies(restoredDecision, ["Weaver's Tools"], restoredDecision.options, restored);
		expect(restored.hasToolProficiency("Smith's Tools")).toBe(false);
		expect(restored.hasToolProficiency("Weaver's Tools")).toBe(true);
	});

	test("all creation/advancement surfaces drain the shared persisted tool choice", () => {
		const builder = fs.readFileSync("js/charactersheet/charactersheet-builder.js", "utf8");
		const levelUp = fs.readFileSync("js/charactersheet/charactersheet-levelup.js", "utf8");
		const quickBuild = fs.readFileSync("js/charactersheet/charactersheet-quickbuild.js", "utf8");
		const sheet = fs.readFileSync("js/charactersheet/charactersheet.js", "utf8");

		for (const source of [builder, levelUp, quickBuild]) expect(source).toMatch(/processPendingFeatureChoices/);
		expect(sheet).toMatch(/finalize\(isSkill \|\| isTool \? opt/);
	});

	test("applies the reusable 0.5 wand-crafting multiplier only to EFA Artillerist magic wands", () => {
		const wand = {name: "Wand of Fireballs", source: "DMG", type: "gear", typeCode: "WD|DMG", rarity: "rare"};
		const staff = {name: "Staff of Fire", source: "DMG", type: "ST|DMG", rarity: "very rare"};
		const wandRecipe = {name: wand.name, source: wand.source, itemUid: "wand of fireballs|dmg", value: 20000};
		const staffRecipe = {name: staff.name, source: staff.source, itemUid: "staff of fire|dmg", value: 20000};
		const efa = makeArtilleristState({source: "EFA", level: 3});
		const tce = makeArtilleristState({source: "TCE", level: 3});

		expect(efa.getCraftingTimeMultiplier({item: wand})).toBe(0.5);
		expect(efa.getCraftingTimeMultiplier({item: staff})).toBe(1);
		expect(CharacterSheetCrafting.getCraftingWorkweeks(wandRecipe, {state: efa, items: [wand]})).toBe(2);
		expect(CharacterSheetCrafting.getCraftingWorkweeks(wandRecipe, {state: tce, items: [wand]})).toBe(4);
		expect(CharacterSheetCrafting.getCraftingWorkweeks(staffRecipe, {state: efa, items: [staff]})).toBe(4);
	});
});

describe("EFA Artillerist always-prepared spells", () => {
	test.each([
		[3, 2],
		[5, 4],
		[9, 6],
		[13, 8],
		[17, 10],
	])("grants the exact XPHB spell sources through Artificer level %i", (level, expectedCount) => {
		const state = makeArtilleristState({source: "EFA", level});
		const spells = state.getSpellsKnown().filter(spell => spell.sourceFeature === "Artillerist Spells");

		expect(spells).toHaveLength(expectedCount);
		expect(spells.every(spell =>
			spell.source === "XPHB"
			&& spell.sourceClass === "Artificer"
			&& spell.alwaysPrepared
			&& spell.prepared)).toBe(true);
		expect(CharacterSheetClassUtils.countPreparedSpells(spells, {max: 1})).toMatchObject({
			current: 0,
			isOver: false,
		});
	});

	test("keeps the TCE grants PHB-sourced and capacity-free", () => {
		const state = makeArtilleristState({source: "TCE", level: 17});
		const spells = state.getSpellsKnown().filter(spell => spell.sourceFeature === "Artillerist Spells");
		expect(spells).toHaveLength(10);
		expect(spells.every(spell => spell.source === "PHB" && spell.alwaysPrepared)).toBe(true);
		expect(CharacterSheetClassUtils.countPreparedSpells(spells).current).toBe(0);
	});

	test("survives the Quick Build subclass payload shape and JSON import/export", () => {
		const state = makeArtilleristState({source: "EFA", level: 17});
		const exported = state.toJson();
		expect(exported.classes[0].subclass.additionalSpells).toEqual(EFA_ARTILLERIST.additionalSpells);

		const restored = new CharacterSheetState();
		restored.setSpellData(SPELL_DB);
		restored.loadFromJson(exported);
		restored.populateSubclassSpells();

		const spells = restored.getSpellsKnown().filter(spell => spell.sourceFeature === "Artillerist Spells");
		expect(spells).toHaveLength(10);
		expect(new Set(spells.map(spell => spell.source))).toEqual(new Set(["XPHB"]));
		expect(CharacterSheetClassUtils.countPreparedSpells(spells).current).toBe(0);
	});
});
