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

	it("preserves a reconciliation conflict when the party fetch settles last", async () => {
		let resolveParty;
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(() => new Promise(resolve => resolveParty = resolve)),
				pGetCampaignSnapshot: jest.fn(async () => ({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				})),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn(async () => ({status: "conflict"}))},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();

		const refreshingParty = partyInventory._pRefreshParty();
		await partyInventory._pReconcileCharacter();
		resolveParty({id: "party-1", inventory: [], currency: {}});
		await refreshingParty;

		expect(partyInventory._getVisibleError()).toEqual({
			source: "reconcile",
			message: expect.stringContaining("Saving is paused"),
		});
		expect(partyInventory._partyError).toBeNull();
	});

	it("preserves a failed authoritative adoption when reconciliation settles after the party fetch", async () => {
		let resolveReconcile;
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(async () => ({id: "party-1", inventory: [], currency: {}})),
				pGetCampaignSnapshot: jest.fn(async () => ({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				})),
			},
			campaignId: "campaign-1",
			repository: {
				pReconcileAuthoritativeCharacter: jest.fn(() => new Promise(resolve => resolveReconcile = resolve)),
			},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();

		const reconciling = partyInventory._pReconcileCharacter();
		await partyInventory._pRefreshParty();
		resolveReconcile({status: "failed"});
		await reconciling;

		expect(partyInventory._getVisibleError()).toEqual({
			source: "reconcile",
			message: expect.stringContaining("could not be applied"),
		});
	});

	it("clears only the error channel whose refresh recovered", async () => {
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(async () => ({id: "party-1", inventory: [], currency: {}})),
				pGetCampaignSnapshot: jest.fn(async () => ({
					membership: {role: "player"},
					characters: [{kind: "owner_truth", character: {id: "character-1"}}],
					roster: [],
				})),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn(async () => ({status: "unchanged"}))},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._error = "A transfer action failed.";
		partyInventory._partyError = "The stash fetch failed.";
		partyInventory._reconcileError = "Saving is paused.";
		partyInventory._render = jest.fn();
		partyInventory._decorateCharacterInventory = jest.fn();

		await partyInventory._pReconcileCharacter();
		expect(partyInventory._reconcileError).toBeNull();
		expect(partyInventory._partyError).toBe("The stash fetch failed.");
		expect(partyInventory._error).toBe("A transfer action failed.");

		await partyInventory._pRefreshParty();
		expect(partyInventory._partyError).toBeNull();
		expect(partyInventory._error).toBe("A transfer action failed.");
		expect(partyInventory._getVisibleError()).toEqual({
			source: "action",
			message: "A transfer action failed.",
		});
	});

	it("detaches cached party inventory after an authoritative HTTP access failure", async () => {
		const error = Object.assign(new Error("forbidden"), {code: "FORBIDDEN"});
		const root = {remove: jest.fn()};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {
				pGetPartyInventory: jest.fn(async () => { throw error; }),
				pGetCampaignSnapshot: jest.fn(async () => ({membership: {role: "player"}, characters: [], roster: []})),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._partyInventory = {id: "party-1", inventory: [{id: "cached"}], currency: {}};
		partyInventory._root = root;
		partyInventory._render = jest.fn();

		await expect(partyInventory._pRefreshParty()).resolves.toBe(false);

		expect(root.remove).toHaveBeenCalled();
		expect(partyInventory._active).toBeNull();
		expect(partyInventory._partyInventory).toBeNull();
	});

	it("retries transient ownership verification when realtime becomes live and performs a full catch-up", async () => {
		const listeners = new Map();
		let rejectProjection;
		const api = {
			pGetCharacterProjection: jest.fn()
				.mockImplementationOnce(() => new Promise((_resolve, reject) => rejectProjection = reject))
				.mockResolvedValueOnce({kind: "owner_truth"}),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			api,
			realtime: {
				on: jest.fn((type, listener) => {
					listeners.set(type, listener);
					return jest.fn();
				}),
			},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._mount = jest.fn();
		partyInventory._bindInventoryUi = jest.fn();
		partyInventory._render = jest.fn();
		const refreshed = [];
		partyInventory._pDrainRefresh = jest.fn(async () => refreshed.push({...partyInventory._refreshFlags}) && true);

		const attaching = partyInventory.pAttach({characterId: "character-1", generation: 1});
		listeners.get("inventoryTransfer")({campaignId: "campaign-1", eventId: "event-1"});
		listeners.get("connectionState")({state: "live"});
		rejectProjection(new Error("offline"));
		await expect(attaching).resolves.toBe(false);
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(api.pGetCharacterProjection).toHaveBeenCalledTimes(2);
		expect(partyInventory._active).toMatchObject({isOwner: true, isActivationPending: false});
		expect(refreshed).toContainEqual({character: true, party: true});
	});

	it("does not let an old character refresh own or clear a new character refresh", async () => {
		let resolveOld;
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnIsCurrentCharacter: () => true,
		});
		const oldActive = {characterId: "old", generation: 1, token: Symbol("old"), isOwner: true};
		partyInventory._active = oldActive;
		partyInventory._refreshFlags = {character: true, party: false};
		partyInventory._pReconcileCharacter = jest.fn(active => active === oldActive
			? new Promise(resolve => resolveOld = resolve)
			: Promise.resolve({status: "reconciled"}));
		partyInventory._pRefreshParty = jest.fn(async () => true);
		const oldRefresh = partyInventory._pDrainRefresh();

		partyInventory.detach();
		const newActive = {characterId: "new", generation: 2, token: Symbol("new"), isOwner: true};
		partyInventory._active = newActive;
		partyInventory._refreshFlags = {character: false, party: true};
		await expect(partyInventory._pDrainRefresh()).resolves.toBe(true);
		resolveOld({status: "error"});
		await expect(oldRefresh).resolves.toBe(false);

		expect(partyInventory._pRefreshParty).toHaveBeenCalledWith(newActive);
		expect(partyInventory._active).toBe(newActive);
	});

	it("does not consume a semantic-effect revision from a generic projection invalidation", () => {
		const listeners = new Map();
		const realtime = {
			on: jest.fn((type, listener) => {
				listeners.set(type, listener);
				return jest.fn();
			}),
		};
		const repository = {pReconcileAuthoritativeCharacter: jest.fn()};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			realtime,
			campaignId: "campaign-1",
			repository,
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};
		partyInventory._scheduleRefresh = jest.fn();

		listeners.get("projectionInvalidated")({characterId: "character-1"});

		expect(partyInventory._scheduleRefresh).toHaveBeenCalledWith({party: true});
		expect(repository.pReconcileAuthoritativeCharacter).not.toHaveBeenCalled();
	});

	it("reconciles a cursor-covered non-semantic character revision", () => {
		const listeners = new Map();
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			realtime: {
				on: jest.fn((type, listener) => {
					listeners.set(type, listener);
					return jest.fn();
				}),
			},
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
		partyInventory._scheduleRefresh = jest.fn();

		listeners.get("projectionInvalidated")({
			characterId: "character-1",
			source: "cursor",
			isCharacterDocumentChanged: true,
		});

		expect(partyInventory._scheduleRefresh).toHaveBeenCalledWith({character: true, party: true});
	});

	it("reconciles an item award into the open owner sheet exactly once without refreshing the stash", () => {
		const listeners = new Map();
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			realtime: {
				on: jest.fn((type, listener) => {
					listeners.set(type, listener);
					return jest.fn();
				}),
			},
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
		partyInventory._scheduleRefresh = jest.fn();
		const event = {
			eventId: "award-event-1",
			campaignId: "campaign-1",
			type: "item.granted",
			sequence: 17,
			isCurrentCharacterAffected: true,
			isPartyInventoryAffected: false,
		};

		listeners.get("inventoryTransfer")(event);
		listeners.get("inventoryTransfer")(event);

		expect(partyInventory._scheduleRefresh).toHaveBeenCalledTimes(1);
		expect(partyInventory._scheduleRefresh).toHaveBeenCalledWith({character: true, party: false});
	});

	it("removes campaign inventory immediately when realtime access is lost", () => {
		const root = {remove: jest.fn()};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
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
		partyInventory._root = root;
		partyInventory._partyInventory = {id: "party-1", inventory: [], currency: {}};

		partyInventory._onConnectionState({state: "access_lost"});

		expect(partyInventory._active).toBeNull();
		expect(partyInventory._partyInventory).toBeNull();
		expect(root.remove).toHaveBeenCalledTimes(1);
	});

	it("keeps party inventory mounted across a suspended realtime connection", () => {
		const root = {remove: jest.fn()};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
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
		partyInventory._root = root;

		partyInventory._onConnectionState({state: "closed"});

		expect(partyInventory._active?.isOwner).toBe(true);
		expect(root.remove).not.toHaveBeenCalled();
	});

	it("decorates unchanged transfer blockers without replacing their DOM nodes", () => {
		const previousDocument = globalThis.document;
		let note = null;
		let button = null;
		const actions = {
			querySelector: () => button,
			append: value => { button = value; },
		};
		const details = {append: value => { note = value; }};
		const row = {
			dataset: {itemId: "stack-1"},
			querySelector: selector => ({
				".charsheet__item-actions": actions,
				".charsheet__item-party-move": button,
				".charsheet__item-party-note": note,
				".charsheet__item-details": details,
			})[selector] || null,
		};
		globalThis.document = {
			querySelectorAll: () => [row],
			createElement: tag => ({
				tag,
				dataset: {},
				disabled: false,
				textContent: "",
				setAttribute: jest.fn(),
			}),
		};
		const character = {
			inventory: [{id: "stack-1", quantity: 1, equipped: true, item: {name: "Shield"}}],
		};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => character,
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {
			characterId: "character-1",
			generation: 1,
			token: Symbol("test"),
			isOwner: true,
		};

		try {
			partyInventory._decorateCharacterInventory();
			const firstNote = note;
			partyInventory._decorateCharacterInventory();
			expect(note).toBe(firstNote);
		} finally {
			globalThis.document = previousDocument;
		}
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
			// `carry: null` is the privacy-safe default: this peer shared no carry summary, and
			// a withheld load must be absent rather than defaulted to a number.
			{id: "recipient-character", label: "Mira", summary: "Fighter 3", carry: null},
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
				pListTransfers: jest.fn(async () => [{id: "transfer-1", status: "reserved"}]),
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
		partyInventory._pDrainRefresh = jest.fn()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);

		expect(partyInventory._draft?.transfer).toEqual({id: "transfer-1", status: "reserved"});
		expect(partyInventory._error).toContain("could not be reached");
		expect(partyInventory._announcement).toBe("");
		expect(partyInventory._isSubmitting).toBe(false);

		character.inventory = [];
		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);
		expect(partyInventory._api.pProposeTransfer).toHaveBeenCalledTimes(1);
		expect(partyInventory._draft).toBeNull();
	});

	it("reports a terminal transfer retry instead of announcing a new reservation", async () => {
		const toast = jest.fn();
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {
				pListTransfers: jest.fn(async () => [{id: "transfer-1", status: "rejected"}]),
				pProposeTransfer: jest.fn(),
			},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({inventory: []}),
			fnIsCurrentCharacter: () => true,
			fnToast: toast,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
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
			transfer: {id: "transfer-1", status: "reserved"},
			needsStatusCheck: true,
		};
		partyInventory._pDrainRefresh = jest.fn(async () => true);

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(true);

		expect(partyInventory._api.pProposeTransfer).not.toHaveBeenCalled();
		expect(partyInventory._announcement).toContain("rejected");
		expect(partyInventory._announcement).not.toContain("recipient can accept");
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({type: "info"}));
	});

	it("blocks stash transfers cleanly when a partial refresh has no authoritative stash id", async () => {
		const save = jest.fn();
		const propose = jest.fn();
		const partyInventory = new CharacterSheetPartyInventory({
			campaignId: "campaign-1",
			api: {pProposeTransfer: propose},
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
			fnGetCharacterData: () => ({
				inventory: [{id: "stack-1", quantity: 2, item: {name: "Rations", source: "PHB"}}],
			}),
			fnSaveCharacter: save,
			fnIsCurrentCharacter: () => true,
		});
		partyInventory._active = {characterId: "character-1", generation: 1, token: Symbol("test"), isOwner: true};
		partyInventory._draft = {
			kind: "character",
			entryId: "stack-1",
			quantity: 1,
			maxQuantity: 2,
			blockers: [],
			destinationKind: "party_inventory",
			recipientId: null,
			transfer: null,
		};

		await expect(partyInventory._pSubmitDraft()).resolves.toBe(false);

		expect(partyInventory._error).toContain("stash is unavailable");
		expect(save).not.toHaveBeenCalled();
		expect(propose).not.toHaveBeenCalled();
	});

	it("keeps focus inside the composer while replacing a submitted control", () => {
		const previousDocument = globalThis.document;
		const previousCss = globalThis.CSS;
		const disabledSubmit = {disabled: true};
		const composer = {focus: jest.fn()};
		const root = {
			querySelector: selector => selector.includes("\"submit\"") ? disabledSubmit : composer,
		};
		globalThis.document = {activeElement: null};
		globalThis.CSS = {escape: value => value};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
		});
		partyInventory._root = root;

		try {
			partyInventory._restoreFocus({key: "submit"});
			expect(composer.focus).toHaveBeenCalledWith({preventScroll: true});
		} finally {
			globalThis.document = previousDocument;
			globalThis.CSS = previousCss;
		}
	});

	it("falls back to the focusable stash section when a refresh or retry control disappears", () => {
		const previousCss = globalThis.CSS;
		globalThis.CSS = {escape: value => value};
		const root = {
			focus: jest.fn(),
			querySelector: jest.fn(() => null),
		};
		const partyInventory = new CharacterSheetPartyInventory({
			api: {},
			campaignId: "campaign-1",
			repository: {pReconcileAuthoritativeCharacter: jest.fn()},
		});
		partyInventory._root = root;

		try {
			partyInventory._restoreFocus({key: "retry"});
			expect(root.focus).toHaveBeenCalledWith({preventScroll: true});
		} finally {
			globalThis.CSS = previousCss;
		}
	});
});
