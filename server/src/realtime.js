import {canViewEvent} from "./projections.js";

function sendJson (socket, message) {
	if (socket.readyState !== 1) return;
	socket.send(JSON.stringify(message));
}

function isMessageRateLimitExceeded ({connection, isReplayContinuation = false}) {
	const now = Date.now();
	if (now - connection.messageWindowStartedAt >= 1000) {
		connection.messageWindowStartedAt = now;
		connection.messageCount = 0;
	}
	if (isReplayContinuation) return false;
	return ++connection.messageCount > 20;
}

export class HubRealtime {
	constructor ({
		store,
		fnNow = () => new Date(),
		heartbeatIntervalMs = 25_000,
		fnSetInterval = setInterval,
		fnClearInterval = clearInterval,
	}) {
		this._store = store;
		this._fnNow = fnNow;
		this._heartbeatIntervalMs = heartbeatIntervalMs;
		this._fnSetInterval = fnSetInterval;
		this._fnClearInterval = fnClearInterval;
		this._connections = new Map();
	}

	getConnectionCount () {
		return this._connections.size;
	}

	addConnection ({socket, account, session, membership, campaignId, clientIp = null}) {
		const connection = {
			socket,
			accountId: account.id,
			displayName: account.displayName,
			sessionId: session.id,
			membershipId: membership.id,
			role: membership.role,
			campaignId,
			clientIp,
			connectedAt: this._fnNow().toISOString(),
			activity: "idle",
			targetId: null,
			messageWindowStartedAt: Date.now(),
			messageCount: 0,
			replayContinuationAfterSequence: null,
			isAlive: true,
			heartbeatTimer: null,
		};
		this._connections.set(socket, connection);
		if (typeof socket.ping === "function") {
			socket.on("pong", () => connection.isAlive = true);
			connection.heartbeatTimer = this._fnSetInterval(() => {
				if (socket.readyState !== 1) return;
				if (!connection.isAlive) {
					if (typeof socket.terminate === "function") socket.terminate();
					else socket.close(1001, "Heartbeat timeout");
					return;
				}
				connection.isAlive = false;
				try {
					socket.ping();
				} catch {
					if (typeof socket.terminate === "function") socket.terminate();
					else socket.close(1001, "Heartbeat failed");
				}
			}, this._heartbeatIntervalMs);
			connection.heartbeatTimer.unref?.();
		}
		socket.on("close", () => {
			if (connection.heartbeatTimer != null) this._fnClearInterval(connection.heartbeatTimer);
			this._connections.delete(socket);
			void this.pBroadcastPresence({campaignId}).catch(() => {});
		});
		socket.on("message", raw => {
			void this._pHandleMessage({connection, raw})
				.catch(() => sendJson(socket, {type: "error", code: "MESSAGE_FAILED"}));
		});
		sendJson(socket, {
			type: "subscribed",
			campaignId,
			membershipId: membership.id,
			role: membership.role,
			connectedAt: connection.connectedAt,
		});
		void this.pBroadcastPresence({campaignId}).catch(() => {});
	}

	async _pHandleMessage ({connection, raw}) {
		if (raw.length > 16 * 1024) {
			connection.socket.close(1009, "Message too large");
			return;
		}
		let message;
		let isInvalidMessage = false;
		try {
			message = JSON.parse(raw.toString());
			isInvalidMessage = !message || typeof message !== "object" || Array.isArray(message);
		} catch {
			isInvalidMessage = true;
		}
		const isReplayContinuation = !isInvalidMessage
			&& message.type === "resync"
			&& connection.replayContinuationAfterSequence != null
			&& Number(message.afterSequence) === connection.replayContinuationAfterSequence;
		// The exemption is a single connection-scoped step. Consume it before awaiting any
		// store work so duplicate/in-flight replay requests use the ordinary burst limit.
		if (isReplayContinuation) connection.replayContinuationAfterSequence = null;
		if (isMessageRateLimitExceeded({connection, isReplayContinuation})) {
			connection.socket.close(1013, "Rate limit exceeded");
			return;
		}
		if (!await this._store.pGetSessionById({sessionId: connection.sessionId})) {
			connection.socket.close(1008, "Session expired");
			return;
		}
		const membership = await this._store.pGetMembership({
			accountId: connection.accountId,
			campaignId: connection.campaignId,
		});
		if (!membership) {
			connection.socket.close(1008, "Membership revoked");
			return;
		}
		connection.role = membership.role;
		if (isInvalidMessage) return sendJson(connection.socket, {type: "error", code: "INVALID_MESSAGE"});
		if (message.type === "presence") {
			connection.activity = ["idle", "viewing_character", "editing_character", "viewing_dm_screen"].includes(message.activity)
				? message.activity
				: "idle";
			connection.targetId = typeof message.targetId === "string" && message.targetId.length <= 200 ? message.targetId : null;
			await this.pBroadcastPresence({campaignId: connection.campaignId});
			return;
		}
		if (message.type === "resync") {
			// ADR 0011: resync carries the campaign cursor, authorized event history, and at
			// most the ids/revisions a client needs to invalidate its caches. Character
			// documents and peer profiles are fetched over the authorization-scoped HTTP
			// projector instead, so a second projection path cannot grow in here — this
			// deliberately does not call the snapshot projector at all.
			const cursor = await this._store.pGetCampaignCursor({
				accountId: connection.accountId,
				campaignId: connection.campaignId,
			});
			const eventPage = await this._store.pListVisibleEventPage({
				accountId: connection.accountId,
				campaignId: connection.campaignId,
				afterSequence: Number(message.afterSequence) || 0,
				limit: 500,
			});
			connection.replayContinuationAfterSequence = eventPage.replay.hasMore
				? eventPage.replay.scannedThroughSequence
				: null;
			sendJson(connection.socket, {type: "resync_complete", ...cursor, ...eventPage});
			return;
		}
		sendJson(connection.socket, {type: "error", code: "UNSUPPORTED_MESSAGE"});
	}

	async pPublishEvent (event) {
		for (const connection of this._connections.values()) {
			if (connection.campaignId !== event.campaignId) continue;
			if (!await this._store.pGetSessionById({sessionId: connection.sessionId})) {
				connection.socket.close(1008, "Session expired");
				continue;
			}
			const membership = await this._store.pGetMembership({
				accountId: connection.accountId,
				campaignId: connection.campaignId,
			});
			if (!membership) {
				connection.socket.close(1008, "Membership revoked");
				continue;
			}
			connection.role = membership.role;
			if (!canViewEvent({event, accountId: connection.accountId, role: connection.role})) continue;
			// Live fanout applies the same ADR 0011 actor redaction as the HTTP read, so a
			// socket cannot expose an owner association the read hides.
			const viewerEvent = this._store.redactEventForViewer
				? await this._store.redactEventForViewer({event, accountId: connection.accountId, role: connection.role})
				: event;
			// A null outcome means this viewer may not see the event at all.
			if (!viewerEvent) continue;
			sendJson(connection.socket, {type: "event", event: viewerEvent});
		}
	}

	async pBroadcastPresence ({campaignId}) {
		const active = [];
		for (const connection of this._connections.values()) {
			if (connection.campaignId !== campaignId) continue;
			const [session, membership] = await Promise.all([
				this._store.pGetSessionById({sessionId: connection.sessionId}),
				this._store.pGetMembership({accountId: connection.accountId, campaignId}),
			]);
			if (!session || !membership) {
				connection.socket.close(1008, "Authorization revoked");
				continue;
			}
			connection.role = membership.role;
			active.push(connection);
		}
		const members = active.map(connection => ({
			accountId: connection.accountId,
			displayName: connection.displayName,
			role: connection.role,
			activity: connection.activity,
			targetId: connection.targetId,
			connectedAt: connection.connectedAt,
		}));
		for (const connection of active) sendJson(connection.socket, {type: "presence", members});
	}

	closeSession ({sessionId}) {
		for (const connection of this._connections.values()) {
			if (connection.sessionId !== sessionId) continue;
			connection.socket.close(1008, "Session revoked");
		}
	}

	closeAccount ({accountId, campaignId = null, reason = "Account access changed"}) {
		for (const connection of this._connections.values()) {
			if (connection.accountId !== accountId) continue;
			if (campaignId && connection.campaignId !== campaignId) continue;
			connection.socket.close(1008, reason);
		}
	}

	stop () {
		for (const connection of this._connections.values()) {
			if (connection.heartbeatTimer != null) this._fnClearInterval(connection.heartbeatTimer);
		}
		this._connections.clear();
	}
}

export class HubOutboxDispatcher {
	constructor ({store, realtime, intervalMs = 100}) {
		this._store = store;
		this._realtime = realtime;
		this._intervalMs = intervalMs;
		this._timer = null;
		this._isRunning = false;
		this._lastDispatchAt = null;
		this._lastSuccessAt = null;
		this._lastBatchCount = 0;
		this._consecutiveErrors = 0;
	}

	async pDispatchOnce () {
		if (this._isRunning) return 0;
		this._isRunning = true;
		try {
			const entries = await this._store.pClaimOutboxBatch({limit: 100});
			const failedCampaigns = new Set();
			let hasFailure = false;
			for (const entry of entries) {
				if (failedCampaigns.has(entry.event.campaignId)) {
					hasFailure = true;
					await this._store.pMarkOutboxFailed({outboxId: entry.id, claimToken: entry.claimToken, error: "Blocked by earlier campaign event failure"});
					continue;
				}
				try {
					await this._realtime.pPublishEvent(entry.event);
					await this._store.pMarkOutboxPublished({outboxId: entry.id, claimToken: entry.claimToken});
				} catch (error) {
					hasFailure = true;
					failedCampaigns.add(entry.event.campaignId);
					await this._store.pMarkOutboxFailed({outboxId: entry.id, claimToken: entry.claimToken, error: error.message});
				}
			}
			this._lastDispatchAt = new Date();
			this._lastBatchCount = entries.length;
			if (hasFailure) this._consecutiveErrors++;
			else {
				this._lastSuccessAt = new Date();
				this._consecutiveErrors = 0;
			}
			return entries.length;
		} catch (error) {
			this._lastDispatchAt = new Date();
			this._consecutiveErrors++;
			throw error;
		} finally {
			this._isRunning = false;
		}
	}

	start () {
		if (this._timer) return;
		this._timer = setInterval(() => {
			void this.pDispatchOnce().catch(error => {
				process.stderr.write(`Campaign Hub outbox dispatch failed: ${error.stack || error.message}\n`);
			});
		}, this._intervalMs);
		this._timer.unref?.();
	}

	stop () {
		if (!this._timer) return;
		clearInterval(this._timer);
		this._timer = null;
	}

	getStatus ({now = new Date()} = {}) {
		return {
			lastDispatchAt: this._lastDispatchAt?.toISOString() || null,
			lastSuccessAt: this._lastSuccessAt?.toISOString() || null,
			lastBatchCount: this._lastBatchCount,
			lastSuccessAgeSeconds: this._lastSuccessAt ? Math.max(0, (now - this._lastSuccessAt) / 1000) : -1,
			consecutiveErrors: this._consecutiveErrors,
		};
	}
}
