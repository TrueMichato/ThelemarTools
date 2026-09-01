export class HubRealtimeClient {
	constructor ({
		campaignId,
		fnCreateSocket = url => new WebSocket(url),
		location = globalThis.location,
		fnSetTimeout = (...args) => setTimeout(...args),
		fnSetInterval = (...args) => setInterval(...args),
		fnClearInterval = timer => clearInterval(timer),
		resyncIntervalMs = 10_000,
	}) {
		if (!campaignId) throw new TypeError(`campaignId is required.`);
		this._campaignId = campaignId;
		this._fnCreateSocket = fnCreateSocket;
		this._location = location;
		this._fnSetTimeout = fnSetTimeout;
		this._fnSetInterval = fnSetInterval;
		this._fnClearInterval = fnClearInterval;
		this._resyncIntervalMs = resyncIntervalMs;
		this._socket = null;
		this._pConnecting = null;
		this._shouldReconnect = false;
		this._reconnectAttempt = 0;
		this._reconnectTimer = null;
		this._resyncTimer = null;
		this._lastSequence = 0;
		this._hasBaseline = false;
		this._bufferedEvents = [];
		this._listeners = new Map();
		this._connectionState = {state: "closed"};
	}

	on (type, listener) {
		const listeners = this._listeners.get(type) || new Set();
		listeners.add(listener);
		this._listeners.set(type, listeners);
		return () => listeners.delete(listener);
	}

	_emit (type, value) {
		for (const listener of this._listeners.get(type) || []) listener(value);
	}

	getConnectionState () {
		return {...this._connectionState};
	}

	_setConnectionState (state, detail = {}) {
		this._connectionState = {state, ...detail};
		this._emit("state", this.getConnectionState());
	}

	pConnect () {
		this._shouldReconnect = true;
		if (this._pConnecting) return this._pConnecting;
		this._setConnectionState(this._reconnectAttempt ? "reconnecting" : "connecting", {
			attempt: this._reconnectAttempt,
		});
		this._pConnecting = new Promise((resolve, reject) => {
			this._hasBaseline = false;
			this._bufferedEvents = [];
			const protocol = this._location.protocol === "https:" ? "wss:" : "ws:";
			const url = `${protocol}//${this._location.host}/ws/campaign/${encodeURIComponent(this._campaignId)}?v=1`;
			const socket = this._fnCreateSocket(url);
			this._socket = socket;
			let isOpened = false;
			const onError = error => reject(error);
			socket.addEventListener("error", onError, {once: true});
			socket.addEventListener("open", () => {
				isOpened = true;
				socket.removeEventListener("error", onError);
				const isReconnect = this._reconnectAttempt > 0;
				this.requestResync();
				this._armResyncTimer();
				this._setConnectionState("syncing", {isReconnect});
				resolve();
			}, {once: true});
			socket.addEventListener("message", event => this._handleMessage(JSON.parse(event.data)));
			socket.addEventListener("close", event => {
				if (!isOpened) reject(new Error(`WebSocket closed before opening.`));
				this._clearResyncTimer();
				this._emit("close", event);
				if (event?.code === 1008) {
					this._shouldReconnect = false;
					this._setConnectionState("access_lost", {
						code: event.code,
						reason: event.reason || "Session or campaign access changed.",
					});
					return;
				}
				this._scheduleReconnect();
			});
		}).finally(() => this._pConnecting = null);
		return this._pConnecting;
	}

	_scheduleReconnect () {
		if (!this._shouldReconnect || this._reconnectTimer) return;
		const delay = Math.min(10_000, 500 * (2 ** this._reconnectAttempt++));
		this._setConnectionState("reconnecting", {
			attempt: this._reconnectAttempt,
			delay,
		});
		this._reconnectTimer = this._fnSetTimeout(() => {
			this._reconnectTimer = null;
			void this.pConnect().catch(() => this._scheduleReconnect());
		}, delay);
	}

	_handleMessage (message) {
		if (message.type === "event") {
			if (!this._hasBaseline) {
				this._bufferedEvents.push(message.event);
				return;
			}
			if (message.event.sequence <= this._lastSequence) return;
			this._lastSequence = message.event.sequence;
			this._emit("event", message.event);
			return;
		}
		if (message.type === "resync_complete") {
			const previousSequence = this._lastSequence;
			const snapshotSequence = message.snapshot?.lastSequence || 0;
			if (!this._hasBaseline || snapshotSequence >= this._lastSequence) {
				this._lastSequence = snapshotSequence;
				this._emit("snapshot", message.snapshot);
			}
			this._hasBaseline = true;
			const events = [...(message.events || []), ...this._bufferedEvents]
				.sort((a, b) => a.sequence - b.sequence);
			this._bufferedEvents = [];
			const seen = new Set();
			for (const event of events) {
				const key = event.id || `${event.sequence}:${event.type || ""}`;
				if (seen.has(key) || event.sequence <= previousSequence) continue;
				if (event.sequence <= snapshotSequence && [
					"character.created",
					"character.cloned",
					"character.archived",
					"character.moved",
					"character.moved_out",
					"character.reactivated",
					"character.projection.updated",
					"xp.granted",
					"item.granted",
					"action.applied",
				].includes(event.type)) continue;
				seen.add(key);
				this._lastSequence = Math.max(this._lastSequence, event.sequence);
				this._emit("event", event);
			}
			this._reconnectAttempt = 0;
			this._setConnectionState("live");
			return;
		}
		this._emit(message.type, message);
	}

	setPresence ({activity, targetId = null}) {
		this._socket?.send(JSON.stringify({type: "presence", activity, targetId}));
	}

	requestResync () {
		if (this._socket?.readyState !== 1) return;
		this._socket.send(JSON.stringify({type: "resync", afterSequence: this._lastSequence}));
	}

	_armResyncTimer () {
		if (!this._socket || this._resyncTimer != null) return;
		this._resyncTimer = this._fnSetInterval(() => this.requestResync(), this._resyncIntervalMs);
		this._resyncTimer?.unref?.();
	}

	_clearResyncTimer () {
		if (this._resyncTimer == null) return;
		this._fnClearInterval(this._resyncTimer);
		this._resyncTimer = null;
	}

	close () {
		this._shouldReconnect = false;
		if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
		this._reconnectTimer = null;
		this._clearResyncTimer();
		this._socket?.close();
		this._socket = null;
		this._setConnectionState("closed");
	}
}
