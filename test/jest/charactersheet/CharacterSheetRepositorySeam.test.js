import "./setup.js";
import {jest} from "@jest/globals";
import {HubCharacterMemoryAuthority, HubCharacterRepository} from "../../../js/hub/hub-character-repository.js";
import {CHARACTER_ACCESS_MODES} from "../../../js/hub/hub-character-view.js";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
let CharacterSheetPage;
let CharacterSheetModal;

const makeRepository = (characters = []) => {
	const data = new Map(characters.map(character => [character.id, structuredClone(character)]));
	return {
		isRescueMirrorEnabled: false,
		pList: jest.fn(async () => [...data.values()].map(character => structuredClone(character))),
		pGet: jest.fn(async ({characterId}) => structuredClone(data.get(characterId) || null)),
		pUpsert: jest.fn(async ({character}) => {
			data.set(character.id, structuredClone(character));
			return structuredClone(character);
		}),
		pDelete: jest.fn(async ({characterId}) => data.delete(characterId)),
		pDeleteMany: jest.fn(async ({characterIds}) => {
			let count = 0;
			characterIds.forEach(id => { if (data.delete(id)) count++; });
			return count;
		}),
	};
};

const makeDeferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((resolve_, reject_) => {
		resolve = resolve_;
		reject = reject_;
	});
	return {promise, resolve, reject};
};

describe("Character Sheet repository seam", () => {
	beforeAll(async () => {
		globalThis.window = globalThis.window || {addEventListener: () => {}, location: {search: "", href: "http://test/"}};
		globalThis.document = globalThis.document || {getElementById: () => null, querySelector: () => null, addEventListener: () => {}};
		CharacterSheetPage = (await import(`${REPO_ROOT}js/charactersheet/charactersheet.js`)).CharacterSheetPage;
		CharacterSheetModal = globalThis.CharacterSheetModal;
	});

	it("saves through the injected repository without writing a local rescue mirror", async () => {
		const repository = makeRepository();
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "cloud-character",
			_state: {toJson: () => ({name: "Cloud Character", hp: {current: 12}})},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_lastSavedAt: 0,
		};

		await CharacterSheetPage.prototype._saveCurrentCharacter.call(host);

		expect(repository.pUpsert).toHaveBeenCalledWith({
			activity: null,
			character: expect.objectContaining({
				id: "cloud-character",
				name: "Cloud Character",
				_savedAt: expect.any(Number),
			}),
			isCreate: false,
		});
		expect(host._writeActiveCharacterMirror).not.toHaveBeenCalled();
		expect(host._clearActiveCharacterMirror).not.toHaveBeenCalled();
	});

	it("loads the dropdown from the injected repository", async () => {
		const characters = [{id: "cloud-a", name: "A"}, {id: "cloud-b", name: "B"}];
		const repository = makeRepository(characters);
		const host = {
			_characterRepository: repository,
			_updateCharacterDropdown: jest.fn(),
		};

		await CharacterSheetPage.prototype._pLoadCharacters.call(host);

		expect(repository.pList).toHaveBeenCalledTimes(1);
		expect(host._updateCharacterDropdown).toHaveBeenCalledWith(characters);
	});

	it("ends old character interactions before awaiting a replacement character", async () => {
		const load = makeDeferred();
		const host = {
			_characterLoadGeneration: 4,
			_currentCharacterId: "character-a",
			_characterRepository: {
				isRescueMirrorEnabled: false,
				pGet: jest.fn(() => load.promise),
			},
			_closeCharacterScopedTransientUi: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_campaign: {resetCharacterScope: jest.fn()},
			_reconcilePersistedCharacter: CharacterSheetPage.prototype._reconcilePersistedCharacter,
		};

		const pending = CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-b");

		expect(host._closeCharacterScopedTransientUi).toHaveBeenCalledTimes(1);
		expect(host._characterRepository.pGet).toHaveBeenCalledWith({characterId: "character-b"});
		load.resolve(null);
		await pending;
	});

	it("does not erase cloud dropdown options when the current character name changes", () => {
		const select = {
			value: "cloud-a",
			options: [
				{value: "", textContent: "Create New Character"},
				{value: "cloud-a", textContent: "Before — Fighter 1"},
				{value: "cloud-b", textContent: "Other — Wizard 2"},
			],
		};
		const host = {
			_isHubCharacter: true,
			_currentCharacterId: "cloud-a",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_selCharacter: select,
			_state: {
				getName: () => "After",
				getClasses: () => [{name: "Fighter", level: 1}],
			},
			_characterRepository: {getCharacterAccess: () => CHARACTER_ACCESS_MODES.OWNER},
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
		};

		CharacterSheetPage.prototype._updateCharacterDropdown.call(host);

		expect(select.options.map(option => [option.value, option.textContent])).toEqual([
			["", "Create New Character"],
			["cloud-a", "After — Fighter 1"],
			["cloud-b", "Other — Wizard 2"],
		]);
		expect(select.value).toBe("cloud-a");
	});

	it("syncs state-bound Roll History controls on every full character render", () => {
		const syncFromActiveCharacter = jest.fn();
		const host = {
			_state: {
				syncDerivedResourceMaxes: jest.fn(),
				getViewMode: () => "normal",
			},
			_rollHistory: {syncFromActiveCharacter},
			_updateTabVisibility: jest.fn(),
			_applyCharacterAccessMode: jest.fn(),
		};
		for (const method of [
			"_renderBasicInfo",
			"_renderAbilityScores",
			"_renderSavingThrows",
			"_renderSkills",
			"_renderHp",
			"_renderCombatStats",
			"_renderDefenses",
			"_renderHitDice",
			"_renderDeathSaves",
			"_renderInspiration",
			"_renderProficiencies",
			"_renderCurrency",
			"_renderNotes",
			"_renderAppearance",
			"_renderPortrait",
			"_renderConditions",
			"_renderExhaustion",
			"_renderResources",
			"_renderOverviewMetamagic",
			"_renderOverviewRanger",
			"_renderOverviewPrinciples",
			"_renderActiveStates",
			"_renderFavouritesOverview",
			"_renderOverviewActions",
			"_renderOverviewSpecialtiesFeats",
			"_renderAttacks",
			"_renderQuickSpells",
			"_renderAbilitiesDetailed",
			"_renderModifierIndicators",
			"_renderCompanions",
		]) host[method] = jest.fn();

		CharacterSheetPage.prototype._renderCharacter.call(host);
		expect(syncFromActiveCharacter).toHaveBeenCalledTimes(1);
		expect(syncFromActiveCharacter).toHaveBeenCalledTimes(1);
	});

	it("reports remote save failure so character switching can abort", async () => {
		const repository = makeRepository();
		repository.pUpsert.mockRejectedValueOnce(new Error("revision conflict"));
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "cloud-character",
			_state: {toJson: () => ({name: "Unsaved"})},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_lastSavedAt: 0,
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(false);
		expect(host._updateSaveIndicator).toHaveBeenLastCalledWith("error");
	});

	it("saves through the actual hub repository contract", async () => {
		const authority = new HubCharacterMemoryAuthority();
		authority.createCharacter({
			characterId: "cloud-character",
			ownerId: "player-1",
			campaignId: "campaign-1",
			data: {id: "cloud-character", name: "Before", hp: {current: 20}},
			mutationId: "create",
		});

		const repository = new HubCharacterRepository({
			authority,
			sessionId: "device-a",
			ownerId: "player-1",
			campaignId: "campaign-1",
		});
		await repository.pGet({characterId: "cloud-character"});
		await repository.pAcquireLease({characterId: "cloud-character"});
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "cloud-character",
			_state: {toJson: () => ({id: "cloud-character", name: "After", hp: {current: 13}})},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_lastSavedAt: 0,
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
		expect(authority.getCharacter({characterId: "cloud-character"})).toEqual(expect.objectContaining({
			revision: 2,
			data: expect.objectContaining({name: "After", hp: {current: 13}}),
		}));
	});

	it("adopts a canonical id returned by the cloud repository", async () => {
		const calls = [];
		const repository = makeRepository();
		repository.pUpsert.mockImplementationOnce(async options => {
			calls.push("upsert");
			expect(options.isCreate).toBe(true);
			return {id: "server-id", name: "Cloud Character"};
		});
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "temporary-id",
			_characterLoadGeneration: 1,
			_isHubCharacter: true,
			_hubCampaignId: "campaign-1",
			_isCurrentCharacterNew: true,
			_state: {
				toJson: () => ({name: "Cloud Character"}),
				setId: jest.fn(),
			},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_adoptCanonicalCharacterIdentity: CharacterSheetPage.prototype._adoptCanonicalCharacterIdentity,
			_pRefreshCanonicalCharacterRoster: CharacterSheetPage.prototype._pRefreshCanonicalCharacterRoster,
			_lastSavedAt: 0,
			_detachHubRealtime: jest.fn(),
			_pLoadCharacters: jest.fn(async () => calls.push("refresh")),
			_pRefreshPersistedCharacterUi: CharacterSheetPage.prototype._pRefreshPersistedCharacterUi,
			_syncCurrentCharacterDropdownOption: CharacterSheetPage.prototype._syncCurrentCharacterDropdownOption,
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_selCharacter: {value: ""},
			_attachHubRealtime: jest.fn(() => calls.push("attach")),
			_campaign: {pRefreshCurrentCharacter: jest.fn(async () => calls.push("campaign"))},
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
		expect(host._currentCharacterId).toBe("server-id");
		expect(host._isCurrentCharacterNew).toBe(false);
		expect(host._selCharacter.value).toBe("server-id");
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-id"});
		expect(calls).toEqual(["upsert", "attach", "refresh", "campaign"]);
	});

	it("keeps a canonical create successful when post-create UI refreshes fail", async () => {
		const calls = [];
		const repository = makeRepository();
		repository.getCharacterAccess = jest.fn(() => CHARACTER_ACCESS_MODES.OWNER);
		repository.pUpsert.mockImplementationOnce(async () => {
			calls.push("upsert");
			return {id: "server-id", name: "Cloud Character"};
		});
		const toastPrevious = globalThis.JqueryUtil.doToast;
		const doToast = jest.fn();
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		globalThis.JqueryUtil.doToast = doToast;
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "temporary-id",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isCurrentCharacterNew: true,
			_characterLoadGeneration: 0,
			_isHubCharacter: true,
			_hubCampaignId: "campaign-1",
			_state: {
				toJson: () => ({name: "Cloud Character"}),
				setId: jest.fn(),
			},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_adoptCanonicalCharacterIdentity: CharacterSheetPage.prototype._adoptCanonicalCharacterIdentity,
			_lastSavedAt: 0,
			_detachHubRealtime: jest.fn(),
			_pLoadCharacters: jest.fn(async () => {
				calls.push("refresh");
				throw new Error("roster unavailable");
			}),
			_pRefreshPersistedCharacterUi: CharacterSheetPage.prototype._pRefreshPersistedCharacterUi,
			_syncCurrentCharacterDropdownOption: CharacterSheetPage.prototype._syncCurrentCharacterDropdownOption,
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_selCharacter: {value: "", options: []},
			_attachHubRealtime: jest.fn(() => calls.push("attach")),
			_campaign: {
				pRefreshCurrentCharacter: jest.fn(async () => {
					calls.push("campaign");
					throw new Error("campaign controls unavailable");
				}),
			},
		};

		try {
			await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(doToast).toHaveBeenCalledWith(expect.objectContaining({
				type: "warning",
				content: expect.stringContaining("Character saved"),
			}));
		} finally {
			warn.mockRestore();
			globalThis.JqueryUtil.doToast = toastPrevious;
		}

		expect(host._currentCharacterId).toBe("server-id");
		expect(host._isCurrentCharacterNew).toBe(false);
		expect(host._state.setId).toHaveBeenCalledWith("server-id");
		expect(host._selCharacter.value).toBe("server-id");
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-id"});
		expect(host._updateSaveIndicator).toHaveBeenLastCalledWith("saved");
		expect(calls).toEqual(["upsert", "attach", "refresh", "campaign"]);
	});

	it("does not send owner-only writes for a DM read-only character", async () => {
		const repository = makeRepository();
		repository.getCharacterAccess = () => "dm_readonly";
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: "dm_readonly",
			_state: {toJson: () => ({name: "Locally edited"})},
			_updateSaveIndicator: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
		expect(repository.pUpsert).not.toHaveBeenCalled();
		expect(host._updateSaveIndicator).toHaveBeenLastCalledWith("readonly");
	});

	it("conceals an active Hub character when a terminal delete race cannot restore realtime", async () => {
		const terminalError = Object.assign(new Error("already archived"), {code: "CHARACTER_NOT_FOUND", status: 404});
		const host = {
			_characterRepository: {pDelete: jest.fn(async () => { throw terminalError; })},
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(() => true),
		};
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			await expect(CharacterSheetPage.prototype._onDeleteCharacter.call(host)).rejects.toBe(terminalError);
		} finally {
			confirm.mockRestore();
		}

		expect(host._detachHubRealtime).toHaveBeenCalledTimes(1);
		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "character",
		});
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it("does not conceal or reattach the source when a delete failure settles after a character switch", async () => {
		const deletion = makeDeferred();
		const terminalError = Object.assign(new Error("already archived"), {code: "CHARACTER_NOT_FOUND", status: 404});
		const host = {
			_characterRepository: {pDelete: jest.fn(() => deletion.promise)},
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(),
		};
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			const pending = CharacterSheetPage.prototype._onDeleteCharacter.call(host);
			await Promise.resolve();
			host._currentCharacterId = "character-b";
			deletion.reject(terminalError);
			await expect(pending).rejects.toBe(terminalError);
		} finally {
			confirm.mockRestore();
		}

		expect(host._endCurrentHubCharacterAccess).not.toHaveBeenCalled();
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
		expect(host._currentCharacterId).toBe("character-b");
	});

	it("does not blank a newly selected character when an earlier delete succeeds late", async () => {
		const deletion = makeDeferred();
		const host = {
			_characterRepository: {pDelete: jest.fn(() => deletion.promise)},
			_currentCharacterId: "character-a",
			_detachHubRealtime: jest.fn(),
			_createNewCharacter: jest.fn(),
			_pLoadCharacters: jest.fn(async () => {}),
			_selCharacter: {value: "character-b"},
		};
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			const pending = CharacterSheetPage.prototype._onDeleteCharacter.call(host);
			await Promise.resolve();
			host._currentCharacterId = "character-b";
			deletion.resolve(true);
			await pending;
		} finally {
			confirm.mockRestore();
		}

		expect(host._createNewCharacter).not.toHaveBeenCalled();
		expect(host._pLoadCharacters).toHaveBeenCalledTimes(1);
		expect(host._selCharacter.value).toBe("character-b");
	});

	it("conceals a successfully deleted active character before a roster refresh can fail", async () => {
		const refreshError = new Error("roster refresh failed");
		const host = {
			_characterRepository: {pDelete: jest.fn(async () => true)},
			_currentCharacterId: "character-a",
			_detachHubRealtime: jest.fn(),
			_createNewCharacter: jest.fn(() => host._currentCharacterId = "new-character"),
			_pLoadCharacters: jest.fn(async () => { throw refreshError; }),
			_selCharacter: {value: "character-a"},
		};
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			await expect(CharacterSheetPage.prototype._onDeleteCharacter.call(host)).rejects.toBe(refreshError);
		} finally {
			confirm.mockRestore();
		}

		expect(host._createNewCharacter).toHaveBeenCalledTimes(1);
		expect(host._selCharacter.value).toBe("");
		expect(host._currentCharacterId).toBe("new-character");
	});

	it("conceals an active Hub character when a terminal bulk-delete race cannot restore realtime", async () => {
		const terminalError = Object.assign(new Error("already archived"), {code: "CHARACTER_NOT_FOUND", status: 404});
		const characters = [{id: "character-a", name: "Mira"}];
		const host = {
			_characterRepository: {
				pList: jest.fn(async () => characters),
				pDeleteMany: jest.fn(async () => { throw terminalError; }),
			},
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(() => true),
		};
		const previousMultipleChoice = globalThis.InputUiUtil.pGetUserMultipleChoice;
		const previousGetUserString = globalThis.InputUiUtil.pGetUserString;
		const previousEscapeQuotes = String.prototype.escapeQuotes;
		globalThis.InputUiUtil.pGetUserMultipleChoice = jest.fn(async () => characters);
		globalThis.InputUiUtil.pGetUserString = jest.fn(async () => "DELETE");
		String.prototype.escapeQuotes = function () { return `${this}`; };
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			await expect(CharacterSheetPage.prototype._onManageCharacters.call(host)).rejects.toBe(terminalError);
		} finally {
			confirm.mockRestore();
			if (previousMultipleChoice) globalThis.InputUiUtil.pGetUserMultipleChoice = previousMultipleChoice;
			else delete globalThis.InputUiUtil.pGetUserMultipleChoice;
			if (previousGetUserString) globalThis.InputUiUtil.pGetUserString = previousGetUserString;
			else delete globalThis.InputUiUtil.pGetUserString;
			if (previousEscapeQuotes) String.prototype.escapeQuotes = previousEscapeQuotes;
			else delete String.prototype.escapeQuotes;
		}

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "character",
		});
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it("conceals an active character already committed by a partially failed bulk delete", async () => {
		const partialError = Object.assign(new Error("second archive failed"), {
			code: "NETWORK_UNAVAILABLE",
			deletedCharacterIds: ["character-a"],
		});
		const characters = [{id: "character-a", name: "Mira"}, {id: "character-b", name: "Rin"}];
		const host = {
			_characterRepository: {
				pList: jest.fn(async () => characters),
				pDeleteMany: jest.fn(async () => { throw partialError; }),
			},
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(() => true),
		};
		const previousMultipleChoice = globalThis.InputUiUtil.pGetUserMultipleChoice;
		const previousEscapeQuotes = String.prototype.escapeQuotes;
		globalThis.InputUiUtil.pGetUserMultipleChoice = jest.fn(async () => characters);
		String.prototype.escapeQuotes = function () { return `${this}`; };
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			await expect(CharacterSheetPage.prototype._onManageCharacters.call(host)).rejects.toBe(partialError);
		} finally {
			confirm.mockRestore();
			if (previousMultipleChoice) globalThis.InputUiUtil.pGetUserMultipleChoice = previousMultipleChoice;
			else delete globalThis.InputUiUtil.pGetUserMultipleChoice;
			if (previousEscapeQuotes) String.prototype.escapeQuotes = previousEscapeQuotes;
			else delete String.prototype.escapeQuotes;
		}

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "character",
		});
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it("conceals a later-selected character in the committed prefix of a partial bulk delete", async () => {
		const deletion = makeDeferred();
		const partialError = Object.assign(new Error("third archive failed"), {
			code: "NETWORK_UNAVAILABLE",
			deletedCharacterIds: ["character-a", "character-b"],
		});
		const characters = [
			{id: "character-a", name: "Mira"},
			{id: "character-b", name: "Rin"},
			{id: "character-c", name: "Sol"},
		];
		const host = {
			_characterRepository: {
				pList: jest.fn(async () => characters),
				pDeleteMany: jest.fn(() => deletion.promise),
			},
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(() => true),
		};
		const previousMultipleChoice = globalThis.InputUiUtil.pGetUserMultipleChoice;
		const previousGetUserString = globalThis.InputUiUtil.pGetUserString;
		const previousEscapeQuotes = String.prototype.escapeQuotes;
		globalThis.InputUiUtil.pGetUserMultipleChoice = jest.fn(async () => characters);
		globalThis.InputUiUtil.pGetUserString = jest.fn(async () => "DELETE");
		String.prototype.escapeQuotes = function () { return `${this}`; };
		const confirm = jest.spyOn(globalThis.InputUiUtil, "pGetUserBoolean").mockResolvedValue(true);
		try {
			const pending = CharacterSheetPage.prototype._onManageCharacters.call(host);
			await new Promise(resolve => setImmediate(resolve));
			expect(host._characterRepository.pDeleteMany).toHaveBeenCalledTimes(1);
			host._currentCharacterId = "character-b";
			deletion.reject(partialError);
			await expect(pending).rejects.toBe(partialError);
		} finally {
			confirm.mockRestore();
			if (previousMultipleChoice) globalThis.InputUiUtil.pGetUserMultipleChoice = previousMultipleChoice;
			else delete globalThis.InputUiUtil.pGetUserMultipleChoice;
			if (previousGetUserString) globalThis.InputUiUtil.pGetUserString = previousGetUserString;
			else delete globalThis.InputUiUtil.pGetUserString;
			if (previousEscapeQuotes) String.prototype.escapeQuotes = previousEscapeQuotes;
			else delete String.prototype.escapeQuotes;
		}

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-b",
			accessEndCause: "character",
		});
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it("disables mutation controls before a DM can edit a read-only sheet", () => {
		const makeControl = ({id = "", disabled = false, role = null, tabindex = null, draggable = null} = {}) => {
			const attributes = new Map();
			if (role != null) attributes.set("role", role);
			if (tabindex != null) attributes.set("tabindex", tabindex);
			if (draggable != null) attributes.set("draggable", draggable);
			return {
				id,
				disabled,
				dataset: {},
				matches: selector => selector === "[role=\"button\"]" && role === "button",
				setAttribute: jest.fn((name, value) => attributes.set(name, `${value}`)),
				removeAttribute: jest.fn(name => attributes.delete(name)),
				getAttribute: jest.fn(name => attributes.get(name) ?? null),
			};
		};
		const edit = makeControl();
		const customButton = makeControl({role: "button", tabindex: "0"});
		const draggable = makeControl({draggable: "true"});
		const characterSelect = makeControl({id: "charsheet-sel-character"});
		const exportButton = makeControl({id: "charsheet-btn-export"});
		const moreButton = makeControl({id: "charsheet-btn-more"});
		const stalePortal = {remove: jest.fn()};
		const closeCastOptionsMenu = jest.fn();
		const cancelLongPress = jest.fn();
		const hideMobileContextMenu = jest.fn();
		const closeAllMenus = jest.fn();
		const root = {
			classList: {toggle: jest.fn()},
			getAttribute: jest.fn(() => null),
			setAttribute: jest.fn(),
			querySelectorAll: jest.fn(() => [edit, customButton, draggable, characterSelect, exportButton, moreButton]),
		};
		const documentPrevious = globalThis.document;
		const mobilePrevious = globalThis._charsheetMobile;
		const contextUtilPrevious = globalThis.ContextUtil;
		globalThis.document = {
			querySelector: () => root,
			querySelectorAll: () => [stalePortal],
		};
		globalThis._charsheetMobile = {
			_cancelLongPress: cancelLongPress,
			_hideContextMenu: hideMobileContextMenu,
		};
		globalThis.ContextUtil = {...contextUtilPrevious, closeAllMenus};
		const host = {
			_currentCharacterAccess: "dm_readonly",
			_spells: {_closeCastOptionsMenu: closeCastOptionsMenu},
			_closeCharacterScopedTransientUi: jest.fn(),
			_updateSaveIndicator: jest.fn(),
		};
		try {
			CharacterSheetPage.prototype._applyCharacterAccessMode.call(host);
		} finally {
			globalThis.document = documentPrevious;
			if (mobilePrevious) globalThis._charsheetMobile = mobilePrevious;
			else delete globalThis._charsheetMobile;
			globalThis.ContextUtil = contextUtilPrevious;
		}

		expect(edit.disabled).toBe(true);
		expect(edit.setAttribute).toHaveBeenCalledWith("aria-disabled", "true");
		expect(customButton.setAttribute).toHaveBeenCalledWith("tabindex", "-1");
		expect(customButton.setAttribute).toHaveBeenCalledWith("aria-disabled", "true");
		expect(draggable.setAttribute).toHaveBeenCalledWith("draggable", "false");
		expect(characterSelect.disabled).toBe(false);
		expect(exportButton.disabled).toBe(false);
		expect(moreButton.disabled).toBe(false);
		expect(stalePortal.remove).toHaveBeenCalledTimes(2);
		expect(closeCastOptionsMenu).toHaveBeenCalledTimes(1);
		expect(cancelLongPress).toHaveBeenCalledTimes(1);
		expect(hideMobileContextMenu).toHaveBeenCalledTimes(1);
		expect(closeAllMenus).toHaveBeenCalledTimes(1);
		expect(host._closeCharacterScopedTransientUi).toHaveBeenCalledTimes(1);
		expect(host._updateSaveIndicator).toHaveBeenCalledWith("readonly");

		host._currentCharacterAccess = "owner";
		globalThis.document = {querySelector: () => root, querySelectorAll: () => []};
		try {
			CharacterSheetPage.prototype._applyCharacterAccessMode.call(host);
		} finally {
			globalThis.document = documentPrevious;
		}
		expect(customButton.setAttribute).toHaveBeenCalledWith("tabindex", "0");
		expect(customButton.removeAttribute).toHaveBeenCalledWith("aria-disabled");
		expect(draggable.setAttribute).toHaveBeenCalledWith("draggable", "true");
	});

	it("keeps read-only DM views live without activating owner-only integrations", () => {
		const host = {
			_currentCharacterAccess: "dm_readonly",
			_hubRealtimeGeneration: 0,
			_hubEffects: {activate: jest.fn(), deactivate: jest.fn()},
			_peerTargeting: {activate: jest.fn(), deactivate: jest.fn()},
			_partyInventory: {pAttach: jest.fn(), detach: jest.fn()},
			_hubRealtime: {attach: jest.fn(() => true)},
		};

		expect(CharacterSheetPage.prototype._attachHubRealtime.call(host, {characterId: "player-character"})).toBe(true);
		expect(host._hubRealtime.attach).toHaveBeenCalledWith({characterId: "player-character"});
		expect(host._hubEffects.activate).not.toHaveBeenCalled();
		expect(host._peerTargeting.activate).not.toHaveBeenCalled();
		expect(host._partyInventory.pAttach).not.toHaveBeenCalled();
		expect(host._hubEffects.deactivate).toHaveBeenCalled();
		expect(host._peerTargeting.deactivate).toHaveBeenCalled();
		expect(host._partyInventory.detach).toHaveBeenCalled();
	});

	it("replaces a DM read-only projection after an ordinary character invalidation without saving", async () => {
		let loaded = null;
		const repository = {
			pGet: jest.fn(async () => ({id: "player-character", name: "Updated by owner", hp: {current: 7, max: 12}})),
			getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
			pAcquireLease: jest.fn(),
			pUpsert: jest.fn(),
		};
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_hubContext: {rulesVersion: {rules: {thelemar_carryWeight: false}}},
			_state: {
				loadFromJson: data => loaded = structuredClone(data),
				setCampaignSettingsOverlay: jest.fn(),
			},
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
			_updateCharacterDropdown: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._pRefreshHubReadOnlyCharacter.call(host, {
			characterId: "player-character",
		})).resolves.toBe(true);

		expect(repository.pGet).toHaveBeenCalledWith({characterId: "player-character"});
		expect(loaded).toEqual(expect.objectContaining({name: "Updated by owner", hp: {current: 7, max: 12}}));
		expect(host._state.setCampaignSettingsOverlay).toHaveBeenCalledWith(expect.objectContaining({thelemar_carryWeight: false}));
		expect(host._reconcileClassFeatures).toHaveBeenCalledTimes(1);
		expect(host._renderCharacter).toHaveBeenCalledTimes(1);
		expect(repository.pAcquireLease).not.toHaveBeenCalled();
		expect(repository.pUpsert).not.toHaveBeenCalled();
	});

	it("discards a late DM read-only projection after the character changes", async () => {
		const refresh = makeDeferred();
		const repository = {
			pGet: jest.fn(() => refresh.promise),
			getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
		};
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_state: {
				loadFromJson: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
			},
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
		};

		const pending = CharacterSheetPage.prototype._pRefreshHubReadOnlyCharacter.call(host, {
			characterId: "player-character",
		});
		host._currentCharacterId = "other-character";
		host._characterLoadGeneration++;
		refresh.resolve({id: "player-character", name: "Stale owner update"});

		await expect(pending).resolves.toBe(false);
		expect(host._state.loadFromJson).not.toHaveBeenCalled();
		expect(host._renderCharacter).not.toHaveBeenCalled();
	});

	it("discards a late DM read-only projection after the realtime binding changes", async () => {
		const refresh = makeDeferred();
		const repository = {
			pGet: jest.fn(() => refresh.promise),
			getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
		};
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_state: {
				loadFromJson: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
			},
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
		};

		const pending = CharacterSheetPage.prototype._pRefreshHubReadOnlyCharacter.call(host, {
			characterId: "player-character",
		});
		host._hubRealtimeGeneration++;
		refresh.resolve({id: "player-character", name: "Stale owner update"});

		await expect(pending).resolves.toBe(false);
		expect(host._state.loadFromJson).not.toHaveBeenCalled();
		expect(host._renderCharacter).not.toHaveBeenCalled();
	});

	it("conceals a DM read-only projection when its scoped access is revoked", async () => {
		const accessError = Object.assign(new Error("Character is no longer visible."), {
			code: "CHARACTER_PROJECTION_SCOPED",
		});
		const host = {
			_characterRepository: {
				pGet: jest.fn(async () => { throw accessError; }),
				getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
			},
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_onHubRealtimeConnectionState: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._pRefreshHubReadOnlyCharacter.call(host, {
			characterId: "player-character",
		})).resolves.toBe(false);
		expect(host._onHubRealtimeConnectionState).toHaveBeenCalledWith(expect.objectContaining({
			state: "closed",
			isCharacterAccessEnded: true,
		}));
	});

	it("retries a failed DM projection refresh when the realtime connection returns live", async () => {
		let loaded = null;
		const repository = {
			pGet: jest.fn()
				.mockRejectedValueOnce(new Error("temporary network failure"))
				.mockResolvedValueOnce({id: "player-character", name: "Recovered owner update"}),
			getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
			clearRealtimeReconciliation: jest.fn(),
		};
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "player-character",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_characterLoadGeneration: 3,
			_hubRealtimeGeneration: 5,
			_hubReadOnlyRefreshGeneration: 0,
			_isHubReadOnlyRefreshRequired: false,
			_hubContext: null,
			_hubContextGeneration: 0,
			_hubContextRefreshActiveGeneration: null,
			_isHubContextRefreshing: false,
			_isHubContextRevalidationRequired: false,
			_hubRulesRefreshBlocked: false,
			_state: {
				loadFromJson: data => loaded = structuredClone(data),
				setCampaignSettingsOverlay: jest.fn(),
			},
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
			_canRestoreHubRealtimeAfterError: () => true,
			_hubEffects: {onConnectionState: jest.fn()},
			_peerTargeting: {deactivate: jest.fn()},
			isCurrentCharacterReadOnly: () => true,
			_clearHubRules: jest.fn(),
			_campaign: {render: jest.fn()},
		};
		host._pRefreshHubReadOnlyCharacter = options =>
			CharacterSheetPage.prototype._pRefreshHubReadOnlyCharacter.call(host, options);

		await expect(host._pRefreshHubReadOnlyCharacter({characterId: "player-character"})).resolves.toBe(false);
		expect(host._isHubReadOnlyRefreshRequired).toBe(true);
		CharacterSheetPage.prototype._onHubRealtimeConnectionState.call(host, {state: "closed"});
		CharacterSheetPage.prototype._onHubRealtimeConnectionState.call(host, {state: "live"});
		await new Promise(resolve => setImmediate(resolve));

		expect(repository.pGet).toHaveBeenCalledTimes(2);
		expect(loaded).toEqual(expect.objectContaining({name: "Recovered owner update"}));
		expect(host._renderCharacter).toHaveBeenCalledTimes(1);
		expect(host._isHubReadOnlyRefreshRequired).toBe(false);
	});

	it("does not reactivate owner-only peer targeting on live read-only connection states", () => {
		const host = {
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			isCurrentCharacterReadOnly: () => true,
			_hubEffects: {onConnectionState: jest.fn()},
			_peerTargeting: {onConnectionState: jest.fn(), deactivate: jest.fn()},
			_isHubContextRevalidationRequired: false,
			_hubRulesRefreshBlocked: false,
		};

		CharacterSheetPage.prototype._onHubRealtimeConnectionState.call(host, {state: "live"});
		CharacterSheetPage.prototype._onHubRealtimeConnectionState.call(host, {state: "live", isReconnect: true});

		expect(host._peerTargeting.onConnectionState).not.toHaveBeenCalled();
		expect(host._peerTargeting.deactivate).toHaveBeenCalledTimes(2);
	});

	it("subscribes DM read-only views to character projection invalidations only", () => {
		const listeners = new Map();
		const host = {
			_hubRealtime: {
				on: jest.fn((type, listener) => listeners.set(type, listener)),
			},
			_isHubRealtimeListenersBound: false,
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.DM_READ_ONLY,
			_pRefreshHubReadOnlyCharacter: jest.fn(),
			_onHubProjectionInvalidated: jest.fn(),
			_onHubRealtimeCursor: jest.fn(),
			_onHubSemanticOperation: jest.fn(),
			_onHubRealtimeConnectionState: jest.fn(),
			_onHubCampaignContextChanged: jest.fn(),
			_onHubRealtimeDeliveryError: jest.fn(),
			_pRefreshHubRules: jest.fn(),
		};

		expect(CharacterSheetPage.prototype._initHubRealtimeListeners.call(host)).toBe(true);
		listeners.get("projectionInvalidated")({characterId: "player-character"});
		expect(host._pRefreshHubReadOnlyCharacter).toHaveBeenCalledWith({characterId: "player-character"});

		host._currentCharacterAccess = CHARACTER_ACCESS_MODES.OWNER;
		listeners.get("projectionInvalidated")({characterId: "owner-character"});
		expect(host._pRefreshHubReadOnlyCharacter).toHaveBeenCalledTimes(1);
		expect(host._onHubProjectionInvalidated).toHaveBeenCalledWith({characterId: "owner-character"});
	});

	it("blocks non-control mutation gestures in a DM read-only sheet", () => {
		const listeners = {};
		const root = {
			dataset: {},
			addEventListener: jest.fn((type, listener) => listeners[type] = listener),
		};
		const documentPrevious = globalThis.document;
		globalThis.document = {querySelector: () => root};
		const host = {_currentCharacterAccess: "dm_readonly"};
		try {
			CharacterSheetPage.prototype._initReadOnlyInteractionGuard.call(host);
			const blocked = {
				target: {closest: () => null},
				preventDefault: jest.fn(),
				stopImmediatePropagation: jest.fn(),
			};
			listeners.click(blocked);
			expect(blocked.preventDefault).toHaveBeenCalled();
			expect(blocked.stopImmediatePropagation).toHaveBeenCalled();

			for (const key of ["Enter", " "]) {
				const keyboardActivation = {
					type: "keydown",
					key,
					target: {closest: () => null},
					preventDefault: jest.fn(),
					stopImmediatePropagation: jest.fn(),
				};
				listeners.keydown(keyboardActivation);
				expect(keyboardActivation.preventDefault).toHaveBeenCalled();
				expect(keyboardActivation.stopImmediatePropagation).toHaveBeenCalled();
			}

			for (const type of ["contextmenu", "dragstart", "dragover", "drop"]) {
				const drag = {
					type,
					target: {closest: () => null},
					preventDefault: jest.fn(),
					stopImmediatePropagation: jest.fn(),
				};
				listeners[type](drag);
				expect(drag.preventDefault).toHaveBeenCalled();
				expect(drag.stopImmediatePropagation).toHaveBeenCalled();
			}

			const keyboardNavigation = {
				type: "keydown",
				key: "Tab",
				target: {closest: () => null},
				preventDefault: jest.fn(),
				stopImmediatePropagation: jest.fn(),
			};
			listeners.keydown(keyboardNavigation);
			expect(keyboardNavigation.preventDefault).not.toHaveBeenCalled();

			const navigation = {
				target: {closest: () => ({id: "charsheet-sel-character"})},
				preventDefault: jest.fn(),
				stopImmediatePropagation: jest.fn(),
			};
			listeners.change(navigation);
			expect(navigation.preventDefault).not.toHaveBeenCalled();
		} finally {
			globalThis.document = documentPrevious;
		}
	});

	it("adopts a canonical id when loading through a temporary recovery URL", async () => {
		const previousLocation = globalThis.window.location;
		const previousHistory = globalThis.window.history;
		globalThis.window.location = new URL("http://test/charactersheet.html?campaign=campaign-1&id=temporary-id");
		globalThis.window.history = {replaceState: jest.fn()};
		const state = {
			clearCampaignSettingsOverlay: jest.fn(),
			loadFromJson: jest.fn(),
			setCampaignSettingsOverlay: jest.fn(),
			getBackgroundTheme: jest.fn(() => null),
			getViewMode: jest.fn(() => "sheet"),
		};
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: null,
			_characterRepository: {
				isRescueMirrorEnabled: false,
				pGet: jest.fn(async ({characterId}) => {
					expect(characterId).toBe("temporary-id");
					return {id: "server-id", name: "Recovered"};
				}),
			},
			_state: state,
			_hubContext: null,
			_detachHubRealtime: jest.fn(),
			_reconcilePersistedCharacter: CharacterSheetPage.prototype._reconcilePersistedCharacter,
			_reconcileClassFeatures: jest.fn(() => null),
			_ensureLinguisticsSkillIfNeeded: jest.fn(),
			_renderCharacter: jest.fn(),
			_applyBackgroundTheme: jest.fn(),
			_updateThemePickerSelection: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_layout: null,
			_playMode: null,
		};

		try {
			await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "temporary-id")).resolves.toBe(true);
			expect(host._currentCharacterId).toBe("server-id");
			expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-id"});
			expect(globalThis.window.history.replaceState).toHaveBeenCalledWith(
				{},
				"",
				expect.objectContaining({searchParams: expect.any(URLSearchParams)}),
			);
		} finally {
			globalThis.window.location = previousLocation;
			globalThis.window.history = previousHistory;
		}
	});

	it("does not redirect a stale campaign-mismatch load over a newer selection", async () => {
		const load = makeDeferred();
		const previousLocation = globalThis.window.location;
		globalThis.window.location = {replace: jest.fn()};
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-a",
			_characterRepository: {pGet: jest.fn(() => load.promise)},
			_detachHubRealtime: jest.fn(),
			_campaign: {resetCharacterScope: jest.fn()},
		};
		try {
			const pending = CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-old");
			await Promise.resolve();
			host._characterLoadGeneration++;
			host._currentCharacterId = "character-new";
			load.reject(Object.assign(new Error("moved"), {
				code: "CHARACTER_CAMPAIGN_MISMATCH",
				campaignId: "campaign-new",
				characterId: "character-old",
			}));
			await expect(pending).resolves.toBe(false);
			expect(globalThis.window.location.replace).not.toHaveBeenCalled();
		} finally {
			globalThis.window.location = previousLocation;
		}
	});

	it("stops a repaired load after its save becomes stale", async () => {
		const repairSave = makeDeferred();
		const previousLocation = globalThis.window.location;
		const previousHistory = globalThis.window.history;
		globalThis.window.location = new URL("http://test/charactersheet.html?id=character-a");
		globalThis.window.history = {replaceState: jest.fn()};
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-a",
			_currentCharacterAccess: "owner",
			_characterRepository: {
				isRescueMirrorEnabled: false,
				pGet: jest.fn(async () => ({id: "character-old", name: "Old"})),
				getCharacterAccess: jest.fn(() => "owner"),
			},
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(),
			},
			_reconcilePersistedCharacter: CharacterSheetPage.prototype._reconcilePersistedCharacter,
			_reconcileClassFeatures: jest.fn(() => ({added: 1, backfilled: 0})),
			_ensureLinguisticsSkillIfNeeded: jest.fn(),
			_renderCharacter: jest.fn(),
			_saveCurrentCharacter: jest.fn(() => repairSave.promise),
			_state: {
				clearCampaignSettingsOverlay: jest.fn(),
				loadFromJson: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
				getBackgroundTheme: jest.fn(() => null),
				getViewMode: jest.fn(() => "sheet"),
			},
			_hubContext: null,
			_layout: {applySavedLayout: jest.fn()},
			_applyBackgroundTheme: jest.fn(),
			_updateThemePickerSelection: jest.fn(),
			_playMode: {activate: jest.fn(), deactivate: jest.fn()},
			_selCharacter: {value: ""},
		};
		try {
			const pending = CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-old");
			await Promise.resolve();
			await Promise.resolve();
			expect(host._saveCurrentCharacter).toHaveBeenCalledTimes(1);
			host._characterLoadGeneration++;
			host._currentCharacterId = "character-new";
			repairSave.resolve(true);
			await expect(pending).resolves.toBe(false);
		} finally {
			globalThis.window.location = previousLocation;
			globalThis.window.history = previousHistory;
		}

		expect(host._layout.applySavedLayout).not.toHaveBeenCalled();
		expect(host._applyBackgroundTheme).not.toHaveBeenCalled();
		expect(host._playMode.deactivate).not.toHaveBeenCalled();
		expect(host._campaign.pRefreshCurrentCharacter).not.toHaveBeenCalled();
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it("applies remote fields while preserving edits made during the save", async () => {
		let callCount = 0;
		let loaded = null;
		const state = {
			toJson: () => ++callCount === 1
				? {name: "Mira", xp: 100, hp: {current: 10}}
				: {name: "Mira", xp: 100, hp: {current: 9}},
			loadFromJson: data => loaded = structuredClone(data),
		};
		const host = {
			_characterRepository: {
				isRescueMirrorEnabled: false,
				pUpsert: async () => ({id: "c", name: "Mira", xp: 200, hp: {current: 10}}),
			},
			_currentCharacterId: "c",
			_state: state,
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_lastSavedAt: 0,
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
		expect(loaded).toEqual(expect.objectContaining({xp: 200, hp: {current: 9}}));
	});

	it("does not create a new character after the current cloud save fails", async () => {
		const host = {
			_currentCharacterId: "cloud-character",
			_selCharacter: {value: "cloud-character"},
			_saveCurrentCharacter: jest.fn(async () => false),
			_createNewCharacter: jest.fn(),
			_showTab: jest.fn(),
			switchToTab: jest.fn(),
		};

		await CharacterSheetPage.prototype._onNewCharacter.call(host);

		expect(host._createNewCharacter).not.toHaveBeenCalled();
		expect(host._showTab).not.toHaveBeenCalled();
	});

	it("does not import a character after the current cloud save fails", async () => {
		const repository = makeRepository();
		const host = {
			_currentCharacterId: "cloud-character",
			_saveCurrentCharacter: jest.fn(async () => false),
			_characterRepository: repository,
		};

		await expect(CharacterSheetPage.prototype.addCharacter.call(host, {
			toJson: () => ({name: "Imported"}),
		})).resolves.toBe(false);

		expect(repository.pUpsert).not.toHaveBeenCalled();
	});

	it("tears down realtime before creating an unsaved campaign character", () => {
		const host = {
			_characterLoadGeneration: 0,
			_detachHubRealtime: jest.fn(),
			_clearLastHpChange: jest.fn(),
			_currentCharacterId: "canonical-id",
			_isLevelUpBannerDismissed: true,
			_hubContext: null,
			_state: {
				clearCampaignSettingsOverlay: jest.fn(),
				reset: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
				setClassFeatureCatalog: jest.fn(),
				setId: jest.fn(),
			},
			_classFeatures: [],
			_subclassFeatures: [],
			_optionalFeaturesData: [],
			_renderCharacter: jest.fn(),
		};

		CharacterSheetPage.prototype._createNewCharacter.call(host);

		expect(host._detachHubRealtime).toHaveBeenCalledTimes(1);
		expect(host._characterLoadGeneration).toBe(1);
		expect(host._isCurrentCharacterNew).toBe(true);
		expect(host._state.setId).toHaveBeenCalledWith(host._currentCharacterId);
	});

	it("keeps the previous subscription attached when a character switch cannot load", async () => {
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-1",
			_characterRepository: {
				pGet: jest.fn(async () => { throw new Error("offline"); }),
			},
			_attachHubRealtime: jest.fn(),
			_detachHubRealtime: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-2"))
			.rejects.toThrow("offline");

		expect(host._detachHubRealtime).not.toHaveBeenCalled();
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
	});

	it.each(["CHARACTER_NOT_FOUND", "FORBIDDEN"])("keeps the previous character fully attached when the selected target fails with %s", async code => {
		const terminalError = Object.assign(new Error("unavailable target"), {code, status: 404});
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_selCharacter: {value: "character-b"},
			_characterRepository: {
				pGet: jest.fn(async () => { throw terminalError; }),
			},
			_closeCharacterScopedTransientUi: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(),
			},
			_canRestoreHubRealtimeAfterError: CharacterSheetPage.prototype._canRestoreHubRealtimeAfterError,
			_endCurrentHubCharacterAccess: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-b"))
			.rejects.toBe(terminalError);

		expect(host._currentCharacterId).toBe("character-a");
		expect(host._selCharacter.value).toBe("character-a");
		expect(host._detachHubRealtime).not.toHaveBeenCalled();
		expect(host._attachHubRealtime).not.toHaveBeenCalled();
		expect(host._campaign.resetCharacterScope).not.toHaveBeenCalled();
		expect(host._endCurrentHubCharacterAccess).not.toHaveBeenCalled();
	});

	it("conceals the previous Hub character when target loading proves the session lost authority", async () => {
		const authError = Object.assign(new Error("signed out"), {code: "AUTH_REQUIRED", status: 401});
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: "character-a",
			_isHubCharacter: true,
			_selCharacter: {value: "character-b"},
			_characterRepository: {
				pGet: jest.fn(async () => { throw authError; }),
			},
			_closeCharacterScopedTransientUi: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_campaign: {resetCharacterScope: jest.fn()},
			_endCurrentHubCharacterAccess: jest.fn(() => true),
		};

		await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-b"))
			.rejects.toBe(authError);

		expect(host._endCurrentHubCharacterAccess).toHaveBeenCalledWith({
			characterId: "character-a",
			accessEndCause: "campaign",
		});
	});

	it.each([
		["character replacement", host => {
			host._currentCharacterId = "character-b";
			host._characterLoadGeneration++;
		}],
		["owner authority loss", host => {
			host._currentCharacterAccess = "dm_readonly";
		}],
	])("cancels a completed 3D animation after %s", async (_label, applyTransition) => {
		let resolveRoll;
		const pRoll = new Promise(resolve => { resolveRoll = resolve; });
		const host = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 1,
			_currentCharacterAccess: "owner",
			_state: {getSettings: jest.fn(() => ({animatedDice: true, diceSound: false}))},
			_getCharacterScopeSnapshot: CharacterSheetPage.prototype._getCharacterScopeSnapshot,
			_isCharacterScopeSnapshotCurrent: CharacterSheetPage.prototype._isCharacterScopeSnapshotCurrent,
			_buildDiceAppearance: jest.fn(() => null),
			_getDice3d: jest.fn(() => ({
				canRender: jest.fn(() => true),
				pRollMany: jest.fn(() => pRoll),
			})),
		};
		const originalDice3d = globalThis.CharacterSheetDice3d;
		globalThis.CharacterSheetDice3d = {isReducedMotion: () => false};

		try {
			const pending = CharacterSheetPage.prototype.pAnimateDiceSpec.call(host, {
				groups: [{sides: 20, values: [12]}],
			});
			await Promise.resolve();
			applyTransition(host);
			resolveRoll();

			await expect(pending).resolves.toBe(false);
		} finally {
			globalThis.CharacterSheetDice3d = originalDice3d;
		}
	});

	it("settles a feature-choice modal torn down before the caller installs its resolver", async () => {
		const host = {
			_currentCharacterId: "character-a",
			_characterLoadGeneration: 1,
			_currentCharacterAccess: "owner",
			_formatSkillKeyLabel: CharacterSheetPage.prototype._formatSkillKeyLabel,
		};
		const originalUiUtil = globalThis.UiUtil;
		globalThis.UiUtil = {
			pGetShowModal: async ({cbClose}) => {
				host._currentCharacterId = "character-b";
				host._characterLoadGeneration++;
				return {
					eleModalInner: {},
					doClose: value => cbClose?.(value),
				};
			},
		};
		CharacterSheetModal.bindCharacterSheet(host);

		try {
			await expect(Promise.race([
				CharacterSheetPage.prototype._pPickFeatureChoice.call(host, {
					id: "tool-choice",
					featureName: "Tool Training",
					kind: "tool",
					options: ["Smith's tools"],
				}),
				new Promise(resolve => setTimeout(() => resolve("still-pending"), 50)),
			])).resolves.toBeNull();
		} finally {
			CharacterSheetModal.bindCharacterSheet(null);
			globalThis.UiUtil = originalUiUtil;
		}
	});

	it("selects a directly loaded character in the dropdown", async () => {
		const windowPrevious = globalThis.window;
		globalThis.window = {
			location: new URL("https://tools.example/charactersheet.html?id=character-2"),
			history: {replaceState: jest.fn()},
		};
		const host = {
			_characterLoadGeneration: 0,
			_currentCharacterId: null,
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isCurrentCharacterNew: true,
			_isLevelUpBannerDismissed: true,
			_characterRepository: {
				isRescueMirrorEnabled: false,
				pGet: jest.fn(async () => ({id: "character-2", name: "Mira"})),
				getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.DM_READ_ONLY),
			},
			_selCharacter: {value: ""},
			_hubContext: null,
			_state: {
				clearCampaignSettingsOverlay: jest.fn(),
				loadFromJson: jest.fn(),
				setCampaignSettingsOverlay: jest.fn(),
				getBackgroundTheme: jest.fn(() => "default"),
			},
			_reconcilePersistedCharacter: jest.fn(canonical => ({chosen: canonical, mirrorWon: false})),
			_reconcileClassFeatures: jest.fn(() => ({added: 0, backfilled: 0})),
			_ensureLinguisticsSkillIfNeeded: jest.fn(),
			_renderCharacter: jest.fn(),
			_applyBackgroundTheme: jest.fn(),
			_updateThemePickerSelection: jest.fn(),
			_attachHubRealtime: jest.fn(),
			_detachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(async () => {}),
			},
			_layout: null,
			_playMode: null,
		};

		try {
			await expect(CharacterSheetPage.prototype._pLoadCharacter.call(host, "character-2")).resolves.toBe(true);
			expect(host._selCharacter.value).toBe("character-2");
			expect(host._currentCharacterAccess).toBe(CHARACTER_ACCESS_MODES.DM_READ_ONLY);
			expect(host._campaign.resetCharacterScope).toHaveBeenCalled();
			expect(host._campaign.pRefreshCurrentCharacter).toHaveBeenCalled();
		} finally {
			globalThis.window = windowPrevious;
		}
	});

	it("adopts an imported character's canonical id in the URL and campaign controls", async () => {
		const windowPrevious = globalThis.window;
		const windowMock = {
			location: new URL("https://tools.example/charactersheet.html?id=previous&hubCampaign=campaign-1"),
			history: {replaceState: jest.fn()},
		};
		globalThis.window = windowMock;
		const repository = makeRepository();
		repository.pUpsert.mockResolvedValueOnce({id: "server-import", name: "Imported"});
		const host = {
			_currentCharacterId: "previous",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isCurrentCharacterNew: false,
			_characterLoadGeneration: 0,
			_saveCurrentCharacter: jest.fn(async () => true),
			_characterRepository: repository,
			_state: {
				loadFromJson: jest.fn(),
			},
			_detachHubRealtime: jest.fn(),
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_pLoadCharacters: jest.fn(async () => {}),
			_pRefreshPersistedCharacterUi: CharacterSheetPage.prototype._pRefreshPersistedCharacterUi,
			_syncCurrentCharacterDropdownOption: CharacterSheetPage.prototype._syncCurrentCharacterDropdownOption,
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_selCharacter: {value: ""},
			_attachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(async () => {}),
			},
		};

		try {
			await expect(CharacterSheetPage.prototype.addCharacter.call(host, {
				toJson: () => ({name: "Imported"}),
			})).resolves.toBe(true);
		} finally {
			globalThis.window = windowPrevious;
		}

		expect(host._currentCharacterId).toBe("server-import");
		expect(windowMock.history.replaceState).toHaveBeenCalledWith(
			{},
			"",
			expect.objectContaining({search: "?id=server-import&hubCampaign=campaign-1"}),
		);
		expect(host._campaign.resetCharacterScope).toHaveBeenCalled();
		expect(host._campaign.pRefreshCurrentCharacter).toHaveBeenCalled();
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-import"});
	});

	it("keeps an imported character successful when post-create UI refreshes fail", async () => {
		const windowPrevious = globalThis.window;
		const windowMock = {
			location: new URL("https://tools.example/charactersheet.html?id=previous&hubCampaign=campaign-1"),
			history: {replaceState: jest.fn()},
		};
		globalThis.window = windowMock;
		const repository = makeRepository();
		repository.pUpsert.mockResolvedValueOnce({id: "server-import", name: "Imported"});
		const toastPrevious = globalThis.JqueryUtil.doToast;
		const doToast = jest.fn();
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		globalThis.JqueryUtil.doToast = doToast;
		const host = {
			_currentCharacterId: "previous",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isCurrentCharacterNew: false,
			_characterLoadGeneration: 0,
			_saveCurrentCharacter: jest.fn(async () => true),
			_characterRepository: repository,
			_state: {
				loadFromJson: jest.fn(),
				toJson: () => ({id: "server-import", name: "Imported"}),
			},
			_detachHubRealtime: jest.fn(),
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_pLoadCharacters: jest.fn(async () => { throw new Error("roster unavailable"); }),
			_pRefreshPersistedCharacterUi: CharacterSheetPage.prototype._pRefreshPersistedCharacterUi,
			_syncCurrentCharacterDropdownOption: CharacterSheetPage.prototype._syncCurrentCharacterDropdownOption,
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_selCharacter: {value: "", options: []},
			_attachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(async () => { throw new Error("campaign controls unavailable"); }),
			},
		};

		try {
			await expect(CharacterSheetPage.prototype.addCharacter.call(host, {
				toJson: () => ({name: "Imported"}),
			})).resolves.toBe(true);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(doToast).toHaveBeenCalledWith(expect.objectContaining({
				type: "warning",
				content: expect.stringContaining("Character saved"),
			}));
		} finally {
			warn.mockRestore();
			globalThis.window = windowPrevious;
			globalThis.JqueryUtil.doToast = toastPrevious;
		}

		expect(host._currentCharacterId).toBe("server-import");
		expect(host._isCurrentCharacterNew).toBe(false);
		expect(host._selCharacter.value).toBe("server-import");
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-import"});
	});

	it("restores campaign controls after a duplicate save genuinely fails", async () => {
		const sourceData = {id: "source-id", name: "Source"};
		const host = {
			_currentCharacterId: "source-id",
			_currentCharacterAccess: CHARACTER_ACCESS_MODES.OWNER,
			_isCurrentCharacterNew: false,
			_characterLoadGeneration: 0,
			_saveCurrentCharacter: jest.fn()
				.mockResolvedValueOnce(true)
				.mockResolvedValueOnce(false),
			_characterRepository: {
				getCharacterAccess: jest.fn(() => CHARACTER_ACCESS_MODES.OWNER),
			},
			_state: {
				toJson: jest.fn(() => structuredClone(sourceData)),
				loadFromJson: jest.fn(),
			},
			_detachHubRealtime: jest.fn(),
			_clearLastHpChange: jest.fn(),
			_reconcileClassFeatures: jest.fn(),
			_renderCharacter: jest.fn(),
			_pLoadCharacters: jest.fn(async () => {}),
			_pRefreshPersistedCharacterUi: CharacterSheetPage.prototype._pRefreshPersistedCharacterUi,
			_syncCurrentCharacterDropdownOption: CharacterSheetPage.prototype._syncCurrentCharacterDropdownOption,
			_getCharacterDropdownLabel: CharacterSheetPage.prototype._getCharacterDropdownLabel,
			_selCharacter: {value: "source-id"},
			_attachHubRealtime: jest.fn(),
			_campaign: {
				resetCharacterScope: jest.fn(),
				pRefreshCurrentCharacter: jest.fn(async () => {}),
			},
		};

		await CharacterSheetPage.prototype._onDuplicateCharacter.call(host);

		expect(host._currentCharacterId).toBe("source-id");
		expect(host._state.loadFromJson).toHaveBeenLastCalledWith(sourceData);
		expect(host._campaign.pRefreshCurrentCharacter).toHaveBeenCalledTimes(1);
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "source-id"});
	});

	it("tears down on terminal pagehide and resumes the same subscription after BFCache restoration", async () => {
		const listeners = {};
		const windowPrev = globalThis.window;
		globalThis.window = {
			addEventListener: jest.fn((type, listener) => listeners[type] = listener),
		};
		const host = {
			_detachHubRealtime: jest.fn(),
			_hubRealtime: {
				resume: jest.fn(),
				suspend: jest.fn(),
			},
		};
		try {
			CharacterSheetPage.prototype._initHubRealtimeTeardown.call(host);
			listeners.pagehide({persisted: true});
			listeners.pageshow({persisted: true});

			// The session may have been signed out or switched while the page was frozen, so the
			// private stream must not reopen until the account has been revalidated (ADR 0013).
			expect(host._hubRealtime.resume).not.toHaveBeenCalled();
			await Promise.resolve();
			await Promise.resolve();

			listeners.pagehide({persisted: false});
		} finally {
			globalThis.window = windowPrev;
		}

		expect(host._hubRealtime.suspend).toHaveBeenCalledTimes(1);
		expect(host._hubRealtime.resume).toHaveBeenCalledTimes(1);
		expect(host._detachHubRealtime).toHaveBeenCalledTimes(1);
	});
});
