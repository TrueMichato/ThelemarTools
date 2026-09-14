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
});
