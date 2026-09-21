import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespecEngine = globalThis.CharacterSheetRespecEngine;

describe("CharacterSheetRespecEngine", () => {
	const classData = {
		name: "Fighter",
		source: "XPHB",
		hd: {number: 1, faces: 10},
		startingProficiencies: {
			skills: [{choose: {from: ["athletics", "perception"], count: 1}}],
		},
		classFeatures: [],
	};

	let state;
	let page;
	let engine;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "XPHB", level: 1});
		state.recordLevelChoice({
			level: 1,
			class: {name: "Fighter", source: "XPHB"},
			choices: {skills: ["athletics"]},
		});
		page = {
			getClasses: () => [classData],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			saveCharacter: jest.fn().mockResolvedValue(undefined),
			renderCharacter: jest.fn(),
		};
		engine = new CharacterSheetRespecEngine({page, state});
	});

	it("isolates draft mutations and cancels without changing live state", () => {
		engine.begin();
		engine.state.updateLevelChoice(1, {skills: ["perception"]});
		engine.markDirty();

		expect(state.getLevelHistoryEntry(1).choices.skills).toEqual(["athletics"]);
		expect(engine.state.getLevelHistoryEntry(1).choices.skills).toEqual(["perception"]);

		engine.cancel();
		expect(state.getLevelHistoryEntry(1).choices.skills).toEqual(["athletics"]);
	});

	it("rolls back a legacy staged mutation when its mechanics callback fails", async () => {
		engine.begin();
		const before = engine.state.toJson();
		await expect(engine.stageCandidateMutation(({state: candidate}) => {
			candidate.updateLevelChoice(1, {skills: ["perception"]});
			candidate.addSkillProficiency("perception");
			throw new Error("legacy editor failed");
		})).rejects.toThrow("legacy editor failed");
		expect(engine.state.toJson()).toEqual(before);
		expect(engine.manifest).toEqual(expect.any(Object));
	});

	it("applies a valid candidate atomically and supports one-step undo", async () => {
		engine.begin();
		engine.state.updateLevelChoice(1, {skills: ["perception"]});
		engine.markDirty();

		await engine.apply();
		expect(state.getLevelHistoryEntry(1).choices.skills).toEqual(["perception"]);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);

		await engine.undo();
		expect(state.getLevelHistoryEntry(1).choices.skills).toEqual(["athletics"]);
		expect(engine.canUndo).toBe(false);
	});

	it("rolls live state back if persistence fails", async () => {
		page.saveCharacter.mockRejectedValueOnce(new Error("save failed"));
		engine.begin();
		engine.state.updateLevelChoice(1, {skills: ["perception"]});
		engine.markDirty();

		await expect(engine.apply()).rejects.toThrow("save failed");
		expect(state.getLevelHistoryEntry(1).choices.skills).toEqual(["athletics"]);
	});

	it("refuses to overwrite live changes made while the draft was open", async () => {
		engine.begin();
		engine.state.updateLevelChoice(1, {skills: ["perception"]});
		engine.markDirty();
		state.setCurrentHp(3);

		await expect(engine.apply()).rejects.toThrow("live character changed");
		expect(state.getCurrentHp()).toBe(3);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	it("refreshes an untouched draft after the live character changes", () => {
		engine.begin();
		state.updateLevelChoice(1, {skills: []});

		expect(engine.syncCleanDraft()).toBe(true);
		expect(engine.manifest.decisions.find(decision => decision.type === "skills")?.status).toBe("missing");
	});

	it("keeps an unchanged clean draft and never replaces a dirty draft", () => {
		engine.begin();
		const cleanDraft = engine.state;
		expect(engine.syncCleanDraft()).toBe(false);
		expect(engine.state).toBe(cleanDraft);

		engine.markDirty();
		const dirtyDraft = engine.state;
		state.updateLevelChoice(1, {skills: []});
		expect(engine.syncCleanDraft()).toBe(false);
		expect(engine.state).toBe(dirtyDraft);
	});

	it("warns for legacy unknown pending choices and rolls back newly created ones", async () => {
		state._data.pendingFeatureChoices = [{
			id: "legacy-pending",
			featureName: "Legacy Feature",
			kind: "skill",
			options: ["arcana", "history"],
			count: 1,
		}];
		engine.begin();
		expect(engine.getValidation().warnings).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "unknown-pending-choice"}),
		]));

		const before = engine.state.toJson();
		await expect(engine.stageCandidateMutation(({state: candidate}) => {
			candidate._data.pendingFeatureChoices.push({
				id: "new-pending",
				featureName: "New Unsupported Feature",
				kind: "skill",
				options: ["arcana", "history"],
				count: 1,
			});
		})).rejects.toThrow(/unrepresented pending choice/i);
		expect(engine.state.toJson()).toEqual(before);
	});

	it("preserves ledger ownership through an incomplete-to-complete manifest transition", async () => {
		state.addSkillProficiency("athletics");
		const skillDecision = state.getLevelHistoryEntry(1).decisions.find(decision => decision.type === "skills");
		state.claimProgressionOwnership("skills", "athletics", skillDecision.semanticKey);
		state._data.progressionOwnership.initialized = true;
		expect(state.loadFromJson(state.toJson())).not.toBe(false);
		const originalSnapshot = state.toJson();
		page.getClasses = () => [];

		engine.begin();
		engine.refreshManifest();

		expect(engine.manifest.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({code: "missing-class-data"}),
		]));
		expect(engine.state.toJson()).toEqual(originalSnapshot);
		expect(engine.state.getSkillProficiency("athletics")).toBe(1);

		page.getClasses = () => [classData];
		engine.refreshManifest();
		await engine.apply();

		expect(state.getSkillProficiency("athletics")).toBe(1);
		expect(state.getLevelHistoryEntry(1)).toMatchObject({
			choices: {skills: ["athletics"]},
			manifestComplete: true,
			decisions: expect.arrayContaining([
				expect.objectContaining({type: "skills", status: "resolved", selection: ["athletics"]}),
			]),
		});
	});
});
