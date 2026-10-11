import "./setup.js";
import {jest} from "@jest/globals";

let CharacterSheetPage;
let CharacterSheetState;
let CharacterSheetExport;
let CharacterSheetModal;
let CharacterSheetSpawner;
let CharacterSheetSpawnBuilderDriver;
let dialogElements = [];
let backend;
let restoreGlobals;

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const deferred = () => {
	let resolve;
	const promise = new Promise(res => { resolve = res; });
	return {promise, resolve};
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
if (!String.prototype.escapeQuotes) {
	String.prototype.escapeQuotes = function () { return this.replace(/'/g, "&#39;").replace(/"/g, "&quot;"); };
}

function makeSelect () {
	let value = "";
	let options = [];
	return {
		get value () { return value; },
		set value (next) { value = options.some(option => option.value === next) ? next : ""; },
		get options () { return options; },
		set innerHTML (_html) { options = []; value = ""; },
		insertAdjacentHTML (_position, html) {
			const match = html.match(/<option(?: value="([^"]*)")?([^>]*)>(.*?)<\/option>/);
			options.push({value: match[1] ?? match[3], textContent: match[3], disabled: match[2].includes("disabled")});
		},
	};
}

function makePage () {
	const page = new CharacterSheetPage();
	page._selCharacter = makeSelect();
	page._renderCharacter = jest.fn();
	page._updateSaveIndicator = jest.fn();
	page._reconcileClassFeatures = jest.fn(() => ({added: 0, backfilled: 0}));
	page._ensureLinguisticsSkillIfNeeded = jest.fn();
	page._applyBackgroundTheme = jest.fn();
	page._updateThemePickerSelection = jest.fn();
	page._showTab = jest.fn();
	page.switchToTab = jest.fn();
	page._builder = {resetSelections: jest.fn(), _goToStep: jest.fn()};
	return page;
}

async function seed (page, {id = "a", name = "A", note = "Keep this", hp = 11} = {}) {
	const state = new CharacterSheetState();
	state.setId(id);
	state.setName(name);
	state.setNote("backstory", note);
	state.addClass({name: "Fighter", source: "PHB", level: 3, hd: {number: 1, faces: 10}});
	state.setHp(hp, state.getMaxHp(), 3);
	const record = state.toJson();
	backend.roster.push(clone(record));
	await page._pLoadCharacters();
	await page._pLoadCharacter(id);
	return clone(record);
}

beforeAll(async () => {
	const baseElement = globalThis.e_;
	globalThis.e_ = opts => {
		const element = baseElement(opts);
		if (opts?.click) element.addEventListener("click", opts.click);
		dialogElements.push(element);
		return element;
	};
	globalThis.window = {
		addEventListener: jest.fn(),
		location: new URL("http://test/charactersheet.html"),
		history: {replaceState: jest.fn((_state, _title, url) => { window.location = new URL(url); })},
	};
	globalThis.document = {
		getElementById: () => null,
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener: jest.fn(),
	};
	({CharacterSheetState} = await import("../../../js/charactersheet/charactersheet-state.js"));
	({CharacterSheetPage} = await import("../../../js/charactersheet/charactersheet.js"));
	({CharacterSheetExport} = await import("../../../js/charactersheet/charactersheet-export.js"));
	({CharacterSheetModal} = await import("../../../js/charactersheet/charactersheet-modal.js"));
	({CharacterSheetSpawner, CharacterSheetSpawnBuilderDriver} = await import("../../../js/charactersheet/charactersheet-spawn-drivers.js"));
	globalThis.e_ = baseElement;
});

beforeEach(() => {
	backend = {roster: [], sync: new Map(), async: new Map()};
	dialogElements = [];
	window.location = new URL("http://test/charactersheet.html");
	const replacements = [
		[StorageUtil, "pGet", jest.fn(async key => clone(key === "charsheet-characters" ? backend.roster : backend.async.get(key) ?? null))],
		[StorageUtil, "pSet", jest.fn(async (key, value) => {
			if (key === "charsheet-characters") backend.roster = clone(value);
			else backend.async.set(key, clone(value));
		})],
		[StorageUtil, "syncGet", jest.fn(key => clone(backend.sync.get(key) ?? null))],
		[StorageUtil, "syncSet", jest.fn((key, value) => backend.sync.set(key, clone(value)))],
		[StorageUtil, "syncRemove", jest.fn(key => backend.sync.delete(key))],
		[InputUiUtil, "pGetUserBoolean", jest.fn(async () => true)],
		[InputUiUtil, "pGetUserMultipleChoice", jest.fn(async () => [])],
		[InputUiUtil, "pGetUserString", jest.fn(async () => "DELETE")],
		[JqueryUtil, "doToast", jest.fn()],
	];
	const originals = replacements.map(([target, key, value]) => {
		const original = target[key];
		target[key] = value;
		return [target, key, original];
	});
	restoreGlobals = () => originals.forEach(([target, key, value]) => { target[key] = value; });
});

afterEach(() => {
	restoreGlobals();
	jest.restoreAllMocks();
});

describe("CharacterSheetPage real character lifecycle", () => {
	test.each(["pristine", "edited", "failed"])("Spawner entry preserves the previous %s draft without accidental admission or failure reset", async mode => {
		const page = makePage();
		await page._pLoadCharacters();
		page._classes = [{name: "Fighter", source: "PHB", hd: {number: 1, faces: 10}}];
		page._createNewCharacter();
		const previousId = page._currentCharacterId;
		if (mode !== "pristine") page._state.setNote("backstory", "Keep the previous draft");
		const build = jest.spyOn(CharacterSheetSpawnBuilderDriver.prototype, "run").mockImplementation(async function () {
			this._page._state.setName("Spawned");
			this._page._state.addClass({name: "Fighter", source: "PHB", level: 1, hd: {number: 1, faces: 10}});
			await this._page.saveCharacter();
			return null;
		});
		if (mode === "failed") StorageUtil.pSet.mockRejectedValue(new Error("Roster unavailable"));
		const spawn = new CharacterSheetSpawner(page).spawn("fighter/1", {seed: "lifecycle-entry"});
		if (mode === "failed") {
			await expect(spawn).rejects.toThrow(/previous character/i);
			expect(build).not.toHaveBeenCalled();
			expect(page._currentCharacterId).toBe(previousId);
			expect(page._state.getNote("backstory")).toBe("Keep the previous draft");
			expect(backend.roster).toEqual([]);
			expect(page._readActiveCharacterMirror(previousId).notes.backstory).toBe("Keep the previous draft");
			return;
		}
		await spawn;
		expect(backend.roster.filter(record => record.name === "Spawned")).toHaveLength(1);
		expect(backend.roster).toHaveLength(mode === "pristine" ? 1 : 2);
		if (mode === "edited") expect(backend.roster.find(record => record.id === previousId).notes.backstory).toBe("Keep the previous draft");
		else expect(backend.roster.some(record => record.id === previousId)).toBe(false);
	});

	test("repeated New and empty-option selection do not admit untouched drafts", async () => {
		const page = makePage();
		await page._pLoadCharacters();
		for (let i = 0; i < 3; ++i) {
			await page._onNewCharacter();
			page._selCharacter.value = "";
			await page._onCharacterSelect();
		}
		expect(backend.roster).toEqual([]);
		expect(backend.sync.size).toBe(0);
		expect(page._selCharacter.options.filter(option => !option.disabled)).toHaveLength(1);
	});

	test("a no-argument dropdown refresh retains the saved roster, not the active draft", async () => {
		const page = makePage();
		await seed(page);
		page._createNewCharacter();
		page._updateCharacterDropdown();
		expect(page._selCharacter.options.filter(option => !option.disabled).map(option => option.value)).toEqual(["", "a"]);
		expect(backend.roster.map(record => record.id)).toEqual(["a"]);
	});

	test.each(["normal", "bulk"])("%s deletion leaves a pristine draft and preserves surviving data through New/reload", async mode => {
		const page = makePage();
		const survivor = await seed(page, {id: "b", name: "Survivor", hp: 7});
		await seed(page);
		if (mode === "bulk") InputUiUtil.pGetUserMultipleChoice.mockResolvedValue([backend.roster.find(record => record.id === "a")]);
		await page[mode === "bulk" ? "_onManageCharacters" : "_onDeleteCharacter"]();
		expect(backend.roster).toEqual([survivor]);
		expect(window.location.searchParams.has("id")).toBe(false);
		await page._onNewCharacter();
		page._selCharacter.value = "b";
		await page._onCharacterSelect();
		const reloaded = makePage();
		await reloaded._pLoadCharacters();
		await reloaded._pLoadCharacter("b");
		expect(backend.roster).toEqual([survivor]);
		expect(reloaded._state.getCurrentHp()).toBe(7);
		expect(reloaded._state.getTempHp()).toBe(3);
		expect(reloaded._state.getNote("backstory")).toBe("Keep this");
	});

	test.each(["normal", "bulk"])("%s deletion removes a real rescue and cannot recover the deleted URL", async mode => {
		const page = makePage();
		await seed(page);
		const mirror = {...page._state.toJson(), id: "a", _savedAt: Date.now() + 100};
		page._writeActiveCharacterMirror(mirror);
		if (mode === "bulk") InputUiUtil.pGetUserMultipleChoice.mockResolvedValue([backend.roster[0]]);
		await page[mode === "bulk" ? "_onManageCharacters" : "_onDeleteCharacter"]();
		expect(page._readActiveCharacterMirror("a")).toBeNull();
		const reloaded = makePage();
		await reloaded._pLoadCharacters();
		await reloaded._pLoadCharacter("a");
		expect(backend.roster).toEqual([]);
		expect(reloaded._state.getName()).toBe("");
		expect(window.location.searchParams.has("id")).toBe(false);
	});

	test("explicit defaults-only saves remain valid and are not discarded on New", async () => {
		const page = makePage();
		page._createNewCharacter();
		const id = page._currentCharacterId;
		expect(await page.saveCharacter()).toBe(true);
		await page._onNewCharacter();
		expect(backend.roster).toHaveLength(1);
		expect(backend.roster[0]).toMatchObject({id, name: "", classes: []});
	});

	test("an unnamed manual edit and a partially built draft save before leaving", async () => {
		const page = makePage();
		await seed(page, {id: "b"});
		page._createNewCharacter();
		const manualId = page._currentCharacterId;
		page._state.setNote("backstory", "Unnamed but intentional");
		page._selCharacter.value = "b";
		await page._onCharacterSelect();
		expect(backend.roster.find(record => record.id === manualId).notes.backstory).toBe("Unnamed but intentional");
		page._createNewCharacter();
		const partialId = page._currentCharacterId;
		page._state.setAbilityBase("str", 13);
		await page._onNewCharacter();
		const partial = backend.roster.find(record => record.id === partialId);
		expect(partial).toMatchObject({name: "", classes: [], abilities: {str: 13}});
	});

	test("normal confirmation targets the original character, not a newly selected survivor", async () => {
		const page = makePage();
		const survivor = await seed(page, {id: "b", name: "B", hp: 8});
		await seed(page);
		InputUiUtil.pGetUserBoolean.mockImplementation(async () => {
			await page._pLoadCharacter("b");
			return true;
		});
		await page._onDeleteCharacter();
		expect(backend.roster).toEqual([survivor]);
		expect(page._currentCharacterId).toBe("b");
		expect(page._state.getCurrentHp()).toBe(8);
		expect(page._selCharacter.value).toBe("b");
	});

	test("bulk confirmation rereads fresh survivors and additions instead of overwriting its dialog snapshot", async () => {
		const page = makePage();
		await seed(page);
		await seed(page, {id: "b"});
		InputUiUtil.pGetUserMultipleChoice.mockResolvedValue([backend.roster[0]]);
		InputUiUtil.pGetUserBoolean.mockImplementation(async () => {
			backend.roster[1].notes.backstory = "Edited while confirming";
			backend.roster.push({id: "c", name: "Arrived while confirming", classes: []});
			return true;
		});
		await page._onManageCharacters();
		expect(backend.roster.map(record => record.id)).toEqual(["b", "c"]);
		expect(backend.roster[0].notes.backstory).toBe("Edited while confirming");
	});

	test("a save already writing before deletion cannot resurrect its target", async () => {
		const page = makePage();
		await seed(page);
		const started = deferred();
		const release = deferred();
		const originalSet = StorageUtil.pSet;
		let blocked = false;
		StorageUtil.pSet = jest.fn(async (key, value) => {
			if (key === "charsheet-characters" && !blocked) {
				blocked = true;
				started.resolve();
				await release.promise;
			}
			return originalSet(key, value);
		});
		const save = page.saveCharacter();
		await started.promise;
		const deletion = page._onDeleteCharacter();
		await tick();
		release.resolve();
		await Promise.all([save, deletion]);
		expect(backend.roster).toEqual([]);
	});

	test("a stale controller cannot save or mirror a deleted character after deletion commits", async () => {
		const page = makePage();
		await seed(page);
		const stale = makePage();
		await stale._pLoadCharacters();
		await stale._pLoadCharacter("a");
		await page._onDeleteCharacter();
		stale._state.setNote("backstory", "Stale tab");
		expect(await stale.saveCharacter()).toBe(false);
		expect(stale._readActiveCharacterMirror("a")).toBeNull();
		expect(backend.roster).toEqual([]);
	});

	test("the first save cannot clear the newer rescue while a second save waits", async () => {
		const page = makePage();
		await seed(page);
		const firstStarted = deferred();
		const releaseFirst = deferred();
		const secondStarted = deferred();
		const releaseSecond = deferred();
		const originalSet = StorageUtil.pSet;
		let count = 0;
		StorageUtil.pSet = jest.fn(async (key, value) => {
			if (key === "charsheet-characters") {
				const write = ++count;
				if (write === 1) { firstStarted.resolve(); await releaseFirst.promise; }
				if (write === 2) { secondStarted.resolve(); await releaseSecond.promise; }
			}
			return originalSet(key, value);
		});
		jest.spyOn(Date, "now").mockReturnValue(1000);
		page._state.setNote("backstory", "First");
		const first = page.saveCharacter();
		await firstStarted.promise;
		page._state.setNote("backstory", "Latest");
		const second = page.saveCharacter();
		releaseFirst.resolve();
		await first;
		await secondStarted.promise;
		const mirror = page._readActiveCharacterMirror("a");
		releaseSecond.resolve();
		await second;
		expect(mirror?.notes.backstory).toBe("Latest");
		expect(backend.roster[0].notes.backstory).toBe("Latest");
	});

	test("New invalidates a delayed load before its isolated transfer state can publish", async () => {
		const page = makePage();
		await seed(page);
		const started = deferred();
		const release = deferred();
		page._pApplyPendingCharacterTransfers = jest.fn(async () => {
			started.resolve();
			await release.promise;
			return [];
		});
		const loading = page._pLoadCharacter("a");
		await started.promise;
		page._createNewCharacter();
		const draftId = page._currentCharacterId;
		release.resolve();
		await loading;
		expect(page._currentCharacterId).toBe(draftId);
		expect(page._state.getName()).toBe("");
	});

	test("failed save blocks New and preserves current state and rescue for retry", async () => {
		const page = makePage();
		await seed(page);
		page._state.setNote("backstory", "Unsaved edit");
		const error = jest.spyOn(console, "error").mockImplementation(() => {});
		StorageUtil.pSet.mockRejectedValue(new Error("IndexedDB unavailable"));
		await page._onNewCharacter();
		expect(page._currentCharacterId).toBe("a");
		expect(page._state.getNote("backstory")).toBe("Unsaved edit");
		expect(page._readActiveCharacterMirror("a").notes.backstory).toBe("Unsaved edit");
		expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({type: "danger"}));
		expect(error).toHaveBeenCalled();
	});

	test("failed save blocks a dropdown switch and restores its selection", async () => {
		const page = makePage();
		await seed(page, {id: "b"});
		await seed(page);
		page._state.setNote("backstory", "Unsaved edit");
		jest.spyOn(console, "error").mockImplementation(() => {});
		StorageUtil.pSet.mockRejectedValue(new Error("IndexedDB unavailable"));
		page._selCharacter.value = "b";
		await page._onCharacterSelect();
		expect(page._currentCharacterId).toBe("a");
		expect(page._selCharacter.value).toBe("a");
		expect(page._state.getNote("backstory")).toBe("Unsaved edit");
	});

	test("canonical deletion failure retains the character and its rescue without success", async () => {
		const page = makePage();
		const original = await seed(page);
		page._writeActiveCharacterMirror({...original, _savedAt: 100});
		jest.spyOn(console, "error").mockImplementation(() => {});
		StorageUtil.pSet.mockRejectedValue(new Error("IndexedDB unavailable"));
		await expect(page._onDeleteCharacter()).resolves.toBeUndefined();
		expect(page._currentCharacterId).toBe("a");
		expect(backend.roster).toEqual([original]);
		expect(page._readActiveCharacterMirror("a")).toMatchObject({id: "a"});
		expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({type: "danger"}));
		expect(JqueryUtil.doToast).not.toHaveBeenCalledWith(expect.objectContaining({type: "success"}));
	});

	test("bulk marker-stage failure rolls back earlier markers and does not change canonical data", async () => {
		const page = makePage();
		await seed(page);
		await seed(page, {id: "b"});
		const original = clone(backend.roster);
		InputUiUtil.pGetUserMultipleChoice.mockResolvedValue(original);
		const originalSet = StorageUtil.syncSet;
		let staged = 0;
		StorageUtil.syncSet = jest.fn((key, value) => {
			if (key.startsWith("charsheet-deleted__") && ++staged === 2) throw new Error("Quota exceeded");
			return originalSet(key, value);
		});
		jest.spyOn(console, "error").mockImplementation(() => {});
		await page._onManageCharacters();
		expect(backend.roster).toEqual(original);
		expect([...backend.sync.keys()].filter(key => key.startsWith("charsheet-deleted__"))).toEqual([]);
		expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({type: "danger"}));
	});

	test("a genuine nondeleted mirror-only character still recovers and persists", async () => {
		const page = makePage();
		const state = new CharacterSheetState();
		state.setId("recover");
		state.setNote("backstory", "Recent partial draft");
		page._writeActiveCharacterMirror({...state.toJson(), _savedAt: Date.now()});
		await page._pLoadCharacter("recover");
		expect(page._currentCharacterId).toBe("recover");
		expect(backend.roster).toHaveLength(1);
		expect(backend.roster[0].notes.backstory).toBe("Recent partial draft");
	});

	test("untouched draft unload produces no mirror, but an edited partial draft recovers after reload", async () => {
		const page = makePage();
		page._createNewCharacter();
		const id = page._currentCharacterId;
		page._mirrorCurrentCharacterOnUnload();
		expect(backend.sync.size).toBe(0);
		page._state.setNote("backstory", "Partial at unload");
		page._mirrorCurrentCharacterOnUnload();
		const reloaded = makePage();
		await reloaded._pLoadCharacter(id);
		expect(reloaded._state.getNote("backstory")).toBe("Partial at unload");
		expect(backend.roster.map(record => record.id)).toEqual([id]);
	});

	test("an unresolved URL opens a pristine draft and clears the stale id", async () => {
		window.location = new URL("http://test/charactersheet.html?id=missing");
		const page = makePage();
		await page._pLoadCharacter("missing");
		expect(page._currentCharacterId).toBeTruthy();
		expect(page._isPristineCharacterDraft()).toBe(true);
		expect(window.location.searchParams.has("id")).toBe(false);
		await page._onNewCharacter();
		expect(backend.roster).toEqual([]);
	});

	test("deletion during a delayed load prevents its publication or queued transfers from resurrecting the target", async () => {
		const page = makePage();
		await seed(page);
		const started = deferred();
		const release = deferred();
		page._pApplyPendingCharacterTransfers = jest.fn(async () => {
			started.resolve();
			await release.promise;
			return [];
		});
		const loading = page._pLoadCharacter("a");
		await started.promise;
		await page._onDeleteCharacter();
		const draftId = page._currentCharacterId;
		release.resolve();
		await loading;
		expect(page._currentCharacterId).toBe(draftId);
		expect(backend.roster).toEqual([]);
	});

	test("a pending load re-reads a survivor changed during transfer I/O", async () => {
		const page = makePage();
		await seed(page);
		const started = deferred();
		const release = deferred();
		let first = true;
		page._pApplyPendingCharacterTransfers = jest.fn(async () => {
			if (first) {
				first = false;
				started.resolve();
				await release.promise;
			}
			return [];
		});
		const loading = page._pLoadCharacter("a");
		await started.promise;
		backend.roster[0].notes.backstory = "Saved during load";
		release.resolve();
		await loading;
		expect(page._state.getNote("backstory")).toBe("Saved during load");
		expect(backend.roster[0].notes.backstory).toBe("Saved during load");
	});

	test("a last edit arriving during save-before-New is included before leaving", async () => {
		const page = makePage();
		await seed(page);
		const originalSet = StorageUtil.pSet;
		let first = true;
		StorageUtil.pSet = jest.fn(async (key, value) => {
			if (key === "charsheet-characters" && first) {
				first = false;
				page._state.setNote("backstory", "Edit during save");
			}
			return originalSet(key, value);
		});
		await page._onNewCharacter();
		expect(backend.roster[0].notes.backstory).toBe("Edit during save");
		expect(page._isPristineCharacterDraft()).toBe(true);
	});

	test("an aborted deletion marker never hides a valid canonical character", async () => {
		const page = makePage();
		await seed(page);
		backend.sync.set(page._getCharacterDeletionKey("a"), {version: 1});
		await page._pLoadCharacter("a");
		page._state.setNote("backstory", "Still valid");
		expect(await page.saveCharacter()).toBe(true);
		expect(backend.roster[0].notes.backstory).toBe("Still valid");
		expect(backend.sync.has(page._getCharacterDeletionKey("a"))).toBe(false);
	});

	test("transfer cleanup failure reports committed deletion accurately without a success toast", async () => {
		const page = makePage();
		await seed(page);
		InputUiUtil.pGetUserMultipleChoice.mockResolvedValue([backend.roster[0]]);
		page._getCharacterTransferTypes = () => [{Transfer: {pRemoveForCharacters: async () => { throw new Error("Queue unavailable"); }}}];
		jest.spyOn(console, "error").mockImplementation(() => {});
		await page._onManageCharacters();
		expect(backend.roster).toEqual([]);
		expect(page._isPristineCharacterDraft()).toBe(true);
		expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({type: "danger", content: expect.stringContaining("were deleted")}));
		expect(JqueryUtil.doToast).not.toHaveBeenCalledWith(expect.objectContaining({type: "success"}));
	});

	test("malformed canonical storage is an error, not permission to overwrite the roster", async () => {
		const page = makePage();
		page._createNewCharacter();
		backend.roster = {broken: "Keep the evidence"};
		jest.spyOn(console, "error").mockImplementation(() => {});
		expect(await page.saveCharacter()).toBe(false);
		expect(backend.roster).toEqual({broken: "Keep the evidence"});
		expect(JqueryUtil.doToast).toHaveBeenCalledWith(expect.objectContaining({type: "danger"}));
	});

	test("failed explicit Export save has one Page error and no success notification", async () => {
		const page = makePage();
		await seed(page);
		const exporter = new CharacterSheetExport(page);
		jest.spyOn(console, "error").mockImplementation(() => {});
		StorageUtil.pSet.mockRejectedValue(new Error("Storage unavailable"));
		await exporter._saveCharacter();
		expect(JqueryUtil.doToast.mock.calls.map(([toast]) => toast.type)).toEqual(["danger"]);
	});

	test("a failed duplicate save renders its retryable copy without changing the original roster", async () => {
		const page = makePage();
		await seed(page);
		const originalSet = StorageUtil.pSet;
		let writes = 0;
		StorageUtil.pSet = jest.fn(async (key, value) => {
			if (key === "charsheet-characters" && ++writes === 2) throw new Error("Copy save unavailable");
			return originalSet(key, value);
		});
		jest.spyOn(console, "error").mockImplementation(() => {});
		page._renderCharacter.mockClear();
		await page._onDuplicateCharacter();
		expect(page._state.getName()).toBe("A (Copy)");
		expect(page._currentCharacterId).not.toBe("a");
		expect(page._renderCharacter).toHaveBeenCalled();
		expect(page._selCharacter.value).toBe("");
		expect(window.location.searchParams.get("id")).toBe(page._currentCharacterId);
		expect(backend.roster.map(record => record.name)).toEqual(["A"]);
		expect(await page.saveCharacter()).toBe(true);
		expect(backend.roster.map(record => record.name)).toEqual(["A", "A (Copy)"]);
	});

	test("retrying an import after its final save failed updates the admitted import instead of adding a second copy", async () => {
		const page = makePage();
		await page._pLoadCharacters();
		page._createNewCharacter();
		const exporter = new CharacterSheetExport(page);
		const data = {...page._state.toJson(), name: "Imported once"};
		const originalSet = StorageUtil.pSet;
		let writes = 0;
		StorageUtil.pSet = jest.fn(async (key, value) => {
			if (key === "charsheet-characters" && ++writes === 2) throw new Error("Final import save unavailable");
			return originalSet(key, value);
		});
		jest.spyOn(console, "error").mockImplementation(() => {});
		expect(await exporter._importCharacterData(data)).toBeNull();
		const importedId = page._currentCharacterId;
		expect(backend.roster.map(record => record.name)).toEqual(["Imported once"]);
		expect(await exporter._importCharacterData({...data, name: "Retried import"})).not.toBeNull();
		expect(page._currentCharacterId).toBe(importedId);
		expect(backend.roster.map(record => record.name)).toEqual(["Retried import"]);
	});

	test("an import committed after New does not save or activate the new untouched selection", async () => {
		const page = makePage();
		await page._pLoadCharacters();
		page._createNewCharacter();
		const exporter = new CharacterSheetExport(page);
		const data = {...page._state.toJson(), name: "Background import"};
		const started = deferred();
		const release = deferred();
		const originalSet = StorageUtil.pSet;
		let first = true;
		StorageUtil.pSet = jest.fn(async (key, value) => {
			if (key === "charsheet-characters" && first) {
				first = false;
				started.resolve();
				await release.promise;
			}
			return originalSet(key, value);
		});
		const importing = exporter._importCharacterData(data);
		await started.promise;
		page._createNewCharacter();
		const draftId = page._currentCharacterId;
		release.resolve();
		const imported = await importing;
		expect(imported.getId()).toBe(backend.roster[0].id);
		expect(page._currentCharacterId).toBe(draftId);
		expect(page._isPristineCharacterDraft()).toBe(true);
		expect(backend.roster.map(record => record.name)).toEqual(["Background import"]);
	});

	test.each([false, true])("import dialog keeps its draft and avoids success/Invalid JSON after a failed %s replacement", async replaceExisting => {
		const page = makePage();
		const original = await seed(page);
		const exporter = new CharacterSheetExport(page);
		const close = jest.fn();
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({eleModalInner: e_({}), doClose: close});
		jest.spyOn(console, "error").mockImplementation(() => {});
		await exporter._showImportDialog();
		const textarea = dialogElements.find(element => element.tag === "textarea");
		const checkbox = dialogElements.find(element => element.type === "checkbox");
		const button = dialogElements.find(element => element.textContent === "Import");
		textarea.value = JSON.stringify({...original, name: "Imported retry"});
		checkbox.checked = replaceExisting;
		const originalSet = StorageUtil.pSet;
		StorageUtil.pSet = jest.fn(async () => { throw new Error("Storage unavailable"); });
		await button._handlers.click();
		expect(close).not.toHaveBeenCalled();
		expect(JqueryUtil.doToast.mock.calls.map(([toast]) => toast.type)).toEqual(["danger"]);
		expect(textarea.value).toContain("Imported retry");
		expect(backend.roster[0].name).toBe("A");
		expect(page._state.getName()).toBe(replaceExisting ? "Imported retry" : "A");
		StorageUtil.pSet = originalSet;
		await button._handlers.click();
		expect(close).toHaveBeenCalledWith(true);
		expect(page._state.getName()).toBe("Imported retry");
	});

	test("genuine invalid JSON still receives import validation feedback", async () => {
		const page = makePage();
		const exporter = new CharacterSheetExport(page);
		const close = jest.fn();
		jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({eleModalInner: e_({}), doClose: close});
		jest.spyOn(console, "error").mockImplementation(() => {});
		await exporter._showImportDialog();
		dialogElements.find(element => element.tag === "textarea").value = "{broken";
		await dialogElements.find(element => element.textContent === "Import")._handlers.click();
		expect(close).not.toHaveBeenCalled();
		expect(JqueryUtil.doToast).toHaveBeenCalledWith({type: "danger", content: "Failed to import: Invalid JSON data."});
	});
});
