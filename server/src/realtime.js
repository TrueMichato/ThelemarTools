import {canViewEvent} from "./projections.js";

function sendJson (socket, message) {
	if (socket.readyState !== 1) return;
	socket.send(JSON.stringify(message));
}

export class HubRealtime {
	constructor ({store, fnNow = () => new Date()}) {
		this._store = store;
		this._fnNow = fnNow;
		this._connections = new Map();
	}

	addConnection ({socket, account, session, membership, campaignId}) {
		const connection = {
			socket,
			accountId: account.id,
			displayName: account.displayName,
			sessionId: session.id,
			membershipId: membership.id,
			role: membership.role,
			campaignId,
			connectedAt: this._fnNow().toISOString(),
			activity: "idle",
			targetId: null,
			messageWindowStartedAt: Date.now(),
			messageCount: 0,
		};
		this._connections.set(socket, connection);
		socket.on("close", () => {
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
		const now = Date.now();
		if (now - connection.messageWindowStartedAt >= 1000) {
			connection.messageWindowStartedAt = now;
			connection.messageCount = 0;
		}
		if (++connection.messageCount > 20) {
			connection.socket.close(1008, "Rate limit exceeded");
			return;
		}
		let message;
		try {
			message = JSON.parse(raw.toString());
		} catch {
			return sendJson(connection.socket, {type: "error", code: "INVALID_MESSAGE"});
		}
		if (message.type === "presence") {
			connection.activity = ["idle", "viewing_character", "editing_character", "viewing_dm_screen"].includes(message.activity)
				? message.activity
				: "idle";
			connection.targetId = typeof message.targetId === "string" && message.targetId.length <= 200 ? message.targetId : null;
			await this.pBroadcastPresence({campaignId: connection.campaignId});
			return;
		}
		if (message.type === "resync") {
			const snapshot = await this._store.pGetCampaignSnapshot({
				accountId: connection.accountId,
				campaignId: connection.campaignId,
			});
			const events = await this._store.pListVisibleEvents({
				accountId: connection.accountId,
				campaignId: connection.campaignId,
				afterSequence: Number(message.afterSequence) || 0,
				limit: 500,
			});
			sendJson(connection.socket, {type: "resync_complete", snapshot, events});
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
			sendJson(connection.socket, {type: "event", event});
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
}

export class HubOutboxDispatcher {
	constructor ({store, realtime, intervalMs = 100}) {
		this._store = store;
		this._realtime = realtime;
		this._intervalMs = intervalMs;
		this._timer = null;
		this._isRunning = false;
	}

	async pDispatchOnce () {
		if (this._isRunning) return 0;
		this._isRunning = true;
		try {
			const entries = await this._store.pClaimOutboxBatch({limit: 100});
			const failedCampaigns = new Set();
			for (const entry of entries) {
				if (failedCampaigns.has(entry.event.campaignId)) {
					await this._store.pMarkOutboxFailed({outboxId: entry.id, claimToken: entry.claimToken, error: "Blocked by earlier campaign event failure"});
					continue;
				}
				try {
					await this._realtime.pPublishEvent(entry.event);
					await this._store.pMarkOutboxPublished({outboxId: entry.id, claimToken: entry.claimToken});
				} catch (error) {
					failedCampaigns.add(entry.event.campaignId);
					await this._store.pMarkOutboxFailed({outboxId: entry.id, claimToken: entry.claimToken, error: error.message});
				}
			}
			return entries.length;
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
}
