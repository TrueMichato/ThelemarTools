import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-materials.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespecEngine = globalThis.CharacterSheetRespecEngine;
const CharacterSheetMaterials = globalThis.CharacterSheetMaterials;

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

	it("installs runtime material catalogs before loading the isolated draft", () => {
		const iounSand = {
			name: "Ioun Sand",
			source: "TGTT",
			appliesTo: ["weapon", "armor", "shield", "other"],
			effects: [{type: "doubleNumericProperties"}],
		};
		state.setItemMaterialCatalog([iounSand]);
		state.setDraconicResonanceCatalog([{name: "Wyrm Echo", source: "TGTT"}]);
		state.addItem({name: "Sand Torc", source: "HB", type: "W"});
		const host = state.getItems().at(-1);
		state.setItemMaterial(host.id, iounSand, {quantity: 1});
		state.addItem({name: "Ioun Stone, Leadership", source: "DMG", type: "W", ability: {cha: 2}});
		const stone = state.getItems().at(-1);
		state.setItemAttuned(stone.id, true);
		state.setIounStone(host.id, stone.id);

		CharacterSheetMaterials.clearUnresolvedReferences();
		engine.begin();

		expect(engine.state.getItemMaterialCatalog()).toEqual([iounSand]);
		expect(engine.state.getDraconicResonanceCatalog()).toEqual([{name: "Wyrm Echo", source: "TGTT"}]);
		expect(engine.state.getItemRaw(stone.id).ability.cha).toBe(4);
		expect(CharacterSheetMaterials.getUnresolvedReferences()).toEqual([]);
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

	it("retains staged receipts through reconciliation and a single persistence pass", () => {
		engine.begin();
		const decision = engine.manifest.decisions.find(item => item.type === "skills");
		const refreshSpy = jest.spyOn(engine, "refreshManifest");
		const persistSpy = jest.spyOn(engine, "_persistManifest");
		engine.stageGraphMutation(decision.id, ["perception"], {
			reverseParent: true,
			apply: ({state: candidate}) => {
				candidate.addSkillProficiency("perception");
				candidate.claimProgressionOwnership("skills", "perception", decision.semanticKey);
			},
		});
		const next = engine.manifest.decisions.find(item => item.semanticKey === decision.semanticKey);
		expect(next.receipt).toMatchObject({
			sourceDecisionKey: decision.semanticKey,
			effects: expect.arrayContaining([
				expect.objectContaining({type: "ownership"}),
			]),
		});
		expect(refreshSpy).toHaveBeenCalledTimes(1);
		expect(persistSpy).toHaveBeenCalledTimes(1);
	});
});
