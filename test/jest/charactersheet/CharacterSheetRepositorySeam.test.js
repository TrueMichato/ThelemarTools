import "./setup.js";
import {jest} from "@jest/globals";
import {HubCharacterMemoryAuthority, HubCharacterRepository} from "../../../js/hub/hub-character-repository.js";
import {CHARACTER_ACCESS_MODES} from "../../../js/hub/hub-character-view.js";

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
		};

		CharacterSheetPage.prototype._updateCharacterDropdown.call(host);

		expect(select.options.map(option => [option.value, option.textContent])).toEqual([
			["", "Create New Character"],
			["cloud-a", "After — Fighter 1"],
			["cloud-b", "Other — Wizard 2"],
		]);
		expect(select.value).toBe("cloud-a");
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
			_isCurrentCharacterNew: true,
			_state: {toJson: () => ({name: "Cloud Character"})},
			_updateSaveIndicator: jest.fn(),
			_writeActiveCharacterMirror: jest.fn(),
			_clearActiveCharacterMirror: jest.fn(),
			_getNextSavedAt: CharacterSheetPage.prototype._getNextSavedAt,
			_lastSavedAt: 0,
			_pLoadCharacters: jest.fn(async () => calls.push("refresh")),
			_selCharacter: {value: ""},
			_attachHubRealtime: jest.fn(() => calls.push("attach")),
			_campaign: {pRefreshCurrentCharacter: jest.fn(async () => calls.push("campaign"))},
		};

		await expect(CharacterSheetPage.prototype._saveCurrentCharacter.call(host)).resolves.toBe(true);
		expect(host._currentCharacterId).toBe("server-id");
		expect(host._isCurrentCharacterNew).toBe(false);
		expect(host._selCharacter.value).toBe("server-id");
		expect(host._attachHubRealtime).toHaveBeenCalledWith({characterId: "server-id"});
		expect(calls).toEqual(["upsert", "refresh", "campaign", "attach"]);
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

	it("disables mutation controls before a DM can edit a read-only sheet", () => {
		const makeControl = ({id = "", disabled = false} = {}) => ({
			id,
			disabled,
			dataset: {},
			setAttribute: jest.fn(),
			removeAttribute: jest.fn(),
			getAttribute: jest.fn(() => null),
		});
		const edit = makeControl();
		const characterSelect = makeControl({id: "charsheet-sel-character"});
		const exportButton = makeControl({id: "charsheet-btn-export"});
		const root = {
			classList: {toggle: jest.fn()},
			getAttribute: jest.fn(() => null),
			setAttribute: jest.fn(),
			querySelectorAll: jest.fn(() => [edit, characterSelect, exportButton]),
		};
		const documentPrevious = globalThis.document;
		globalThis.document = {querySelector: () => root};
		const host = {
			_currentCharacterAccess: "dm_readonly",
			_updateSaveIndicator: jest.fn(),
		};
		try {
			CharacterSheetPage.prototype._applyCharacterAccessMode.call(host);
		} finally {
			globalThis.document = documentPrevious;
		}

		expect(edit.disabled).toBe(true);
		expect(edit.setAttribute).toHaveBeenCalledWith("aria-disabled", "true");
		expect(characterSelect.disabled).toBe(false);
		expect(exportButton.disabled).toBe(false);
		expect(host._updateSaveIndicator).toHaveBeenCalledWith("readonly");
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
