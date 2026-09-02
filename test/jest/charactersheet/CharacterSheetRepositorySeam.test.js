import "./setup.js";
import {jest} from "@jest/globals";
import {HubCharacterMemoryAuthority, HubCharacterRepository} from "../../../js/hub/hub-character-repository.js";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
let CharacterSheetPage;

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

describe("Character Sheet repository seam", () => {
	beforeAll(async () => {
		globalThis.window = globalThis.window || {addEventListener: () => {}, location: {search: "", href: "http://test/"}};
		globalThis.document = globalThis.document || {getElementById: () => null, querySelector: () => null, addEventListener: () => {}};
		CharacterSheetPage = (await import(`${REPO_ROOT}js/charactersheet/charactersheet.js`)).CharacterSheetPage;
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
			character: expect.objectContaining({
				id: "cloud-character",
				name: "Cloud Character",
				_savedAt: expect.any(Number),
			}),
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
		const repository = makeRepository();
		repository.pUpsert.mockResolvedValueOnce({id: "server-id", name: "Cloud Character"});
		const host = {
			_characterRepository: repository,
			_currentCharacterId: "temporary-id",
			_state: {toJson: () => ({name: "Cloud Character"})},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_lastSavedAt: 0,
			_attachHubRealtime: jest.fn(),
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
		expect(host._currentCharacterId).toBe("server-id");
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-id"});
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
		expect(host._state.setId).toHaveBeenCalledWith(host._currentCharacterId);
	});

	it("restores the previous subscription when a character switch cannot load", async () => {
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

		expect(host._detachHubRealtime).toHaveBeenCalledTimes(1);
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "character-1"});
	});

	it("tears down on unload and resumes the same subscription after BFCache restoration", () => {
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
			listeners.pagehide({persisted: false});
			listeners.unload();
		} finally {
			globalThis.window = windowPrev;
		}

		expect(host._hubRealtime.suspend).toHaveBeenCalledTimes(1);
		expect(host._hubRealtime.resume).toHaveBeenCalledTimes(1);
		expect(host._detachHubRealtime).toHaveBeenCalledTimes(2);
	});
});
