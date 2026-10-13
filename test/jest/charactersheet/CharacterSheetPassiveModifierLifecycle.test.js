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
const tgtt = JSON.parse(fs.readFileSync("homebrew/TravelersGuidetoThelemar.json", "utf8"));
const feats = JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat;
const trait = tgtt.race.find(race => race.name === "Child of the Empire")
	.entries.find(entry => entry.name === "Dauntless Heritage");
const rightOnTime = tgtt.subclassFeature.find(feature => feature.name === "Right on Time");

function addTrait (state, name = trait.name, source = "TGTT") {
	expect(state.addFeature({...trait, name, source, featureType: "Species"})).toBe(true);
	return state.getFeatures().find(feature => feature.name === name && feature.source === source);
}

function makeTimeCleric () {
	const state = new State();
	state.setClassFeatureCatalog(tgtt.classFeature, tgtt.subclassFeature, []);
	state.addClass({
		name: "Cleric",
		source: "TGTT",
		level: 20,
		subclass: tgtt.subclass.find(subclass => subclass.name === "Time Domain"),
	});
	state.setAbilityBase("dex", 12);
	state.setAbilityBase("wis", 20);
	state.addFeature({...rightOnTime, featureType: "Subclass", isSubclassFeature: true});
	state.addFeat(feats.find(feat => feat.name === "Alert" && feat.source === "XPHB"));
	const feature = addTrait(state);
	const modifier = state.getNamedModifiers().find(mod => mod.sourceFeatureId === feature.id);
	return {state, feature, modifier};
}

function expectInitiativeSources (state, wisdomBonus, adjustment = 0) {
	expect(state.getInitiative()).toBe(1 + 6 + wisdomBonus + adjustment);
	const breakdown = state.getInitiativeBreakdown();
	expect(breakdown.canonical).toBe(1);
	expect(breakdown.total).toBe(state.getInitiative() - state._getExhaustionD20Penalty());
	expect(breakdown.components.filter(component => component.name === "Alert"))
		.toEqual([expect.objectContaining({source: "XPHB", value: 6, isCanonical: false})]);
	expect(breakdown.components.filter(component => component.name === "Right on Time"))
		.toEqual(wisdomBonus ? [expect.objectContaining({source: "TGTT", value: wisdomBonus, isCanonical: false})] : []);
	expect(breakdown.components.filter(component => component.name === "Custom Modifier"))
		.toEqual(adjustment ? [expect.objectContaining({value: adjustment})] : []);
}

describe("passive modifier toggling and live initiative", () => {
	test.each([trait.name, "Fear-proof Heritage"])("%s has only opt-in frightened-save advantage", name => {
		const {state} = makeTimeCleric();
		const feature = name === trait.name ? state.getFeatures().find(f => f.name === name) : addTrait(state, name, "HB");
		const modifier = state.getNamedModifiers().find(mod => mod.sourceFeatureId === feature.id);
		expect(modifier).toMatchObject({type: "save:all", value: 0, conditional: "against being frightened", advantage: true});
		expect(State.detectActivatableFeature(feature)).toBeNull();
		expect(state.getActivatableFeatures().some(entry => entry.feature.id === feature.id)).toBe(false);
		expectInitiativeSources(state, 5);

		expect(state.toggleNamedModifier(modifier.id)).toBe(true);
		const available = state.aggregateModifiers("save:wis");
		expect(available.advantage).toBe(false);
		expect(available.conditionalsAvailable).toContainEqual(expect.objectContaining({sourceName: feature.name, advantage: true}));
		const conditional = available.conditionalsAvailable.find(entry => entry.sourceName === feature.name);
		expect(state.aggregateModifiers("save:wis", {appliedConditionalIds: new Set([conditional.id])}).advantage).toBe(true);
		expect(state.aggregateModifiers("initiative").advantage).toBe(false);
		expectInitiativeSources(state, 5);

		expect(state.toggleNamedModifier(modifier.id)).toBe(false);
		expect(state.aggregateModifiers("save:wis").advantage).toBe(false);
		expect(state.aggregateModifiers("save:wis").conditionalsAvailable).toContainEqual(conditional);
		expectInitiativeSources(state, 5);
	});

	test.each([[16, 3], [10, 0], [8, -1]])("WIS %i changes initiative before an unrelated toggle can trigger a cache rebuild", (score, bonus) => {
		const {state, modifier} = makeTimeCleric();
		expectInitiativeSources(state, 5);
		state.toggleNamedModifier(modifier.id);
		state.setAbilityBase("wis", score);
		expectInitiativeSources(state, bonus);
		state.toggleNamedModifier(modifier.id);
		expectInitiativeSources(state, bonus);
	});

	test("ability bonuses remain live and raw initiative adjustments survive two reload/reconcile cycles", () => {
		const {state, modifier} = makeTimeCleric();
		state.setCustomModifier("initiative", state.getCustomModifier("initiative") + 2);
		state.setAbilityBonus("wis", 2);
		expectInitiativeSources(state, 6, 2);
		for (let cycle = 0; cycle < 2; cycle++) {
			state.loadFromJson(state.toJson());
			state.applyClassFeatureEffects();
			expect(state.getNamedModifiers().find(mod => mod.id === modifier.id).enabled).toBe(false);
			expect(state._data.customModifiers.initiativeAdjustment).toBe(2);
			expectInitiativeSources(state, 6, 2);
		}
	});

	test("later proficiency bonuses do not freeze an earlier registered Alert row", () => {
		const {state} = makeTimeCleric();
		state.addNamedModifier({name: "Proficiency adjustment", type: "proficiencyBonus", value: 1});
		expect(state.getProficiencyBonus()).toBe(7);
		expect(state.getInitiative()).toBe(13);
		expect(state.getInitiativeBreakdown().components).toContainEqual(expect.objectContaining({name: "Alert", value: 7}));
		expect(state.getInitiativeBreakdown().components.some(component => component.name === "Custom Modifier")).toBe(false);
	});

	test("the raw total setter uses current named values, not a stale ability cache", () => {
		const {state} = makeTimeCleric();
		state.setAbilityBase("wis", 10);
		state.setCustomModifier("initiative", 8);
		expect(state._data.customModifiers.initiativeAdjustment).toBe(2);
		expectInitiativeSources(state, 0, 2);
		state.setAbilityBase("wis", 16);
		expectInitiativeSources(state, 3, 2);
	});

	test.each(["check:dex", "check:all", "d20:all"])("%s remains a single initiative contribution beside a raw adjustment", type => {
		const state = new State();
		state.setAbilityBase("dex", 12);
		state.addNamedModifier({name: "Check adjustment", type, value: 3});
		state.setCustomModifier("initiative", 5);
		expect(state._data.customModifiers.initiativeAdjustment).toBe(2);
		expect(state.getInitiative()).toBe(6);
		state.loadFromJson(state.toJson());
		expect(state.getInitiative()).toBe(6);
		expect(state.getInitiativeBreakdown().total).toBe(6);
	});

	test("DEX-check advantage sentinels never become flat initiative", () => {
		const state = new State();
		state.setAbilityBase("dex", 12);
		state.addNamedModifier({name: "Dexterity advantage", type: "check:dex:advantage", value: 1});
		expect(state.getInitiative()).toBe(1);
		state.setCustomModifier("initiative", 2);
		expect(state._data.customModifiers.initiativeAdjustment).toBe(2);
		state.loadFromJson(state.toJson());
		expect(state.getInitiative()).toBe(3);
	});

	test.each(["2014", "2024", "thelemar"])("fresh named initiative agrees with both actual roll consumers under %s exhaustion", async rules => {
		const {state} = makeTimeCleric();
		state.setCustomModifier("initiative", state.getCustomModifier("initiative") + 2);
		state.setAbilityBase("wis", 10);
		state.setSetting("exhaustionRules", rules);
		state.setExhaustion(1);
		expectInitiativeSources(state, 0, 2);
		const breakdown = state.getInitiativeBreakdown();
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

describe("exact feature teardown preserves independent initiative", () => {
	test.each([true, false])("removing an owned state (active=%s) keeps manual and differently owned name twins", active => {
		const state = new State();
		state.setAbilityBase("dex", 12);
		const feature = addTrait(state, "Fear-proof Heritage", "HB");
		state.addFeature({name: "Different owner", source: "HB"});
		const otherOwner = state.getFeatures().find(f => f.name === "Different owner");
		const manual = state.addNamedModifier({name: feature.name, type: "initiative", value: 5});
		const other = state.addNamedModifier({name: feature.name, type: "initiative", value: 3, sourceFeatureId: otherOwner.id});
		const otherSave = state.addNamedModifier({name: feature.name, type: "save:wis", value: 2, sourceFeatureId: otherOwner.id});
		const dormant = state.addNamedModifier({name: feature.name, type: "initiative", value: 9, enabled: false});
		state.setCustomModifier("initiative", state.getCustomModifier("initiative") + 1);
		const ownedState = state.activateState("custom", {name: feature.name, sourceFeatureId: feature.id, customEffects: [{type: "bonus", target: "initiative", value: 2}]});
		if (!active) state.deactivateState("custom");
		const otherState = state.activateState("custom", {name: feature.name, sourceFeatureId: otherOwner.id, customEffects: []});
		const unownedState = state.addActiveState("custom", {name: feature.name, customEffects: []});
		const survivors = state.getNamedModifiers().filter(mod => [manual, other, otherSave, dormant].includes(mod.id));
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			expect(state.getInitiative()).toBe(active ? 12 : 10);
			state.removeFeature(feature.id);
			expect(state.getInitiative()).toBe(10);
			expect(state.getNamedModifiers()).toEqual(survivors);
			expect(state.getActiveStates().map(s => s.id)).toEqual([otherState, unownedState]);
			expect(state.getActiveStates().some(s => s.id === ownedState)).toBe(false);
			expect(state._data.customModifiers.initiativeAdjustment).toBe(1);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("exact feature ownership"));
			for (let cycle = 0; cycle < 2; cycle++) {
				state.loadFromJson(state.toJson());
				state.applyClassFeatureEffects();
				expect(state.getInitiative()).toBe(10);
				expect(state.getNamedModifiers()).toEqual(survivors);
			}
		} finally { warn.mockRestore(); }
	});

	test("truly source-owned generated initiative is revoked, not preserved by its name", () => {
		const state = new State();
		state.setAbilityBase("dex", 12);
		state.addFeature({name: "Quick Heritage", source: "HB", featureType: "Species", description: "You gain a +2 bonus to initiative."});
		const feature = state.getFeatures()[0];
		const generated = state.getNamedModifiers().find(mod => mod.sourceFeatureId === feature.id);
		expect(generated).toMatchObject({type: "initiative", value: 2});
		expect(state.getInitiative()).toBe(3);
		state.removeFeature(feature.id);
		expect(state.getInitiative()).toBe(1);
		expect(state.getNamedModifiers()).toEqual([]);
	});

	test("a same-name feature from another source keeps its own modifiers and active state", () => {
		const state = new State();
		const first = addTrait(state);
		const second = addTrait(state, trait.name, "HB");
		const other = state.addNamedModifier({name: trait.name, type: "initiative", value: 4, sourceFeatureId: second.id});
		const otherState = state.activateState("custom", {name: trait.name, sourceFeatureId: second.id, customEffects: []});
		state.removeFeature(first.id);
		expect(state.getNamedModifiers().some(mod => mod.sourceFeatureId === first.id)).toBe(false);
		expect(state.getNamedModifiers().find(mod => mod.id === other).value).toBe(4);
		expect(state.getActiveStates().map(s => s.id)).toEqual([otherState]);
	});

	test("legacy no-ID feature removal retains ambiguous initiative and unowned states with disclosure", () => {
		const state = new State();
		addTrait(state);
		const feature = state._data.features.find(f => f.name === trait.name);
		state.removeModifiersByFeature(feature.id);
		delete feature.id;
		const manual = state.addNamedModifier({name: feature.name, type: "initiative", value: 5});
		const unownedState = state.addActiveState("custom", {name: feature.name, customEffects: []});
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			state.removeFeature(feature);
			expect(state.getNamedModifiers().map(mod => mod.id)).toEqual([manual]);
			expect(state.getActiveStates().map(s => s.id)).toEqual([unownedState]);
			expect(state.getInitiative()).toBe(5);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("exact feature ownership"));
		} finally { warn.mockRestore(); }
	});

	test("legacy unowned non-initiative cleanup and the preserve option keep their existing behavior", () => {
		for (const preserveUnattributedModifiers of [false, true]) {
			const state = new State();
			const feature = addTrait(state);
			const legacy = state.addNamedModifier({name: feature.name, type: "save:wis", value: 2});
			state.removeFeature(feature.id, undefined, {preserveUnattributedModifiers});
			expect(state.getNamedModifiers().some(mod => mod.sourceFeatureId === feature.id)).toBe(false);
			expect(state.getNamedModifiers().some(mod => mod.id === legacy)).toBe(preserveUnattributedModifiers);
		}
	});

	test("real Time Domain Respec revokes owned Right on Time but keeps a manual name twin", async () => {
		const {state} = makeTimeCleric();
		const manual = state.addNamedModifier({name: rightOnTime.name, type: "initiative", value: 2});
		const respec = Object.create(globalThis.CharacterSheetRespec.prototype);
		respec._state = state;
		respec._page = {
			getSubclassFeatures: () => tgtt.subclassFeature,
			getClassFeatures: () => tgtt.classFeature,
			getClasses: () => tgtt.class,
			filterByAllowedSources: values => values,
		};
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			await respec._applySubclassChange(3, {level: 3, class: {name: "Cleric", source: "TGTT"}}, state.getClasses()[0].subclass, tgtt.subclass.find(sc => sc.className === "Cleric" && sc.name === "Darkness Domain"));
			state.applyClassFeatureEffects();
			expect(state.getFeatures().some(feature => feature.name === rightOnTime.name)).toBe(false);
			expect(state.getNamedModifiers().find(mod => mod.id === manual)).toMatchObject({name: rightOnTime.name, value: 2});
			expect(state.getInitiative()).toBe(9);
			state.loadFromJson(state.toJson());
			expect(state.getInitiative()).toBe(9);
		} finally { warn.mockRestore(); }
	});
});
