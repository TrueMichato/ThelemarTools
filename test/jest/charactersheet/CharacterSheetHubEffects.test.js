import {jest} from "@jest/globals";
import "./setup.js";
import {CharacterSheetHubEffects} from "../../../js/charactersheet/charactersheet-hub-effects.js";

const makeAction = ({
	actionId = "action-1",
	sourceName = "Aster",
	effectLabel = "Steadying Word",
} = {}) => ({
	actionId,
	status: "proposed",
	expiresAt: "2026-01-02T00:00:00.000Z",
	presentation: {sourceName, effectLabel},
	capabilities: {canApprove: true, canReject: true},
});

const makeOperation = ({operationId = "action-1", kind = "hp.heal", args = {amount: 4}} = {}) => ({
	operationId,
	kind,
	version: 1,
	targetCharacterId: "character-1",
	arguments: args,
});

const makeDeferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {promise, resolve, reject};
};

const pFlush = () => new Promise(resolve => setImmediate(resolve));

describe("Character Sheet Hub effect controls", () => {
	let root;
	let api;
	let listeners;
	let controller;
	let timerCallbacks;

	beforeEach(() => {
		root = globalThis.e_({tag: "div"});
		listeners = new Map();
		timerCallbacks = [];
		globalThis.window = {
			addEventListener: jest.fn((type, listener) => listeners.set(`window:${type}`, listener)),
			removeEventListener: jest.fn(),
		};
		globalThis.document = {
			activeElement: null,
			visibilityState: "visible",
			addEventListener: jest.fn((type, listener) => listeners.set(`document:${type}`, listener)),
			removeEventListener: jest.fn(),
		};
		globalThis.CSS = {escape: value => value};
		api = {
			pListCharacterPendingActions: jest.fn(async () => []),
			pResolveStructuredAction: jest.fn(),
		};
		controller = new CharacterSheetHubEffects({
			campaignId: "campaign-1",
			api,
			root,
			fnCreateId: () => "command-1",
			fnSetTimeout: fn => {
				timerCallbacks.push(fn);
				return timerCallbacks.length;
			},
			fnClearTimeout: jest.fn(),
		});
		expect(controller.init()).toBe(true);
	});

	it("is a no-op without Hub capability", () => {
		const local = new CharacterSheetHubEffects({root});
		expect(local.init()).toBe(false);
		expect(local.activate({characterId: "local-1"})).toBe(false);
		expect(root.hidden).toBe(true);
	});

	it("hides owner-only controls when authorization is unavailable", async () => {
		api.pListCharacterPendingActions.mockRejectedValue(Object.assign(new Error("hidden"), {code: "CHARACTER_NOT_FOUND"}));
		controller.activate({characterId: "character-1"});
		await pFlush();

		expect(controller._isAuthorized).toBe(false);
		expect(root.hidden).toBe(true);
		expect(root.textContent).not.toContain("hidden");
	});

	it("fetches on open, reconnect, focus, and visible-tab restoration", async () => {
		controller.activate({characterId: "character-1"});
		await pFlush();
		expect(api.pListCharacterPendingActions).toHaveBeenCalledWith({
			campaignId: "campaign-1",
			characterId: "character-1",
		});

		controller.onConnectionState({state: "live"});
		await pFlush();
		listeners.get("window:focus")();
		await pFlush();
		listeners.get("document:visibilitychange")();
		await pFlush();
		expect(api.pListCharacterPendingActions).toHaveBeenCalledTimes(4);
	});

	it("refetches when a proposal arrives during the initial authorization read", async () => {
		const initial = makeDeferred();
		api.pListCharacterPendingActions
			.mockImplementationOnce(() => initial.promise)
			.mockResolvedValueOnce([makeAction({actionId: "action-new"})]);
		controller.activate({characterId: "character-1"});
		controller.onRealtimeOperation({
			status: "proposed",
			targetCharacterId: "character-1",
			payload: makeAction({actionId: "action-new"}),
		});
		initial.resolve([]);
		await pFlush();
		await pFlush();

		expect(api.pListCharacterPendingActions).toHaveBeenCalledTimes(2);
		expect([...controller._actions.keys()]).toEqual(["action-new"]);
	});

	it("clears resolver controls when realtime authorization is lost", async () => {
		api.pListCharacterPendingActions.mockResolvedValue([makeAction()]);
		controller.activate({characterId: "character-1"});
		await pFlush();
		controller.onConnectionState({state: "access_lost"});

		expect(controller._isAuthorized).toBe(false);
		expect(controller._actions.size).toBe(0);
		expect(root.hidden).toBe(true);
		listeners.get("window:focus")();
		await pFlush();
		expect(api.pListCharacterPendingActions).toHaveBeenCalledTimes(1);

		controller.onConnectionState({state: "live"});
		await pFlush();
		expect(api.pListCharacterPendingActions).toHaveBeenCalledTimes(2);
	});

	it("fences stale fetches when the open character changes", async () => {
		const first = makeDeferred();
		const second = makeDeferred();
		api.pListCharacterPendingActions
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise);

		controller.activate({characterId: "character-1"});
		controller.activate({characterId: "character-2"});
		second.resolve([makeAction({actionId: "action-new"})]);
		await pFlush();
		first.resolve([makeAction({actionId: "action-stale"})]);
		await pFlush();

		expect([...controller._actions.keys()]).toEqual(["action-new"]);
	});

	it("does not let an in-flight refresh overwrite a newer realtime request", async () => {
		api.pListCharacterPendingActions.mockResolvedValueOnce([makeAction()]);
		controller.activate({characterId: "character-1"});
		await pFlush();
		const refresh = makeDeferred();
		api.pListCharacterPendingActions
			.mockImplementationOnce(() => refresh.promise)
			.mockResolvedValueOnce([makeAction(), makeAction({actionId: "action-new"})]);
		const pRefreshing = controller.pRefresh();

		controller.onRealtimeOperation({
			status: "proposed",
			targetCharacterId: "character-1",
			payload: makeAction({actionId: "action-new"}),
		});
		refresh.resolve([makeAction()]);
		await pRefreshing;
		await pFlush();

		expect([...controller._actions.keys()]).toEqual(["action-1", "action-new"]);
		expect(api.pListCharacterPendingActions).toHaveBeenCalledTimes(3);
	});

	it("deduplicates projected realtime requests and removes terminal requests", async () => {
		api.pListCharacterPendingActions.mockResolvedValue([makeAction()]);
		controller.activate({characterId: "character-1"});
		await pFlush();
		const event = {
			status: "proposed",
			targetCharacterId: "character-1",
			payload: makeAction(),
		};
		expect(controller.onRealtimeOperation(event)).toBe(true);
		expect(controller.onRealtimeOperation(event)).toBe(true);
		expect(controller._actions.size).toBe(1);
		expect(controller.onRealtimeOperation({
			status: "rejected",
			targetCharacterId: "character-1",
			operationId: "action-1",
		})).toBe(true);
		expect(controller._actions.size).toBe(0);
	});

	it("keeps decisions single-flight and reuses the command identity after a retry", async () => {
		api.pListCharacterPendingActions.mockResolvedValue([makeAction()]);
		const first = makeDeferred();
		api.pResolveStructuredAction
			.mockImplementationOnce(() => first.promise)
			.mockResolvedValueOnce({operation: {status: "applied"}});
		controller.activate({characterId: "character-1"});
		await pFlush();

		const pending = controller.pResolve({actionId: "action-1", decision: "accept"});
		await expect(controller.pResolve({actionId: "action-1", decision: "reject"})).resolves.toBe(false);
		expect(api.pResolveStructuredAction).toHaveBeenCalledTimes(1);
		first.reject(Object.assign(new Error("offline"), {code: "NETWORK_ERROR"}));
		await expect(pending).resolves.toBe(false);
		expect(controller._actions.get("action-1").error).toContain("Try again");

		await expect(controller.pResolve({actionId: "action-1", decision: "accept"})).resolves.toBe(true);
		expect(api.pResolveStructuredAction).toHaveBeenCalledTimes(2);
		expect(api.pResolveStructuredAction.mock.calls[0][0].idempotencyKey).toBe("command-1");
		expect(api.pResolveStructuredAction.mock.calls[1][0].idempotencyKey).toBe("command-1");
		expect(controller._actions.get("action-1").decisionState).toBe("waiting");
	});

	it("fails closed when authorization is lost during a decision", async () => {
		api.pListCharacterPendingActions.mockResolvedValue([makeAction()]);
		api.pResolveStructuredAction.mockRejectedValue(Object.assign(new Error("hidden"), {code: "FORBIDDEN"}));
		controller.activate({characterId: "character-1"});
		await pFlush();

		await expect(controller.pResolve({actionId: "action-1", decision: "accept"})).resolves.toBe(false);
		expect(controller._isAuthorized).toBe(false);
		expect(controller._actions.size).toBe(0);
		expect(root.textContent).not.toContain("hidden");
	});

	it("does not apply locally on approval and removes only after the authoritative applied event", async () => {
		api.pListCharacterPendingActions.mockResolvedValue([makeAction()]);
		api.pResolveStructuredAction.mockResolvedValue({operation: {status: "applied"}});
		controller.activate({characterId: "character-1"});
		await pFlush();
		await controller.pResolve({actionId: "action-1", decision: "accept"});
		expect(controller._actions.has("action-1")).toBe(true);
		expect(controller._notices.size).toBe(0);

		expect(controller.onApplied({
			operation: makeOperation(),
			beforeData: {hp: {current: 5, max: 20, temp: 0}},
			afterData: {hp: {current: 9, max: 20, temp: 0}},
		})).toBe(true);
		expect(controller._actions.has("action-1")).toBe(false);
		expect([...controller._notices.values()][0].message).toBe("4 hit points restored by the campaign.");
	});

	it("removes a rejected request from the authoritative response", async () => {
		api.pListCharacterPendingActions.mockResolvedValue([makeAction()]);
		api.pResolveStructuredAction.mockResolvedValue({operation: {status: "rejected"}});
		controller.activate({characterId: "character-1"});
		await pFlush();
		await expect(controller.pResolve({actionId: "action-1", decision: "reject"})).resolves.toBe(true);
		expect(controller._actions.has("action-1")).toBe(false);
	});

	it("shows one accessible notice per adopted operation and never a success notice for a failed adoption", () => {
		controller.activate({characterId: "character-1"});
		const externalFocus = {dataset: {}};
		document.activeElement = externalFocus;
		const operation = makeOperation({kind: "hp.damage"});
		expect(controller.onApplied({operation})).toBe(true);
		expect(controller.onApplied({operation})).toBe(false);
		expect(controller._notices.size).toBe(1);
		expect(document.activeElement).toBe(externalFocus);
		timerCallbacks.at(-1)();
		expect(controller.onApplied({operation})).toBe(false);
		expect(controller._notices.size).toBe(0);

		controller.onApplicationError({operationId: "action-failed"});
		expect([...controller._notices.values()].filter(it => it.kind === "success")).toHaveLength(0);
		expect([...controller._notices.values()].filter(it => it.kind === "error")).toHaveLength(1);
	});

	it("keeps a bounded recovery notice visible while newer successes rotate", () => {
		controller.activate({characterId: "character-1"});
		controller.onApplicationError({operationId: "failed-operation"});
		for (let i = 0; i < 5; ++i) {
			controller.onApplied({operation: makeOperation({operationId: `success-${i}`, kind: "hp.damage"})});
		}
		expect(controller._notices.has("error:failed-operation")).toBe(true);
		expect([...controller._notices.values()].filter(it => it.kind === "success")).toHaveLength(3);
	});

	it("reports the authoritative clamped spell-slot restoration outcome", () => {
		controller.activate({characterId: "character-1"});
		controller.onApplied({
			operation: makeOperation({
				kind: "spell_slot.restore",
				args: {level: 2, amount: 3},
			}),
			beforeData: {spellcasting: {spellSlots: {2: {current: 2, max: 3}}}},
			afterData: {spellcasting: {spellSlots: {2: {current: 3, max: 3}}}},
		});
		expect([...controller._notices.values()][0].message).toBe("1 level 2 spell slot restored by the campaign.");
	});

	it("reports authoritative no-op condition outcomes without claiming a change", () => {
		controller.activate({characterId: "character-1"});
		const condition = {name: "Poisoned", source: "XPHB"};
		controller.onApplied({
			operation: makeOperation({operationId: "add-noop", kind: "condition.add", args: {condition}}),
			beforeData: {conditions: [condition]},
			afterData: {conditions: [condition]},
		});
		controller.onApplied({
			operation: makeOperation({operationId: "remove-noop", kind: "condition.remove", args: {condition}}),
			beforeData: {conditions: []},
			afterData: {conditions: []},
		});

		expect([...controller._notices.values()].map(it => it.message)).toEqual([
			"Campaign condition update applied; Poisoned was already present.",
			"Campaign condition update applied; Poisoned was not present.",
		]);
	});

	it("moves focus to the request card while its decision controls are disabled", async () => {
		api.pListCharacterPendingActions.mockResolvedValue([makeAction()]);
		controller.activate({characterId: "character-1"});
		await pFlush();
		const card = {focus: jest.fn()};
		const disabledButton = {disabled: true, focus: jest.fn()};
		controller._approvalsRoot.querySelector = jest.fn(selector => {
			if (selector.startsWith("button")) return disabledButton;
			if (selector.startsWith("article")) return card;
			return null;
		});
		document.activeElement = {dataset: {hubActionId: "action-1", hubDecision: "accept"}};

		controller._actions.get("action-1").decisionState = "submitting";
		controller._actions.get("action-1").decision = "accept";
		controller._renderApprovals();

		expect(disabledButton.focus).not.toHaveBeenCalled();
		expect(card.focus).toHaveBeenCalledWith({preventScroll: true});
	});

	it("moves focus back into the sheet after the last request resolves", async () => {
		api.pListCharacterPendingActions.mockResolvedValue([makeAction()]);
		controller.activate({characterId: "character-1"});
		await pFlush();
		const hpInput = {focus: jest.fn()};
		document.getElementById = jest.fn(() => hpInput);
		controller._approvalsRoot.querySelector = jest.fn(() => null);
		controller._noticesRoot.querySelector = jest.fn(() => null);
		document.activeElement = {dataset: {hubActionId: "action-1", hubDecision: "reject"}};

		controller.onRealtimeOperation({
			status: "rejected",
			targetCharacterId: "character-1",
			operationId: "action-1",
		});

		expect(hpInput.focus).toHaveBeenCalledWith({preventScroll: true});
	});

	it("retains only the privacy-safe server projection", async () => {
		api.pListCharacterPendingActions.mockResolvedValue([{
			...makeAction(),
			targetCharacterId: "private-character-id",
			originActorAccountId: "private-account-id",
			sourceEntity: {secret: "private"},
			choice: {secretNote: "private"},
		}]);
		controller.activate({characterId: "character-1"});
		await pFlush();
		expect(controller._actions.get("action-1")).toMatchObject(makeAction());
		expect(JSON.stringify(controller._actions.get("action-1"))).not.toMatch(/private|characterId|accountId|sourceEntity|choice/);
	});
});
