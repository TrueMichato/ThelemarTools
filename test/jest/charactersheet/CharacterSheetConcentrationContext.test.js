import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const State = globalThis.CharacterSheetState;
const feats = JSON.parse(fs.readFileSync(new URL("../../../data/feats.json", import.meta.url), "utf8")).feat;
const brew = JSON.parse(fs.readFileSync(new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url), "utf8"));
const warCaster = source => feats.find(feat => feat.name === "War Caster" && feat.source === source);
const addContextFeature = state => {
	const feature = brew.classFeature.find(it => it.name === "Path of Lean Winters");
	return state.addFeature({...feature, description: Renderer.stripTags(JSON.stringify(feature.entries))});
};

describe("Concentration canonical context", () => {
	it.each(["PHB", "XPHB"])("preserves actual %s War Caster acquisition, ownership and reload without granting generic CON advantage", source => {
		const state = new State();
		state.addClass({name: "Druid", source: "TGTT", level: 5});
		state.addFeat(warCaster(source));
		const feat = state.getFeats().find(it => it.name === "War Caster");
		expect(feat.source).toBe(source);
		expect(state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "War Caster", sourceFeatureId: feat.id, sourceType: "feat", type: "concentration", advantage: true}),
		]));
		expect(state.makeConcentrationCheck(12)).toMatchObject({dc: 10, advantage: true, sources: ["War Caster"]});
		expect(state.aggregateModifiers("save:con").advantage).toBe(false);
		const reloaded = new State();
		reloaded.loadFromJson(state.toJson());
		expect(reloaded.makeConcentrationCheck(12)).toMatchObject({advantage: true, sources: ["War Caster"]});
		reloaded.removeFeat(feat.id);
		expect(reloaded.makeConcentrationCheck(12).advantage).toBe(false);
	});

	it.each(["PHB", "XPHB"])("retains real %s text-feature War Caster advantage", source => {
		const state = new State();
		const feat = warCaster(source);
		state.addFeature({...feat, description: Renderer.stripTags(JSON.stringify(feat.entries)), featureType: "Feat"});
		state.applyClassFeatureEffects();
		expect(state.makeConcentrationCheck(10)).toMatchObject({advantage: true, sources: ["War Caster"]});
	});

	it("offers a real text-produced contextual source, applies only selected IDs, and retains base attribution", () => {
		const state = new State();
		addContextFeature(state);
		const check = state.makeConcentrationCheck(10);
		expect(check.advantage).toBe(false);
		expect(check.sources).not.toContain("Path of Lean Winters");
		expect(check.conditionalsAvailable).toEqual([
			expect.objectContaining({sourceName: "Path of Lean Winters", conditional: "against cold weather", advantage: true}),
		]);
		const appliedConditionalIds = new Set(check.conditionalsAvailable.map(it => it.id));
		expect(state.makeConcentrationCheck(10, {appliedConditionalIds})).toMatchObject({
			advantage: true, sources: ["Path of Lean Winters"], conditionalsAvailable: [],
		});
		expect(state.makeConcentrationCheck(10).advantage).toBe(false);
		expect(state.aggregateModifiers("save:con").advantage).toBe(false);
	});

	it("counts cached unconditional and opted conditional numeric contributions once across matching channels", () => {
		const state = new State();
		state.setAbilityBase("con", 16);
		state.addNamedModifier({id: "all", name: "All rolls", type: "d20:all", value: 2, enabled: true});
		state.addNamedModifier({id: "con", name: "CON training", type: "save:con", value: 3, enabled: true});
		state.addNamedModifier({id: "focus", name: "Focus", type: "concentration", value: 4, enabled: true});
		state.addNamedModifier({id: "conditional", name: "Context", type: "save:con", value: 5, enabled: false, conditional: "when applicable"});
		expect(state.getSaveMod("con")).toBe(8);
		const check = state.makeConcentrationCheck(10);
		expect(check.bonus).toBe(12);
		const appliedConditionalIds = new Set(check.conditionalsAvailable.map(it => it.id));
		expect(state.makeConcentrationCheck(10, {appliedConditionalIds}).bonus).toBe(17);
	});

	it("does not apply an enabled contextual numeric modifier by default through the save cache", () => {
		const state = new State();
		state.addNamedModifier({name: "Context", type: "save:con", value: 5, enabled: true, conditional: "when applicable"});
		expect(state.makeConcentrationCheck(10).bonus).toBe(0);
	});

	it("dedupes the same source-aware die across channels without collapsing distinct equal dice", () => {
		const state = new State();
		state.addNamedModifier({id: "global-die", name: "Global die", type: "d20:all", value: 0, bonusDie: "1d4", enabled: true});
		state.addNamedModifier({id: "focus-die", name: "Focus die", type: "concentration", value: 0, bonusDie: "1d4", enabled: true});
		expect(state.makeConcentrationCheck(10).bonusDiceContributions).toEqual([
			{id: state.getNamedModifiers().find(it => it.name === "Global die").id, dice: "1d4", source: "Global die", conditional: null},
			{id: state.getNamedModifiers().find(it => it.name === "Focus die").id, dice: "1d4", source: "Focus die", conditional: null},
		]);
	});

	it("honors the known concentration qualifier without leaking it to generic CON saves", () => {
		const state = new State();
		state.addNamedModifier({name: "Concentration-only", type: "save:con:concentration", value: 2, advantage: true, enabled: true});
		expect(state.makeConcentrationCheck(10)).toMatchObject({bonus: 2, advantage: true, conditionalsAvailable: []});
		expect(state.aggregateModifiers("save:con").advantage).toBe(false);
		expect(state.aggregateModifiers("save:con").bonus).toBe(0);
		expect(state.getSaveMod("con")).toBe(0);
	});

	it("includes real TGTT Poisoned disadvantage and preserves cancellation with War Caster", () => {
		const state = new State();
		state.addCondition({name: "Poisoned", source: "TGTT"});
		expect(state.makeConcentrationCheck(10)).toMatchObject({advantage: false, disadvantage: true});
		state.addFeat(warCaster("XPHB"));
		const check = state.makeConcentrationCheck(10);
		expect(check).toMatchObject({advantage: true, disadvantage: true});
		expect(check.sources).toContain("War Caster");
		expect(check.sources.some(source => /poisoned/i.test(source))).toBe(true);
		expect(state.aggregateModifiers("save:con").advantage).toBe(false);
	});

	it("does not confuse standard Poisoned with concentration disadvantage", () => {
		const state = new State();
		state.addCondition({name: "Poisoned", source: "XPHB"});
		expect(state.makeConcentrationCheck(10)).toMatchObject({advantage: false, disadvantage: false});
	});

	it("preserves item and active-state flat bonuses while keeping conditional active advantage opt-in", () => {
		const state = new State();
		state.setAbilityBase("con", 16);
		state.activateState("bladesong", {customEffects: [
			{type: "bonus", target: "concentration", value: 3},
			{type: "advantage", target: "save:con", conditional: "in this situation"},
		]});
		state._data.itemBonuses.savingThrowConcentration = 2;
		const check = state.makeConcentrationCheck(10);
		expect(check.bonus).toBe(8);
		expect(check.advantage).toBe(false);
		const appliedConditionalIds = new Set(check.conditionalsAvailable.map(it => it.id));
		expect(state.makeConcentrationCheck(10, {appliedConditionalIds}).advantage).toBe(true);
	});

	it("preserves manual save, item and state bonuses while replacing only genuinely cached named saves", () => {
		const state = new State();
		state.setAbilityBase("con", 14);
		state.addNamedModifier({name: "Named CON", type: "save:con", value: 3, enabled: true});
		state.addNamedModifier({name: "Other subtype", type: "save:concentration", value: 20, enabled: true});
		state._data.customModifiers.savingThrows.con += 7;
		state._data.itemBonuses.savingThrow = 1;
		state._data.itemBonuses.savingThrowConcentration = 2;
		state.activateState("custom", {name: "Save aura", customEffects: [{type: "bonus", target: "save:con", value: 4}]});
		const probe = state.makeConcentrationCheck(10);
		expect(probe.bonus).toBe(19);
		expect(probe.conditionalsAvailable).toEqual(expect.arrayContaining([expect.objectContaining({conditional: "against concentration"})]));
	});

	it("keeps registry subtype gating identical for single-type and union queries", () => {
		const state = new State();
		state.addNamedModifier({name: "Fear ward", type: "save:advantage:frightened", value: 1, enabled: true});
		const ordinary = state.aggregateModifiers("save:con");
		const union = state.aggregateModifiers("save:con", {additionalTypes: ["concentration"]});
		expect(union).toEqual(ordinary);
		expect(union).toMatchObject({bonus: 0, advantage: false});
		expect(union.conditionalsAvailable).toEqual([expect.objectContaining({conditional: "against being frightened", bonus: 0})]);
	});

	it("preserves distinct same-value sources while deduping a shared general modifier", () => {
		const state = new State();
		state.addNamedModifier({name: "All rolls", type: "d20:all", value: 2, enabled: true});
		state.addNamedModifier({name: "Focus one", type: "concentration", value: 2, enabled: true});
		state.addNamedModifier({name: "Focus two", type: "concentration", value: 2, enabled: true});
		expect(state.makeConcentrationCheck(10).bonus).toBe(6);
	});

	it("dedupes real item-prose modifiers without persisted IDs across concentration queries", () => {
		const state = new State();
		state.setAbilityBase("con", 16);
		state.addItem({name: "Poison ward", source: "TEST", entries: ["You gain a +3 bonus to saving throws against poison while you wear this cloak."]}, 1, true);
		const probe = state.makeConcentrationCheck(10);
		expect(probe.bonus).toBe(3);
		expect(probe.conditionalsAvailable).toHaveLength(1);
		const appliedConditionalIds = new Set(probe.conditionalsAvailable.map(it => it.id));
		expect(state.makeConcentrationCheck(10, {appliedConditionalIds}).bonus).toBe(6);
		state.addItem({name: "Second poison ward", source: "TEST", entries: ["You gain a +3 bonus to saving throws against poison while you wear this cloak."]}, 1, true);
		const both = state.makeConcentrationCheck(10);
		expect(both.conditionalsAvailable).toHaveLength(2);
		expect(state.makeConcentrationCheck(10, {appliedConditionalIds: new Set(both.conditionalsAvailable.map(it => it.id))}).bonus).toBe(9);
	});
});
