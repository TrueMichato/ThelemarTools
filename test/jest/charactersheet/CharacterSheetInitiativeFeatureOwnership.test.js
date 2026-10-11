import "./setup.js";
import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import "../../../js/charactersheet/charactersheet-combat.js";

beforeAll(async () => {
	globalThis.window = {addEventListener: () => {}};
	await import("../../../js/charactersheet/charactersheet.js");
});

const State = globalThis.CharacterSheetState;
const ClassUtils = globalThis.CharacterSheetClassUtils;
const wizard = JSON.parse(fs.readFileSync("data/class/class-wizard.json", "utf8"));
const rogue = JSON.parse(fs.readFileSync("data/class/class-rogue.json", "utf8"));
const ranger = JSON.parse(fs.readFileSync("data/class/class-ranger.json", "utf8"));
const featCatalog = JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat;
const temporal = wizard.subclassFeature.find(f => f.name === "Temporal Awareness" && f.classSource === "PHB");
const initiativeRows = state => state.getNamedModifiers().filter(mod => mod.type === "initiative");

function acquire (catalog = wizard, shortName = "Chronurgy", level = 2) {
	const state = new State();
	const classData = {
		...catalog.class.find(c => c.source === "PHB"),
		subclasses: catalog.subclass.filter(sc => sc.classSource === "PHB"),
	};
	const subclass = classData.subclasses.find(sc => sc.shortName === shortName);
	state.setAbilityBase("dex", 14);
	for (const ability of ["int", "wis", "cha"]) state.setAbilityBase(ability, 16);
	state.setClassFeatureCatalog(catalog.classFeature, catalog.subclassFeature, []);
	state.setClassCatalog([classData]);
	state.addClass({...classData, level, subclass});
	for (let current = 1; current <= level; current++) {
		state.recordLevelChoice({
			level: current,
			classLevel: current,
			class: {name: classData.name, source: classData.source},
			choices: current === level ? {subclass} : {},
		});
	}
	const reconcile = () => {
		ClassUtils.reconcileClassFeatures(state, {
			getClassData: () => classData,
			classFeatures: catalog.classFeature,
			subclassFeatures: catalog.subclassFeature,
		});
		state.applyClassFeatureEffects();
	};
	reconcile();
	return {state, reconcile, classData};
}

describe("source-owned live feature initiative", () => {
	test("real catalog progression counts Temporal Awareness once at the producer boundary", () => {
		expect(temporal).toMatchObject({
			source: "EGW",
			className: "Wizard",
			classSource: "PHB",
			subclassShortName: "Chronurgy",
			subclassSource: "EGW",
			level: 2,
		});
		const {state} = acquire();
		expect(state.getFeatures()).toContainEqual(expect.objectContaining({
			name: temporal.name, source: "EGW", isSubclassFeature: true,
		}));
		expect(state.getInitiative()).toBe(5);
		expect(initiativeRows(state)).toEqual([]);
		expect(state.getInitiativeBreakdown().components.filter(row => row.name === temporal.name))
			.toEqual([expect.objectContaining({value: 3, isCanonical: true, type: "feature"})]);
	});

	test.each([[20, 5], [10, 0], [8, -1]])("INT %i stays live, including zero/negative, across two real reload boundaries", (score, bonus) => {
		const {state, reconcile} = acquire();
		const ownerId = state.getFeatures().find(f => f.name === temporal.name).id;
		state.setAbilityBase("int", score);
		expect(state.getInitiative()).toBe(2 + bonus);
		for (let cycle = 0; cycle < 2; cycle++) {
			state.loadFromJson(state.toJson());
			reconcile();
			expect(state.getInitiative()).toBe(2 + bonus);
			expect(initiativeRows(state)).toEqual([]);
			expect(state.getFeatures().find(f => f.name === temporal.name).id).toBe(ownerId);
			expect(state.getInitiativeBreakdown().canonical).toBe(2 + bonus);
		}
		state.setAbilityBonus("int", 2);
		expect(state.getInitiative()).toBe(3 + bonus);
	});

	test("characterized historical full-name parser copies are removed by exact owner, not display name", () => {
		const {state, reconcile} = acquire();
		const owner = state.getFeatures().find(f => f.name === temporal.name);
		// Synthetic legacy shape: historical parser spelling, absent class marker.
		state.addNamedModifier({name: temporal.name, type: "initiative", value: 0, abilityMod: "intelligence", sourceFeatureId: owner.id, note: `From ${temporal.name}`});
		state.addNamedModifier({name: temporal.name, type: "initiative", value: 0, abilityMod: "int", sourceFeatureId: owner.id, note: `From ${temporal.name}`});
		const manual = state.addNamedModifier({name: temporal.name, type: "initiative", value: 2, note: "Player adjustment"});
		const numeric = state.addNamedModifier({name: temporal.name, type: "initiative", value: 3, sourceFeatureId: owner.id, sourceType: "classFeature", note: "Unproven historical numeric amount"});
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			for (let cycle = 0; cycle < 2; cycle++) {
				const saved = state.toJson();
				if (cycle === 0) delete saved.customModifiers.initiativeAdjustment;
				state.loadFromJson(saved);
				reconcile();
				expect(initiativeRows(state).map(mod => mod.id).sort()).toEqual([manual, numeric].sort());
				expect(state.getInitiative()).toBe(10);
				expect(state.getInitiativeBreakdown().canonical).toBe(5);
			}
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("historical generated amount cannot be proven"));
		} finally { warn.mockRestore(); }
	});

	test("a same-name unrelated feature keeps its parsed INT and other effects", () => {
		const {state, reconcile} = acquire();
		state.addFeature({
			name: temporal.name,
			source: "HB",
			featureType: "Background",
			description: "You can add your Intelligence modifier to your initiative rolls. Your speed increases by 5 feet.",
		});
		for (let cycle = 0; cycle < 2; cycle++) {
			state.loadFromJson(state.toJson());
			reconcile();
			expect(initiativeRows(state)).toEqual([expect.objectContaining({abilityMod: "int", name: temporal.name})]);
			expect(state.getInitiative()).toBe(8);
			expect(state.getWalkSpeed()).toBe(35);
		}
	});

	test("raw adjustments survive producer registration, ability changes, reloads and exact removal", () => {
		const {state, reconcile} = acquire();
		const manual = state.addNamedModifier({name: "Quick", type: "initiative", value: 2});
		state.addNamedModifier({name: "Slow", type: "initiative", value: -2});
		state.addNamedModifier({name: "Dormant", type: "initiative", value: 9, enabled: false});
		state.addNamedModifier({name: "Hidden", type: "initiative", value: 4, conditional: "while hidden", enabled: false});
		state.setCustomModifier("initiative", 1);
		for (let cycle = 0; cycle < 2; cycle++) {
			state.loadFromJson(state.toJson());
			reconcile();
			expect(state.getInitiative()).toBe(6);
			expect(state.getInitiativeBreakdown().components).toContainEqual(expect.objectContaining({name: "Custom Modifier", value: 1}));
		}
		state.setAbilityBase("int", 20);
		state.removeNamedModifier(manual);
		reconcile();
		expect(state.getInitiative()).toBe(6); // DEX2 + INT5 - Slow2 + raw1.
	});

	test("legacy scalar residual has no invented feature owner and survives reconciliation", () => {
		const {state, reconcile} = acquire();
		state.addNamedModifier({name: "Manual", type: "initiative", value: 2});
		const legacy = state.toJson();
		delete legacy.customModifiers.initiativeAdjustment;
		legacy.customModifiers.initiative = 3; // Existing named total plus unassigned +1.
		state.loadFromJson(legacy);
		reconcile();
		expect(state.getInitiative()).toBe(8);
		expect(state.getInitiativeBreakdown().components).toContainEqual(expect.objectContaining({name: "Custom Modifier", value: 1}));
		expect(initiativeRows(state)).toEqual([expect.objectContaining({name: "Manual", value: 2})]);
		state.loadFromJson(state.toJson());
		reconcile();
		expect(state.getInitiative()).toBe(8);
	});

	test("raw total setter preserves its existing total semantics beside nonzero named contributions", () => {
		const {state, reconcile} = acquire();
		state.addNamedModifier({name: "Manual", type: "initiative", value: 2});
		state.setCustomModifier("initiative", -1);
		expect(state.getInitiative()).toBe(4);
		state.addNamedModifier({name: "New adjustment", type: "initiative", value: 1});
		for (let cycle = 0; cycle < 2; cycle++) {
			state.loadFromJson(state.toJson());
			reconcile();
			expect(state.getInitiative()).toBe(5);
			expect(state.getInitiativeBreakdown().components).toContainEqual(expect.objectContaining({name: "Custom Modifier", value: -3}));
		}
	});

	test("ambiguous historical class rows and altered generated signatures are retained with disclosure", () => {
		const {state, reconcile} = acquire();
		const owner = state.getFeatures().find(f => f.name === temporal.name);
		const unknown = state.addNamedModifier({name: temporal.name, type: "initiative", value: 1, sourceType: "classFeature", note: `From ${temporal.name}`});
		const partialOwner = state.addFeature({name: temporal.name, source: "HB", featureType: "Class", className: "Wizard"});
		const partial = state.addNamedModifier({name: temporal.name, type: "initiative", value: 2, sourceFeatureId: partialOwner, sourceType: "classFeature", note: `From ${temporal.name}`});
		const altered = state.addNamedModifier({name: temporal.name, type: "initiative", value: 0, abilityMod: "intelligent", sourceFeatureId: owner.id, sourceType: "classFeature", note: `From ${temporal.name}`});
		const manualOwner = state.addNamedModifier({name: temporal.name, type: "initiative", value: 0, abilityMod: "int", sourceFeatureId: owner.id, sourceType: "manual", note: `From ${temporal.name}`});
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			for (let cycle = 0; cycle < 2; cycle++) {
				state.loadFromJson(state.toJson());
				reconcile();
				expect(initiativeRows(state).map(mod => mod.id).sort()).toEqual([unknown, partial, altered, manualOwner].sort());
			}
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("historical generated amount cannot be proven"));
		} finally { warn.mockRestore(); }
	});

	test("a legacy remainder beside a proven generated row is retained, never guessed away", () => {
		const {state, reconcile} = acquire();
		const owner = state.getFeatures().find(f => f.name === temporal.name);
		state.addNamedModifier({name: temporal.name, type: "initiative", value: 0, abilityMod: "intelligence", sourceFeatureId: owner.id, note: `From ${temporal.name}`});
		const legacy = state.toJson();
		delete legacy.customModifiers.initiativeAdjustment;
		legacy.customModifiers.initiative = 4;
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			state.loadFromJson(legacy);
			reconcile();
			expect(initiativeRows(state)).toEqual([]);
			expect(state.getInitiative()).toBe(6);
			expect(state.getInitiativeBreakdown().components).toContainEqual(expect.objectContaining({name: "Custom Modifier", value: 1}));
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("user adjustment cannot be distinguished from a stale ability cache"));
			state.loadFromJson(state.toJson());
			reconcile();
			expect(state.getInitiative()).toBe(6);
		} finally { warn.mockRestore(); }
	});

	test("real Rakish Audacity registry copy is suppressed and Dread Ambusher remains unchanged", () => {
		const swashbuckler = acquire(rogue, "Swashbuckler", 3).state;
		expect(swashbuckler.getFeatures()).toContainEqual(expect.objectContaining({name: "Rakish Audacity", source: "XGE"}));
		expect(swashbuckler.getInitiative()).toBe(5);
		expect(initiativeRows(swashbuckler)).toEqual([]);
		swashbuckler.setAbilityBase("cha", 8);
		expect(swashbuckler.getInitiative()).toBe(1);
		const gloom = acquire(ranger, "Gloom Stalker", 3).state;
		expect(gloom.getInitiative()).toBe(5);
		expect(initiativeRows(gloom)).toEqual([]);
	});

	test("Alert and check-wide bonuses stack once without contaminating the canonical total", () => {
		const {state, reconcile} = acquire();
		state.addFeat(featCatalog.find(feat => feat.name === "Alert" && feat.source === "PHB"));
		state.addNamedModifier({name: "All Checks", type: "check:all", value: 1});
		state.addNamedModifier({name: "All Rolls", type: "d20:all", value: 1});
		reconcile();
		expect(state.getInitiative()).toBe(12);
		expect(state.getInitiativeBreakdown().canonical).toBe(5);
	});

	test("actual Respec subclass replacement revokes the live bonus and preserves a same-name manual row", async () => {
		const {state, classData} = acquire();
		const manual = state.addNamedModifier({name: temporal.name, type: "initiative", value: 2});
		const respec = Object.create(globalThis.CharacterSheetRespec.prototype);
		respec._state = state;
		respec._page = {getSubclassFeatures: () => wizard.subclassFeature, getClassFeatures: () => wizard.classFeature, getClasses: () => [classData], filterByAllowedSources: arr => arr};
		const next = classData.subclasses.find(sc => sc.shortName === "Evocation");
		await respec._applySubclassChange(2, {level: 2, class: {name: "Wizard", source: "PHB"}}, state.getClasses()[0].subclass, next);
		state.applyClassFeatureEffects();
		expect(state.getFeatures().some(f => f.name === temporal.name)).toBe(false);
		expect(state.getInitiative()).toBe(4);
		expect(initiativeRows(state).map(mod => mod.id)).toEqual([manual]);
		state.loadFromJson(state.toJson());
		expect(state.getInitiative()).toBe(4);
	});

	test("down-level removes eligibility even with stale stored catalog feature content", () => {
		const {state} = acquire();
		expect(state.removeClassLastLevel("Wizard", "PHB")).toMatchObject({success: true});
		expect(state.getInitiative()).toBe(2);
		expect(initiativeRows(state)).toEqual([]);
		state.loadFromJson(state.toJson());
		expect(state.getInitiative()).toBe(2);
	});

	test("exact feature removal revokes the bonus without erasing a manual name twin", () => {
		const {state} = acquire();
		const manual = state.addNamedModifier({name: temporal.name, type: "initiative", value: 2});
		state.removeFeature(state.getFeatures().find(f => f.name === temporal.name).id);
		expect(state.getInitiative()).toBe(4);
		expect(initiativeRows(state).map(mod => mod.id)).toEqual([manual]);
	});

	test("lean catalog-less saves retain the class-derived grant, with source and level gates", () => {
		const state = new State();
		state.setAbilityBase("dex", 14);
		state.setAbilityBase("int", 16);
		state.addClass({name: "Wizard", source: "PHB", level: 2, subclass: {name: "Chronurgy Magic", source: "EGW"}});
		expect(state.getInitiative()).toBe(5);
		state.getClasses()[0].source = "HB";
		expect(state.getInitiative()).toBe(2);
		state.getClasses()[0].source = "XPHB";
		expect(state.getInitiative()).toBe(2);
		state.getClasses()[0].level = 3;
		expect(state.getInitiative()).toBe(5);
	});

	test.each(["2014", "2024", "thelemar"])("both actual initiative roll consumers agree with effective breakdown under %s exhaustion", async rules => {
		const {state} = acquire();
		state.setCustomModifier("initiative", 1);
		state.setSetting("exhaustionRules", rules);
		state.setExhaustion(1);
		const breakdown = state.getInitiativeBreakdown();
		expect(breakdown.canonical).toBe(5);
		expect(breakdown.total).toBe(6 - state._getExhaustionD20Penalty());
		const page = Object.create(globalThis.CharacterSheetPage.prototype);
		page._state = state;
		page._rollD20 = () => ({roll: 10, mode: "normal"});
		page._rollStateDiceBonuses = () => null;
		page._getExhaustionPenalty = () => state._getExhaustionD20Penalty();
		page._getModeLabel = () => "";
		page._formatD20Breakdown = () => "";
		page.pAnimateD20 = async () => {};
		let pageTotal;
		page._showDiceResult = (_title, total) => { pageTotal = total; };
		await page._rollInitiative();
		expect(pageTotal).toBe(10 + breakdown.total);

		const combat = Object.create(globalThis.CharacterSheetCombat.prototype);
		combat._state = state;
		let combatResult;
		combat._page = {
			rollD20: page._rollD20,
			getModeLabel: page._getModeLabel,
			formatD20Breakdown: page._formatD20Breakdown,
			showDiceResult: result => { combatResult = result; },
		};
		combat.consumeBattleMasterCheckBonus = () => null;
		combat._triggerInitiativeRecovery = () => {};
		const originalDocument = globalThis.document;
		globalThis.document = {getElementById: () => ({textContent: ""})};
		try { combat._rollInitiative(); } finally { globalThis.document = originalDocument; }
		expect(combatResult).toMatchObject({modifier: breakdown.total, total: 10 + breakdown.total});
	});
});
