export function isRealtimeEventCoveredByBaseline ({event, baselineSequence}) {
	return Number.isSafeInteger(event?.sequence)
		&& Number.isSafeInteger(baselineSequence)
		&& event.sequence <= baselineSequence;
}

export class HubRealtimeClient {
	constructor ({
		campaignId,
		fnCreateSocket = url => new WebSocket(url),
		location = globalThis.location,
		fnSetTimeout = (...args) => setTimeout(...args),
		fnClearTimeout = timer => clearTimeout(timer),
		fnSetInterval = (...args) => setInterval(...args),
		fnClearInterval = timer => clearInterval(timer),
		resyncIntervalMs = 10_000,
		fnOnListenerError = null,
	}) {
		if (!campaignId) throw new TypeError(`campaignId is required.`);
		this._campaignId = campaignId;
		this._fnCreateSocket = fnCreateSocket;
		this._location = location;
		this._fnSetTimeout = fnSetTimeout;
		this._fnClearTimeout = fnClearTimeout;
		this._fnSetInterval = fnSetInterval;
		this._fnClearInterval = fnClearInterval;
		this._resyncIntervalMs = resyncIntervalMs;
		this._fnOnListenerError = fnOnListenerError;
		this._socket = null;
		this._socketGeneration = 0;
		this._isSuspended = false;
		this._isClosed = false;
		this._pConnecting = null;
		this._pendingConnectionReject = null;
		this._shouldReconnect = false;
		this._reconnectAttempt = 0;
		this._reconnectTimer = null;
		this._resyncTimer = null;
		this._resyncWatchdogMarker = null;
		this._lastSequence = 0;
		this._hasBaseline = false;
		this._bufferedEvents = [];
		this._resyncAccumulatedEvents = [];
		this._resyncScannedThroughSequence = null;
		this._resyncStartSequence = null;
		this._seenEventKeys = new Set();
		this._listeners = new Map();
		this._connectionState = {state: "closed"};
	}

	on (type, listener) {
		const listeners = this._listeners.get(type) || new Set();
		listeners.add(listener);
		this._listeners.set(type, listeners);
		return () => listeners.delete(listener);
	}

	/**
	 * Consumer callbacks must never break protocol handling: a listener that throws used
	 * to abort `_handleMessage` partway, leaving the connection stuck before
	 * `_setConnectionState("live")` ever ran.
	 */
	_emit (type, value) {
		for (const listener of this._listeners.get(type) || []) {
			try {
				listener(value);
			} catch (error) {
				this._fnOnListenerError?.(error, type);
			}
		}
	}

	getConnectionState () {
		return {...this._connectionState};
	}

	_setConnectionState (state, detail = {}) {
		this._connectionState = {state, ...detail};
		this._emit("state", this.getConnectionState());
	}

	_getEventKey (event) {
		return event.id || `${event.sequence}:${event.type || ""}`;
	}

	_isEventSeen (event) {
		return this._seenEventKeys.has(this._getEventKey(event));
	}

	_rememberEvent (event) {
		this._seenEventKeys.add(this._getEventKey(event));
		if (this._seenEventKeys.size <= 2_000) return;
		this._seenEventKeys.delete(this._seenEventKeys.values().next().value);
	}

	pConnect () {
		this._shouldReconnect = true;
		if (this._pConnecting) return this._pConnecting;
		const generation = ++this._socketGeneration;
		this._setConnectionState(this._reconnectAttempt ? "reconnecting" : "connecting", {
			attempt: this._reconnectAttempt,
		});
		this._pConnecting = new Promise((resolve, reject) => {
			this._pendingConnectionReject = {generation, reject};
			this._hasBaseline = false;
			if (this._resyncStartSequence == null) this._bufferedEvents = [];
			const protocol = this._location.protocol === "https:" ? "wss:" : "ws:";
			const url = `${protocol}//${this._location.host}/ws/campaign/${encodeURIComponent(this._campaignId)}?v=4`;
			const socket = this._fnCreateSocket(url);
			this._socket = socket;
			let isOpened = false;
			const onError = error => reject(error);
			socket.addEventListener("error", onError, {once: true});
			socket.addEventListener("open", () => {
				if (!this._isCurrentSocket({socket, generation})) return;
				isOpened = true;
				socket.removeEventListener("error", onError);
				const isReconnect = this._reconnectAttempt > 0;
				this.requestResync(
					this._resyncScannedThroughSequence ?? this._lastSequence,
					{socket, generation},
				);
				this._armResyncTimer({socket, generation});
				this._setConnectionState("syncing", {isReconnect});
				if (this._pendingConnectionReject?.generation === generation) this._pendingConnectionReject = null;
				resolve();
			}, {once: true});
			socket.addEventListener("message", event => {
				if (!this._isCurrentSocket({socket, generation})) return;
				this._handleMessage(JSON.parse(event.data), {socket, generation});
			});
			socket.addEventListener("close", event => {
				if (!this._isCurrentSocket({socket, generation})) return;
				if (!isOpened) {
					if (this._pendingConnectionReject?.generation === generation) this._pendingConnectionReject = null;
					reject(new Error(`WebSocket closed before opening.`));
				}
				this._socket = null;
				this._clearResyncTimer({generation});
				this._emit("close", event);
				if (event?.code === 1008) {
					this._shouldReconnect = false;
					this._setConnectionState("access_lost", {
						code: event.code,
						reason: event.reason || "Session or campaign access changed.",
					});
					return;
				}
				this._scheduleReconnect({generation});
			});
		});
		const pConnecting = this._pConnecting;
		void pConnecting.then(
			() => {
				if (this._pConnecting === pConnecting) this._pConnecting = null;
			},
			() => {
				if (this._pConnecting === pConnecting) this._pConnecting = null;
			},
		);
		return this._pConnecting;
	}

	_isCurrentSocket ({socket, generation}) {
		return this._socket === socket && this._socketGeneration === generation;
	}

	_scheduleReconnect ({generation = this._socketGeneration} = {}) {
		if (!this._shouldReconnect || this._reconnectTimer) return;
		const delay = Math.min(10_000, 500 * (2 ** this._reconnectAttempt++));
		this._setConnectionState("reconnecting", {
			attempt: this._reconnectAttempt,
			delay,
		});
		const timer = this._fnSetTimeout(() => {
			if (this._socketGeneration !== generation || this._reconnectTimer?.id !== timer) return;
			this._reconnectTimer = null;
			void this.pConnect().catch(() => this._scheduleReconnect());
		}, delay);
		this._reconnectTimer = {generation, id: timer};
	}

	_handleMessage (message, context = null) {
		if (context && !this._isCurrentSocket(context)) return;
		if (message.type === "event") {
			if (!this._hasBaseline || this._resyncStartSequence != null) {
				this._bufferedEvents.push(message.event);
				return;
			}
			if (message.event.sequence <= this._lastSequence) return;
			this._lastSequence = message.event.sequence;
			if (this._isEventSeen(message.event)) return;
			this._rememberEvent(message.event);
			this._emit("event", message.event);
			return;
		}
		if (message.type === "resync_complete") {
			const previousSequence = this._resyncStartSequence ?? this._lastSequence;
			this._resyncAccumulatedEvents.push(...(message.events || []));
			if (message.replay?.hasMore) {
				const scannedThroughSequence = Number(message.replay.scannedThroughSequence);
				if (
					!Number.isSafeInteger(scannedThroughSequence)
					|| scannedThroughSequence <= (this._resyncScannedThroughSequence ?? previousSequence)
				) {
					this._emit("error", {type: "error", code: "INVALID_REPLAY_CONTINUATION"});
					this._resyncAccumulatedEvents = [];
					this._resyncScannedThroughSequence = null;
					this._resyncStartSequence = null;
					this._hasBaseline = false;
					this.requestResync(previousSequence);
					return;
				}
				this._resyncScannedThroughSequence = scannedThroughSequence;
				this.requestResync(scannedThroughSequence);
				return;
			}
			// ADR 0011: resync carries a cursor and cache-invalidation refs only. Consumers
			// refetch through the authorization-scoped HTTP projector.
			const snapshotSequence = message.cursor?.lastSequence || 0;
			if (!this._hasBaseline || snapshotSequence >= this._lastSequence) {
				this._emit("cursor", {
					cursor: message.cursor,
					campaign: message.campaign,
					membership: message.membership,
					characterRefs: message.characterRefs || [],
				});
			}
			const events = [...this._resyncAccumulatedEvents, ...this._bufferedEvents]
				.sort((a, b) => a.sequence - b.sequence);
			this._bufferedEvents = [];
			this._lastSequence = Math.max(this._lastSequence, snapshotSequence);
			for (const event of events) {
				if (event.sequence <= previousSequence) continue;
				this._lastSequence = Math.max(this._lastSequence, event.sequence);
				if (this._isEventSeen(event)) continue;
				if (event.sequence <= snapshotSequence && [
					"character.created",
					"character.cloned",
					"character.archived",
					"character.moved",
					"character.moved_out",
					"character.reactivated",
					"character.projection.invalidated",
					"xp.granted",
					"item.granted",
					"action.applied",
					"rules.activated",
					"brew.activated",
				].includes(event.type)) continue;
				this._rememberEvent(event);
				this._emit("event", event);
			}
			this._resyncAccumulatedEvents = [];
			this._resyncScannedThroughSequence = null;
			this._resyncStartSequence = null;
			this._hasBaseline = true;
			this._reconnectAttempt = 0;
			this._setConnectionState("live");
			return;
		}
		if (message.type === "error" && this._resyncStartSequence != null) {
			this._emit("error", message);
			(context?.socket || this._socket)?.close(4000, "Replay failed");
			return;
		}
		this._emit(message.type, message);
	}

	setPresence ({activity, targetId = null}) {
		this._socket?.send(JSON.stringify({type: "presence", activity, targetId}));
	}

	requestResync (
		afterSequence = null,
		{socket = this._socket, generation = this._socketGeneration} = {},
	) {
		if (!this._isCurrentSocket({socket, generation}) || socket?.readyState !== 1) return;
		const isContinuationOrResume = afterSequence != null;
		if (!isContinuationOrResume && this._resyncStartSequence != null) return;
		if (this._resyncStartSequence == null) this._resyncStartSequence = this._lastSequence;
		socket.send(JSON.stringify({
			type: "resync",
			afterSequence: isContinuationOrResume ? afterSequence : this._lastSequence,
		}));
	}

	_armResyncTimer ({socket, generation}) {
		if (!this._isCurrentSocket({socket, generation}) || this._resyncTimer != null) return;
		const id = this._fnSetInterval(() => {
			if (!this._isCurrentSocket({socket, generation})) return;
			if (this._resyncStartSequence != null) {
				const marker = `${this._resyncScannedThroughSequence ?? "initial"}:${this._resyncAccumulatedEvents.length}`;
				if (marker !== this._resyncWatchdogMarker) {
					this._resyncWatchdogMarker = marker;
					return;
				}
				socket.close(4000, "Resync timed out");
				return;
			}
			this._resyncWatchdogMarker = null;
			this.requestResync(null, {socket, generation});
		}, this._resyncIntervalMs);
		this._resyncTimer = {generation, id};
		id?.unref?.();
	}

	_clearResyncTimer ({generation = null} = {}) {
		if (this._resyncTimer == null) return;
		if (generation != null && this._resyncTimer.generation !== generation) return;
		this._fnClearInterval(this._resyncTimer.id);
		this._resyncTimer = null;
		this._resyncWatchdogMarker = null;
	}

	_disconnect ({isResetReplay}) {
		this._shouldReconnect = false;
		this._socketGeneration++;
		this._pendingConnectionReject?.reject(new Error(`Realtime client closed.`));
		this._pendingConnectionReject = null;
		this._pConnecting = null;
		if (this._reconnectTimer) this._fnClearTimeout(this._reconnectTimer.id);
		this._reconnectTimer = null;
		this._reconnectAttempt = 0;
		this._clearResyncTimer();
		const socket = this._socket;
		this._socket = null;
		this._hasBaseline = false;
		if (isResetReplay) {
			this._bufferedEvents = [];
			this._resyncAccumulatedEvents = [];
			this._resyncScannedThroughSequence = null;
			this._resyncStartSequence = null;
		}
		socket?.close();
		this._setConnectionState("closed");
	}

	suspend () {
		if (this._isClosed) return;
		this._isSuspended = true;
		// Keep replay state: a BFCache restore must resume the same subscription, not a cold one.
		this._disconnect({isResetReplay: false});
	}

	/**
	 * Reconnect after `suspend()`, replaying from the retained cursor.
	 *
	 * Without this, a persisted `pagehide` disables reconnect and drops the socket, and the
	 * matching `pageshow` silently leaves the roster, projections, and presence stale.
	 */
	resume () {
		if (this._isClosed || !this._isSuspended) return null;
		this._isSuspended = false;
		if (this._socket || this._pConnecting) return this._pConnecting;
		return this.pConnect();
	}

	get isSuspended () { return this._isSuspended; }

	close () {
		this._isClosed = true;
		this._isSuspended = false;
		this._disconnect({isResetReplay: true});
	}
}
