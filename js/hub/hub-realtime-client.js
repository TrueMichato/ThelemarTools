export class HubRealtimeClient {
	constructor ({
		campaignId,
		fnCreateSocket = url => new WebSocket(url),
		location = globalThis.location,
		fnSetTimeout = setTimeout,
	}) {
		if (!campaignId) throw new TypeError(`campaignId is required.`);
		this._campaignId = campaignId;
		this._fnCreateSocket = fnCreateSocket;
		this._location = location;
		this._fnSetTimeout = fnSetTimeout;
		this._socket = null;
		this._pConnecting = null;
		this._shouldReconnect = false;
		this._reconnectAttempt = 0;
		this._reconnectTimer = null;
		this._lastSequence = 0;
		this._hasBaseline = false;
		this._bufferedEvents = [];
		this._listeners = new Map();
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

	pConnect () {
		this._shouldReconnect = true;
		if (this._pConnecting) return this._pConnecting;
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
				this.requestResync();
				this._reconnectAttempt = 0;
				resolve();
			}, {once: true});
			socket.addEventListener("message", event => this._handleMessage(JSON.parse(event.data)));
			socket.addEventListener("close", event => {
				if (!isOpened) reject(new Error(`WebSocket closed before opening.`));
				this._emit("close", event);
				this._scheduleReconnect();
			});
		}).finally(() => this._pConnecting = null);
		return this._pConnecting;
	}

	_scheduleReconnect () {
		if (!this._shouldReconnect || this._reconnectTimer) return;
		const delay = Math.min(10_000, 500 * (2 ** this._reconnectAttempt++));
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
			return;
		}
		this._emit(message.type, message);
	}

	setPresence ({activity, targetId = null}) {
		this._socket?.send(JSON.stringify({type: "presence", activity, targetId}));
	}

	requestResync () {
		this._socket?.send(JSON.stringify({type: "resync", afterSequence: this._lastSequence}));
	}

	close () {
		this._shouldReconnect = false;
		if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
		this._reconnectTimer = null;
		this._socket?.close();
		this._socket = null;
	}
}
