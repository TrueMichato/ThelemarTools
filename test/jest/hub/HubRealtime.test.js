import {EventEmitter} from "node:events";
import {HubOutboxDispatcher, HubRealtime} from "../../../server/src/realtime.js";
import {canViewEvent} from "../../../server/src/projections.js";
import {computePeerProfile, getDefaultProjectionPolicy} from "../../../server/src/character-projection.js";
import {PostgresHubStore} from "../../../server/src/postgres-hub-store.js";

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

	it("never delivers a protocol-4 operation leg to a protocol-3 socket", async () => {
		const realtime = new HubRealtime({store: {
			pGetMembership: async () => ({role: "player"}),
			pGetSessionById: async () => ({session: {}, account: {}}),
		}});
		const legacy = new FakeSocket();
		const current = new FakeSocket();
		for (const [socket, protocolVersion] of [[legacy, "3"], [current, "4"]]) {
			realtime.addConnection({
				socket,
				account: {id: protocolVersion, displayName: protocolVersion},
				session: {id: protocolVersion},
				membership: {id: protocolVersion, role: "player"},
				campaignId: "cmp",
				protocolVersion,
			});
			socket.sent.length = 0;
		}
		await realtime.pPublishEvent({
			campaignId: "cmp",
			visibility: "all_members",
			type: "character.operation.source_cost_consumed",
			payload: {operationId: "operation", leg: "source"},
		});
		expect(legacy.closeEvents).toContainEqual({code: 1008, reason: "Protocol update required"});
		expect(current.sent).toContainEqual(expect.objectContaining({type: "event"}));
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
		it("reads PostgreSQL cursor authority and sequence from one repeatable-read snapshot", async () => {
			const queries = [];
			let isReleased = false;
			let poolQueryCount = 0;
			const client = {
				query: async (sql, params = []) => {
					queries.push({sql: sql.trim().replaceAll(/\s+/g, " "), params});
					if (sql.startsWith("BEGIN")) return {rows: [], rowCount: 0};
					if (sql.includes("FROM hub.memberships")) {
						return {
							rows: [{
								id: "membership-1",
								campaign_id: "cmp",
								account_id: "account-1",
								role: "player",
								status: "active",
							}],
							rowCount: 1,
						};
					}
					if (sql.includes("FROM hub.campaigns")) {
						return {
							rows: [{
								id: "cmp",
								owner_account_id: "dm-1",
								name: "Snapshot",
								status: "active",
								created_at: new Date("2026-09-05T00:00:00.000Z"),
								active_rules_version_id: null,
								active_brew_bundle_version_id: null,
							}],
							rowCount: 1,
						};
					}
					if (sql.includes("FROM hub.characters")) return {rows: [], rowCount: 0};
					if (sql.includes("FROM hub.domain_events")) return {rows: [{sequence: "2"}], rowCount: 1};
					if (sql === "COMMIT") return {rows: [], rowCount: 0};
					throw new Error(`Unexpected query: ${sql}`);
				},
				release: () => { isReleased = true; },
			};
			const pool = {
				connect: async () => client,
				query: async () => {
					poolQueryCount++;
					throw new Error("Cursor read escaped its transaction.");
				},
				on: () => {},
			};
			const store = new PostgresHubStore({pool});

			await expect(store.pGetCampaignCursor({accountId: "account-1", campaignId: "cmp"})).resolves.toEqual(expect.objectContaining({
				cursor: {campaignId: "cmp", lastSequence: 2},
				membership: expect.objectContaining({accountId: "account-1", role: "player"}),
			}));
			expect(queries.map(({sql}) => sql)).toEqual([
				"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
				expect.stringContaining("FROM hub.memberships"),
				expect.stringContaining("FROM hub.campaigns"),
				expect.stringContaining("FROM hub.characters"),
				expect.stringContaining("FROM hub.domain_events"),
				"COMMIT",
			]);
			expect(poolQueryCount).toBe(0);
			expect(isReleased).toBe(true);
		});

		it("reaches the live state even when a consumer listener throws", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			const errors = [];
			const client = new HubRealtimeClient({
				campaignId: "cmp",
				location: {protocol: "https:", host: "tools.example"},
				fnOnListenerError: (error, type) => errors.push({message: error.message, type}),
			});
			client.on("cursor", () => { throw new Error("consumer exploded"); });
			client._handleMessage({type: "resync_complete", cursor: {campaignId: "cmp", lastSequence: 3}, characterRefs: [], events: []});

			// A broken consumer must not strand the connection mid-handler.
			expect(client.getConnectionState().state).toBe("live");
			expect(errors).toEqual([{message: "consumer exploded", type: "cursor"}]);
		});

		it("does not emit an older baseline after a newer event", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			const client = new HubRealtimeClient({campaignId: "cmp", location: {protocol: "https:", host: "tools.example"}});
			const baselines = [];
			client.on("cursor", baseline => baselines.push(baseline));
			client._handleMessage({type: "event", event: {sequence: 11, type: "x"}});
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 10},
				characterRefs: [{id: "c1", revision: 4, projectionRevision: 2}],
				events: [{sequence: 11, type: "x"}],
			});

			expect(baselines).toHaveLength(1);
			expect(baselines[0].cursor).toEqual({campaignId: "cmp", lastSequence: 10});
			// The baseline carries cache-invalidation refs only, never character data.
			expect(baselines[0].characterRefs).toEqual([{id: "c1", revision: 4, projectionRevision: 2}]);
			expect(client._lastSequence).toBe(11);
		});

		it("uses the cursor for active context and omits snapshot-covered activation history", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			const client = new HubRealtimeClient({campaignId: "cmp", location: {protocol: "https:", host: "tools.example"}});
			const baselines = [];
			const events = [];
			client.on("cursor", baseline => baselines.push(baseline));
			client.on("event", event => events.push(event));

			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 4},
				campaign: {
					id: "cmp",
					activeRulesVersionId: "rules-2",
					activeBrewBundleVersionId: "brew-1",
				},
				characterRefs: [],
				events: [
					{id: "rules-1", sequence: 1, type: "rules.activated", aggregateId: "rules-1"},
					{id: "rules-2", sequence: 2, type: "rules.activated", aggregateId: "rules-2"},
					{id: "brew-1", sequence: 3, type: "brew.activated", aggregateId: "brew-1"},
					{id: "roll-1", sequence: 4, type: "roll.logged"},
				],
			});

			expect(baselines[0].campaign).toEqual(expect.objectContaining({
				activeRulesVersionId: "rules-2",
				activeBrewBundleVersionId: "brew-1",
			}));
			expect(events).toEqual([{id: "roll-1", sequence: 4, type: "roll.logged"}]);
		});

		it("lets consumers omit snapshot-covered role history while receiving a later live authority change", async () => {
			const {
				HubRealtimeClient,
				isRealtimeEventCoveredByBaseline,
			} = await import("../../../js/hub/hub-realtime-client.js");
			const client = new HubRealtimeClient({campaignId: "cmp", location: {protocol: "https:", host: "tools.example"}});
			const baselines = [];
			const events = [];
			let authorityBaselineSequence = 0;
			client.on("cursor", baseline => {
				baselines.push(baseline);
				authorityBaselineSequence = Math.max(authorityBaselineSequence, baseline.cursor?.lastSequence || 0);
			});
			client.on("event", event => {
				if (!isRealtimeEventCoveredByBaseline({event, baselineSequence: authorityBaselineSequence})) events.push(event);
			});

			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 2},
				campaign: {id: "cmp", status: "active"},
				membership: {accountId: "account-1", role: "player"},
				characterRefs: [],
				events: [
					{id: "role-spectator", sequence: 1, type: "membership.role_changed", payload: {accountId: "account-1", role: "spectator"}},
					{id: "role-player", sequence: 2, type: "membership.role_changed", payload: {accountId: "account-1", role: "player"}},
				],
			});

			expect(baselines).toEqual([expect.objectContaining({
				membership: {accountId: "account-1", role: "player"},
			})]);
			expect(events).toEqual([]);

			const liveDowngrade = {
				id: "role-live-spectator",
				sequence: 3,
				type: "membership.role_changed",
				payload: {accountId: "account-1", role: "spectator"},
			};
			client._handleMessage({type: "event", event: liveDowngrade});

			expect(events).toEqual([liveDowngrade]);
		});

		it("continues replay from the server-scanned sequence even when a page has no visible events", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			const sent = [];
			const events = [];
			const client = new HubRealtimeClient({campaignId: "cmp", location: {protocol: "https:", host: "tools.example"}});
			client._socket = {
				readyState: 1,
				send: raw => sent.push(JSON.parse(raw)),
			};
			client.on("event", event => events.push(event));

			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 501},
				characterRefs: [],
				events: [],
				replay: {scannedThroughSequence: 500, hasMore: true},
			});
			expect(sent).toEqual([{type: "resync", afterSequence: 500}]);
			expect(client.getConnectionState().state).not.toBe("live");

			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 501},
				characterRefs: [],
				events: [{id: "applied-event", sequence: 501, type: "character.operation.applied"}],
				replay: {scannedThroughSequence: 501, hasMore: false},
			});
			expect(events).toEqual([{id: "applied-event", sequence: 501, type: "character.operation.applied"}]);
			expect(client.getConnectionState().state).toBe("live");
		});

		it("buffers live events during a periodic multi-page replay without dropping recovered events", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			const sent = [];
			const events = [];
			const client = new HubRealtimeClient({campaignId: "cmp", location: {protocol: "https:", host: "tools.example"}});
			client._socket = {
				readyState: 1,
				send: raw => sent.push(JSON.parse(raw)),
			};
			client.on("event", event => events.push(event));
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 0},
				characterRefs: [],
				events: [],
				replay: {scannedThroughSequence: 0, hasMore: false},
			});

			client.requestResync();
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 1_001},
				characterRefs: [],
				events: [{id: "recovered-100", sequence: 100, type: "character.operation.proposed"}],
				replay: {scannedThroughSequence: 500, hasMore: true},
			});
			client.requestResync();
			client._handleMessage({type: "event", event: {id: "live-1001", sequence: 1_001, type: "roll.logged"}});
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 1_001},
				characterRefs: [],
				events: [
					{id: "recovered-600", sequence: 600, type: "character.operation.applied"},
					{id: "live-1001", sequence: 1_001, type: "roll.logged"},
				],
				replay: {scannedThroughSequence: 1_001, hasMore: false},
			});

			expect(sent).toEqual([
				{type: "resync", afterSequence: 0},
				{type: "resync", afterSequence: 500},
			]);
			expect(events.map(event => event.id)).toEqual(["recovered-100", "recovered-600", "live-1001"]);
			expect(client._lastSequence).toBe(1_001);
			expect(client.getConnectionState().state).toBe("live");
		});

		it("restarts a malformed replay chain without stranding buffered live events", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			const sent = [];
			const events = [];
			const errors = [];
			const client = new HubRealtimeClient({campaignId: "cmp", location: {protocol: "https:", host: "tools.example"}});
			client._socket = {
				readyState: 1,
				send: raw => sent.push(JSON.parse(raw)),
			};
			client.on("event", event => events.push(event));
			client.on("error", error => errors.push(error));
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 10},
				characterRefs: [],
				events: [],
				replay: {scannedThroughSequence: 10, hasMore: false},
			});

			client.requestResync();
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 30},
				characterRefs: [],
				events: [{id: "recovered-11", sequence: 11, type: "character.operation.proposed"}],
				replay: {scannedThroughSequence: 20, hasMore: true},
			});
			client._handleMessage({type: "event", event: {id: "live-30", sequence: 30, type: "roll.logged"}});
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 30},
				characterRefs: [],
				events: [{id: "invalid-page", sequence: 21, type: "character.operation.applied"}],
				replay: {scannedThroughSequence: 20, hasMore: true},
			});

			expect(errors).toEqual([{type: "error", code: "INVALID_REPLAY_CONTINUATION"}]);
			expect(sent).toEqual([
				{type: "resync", afterSequence: 10},
				{type: "resync", afterSequence: 20},
				{type: "resync", afterSequence: 10},
			]);
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 30},
				characterRefs: [],
				events: [
					{id: "recovered-11", sequence: 11, type: "character.operation.proposed"},
					{id: "recovered-21", sequence: 21, type: "character.operation.applied"},
					{id: "live-30", sequence: 30, type: "roll.logged"},
				],
				replay: {scannedThroughSequence: 30, hasMore: false},
			});

			expect(events.map(event => event.id)).toEqual(["recovered-11", "recovered-21", "live-30"]);
			expect(client._lastSequence).toBe(30);
			expect(client.getConnectionState().state).toBe("live");
		});

		it("reconnects after any server error during replay without stranding live events", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			class BrowserSocket extends EventEmitter {
				readyState = 1;
				sent = [];
				send (message) { this.sent.push(JSON.parse(message)); }
				close () {
					this.readyState = 3;
					this.emit("close", {code: 1000});
				}
				addEventListener (type, listener) { this.on(type, listener); }
				removeEventListener (type, listener) { this.off(type, listener); }
			}
			const sockets = [];
			const timers = [];
			const events = [];
			const errors = [];
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
			client.on("event", event => events.push(event));
			client.on("error", error => errors.push(error));
			await client.pConnect();
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 0},
				characterRefs: [],
				events: [],
				replay: {scannedThroughSequence: 0, hasMore: false},
			});

			client.requestResync();
			client._handleMessage({type: "error", code: "REPLAY_UNAVAILABLE"});
			for (let sequence = 1; sequence <= 10; ++sequence) {
				client._handleMessage({type: "event", event: {id: `live-${sequence}`, sequence, type: "roll.logged"}});
				client.requestResync();
			}

			expect(errors).toEqual([{type: "error", code: "REPLAY_UNAVAILABLE"}]);
			expect(events).toEqual([]);
			expect(sockets[0].sent).toEqual([
				{type: "resync", afterSequence: 0},
				{type: "resync", afterSequence: 0},
			]);
			expect(timers).toHaveLength(1);
			timers.shift()();
			await new Promise(resolve => setImmediate(resolve));
			expect(sockets[1].sent).toEqual([{type: "resync", afterSequence: 0}]);
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 10},
				characterRefs: [],
				events: Array.from({length: 10}, (_, ix) => ({
					id: `live-${ix + 1}`,
					sequence: ix + 1,
					type: "roll.logged",
				})),
				replay: {scannedThroughSequence: 10, hasMore: false},
			});

			expect(events.map(event => event.id)).toEqual(Array.from({length: 10}, (_, ix) => `live-${ix + 1}`));
			expect(client._lastSequence).toBe(10);
			expect(client.getConnectionState().state).toBe("live");
			client.close();
		});

		it("reconnects after a transient close and preserves the resync sequence", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			class BrowserSocket extends EventEmitter {
				readyState = 1;
				sent = [];
				send (message) { this.sent.push(JSON.parse(message)); }
				close () { this.emit("close", {code: 1000}); }
				addEventListener (type, listener) { this.on(type, listener); }
				removeEventListener (type, listener) { this.off(type, listener); }
			}
			const sockets = [];
			const timers = [];
			const events = [];
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
			client.on("event", event => events.push(event));
			await client.pConnect();
			expect(sockets[0].sent).toEqual([{type: "resync", afterSequence: 0}]);
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 501},
				characterRefs: [],
				events: [{id: "proposal", sequence: 1, type: "character.operation.proposed"}],
				replay: {scannedThroughSequence: 500, hasMore: true},
			});
			expect(sockets[0].sent.at(-1)).toEqual({type: "resync", afterSequence: 500});
			sockets[0].emit("close", {code: 1013, reason: "Rate limit exceeded"});
			expect(timers).toHaveLength(1);
			timers.shift()();
			await new Promise(resolve => setImmediate(resolve));
			expect(sockets).toHaveLength(2);
			expect(sockets[1].sent).toEqual([{type: "resync", afterSequence: 500}]);
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 501},
				characterRefs: [],
				events: [{id: "applied", sequence: 501, type: "character.operation.applied"}],
				replay: {scannedThroughSequence: 501, hasMore: false},
			});
			expect(events.map(event => event.id)).toEqual(["proposal", "applied"]);
			client.close();
		});

		it("suspends mid-replay and resumes the same cursor, buffered events, and dedupe state", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			class BrowserSocket extends EventEmitter {
				readyState = 1;
				sent = [];
				send (message) { this.sent.push(JSON.parse(message)); }
				close () {
					this.readyState = 3;
					this.emit("close", {code: 1000});
				}
				addEventListener (type, listener) { this.on(type, listener); }
				removeEventListener (type, listener) { this.off(type, listener); }
			}
			const sockets = [];
			const events = [];
			const client = new HubRealtimeClient({
				campaignId: "cmp",
				location: {protocol: "https:", host: "tools.example"},
				fnCreateSocket: () => {
					const socket = new BrowserSocket();
					sockets.push(socket);
					queueMicrotask(() => socket.emit("open"));
					return socket;
				},
			});
			client.on("event", event => events.push(event.id));
			await client.pConnect();
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 0},
				characterRefs: [],
				events: [],
				replay: {scannedThroughSequence: 0, hasMore: false},
			});
			client._handleMessage({type: "event", event: {id: "stable", sequence: 1, type: "roll.logged"}});
			client.requestResync();
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 4},
				characterRefs: [],
				events: [{id: "partial", sequence: 2, type: "character.operation.proposed"}],
				replay: {scannedThroughSequence: 2, hasMore: true},
			});
			client._handleMessage({type: "event", event: {id: "live", sequence: 4, type: "roll.logged"}});

			client.suspend();
			expect(client._resyncAccumulatedEvents.map(event => event.id)).toEqual(["partial"]);
			expect(client._bufferedEvents.map(event => event.id)).toEqual(["live"]);
			expect(client._resyncScannedThroughSequence).toBe(2);
			await client.pConnect();
			expect(sockets[1].sent).toEqual([{type: "resync", afterSequence: 2}]);
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 4},
				characterRefs: [],
				events: [
					{id: "stable", sequence: 3, type: "roll.logged"},
					{id: "live", sequence: 4, type: "roll.logged"},
				],
				replay: {scannedThroughSequence: 4, hasMore: false},
			});

			expect(events).toEqual(["stable", "partial", "live"]);
			expect(client._lastSequence).toBe(4);
			expect(client.getConnectionState().state).toBe("live");
			client.close();
		});

		it("clears partial replay state on explicit close and starts another campaign at zero", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			const client = new HubRealtimeClient({campaignId: "first", location: {protocol: "https:", host: "tools.example"}});
			client._socket = {readyState: 1, send: () => {}, close: () => {}};
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "first", lastSequence: 501},
				characterRefs: [],
				events: [{id: "partial", sequence: 1, type: "character.operation.proposed"}],
				replay: {scannedThroughSequence: 500, hasMore: true},
			});
			expect(client._resyncAccumulatedEvents).toHaveLength(1);
			expect(client._resyncScannedThroughSequence).toBe(500);
			client.close();
			expect(client._resyncAccumulatedEvents).toEqual([]);
			expect(client._resyncScannedThroughSequence).toBeNull();

			const sent = [];
			const nextCampaign = new HubRealtimeClient({campaignId: "second", location: {protocol: "https:", host: "tools.example"}});
			nextCampaign._socket = {readyState: 1, send: raw => sent.push(JSON.parse(raw))};
			nextCampaign.requestResync();
			expect(sent).toEqual([{type: "resync", afterSequence: 0}]);
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
			client._handleMessage({type: "resync_complete", cursor: {campaignId: "cmp", lastSequence: 3}, characterRefs: [], events: []});
			client._handleMessage({type: "resync_complete", cursor: {campaignId: "cmp", lastSequence: 3}, characterRefs: [], events: []});

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

		it("ignores messages and close events from a replaced socket generation", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			class BrowserSocket extends EventEmitter {
				readyState = 1;
				sent = [];
				send (message) { this.sent.push(JSON.parse(message)); }
				close () { this.readyState = 3; this.emit("close", {code: 1000}); }
				addEventListener (type, listener) { this.on(type, listener); }
				removeEventListener (type, listener) { this.off(type, listener); }
			}
			const sockets = [];
			const timers = [];
			const states = [];
			const events = [];
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
			client.on("state", state => states.push(state.state));
			client.on("event", event => events.push(event.id));
			await client.pConnect();
			sockets[0].emit("message", {data: JSON.stringify({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 5},
				characterRefs: [],
				events: [],
			})});
			sockets[0].emit("close", {code: 1013});
			timers.shift()();
			await new Promise(resolve => setImmediate(resolve));
			expect(sockets).toHaveLength(2);
			sockets[1].emit("message", {data: JSON.stringify({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 6},
				characterRefs: [],
				events: [],
			})});

			sockets[0].emit("message", {data: JSON.stringify({
				type: "event",
				event: {id: "stale", campaignId: "cmp", sequence: 99, type: "roll.logged"},
			})});
			sockets[0].emit("close", {code: 1008, reason: "stale access loss"});
			sockets[1].emit("message", {data: JSON.stringify({
				type: "event",
				event: {id: "current", campaignId: "cmp", sequence: 7, type: "roll.logged"},
			})});

			expect(events).toEqual(["current"]);
			expect(client._lastSequence).toBe(7);
			expect(client.getConnectionState().state).toBe("live");
			expect(states).not.toContain("access_lost");
			client.close();
		});

		it("delivers semantic operations even when canonical truth reports a covering watermark", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			const client = new HubRealtimeClient({campaignId: "cmp", location: {protocol: "https:", host: "tools.example"}});
			const events = [];
			const cursors = [];
			client.on("event", event => events.push(event));
			client.on("cursor", cursor => cursors.push(cursor));

			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 20},
				characterRefs: [{id: "c1", revision: 4, projectionRevision: 2, operationWatermark: 19}],
				events: [{
					id: "operation-event",
					campaignId: "cmp",
					sequence: 19,
					type: "character.operation.applied",
				}],
			});

			expect(events).toEqual([expect.objectContaining({id: "operation-event", sequence: 19})]);
			expect(cursors[0].characterRefs[0].operationWatermark).toBe(19);
			expect(client._lastSequence).toBe(20);
		});

		it("deduplicates a repeated event id even if it arrives with a newer sequence", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			const client = new HubRealtimeClient({campaignId: "cmp", location: {protocol: "https:", host: "tools.example"}});
			const events = [];
			client.on("event", event => events.push(event.sequence));
			client._handleMessage({type: "resync_complete", cursor: {campaignId: "cmp", lastSequence: 3}, characterRefs: [], events: []});
			client._handleMessage({type: "event", event: {id: "stable-id", sequence: 4, type: "roll.logged"}});
			client._handleMessage({type: "event", event: {id: "stable-id", sequence: 5, type: "roll.logged"}});

			expect(events).toEqual([4]);
			expect(client._lastSequence).toBe(5);
		});

		it("pages a capped replay before advancing to the snapshot cursor", async () => {
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
			const events = [];
			const client = new HubRealtimeClient({
				campaignId: "cmp",
				location: {protocol: "https:", host: "tools.example"},
				fnCreateSocket: () => {
					queueMicrotask(() => socket.emit("open"));
					return socket;
				},
			});
			client.on("event", event => events.push(event.sequence));
			await client.pConnect();
			socket.emit("message", {data: JSON.stringify({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 600},
				characterRefs: [],
				events: Array.from({length: 500}, (_, ix) => ({
					id: `event-${ix + 1}`,
					sequence: ix + 1,
					type: "roll.logged",
				})),
				replay: {scannedThroughSequence: 500, hasMore: true},
			})});

			expect(socket.sent.at(-1)).toEqual({type: "resync", afterSequence: 500});
			expect(client._lastSequence).toBe(0);
			expect(client.getConnectionState().state).toBe("syncing");
			socket.emit("message", {data: JSON.stringify({
				type: "event",
				event: {id: "event-550", sequence: 550, type: "character.operation.applied"},
			})});
			socket.emit("message", {data: JSON.stringify({
				type: "event",
				event: {id: "event-601", sequence: 601, type: "roll.logged"},
			})});
			socket.emit("message", {data: JSON.stringify({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 600},
				characterRefs: [],
				events: Array.from({length: 100}, (_, ix) => ({
					id: `event-${ix + 501}`,
					sequence: ix + 501,
					type: ix === 49 ? "character.operation.applied" : "roll.logged",
				})),
				replay: {scannedThroughSequence: 600, hasMore: false},
			})});

			expect(events).toHaveLength(601);
			expect(events).toContain(550);
			expect(events.at(-1)).toBe(601);
			expect(events.filter(sequence => sequence === 550)).toHaveLength(1);
			expect(client._lastSequence).toBe(601);
			expect(client.getConnectionState().state).toBe("live");
			client.close();
		});

		it("reconnects when the resync watchdog observes no progress for a full interval", async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			class BrowserSocket extends EventEmitter {
				readyState = 1;
				send () {}
				close (code = 1000, reason = "") {
					this.readyState = 3;
					this.emit("close", {code, reason});
				}
				addEventListener (type, listener) { this.on(type, listener); }
				removeEventListener (type, listener) { this.off(type, listener); }
			}
			const socket = new BrowserSocket();
			const intervals = [];
			const reconnects = [];
			const client = new HubRealtimeClient({
				campaignId: "cmp",
				location: {protocol: "https:", host: "tools.example"},
				fnCreateSocket: () => {
					queueMicrotask(() => socket.emit("open"));
					return socket;
				},
				fnSetInterval: fn => {
					intervals.push(fn);
					return intervals.length;
				},
				fnSetTimeout: fn => {
					reconnects.push(fn);
					return reconnects.length;
				},
			});
			await client.pConnect();
			intervals[0]();
			expect(socket.readyState).toBe(1);
			expect(reconnects).toHaveLength(0);
			intervals[0]();

			expect(socket.readyState).toBe(3);
			expect(reconnects).toHaveLength(1);
			expect(client.getConnectionState().state).toBe("reconnecting");
			client.close();
		});
	});

	it("delivers 26 exact continuation pages once without tripping the burst limit", async () => {
		const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
		const pageCount = 26;
		const pageWidth = 500;
		const pageCalls = [];
		const store = {
			pGetSessionById: async () => ({session: {}, account: {}}),
			pGetMembership: async () => ({role: "player"}),
			pGetCampaignCursor: async () => ({
				cursor: {campaignId: "cmp", lastSequence: pageCount * pageWidth},
				campaign: {id: "cmp"},
				membership: {role: "player"},
				characterRefs: [],
			}),
			pListVisibleEventPage: async ({afterSequence}) => {
				pageCalls.push(afterSequence);
				const page = Math.floor(afterSequence / pageWidth) + 1;
				const scannedThroughSequence = page * pageWidth;
				return {
					events: [{
						id: `operation-${page}`,
						sequence: scannedThroughSequence,
						type: "character.operation.proposed",
					}],
					replay: {
						scannedThroughSequence,
						hasMore: page < pageCount,
					},
				};
			},
		};
		const realtime = new HubRealtime({store});
		const serverSocket = new FakeSocket();
		realtime.addConnection({
			socket: serverSocket,
			account: {id: "player", displayName: "Player"},
			session: {id: "session"},
			membership: {id: "membership", role: "player"},
			campaignId: "cmp",
		});
		const connection = realtime._connections.get(serverSocket);
		await new Promise(resolve => setImmediate(resolve));
		serverSocket.sent.length = 0;

		const clientRequests = [];
		const delivered = [];
		const client = new HubRealtimeClient({campaignId: "cmp", location: {protocol: "https:", host: "tools.example"}});
		client._socket = {
			readyState: 1,
			send: raw => clientRequests.push(JSON.parse(raw)),
		};
		client.on("event", event => delivered.push(event));
		client.requestResync();

		while (clientRequests.length) {
			const request = clientRequests.shift();
			await realtime._pHandleMessage({connection, raw: Buffer.from(JSON.stringify(request))});
			client._handleMessage(serverSocket.sent.shift());
		}

		expect(pageCalls).toEqual(Array.from({length: pageCount}, (_, i) => i * pageWidth));
		expect(delivered.map(event => event.id)).toEqual(Array.from({length: pageCount}, (_, i) => `operation-${i + 1}`));
		expect(new Set(delivered.map(event => event.id)).size).toBe(pageCount);
		expect(connection.messageCount).toBe(1);
		expect(serverSocket.closeEvents).toEqual([]);
		expect(client.getConnectionState().state).toBe("live");
	});

	it("counts forged, cross-connection, and replayed continuation markers against the burst limit", async () => {
		const store = {
			pGetSessionById: async () => ({session: {}, account: {}}),
			pGetMembership: async () => ({role: "player"}),
			pGetCampaignCursor: async ({campaignId}) => ({
				cursor: {campaignId, lastSequence: 10_000},
				campaign: {id: campaignId},
				membership: {role: "player"},
				characterRefs: [],
			}),
			pListVisibleEventPage: async ({afterSequence}) => ({
				events: [],
				replay: {scannedThroughSequence: afterSequence + 1, hasMore: true},
			}),
		};
		const realtime = new HubRealtime({store});
		const firstSocket = new FakeSocket();
		const otherSocket = new FakeSocket();
		realtime.addConnection({
			socket: firstSocket,
			account: {id: "first", displayName: "First"},
			session: {id: "first-session"},
			membership: {id: "first-membership", role: "player"},
			campaignId: "first-campaign",
		});
		realtime.addConnection({
			socket: otherSocket,
			account: {id: "other", displayName: "Other"},
			session: {id: "other-session"},
			membership: {id: "other-membership", role: "player"},
			campaignId: "other-campaign",
		});
		const first = realtime._connections.get(firstSocket);
		const other = realtime._connections.get(otherSocket);

		await realtime._pHandleMessage({connection: first, raw: Buffer.from(JSON.stringify({type: "resync", afterSequence: 0}))});
		expect(first.replayContinuationAfterSequence).toBe(1);
		expect(first.messageCount).toBe(1);
		await realtime._pHandleMessage({connection: other, raw: Buffer.from(JSON.stringify({type: "resync", afterSequence: 1}))});
		expect(other.messageCount).toBe(1);

		await realtime._pHandleMessage({connection: first, raw: Buffer.from(JSON.stringify({type: "resync", afterSequence: 1}))});
		expect(first.messageCount).toBe(1);
		expect(first.replayContinuationAfterSequence).toBe(2);
		for (let i = 0; i < 20; ++i) {
			await realtime._pHandleMessage({connection: first, raw: Buffer.from(JSON.stringify({type: "resync", afterSequence: 1}))});
		}
		expect(firstSocket.closeEvents).toContainEqual({code: 1013, reason: "Rate limit exceeded"});
	});

	it("caps concurrent forged traffic before starting authorization store work", async () => {
		const sessionResolvers = [];
		let sessionCalls = 0;
		let membershipCalls = 0;
		const store = {
			pGetSessionById: () => {
				sessionCalls++;
				return new Promise(resolve => sessionResolvers.push(resolve));
			},
			pGetMembership: async () => {
				membershipCalls++;
				return {role: "player"};
			},
		};
		const realtime = new HubRealtime({store});
		const socket = new FakeSocket();
		const connection = {
			socket,
			sessionId: "session",
			accountId: "account",
			campaignId: "campaign",
			role: "player",
			messageWindowStartedAt: Date.now(),
			messageCount: 0,
			replayContinuationAfterSequence: null,
		};
		const requests = Array.from({length: 100}, () =>
			realtime._pHandleMessage({connection, raw: Buffer.from(JSON.stringify({type: "forged"}))}),
		);

		expect(sessionCalls).toBe(20);
		expect(socket.closeEvents).toContainEqual({code: 1013, reason: "Rate limit exceeded"});
		for (const resolve of sessionResolvers) resolve({session: {}, account: {}});
		await Promise.all(requests);
		expect(membershipCalls).toBe(20);
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
			pListVisibleEventPage: async () => ({
				events: [{sequence: 4, type: "roll.logged"}],
				replay: {scannedThroughSequence: 4, hasMore: false},
			}),
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
			replay: {scannedThroughSequence: 4, hasMore: false},
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
	describe("BFCache suspend and resume", () => {
		const pMakeClient = async () => {
			const {HubRealtimeClient} = await import("../../../js/hub/hub-realtime-client.js");
			class BrowserSocket extends EventEmitter {
				readyState = 1;
				sent = [];
				closed = false;
				send (message) { this.sent.push(JSON.parse(message)); }
				close () {
					this.closed = true;
					this.readyState = 3;
					this.emit("close", {code: 1000});
				}
				addEventListener (type, listener) { this.on(type, listener); }
				removeEventListener (type, listener) { this.off(type, listener); }
			}
			const sockets = [];
			const client = new HubRealtimeClient({
				campaignId: "cmp",
				location: {protocol: "https:", host: "tools.example"},
				fnCreateSocket: () => {
					const socket = new BrowserSocket();
					sockets.push(socket);
					queueMicrotask(() => socket.emit("open"));
					return socket;
				},
				fnSetTimeout: () => 1,
				fnClearTimeout: () => {},
				fnSetInterval: () => 1,
				fnClearInterval: () => {},
			});
			return {client, sockets};
		};

		it("reconnects a suspended client so a restored page is not permanently stale", async () => {
			const {client, sockets} = await pMakeClient();
			await client.pConnect();
			expect(sockets).toHaveLength(1);

			// A persisted `pagehide` disconnects and disables reconnect.
			client.suspend();
			expect(client.isSuspended).toBe(true);
			expect(sockets[0].closed).toBe(true);
			expect(client.getConnectionState().state).toBe("closed");

			// The matching `pageshow` must actually open a new socket, not silently no-op.
			await client.resume();
			expect(sockets).toHaveLength(2);
			expect(client.isSuspended).toBe(false);
			// Reconnected and re-syncing, rather than stranded in `closed`.
			expect(client.getConnectionState().state).toBe("syncing");

			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 0},
				characterRefs: [],
				events: [],
				replay: {scannedThroughSequence: 0, hasMore: false},
			});
			expect(client.getConnectionState().state).toBe("live");
		});

		it("resumes from the retained cursor rather than restarting a cold stream", async () => {
			const {client, sockets} = await pMakeClient();
			await client.pConnect();
			client._handleMessage({
				type: "resync_complete",
				cursor: {campaignId: "cmp", lastSequence: 42},
				characterRefs: [],
				events: [],
				replay: {scannedThroughSequence: 42, hasMore: false},
			});

			client.suspend();
			await client.resume();

			// `suspend()` keeps replay state on purpose, so the resumed subscription continues
			// from the retained cursor instead of replaying the campaign from zero.
			expect(sockets[1].sent).toEqual([{type: "resync", afterSequence: 42}]);
		});

		it("is inert when the client was never suspended or was permanently closed", async () => {
			const {client, sockets} = await pMakeClient();
			await client.pConnect();

			// A `pageshow` without a preceding persisted `pagehide` must not duplicate the socket.
			expect(client.resume()).toBeNull();
			expect(sockets).toHaveLength(1);

			client.close();
			expect(client.resume()).toBeNull();
			expect(sockets).toHaveLength(1);
		});
	});
});
