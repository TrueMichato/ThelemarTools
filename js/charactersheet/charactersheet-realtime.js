import {HubRealtimeClient} from "../hub/hub-realtime-client.js";
import {getCharacterOperationRouting} from "../hub/hub-character-operation-events.js";

const _LISTENER_TYPES = new Set([
	"connectionState",
	"cursor",
	"deliveryError",
	"projectionInvalidated",
	"semanticOperation",
]);

const _CHARACTER_TEARDOWN_EVENT_TYPES = new Set([
	"character.archived",
	"character.moved_out",
]);

export class CharacterSheetRealtimeCoordinator {
	constructor ({
		campaignId,
		isAuthenticated,
		repository,
		fnCreateRealtimeClient = options => new HubRealtimeClient(options),
		fnOnListenerError = null,
	}) {
		this._campaignId = campaignId;
		this._isAuthenticated = isAuthenticated === true;
		this._repository = repository;
		this._fnCreateRealtimeClient = fnCreateRealtimeClient;
		this._fnOnListenerError = fnOnListenerError;
		this._listeners = new Map();
		this._generation = 0;
		this._active = null;
		this._isAccessLost = false;
	}

	on (type, listener) {
		if (!_LISTENER_TYPES.has(type)) throw new TypeError(`Unsupported Character Sheet realtime listener type "${type}".`);
		if (typeof listener !== "function") throw new TypeError(`Realtime listener must be a function.`);
		const listeners = this._listeners.get(type) || new Set();
		listeners.add(listener);
		this._listeners.set(type, listeners);
		return () => listeners.delete(listener);
	}

	_emit (type, value, {isThrowOnError = false} = {}) {
		let firstError = null;
		for (const listener of this._listeners.get(type) || []) {
			try {
				listener(value);
			} catch (error) {
				firstError ||= error;
				this._fnOnListenerError?.(error, type);
			}
		}
		if (isThrowOnError && firstError) throw firstError;
	}

	_isCurrent (active) {
		return this._active === active && active.generation === this._generation;
	}

	_isEligible ({characterId}) {
		return this._isAuthenticated
			&& !this._isAccessLost
			&& typeof this._campaignId === "string"
			&& !!this._campaignId
			&& typeof characterId === "string"
			&& !!characterId
			&& typeof this._repository?.pEnqueueRealtimeDelivery === "function";
	}

	attach ({characterId}) {
		this.detach();
		if (!this._isEligible({characterId})) return false;

		const generation = ++this._generation;
		const client = this._fnCreateRealtimeClient({campaignId: this._campaignId});
		const active = {
			characterId,
			client,
			cursorKey: null,
			generation,
			isDetachQueued: false,
			isSuspended: false,
			operationKeys: new Set(),
			projectionCursorKey: null,
			unsubscribers: [],
		};
		this._active = active;

		active.unsubscribers.push(
			client.on("event", event => this._handleEvent(active, event)),
			client.on("cursor", baseline => this._handleCursor(active, baseline)),
			client.on("state", state => this._handleConnectionState(active, state)),
		);
		this._connect(active);
		return true;
	}

	_connect (active) {
		void active.client.pConnect().catch(() => {
			if (!this._isCurrent(active) || active.isSuspended) return;
			this._emit("connectionState", {state: "unavailable"});
		});
	}

	detach () {
		const active = this._active;
		this._active = null;
		this._generation++;
		if (!active) return;
		for (const unsubscribe of active.unsubscribers) unsubscribe();
		active.client.close();
	}

	suspend () {
		const active = this._active;
		if (!active || active.isSuspended) return false;
		active.isSuspended = true;
		active.client.suspend();
		return true;
	}

	resume () {
		const active = this._active;
		if (!active?.isSuspended || !this._isEligible({characterId: active.characterId})) return false;
		active.isSuspended = false;
		this._connect(active);
		return true;
	}

	_handleConnectionState (active, state) {
		if (!this._isCurrent(active)) return;
		const safeState = {
			state: state.state,
			...(state.attempt == null ? {} : {attempt: state.attempt}),
			...(state.delay == null ? {} : {delay: state.delay}),
			...(state.isReconnect == null ? {} : {isReconnect: state.isReconnect}),
			...(state.code == null ? {} : {code: state.code}),
			...(state.reason == null ? {} : {reason: state.reason}),
		};
		if (state.state === "access_lost") {
			this._isAccessLost = true;
			this.detach();
		}
		this._emit("connectionState", safeState);
	}

	_handleCursor (active, baseline) {
		if (!this._isCurrent(active)) return;
		if (baseline.cursor?.campaignId !== this._campaignId) return;
		const characterRef = baseline.characterRefs?.find(ref => ref?.id === active.characterId);
		if (!characterRef) {
			this._queueDetach(active, {
				reason: "Character is no longer available in this campaign.",
				sequence: baseline.cursor?.lastSequence || 0,
			});
			return;
		}
		const hasOperationWatermark = characterRef.operationWatermark != null;
		const metadata = {
			campaignId: this._campaignId,
			characterId: active.characterId,
			lastSequence: baseline.cursor?.lastSequence || 0,
			revision: characterRef.revision,
			projectionRevision: characterRef.projectionRevision,
			...(hasOperationWatermark ? {operationWatermark: characterRef.operationWatermark} : {}),
		};
		const operationWatermarkKey = hasOperationWatermark ? characterRef.operationWatermark : "absent";
		const cursorKey = `${metadata.lastSequence}:${metadata.revision}:${metadata.projectionRevision}:${operationWatermarkKey}`;
		if (active.cursorKey !== cursorKey) {
			active.cursorKey = cursorKey;
			this._enqueue(active, {
				type: "cursor",
				value: metadata,
			});
		}
		const projectionCursorKey = `${metadata.revision}:${metadata.projectionRevision}:${operationWatermarkKey}`;
		if (active.projectionCursorKey !== projectionCursorKey) {
			active.projectionCursorKey = projectionCursorKey;
			this._enqueue(active, {
				type: "projectionInvalidated",
				value: {...metadata, source: "cursor"},
			});
		}
	}

	_handleEvent (active, event) {
		if (!this._isCurrent(active) || event?.campaignId !== this._campaignId) return;

		if (
			_CHARACTER_TEARDOWN_EVENT_TYPES.has(event.type)
			&& event.aggregateType === "character"
			&& event.aggregateId === active.characterId
		) {
			this._queueDetach(active, {
				reason: "Character is no longer available in this campaign.",
				sequence: event.sequence,
			});
			return;
		}

		if (
			event.type === "character.projection.invalidated"
			&& event.aggregateType === "character"
			&& event.aggregateId === active.characterId
		) {
			this._enqueue(active, {
				type: "projectionInvalidated",
				value: {
					source: "event",
					eventId: event.id,
					campaignId: this._campaignId,
					characterId: active.characterId,
					sequence: event.sequence,
					revision: event.aggregateRevision,
					projectionRevision: event.payload?.projectionRevision,
				},
			});
			return;
		}

		const routing = getCharacterOperationRouting(event);
		if (!routing || routing.targetCharacterId !== active.characterId) return;
		const operationKey = `${event.type}:${routing.operationId}`;
		if (active.operationKeys.has(operationKey)) return;
		active.operationKeys.add(operationKey);
		if (active.operationKeys.size > 2_000) active.operationKeys.delete(active.operationKeys.values().next().value);
		this._enqueue(active, {
			type: "semanticOperation",
			value: {
				eventId: event.id,
				campaignId: this._campaignId,
				sequence: event.sequence,
				type: event.type,
				aggregateType: event.aggregateType,
				aggregateId: event.aggregateId,
				aggregateRevision: event.aggregateRevision,
				operationId: routing.operationId,
				targetCharacterId: routing.targetCharacterId,
				status: routing.status,
				payload: routing.payload,
			},
		});
	}

	_queueDetach (active, {reason, sequence}) {
		if (!this._isCurrent(active) || active.isDetachQueued) return;
		active.isDetachQueued = true;
		queueMicrotask(() => {
			if (!this._isCurrent(active)) return;
			void this._repository.pEnqueueRealtimeDelivery({
				characterId: active.characterId,
				fnDeliver: () => {
					if (!this._isCurrent(active)) return false;
					this.detach();
					this._emit("connectionState", {state: "closed", reason});
					return true;
				},
			}).catch(() => {
				if (!this._isCurrent(active)) return;
				this.detach();
				this._emit("deliveryError", {
					characterId: active.characterId,
					deliveryType: "teardown",
					sequence,
				});
			});
		});
	}

	_enqueue (active, {type, value}) {
		void this._repository.pEnqueueRealtimeDelivery({
			characterId: active.characterId,
			fnDeliver: () => {
				if (!this._isCurrent(active)) return false;
				this._emit(type, value, {isThrowOnError: true});
				return true;
			},
		}).catch(() => {
			if (!this._isCurrent(active)) return;
			this._emit("deliveryError", {
				characterId: active.characterId,
				deliveryType: type,
				sequence: value.sequence ?? value.lastSequence ?? 0,
			});
		});
	}
}

globalThis.CharacterSheetRealtimeCoordinator = CharacterSheetRealtimeCoordinator;
