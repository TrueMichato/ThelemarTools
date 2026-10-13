import {jest} from "@jest/globals";
import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {applySourceCost, resolveSourceCost} from "../../../js/hub/hub-source-costs.js";
import {createSemanticOperationRegistry} from "../../../server/src/semantic-operation-registry.js";

const State = globalThis.CharacterSheetState;
const ClassUtils = globalThis.CharacterSheetClassUtils;
const data = JSON.parse(fs.readFileSync("data/class/class-paladin.json", "utf8"));
const paladin = data.class.find(entry => entry.name === "Paladin" && entry.source === "XPHB");

function acquire (level = 1) {
	const state = new State();
	state.addClass({name: "Paladin", source: "XPHB", level});
	const cls = state.getClasses()[0];
	ClassUtils.updateClassResources(state, cls, level, paladin);
	ClassUtils.reconcileClassFeatures(state, {getClassData: () => paladin, classFeatures: data.classFeature});
	return state;
}

function binding (state, amount = 1) {
	const feature = state.getFeatures().find(entry => entry.name === "Lay on Hands" && entry.source === "XPHB");
	const resource = state.getResources().find(entry => entry.featureId === feature.id);
	expect(resource).toBeDefined();
	expect(feature.resourceId).toBe(resource.id);
	expect(resource.featureRef).toEqual({uid: "lay on hands|xphb"});
	expect(feature.uses).toMatchObject({current: resource.current, max: resource.max, recharge: "long"});
	const sourceCost = {version: 1, components: [{kind: "feature_use", resourceId: resource.id, featureRef: resource.featureRef, amount}]};
	resolveSourceCost({data: state.toJson(), sourceCost});
	return {feature, resource, sourceCost};
}

describe("XPHB Lay on Hands ordinary acquisition and resource binding", () => {
	it.each([1, 4, 20])("derives the production heal-only template from ordinary level-%i acquisition and its actual bound pool", level => {
		const state = acquire(level);
		const {resource, sourceCost} = binding(state, 4);
		const derived = createSemanticOperationRegistry().derive({
			sourceCharacter: {id: "source", data: state.toJson()},
			targetCharacter: {id: "target", targetRef: "target-ref", data: {hp: {current: 1, max: 100}}},
			targetRef: "target-ref",
			sourceEntity: {type: "ability", uid: "lay on hands|xphb", version: "xphb-2024-v1"},
			effectTemplateId: "ability.lay-on-hands.heal",
			choice: {amount: 4},
		});
		expect(derived.operation).toMatchObject({kind: "hp.heal", arguments: {amount: 4}});
		expect(derived.sourceCost).toEqual(sourceCost);
		expect(resource).toMatchObject({max: 5 * level, current: 5 * level});
	});
	it("acquires from the real checked-in class through ordinary class-resource/feature reconciliation, then binds after round trip", () => {
		const state = acquire();
		const {feature, resource, sourceCost} = binding(state, 4);
		expect(resource).toMatchObject({max: 5, current: 5});
		expect(resource.id).not.toMatch(/^__synthetic|^gem:/);
		const spent = applySourceCost({data: state.toJson(), sourceCost});
		const loaded = new State();
		loaded.loadFromJson(spent.data);
		const restored = binding(loaded);
		expect(restored.resource.id).toBe(resource.id);
		expect(restored.feature.id).toBe(feature.id);
		expect(restored.resource).toMatchObject({current: 1, max: 5});
	});

	it("preserves spent points and exact IDs through level-up, level-down, parser recalculation and long/short rests", () => {
		const state = acquire();
		const initial = binding(state);
		state.setResourceCurrent(initial.resource.id, 2);
		state._data.classes[0].level = 5;
		ClassUtils.updateClassResources(state, state.getClasses()[0], 5, paladin);
		expect(binding(state).resource).toMatchObject({id: initial.resource.id, current: 22, max: 25});
		state.recalculateResourceMaximums();
		expect(binding(state).resource.current).toBe(22);
		state._data.classes[0].level = 4;
		state.recalculateResourceMaximums();
		expect(binding(state).resource).toMatchObject({id: initial.resource.id, current: 17, max: 20});
		state.onShortRest();
		expect(binding(state).resource.current).toBe(17);
		state.onLongRest();
		expect(binding(state).resource).toMatchObject({current: 20, max: 20});
		state.useFeature(initial.feature.id);
		expect(binding(state).resource.current).toBe(19);
		state.setFeatureUses(initial.feature.id, 18);
		expect(binding(state).resource.current).toBe(18);
	});

	it("persists the canonical mirror through actual level-up and respec level-removal APIs without relying on resource reads", () => {
		const state = acquire();
		const initial = binding(state);
		state.setResourceCurrent(initial.resource.id, 2);
		state.recordLevelChoice({level: 1, class: {name: "Paladin", source: "XPHB", level: 1}});
		for (let level = 2; level <= 5; level++) {
			expect(state.levelUp("Paladin")).toBe(true);
			state.recordLevelChoice({level, class: {name: "Paladin", source: "XPHB", level}});
			const persisted = state.toJson();
			expect(persisted.resources.find(resource => resource.id === initial.resource.id)).toMatchObject({current: 5 * level - 3, max: 5 * level});
			expect(persisted.features.find(feature => feature.id === initial.feature.id).uses).toMatchObject({current: 5 * level - 3, max: 5 * level});
		}
		expect(state.removeClassLastLevel("Paladin", "XPHB")).toMatchObject({success: true});
		const persisted = state.toJson();
		expect(persisted.resources.find(resource => resource.id === initial.resource.id)).toMatchObject({current: 17, max: 20});
		expect(persisted.features.find(feature => feature.id === initial.feature.id).uses).toMatchObject({current: 17, max: 20});
		const restored = new State();
		restored.loadFromJson(persisted);
		expect(binding(restored).resource).toMatchObject({id: initial.resource.id, current: 17, max: 20});
	});

	it("repairs an exact-source legacy unlinked ordinary pool without changing its ID or spent points", () => {
		const state = acquire();
		const {feature, resource} = binding(state);
		state.setResourceCurrent(resource.id, 2);
		const legacy = state.toJson();
		const storedResource = legacy.resources.find(entry => entry.id === resource.id);
		const storedFeature = legacy.features.find(entry => entry.id === feature.id);
		delete storedResource.featureId;
		delete storedResource.featureRef;
		delete storedFeature.resourceId;
		delete storedFeature.uses;
		const loaded = new State();
		loaded.loadFromJson(legacy);
		expect(binding(loaded).resource).toMatchObject({id: resource.id, current: 2, max: 5});
	});

	it.each(["duplicate-resource", "duplicate-feature", "stale-link", "mismatched-mirror", "wrong-ref", "innate-alias", "wrong-recharge", "short-rest-recovery"])("rejects %s without silently rewriting the invalid binding", problem => {
		const state = acquire();
		const {feature, resource, sourceCost} = binding(state);
		if (problem === "duplicate-resource") state._data.resources.push({...resource});
		if (problem === "duplicate-feature") state._data.features.push({...feature, uses: {...feature.uses}});
		if (problem === "stale-link") resource.featureId = "absent-feature";
		if (problem === "mismatched-mirror") state._data.features.find(entry => entry.id === feature.id).uses.current--;
		if (problem === "wrong-ref") resource.featureRef = {uid: "lay on hands|phb"};
		if (problem === "innate-alias") state._data.spellcasting.innateSpells.push({id: "unrelated-spell", resourceId: resource.id, uses: {...feature.uses}});
		if (problem === "wrong-recharge") resource.recharge = "short";
		if (problem === "short-rest-recovery") resource.shortRestRecovery = 1;
		const before = JSON.stringify({features: state._data.features, resources: state._data.resources});
		const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			state.recalculateResourceMaximums();
			expect(JSON.stringify({features: state._data.features, resources: state._data.resources})).toBe(before);
			expect(warning).toHaveBeenCalledWith(expect.stringContaining("Lay on Hands"), expect.any(String));
			expect(() => createSemanticOperationRegistry().derive({
				sourceCharacter: {id: "source", data: state.toJson()},
				targetCharacter: {id: "target", targetRef: "target-ref", data: {hp: {current: 1, max: 100}}},
				targetRef: "target-ref",
				sourceEntity: {type: "ability", uid: "lay on hands|xphb", version: "xphb-2024-v1"},
				effectTemplateId: "ability.lay-on-hands.heal",
				choice: {amount: sourceCost.components[0].amount},
			})).toThrow();
		} finally {
			warning.mockRestore();
		}
	});

	it("does not repair a name-only feature or alter the ordinary PHB acquisition path", () => {
		const state = new State();
		state.addClass({name: "Paladin", source: "PHB", level: 1});
		const phb = data.class.find(entry => entry.name === "Paladin" && entry.source === "PHB");
		ClassUtils.updateClassResources(state, state.getClasses()[0], 1, phb);
		state.addFeature({name: "Lay on Hands", source: "PHB", className: "Paladin", classSource: "PHB", level: 1});
		const resource = state.getResource("Lay on Hands");
		expect(resource).toMatchObject({max: 5, current: 5});
		expect(resource.featureId).toBeUndefined();
		expect(resource.featureRef).toBeUndefined();
	});

	it.each(["resource-id-whitespace", "feature-id-whitespace", "feature-id-alias", "wrong-source", "wrong-class-source", "wrong-max", "innate-link", "brew-link", "short-recharge", "feature-alias"])("the production binder rejects %s in an actually acquired source without rewriting it", problem => {
		const state = acquire();
		const initial = binding(state);
		const source = state.toJson();
		const feature = source.features.find(entry => entry.id === initial.feature.id);
		const resource = source.resources.find(entry => entry.id === initial.resource.id);
		if (problem === "resource-id-whitespace") feature.resourceId = resource.id = ` ${resource.id}`;
		if (problem === "feature-id-whitespace") resource.featureId = feature.id = ` ${feature.id}`;
		if (problem === "feature-id-alias") source.features.push({id: feature.id.toUpperCase(), name: "Different feature", source: "PHB"});
		if (problem === "wrong-source") feature.source = "PHB";
		if (problem === "wrong-class-source") feature.classSource = "PHB";
		if (problem === "wrong-max") resource.max = feature.uses.max = 10;
		if (problem === "innate-link") source.spellcasting.innateSpells.push({id: "unrelated-spell", linkedResourceId: resource.id, uses: {...feature.uses}});
		if (problem === "brew-link") resource.brewBundleVersionId = "unreviewed-brew";
		if (problem === "short-recharge") feature.uses.recharge = "short";
		if (problem === "feature-alias") source.features.push({id: "different-feature", name: "Different feature", source: "PHB", resourceId: resource.id});
		const before = JSON.stringify(source);
		expect(() => createSemanticOperationRegistry().derive({
			sourceCharacter: {id: "source", data: source},
			targetCharacter: {id: "target", targetRef: "target-ref", data: {hp: {current: 1, max: 100}}},
			targetRef: "target-ref",
			sourceEntity: {type: "ability", uid: "lay on hands|xphb", version: "xphb-2024-v1"},
			effectTemplateId: "ability.lay-on-hands.heal",
			choice: {amount: 1},
		})).toThrow();
		expect(JSON.stringify(source)).toBe(before);
	});

	it.each([0, -1, 1.5, 6, 101, Number.NaN, Number.POSITIVE_INFINITY])("rejects selected healing amount %s against the actually acquired ordinary pool", amount => {
		const state = acquire();
		const before = state.toJson();
		expect(() => createSemanticOperationRegistry().derive({
			sourceCharacter: {id: "source", data: before},
			targetCharacter: {id: "target", targetRef: "target-ref", data: {hp: {current: 1, max: 100}}},
			targetRef: "target-ref",
			sourceEntity: {type: "ability", uid: "lay on hands|xphb", version: "xphb-2024-v1"},
			effectTemplateId: "ability.lay-on-hands.heal",
			choice: {amount},
		})).toThrow();
		expect(state.toJson()).toEqual(before);
	});
});
