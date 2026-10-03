import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const {CharacterSheetState: State, CharacterSheetRespecEngine: Engine} = globalThis;
const improvement = {name: "Ability Score Improvement", source: "PHB", className: "Fighter", classSource: "PHB", level: 4, entries: []};
const cls = {name: "Fighter", source: "PHB", hd: {faces: 10}, classFeatures: ["Ability Score Improvement|Fighter|PHB|4"]};

function fixture () {
	const state = new State();
	state.addClass({...cls, level: 4});
	for (let level = 1; level <= 4; level++) state.recordLevelChoice({level, class: {name: cls.name, source: cls.source}, choices: {}});
	state.setAbilityBase("str", 19);
	const page = {
		getClasses: () => [cls],
		getClassFeatures: () => [improvement],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [],
		saveCharacter: jest.fn().mockResolvedValue(),
		renderCharacter: jest.fn(),
	};
	const engine = new Engine({state, page});
	engine.begin();
	const decision = engine.manifest.decisions.find(candidate => ["asi", "asiOrFeat"].includes(candidate.type));
	expect(decision).toBeDefined();
	return {state, page, engine, decision};
}

function selectionFor (decision, increases) {
	return decision.type === "asiOrFeat" ? {mode: "asi", asi: increases} : increases;
}

function applyWithReceipt (decision, state, {ability = "str", amount = 2, featureId = "canonical-asi"} = {}) {
	const before = state.getAbilityBase(ability);
	const after = Math.min(20, before + amount);
	state.setAbilityBase(ability, after);
	state.addFeature({id: featureId, ...improvement, featureType: "Class", sourceDecisionKey: decision.semanticKey});
	return {
		version: 1,
		sourceDecisionKey: decision.semanticKey,
		effects: [
			{type: "abilityDelta", sourceDecisionKey: decision.semanticKey, ability, amount: after - before, before, after},
			{type: "materialized", features: [{id: featureId, name: improvement.name, source: improvement.source}]},
		],
	};
}

describe("Respec validates canonical callback ASI acquisition receipts", () => {
	it("preserves actual capped deltas through finalize, refresh, stamping, Apply/reload and reversal", async () => {
		const {state, page, engine, decision} = fixture();
		let supplied;
		await engine.stageGraphMutation(decision.id, selectionFor(decision, {str: 2}), {
			apply: ({state: candidate}) => {
				supplied = applyWithReceipt(decision, candidate);
				return {receipt: supplied};
			},
		});
		expect(supplied.effects[0]).toMatchObject({amount: 1, before: 19, after: 20});
		expect(engine.manifest.decisions.find(candidate => candidate.semanticKey === decision.semanticKey).receipt).toEqual(supplied);
		engine.refreshManifest();
		expect(engine.manifest.decisions.find(candidate => candidate.semanticKey === decision.semanticKey).receipt).toEqual(supplied);
		await engine.apply();
		const loaded = new State();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = new Engine({page, state: loaded});
		reopened.begin();
		const next = reopened.manifest.decisions.find(candidate => candidate.semanticKey === decision.semanticKey);
		expect(next.receipt).toEqual(supplied);
		reopened.state.reverseProgressionImprovementReceipt(next);
		expect(reopened.state.getAbilityBase("str")).toBe(19);
	});

	it("retains a zero applied delta rather than later reversing the authored amount", async () => {
		const {engine, decision} = fixture();
		engine.state.setAbilityBase("str", 20);
		await engine.stageGraphMutation(decision.id, selectionFor(decision, {str: 2}), {
			apply: ({state}) => ({receipt: applyWithReceipt(decision, state)}),
		});
		const next = engine.manifest.decisions.find(candidate => candidate.semanticKey === decision.semanticKey);
		expect(next.receipt.effects[0]).toMatchObject({amount: 0, before: 20, after: 20});
		engine.state.reverseProgressionImprovementReceipt(next);
		expect(engine.state.getAbilityBase("str")).toBe(20);
	});

	it("derives the post-teardown baseline from an exact outgoing receipt when the callback owns reversal", async () => {
		const {engine, decision} = fixture();
		await engine.stageGraphMutation(decision.id, selectionFor(decision, {str: 2}), {
			apply: ({state}) => ({receipt: applyWithReceipt(decision, state)}),
		});
		const previous = engine.manifest.decisions.find(candidate => candidate.semanticKey === decision.semanticKey);
		await engine.stageGraphMutation(previous.id, selectionFor(previous, {con: 2}), {
			apply: ({state}) => {
				state.reverseProgressionImprovementReceipt(previous);
				return {receipt: applyWithReceipt(previous, state, {ability: "con", featureId: "replacement-asi"})};
			},
		});
		const next = engine.manifest.decisions.find(candidate => candidate.semanticKey === decision.semanticKey);
		expect(engine.state.getAbilityBase("str")).toBe(19);
		expect(next.receipt.effects[0]).toMatchObject({ability: "con", amount: 2, before: 10, after: 12});
	});

	it("uses an engine-observed capture after callback teardown, including supported legacy non-ASI teardown", async () => {
		const {engine, decision} = fixture();
		const stored = engine.state.getLevelHistoryEntry(4).decisions.find(candidate => candidate.semanticKey === decision.semanticKey);
		stored.selection = {mode: "feat", feat: {name: "Legacy", source: "PHB"}};
		const original = engine.manifest.decisions.find(candidate => candidate.semanticKey === decision.semanticKey);
		original.selection = stored.selection;
		original.receipt = null;
		await engine.stageGraphMutation(original.id, selectionFor(original, {str: 2}), {
			apply: ({state, captureReceiptBaseline}) => {
				state.setAbilityBase("str", 17);
				captureReceiptBaseline();
				return {receipt: applyWithReceipt(original, state)};
			},
		});
		expect(engine.manifest.decisions.find(candidate => candidate.semanticKey === decision.semanticKey).receipt.effects[0])
			.toMatchObject({amount: 2, before: 17, after: 19});
	});

	it.each([
		["wrong owner", receipt => { receipt.sourceDecisionKey = "different-owner"; }],
		["wrong amount", receipt => { receipt.effects[0].amount = 2; }],
		["wrong before", receipt => { receipt.effects[0].before = 18; }],
		["wrong after", receipt => { receipt.effects[0].after = 21; }],
		["nonfinite delta", receipt => { receipt.effects[0].amount = NaN; }],
		["wrong ability", receipt => { receipt.effects[0].ability = "strength"; }],
		["wrong feature evidence", receipt => { receipt.effects[1].features[0].source = "TGTT"; }],
		["unsupported effect shape", receipt => { receipt.effects.push({type: "ownership", ownership: []}); }],
	])("rolls back %s evidence, preserving state, ledger and baseline-issue classification", async (name, alter) => {
		const {state, engine, decision} = fixture();
		const beforeLive = state.toJson();
		const beforeDraft = engine.state.toJson();
		const validation = engine.getValidation();
		await expect(engine.stageGraphMutation(decision.id, selectionFor(decision, {str: 2}), {
			apply: async ({state: candidate}) => {
				const receipt = applyWithReceipt(decision, candidate);
				alter(receipt);
				return {receipt};
			},
		})).rejects.toThrow(/replacement ASI receipt/);
		expect(state.toJson()).toEqual(beforeLive);
		expect(engine.state.toJson()).toEqual(beforeDraft);
		expect(engine.getValidation()).toEqual(validation);
		expect(engine.isDirty).toBe(false);
	});

	it("rejects a legacy selected acquisition's unobserved intermediate before value without restricting untouched drafts", async () => {
		const {engine, decision} = fixture();
		const current = engine.manifest.decisions.find(candidate => candidate.semanticKey === decision.semanticKey);
		current.selection = {mode: "feat", feat: {name: "Legacy", source: "PHB"}};
		current.receipt = null;
		const before = engine.state.toJson();
		await expect(engine.stageGraphMutation(current.id, selectionFor(current, {str: 2}), {
			apply: async ({state}) => ({receipt: applyWithReceipt(current, state)}),
		})).rejects.toThrow(/Capture the observed post-teardown/);
		expect(engine.state.toJson()).toEqual(before);
	});
});
