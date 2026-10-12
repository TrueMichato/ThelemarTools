import "./setup.js";
import {jest} from "@jest/globals";
import {CharacterSheetRollHistory} from "../../../js/charactersheet/charactersheet-rollhistory.js";
import {HubRollLogAdapter} from "../../../js/hub/hub-roll-log-adapter.js";

const scope = {accountId: "owner", campaignId: "campaign", characterId: "character", isEnabled: true};
const event = ({id = "event", sequence = 10, commandId, total = 17, actorAccountId = "owner"} = {}) => ({
	id,
	sequence,
	type: "roll.logged",
	campaignId: "campaign",
	aggregateType: "character",
	aggregateId: "character",
	actorAccountId,
	visibility: "all_members",
	createdAt: new Date().toISOString(),
	payload: {formula: "1d20+3", total, context: "skill", detail: {title: "Perception", breakdown: "1d20+3"}, ...(commandId ? {actorCommandId: commandId} : {})},
});
const page = events => ({contractVersion: 1, highWaterSequence: Math.max(0, ...events.map(event => event.sequence)), events, history: {hasMore: false, scannedBackThroughSequence: 1}});
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((a, b) => { resolve = a; reject = b; });
	return {promise, resolve, reject};
};

describe("Campaign Sheet retained roll history", () => {
	let history;
	let api;
	let sheet;
	let storage;

	beforeEach(() => {
		const values = new Map();
		storage = {
			getItem: key => values.get(key) ?? null,
			setItem: (key, value) => values.set(key, value),
			removeItem: key => values.delete(key),
		};
		api = {pListCharacterRollHistory: jest.fn(async () => page([])), pLogRoll: jest.fn()};
		sheet = {
			_isHubCharacter: true,
			_currentCharacterId: "character",
			_hubRollLogAdapter: new HubRollLogAdapter({api, campaignId: "campaign", getCharacterId: () => sheet._currentCharacterId}),
			_state: {getSettings: () => ({})},
			_saveCurrentCharacter: jest.fn(),
			isCurrentCharacterReadOnly: () => false,
		};
		history = new CharacterSheetRollHistory(sheet, {recoveryStorage: storage});
	});

	it("dedupes local, socket, POST and reload in both response orders without resubmitting history", async () => {
		await history.activateHubScope(scope);
		history.onHubConnectionState({state: "live"});
		await flush();
		const response = deferred();
		api.pLogRoll.mockReturnValue(response.promise);
		history.addRoll({title: "Perception", total: 17, breakdown: "1d20+3"});
		const request = api.pLogRoll.mock.calls[0][0];
		const logged = event({commandId: request.idempotencyKey});
		history.receiveHubRoll(logged);
		expect(history.getRollCount()).toBe(1);
		response.resolve({event: logged});
		await flush();
		api.pListCharacterRollHistory.mockResolvedValue(page([logged]));
		await history.pRefreshHubHistory();
		expect(history.getRolls()).toHaveLength(1);
		expect(history.getRolls()[0]).toMatchObject({eventId: "event", syncState: "synced"});
		expect(api.pLogRoll).toHaveBeenCalledTimes(1);
		const second = event({id: "second", sequence: 11});
		history.receiveHubRoll(second);
		expect(history.getRolls().map(roll => roll.eventId)).toEqual(["second", "event"]);
		expect(sheet._saveCurrentCharacter).not.toHaveBeenCalled();
	});

	it("replaces an old HTTP snapshot while retaining socket rolls newer than its high-water boundary", async () => {
		await history.activateHubScope(scope);
		const read = deferred();
		api.pListCharacterRollHistory.mockReturnValue(read.promise);
		const refresh = history.pRefreshHubHistory();
		history.receiveHubRoll(event({id: "newer", sequence: 20}));
		read.resolve({...page([event({id: "older", sequence: 10})]), highWaterSequence: 10});
		await refresh;
		expect(history.getRolls().map(roll => roll.eventId)).toEqual(["newer", "older"]);
	});

	it("preserves exact attempted commands across reload and never automatically resends them", async () => {
		await history.activateHubScope(scope);
		history.onHubConnectionState({state: "live"});
		await flush();
		api.pLogRoll.mockRejectedValue(Object.assign(new Error("Lost response"), {code: "NETWORK_UNAVAILABLE", status: 0}));
		history.addRoll({title: "Perception", total: 17, breakdown: "1d20+3"});
		history.addRoll({title: "Perception", total: 17, breakdown: "1d20+3"});
		await flush();
		const first = api.pLogRoll.mock.calls[0][0];
		history.resetCharacterScopeUi();
		await history.activateHubScope(scope);
		expect(history.getRolls()).toHaveLength(2);
		expect(api.pLogRoll).toHaveBeenCalledTimes(2);
		api.pLogRoll.mockResolvedValue({event: event({commandId: first.idempotencyKey})});
		history.onHubConnectionState({state: "live"});
		await flush();
		await history.pRetryHubRoll(first.idempotencyKey);
		expect(api.pLogRoll.mock.calls[2][0]).toEqual(first);
		expect(history.getRolls().filter(roll => roll.syncState === "synced")).toHaveLength(1);
	});

	it("reconciles committed-but-lost responses after the receipt deadline without another POST", async () => {
		await history.activateHubScope(scope);
		history.onHubConnectionState({state: "live"});
		await flush();
		api.pLogRoll.mockRejectedValue(new Error("Lost"));
		history.addRoll({title: "Perception", total: 17, breakdown: "1d20+3"});
		await flush();
		const key = api.pLogRoll.mock.calls[0][0].idempotencyKey;
		const pending = history._pendingHubRolls.get(key);
		pending.command = {...pending.command, retryUntil: 0};
		api.pListCharacterRollHistory.mockImplementation(async request => page(request.commandId ? [event({commandId: key})] : []));
		await history.pRetryHubRoll(key);
		expect(api.pLogRoll).toHaveBeenCalledTimes(1);
		expect(history.getRolls()[0].syncState).toBe("synced");
	});

	it("fences late history and POST callbacks after access loss and deletes scoped recovery", async () => {
		await history.activateHubScope(scope);
		history.onHubConnectionState({state: "live"});
		await flush();
		const response = deferred();
		api.pLogRoll.mockReturnValue(response.promise);
		history.addRoll({title: "Perception", total: 17});
		const read = deferred();
		api.pListCharacterRollHistory.mockReturnValue(read.promise);
		const refresh = history.pRefreshHubHistory();
		history.onHubConnectionState({state: "access_lost"});
		response.resolve({event: event()});
		read.resolve(page([event()]));
		await refresh;
		await flush();
		expect(history.getRolls()).toEqual([]);
		api.pListCharacterRollHistory.mockResolvedValue(page([]));
		await history.activateHubScope(scope);
		expect(history.getRolls()).toEqual([]);
	});

	it("does not fetch or submit another owner's personal history on DM inspection or without a capability", async () => {
		sheet.isCurrentCharacterReadOnly = () => true;
		await history.activateHubScope(scope);
		history.addRoll({title: "Perception", total: 17});
		expect(api.pListCharacterRollHistory).not.toHaveBeenCalled();
		expect(api.pLogRoll).not.toHaveBeenCalled();
		expect(history.getRolls()).toEqual([]);
		sheet.isCurrentCharacterReadOnly = () => false;
		await history.activateHubScope({...scope, isEnabled: false});
		history.addRoll({title: "Perception", total: 17});
		expect(api.pLogRoll).not.toHaveBeenCalled();
		expect(history.getRolls()[0].syncState).toBe("unsynced");
	});

	it("keeps campaign history when Clear is attempted and keeps unsupported/offline rolls unsynced", async () => {
		api.pListCharacterRollHistory.mockResolvedValue(page([event()]));
		await history.activateHubScope(scope);
		history.clear();
		expect(history.getRollCount()).toBe(1);
		history.addRoll({title: "DC", total: "DC 15"});
		history.addRoll({title: "Offline", total: 17});
		history.onHubConnectionState({state: "live"});
		await flush();
		expect(api.pLogRoll).not.toHaveBeenCalled();
		expect(history.getRolls().filter(roll => roll.syncState === "unsynced")).toHaveLength(2);
	});

	it("rejects malformed and foreign history instead of publishing private or success-shaped rows", async () => {
		api.pListCharacterRollHistory.mockResolvedValue(page([event({actorAccountId: "peer"})]));
		await history.activateHubScope(scope);
		expect(history.getRolls()).toEqual([]);
		expect(history._hubHistoryError).toBeTruthy();
	});

	it("never confirms a mismatched correlated command through refresh or retry", async () => {
		await history.activateHubScope(scope);
		history.onHubConnectionState({state: "live"});
		await flush();
		api.pLogRoll.mockRejectedValue(new Error("Lost response"));
		history.addRoll({title: "Perception", total: 17, breakdown: "1d20+3"});
		await flush();
		const key = api.pLogRoll.mock.calls[0][0].idempotencyKey;
		const mismatch = event({commandId: key, total: 99});
		api.pListCharacterRollHistory.mockResolvedValue(page([mismatch]));
		expect(await history.pRefreshHubHistory()).toBe(false);
		expect(await history.pRetryHubRoll(key)).toBe(false);
		expect(history._pendingHubRolls.has(key)).toBe(true);
		expect(history.getRolls()[0]).toMatchObject({total: 17, syncState: "unconfirmed"});
		expect(api.pLogRoll).toHaveBeenCalledTimes(1);
		mismatch.payload.total = 17;
		mismatch.payload.detail.title = "Different roll";
		expect(await history.pRefreshHubHistory()).toBe(false);
		expect(history._pendingHubRolls.has(key)).toBe(true);
	});

	it("retains every outstanding command independently of the 200 authoritative rows", async () => {
		api.pListCharacterRollHistory.mockResolvedValue(page(Array.from({length: 200}, (_, i) => event({id: `e-${i}`, sequence: i + 1}))));
		await history.activateHubScope(scope);
		history.onHubConnectionState({state: "live"});
		await flush();
		api.pLogRoll.mockReturnValue(new Promise(() => {}));
		for (let i = 0; i < 5; i++) history.addRoll({title: "Perception", total: 17});
		expect(history._pendingHubRolls.size).toBe(5);
		expect(history.getRolls().filter(roll => roll.syncState === "synced")).toHaveLength(200);
	});

	it("restores display values from the frozen request, not mutable recovery metadata", async () => {
		await history.activateHubScope(scope);
		history.onHubConnectionState({state: "live"});
		await flush();
		api.pLogRoll.mockRejectedValue(new Error("Lost response"));
		history.addRoll({title: "Perception", total: 17, breakdown: "1d20+3"});
		await flush();
		const key = "hub-roll-recovery:owner:campaign:character";
		const saved = JSON.parse(storage.getItem(key));
		saved.rolls[0].title = {malformed: true};
		saved.rolls[0].total = 99;
		saved.rolls[0].rollType = "ATTACK";
		storage.setItem(key, JSON.stringify(saved));
		history.resetCharacterScopeUi();
		await history.activateHubScope(scope);
		expect(history.getRolls()[0]).toMatchObject({title: "Perception", total: 17, rollType: "SKILL", breakdown: "1d20+3", syncState: "unconfirmed"});
		expect(api.pLogRoll).toHaveBeenCalledTimes(1);
	});

	it("rejects socket events after the page changes character before attachment completes", async () => {
		await history.activateHubScope(scope);
		sheet._currentCharacterId = "replacement";
		expect(history.receiveHubRoll(event())).toBe(false);
		expect(history.getRolls()).toEqual([]);
	});

	it("reports storage failures without sending a roll or hiding failed access-loss cleanup", async () => {
		await history.activateHubScope(scope);
		history.onHubConnectionState({state: "live"});
		await flush();
		storage.setItem = () => { throw new Error("Storage full"); };
		history.addRoll({title: "Perception", total: 17, breakdown: "1d20+3"});
		expect(api.pLogRoll).not.toHaveBeenCalled();
		expect(history.getRolls()[0]).toMatchObject({syncState: "unsynced", syncError: expect.stringContaining("Storage full")});
		storage.removeItem = () => { throw new Error("Storage denied"); };
		history.onHubConnectionState({state: "access_lost"});
		expect(history._hubRecoveryError).toContain("Storage denied");
		expect(history.getRolls()).toEqual([]);
	});

	it("conceals old-role rows and fences delayed reads while preserving attempted recovery", async () => {
		api.pListCharacterRollHistory.mockResolvedValue(page([{...event(), visibility: "dm_only"}]));
		await history.activateHubScope(scope);
		history.onHubConnectionState({state: "live"});
		await flush();
		api.pLogRoll.mockRejectedValue(new Error("Lost response"));
		history.addRoll({title: "Perception", total: 17, breakdown: "1d20+3"});
		await flush();
		const commandId = api.pLogRoll.mock.calls[0][0].idempotencyKey;
		const read = deferred();
		api.pListCharacterRollHistory.mockReturnValueOnce(read.promise).mockRejectedValueOnce(new Error("Replacement failed"));
		const oldRead = history.pRefreshHubHistory();
		history.onHubAuthorityChanged();
		expect(history.getRolls().filter(roll => roll.syncState === "synced")).toEqual([]);
		read.resolve(page([{...event(), visibility: "dm_only"}]));
		expect(await oldRead).toBe(false);
		await flush();
		expect(history.getRolls().filter(roll => roll.syncState === "synced")).toEqual([]);
		expect(history._pendingHubRolls.has(commandId)).toBe(true);
		expect(history._hubHistoryError).toContain("Replacement failed");
		for (const state of ["disconnected", "suspended"]) {
			history.onHubConnectionState({state});
			expect(history._isHubAuthorityInvalid).toBe(true);
			expect(history.receiveHubRoll(event())).toBe(false);
			expect(await history.pRetryHubRoll(commandId)).toBe(false);
			history.addRoll({title: "Perception", total: 17, breakdown: "1d20+3"});
			expect(api.pLogRoll).toHaveBeenCalledTimes(1);
			expect(history.getRolls().filter(roll => roll.syncState === "synced")).toEqual([]);
		}
		api.pListCharacterRollHistory.mockResolvedValue(page([]));
		expect(await history.pRefreshHubHistory()).toBe(true);
		expect(history._isHubAuthorityInvalid).toBe(false);
		expect(history._pendingHubRolls.has(commandId)).toBe(true);
		expect(api.pLogRoll).toHaveBeenCalledTimes(1);
	});

	it("resets the revoked-role fence on a newly activated character scope", async () => {
		await history.activateHubScope(scope);
		api.pListCharacterRollHistory.mockRejectedValue(new Error("Replacement failed"));
		history.onHubAuthorityChanged();
		await flush();
		expect(history._isHubAuthorityInvalid).toBe(true);
		history._isHubAuthorityRefreshRequired = true;
		sheet._currentCharacterId = "replacement";
		api.pListCharacterRollHistory.mockResolvedValue(page([]));
		await history.activateHubScope({...scope, characterId: "replacement"});
		expect(history._isHubAuthorityInvalid).toBe(false);
		expect(history._isHubAuthorityRefreshRequired).toBe(false);
		expect(history._hubScope.characterId).toBe("replacement");
	});

	it("refills socket arrivals during authority replacement without revealing old-role rows", async () => {
		api.pListCharacterRollHistory.mockResolvedValue(page([{...event(), visibility: "dm_only"}]));
		await history.activateHubScope(scope);
		const replacement = deferred();
		api.pListCharacterRollHistory.mockReturnValueOnce(replacement.promise);
		history.onHubAuthorityChanged();
		const newRoll = event({id: "new-role-roll", sequence: 11});
		expect(history.receiveHubRoll(newRoll)).toBe(false);
		api.pListCharacterRollHistory.mockResolvedValue(page([newRoll]));
		replacement.resolve({...page([]), highWaterSequence: 10});
		await flush();
		expect(history.getRolls().map(roll => roll.eventId)).toEqual(["new-role-roll"]);
		expect(api.pListCharacterRollHistory).toHaveBeenCalledTimes(3);
	});
});
