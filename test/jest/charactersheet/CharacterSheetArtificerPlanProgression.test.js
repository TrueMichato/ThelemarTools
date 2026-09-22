import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import {jest} from "@jest/globals";
import "../../../js/parser.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-levelup.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

const State = globalThis.CharacterSheetState;
const Progression = globalThis.CharacterSheetProgression;
const Plans = globalThis.CharacterSheetArtificerPlans;
const Picker = globalThis.CharacterSheetArtificerPlanPicker;
const LevelUp = globalThis.CharacterSheetLevelUp;
const QuickBuild = globalThis.CharacterSheetQuickBuild;
const RespecEngine = globalThis.CharacterSheetRespecEngine;
const Respec = globalThis.CharacterSheetRespec;

const classFile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/class/class-artificer.json"), "utf8"));
const itemFile = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/items.json"), "utf8"));
const artificer = classFile.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const feature = classFile.classFeature.find(it =>
	it.name === "Replicate Magic Item"
		&& it.className === "Artificer"
		&& it.classSource === "EFA"
		&& it.source === "EFA",
);
const items = itemFile.item;

const getPage = state => ({
	getState: () => state,
	getClasses: () => [artificer],
	getClassFeatures: () => classFile.classFeature,
	getSubclassFeatures: () => classFile.subclassFeature || [],
	getOptionalFeatures: () => [],
	getFeats: () => [],
	getSpells: () => [],
	getFilteredSpellData: () => [],
	getSkillsList: () => [],
	getItems: () => items,
	filterByAllowedSources: values => values,
	saveCharacter: jest.fn().mockResolvedValue(undefined),
	renderCharacter: jest.fn(),
});

const getLevel2Selections = () => {
	const catalog = Plans.parseCatalog({feature, items});
	const candidates = Plans.getEligibleCandidates({catalog, classLevel: 2});
	const opportunities = Plans.getProgressionOpportunities({
		className: "Artificer",
		classSource: "EFA",
		classLevel: 2,
	}).filter(it => it.kind === "acquire");
	return opportunities.map((opportunity, ix) => ({
		opportunityId: opportunity.opportunityId,
		slotId: opportunity.slotId,
		acquisitionLevel: 2,
		selection: candidates[ix],
	}));
};

const buildLevel2State = () => {
	const state = new State();
	state.addClass({name: "Artificer", source: "EFA", level: 2});
	state.recordLevelChoice({
		level: 1,
		class: {name: "Artificer", source: "EFA"},
		classLevel: 1,
		choices: {},
	});
	state.recordLevelChoice({
		level: 2,
		class: {name: "Artificer", source: "EFA"},
		classLevel: 2,
		choices: {artificerPlans: getLevel2Selections()},
	});
	return state;
};

describe("EFA Artificer plan progression integration", () => {
	test("discovers and persists exact plan receipts while leaving inventory untouched", () => {
		const state = buildLevel2State();
		state.addItem({name: "Control Item", source: "TST", type: "G"});
		const inventoryBefore = state.toJson().inventory;
		const page = getPage(state);
		const manifest = Progression.syncCanonicalDecisions({page, state});
		const planDecisions = manifest.decisions.filter(decision =>
			[Plans.DECISION_TYPE_ACQUIRE, Plans.DECISION_TYPE_REPLACE].includes(decision.type),
		);
		expect(planDecisions.filter(decision => decision.type === Plans.DECISION_TYPE_ACQUIRE)).toHaveLength(4);
		expect(planDecisions.filter(decision => decision.type === Plans.DECISION_TYPE_REPLACE)).toEqual([
			expect.objectContaining({
				required: false,
				status: "deferred",
				meta: expect.objectContaining({
					opportunityId: Plans.getReplacementOpportunityId({
						className: "Artificer",
						classSource: "EFA",
						classLevel: 2,
					}),
				}),
			}),
		]);
		for (const decision of planDecisions.filter(it => it.type === Plans.DECISION_TYPE_ACQUIRE)) {
			expect(decision.status).toBe("resolved");
			expect(decision.selection).toMatchObject({
				name: expect.any(String),
				source: expect.any(String),
				itemUid: expect.stringContaining("|"),
				catalogEntryId: expect.any(String),
			});
			expect(decision.receipt).toMatchObject({
				family: "artificer-plan",
				slotId: decision.meta.slotId,
				selection: {itemUid: decision.selection.itemUid},
			});
		}
		expect(state.toJson().inventory).toEqual(inventoryBefore);
		expect(state.getEfaArtificerPlans()).toHaveLength(4);

		const reloaded = new State();
		reloaded.loadFromJson(state.toJson());
		const reloadedManifest = Progression.buildManifest({page: getPage(reloaded), state: reloaded});
		expect(reloadedManifest.decisions
			.filter(decision => decision.type === Plans.DECISION_TYPE_ACQUIRE)
			.map(decision => decision.selection.itemUid))
			.toEqual(planDecisions
				.filter(decision => decision.type === Plans.DECISION_TYPE_ACQUIRE)
				.map(decision => decision.selection.itemUid));
		expect(reloaded.toJson().inventory).toEqual(inventoryBefore);
	});

	test("keeps source-less legacy plan evidence repairable instead of guessing", () => {
		const state = buildLevel2State();
		const entry = state.getLevelHistoryEntry(2);
		entry.decisions = [];
		entry.choices.artificerPlans[0].selection = {name: "Bag of Holding"};
		const manifest = Progression.buildManifest({page: getPage(state), state});
		const first = manifest.decisions.find(decision =>
			decision.type === Plans.DECISION_TYPE_ACQUIRE
				&& decision.meta.slotId === "efa-replicate-plan-1",
		);
		expect(first.status).toBe("ambiguous");
		expect(first.meta.validationMessage).toMatch(/source-qualified/i);
		expect(first.selection).toEqual({name: "Bag of Holding"});
	});

	test("Builder handoff creates the shared Quick Build plan step and history projection", async () => {
		const state = new State();
		state.addClass({name: "Artificer", source: "EFA", level: 1});
		state.recordLevelChoice({
			level: 1,
			class: {name: "Artificer", source: "EFA"},
			classLevel: 1,
			choices: {},
		});
		const page = getPage(state);
		const quickBuild = new QuickBuild(page);
		quickBuild._showWizard = jest.fn().mockResolvedValue(undefined);
		await quickBuild.showFromBuilder({classData: artificer, targetLevel: 2});
		expect(quickBuild._showWizard).toHaveBeenCalledTimes(1);
		quickBuild._buildWizardSteps();
		const step = quickBuild._steps.find(it => it.id === "artificer-plans");
		expect(step).toEqual(expect.objectContaining({required: true}));
		const opportunities = quickBuild._getArtificerPlanOpportunities(step.data);
		const selections = getLevel2Selections();
		const byId = new Map(selections.map(it => [it.opportunityId, it.selection]));
		quickBuild._selections.artificerPlanDecisions = opportunities.map(opportunity => ({
			...opportunity,
			selection: byId.get(opportunity.opportunityId) || null,
		}));
		expect(quickBuild._validateArtificerPlanStep(step.data)).toBe(true);
		const analysis = quickBuild._levelAnalysis.find(it => it.classLevel === 2);
		const history = quickBuild._buildHistoryEntry(analysis, "Artificer_2");
		expect(history.choices.artificerPlans).toHaveLength(4);
		expect(history.choices.artificerPlanReplacements).toBeUndefined();

		const level3State = buildLevel2State();
		const level3QuickBuild = new QuickBuild(getPage(level3State));
		level3QuickBuild._showWizard = jest.fn().mockResolvedValue(undefined);
		await level3QuickBuild.showQuickBuild();
		level3QuickBuild._classAllocations[0].classData = artificer;
		level3QuickBuild._classAllocations[0].targetLevel = 3;
		level3QuickBuild._targetLevel = 3;
		level3QuickBuild._buildWizardSteps();
		const optionalStep = level3QuickBuild._steps.find(it => it.id === "artificer-plans");
		expect(optionalStep).toEqual(expect.objectContaining({required: false}));
		expect(level3QuickBuild._validateArtificerPlanStep(optionalStep.data)).toBe(true);
	});

	test("Level Up uses the shared every-level opportunity path before history exists", () => {
		const state = buildLevel2State();
		const levelUp = new LevelUp(getPage(state));
		const level3 = levelUp.getArtificerPlanOpportunities({
			classEntry: {name: "Artificer", source: "EFA", level: 2},
			newLevel: 3,
		});
		expect(level3).toEqual([
			expect.objectContaining({
				kind: "replacement",
				required: false,
				classLevel: 3,
				characterLevel: 3,
				opportunityId: Plans.getReplacementOpportunityId({
					className: "Artificer",
					classSource: "EFA",
					classLevel: 3,
				}),
			}),
		]);
		expect(state.getLevelHistoryEntry(3)).toBeNull();
	});

	test("Respec stages and cancels a plan-only edit without mutating live inventory", async () => {
		const state = buildLevel2State();
		state.addItem({name: "Control Item", source: "TST", type: "G"});
		const page = getPage(state);
		Progression.syncCanonicalDecisions({page, state});
		const before = state.toJson();
		const engine = new RespecEngine({page, state});
		engine.begin();
		const decision = engine.manifest.decisions.find(it =>
			it.type === Plans.DECISION_TYPE_ACQUIRE
				&& it.meta.slotId === "efa-replicate-plan-1",
		);
		const replacement = decision.options.find(option =>
			option.itemUid !== decision.selection.itemUid
				&& !state.getEfaArtificerPlans().some(slot => slot.selection.itemUid === option.itemUid),
		);
		await engine.stageGraphMutation(decision.id, replacement, {
			reverseParent: true,
			apply: () => ({selection: replacement}),
		});
		expect(engine.state.toJson().inventory).toEqual(before.inventory);
		expect(state.toJson()).toEqual(before);
		engine.cancel();
		expect(state.toJson()).toEqual(before);
	});

	test("Respec shared editor stages an exact plan repair without live or inventory side effects", async () => {
		const state = buildLevel2State();
		state.addItem({name: "Control Item", source: "TST", type: "G"});
		const page = getPage(state);
		Progression.syncCanonicalDecisions({page, state});
		const before = state.toJson();
		const respec = new Respec({page, state});
		respec._engine.begin();
		respec.render = jest.fn();
		const decision = respec._engine.manifest.decisions.find(it =>
			it.type === Plans.DECISION_TYPE_ACQUIRE
				&& it.meta.slotId === "efa-replicate-plan-1",
		);
		const replacement = decision.options.find(option =>
			option.itemUid !== decision.selection.itemUid
				&& !state.getEfaArtificerPlans().some(slot => slot.selection.itemUid === option.itemUid),
		);
		const picker = jest.spyOn(Picker, "pGetUserDecisions").mockResolvedValue([{selection: replacement}]);
		const closeParentModal = jest.fn();
		try {
			await respec._editArtificerPlanDecision(2, state.getLevelHistoryEntry(2), {decision}, closeParentModal);
			expect(respec._engine.state.toJson().inventory).toEqual(before.inventory);
			expect(respec._engine.manifest.decisions.find(it => it.id === decision.id).selection.itemUid).toBe(replacement.itemUid);
			expect(state.toJson()).toEqual(before);
			expect(closeParentModal).toHaveBeenCalledTimes(1);
		} finally {
			picker.mockRestore();
		}
	});

	test("Respec plan mechanics are exact configuration-only teardown", () => {
		const state = buildLevel2State();
		state.addItem({name: "Control Item", source: "TST", type: "G"});
		const page = getPage(state);
		Progression.syncCanonicalDecisions({page, state});
		const respec = new Respec({page, state});
		const before = state.toJson();
		respec._applyDecisionMechanicsConfiguration({
			type: Plans.DECISION_TYPE_ACQUIRE,
			semanticKey: "negative-control|efa-plan",
			selection: state.getEfaArtificerPlans()[0].selection,
		}, null, [], state);
		expect(state.toJson()).toEqual(before);
	});

	test("picker cancellation contract is non-mutating at the public boundary", async () => {
		const state = buildLevel2State();
		const before = state.toJson();
		const modalInner = globalThis.e_({tag: "div"});
		const modalFooter = globalThis.e_({tag: "div"});
		const modal = jest.spyOn(CharacterSheetModal, "pGetShow").mockImplementation(async opts => {
			queueMicrotask(() => opts.cbClose(false));
			return {
				eleModalInner: modalInner,
				eleModalFooter: modalFooter,
				doClose: jest.fn(),
			};
		});
		try {
			const result = await Picker.pGetUserDecisions({
				page: getPage(state),
				state,
				levels: [{characterLevel: 3, className: "Artificer", classSource: "EFA", classLevel: 3}],
			});
			expect(result).toBeNull();
			expect(state.toJson()).toEqual(before);
		} finally {
			modal.mockRestore();
		}
	});
});
