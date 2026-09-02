import "./setup.js";
import {jest} from "@jest/globals";
import {
	CharacterSheetPartyInventory,
	getPartyInventoryRecipients,
	getPartyInventoryTransferTargetId,
} from "../../../js/charactersheet/charactersheet-party-inventory.js";

describe("Character Sheet party inventory", () => {
	it("does nothing for local characters", async () => {
		const api = {
			pGetCharacterProjection: jest.fn(),
			pGetPartyInventory: jest.fn(),
		};
		const realtime = {on: jest.fn()};
		const partyInventory = new CharacterSheetPartyInventory({
			api,
			realtime,
			campaignId: null,
			repository: null,
		});

		await expect(partyInventory.pAttach({characterId: "local-character", generation: 1})).resolves.toBe(false);
		expect(api.pGetCharacterProjection).not.toHaveBeenCalled();
		expect(api.pGetPartyInventory).not.toHaveBeenCalled();
		expect(realtime.on).not.toHaveBeenCalled();
	});

	it("fences an owner lookup after the current character generation changes", async () => {
		let resolveProjection;
		const api = {
			pGetCharacterProjection: jest.fn(() => new Promise(resolve => {
				resolveProjection = resolve;
			})),
			pGetPartyInventory: jest.fn(),
		};
		let generation = 1;
		const partyInventory = new CharacterSheetPartyInventory({
			api,
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: input => input.generation === generation,
		});

		const attaching = partyInventory.pAttach({characterId: "character-1", generation: 1});
		generation = 2;
		resolveProjection({kind: "owner_truth"});

		await expect(attaching).resolves.toBe(false);
		expect(api.pGetPartyInventory).not.toHaveBeenCalled();
		expect(partyInventory._root).toBeNull();
	});

	it("does not let an older party fetch overwrite a newer response", async () => {
		let resolveOldParty;
		let resolveOldSnapshot;
		const api = {
			pGetPartyInventory: jest.fn()
				.mockImplementationOnce(() => new Promise(resolve => {
					resolveOldParty = resolve;
				}))
				.mockResolvedValueOnce({id: "party-1", revision: 2, inventory: [], currency: {}}),
			pGetCampaignSnapshot: jest.fn()
				.mockImplementationOnce(() => new Promise(resolve => {
					resolveOldSnapshot = resolve;
				}))
				.mockResolvedValueOnce({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				}),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			api,
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._decorateCharacterInventory = jest.fn();

		const older = partyInventory._pRefreshParty();
		await expect(partyInventory._pRefreshParty()).resolves.toBe(true);
		resolveOldParty({id: "party-1", revision: 1, inventory: [{id: "old"}], currency: {}});
		resolveOldSnapshot({
			membership: {role: "player"},
			characters: [{kind: "owner_truth", character: {id: "character-1"}}],
			roster: [],
		});
		await expect(older).resolves.toBe(false);

		expect(partyInventory._partyInventory.revision).toBe(2);
		expect(partyInventory._partyInventory.inventory).toEqual([]);
	});

	it("derives privacy-safe projected recipient labels and opaque picker tokens", () => {
		const recipients = getPartyInventoryRecipients({
			projections: [
				{
					kind: "peer_profile",
					id: "recipient-character",
					data: {identity: {name: "Mira"}, classes: [{name: "Fighter", level: 3}]},
				},
				{
					kind: "owner_truth",
					character: {id: "current-character", data: {name: "Rowan", classes: [{name: "Ranger", level: 3}]}},
				},
				{kind: "peer_profile", id: "hidden-character", data: {classes: []}},
			],
			roster: [
				{characterId: "recipient-character"},
				{characterId: "current-character"},
			],
			currentCharacterId: "current-character",
		});

		expect(recipients).toEqual([
			{id: "recipient-character", label: "Mira", summary: "Fighter 3"},
		]);
		expect(JSON.stringify(recipients)).not.toContain("hidden-character");
	});

	it("always targets the open character when a DM withdraws from the stash", () => {
		expect(getPartyInventoryTransferTargetId({
			sourceKind: "party_inventory",
			destinationKind: "character",
			activeCharacterId: "open-character",
			recipientId: "another-character",
			partyInventoryId: "party-inventory",
		})).toBe("open-character");
	});

	it("rejects an already-reserved transfer instead of abandoning its escrow", async () => {
		const api = {
			pResolveTransfer: jest.fn(async () => ({transfer: {status: "rejected"}})),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api,
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._draft = {
			transfer: {id: "transfer-1"},
			cancellationCommandId: "cancel-command-1",
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pCancelDraft()).resolves.toBe(true);

		expect(api.pResolveTransfer).toHaveBeenCalledWith({
			campaignId: "campaign-1",
			transferId: "transfer-1",
			decision: "reject",
			idempotencyKey: "cancel-command-1",
		});
		expect(partyInventory._pDrainRefresh).toHaveBeenCalledTimes(1);
		expect(partyInventory._isSubmitting).toBe(false);
		expect(partyInventory._draft).toBeNull();
	});

	it("re-enables controls after a successful reservation", async () => {
		const character = {
			inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
		};
		const api = {
			pProposeTransfer: jest.fn(async () => ({transfer: {id: "transfer-1", status: "reserved"}})),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api,
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
			fnToast: jest.fn(),
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "party_inventory",
			recipientId: null,
			commandId: "propose-command-1",
			resolutionCommandId: "resolve-command-1",
			cancellationCommandId: "cancel-command-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(api.pProposeTransfer).toHaveBeenCalledTimes(1);
		expect(partyInventory._isSubmitting).toBe(false);
		expect(partyInventory._draft).toBeNull();
		expect(partyInventory._announcement).toContain("Transfer reserved");
	});

	it("keeps a reserved draft recoverable when authoritative refresh fails", async () => {
		const character = {
			inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
		};
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pProposeTransfer: jest.fn(async () => ({transfer: {id: "transfer-1", status: "reserved"}})),
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnSaveCharacter: jest.fn(async () => true),
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};
		partyInventory._role = "player";
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "party_inventory",
			recipientId: null,
			commandId: "propose-command-1",
			resolutionCommandId: "resolve-command-1",
			cancellationCommandId: "cancel-command-1",
			transfer: null,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => false);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);

		expect(partyInventory._draft?.transfer).toEqual({id: "transfer-1", status: "reserved"});
		expect(partyInventory._error).toContain("could not be reached");
		expect(partyInventory._announcement).toBe("");
		expect(partyInventory._isSubmitting).toBe(false);
	});
});
