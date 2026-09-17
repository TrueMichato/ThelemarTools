import "./setup.js";
import {jest} from "@jest/globals";
import {
	CharacterSheetCampaign,
	getCampaignCharacterUrl,
	getCampaignCompatibilityReport,
	getCampaignControlErrorMessage,
	getCloudCharacterUrl,
	getCloudCharacterData,
	getCampaignPreparedCharacterData,
	getEligibleCharacterCampaigns,
} from "../../../js/charactersheet/charactersheet-campaign.js";
import {HubApiError} from "../../../js/hub/hub-api-client.js";

const makeDeferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {promise, resolve, reject};
};

function getControl ({
	saveResult = true,
	createResult = {character: {id: "cloud-1"}},
	currentCampaignId = "campaign-1",
} = {}) {
	const page = {
		_currentCharacterId: "local-1",
		_characterLoadGeneration: 0,
		_saveCurrentCharacter: jest.fn(async () => saveResult),
		_characterRepository: {
			pReleaseLease: jest.fn(async () => ({released: true})),
		},
		isCurrentCharacterReadOnly: jest.fn(() => false),
		_canRestoreHubRealtimeAfterError: jest.fn(error => ![
			"AUTH_REQUIRED",
			"CAMPAIGN_NOT_FOUND",
			"CHARACTER_CAMPAIGN_MISMATCH",
			"CHARACTER_NOT_FOUND",
			"FORBIDDEN",
		].includes(error?.code)),
		_attachHubRealtime: jest.fn(),
		_detachHubRealtime: jest.fn(),
		_state: {
			toJson: () => ({
				id: "local-1",
				_savedAt: 123,
				name: "Mira",
				hp: {current: 12},
			}),
		},
	};
	const control = Object.assign(Object.create(CharacterSheetCampaign.prototype), {
		_page: page,
		_api: {
			pCreateCharacter: jest.fn(async () => createResult),
			pGetCampaignContext: jest.fn(async ({campaignId}) => ({
				campaignId,
				rulesVersion: {
					id: `rules-${campaignId}`,
					version: 1,
					schemaVersion: 1,
					catalogVersion: 1,
					rules: {thelemar_carryWeight: false},
				},
				brewBundle: null,
			})),
			pCloneCharacter: jest.fn(async () => createResult),
			pGetCampaignCompatibility: jest.fn(async ({campaignId}) => ({
				campaignId,
				rulesVersion: {
					id: `rules-${campaignId}`,
					version: 1,
					rules: campaignId === "campaign-1" ? {edition: "2014"} : {edition: "2024"},
				},
				brewBundle: campaignId === "campaign-1"
					? {id: "brew-1", version: 2, contentHash: "source", documentCount: 3}
					: {id: "brew-2", version: 1, contentHash: "destination", documentCount: 1},
			})),
			pMoveCharacter: jest.fn(async ({characterId, campaignId}) => ({
				character: {id: characterId, campaignId},
			})),
		},
		_campaignId: currentCampaignId,
		_isDetachedCloudCharacter: false,
		_campaigns: [
			{id: "campaign-1", name: "Source"},
			{id: "campaign-2", name: "Destination"},
		],
		_currentCharacter: {
			id: "local-1",
			campaignId: currentCampaignId,
			data: {name: "Mira"},
		},
		_currentCampaign: currentCampaignId ? {id: currentCampaignId, name: "Source"} : null,
		_movePreview: null,
		_isMovePreviewLoading: false,
		_isBusy: false,
		_feedback: null,
		_pendingCommand: null,
		_fnNavigate: jest.fn(),
		render: jest.fn(),
	});
	return {control, page};
}

function setCurrentMovePreview ({control, page, campaignId = "campaign-2", rulesVersionId = null, report = {}}) {
	control._movePreview = {
		characterId: page._currentCharacterId,
		characterLoadGeneration: page._characterLoadGeneration,
		sourceCampaignId: control._currentCharacter?.campaignId || null,
		campaignId,
		report,
		rulesVersionId,
	};
}

describe("Character Sheet campaign control", () => {
	it("does not load owner-only sharing controls for a DM read-only sheet", async () => {
		const control = Object.assign(Object.create(CharacterSheetCampaign.prototype), {
			_page: {
				_isHubCharacter: true,
				_currentCharacterId: "player-character",
				isCurrentCharacterReadOnly: () => true,
			},
			_currentCharacter: {id: "player-character", campaignId: "campaign-1"},
			_sharing: {pLoad: jest.fn()},
			render: jest.fn(),
		});

		await control.pRefreshSharing();

		expect(control._sharing).toBeNull();
	});

	it("describes DM truth as read-only instead of implying edits will sync", () => {
		const control = Object.assign(Object.create(CharacterSheetCampaign.prototype), {
			_isLoading: false,
			_currentCharacter: {id: "player-character", campaignId: "campaign-1"},
			_currentCampaign: {id: "campaign-1", name: "Ashen March"},
			_page: {
				_currentCharacterId: "player-character",
				_characterRepository: {hasPendingWrites: () => false},
				isCurrentCharacterReadOnly: () => true,
			},
		});

		expect(control._getDetail({isCloud: true}))
			.toBe("Read-only DM view · use campaign actions to make authorized changes");
	});

	it("reloads character-scoped campaign state and binds sharing writes to the loaded character", async () => {
		const page = {
			_isHubCharacter: true,
			_currentCharacterId: "character-a",
			isCurrentCharacterReadOnly: () => false,
		};
		const policy = {
			policy: {version: 1, preset: "table", overrides: {}},
			projectionRevision: 1,
			preview: null,
		};
		const api = {
			pGetSession: jest.fn(async () => ({signedIn: true})),
			pListCampaigns: jest.fn(async () => [{id: "campaign-1", name: "Ashen March"}]),
			pGetCharacter: jest.fn(async ({characterId}) => ({id: characterId, campaignId: "campaign-1"})),
			pGetProjectionPolicy: jest.fn(async () => policy),
			pSetProjectionPolicy: jest.fn(async ({characterId}) => ({...policy, characterId})),
		};
		const control = Object.assign(Object.create(CharacterSheetCampaign.prototype), {
			_page: page,
			_api: api,
			_root: null,
			_isInitialized: true,
			_refreshGeneration: 0,
			_session: null,
			_campaigns: [],
			_currentCharacter: null,
			_currentCampaign: null,
			_isLoading: false,
			_feedback: null,
			_sharing: null,
			render: jest.fn(),
		});

		await control.pRefreshCurrentCharacter();
		const sharingA = control._sharing;
		page._currentCharacterId = "character-b";
		await control.pRefreshCurrentCharacter();

		expect(control._sharing).not.toBe(sharingA);
		expect(api.pGetProjectionPolicy.mock.calls.map(([{characterId}]) => characterId))
			.toEqual(["character-a", "character-b"]);

		await sharingA.pSave();
		expect(api.pSetProjectionPolicy).toHaveBeenCalledWith(expect.objectContaining({
			characterId: "character-a",
		}));
	});

	it("uses the full source-edition catalog when deciding whether to show policy warnings", () => {
		const root = {append: jest.fn()};
		const control = Object.assign(Object.create(CharacterSheetCampaign.prototype), {
			_root: root,
			_page: {
				_currentCharacterId: "character-1",
				_state: {
					toJson: () => ({
						classes: [{name: "Fighter", source: "PHB", level: 1}],
						spellcasting: {spellsKnown: [{name: "Absorb Elements", source: "XGE"}]},
					}),
				},
				_hubContext: {
					rulesVersion: {
						id: "rules-1",
						contentPolicy: {version: 1, sources: [], species: [], editions: ["2014", "2024"]},
					},
					contentCatalog: {
						sources: ["PHB", "XGE"],
						species: [],
						sourceEditions: {PHB: "2014", XGE: "2014"},
					},
				},
			},
		});

		expect(() => control._renderContentPolicyWarnings()).not.toThrow();
		expect(root.append).not.toHaveBeenCalled();
	});

	it("renders default-policy warnings without an active rules version", () => {
		const documentPrev = globalThis.document;
		globalThis.document = {
			createElement: () => ({
				append: jest.fn(),
				setAttribute: jest.fn(),
				className: "",
				textContent: "",
			}),
		};
		const root = {append: jest.fn()};
		const control = Object.assign(Object.create(CharacterSheetCampaign.prototype), {
			_root: root,
			_page: {
				_currentCharacterId: "character-1",
				_state: {
					toJson: () => ({
						feats: [{name: "Personal feat", source: "PERSONAL", edition: "classic"}],
					}),
				},
				_hubContext: {
					rulesVersion: null,
					contentCatalog: {
						sources: ["PHB"],
						species: [],
						sourceEditions: {PHB: "2014"},
					},
				},
			},
		});

		try {
			expect(() => control._renderContentPolicyWarnings()).not.toThrow();
			expect(root.append).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.document = documentPrev;
		}
	});

	it("offers only active campaigns whose role may own a character", () => {
		const campaigns = [
			{id: "spectator", name: "Spectator", role: "spectator", status: "active"},
			{id: "archived", name: "Archived", role: "player", status: "archived"},
			{id: "b", name: "Bravo", role: "player", status: "active"},
			{id: "a", name: "Alpha", role: "dm", status: "active"},
		];

		expect(getEligibleCharacterCampaigns(campaigns, {excludeCampaignId: "b"})).toEqual([
			expect.objectContaining({id: "a"}),
		]);
	});

	it("removes local persistence metadata without mutating the local character", () => {
		const local = {id: "local-1", _savedAt: 12, name: "Mira", hp: {current: 8}};

		expect(getCloudCharacterData(local)).toEqual({name: "Mira", hp: {current: 8}});
		expect(local).toEqual({id: "local-1", _savedAt: 12, name: "Mira", hp: {current: 8}});
	});

	it("builds a canonical campaign Character Sheet URL", () => {
		expect(getCampaignCharacterUrl({campaignId: "camp one", characterId: "char/two"}))
			.toBe("charactersheet.html?id=char%2Ftwo&hubCampaign=camp%20one");
		expect(getCloudCharacterUrl({characterId: "char/two"}))
			.toBe("charactersheet.html?id=char%2Ftwo&hubCharacter=1");
	});

	it("saves locally, creates a separate cloud copy, and opens its canonical URL", async () => {
		const {control, page} = getControl();

		await control._pCopyLocalCharacter({campaignId: "campaign-1"});

		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(1);
		expect(control._api.pCreateCharacter).toHaveBeenCalledWith(expect.objectContaining({
			clientImportId: "local-1",
			campaignId: "campaign-1",
			idempotencyKey: expect.any(String),
			rulesVersionId: "rules-campaign-1",
		}));
		const submitted = control._api.pCreateCharacter.mock.calls[0][0].data;
		expect(submitted).toMatchObject({
			name: "Mira",
			hp: {current: 12},
			carry: {basis: {kind: "campaign", rulesVersionId: "rules-campaign-1"}},
		});
		expect(control._fnNavigate).toHaveBeenCalledWith("charactersheet.html?id=cloud-1&hubCampaign=campaign-1");
		expect(control._feedback).toEqual({
			type: "success",
			text: "Cloud copy created. Your local original is unchanged.",
		});
	});

	it("prepares a destination-pinned copy without mutating the local document", () => {
		const local = {name: "Mira", settings: {thelemar_carryWeight: true}};
		const prepared = getCampaignPreparedCharacterData({
			data: local,
			context: {
				rulesVersion: {
					id: "rules-destination",
					version: 1,
					schemaVersion: 1,
					catalogVersion: 1,
					rules: {thelemar_carryWeight: false},
				},
				brewBundle: {contentHash: "brew-destination"},
			},
		});
		expect(prepared.carry.basis).toMatchObject({
			kind: "campaign",
			rulesVersionId: "rules-destination",
			brewBundleHash: "brew-destination",
		});
		expect(prepared.settings.thelemar_carryWeight).toBe(true);
		expect(local).toEqual({name: "Mira", settings: {thelemar_carryWeight: true}});
	});

	it("does not upload when the local save fails", async () => {
		const {control} = getControl({saveResult: false});

		await control._pCopyLocalCharacter({campaignId: "campaign-1"});

		expect(control._api.pCreateCharacter).not.toHaveBeenCalled();
		expect(control._fnNavigate).not.toHaveBeenCalled();
		expect(control._feedback).toEqual(expect.objectContaining({
			type: "error",
			text: expect.stringContaining("no cloud copy was created"),
		}));
	});

	it("does not continue a local copy after a stale save succeeds", async () => {
		const save = makeDeferred();
		const {control, page} = getControl();
		page._saveCurrentCharacter.mockReturnValue(save.promise);

		const pending = control._pCopyLocalCharacter({campaignId: "campaign-1"});
		page._currentCharacterId = "local-2";
		page._characterLoadGeneration++;
		page._state.toJson = () => ({id: "local-2", name: "Replacement"});
		save.resolve(true);
		await pending;

		expect(control._api.pGetCampaignContext).not.toHaveBeenCalled();
		expect(control._api.pCreateCharacter).not.toHaveBeenCalled();
		expect(control._fnNavigate).not.toHaveBeenCalled();
	});

	it("keeps a committed local copy bound to its originating document after a selector switch", async () => {
		const create = makeDeferred();
		const {control, page} = getControl();
		control._api.pCreateCharacter.mockReturnValue(create.promise);

		const pending = control._pCopyLocalCharacter({campaignId: "campaign-1"});
		await Promise.resolve();
		await Promise.resolve();
		expect(control._api.pCreateCharacter).toHaveBeenCalledWith(expect.objectContaining({
			clientImportId: "local-1",
			data: expect.objectContaining({name: "Mira"}),
		}));
		page._currentCharacterId = "local-2";
		page._characterLoadGeneration++;
		page._state.toJson = () => ({id: "local-2", name: "Replacement"});
		create.resolve({character: {id: "cloud-1"}});
		await pending;

		expect(control._api.pCreateCharacter.mock.calls[0][0].data).not.toEqual(expect.objectContaining({name: "Replacement"}));
		expect(control._fnNavigate).not.toHaveBeenCalled();
		expect(control._feedback).not.toEqual(expect.objectContaining({type: "success"}));
	});

	it("reuses the same idempotency key when a local copy is retried", async () => {
		const {control} = getControl();
		control._api.pCreateCharacter
			.mockRejectedValueOnce(new HubApiError({code: "REQUEST_FAILED", status: 503}))
			.mockResolvedValueOnce({character: {id: "cloud-1"}});

		await control._pCopyLocalCharacter({campaignId: "campaign-1"});
		await control._pCopyLocalCharacter({campaignId: "campaign-1"});

		const [first, second] = control._api.pCreateCharacter.mock.calls.map(([request]) => request.idempotencyKey);
		expect(second).toBe(first);
	});

	it("saves the source cloud character before cloning it elsewhere", async () => {
		const {control, page} = getControl({createResult: {character: {id: "clone-1"}}});
		page._currentCharacterId = "cloud-source";

		await control._pCloneCloudCharacter({campaignId: "campaign-2"});

		expect(page._saveCurrentCharacter).toHaveBeenCalledTimes(1);
		expect(control._api.pCloneCharacter).toHaveBeenCalledWith({
			characterId: "cloud-source",
			campaignId: "campaign-2",
			idempotencyKey: expect.any(String),
			rulesVersionId: "rules-campaign-2",
		});
		expect(control._fnNavigate).toHaveBeenCalledWith("charactersheet.html?id=clone-1&hubCampaign=campaign-2");
	});

	it("does not continue a cloud clone after its compatibility request becomes stale", async () => {
		const compatibility = makeDeferred();
		const {control, page} = getControl({createResult: {character: {id: "clone-1"}}});
		page._currentCharacterId = "cloud-source";
		control._api.pGetCampaignCompatibility.mockReturnValue(compatibility.promise);

		const pending = control._pCloneCloudCharacter({campaignId: "campaign-2"});
		await Promise.resolve();
		page._currentCharacterId = "cloud-replacement";
		page._characterLoadGeneration++;
		compatibility.resolve({campaignId: "campaign-2", rulesVersion: {id: "rules-campaign-2"}});
		await pending;

		expect(control._api.pCloneCharacter).not.toHaveBeenCalled();
		expect(control._fnNavigate).not.toHaveBeenCalled();
	});

	it("does not navigate when a clone commits after its originating character was replaced", async () => {
		const clone = makeDeferred();
		const {control, page} = getControl();
		page._currentCharacterId = "cloud-source";
		control._api.pCloneCharacter.mockReturnValue(clone.promise);

		const pending = control._pCloneCloudCharacter({campaignId: "campaign-2"});
		await Promise.resolve();
		await Promise.resolve();
		expect(control._api.pCloneCharacter).toHaveBeenCalledWith(expect.objectContaining({
			characterId: "cloud-source",
		}));
		page._currentCharacterId = "cloud-replacement";
		page._characterLoadGeneration++;
		clone.resolve({character: {id: "clone-1"}});
		await pending;

		expect(control._fnNavigate).not.toHaveBeenCalled();
		expect(control._feedback).not.toEqual(expect.objectContaining({type: "success"}));
	});

	it("summarizes rule and homebrew differences without exposing documents", () => {
		expect(getCampaignCompatibilityReport({
			source: {
				rulesVersion: {rules: {edition: "2014"}},
				brewBundle: {id: "brew-1", version: 2, contentHash: "source", documentCount: 3},
			},
			target: {
				rulesVersion: {rules: {edition: "2024"}},
				brewBundle: {id: "brew-2", version: 1, contentHash: "destination", documentCount: 1},
			},
		})).toEqual({
			ruleChanges: ["Edition"],
			isRulesSame: false,
			isBrewSame: false,
			sourceBrew: "Version 2 (3 documents)",
			targetBrew: "Version 1 (1 documents)",
		});
	});

	it("prepares a compatibility review before enabling a move", async () => {
		const {control} = getControl();
		await control._pPrepareMove({sourceCampaignId: "campaign-1", campaignId: "campaign-2"});

		expect(control._api.pGetCampaignCompatibility).toHaveBeenCalledTimes(2);
		expect(control._movePreview).toEqual(expect.objectContaining({
			campaignId: "campaign-2",
			report: expect.objectContaining({isRulesSame: false, isBrewSame: false}),
		}));
	});

	it("does not move a campaign character before a compatibility review", async () => {
		const {control} = getControl();

		await control._pMoveCloudCharacter({campaignId: "campaign-2", isDetached: false});

		expect(control._api.pMoveCharacter).not.toHaveBeenCalled();
	});

	it("saves, releases its own lease, and explicitly moves a confirmed character", async () => {
		const {control, page} = getControl();
		page._currentCharacterId = "cloud-source";
		control._currentCharacter = {id: "cloud-source", campaignId: "campaign-1", data: {name: "Mira"}};
		setCurrentMovePreview({control, page, rulesVersionId: "rules-campaign-2"});

		await control._pMoveCloudCharacter({campaignId: "campaign-2", isDetached: false});

		expect(page._saveCurrentCharacter).toHaveBeenCalledWith({isInteractiveConflict: false});
		expect(page._characterRepository.pReleaseLease).toHaveBeenCalledWith({characterId: "cloud-source"});
		expect(page._detachHubRealtime).toHaveBeenCalledTimes(1);
		expect(control._api.pMoveCharacter).toHaveBeenCalledWith({
			characterId: "cloud-source",
			campaignId: "campaign-2",
			rulesVersionId: "rules-campaign-2",
			idempotencyKey: expect.any(String),
		});
		expect(control._fnNavigate).toHaveBeenCalledWith("charactersheet.html?id=cloud-source&hubCampaign=campaign-2");
	});

	it("restores the source subscription when a campaign move is definitely rejected", async () => {
		const {control, page} = getControl();
		page._currentCharacterId = "cloud-source";
		control._currentCharacter = {id: "cloud-source", campaignId: "campaign-1", data: {name: "Mira"}};
		setCurrentMovePreview({control, page});
		control._api.pMoveCharacter.mockRejectedValueOnce(new HubApiError({code: "CHARACTER_BUSY", status: 409}));

		await control._pMoveCloudCharacter({campaignId: "campaign-2", isDetached: false});

		expect(page._detachHubRealtime).toHaveBeenCalledTimes(1);
		expect(page._attachHubRealtime).toHaveBeenCalledWith({characterId: "cloud-source"});
		expect(control._fnNavigate).not.toHaveBeenCalled();
	});

	it("does not detach the newly selected character when the source save settles after a switch", async () => {
		const {control, page} = getControl();
		const save = makeDeferred();
		page._currentCharacterId = "cloud-source";
		page._saveCurrentCharacter.mockImplementationOnce(() => save.promise);
		control._currentCharacter = {id: "cloud-source", campaignId: "campaign-1", data: {name: "Mira"}};
		setCurrentMovePreview({control, page, rulesVersionId: "rules-campaign-2"});
		control._api.pMoveCharacter.mockRejectedValueOnce(new HubApiError({code: "CHARACTER_BUSY", status: 409}));

		const pending = control._pMoveCloudCharacter({campaignId: "campaign-2", isDetached: false});
		await Promise.resolve();
		page._currentCharacterId = "cloud-other";
		save.resolve(true);
		await pending;

		expect(page._characterRepository.pReleaseLease).not.toHaveBeenCalled();
		expect(page._detachHubRealtime).not.toHaveBeenCalled();
		expect(control._api.pMoveCharacter).not.toHaveBeenCalled();
		expect(page._attachHubRealtime).not.toHaveBeenCalled();
		expect(control._fnNavigate).not.toHaveBeenCalled();
		expect(page._currentCharacterId).toBe("cloud-other");
	});

	it("does not resume a stale move after navigating from A to B and back to A", async () => {
		const {control, page} = getControl();
		const save = makeDeferred();
		page._currentCharacterId = "cloud-source";
		page._characterLoadGeneration = 7;
		page._saveCurrentCharacter.mockImplementationOnce(() => save.promise);
		control._currentCharacter = {id: "cloud-source", campaignId: "campaign-1", data: {name: "Mira"}};
		setCurrentMovePreview({control, page, rulesVersionId: "rules-campaign-2"});

		const pending = control._pMoveCloudCharacter({campaignId: "campaign-2", isDetached: false});
		await Promise.resolve();
		page._currentCharacterId = "cloud-other";
		page._characterLoadGeneration++;
		page._currentCharacterId = "cloud-source";
		page._characterLoadGeneration++;
		save.resolve(true);
		await pending;

		expect(page._characterRepository.pReleaseLease).not.toHaveBeenCalled();
		expect(page._detachHubRealtime).not.toHaveBeenCalled();
		expect(control._api.pMoveCharacter).not.toHaveBeenCalled();
		expect(page._attachHubRealtime).not.toHaveBeenCalled();
		expect(control._fnNavigate).not.toHaveBeenCalled();
	});

	it("does not bind a compatibility preview to a later load of the same character", async () => {
		const {control, page} = getControl();
		const sourceCompatibility = makeDeferred();
		const targetCompatibility = makeDeferred();
		page._currentCharacterId = "cloud-source";
		page._characterLoadGeneration = 3;
		control._api.pGetCampaignCompatibility
			.mockImplementationOnce(() => sourceCompatibility.promise)
			.mockImplementationOnce(() => targetCompatibility.promise);

		const pending = control._pPrepareMove({sourceCampaignId: "campaign-1", campaignId: "campaign-2"});
		await Promise.resolve();
		page._currentCharacterId = "cloud-other";
		page._characterLoadGeneration++;
		page._currentCharacterId = "cloud-source";
		page._characterLoadGeneration++;
		sourceCompatibility.resolve({campaignId: "campaign-1", rulesVersion: null, brewBundle: null});
		targetCompatibility.resolve({campaignId: "campaign-2", rulesVersion: null, brewBundle: null});
		await pending;

		expect(control._movePreview).toBeNull();
	});

	it("does not show a compatibility error from an earlier load of the same character", async () => {
		const {control, page} = getControl();
		const sourceCompatibility = makeDeferred();
		const targetCompatibility = makeDeferred();
		page._currentCharacterId = "cloud-source";
		page._characterLoadGeneration = 3;
		control._api.pGetCampaignCompatibility
			.mockImplementationOnce(() => sourceCompatibility.promise)
			.mockImplementationOnce(() => targetCompatibility.promise);

		const pending = control._pPrepareMove({sourceCampaignId: "campaign-1", campaignId: "campaign-2"});
		await Promise.resolve();
		page._currentCharacterId = "cloud-other";
		page._characterLoadGeneration++;
		page._currentCharacterId = "cloud-source";
		page._characterLoadGeneration++;
		sourceCompatibility.reject(new Error("stale compatibility failure"));
		targetCompatibility.resolve({campaignId: "campaign-2", rulesVersion: null, brewBundle: null});
		await pending;

		expect(control._feedback).toBeNull();
	});

	it("clears a completed move preview when character scope changes", () => {
		const {control, page} = getControl();
		page._currentCharacterId = "cloud-source";
		page._characterLoadGeneration = 4;
		control._currentCharacter = {id: "cloud-source", campaignId: "campaign-1", data: {name: "Mira"}};
		control._selectedCampaignId = "campaign-2";
		setCurrentMovePreview({control, page, rulesVersionId: "rules-campaign-2"});

		control.resetCharacterScope();

		expect(control._movePreview).toBeNull();
		expect(control._selectedCampaignId).toBeNull();
	});

	it("does not restore the source subscription when a rejected move settles after a switch", async () => {
		const {control, page} = getControl();
		const move = makeDeferred();
		page._currentCharacterId = "cloud-source";
		control._currentCharacter = {id: "cloud-source", campaignId: "campaign-1", data: {name: "Mira"}};
		setCurrentMovePreview({control, page, rulesVersionId: "rules-campaign-2"});
		control._api.pMoveCharacter.mockImplementationOnce(() => move.promise);

		const pending = control._pMoveCloudCharacter({campaignId: "campaign-2", isDetached: false});
		await Promise.resolve();
		await Promise.resolve();
		page._currentCharacterId = "cloud-other";
		move.reject(new HubApiError({code: "CHARACTER_BUSY", status: 409}));
		await pending;

		expect(page._detachHubRealtime).toHaveBeenCalledTimes(1);
		expect(page._attachHubRealtime).not.toHaveBeenCalled();
		expect(control._fnNavigate).not.toHaveBeenCalled();
		expect(page._currentCharacterId).toBe("cloud-other");
	});

	it.each([
		new HubApiError({code: "NETWORK_UNAVAILABLE", status: 0}),
		new HubApiError({code: "AUTH_REQUIRED", status: 401}),
	])("does not restore the source subscription after an ambiguous or access-loss failure", async error => {
		const {control, page} = getControl();
		page._currentCharacterId = "cloud-source";
		control._currentCharacter = {id: "cloud-source", campaignId: "campaign-1", data: {name: "Mira"}};
		setCurrentMovePreview({control, page});
		control._api.pMoveCharacter.mockRejectedValueOnce(error);

		await control._pMoveCloudCharacter({campaignId: "campaign-2", isDetached: false});

		expect(page._detachHubRealtime).toHaveBeenCalledTimes(1);
		expect(page._attachHubRealtime).not.toHaveBeenCalled();
		expect(control._fnNavigate).not.toHaveBeenCalled();
	});

	it("attaches a detached cloud character without cloning it", async () => {
		const {control, page} = getControl({currentCampaignId: null});
		page._currentCharacterId = "cloud-detached";
		control._isDetachedCloudCharacter = true;
		control._currentCharacter = {id: "cloud-detached", campaignId: null, data: {name: "Mira"}};

		await control._pMoveCloudCharacter({campaignId: "campaign-2", isDetached: true});

		expect(control._api.pCloneCharacter).not.toHaveBeenCalled();
		expect(control._api.pMoveCharacter).toHaveBeenCalledWith({
			characterId: "cloud-detached",
			campaignId: "campaign-2",
			rulesVersionId: "rules-campaign-2",
			idempotencyKey: expect.any(String),
		});
		expect(control._fnNavigate).toHaveBeenCalledWith("charactersheet.html?id=cloud-detached&hubCampaign=campaign-2");
	});

	it("turns Hub failures into actionable, data-safety-focused messages", () => {
		expect(getCampaignControlErrorMessage(new HubApiError({code: "AUTH_REQUIRED", status: 401})))
			.toContain("sign-in has expired");
		expect(getCampaignControlErrorMessage(new HubApiError({code: "LEASE_HELD", status: 409})))
			.toContain("Another device");
		expect(getCampaignControlErrorMessage(Object.assign(new Error("conflict"), {
			code: "CHARACTER_CONFLICT",
			recovery: {conflicts: [{reason: "LEASE_HELD"}]},
		}))).toContain("Another device");
		expect(getCampaignControlErrorMessage(new Error("offline")))
			.toContain("character data is safe");
	});
});
