import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const {CharacterSheetState: State, CharacterSheetRespecEngine: Engine} = globalThis;
const feature = {name: "Ability Score Improvement", source: "PHB", className: "Fighter", classSource: "PHB", level: 4, entries: []};
const cls = {name: "Fighter", source: "PHB", hd: {faces: 10}, classFeatures: ["Ability Score Improvement|Fighter|PHB|4"]};
const feat = {name: "Strength Training", source: "PHB", ability: [{str: 1}]};

function grantAsi (state, decision, ability, amount, id) {
	const before = state.getAbilityBase(ability);
	const after = Math.min(20, before + amount);
	state.setAbilityBase(ability, after);
	state.addFeature({...feature, id, featureType: "Class", sourceDecisionKey: decision.semanticKey});
	return {
		version: 1,
		sourceDecisionKey: decision.semanticKey,
		effects: [
			{type: "abilityDelta", sourceDecisionKey: decision.semanticKey, ability, amount: after - before, before, after},
			{type: "materialized", features: [{id, name: feature.name, source: feature.source}]},
		],
	};
}

async function fixture ({pairedFeat = feat, pairedChoices = null, legacy = false} = {}) {
	const selectedFeat = {...pairedFeat, choices: pairedChoices, _featChoices: pairedChoices};
	const state = new State();
	state.setSetting("thelemar_asiFeat", true);
	state.addClass({...cls, level: 4});
	state.setAbilityBase("str", 18);
	for (let level = 1; level <= 4; level++) state.recordLevelChoice({level, class: {name: cls.name, source: cls.source}, choices: {}});
	const page = {
		getClasses: () => [cls],
		getClassFeatures: () => [feature],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [pairedFeat],
		saveCharacter: jest.fn().mockResolvedValue(),
		renderCharacter: jest.fn(),
	};
	const seed = new Engine({state, page});
	seed.begin();
	const ordinary = seed.manifest.decisions.find(row => row.type === "asi");
	const paired = seed.manifest.decisions.find(row => row.type === "feat");
	expect(ordinary).toBeDefined();
	expect(paired.meta.improvement.kind).toBe("asiAndFeat");
	await seed.stageGraphMutation(ordinary.id, {str: 2}, {
		apply: ({state: candidate}) => ({receipt: grantAsi(candidate, ordinary, "str", 2, "seed-asi")}),
	});
	if (!legacy) {
		await seed.stageGraphMutation(paired.id, selectedFeat, {
			apply: ({state: candidate}) => {
				candidate.addFeat(selectedFeat, {sourceDecisionKey: paired.semanticKey});
				globalThis.CharacterSheetClassUtils.applyFeatBonuses(candidate, {...selectedFeat, sourceDecisionKey: paired.semanticKey});
			},
		});
	}
	await seed.apply();
	if (legacy) {
		const history = state.getLevelHistoryEntry(4);
		state.recordLevelChoice({...history, choices: {...history.choices, feat: {name: pairedFeat.name, source: pairedFeat.source}, featChoices: pairedChoices}, decisions: history.decisions.filter(row => row.semanticKey === ordinary.semanticKey)});
		state.addFeat(selectedFeat);
		globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, selectedFeat);
		expect(state.getFeats()[0].sourceDecisionKey).toBeUndefined();
	}
	expect(state.getAbilityBase("str")).toBe(20);
	const engine = new Engine({state, page});
	engine.begin();
	return {state, page, engine, ordinaryKey: ordinary.semanticKey, pairedKey: paired.semanticKey, pairedFeat, pairedChoices, pairedId: state.getFeats()[0].id};
}

async function replace (fixture, {ability = "con", amount = 2, alter = null, reuse = false, pairedChoices = fixture.pairedChoices} = {}) {
	const {engine, ordinaryKey, pairedKey} = fixture;
	const selectedFeat = {...fixture.pairedFeat, choices: pairedChoices, _featChoices: pairedChoices};
	const decision = engine.manifest.decisions.find(row => row.semanticKey === ordinaryKey);
	const selection = amount === 1 ? {[ability]: 1, dex: 1} : {[ability]: amount};
	return engine.stageGraphMutation(decision.id, selection, {
		apply: async ({state, captureReceiptBaseline, captureReceiptResult}) => {
			const previous = state.getFeats().find(row => row.sourceDecisionKey === pairedKey || row.id === fixture.pairedId);
			if (!reuse) state.removeFeat(previous.id);
			state.reverseProgressionImprovementReceipt(decision);
			if (alter === "before baseline") captureReceiptResult();
			captureReceiptBaseline();
			if (alter === "early boundary") captureReceiptResult();
			const receipt = grantAsi(state, decision, ability, amount, "replacement-asi");
			if (amount === 1) {
				const before = state.getAbilityBase("dex");
				const after = Math.min(20, before + 1);
				state.setAbilityBase("dex", after);
				receipt.effects.splice(1, 0, {type: "abilityDelta", sourceDecisionKey: decision.semanticKey, ability: "dex", amount: after - before, before, after});
			}
			if (alter !== "early boundary") captureReceiptResult();
			if (!reuse) state.addFeat(selectedFeat, {sourceDecisionKey: pairedKey});
			globalThis.CharacterSheetClassUtils.applyFeatBonuses(state, {...selectedFeat, sourceDecisionKey: pairedKey});
			if (typeof alter === "function") alter({state, receipt, pairedKey, captureReceiptResult});
			return alter === "missing receipt" ? {} : {receipt};
		},
	});
}

describe("Observed ASI end boundary and exact retained paired feat ownership", () => {
	it.each([
		["con", 2, 19, 12, 2, 12],
		["str", 1, 20, 10, 1, 19],
	])("keeps ordinary %s separate from a capped-zero paired feat gaining one after the grant", async (ability, amount, str, con, delta, end) => {
		const data = await fixture();
		const original = data.state.toJson();
		await replace(data, {ability, amount});
		const receipt = data.engine.manifest.decisions.find(row => row.semanticKey === data.ordinaryKey).receipt;
		expect(receipt.effects[0]).toMatchObject({ability, amount: delta, after: end});
		expect(data.engine.state.getAbilityBase("str")).toBe(str);
		expect(data.engine.state.getAbilityBase("con")).toBe(con);
		expect(data.engine.state.getFeats().find(row => row.sourceDecisionKey === data.pairedKey).appliedEffects.abilityDeltas).toEqual({str: 1});
		await data.engine.apply();
		data.state.loadFromJson(data.state.toJson());
		const reopened = new Engine({state: data.state, page: data.page});
		reopened.begin();
		expect(reopened.manifest.decisions.find(row => row.semanticKey === data.ordinaryKey).receipt).toEqual(receipt);
		expect(reopened.state.getAbilityBase("str")).toBe(str);
		await replace({...data, engine: reopened}, {ability: "dex", amount: 2});
		expect(reopened.state.getAbilityBase("str")).toBe(19);
		expect(reopened.state.getAbilityBase("con")).toBe(10);
		expect(reopened.state.getAbilityBase("dex")).toBe(12);
		await data.engine.undo();
		expect(data.state.toJson()).toEqual(original);
	});

	it("accepts an exact owned receipt recomputed on the retained wrapper without requiring a new UUID", async () => {
		const data = await fixture();
		const id = data.engine.state.getFeats().find(row => row.sourceDecisionKey === data.pairedKey).id;
		await replace(data, {ability: "str", amount: 1, reuse: true});
		expect(data.engine.state.getFeats().find(row => row.sourceDecisionKey === data.pairedKey))
			.toMatchObject({id, appliedEffects: {abilityDeltas: {str: 1}}});
		expect(data.engine.state.getAbilityBase("str")).toBe(20);
	});

	it("rejects a different valid canonical paired ability choice instead of retaining only its feat UID", async () => {
		const data = await fixture({pairedFeat: {...feat, ability: [{choose: {from: ["str", "dex"], count: 1, amount: 1}}]}, pairedChoices: {ability: "str"}});
		const live = data.state.toJson();
		const draft = data.engine.state.toJson();
		await expect(replace(data, {pairedChoices: {ability: "dex"}})).rejects.toThrow(/unproven/);
		expect(data.state.toJson()).toEqual(live);
		expect(data.engine.state.toJson()).toEqual(draft);
		await replace(data, {pairedChoices: {ability: {str: 1}}});
		expect(data.engine.state.getAbilityBase("str")).toBe(19);
		await data.engine.apply();
		data.state.loadFromJson(data.state.toJson());
		expect(data.state.getFeats().find(row => row.sourceDecisionKey === data.pairedKey).choices).toEqual({ability: {str: 1}});
	});

	it("rejects inherited positive proof that disappears from the saved receipt", async () => {
		const data = await fixture();
		const live = data.state.toJson();
		const draft = data.engine.state.toJson();
		await expect(replace(data, {alter: ({state, pairedKey}) => {
			const owned = state._data.feats.find(row => row.sourceDecisionKey === pairedKey);
			owned.appliedEffects.abilityDeltas = Object.create({str: 1});
			expect(Object.hasOwn(owned.appliedEffects.abilityDeltas, "str")).toBe(false);
			expect(JSON.parse(JSON.stringify(owned.appliedEffects.abilityDeltas))).toEqual({});
			expect(state.getAbilityBase("str")).toBe(19);
		}})).rejects.toThrow(/unproven/);
		expect(data.state.toJson()).toEqual(live);
		expect(data.engine.state.toJson()).toEqual(draft);
	});

	it("retains a uniquely declared legacy paired feat without injecting a source key into its original wrapper", async () => {
		const data = await fixture({legacy: true});
		expect(data.engine.state.getFeats()[0].sourceDecisionKey).toBeUndefined();
		await replace(data, {ability: "str", amount: 1});
		expect(data.engine.state.getAbilityBase("str")).toBe(20);
		expect(data.engine.state.getFeats()[0]).toMatchObject({sourceDecisionKey: data.pairedKey, appliedEffects: {abilityDeltas: {str: 1}}});
		await replace(data);
		expect(data.engine.state.getAbilityBase("str")).toBe(19);
		expect(data.engine.state.getAbilityBase("con")).toBe(12);
		await data.engine.apply();
		data.state.loadFromJson(data.state.toJson());
		expect(data.state.getAbilityBase("str")).toBe(19);
		expect(data.state.getFeats()[0].appliedEffects.abilityDeltas).toEqual({str: 1});
	});

	it.each(["ambiguous", "foreign"])("does not turn %s legacy evidence into paired ownership", async mode => {
		const data = await fixture({legacy: true});
		if (mode === "ambiguous") data.engine.state.addFeat({...feat, repeatable: true}, {sourceDecisionKey: "independent:feat"});
		else data.engine.state._data.feats[0].sourceDecisionKey = "foreign:feat";
		const live = data.state.toJson();
		const draft = data.engine.state.toJson();
		await expect(replace(data)).rejects.toThrow(/original paired feat owner/);
		expect(data.state.toJson()).toEqual(live);
		expect(data.engine.state.toJson()).toEqual(draft);
	});

	it.each([false, true])("uses exact materialized legacy IDs and rejects conflicting evidence (foreign=%s)", async foreign => {
		const data = await fixture({legacy: true});
		if (foreign) data.engine.state.addFeat({...feat, repeatable: true}, {sourceDecisionKey: "independent:feat"});
		const row = data.engine.manifest.decisions.find(decision => decision.semanticKey === data.pairedKey);
		const reference = data.engine.state.getFeats().find(value => foreign ? value.sourceDecisionKey === "independent:feat" : value.id === data.pairedId);
		row.receipt = {version: 1, sourceDecisionKey: row.semanticKey, effects: [{type: "materialized", feats: [{id: reference.id, name: reference.name, source: reference.source}]}]};
		const draft = data.engine.state.toJson();
		if (foreign) {
			await expect(replace(data)).rejects.toThrow(/original paired feat owner/);
			expect(data.engine.state.toJson()).toEqual(draft);
		} else {
			await replace(data);
			expect(data.engine.state.getAbilityBase("str")).toBe(19);
		}
	});

	it.each([
		["before baseline", "before baseline"],
		["missing receipt", "missing receipt"],
		["early boundary", "early boundary"],
		["double boundary", ({captureReceiptResult}) => captureReceiptResult()],
		["untracked tail", ({state}) => state.setAbilityBase("dex", state.getAbilityBase("dex") + 1)],
		["unrelated owner", ({state, pairedKey}) => { state._data.feats.find(row => row.sourceDecisionKey === pairedKey).sourceDecisionKey = "rogue|phb:cl4:feat:feat:slot0"; }],
		["wrong canonical UID", ({state, pairedKey}) => { state._data.feats.find(row => row.sourceDecisionKey === pairedKey).source = "TGTT"; }],
		["missing paired proof", ({state, pairedKey}) => { delete state._data.feats.find(row => row.sourceDecisionKey === pairedKey).appliedEffects; }],
		["dishonest paired delta", ({state, pairedKey}) => { state.getFeats().find(row => row.sourceDecisionKey === pairedKey).appliedEffects.abilityDeltas.str = 2; }],
		["dishonest ordinary end", ({receipt}) => { receipt.effects[0].after += 1; receipt.effects[0].amount += 1; }],
		["feature created after boundary", ({state, receipt}) => {
			state.addFeature({...feature, id: "late-evidence", featureType: "Class", sourceDecisionKey: receipt.sourceDecisionKey});
			receipt.effects[1].features[0].id = "late-evidence";
		}],
	])("rolls back %s rather than hiding a write behind the result boundary", async (name, alter) => {
		const data = await fixture();
		const live = data.state.toJson();
		const draft = data.engine.state.toJson();
		await expect(replace(data, {alter})).rejects.toThrow(/ASI|paired feat/);
		expect(data.state.toJson()).toEqual(live);
		expect(data.engine.state.toJson()).toEqual(draft);
	});

	it.each(["className", "classSource", "classLevel", "characterLevel"])("does not authorize a paired feat from a different %s", async field => {
		const data = await fixture();
		const paired = data.engine.manifest.decisions.find(row => row.semanticKey === data.pairedKey);
		paired[field] = typeof paired[field] === "number" ? paired[field] + 1 : "Foreign";
		const live = data.state.toJson();
		const draft = data.engine.state.toJson();
		await expect(replace(data)).rejects.toThrow(/unproven/);
		expect(data.state.toJson()).toEqual(live);
		expect(data.engine.state.toJson()).toEqual(draft);
	});
});
