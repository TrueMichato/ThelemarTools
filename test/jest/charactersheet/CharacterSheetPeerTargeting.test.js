import {jest} from "@jest/globals";
import "./setup.js";
import {CharacterSheetPeerTargeting} from "../../../js/charactersheet/charactersheet-peer-targeting.js";

const CAPABILITY = Object.freeze({
	enabled: true,
	contractVersion: 1,
	protocolVersion: 4,
	operationVersion: 1,
	resourceKinds: ["spell_slot"],
	templateRegistryVersion: "peer-effects-v1",
});

const makeProjectionResponse = () => ({
	projections: [
		{
			kind: "owner_truth",
			character: {id: "source-character", data: {name: "Aster", hp: {current: 2, max: 9}, spellSlots: {1: {current: 1}}}},
		},
		{
			kind: "peer_profile",
			id: "target-character",
			data: {identity: {name: "Bram"}, hp: {current: 1, max: 99}, ac: {value: 25}},
		},
		{
			kind: "peer_profile",
			id: "hidden-character",
			data: {identity: null, hp: {current: 0, max: 1}},
		},
	],
	roster: [
		{characterId: "source-character", targetRef: "opaque-self"},
		{characterId: "target-character", targetRef: "opaque-target"},
	],
});

const makeDeferred = () => {
	let resolve;
	const promise = new Promise(res => { resolve = res; });
	return {promise, resolve};
};

const pFlush = () => new Promise(resolve => setImmediate(resolve));

describe("Character Sheet peer targeting", () => {
	let root;
	let api;
	let listeners;
	let fnPickTarget;
	let onAuthoritativeApproval;
	let controller;
	let capability;
	let characterId;

	beforeEach(() => {
		root = globalThis.e_({tag: "div"});
		listeners = new Map();
		globalThis.window = {
			addEventListener: jest.fn((type, listener) => listeners.set(`window:${type}`, listener)),
			removeEventListener: jest.fn(),
		};
		globalThis.document = {
			visibilityState: "visible",
			addEventListener: jest.fn((type, listener) => listeners.set(`document:${type}`, listener)),
			removeEventListener: jest.fn(),
		};
		api = {
			pListCampaignCharacterProjections: jest.fn(async () => makeProjectionResponse()),
			pCreatePeerAction: jest.fn(async () => ({
				operation: {operationId: "operation-1", status: "proposed", expiresAt: "2026-01-02T00:00:00.000Z"},
			})),
			pListCharacterOutgoingActions: jest.fn(async () => []),
			pResolveStructuredAction: jest.fn(),
		};
		capability = {...CAPABILITY, resourceKinds: [...CAPABILITY.resourceKinds]};
		characterId = "source-character";
		fnPickTarget = jest.fn(async ({targets}) => ({kind: "target", targetRef: targets.find(target => !target.isSelf).targetRef}));
		onAuthoritativeApproval = jest.fn(async () => true);
		controller = new CharacterSheetPeerTargeting({
			campaignId: "campaign-1",
			api,
			root,
			fnGetCharacterId: () => characterId,
			fnGetRulesVersionId: () => "rules-version-1",
			fnGetCapability: () => capability,
			fnCreateId: () => "command-1",
			fnPickTarget,
			fnOnAuthoritativeApplied: onAuthoritativeApproval,
		});
		expect(controller.init()).toBe(true);
		expect(controller.activate({characterId: "source-character"})).toBe(true);
	});

	it("fails closed without the exact cost-bearing capability tuple", async () => {
		capability.protocolVersion = 3;
		controller.deactivate();

		expect(controller.activate({characterId: "source-character"})).toBe(false);
		expect(controller.isSupportedSpellCast({
			spell: {name: "Cure Wounds", source: "PHB", level: 1},
			selectedSlot: {level: 1},
		})).toBe(false);
		expect(await controller.pMaybeProposeSpell({
			spell: {name: "Cure Wounds", source: "PHB", level: 1},
			selectedSlot: {level: 1},
		})).toEqual({handled: false});
		expect(api.pCreatePeerAction).not.toHaveBeenCalled();
	});

	it("creates a source-derived Cure Wounds proposal without exposing target state", async () => {
		await pFlush();
		const result = await controller.pMaybeProposeSpell({
			spell: {id: "spell-1", name: "Cure Wounds", source: "PHB", level: 1},
			selectedSlot: {level: 3, current: 1},
		});

		expect(result).toEqual({handled: true, proposed: true});
		expect(fnPickTarget).toHaveBeenCalledTimes(1);
		const [{targets}] = fnPickTarget.mock.calls[0];
		expect(targets).toEqual([
			{characterId: "source-character", name: "Aster", targetRef: "opaque-self", isSelf: true},
			{characterId: "target-character", name: "Bram", targetRef: "opaque-target", isSelf: false},
		]);
		expect(JSON.stringify(targets)).not.toContain("\"hp\"");
		expect(JSON.stringify(targets)).not.toContain("\"ac\"");
		expect(JSON.stringify(targets)).not.toContain("hidden-character");
		expect(api.pCreatePeerAction).toHaveBeenCalledWith({
			campaignId: "campaign-1",
			contractVersion: 1,
			sourceCharacterId: "source-character",
			sourceEntity: {type: "spell", uid: "cure wounds|phb", version: "phb-2014-v1"},
			effectTemplateId: "spell.cure-wounds.heal",
			choice: {castLevel: 3},
			targetRef: "opaque-target",
			rulesVersionId: "rules-version-1",
			idempotencyKey: "command-1",
		});
		expect([...controller._outgoing.values()][0]).toMatchObject({
			actionId: "operation-1",
			status: "proposed",
			sourceCostState: "pending",
			canCancel: true,
		});
	});

	it("routes self-target through the same approval proposal", async () => {
		await pFlush();
		fnPickTarget.mockImplementationOnce(async ({targets}) => ({
			kind: "target",
			targetRef: targets.find(target => target.isSelf).targetRef,
		}));
		await controller.pMaybeProposeSpell({
			spell: {name: "Cure Wounds", source: "XPHB", level: 1},
			selectedSlot: {level: 1},
		});

		expect(api.pCreatePeerAction).toHaveBeenCalledWith(expect.objectContaining({
			sourceEntity: {type: "spell", uid: "cure wounds|xphb", version: "xphb-2024-v1"},
			targetRef: "opaque-self",
		}));
	});

	it("leaves local and modified spell casts on the existing path", async () => {
		await pFlush();
		const spell = {name: "Cure Wounds", source: "PHB", level: 1};
		const selectedSlot = {level: 1};
		expect(await controller.pMaybeProposeSpell({spell: {...spell, name: "Healing Word"}, selectedSlot})).toEqual({handled: false});
		expect(await controller.pMaybeProposeSpell({spell, selectedSlot, hasMetamagic: true})).toEqual({handled: false});
		expect(await controller.pMaybeProposeSpell({spell, selectedSlot, hasVariantComponent: true})).toEqual({handled: false});
		expect(await controller.pMaybeProposeSpell({spell, selectedSlot: {...selectedSlot, isPact: true}})).toEqual({handled: false});

		fnPickTarget.mockResolvedValueOnce({kind: "local"});
		expect(await controller.pMaybeProposeSpell({spell, selectedSlot})).toEqual({handled: false});
		expect(api.pCreatePeerAction).not.toHaveBeenCalled();
	});

	it("retries a proposal with the same command id after a retryable failure", async () => {
		await pFlush();
		api.pCreatePeerAction
			.mockRejectedValueOnce(Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"}))
			.mockResolvedValueOnce({operation: {operationId: "operation-1", status: "proposed"}});
		const spell = {name: "Cure Wounds", source: "PHB", level: 1};
		const selectedSlot = {level: 1};
		expect(await controller.pMaybeProposeSpell({spell, selectedSlot})).toEqual({handled: true, proposed: false});
		const [draft] = [...controller._drafts.values()];
		expect(draft.error).toContain("offline");

		expect(await controller._pSubmitDraft(draft)).toBe(true);
		expect(api.pCreatePeerAction.mock.calls.map(([request]) => request.idempotencyKey)).toEqual(["command-1", "command-1"]);
	});

	it("keeps duplicate submit gestures single-flight", async () => {
		await pFlush();
		const proposal = makeDeferred();
		api.pCreatePeerAction.mockImplementationOnce(() => proposal.promise);
		const request = {
			spell: {name: "Cure Wounds", source: "PHB", level: 1},
			selectedSlot: {level: 1},
		};
		const first = controller.pMaybeProposeSpell(request);
		await pFlush();
		const second = controller.pMaybeProposeSpell(request);
		await expect(second).resolves.toEqual({handled: true, proposed: false});
		expect(api.pCreatePeerAction).toHaveBeenCalledTimes(1);

		proposal.resolve({operation: {operationId: "operation-1", status: "proposed"}});
		await expect(first).resolves.toEqual({handled: true, proposed: true});
	});

	it("discards a proposal response after the open source character changes", async () => {
		await pFlush();
		const proposal = makeDeferred();
		api.pCreatePeerAction.mockImplementationOnce(() => proposal.promise);
		const pending = controller.pMaybeProposeSpell({
			spell: {name: "Cure Wounds", source: "PHB", level: 1},
			selectedSlot: {level: 1},
		});
		await pFlush();

		characterId = "other-source-character";
		controller.activate({characterId});
		proposal.resolve({operation: {operationId: "stale-operation", status: "proposed"}});

		await expect(pending).resolves.toEqual({handled: true, proposed: false});
		expect(controller._outgoing.has("stale-operation")).toBe(false);
		expect(controller._drafts.size).toBe(0);
	});

	it("cancels without consuming source cost and reuses its command receipt on retry", async () => {
		await pFlush();
		controller._outgoing.set("operation-1", controller._normalizeOutgoing({
			actionId: "operation-1",
			status: "proposed",
			presentation: {effectLabel: "Cure Wounds", targetName: "Bram", outcomeLabel: "Healing"},
			sourceCostState: "pending",
			canCancel: true,
		}));
		api.pResolveStructuredAction
			.mockRejectedValueOnce(Object.assign(new Error("offline"), {code: "NETWORK_UNAVAILABLE"}))
			.mockResolvedValueOnce({operation: {status: "cancelled"}});

		expect(await controller.pCancel({actionId: "operation-1"})).toBe(false);
		expect(await controller.pCancel({actionId: "operation-1"})).toBe(true);
		expect(api.pResolveStructuredAction.mock.calls.map(([request]) => request.idempotencyKey)).toEqual(["command-1", "command-1"]);
		expect(controller._outgoing.get("operation-1")).toMatchObject({
			status: "cancelled",
			sourceCostState: "not_consumed",
			canCancel: false,
		});
	});

	it("adopts a source leg when cancellation loses the race to acceptance", async () => {
		await pFlush();
		controller._outgoing.set("operation-1", controller._normalizeOutgoing({
			actionId: "operation-1",
			sourceCharacterId: "source-character",
			status: "proposed",
			presentation: {effectLabel: "Cure Wounds", targetName: "Bram", outcomeLabel: "Healing"},
			sourceCostState: "pending",
			canCancel: true,
		}));
		const sourceCost = {
			version: 1,
			components: [{kind: "spell_slot", pool: "standard", level: 1, amount: 1}],
		};
		api.pResolveStructuredAction.mockResolvedValue({
			operation: {
				operationId: "operation-1",
				status: "applied",
				sourceResult: {
					appliedEventId: "source-event",
					resultingSourceCharacterRevision: 2,
					sourceCost,
				},
			},
			watermarks: [{characterId: "source-character", sequence: 21}],
		});

		expect(await controller.pCancel({actionId: "operation-1"})).toBe(true);
		expect(onAuthoritativeApproval).toHaveBeenCalledWith({
			actionId: "operation-1",
			characterId: "source-character",
			eventId: "source-event",
			leg: "source",
			sequence: 21,
			sourceCost,
			resultingCharacterRevision: 2,
		});
		expect(controller._outgoing.get("operation-1")).toMatchObject({
			status: "applied",
			sourceCostState: "consumed",
			canCancel: false,
		});
	});

	it("refetches instead of applying an outgoing list read stale to realtime state", async () => {
		await pFlush();
		const stale = makeDeferred();
		api.pListCharacterOutgoingActions
			.mockImplementationOnce(() => stale.promise)
			.mockResolvedValueOnce([{
				actionId: "operation-new",
				sourceCharacterId: "source-character",
				status: "proposed",
				presentation: {effectLabel: "Cure Wounds", targetName: "Bram", outcomeLabel: "Healing"},
				sourceCostState: "pending",
				capabilities: {canCancel: true},
			}]);
		const pending = controller.pRefresh();
		controller._outgoing.set("operation-new", controller._normalizeOutgoing({
			actionId: "operation-new",
			sourceCharacterId: "source-character",
			status: "proposed",
			presentation: {effectLabel: "Cure Wounds", targetName: "Bram", outcomeLabel: "Healing"},
			sourceCostState: "pending",
			canCancel: true,
		}));
		controller.onRealtimeOperation({operationId: "operation-new", status: "proposed"});
		stale.resolve([]);

		await expect(pending).resolves.toBe(false);
		await pFlush();
		expect([...controller._outgoing.keys()]).toEqual(["operation-new"]);
		expect(api.pListCharacterOutgoingActions).toHaveBeenCalledTimes(3);
	});

	it("replaces stale outgoing reads and refreshes terminal realtime states", async () => {
		const stale = makeDeferred();
		api.pListCharacterOutgoingActions
			.mockImplementationOnce(() => stale.promise)
			.mockResolvedValueOnce([{
				actionId: "operation-new",
				status: "proposed",
				presentation: {effectLabel: "Cure Wounds", targetName: "Bram", outcomeLabel: "Healing"},
				sourceCostState: "pending",
				capabilities: {canCancel: true},
			}]);
		controller.activate({characterId: "source-character"});
		controller.activate({characterId: "source-character"});
		await pFlush();
		stale.resolve([{
			actionId: "operation-stale",
			status: "proposed",
			presentation: {effectLabel: "Stale", targetName: "Hidden", outcomeLabel: "Hidden"},
		}]);
		await pFlush();
		expect([...controller._outgoing.keys()]).toEqual(["operation-new"]);

		const readsBeforeTerminal = api.pListCharacterOutgoingActions.mock.calls.length;
		controller.onRealtimeOperation({operationId: "operation-new", status: "rejected"});
		expect(controller._outgoing.get("operation-new")).toMatchObject({
			status: "rejected",
			sourceCostState: "not_consumed",
			canCancel: false,
		});
		expect(api.pListCharacterOutgoingActions).toHaveBeenCalledTimes(readsBeforeTerminal + 1);
	});

	it("clears targeting state on membership loss and restores it on reconnect", async () => {
		await pFlush();
		controller.onConnectionState({state: "access_lost"});
		expect(controller._characterId).toBeNull();
		expect(controller._outgoing.size).toBe(0);
		expect(root.hidden).toBe(true);

		listeners.get("window:focus")();
		await pFlush();
		const beforeReconnect = api.pListCharacterOutgoingActions.mock.calls.length;
		controller.onConnectionState({state: "live"});
		await pFlush();
		expect(controller._characterId).toBe("source-character");
		expect(api.pListCharacterOutgoingActions).toHaveBeenCalledTimes(beforeReconnect + 1);
	});
});
