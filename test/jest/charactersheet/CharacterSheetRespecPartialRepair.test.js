import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const originalE = globalThis.e_;
globalThis.e_ = options => {
	const element = originalE(options);
	let html = element.outerHTML;
	Object.defineProperty(element, "outerHTML", {
		get: () => html || `<${options.tag || "div"}>${element.textContent || ""}${(element._children || []).map(child => child.outerHTML || child.textContent || "").join("")}</${options.tag || "div"}>`,
		set: value => { html = value; },
	});
	return element;
};
await import("../../../js/charactersheet/charactersheet-respec.js");
globalThis.e_ = originalE;

const {CharacterSheetState: State, CharacterSheetRespec: Respec} = globalThis;
const race = {name: "Elf", source: "PHB", ability: [{dex: 2}]};
const otherRace = {...race, name: "Other Elf"};
const background = {
	name: "Unfinished",
	source: "TST",
	toolProficiencies: [{anyArtisansTool: 1}],
	languageProficiencies: [{anyStandard: 1}],
};
const cls = {
	name: "Fighter",
	source: "XPHB",
	hd: {faces: 10},
	classFeatures: [],
	startingProficiencies: {skills: [{choose: {from: ["athletics", "perception"], count: 1}}]},
};
const otherClass = {name: "Other", source: "TST", hd: {faces: 8}, classFeatures: []};

function fixture ({skills = [], multiclass = false, freeOrigin = false} = {}) {
	Parser.LANGUAGES_STANDARD = ["Common", "Elvish", "Dwarvish"];
	Parser.LANGUAGES_ALL = Parser.LANGUAGES_STANDARD;
	const state = new State();
	state.setRace(freeOrigin ? {name: "Dwarf", source: "XPHB"} : race);
	state.setBackground(background);
	state.setAbilityBonus("dex", freeOrigin ? 0 : 2);
	state.addClass({...cls, level: 1});
	state.recordLevelChoice({level: 1, class: {name: cls.name, source: cls.source}, choices: {skills}});
	if (multiclass) {
		state.addClass({...otherClass, level: 1});
		state.recordLevelChoice({level: 2, class: {name: otherClass.name, source: otherClass.source}, choices: {}});
	}
	state._data.pendingFeatureChoices = [{id: "legacy-pending", featureName: "Legacy Review", count: 1, options: ["history"], kind: "skill"}];
	state.loadFromJson(state.toJson());
	const page = {
		getState: () => state,
		getClasses: () => [cls, otherClass],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getSpells: () => [],
		getFeats: () => [],
		getRaces: () => [race, otherRace],
		getBackgrounds: () => [background],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(),
		renderCharacter: jest.fn(),
	};
	const respec = new Respec({page, state});
	respec._engine.begin();
	respec._state = respec._engine.state;
	return {state, page, respec, engine: respec._engine};
}

async function repair (respec, type, selection) {
	const decision = respec._engine.manifest.decisions.find(candidate => candidate.type === type);
	expect(decision).toBeDefined();
	await respec._engine.stageGraphMutation(decision.id, selection, {
		reverseParent: true,
		apply: ({state}) => respec._applyManifestSelectionMechanics(decision, selection, decision.options, state),
	});
}

function reopen (state, page) {
	const loaded = new State();
	expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
	const respec = new Respec({state: loaded, page});
	respec._engine.begin();
	respec._state = respec._engine.state;
	return respec;
}

describe("Respec partial repairs distinguish unchanged problems from unsafe changes", () => {
	it("carries an untouched missing free-origin pair through unrelated repair, Apply/reload/Undo without losing the evidence diagnostic", async () => {
		const {state, page, respec, engine} = fixture({freeOrigin: true});
		const baseline = engine.getValidation();
		const diagnostic = baseline.errors.find(issue => issue.code === "free-origin-ability-evidence");
		expect(diagnostic).toMatchObject({repairable: true, carriedForward: true});
		expect(baseline).toMatchObject({isValid: false, canApply: true, blockingErrors: []});
		const origins = engine.manifest.base.decisions;
		const original = state.toJson();
		await repair(respec, "skills", ["athletics"]);
		expect(engine.manifest.base.decisions).toEqual(origins);
		expect(engine.getValidation().blockingErrors).toEqual([]);
		expect(engine.getValidation().carriedForwardIssues).toContainEqual(diagnostic);
		expect(engine.getValidation().carriedForwardIssues).toHaveLength(baseline.carriedForwardIssues.length - 1);
		await engine.apply();
		expect(state.toJson().abilityBonuses).toEqual(original.abilityBonuses);
		const loaded = reopen(state, page);
		expect(loaded._engine.getValidation()).toMatchObject({isValid: false, canApply: true, blockingErrors: []});
		expect(loaded._engine.getValidation().carriedForwardIssues).toContainEqual(diagnostic);
		expect(loaded._engine.manifest.base.decisions.filter(decision => decision.meta?.originFreeAbility && decision.type === "nestedAbility")
			.every(decision => decision.selection == null && decision.status === "missing" && decision.required)).toBe(true);
		await engine.undo();
		expect(state.toJson()).toEqual(original);
	});

	it.each(["new", "touched-child", "touched-parent", "changed-background", "changed-race", "worsened-evidence", "changed-empty-evidence"])("blocks %s free-origin missing or unproven evidence instead of using unrelated baseline permission", async mode => {
		const {state, engine} = fixture({freeOrigin: mode !== "new"});
		const before = state.toJson();
		if (mode === "new" || mode === "changed-race") {
			const raceDecision = engine.manifest.decisions.find(decision => decision.type === "originRace");
			await engine.stageGraphMutation(raceDecision.id, {name: "Other Dwarf", source: "XPHB"}, {
				apply: ({state: candidate}) => {
					candidate.setRace({name: "Other Dwarf", source: "XPHB"});
					candidate.setAbilityBonus("dex", 0);
				},
			});
		} else if (mode === "touched-child" || mode === "touched-parent") {
			const choice = engine.manifest.decisions.find(decision => decision.meta?.originFreeAbility
				&& decision.type === (mode === "touched-child" ? "nestedAbility" : "nestedConfiguration"));
			await engine.updateDecisionSelection(choice.id, mode === "touched-child" ? null : choice.selection);
		} else if (mode === "changed-background") {
			const parent = engine.manifest.decisions.find(decision => decision.type === "originBackground");
			await engine.stageGraphMutation(parent.id, {name: "Other Unfinished", source: "TST"}, {
				apply: ({state: candidate}) => candidate.setBackground({...background, name: "Other Unfinished"}),
			});
		} else if (mode === "changed-empty-evidence") {
			await engine.stageCandidateMutation(({state: candidate}) =>
				candidate.setBaseBackgroundUserChoices({selectedAbilityBonuses: {unrecorded: 0}}),
			);
		} else {
			await engine.stageCandidateMutation(({state: candidate}) => candidate.setAbilityBonus("str", 2));
		}
		expect(engine.getValidation().blockingErrors).toContainEqual(expect.objectContaining({code: "free-origin-ability-evidence", carriedForward: false}));
		expect(engine.getValidation().canApply).toBe(false);
		await expect(engine.apply()).rejects.toThrow();
		expect(state.toJson()).toEqual(before);
	});

	it("repairs one of three real missing decisions and preserves two errors, pending evidence, reload and Undo", async () => {
		const {state, page, respec, engine} = fixture();
		const before = state.toJson();
		const baseline = engine.getValidation();
		expect(baseline.errors).toHaveLength(3);
		expect(baseline).toMatchObject({isValid: false, canApply: true, blockingErrors: []});
		const retained = engine.manifest.decisions.filter(decision => ["nestedTool", "nestedLanguage"].includes(decision.type));
		await repair(respec, "skills", ["athletics"]);
		const validation = engine.getValidation();
		expect(validation).toMatchObject({isValid: false, canApply: true, blockingErrors: []});
		expect(validation.carriedForwardIssues).toHaveLength(2);
		expect(validation.errors).toHaveLength(2);
		expect(state.toJson()).toEqual(before);
		expect(engine.manifest.decisions.filter(decision => ["nestedTool", "nestedLanguage"].includes(decision.type))).toEqual(retained);
		await engine.apply();
		expect(state.getSkillProficiency("athletics")).toBe(1);
		expect(state._data.pendingFeatureChoices).toEqual(before.pendingFeatureChoices);
		const loaded = reopen(state, page);
		expect(loaded._engine.getValidation().carriedForwardIssues.map(issue => issue.semanticKey))
			.toEqual(validation.carriedForwardIssues.map(issue => issue.semanticKey));
		const dialog = await loaded._createBackgroundDraft(background, loaded._state.getLevelHistoryEntry(1));
		expect(loaded._getBackgroundDraftDecisions(dialog).filter(decision => decision.status === "missing")).toHaveLength(2);
		await engine.undo();
		expect(state.toJson()).toEqual(before);
		expect(reopen(state, page)._engine.getValidation().errors).toHaveLength(3);
	});

	it("allows an unrelated valid origin edit with three unchanged issues, without certifying validity", async () => {
		const {state, page, engine} = fixture();
		const origin = engine.manifest.decisions.find(decision => decision.type === "originRace");
		await engine.stageGraphMutation(origin.id, {name: otherRace.name, source: otherRace.source}, {
			apply: ({state: candidate}) => candidate.setRace(otherRace),
		});
		expect(engine.getChangeSummary()).toEqual(expect.arrayContaining([expect.objectContaining({label: "Species", status: "changed"})]));
		expect(engine.getValidation()).toMatchObject({isValid: false, canApply: true, blockingErrors: []});
		expect(engine.getValidation().carriedForwardIssues).toHaveLength(3);
		await engine.apply();
		expect(state.getRaceName()).toBe(otherRace.name);
		expect(reopen(state, page)._engine.getValidation().errors).toHaveLength(3);
	});

	it("allows a same-background dialog repair of one family while another family remains visible", async () => {
		const {state, page, respec, engine} = fixture();
		const draft = await respec._createBackgroundDraft(background, respec._state.getLevelHistoryEntry(1));
		await repair(draft, "nestedTool", "Smith's Tools");
		expect(respec._getBackgroundDraftIssues(draft)).toEqual([]);
		expect(draft._engine.getValidation().carriedForwardIssues.filter(issue => issue.semanticKey.includes("background"))).toHaveLength(1);
		await respec._stageBackgroundDraft(draft);
		expect(engine.getValidation().carriedForwardIssues).toHaveLength(2);
		expect(engine.getValidation().canApply).toBe(true);
		await engine.apply();
		expect(state.hasToolProficiency("Smith's Tools")).toBe(true);
		expect(reopen(state, page)._engine.getValidation().errors).toHaveLength(2);
	});

	it.each([
		[[], ["not-a-skill"], "new invalid selection"],
		[["not-a-skill"], ["another-invalid-skill"], "changed invalid selection with the same issue code"],
		[["not-a-skill"], ["not-a-skill"], "explicitly edited still-invalid selection"],
	])("blocks %s → %s (%s) even when the issue count does not increase", async (skills, selection) => {
		const {state, engine} = fixture({skills});
		const before = state.toJson();
		const skill = engine.manifest.decisions.find(decision => decision.type === "skills");
		await engine.updateDecisionSelection(skill.id, selection);
		expect(engine.getValidation().errors).toHaveLength(3);
		expect(engine.getValidation().blockingErrors).toEqual([expect.objectContaining({semanticKey: skill.semanticKey, carriedForward: false})]);
		expect(engine.getValidation().canApply).toBe(false);
		await expect(engine.apply()).rejects.toThrow(/Resolve 1 required/);
		expect(state.toJson()).toEqual(before);
	});

	it("keeps a newly missing choice blocked even after it is changed back to the baseline invalid value", async () => {
		const {engine} = fixture({skills: ["not-a-skill"]});
		const decision = engine.manifest.decisions.find(candidate => candidate.type === "skills");
		await engine.updateDecisionSelection(decision.id, null);
		await engine.updateDecisionSelection(engine.manifest.decisions.find(candidate => candidate.type === "skills").id, ["not-a-skill"]);
		expect(engine.getValidation().blockingErrors).toHaveLength(1);
		await expect(engine.apply()).rejects.toThrow(/Resolve 1 required/);
	});

	it("blocks parent cascades and changed owner/source even when the replacement has the same missing families", async () => {
		for (const next of [background, {...background, name: "Other Background", source: "HB"}]) {
			const {state, engine} = fixture();
			const before = state.toJson();
			const origin = engine.manifest.decisions.find(decision => decision.type === "originBackground");
			await engine.stageGraphMutation(origin.id, {name: next.name, source: next.source}, {
				apply: ({state: candidate}) => candidate.setBackground(next),
			});
			expect(engine.getValidation().blockingErrors).toHaveLength(2);
			expect(engine.getValidation().carriedForwardIssues).toHaveLength(1);
			await expect(engine.apply()).rejects.toThrow();
			expect(state.toJson()).toEqual(before);
		}
	});

	it("blocks a worsened required-choice contract, rather than matching only its semantic ID and missing status", async () => {
		const {engine, page} = fixture();
		page.getClasses = () => [{...cls, startingProficiencies: {skills: [{choose: {from: ["athletics", "perception"], count: 2}}]}}];
		engine.refreshManifest();
		expect(engine.getValidation().blockingErrors).toEqual([expect.objectContaining({code: "decision-missing", message: "Starting Skill Proficiencies is missing."})]);
		await expect(engine.apply()).rejects.toThrow();
	});

	it("matches source-qualified semantic decisions across timeline reorder instead of generated level IDs", async () => {
		const {engine, state, page} = fixture({skills: ["athletics"]});
		engine.cancel();
		state._data.classes[0].level = 2;
		state.recordLevelChoice({level: 2, class: {name: cls.name, source: cls.source}, choices: {}});
		state.addClass({...otherClass, level: 1});
		state.recordLevelChoice({level: 3, class: {name: otherClass.name, source: otherClass.source}, choices: {}});
		const training = {
			name: "Advanced Training",
			source: "XPHB",
			className: cls.name,
			classSource: cls.source,
			level: 2,
			entries: [{
				type: "options",
				count: 1,
				entries: [
					{type: "entries", name: "Smithing", entries: ["Study smithing."]},
					{type: "entries", name: "Brewing", entries: ["Study brewing."]},
				],
			}],
		};
		page.getClasses = () => [{...cls, classFeatures: ["Advanced Training|Fighter|XPHB|2"]}, otherClass];
		page.getClassFeatures = () => [training];
		engine.begin();
		const before = engine.getValidation().carriedForwardIssues;
		expect(before).toHaveLength(3);
		await engine.stageCandidateMutation(({state}) => {
			const history = structuredClone(state.getLevelHistory());
			state._data.levelHistory = [history[0], {...history[2], level: 2}, {...history[1], level: 3}];
		});
		const after = engine.getValidation();
		expect(after.errors).toHaveLength(3);
		expect(after.canApply).toBe(true);
		expect(after.carriedForwardIssues.map(issue => issue.semanticKey).sort()).toEqual(before.map(issue => issue.semanticKey).sort());
		expect(after.carriedForwardIssues.find(issue => issue.level > 0).decisionId)
			.not.toBe(before.find(issue => issue.level > 0).decisionId);
		await engine.apply();
	});

	it("retains nested source-instance IDs instead of confusing them with generated decision row IDs", () => {
		const {engine} = fixture();
		const decision = engine.manifest.decisions.find(row => row.required && row.status === "missing");
		const original = engine._getDecisionFingerprint(decision, engine.manifest);
		expect(engine._getDecisionFingerprint({...decision, id: "regenerated-row"}, engine.manifest)).toBe(original);
		expect(engine._getDecisionFingerprint({...decision, receipt: {effects: [{type: "materialized", features: [{id: "foreign-owner"}]}]}}, engine.manifest))
			.not.toBe(original);
		expect(engine.constructor._getSemanticValue({owner: {id: "exact-owner", acquisitionLevel: 4}}))
			.toEqual({owner: {id: "exact-owner", acquisitionLevel: 4}});
	});

	it.each(["duplicate", "dangling", "cyclic"])("blocks %s identities or lineage even on resolved decisions", async kind => {
		const {engine, state} = fixture();
		const original = state.toJson();
		const resolved = engine.manifest.decisions.find(decision => decision.status === "resolved");
		if (kind === "duplicate") engine.manifest.decisions.push({...resolved, id: "duplicate-owner"});
		else resolved.parentSemanticKey = kind === "dangling" ? "missing-owner" : resolved.semanticKey;
		expect(engine.getValidation().canApply).toBe(false);
		expect(engine.getValidation().blockingErrors).toEqual(expect.arrayContaining([
			expect.objectContaining({code: kind === "duplicate" ? "unsafe-decision-identity" : "unsafe-decision-lineage", carriedForward: false}),
		]));
		await expect(engine.apply()).rejects.toThrow();
		expect(state.toJson()).toEqual(original);
	});

	it.each(["missing-class-data", "missing-choice-catalog", "discovery-incomplete", "unsupported-persisted-decision", "adapter-missing-reverse"])("never carries forward structural %s failures", async code => {
		const {state, engine} = fixture();
		const before = state.toJson();
		engine.manifest.issues.push({severity: "error", code, message: "Unsafe discovery"});
		expect(engine.getValidation().blockingErrors).toEqual([expect.objectContaining({code, carriedForward: false})]);
		await expect(engine.apply()).rejects.toThrow();
		expect(state.toJson()).toEqual(before);
	});

	it("preserves an actual saved ledger when class discovery is already degraded", async () => {
		const {state, engine, page} = fixture();
		const saved = state.toJson();
		engine.cancel();
		page.getClasses = () => [];
		engine.begin();
		expect(engine.getValidation().canApply).toBe(false);
		expect(engine.state.toJson().levelHistory).toEqual(saved.levelHistory);
		await expect(engine.apply()).rejects.toThrow();
		expect(state.toJson()).toEqual(saved);
	});

	it("rolls back a failed partial save exactly and permits retry without losing remaining errors or pending choices", async () => {
		const {state, engine, page, respec} = fixture();
		const before = state.toJson();
		await repair(respec, "skills", ["athletics"]);
		page.saveCharacter.mockRejectedValueOnce(new Error("Save unavailable"));
		await expect(engine.apply()).rejects.toThrow("Save unavailable");
		expect(state.toJson()).toEqual(before);
		expect(engine.getValidation()).toMatchObject({canApply: true, isValid: false});
		expect(engine.getValidation().carriedForwardIssues).toHaveLength(2);
		await engine.apply();
		expect(reopen(state, page)._engine.getValidation().errors).toHaveLength(2);
	});

	it("requires explicit remaining-issue confirmation and keeps the character untouched when declined", async () => {
		const {state, page, respec, engine} = fixture();
		const before = state.toJson();
		await repair(respec, "skills", ["athletics"]);
		const confirm = jest.spyOn(InputUiUtil, "pGetUserBoolean").mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		const toast = jest.spyOn(JqueryUtil, "doToast");
		try {
			await respec._onApplyDraft();
			expect(state.toJson()).toEqual(before);
			expect(page.saveCharacter).not.toHaveBeenCalled();
			expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({
				title: "Apply Respec With Remaining Issues",
				htmlDescription: expect.stringContaining("2 unchanged issues will remain"),
				textYes: "Apply Changes and Keep Issues",
			}));
			expect(confirm.mock.calls[0][0].htmlDescription).toContain("toolProficiencies is missing.");
			expect(confirm.mock.calls[0][0].htmlDescription).toContain("languageProficiencies is missing.");
			await respec._onApplyDraft();
			expect(page.saveCharacter).toHaveBeenCalledTimes(1);
			expect(engine.isDraftActive).toBe(false);
			expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({type: "warning", content: expect.stringContaining("2 unresolved issues remain")}));
		} finally {
			confirm.mockRestore();
			toast.mockRestore();
		}
	});
});
