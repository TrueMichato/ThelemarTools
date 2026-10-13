import {jest} from "@jest/globals";
import "./setup.js";
import {CharacterSheetPeerTargeting} from "../../../js/charactersheet/charactersheet-peer-targeting.js";
import {CharacterSheetHubEffects} from "../../../js/charactersheet/charactersheet-hub-effects.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";
import {getMultiTargetOperationsCapability, resolveReviewedMultiTargetSpell} from "../../../js/hub/hub-multi-target-operations.js";

const descriptor = {sourceEntity: {type: "ability", uid: "shared restoration|tst", version: "tst-v1"}, effectTemplateId: "ability.shared-restoration.heal", choice: {amount: 4}};
const pFlush = () => new Promise(resolve => setImmediate(resolve));
const projections = () => ({projections: [0, 1].map(i => ({kind: "owner_truth", targetRef: `ref-${i}`, character: {id: `character-${i}`, data: {name: "Twin"}}})), roster: [0, 1].map(i => ({characterId: `character-${i}`, targetRef: `ref-${i}`}))});
const capability = () => getMultiTargetOperationsCapability({enabled: true});
const deferred = () => {
	let resolve;
	const promise = new Promise(res => { resolve = res; });
	return {promise, resolve};
};
const makeSource = ({refs = ["ref-0"], resolver = () => descriptor, apiOverrides = {}} = {}) => {
	let version = 1;
	const api = {
		pListCampaignCharacterProjections: jest.fn(async () => projections()),
		pListCharacterOutgoingActions: jest.fn(async () => []),
		pListMultiTargetOutgoing: jest.fn(async () => ({operations: [], nextCursor: null})),
		pCreateMultiTargetOperation: jest.fn(async () => ({operation: {operationId: "multi-1"}})),
		pGetMultiTargetOperation: jest.fn(async () => ({operation: {
			operationId: "multi-1",
			sourceCharacterId: "character-0",
			status: "awaiting_source_selection",
			capabilities: {canFinalize: true, canCancel: true},
			targets: ["approved_by_source", "approved"].map((status, i) => ({invitationId: `inv-${i}`, status, presentation: {targetName: "Twin"}})),
		}})),
		pFinalizeMultiTargetOperation: jest.fn(async () => ({operation: {operationId: "multi-1", status: "applied"}})),
		pCancelMultiTargetOperation: jest.fn(),
		...apiOverrides,
	};
	const applied = jest.fn();
	const controller = new CharacterSheetPeerTargeting({
		campaignId: "campaign-1",
		api,
		root: globalThis.e_({tag: "div"}),
		fnGetCharacterId: () => "character-0",
		fnIsOwner: () => true,
		fnGetRulesVersionId: () => "rules-1",
		fnGetCapability: () => null,
		fnGetMultiTargetCapability: capability,
		fnGetAuthorityVersion: () => version,
		fnResolveMultiTargetSpell: resolver,
		fnPickTargets: async () => ({kind: "targets", targetRefs: refs}),
		fnOnAuthoritativeApplied: applied,
		fnCreateId: () => "exact-command",
	});
	controller.init();
	controller.activate({characterId: "character-0", membershipRole: "player"});
	return {api, controller, applied, changeAuthority: () => version++};
};

describe("Shared sheet multi-target workflow", () => {
	beforeEach(() => {
		globalThis.window = {addEventListener: jest.fn(), removeEventListener: jest.fn()};
		globalThis.document = {visibilityState: "visible", addEventListener: jest.fn(), removeEventListener: jest.fn()};
	});

	it("keeps lost-create retry frozen and reads current readiness rather than replayed receipt state", async () => {
		const api = {
			pListCampaignCharacterProjections: jest.fn(async () => projections()),
			pListCharacterOutgoingActions: jest.fn(async () => []),
			pListMultiTargetOutgoing: jest.fn(async () => ({operations: [], nextCursor: null})),
			pCreateMultiTargetOperation: jest.fn()
				.mockRejectedValueOnce(Object.assign(new Error("lost"), {code: "NETWORK_UNAVAILABLE"}))
				.mockResolvedValueOnce({operation: {operationId: "multi-1", sourceCharacterId: "character-0", status: "collecting_responses", targets: []}}),
			pGetMultiTargetOperation: jest.fn(async () => ({operation: {operationId: "multi-1", sourceCharacterId: "character-0", status: "awaiting_source_selection", capabilities: {canFinalize: true, canCancel: true}, targets: [{invitationId: "self", status: "approved_by_source", presentation: {targetName: "Twin"}}]}})),
		};
		const controller = new CharacterSheetPeerTargeting({
			campaignId: "campaign-1",
			api,
			root: globalThis.e_({tag: "div"}),
			fnGetCharacterId: () => "character-0",
			fnIsOwner: () => true,
			fnGetRulesVersionId: () => "rules-1",
			fnGetCapability: () => null,
			fnGetMultiTargetCapability: capability,
			fnResolveMultiTargetSpell: () => descriptor,
			fnPickTargets: async () => ({kind: "targets", targetRefs: ["ref-0", "ref-1"]}),
			fnCreateId: () => "frozen-command",
		});
		controller.init();
		controller.activate({characterId: "character-0", membershipRole: "player"});
		await pFlush();
		expect(await controller.pMaybeProposeSpell({spell: {name: "Fixture"}, selectedSlot: {level: 1}})).toMatchObject({handled: true, proposed: false});
		const draft = [...controller._drafts.values()][0];
		expect(draft.request.targetRefs).toEqual(["ref-0", "ref-1"]);
		expect(Object.isFrozen(draft.request.targetRefs)).toBe(true);
		expect(await controller._pSubmitDraft(draft)).toBe(true);
		expect(api.pCreateMultiTargetOperation.mock.calls[0][0]).toBe(api.pCreateMultiTargetOperation.mock.calls[1][0]);
		expect(controller._outgoing.get("multi-1").status).toBe("awaiting_source_selection");
		controller.destroy();
	});

	it("keeps duplicate names separate and permits only the exact current character's invitation", async () => {
		const invitations = ["one", "two"].map((id, i) => ({
			operationId: "multi-1",
			invitationId: id,
			targetRef: `ref-${i}`,
			status: "pending",
			operationStatus: "collecting_responses",
			presentation: {targetName: "Twin", sourceName: "Aster", effectLabel: "Shared Restoration", outcomeLabel: "Healing"},
			capabilities: {canApprove: true, canReject: true},
		}));
		const api = {
			pListCharacterPendingActions: jest.fn(async () => []),
			pListMultiTargetInbox: jest.fn(async () => ({invitations, nextCursor: null})),
			pListCampaignCharacterProjections: jest.fn(async () => projections()),
			pRespondMultiTargetInvitation: jest.fn(async () => ({invitation: {...invitations[0], status: "approved"}, operation: {operationId: "multi-1", status: "collecting_responses"}})),
		};
		const controller = new CharacterSheetHubEffects({
			campaignId: "campaign-1",
			api,
			root: globalThis.e_({tag: "div"}),
			fnGetMultiTargetCapability: capability,
			fnGetCharacterId: () => "character-0",
			fnIsOwner: () => true,
		});
		controller.init();
		controller.activate({characterId: "character-0"});
		await pFlush();
		expect(controller._actions.size).toBe(2);
		expect(await controller.pResolve({actionId: "multi:multi-1:two", decision: "accept"})).toBe(false);
		expect(await controller.pResolve({actionId: "multi:multi-1:one", decision: "accept"})).toBe(true);
		expect(api.pRespondMultiTargetInvitation).toHaveBeenCalledTimes(1);
		expect(api.pRespondMultiTargetInvitation).toHaveBeenCalledWith(expect.objectContaining({invitationId: "one", decision: "approve"}));
		controller.destroy();
	});

	it("does not activate a production mapping when the descriptor resolver explicitly returns null", async () => {
		const {controller, api} = makeSource({resolver: undefined});
		controller._fnResolveMultiTargetSpell = () => null;
		expect(await controller.pMaybeProposeSpell({spell: {name: "Mass Healing Word", source: "PHB"}, selectedSlot: {level: 3}})).toEqual({handled: false});
		expect(api.pCreateMultiTargetOperation).not.toHaveBeenCalled();
		controller.destroy();
	});

	it.each(["PHB", "XPHB"])("routes production %s Mass Healing Word with six-candidate limit, never the singular route", async source => {
		const refs = Array.from({length: 7}, (_, index) => `ref-${index}`);
		const {controller, api} = makeSource({
			refs: refs.slice(0, 6),
			resolver: resolveReviewedMultiTargetSpell,
			apiOverrides: {pListCampaignCharacterProjections: jest.fn(async () => ({
				projections: refs.map((targetRef, index) => ({kind: "owner_truth", targetRef, character: {id: `character-${index}`, data: {name: "Twin"}}})),
				roster: refs.map((targetRef, index) => ({characterId: `character-${index}`, targetRef})),
			}))},
		});
		const pick = jest.fn(async () => ({kind: "targets", targetRefs: refs.slice(0, 6)}));
		controller._fnPickTargets = pick;
		const options = {spell: {name: "Mass Healing Word", source, level: 3}, selectedSlot: {level: 4}};
		expect(await controller.pMaybeProposeSpell(options)).toMatchObject({handled: true, proposed: true, isMulti: true});
		expect(pick).toHaveBeenCalledWith(expect.objectContaining({maxTargets: 6, tableRules: expect.stringMatching(/not checked by the server/)}));
		expect(api.pCreateMultiTargetOperation).toHaveBeenCalledWith(expect.objectContaining({
			sourceEntity: {type: "spell", uid: `mass healing word|${source.toLowerCase()}`, version: source === "PHB" ? "phb-2014-v1" : "xphb-2024-v1"},
			effectTemplateId: "spell.mass-healing-word.heal",
			choice: {castLevel: 4},
			targetRefs: refs.slice(0, 6),
		}));
		pick.mockResolvedValueOnce({kind: "targets", targetRefs: refs});
		expect(await controller.pMaybeProposeSpell(options)).toMatchObject({handled: true, proposed: false});
		expect(api.pCreateMultiTargetOperation).toHaveBeenCalledTimes(1);
		expect(controller._isSupportedSpellShape(options)).toBe(false);
		controller.destroy();
	});

	it.each(["PHB", "XPHB"])("keeps production %s Mass Healing Word local when the exact multi capability is disabled", async source => {
		const {controller, api} = makeSource({resolver: resolveReviewedMultiTargetSpell});
		controller._fnGetMultiTargetCapability = () => getMultiTargetOperationsCapability({enabled: false});
		expect(await controller.pMaybeProposeSpell({spell: {name: "Mass Healing Word", source, level: 3}, selectedSlot: {level: 3}})).toEqual({handled: false});
		expect(api.pCreateMultiTargetOperation).not.toHaveBeenCalled();
		controller.destroy();
	});

	it.each(["PHB", "XPHB"])("blocks production %s Mass Healing Word local fallback during an installed-authority fence", async source => {
		const {controller, api} = makeSource({resolver: resolveReviewedMultiTargetSpell});
		controller.suspend();
		controller._fnGetMultiTargetCapability = () => null;
		expect(await controller.pMaybeProposeSpell({spell: {name: "Mass Healing Word", source, level: 3}, selectedSlot: {level: 3}})).toEqual({handled: true, proposed: false});
		expect(api.pCreateMultiTargetOperation).not.toHaveBeenCalled();
		expect(controller._drafts.size).toBe(0);
		controller.destroy();
	});

	it("rechecks exact fresh owner-truth identity immediately before consent, never duplicate-name identity", async () => {
		const invitation = {operationId: "multi-1",
			invitationId: "one",
			targetRef: "ref-0",
			status: "pending",
			presentation: {targetName: "Twin", effectLabel: "Shared Restoration"},
			capabilities: {canApprove: true}};
		const api = {
			pListCharacterPendingActions: jest.fn(async () => []),
			pListMultiTargetInbox: jest.fn(async () => ({invitations: [invitation], nextCursor: null})),
			pListCampaignCharacterProjections: jest.fn(async () => projections()),
			pRespondMultiTargetInvitation: jest.fn(),
		};
		const controller = new CharacterSheetHubEffects({
			campaignId: "campaign-1",
			api,
			root: globalThis.e_({tag: "div"}),
			fnGetMultiTargetCapability: capability,
			fnGetCharacterId: () => "character-0",
			fnIsOwner: () => true,
		});
		controller.init();
		controller.activate({characterId: "character-0"});
		await pFlush();
		api.pListCampaignCharacterProjections.mockResolvedValue({projections: [
			{kind: "owner_truth", targetRef: "ref-0", character: {id: "character-1", data: {name: "Twin"}}},
		]});
		expect(await controller.pResolve({actionId: "multi:multi-1:one", decision: "accept"})).toBe(false);
		expect(api.pRespondMultiTargetInvitation).not.toHaveBeenCalled();
		controller.destroy();
	});

	it.each(["_pPickTarget", "_pPickTargets"])("closes a delayed %s modal without publishing private labels after suspension", async pickerMethod => {
		const gate = deferred();
		const modal = jest.spyOn(CharacterSheetModal, "pGetShow").mockImplementationOnce(() => gate.promise);
		const {controller} = makeSource();
		await pFlush();
		const pending = controller[pickerMethod]({spell: {name: "Fixture"}, slotLevel: 1, targets: [{targetRef: "ref-0", name: "Private name"}]});
		controller.suspend();
		const inner = {append: jest.fn()};
		const close = jest.fn();
		gate.resolve({eleModalInner: inner, doClose: close});
		expect(await pending).toEqual({kind: "cancel"});
		await pFlush();
		expect(close).toHaveBeenCalledWith(false);
		expect(inner.append).not.toHaveBeenCalled();
		modal.mockRestore();
		controller.destroy();
	});

	it("retains exact duplicate-named checkbox selections through legitimate outgoing rerenders and refresh", async () => {
		const inner = globalThis.e_({tag: "div"});
		const close = jest.fn();
		const modal = jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({eleModalInner: inner, doClose: close});
		const {controller} = makeSource();
		try {
			await pFlush();
			const pending = controller._pPickTargets({
				spell: {name: "Mass Healing Word"},
				maxTargets: 6,
				targets: [{targetRef: "ref-0", name: "Twin"}, {targetRef: "ref-1", name: "Twin"}],
			});
			await pFlush();
			const body = inner.children[0];
			const list = body.children.find(child => child.tag === "ul");
			const inputs = list.children.map(row => row.children[0].children[0]);
			inputs[0].checked = true;
			inputs[0]._handlers.change();
			controller._render();
			await controller.pRefresh();
			expect(inner.children[0]).toBe(body);
			expect(inputs.map(input => [input.dataset.hubTargetRef, input.checked])).toEqual([["ref-0", true], ["ref-1", false]]);
			inputs[1].checked = true;
			inputs[1]._handlers.change();
			controller._render();
			const controls = body.children.find(child => child._clazz === "charsheet__peer-target-controls");
			controls.children.find(child => child.textContent === "Send requests").click();
			await expect(pending).resolves.toEqual({kind: "targets", targetRefs: ["ref-0", "ref-1"]});
			expect(close).toHaveBeenCalledWith(true);
		} finally {
			modal.mockRestore();
			controller.destroy();
		}
	});

	it.each([[], ["ref-0", "ref-0"], ["ref-0", "missing"], Array.from({length: 9}, (_, i) => `ref-${i}`)].map(refs => [refs]))("rejects invalid fixed candidate set %j before creating", async refs => {
		const {controller, api} = makeSource({refs});
		expect(await controller.pMaybeProposeSpell({spell: {name: "Fixture"}, selectedSlot: {level: 1}})).toMatchObject({handled: true, proposed: false});
		expect(api.pCreateMultiTargetOperation).not.toHaveBeenCalled();
		controller.destroy();
	});

	it.each([1, 8])("accepts exactly %i unique candidates without spending local resources", async count => {
		const refs = Array.from({length: count}, (_, i) => `ref-${i}`);
		const {controller, api} = makeSource({refs,
			apiOverrides: {
				pListCampaignCharacterProjections: jest.fn(async () => ({
					projections: refs.map((targetRef, i) => ({kind: "owner_truth", targetRef, character: {id: `character-${i}`, data: {name: "Twin"}}})),
					roster: refs.map((targetRef, i) => ({characterId: `character-${i}`, targetRef})),
				})),
			}});
		expect(await controller.pMaybeProposeSpell({spell: {name: "Fixture"}, selectedSlot: {level: 1}})).toMatchObject({handled: true, proposed: true});
		expect(api.pCreateMultiTargetOperation).toHaveBeenCalledWith(expect.objectContaining({targetRefs: refs}));
		expect(api.pFinalizeMultiTargetOperation).not.toHaveBeenCalled();
		controller.destroy();
	});

	it("allows deselecting source-owned approval, freezes a lost-finalize retry, and ignores historical collecting status", async () => {
		const {controller, api} = makeSource();
		await controller.pMaybeProposeSpell({spell: {name: "Fixture"}, selectedSlot: {level: 1}});
		const action = controller._outgoing.get("multi-1");
		action.selectedInvitationIds.delete("inv-0");
		api.pFinalizeMultiTargetOperation
			.mockRejectedValueOnce(Object.assign(new Error("lost"), {code: "NETWORK_UNAVAILABLE"}))
			.mockResolvedValueOnce({operation: {operationId: "multi-1", status: "collecting_responses"}});
		expect(await controller.pFinalize({actionId: "multi-1"})).toBe(false);
		expect(controller._outgoing.get("multi-1").sourceCostState).toBe("unconfirmed");
		expect(api.pFinalizeMultiTargetOperation.mock.calls[0][0].selectedInvitationIds).toEqual(["inv-1"]);
		await pFlush();
		expect(await controller.pFinalize({actionId: "multi-1", selectedInvitationIds: ["inv-0"]})).toBe(true);
		expect(api.pFinalizeMultiTargetOperation.mock.calls[1][0]).toBe(api.pFinalizeMultiTargetOperation.mock.calls[0][0]);
		expect(controller._outgoing.get("multi-1").status).toBe("awaiting_source_selection");
		controller.destroy();
	});

	it("does not finalize from local readiness or an empty selected subset", async () => {
		const {controller, api} = makeSource();
		await controller.pMaybeProposeSpell({spell: {name: "Fixture"}, selectedSlot: {level: 1}});
		expect(await controller.pFinalize({actionId: "multi-1", selectedInvitationIds: []})).toBe(false);
		await pFlush();
		api.pGetMultiTargetOperation.mockResolvedValue({operation: {
			operationId: "multi-1", sourceCharacterId: "character-0", status: "collecting_responses", capabilities: {canFinalize: false, canCancel: true}, targets: [],
		}});
		expect(await controller.pFinalize({actionId: "multi-1", selectedInvitationIds: ["inv-1"]})).toBe(false);
		expect(api.pFinalizeMultiTargetOperation).not.toHaveBeenCalled();
		controller.destroy();
	});

	it.each(["projection", "create", "detail"])("fences late %s response on authority-generation change", async phase => {
		const gate = deferred();
		const {controller, api, applied, changeAuthority} = makeSource();
		await pFlush();
		const method = {projection: "pListCampaignCharacterProjections", create: "pCreateMultiTargetOperation", detail: "pGetMultiTargetOperation"}[phase];
		api[method].mockImplementationOnce(() => gate.promise);
		const pending = controller.pMaybeProposeSpell({spell: {name: "Fixture"}, selectedSlot: {level: 1}});
		await pFlush();
		changeAuthority();
		gate.resolve(phase === "projection" ? projections() : {operation: {operationId: "multi-1", sourceCharacterId: "character-0", status: "awaiting_source_selection"}});
		expect(await pending).toMatchObject({handled: true, proposed: false});
		expect(controller._outgoing.size).toBe(0);
		expect(applied).not.toHaveBeenCalled();
		controller.destroy();
	});

	it("keeps retained source labels concealed after context resumes until fresh outgoing authority arrives", async () => {
		const {controller, api} = makeSource();
		await controller.pMaybeProposeSpell({spell: {name: "Fixture"}, selectedSlot: {level: 1}});
		controller.suspend();
		const card = jest.spyOn(controller, "_getActionCard");
		const gate = deferred();
		api.pListMultiTargetOutgoing.mockImplementationOnce(() => gate.promise);
		controller.activate({characterId: "character-0", membershipRole: "player"});
		await pFlush();
		expect(controller._isAuthorityRevalidating).toBe(true);
		expect(card).not.toHaveBeenCalled();
		gate.resolve({operations: [], nextCursor: null});
		await pFlush();
		expect(controller._isAuthorityRevalidating).toBe(false);
		expect(controller._outgoing.size).toBe(0);
		controller.destroy();
	});

	it("fences a late multi-create receipt if only the separate multi capability is lost", async () => {
		const {controller, api, applied} = makeSource();
		await pFlush();
		controller._fnGetCapability = () => ({enabled: true, contractVersion: 1, protocolVersion: 4, operationVersion: 1, templateRegistryVersion: "peer-effects-v1"});
		const gate = deferred();
		api.pCreateMultiTargetOperation.mockImplementationOnce(() => gate.promise);
		const pending = controller.pMaybeProposeSpell({spell: {name: "Fixture"}, selectedSlot: {level: 1}});
		await pFlush();
		controller._fnGetMultiTargetCapability = () => getMultiTargetOperationsCapability();
		gate.resolve({operation: {operationId: "multi-1"}});
		expect(await pending).toMatchObject({handled: true, proposed: false});
		expect(controller._outgoing.size).toBe(0);
		expect(applied).not.toHaveBeenCalled();
		controller.destroy();
	});

	it("keeps a lost cancel command exact and shows authoritative applied status if finalization won elsewhere", async () => {
		const {controller, api} = makeSource();
		await controller.pMaybeProposeSpell({spell: {name: "Fixture"}, selectedSlot: {level: 1}});
		api.pCancelMultiTargetOperation
			.mockRejectedValueOnce(Object.assign(new Error("lost"), {code: "NETWORK_UNAVAILABLE"}))
			.mockResolvedValueOnce({operation: {operationId: "multi-1", status: "collecting_responses"}});
		expect(await controller.pCancel({actionId: "multi-1"})).toBe(false);
		await pFlush();
		expect(await controller.pFinalize({actionId: "multi-1", selectedInvitationIds: ["inv-1"]})).toBe(false);
		api.pGetMultiTargetOperation.mockResolvedValue({operation: {
			operationId: "multi-1",
			sourceCharacterId: "character-0",
			status: "applied",
			capabilities: {canFinalize: false, canCancel: false},
			targets: [],
		}});
		expect(await controller.pCancel({actionId: "multi-1"})).toBe(true);
		expect(api.pCancelMultiTargetOperation.mock.calls[1][0]).toBe(api.pCancelMultiTargetOperation.mock.calls[0][0]);
		expect(controller._outgoing.get("multi-1")).toMatchObject({status: "applied", sourceCostState: "consumed", canCancel: false});
		expect(api.pFinalizeMultiTargetOperation).not.toHaveBeenCalled();
		controller.destroy();
	});

	it("removes newly revoked candidates from the editable subset without restoring deselected source-owned candidates", async () => {
		const {controller, api} = makeSource();
		await controller.pMaybeProposeSpell({spell: {name: "Fixture"}, selectedSlot: {level: 1}});
		const detail = (await api.pGetMultiTargetOperation()).operation;
		detail.targets[0].status = "revoked";
		api.pListMultiTargetOutgoing.mockResolvedValue({operations: [detail], nextCursor: null});
		await controller.pRefresh();
		expect([...controller._outgoing.get("multi-1").selectedInvitationIds]).toEqual(["inv-1"]);
		controller._outgoing.get("multi-1").selectedInvitationIds.clear();
		detail.targets[0].status = "approved_by_source";
		await controller.pRefresh();
		expect([...controller._outgoing.get("multi-1").selectedInvitationIds]).toEqual([]);
		controller.destroy();
	});

	it("retains one exact incoming decision across reconnect and refuses a changed-body retry", async () => {
		const invitation = {operationId: "multi-1",
			invitationId: "one",
			targetRef: "ref-0",
			status: "pending",
			presentation: {targetName: "Twin", effectLabel: "Shared Restoration"},
			capabilities: {canApprove: true, canReject: true}};
		const api = {
			pListCharacterPendingActions: jest.fn(async () => []),
			pListMultiTargetInbox: jest.fn(async () => ({invitations: [invitation], nextCursor: null})),
			pListCampaignCharacterProjections: jest.fn(async () => projections()),
			pRespondMultiTargetInvitation: jest.fn()
				.mockRejectedValueOnce(Object.assign(new Error("lost"), {code: "NETWORK_UNAVAILABLE"}))
				.mockImplementationOnce(async () => {
					invitation.status = "approved";
					return {invitation, operation: {operationId: "multi-1", status: "collecting_responses"}};
				}),
		};
		const applied = jest.fn();
		const controller = new CharacterSheetHubEffects({
			campaignId: "campaign-1",
			api,
			root: globalThis.e_({tag: "div"}),
			fnGetMultiTargetCapability: capability,
			fnGetCharacterId: () => "character-0",
			fnIsOwner: () => true,
			fnOnAuthoritativeApproval: applied,
		});
		controller.init();
		controller.activate({characterId: "character-0"});
		await pFlush();
		expect(await controller.pResolve({actionId: "multi:multi-1:one", decision: "accept"})).toBe(false);
		controller.onConnectionState({state: "reconnecting"});
		controller.onConnectionState({state: "live"});
		await pFlush();
		expect(await controller.pResolve({actionId: "multi:multi-1:one", decision: "reject"})).toBe(false);
		expect(await controller.pResolve({actionId: "multi:multi-1:one", decision: "accept"})).toBe(true);
		expect(api.pRespondMultiTargetInvitation.mock.calls[1][0]).toBe(api.pRespondMultiTargetInvitation.mock.calls[0][0]);
		expect(applied).not.toHaveBeenCalled();
		controller.destroy();
	});

	it("never renders, adopts or focuses a late incoming consent response after authority is suspended", async () => {
		const invitation = {operationId: "multi-1",
			invitationId: "one",
			targetRef: "ref-0",
			status: "pending",
			presentation: {targetName: "Twin", effectLabel: "Shared Restoration"},
			capabilities: {canApprove: true}};
		const gate = deferred();
		const api = {
			pListCharacterPendingActions: jest.fn(async () => []),
			pListMultiTargetInbox: jest.fn(async () => ({invitations: [invitation], nextCursor: null})),
			pListCampaignCharacterProjections: jest.fn(async () => projections()),
			pRespondMultiTargetInvitation: jest.fn(() => gate.promise),
		};
		const applied = jest.fn();
		const controller = new CharacterSheetHubEffects({
			campaignId: "campaign-1",
			api,
			root: globalThis.e_({tag: "div"}),
			fnGetMultiTargetCapability: capability,
			fnGetCharacterId: () => "character-0",
			fnIsOwner: () => true,
			fnOnAuthoritativeApproval: applied,
		});
		controller.init();
		controller.activate({characterId: "character-0"});
		await pFlush();
		const pending = controller.pResolve({actionId: "multi:multi-1:one", decision: "accept"});
		await pFlush();
		expect(api.pRespondMultiTargetInvitation).toHaveBeenCalledTimes(1);
		controller.suspend();
		const render = jest.spyOn(controller, "_renderApprovals");
		const focus = jest.spyOn(controller, "_focusMultiInvitation");
		gate.resolve({invitation: {...invitation, status: "approved"}, operation: {operationId: "multi-1", status: "applied"}});
		expect(await pending).toBe(false);
		expect(controller._actions.size).toBe(0);
		expect(render).not.toHaveBeenCalled();
		expect(focus).not.toHaveBeenCalled();
		expect(applied).not.toHaveBeenCalled();
		controller.destroy();
	});
});
