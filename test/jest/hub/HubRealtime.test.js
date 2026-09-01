import {EventEmitter} from "node:events";
import {HubOutboxDispatcher, HubRealtime} from "../../../server/src/realtime.js";
import {canViewEvent} from "../../../server/src/projections.js";
import {computePeerProfile, getDefaultProjectionPolicy} from "../../../server/src/character-projection.js";

class FakeSocket extends EventEmitter {
	readyState = 1;
	sent = [];
	closeEvents = [];
	send (message) { this.sent.push(JSON.parse(message)); }
	close (code = 1000, reason = "") {
		this.closeEvents.push({code, reason});
		this.readyState = 3;
		this.emit("close", {code, reason});
	}
}

class HeartbeatSocket extends FakeSocket {
	pingCount = 0;
	ping () { this.pingCount++; }
	terminate () { this.close(); }
}

describe("hub projections and event visibility", () => {
	it("removes private character fields from player projections", () => {
		const projected = computePeerProfile({
			character: {
				id: "c1",
				ownerAccountId: "a1",
				campaignId: "cmp",
				revision: 2,
				projectionRevision: 1,
				projectionPolicy: getDefaultProjectionPolicy(),
				data: {
					name: "Mira",
					hp: {current: 10},
					notes: {backstory: "Secret"},
					inventory: [{name: "Secret Item"}],
				},
			},
		});

		expect(projected.kind).toBe("peer_profile");
		expect(projected.data.identity).toEqual({name: "Mira"});
		expect(projected.data.hp).toEqual({current: 10});
		// The owner account id is never a peer field, and the `table` default keeps both
		// inventory-derived summaries closed.
		expect(projected.ownerAccountId).toBeUndefined();
		expect(projected.data.inventorySummary).toBeUndefined();
		expect(projected.data.carrySummary).toBeUndefined();
		expect(JSON.stringify(projected)).not.toContain("Secret");
	});

	it("enforces all event visibility modes", () => {
		expect(canViewEvent({event: {visibility: "all_members"}, accountId: "p", role: "player"})).toBe(true);
		expect(canViewEvent({event: {visibility: "dm_only"}, accountId: "p", role: "player"})).toBe(false);
		expect(canViewEvent({event: {visibility: "dm_only"}, accountId: "d", role: "dm"})).toBe(true);
		expect(canViewEvent({event: {visibility: "actor_and_dm", actorAccountId: "p"}, accountId: "p", role: "player"})).toBe(true);
		expect(canViewEvent({event: {visibility: "explicit_accounts", visibleAccountIds: ["p"]}, accountId: "x", role: "player"})).toBe(false);
	});
});

describe("hub realtime", () => {
	it("keeps responsive sockets alive and terminates missed heartbeats", () => {
		const timers = [];
		const cleared = [];
		const realtime = new HubRealtime({
			store: {},
			fnSetInterval: fn => {
				timers.push(fn);
				return timers.length;
			},
			fnClearInterval: timer => cleared.push(timer),
		});
		const socket = new HeartbeatSocket();
		realtime.addConnection({
			socket,
			account: {id: "p", displayName: "P"},
			session: {id: "s"},
			membership: {id: "m", role: "player"},
			campaignId: "cmp",
		});
		timers[0]();
		expect(socket.pingCount).toBe(1);
		socket.emit("pong");
		timers[0]();
		expect(socket.pingCount).toBe(2);
		timers[0]();
		expect(socket.readyState).toBe(3);
		expect(cleared).toContain(1);
	});

	it("filters published events per subscriber role", async () => {
		const realtime = new HubRealtime({store: {
			pGetMembership: async ({accountId}) => ({role: accountId === "dm" ? "dm" : "player"}),
			pGetSessionById: async () => ({session: {}, account: {}}),
		}});
		const dm = new FakeSocket();
		const player = new FakeSocket();
		realtime.addConnection({socket: dm, account: {id: "dm", displayName: "DM"}, session: {id: "s1"}, membership: {id: "m1", role: "dm"}, campaignId: "cmp"});
		realtime.addConnection({socket: player, account: {id: "p", displayName: "Player"}, session: {id: "s2"}, membership: {id: "m2", role: "player"}, campaignId: "cmp"});
		dm.sent.length = 0;
		player.sent.length = 0;

		await realtime.pPublishEvent({campaignId: "cmp", visibility: "dm_only", type: "roll.logged"});
		expect(dm.sent.filter(message => message.type === "event")).toHaveLength(1);
		expect(player.sent.filter(message => message.type === "event")).toHaveLength(0);
	});

	it("closes sockets whose session was revoked before publication", async () => {
		const realtime = new HubRealtime({store: {
			pGetSessionById: async () => null,
			pGetMembership: async () => ({role: "player"}),
		}});
		const socket = new FakeSocket();
		realtime.addConnection({socket, account: {id: "p", displayName: "P"}, session: {id: "revoked"}, membership: {id: "m", role: "player"}, campaignId: "cmp"});
		await realtime.pPublishEvent({campaignId: "cmp", visibility: "all_members"});
		expect(socket.readyState).toBe(3);
	});

	it("uses a reconnectable close code when a client exceeds the message rate limit", async () => {
		const realtime = new HubRealtime({store: {
			pGetSessionById: async () => ({session: {}, account: {}}),
			pGetMembership: async () => ({role: "player"}),
		}});
		const socket = new FakeSocket();
		realtime.addConnection({
			socket,
			account: {id: "p", displayName: "P"},
			session: {id: "s"},
			membership: {id: "m", role: "player"},
			campaignId: "cmp",
		});
		const connection = realtime._connections.get(socket);
		for (let i = 0; i < 21; ++i) {
			await realtime._pHandleMessage({connection, raw: Buffer.from(JSON.stringify({type: "presence", activity: "idle"}))});
		}

		expect(socket.closeEvents).toContainEqual({code: 1013, reason: "Rate limit exceeded"});
	});

	it("closes only the affected account/campaign sockets on lifecycle changes", () => {
		const realtime = new HubRealtime({store: {}});
		const target = new FakeSocket();
		const otherCampaign = new FakeSocket();
		const otherAccount = new FakeSocket();
		realtime.addConnection({socket: target, account: {id: "p", displayName: "P"}, session: {id: "s1"}, membership: {id: "m1", role: "player"}, campaignId: "c1"});
		realtime.addConnection({socket: otherCampaign, account: {id: "p", displayName: "P"}, session: {id: "s2"}, membership: {id: "m2", role: "player"}, campaignId: "c2"});
		realtime.addConnection({socket: otherAccount, account: {id: "x", displayName: "X"}, session: {id: "s3"}, membership: {id: "m3", role: "player"}, campaignId: "c1"});
		realtime.closeAccount({accountId: "p", campaignId: "c1", reason: "Membership removed"});
		expect(target.readyState).toBe(3);
		expect(otherCampaign.readyState).toBe(1);
		expect(otherAccount.readyState).toBe(1);
	});

	describe("realtime client ordering", () => {
		it("does not emit an older snapshot after a newer event", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			const client = new HubRealtimeClient({campaignId: "cmp", location: {protocol: "https:", host: "tools.example"}});
			const snapshots = [];
			client.on("snapshot", snapshot => snapshots.push(snapshot));
			client._handleMessage({type: "event", event: {sequence: 11, type: "x"}});
			client._handleMessage({type: "resync_complete", snapshot: {lastSequence: 10}, events: [{sequence: 11, type: "x"}]});
			expect(snapshots).toEqual([{lastSequence: 10}]);
			expect(client._lastSequence).toBe(11);
		});

		it("reconnects after a transient close and preserves the resync sequence", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			class BrowserSocket extends EventEmitter {
				readyState = 1;
				send () {}
				close () { this.emit("close", {code: 1000}); }
				addEventListener (type, listener) { this.on(type, listener); }
				removeEventListener (type, listener) { this.off(type, listener); }
			}
			const sockets = [];
			const timers = [];
			const client = new HubRealtimeClient({
				campaignId: "cmp",
				location: {protocol: "https:", host: "tools.example"},
				fnCreateSocket: () => {
					const socket = new BrowserSocket();
					sockets.push(socket);
					queueMicrotask(() => socket.emit("open"));
					return socket;
				},
				fnSetTimeout: fn => {
					timers.push(fn);
					return timers.length;
				},
			});
			await client.pConnect();
			sockets[0].emit("close", {code: 1013, reason: "Rate limit exceeded"});
			expect(timers).toHaveLength(1);
			timers.shift()();
			await new Promise(resolve => setImmediate(resolve));
			expect(sockets).toHaveLength(2);
			client.close();
		});

		it("uses one bounded authoritative resync watchdog while a socket stays live", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			class BrowserSocket extends EventEmitter {
				readyState = 1;
				sent = [];
				send (message) { this.sent.push(JSON.parse(message)); }
				close () { this.readyState = 3; this.emit("close", {code: 1000}); }
				addEventListener (type, listener) { this.on(type, listener); }
				removeEventListener (type, listener) { this.off(type, listener); }
			}
			const socket = new BrowserSocket();
			const intervals = new Map();
			const cleared = [];
			let nextIntervalId = 0;
			const client = new HubRealtimeClient({
				campaignId: "cmp",
				location: {protocol: "https:", host: "tools.example"},
				fnCreateSocket: () => {
					queueMicrotask(() => socket.emit("open"));
					return socket;
				},
				fnSetInterval: (fn, delay) => {
					const id = ++nextIntervalId;
					intervals.set(id, {fn, delay});
					return id;
				},
				fnClearInterval: id => {
					cleared.push(id);
					intervals.delete(id);
				},
			});
			await client.pConnect();
			expect([...intervals.values()].map(({delay}) => delay)).toEqual([10_000]);
			client._handleMessage({type: "resync_complete", snapshot: {lastSequence: 3}, events: []});
			client._handleMessage({type: "resync_complete", snapshot: {lastSequence: 3}, events: []});

			expect([...intervals.values()].map(({delay}) => delay)).toEqual([10_000]);
			intervals.values().next().value.fn();
			expect(socket.sent.at(-1)).toEqual({type: "resync", afterSequence: 3});
			client.close();
			expect(cleared).toEqual([1]);
		});

		it("surfaces lifecycle state and does not reconnect after access is revoked", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			class BrowserSocket extends EventEmitter {
				readyState = 1;
				send () {}
				close () { this.emit("close", {code: 1000}); }
				addEventListener (type, listener) { this.on(type, listener); }
				removeEventListener (type, listener) { this.off(type, listener); }
			}
			const socket = new BrowserSocket();
			const timers = [];
			const states = [];
			const client = new HubRealtimeClient({
				campaignId: "cmp",
				location: {protocol: "https:", host: "tools.example"},
				fnCreateSocket: () => {
					queueMicrotask(() => socket.emit("open"));
					return socket;
				},
				fnSetTimeout: fn => {
					timers.push(fn);
					return timers.length;
				},
			});
			client.on("state", state => states.push(state));
			await client.pConnect();
			socket.emit("close", {code: 1008, reason: "Membership removed"});
			expect(states.map(it => it.state)).toEqual(["connecting", "syncing", "access_lost"]);
			expect(client.getConnectionState()).toEqual({
				state: "access_lost",
				code: 1008,
				reason: "Membership removed",
			});
			expect(timers).toHaveLength(0);
		});
	});

	it("returns a metadata-only cursor and delta events on resync", async () => {
		let snapshotCalls = 0;
		const store = {
			pGetSessionById: async () => ({session: {}, account: {}}),
			pGetMembership: async () => ({role: "player"}),
			pGetCampaignSnapshot: async () => { snapshotCalls++; return {}; },
			pGetCampaignCursor: async () => ({
				cursor: {campaignId: "cmp", lastSequence: 3},
				campaign: {id: "cmp"},
				membership: {role: "player"},
				characterRefs: [{id: "c1", revision: 7, projectionRevision: 2}],
			}),
			pListVisibleEvents: async () => [{sequence: 4, type: "roll.logged"}],
		};
		const realtime = new HubRealtime({store});
		const socket = new FakeSocket();
		realtime.addConnection({socket, account: {id: "p", displayName: "Player"}, session: {id: "s"}, membership: {id: "m", role: "player"}, campaignId: "cmp"});
		socket.emit("message", Buffer.from(JSON.stringify({type: "resync", afterSequence: 3})));
		await new Promise(resolve => setImmediate(resolve));

		expect(socket.sent).toContainEqual({
			type: "resync_complete",
			cursor: {campaignId: "cmp", lastSequence: 3},
			campaign: {id: "cmp"},
			membership: {role: "player"},
			characterRefs: [{id: "c1", revision: 7, projectionRevision: 2}],
			events: [{sequence: 4, type: "roll.logged"}],
		});
		// ADR 0011: the realtime path must not reach the character projector at all, so a
		// second projection implementation cannot grow inside the socket.
		expect(snapshotCalls).toBe(0);
	});

	it("dispatches claimed outbox events and marks them published", async () => {
		const published = [];
		const store = {
			pClaimOutboxBatch: async () => [{id: 1, event: {campaignId: "cmp", visibility: "all_members"}}],
			pMarkOutboxPublished: async ({outboxId}) => published.push(outboxId),
			pMarkOutboxFailed: async () => {},
		};
		const seen = [];
		const dispatcher = new HubOutboxDispatcher({store, realtime: {pPublishEvent: async event => seen.push(event)}});
		await expect(dispatcher.pDispatchOnce()).resolves.toBe(1);
		expect(seen).toHaveLength(1);
		expect(published).toEqual([1]);
	});

	it("marks failed delivery and retries it on the next dispatch", async () => {
		let status = "pending";
		let attempts = 0;
		const store = {
			pClaimOutboxBatch: async () => ["pending", "failed"].includes(status) ? [{id: 1, event: {id: "e1"}}] : [],
			pMarkOutboxPublished: async () => status = "published",
			pMarkOutboxFailed: async () => status = "failed",
		};
		const dispatcher = new HubOutboxDispatcher({
			store,
			realtime: {
				pPublishEvent: async () => {
					if (++attempts === 1) throw new Error("transient");
				},
			},
		});
		await dispatcher.pDispatchOnce();
		expect(status).toBe("failed");
		expect(dispatcher.getStatus().consecutiveErrors).toBe(1);
		await dispatcher.pDispatchOnce();
		expect(status).toBe("published");
		expect(attempts).toBe(2);
		expect(dispatcher.getStatus()).toEqual(expect.objectContaining({
			consecutiveErrors: 0,
			lastBatchCount: 1,
		}));
	});
});
