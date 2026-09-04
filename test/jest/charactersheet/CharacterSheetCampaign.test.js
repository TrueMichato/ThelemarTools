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

function getControl ({
	saveResult = true,
	createResult = {character: {id: "cloud-1"}},
	currentCampaignId = "campaign-1",
} = {}) {
	const page = {
		_currentCharacterId: "local-1",
		_saveCurrentCharacter: jest.fn(async () => saveResult),
		_characterRepository: {
			pReleaseLease: jest.fn(async () => ({released: true})),
		},
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

describe("Character Sheet campaign control", () => {
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
		});
		expect(control._fnNavigate).toHaveBeenCalledWith("charactersheet.html?id=clone-1&hubCampaign=campaign-2");
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
		control._movePreview = {campaignId: "campaign-2", report: {}};

		await control._pMoveCloudCharacter({campaignId: "campaign-2", isDetached: false});

		expect(page._saveCurrentCharacter).toHaveBeenCalledWith({isInteractiveConflict: false});
		expect(page._characterRepository.pReleaseLease).toHaveBeenCalledWith({characterId: "cloud-source"});
		expect(page._detachHubRealtime).toHaveBeenCalledTimes(1);
		expect(control._api.pMoveCharacter).toHaveBeenCalledWith({
			characterId: "cloud-source",
			campaignId: "campaign-2",
			idempotencyKey: expect.any(String),
		});
		expect(control._fnNavigate).toHaveBeenCalledWith("charactersheet.html?id=cloud-source&hubCampaign=campaign-2");
	});

	it("restores the source subscription when a campaign move is definitely rejected", async () => {
		const {control, page} = getControl();
		page._currentCharacterId = "cloud-source";
		control._currentCharacter = {id: "cloud-source", campaignId: "campaign-1", data: {name: "Mira"}};
		control._movePreview = {campaignId: "campaign-2", report: {}};
		control._api.pMoveCharacter.mockRejectedValueOnce(new HubApiError({code: "CHARACTER_BUSY", status: 409}));

		await control._pMoveCloudCharacter({campaignId: "campaign-2", isDetached: false});

		expect(page._detachHubRealtime).toHaveBeenCalledTimes(1);
		expect(page._attachHubRealtime).toHaveBeenCalledWith({characterId: "cloud-source"});
		expect(control._fnNavigate).not.toHaveBeenCalled();
	});

	it.each([
		new HubApiError({code: "NETWORK_UNAVAILABLE", status: 0}),
		new HubApiError({code: "AUTH_REQUIRED", status: 401}),
	])("does not restore the source subscription after an ambiguous or access-loss failure", async error => {
		const {control, page} = getControl();
		page._currentCharacterId = "cloud-source";
		control._currentCharacter = {id: "cloud-source", campaignId: "campaign-1", data: {name: "Mira"}};
		control._movePreview = {campaignId: "campaign-2", report: {}};
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
