import {
	ACTIVE_CAMPAIGN_CHANNEL_NAME,
	ACTIVE_CAMPAIGN_SCHEMA_VERSION,
	ACTIVE_CAMPAIGN_STATE_CLEARED,
	ACTIVE_CAMPAIGN_STORAGE_KEY,
	getActiveCampaignRecordKey,
	parseActiveCampaignRecord,
} from "./hub-active-campaign-record.js";

const MESSAGE_SELECTION_CHANGED = "selection_changed";
const MESSAGE_SELECTION_CLEARED = "selection_cleared";

/**
 * Why a selection was cleared. A tombstone is durable and identical regardless of cause, so the
 * cause travels as transient message metadata: a receiver holding an unrelated open resource needs
 * to distinguish "you are signed out" from "someone lost access to a different campaign".
 */
export const CLEAR_CAUSE_LOGOUT = "logout";
export const CLEAR_CAUSE_ACCESS_LOSS = "access_loss";
export const CLEAR_CAUSE_SELECTION = "selection";
const CLEAR_CAUSES = new Set([CLEAR_CAUSE_LOGOUT, CLEAR_CAUSE_ACCESS_LOSS, CLEAR_CAUSE_SELECTION]);

/**
 * Same-browser selection synchronisation (ADR 0013).
 *
 * Uses the origin-wide `hub:active-campaign:v1` channel rather than the per-campaign lease channel,
 * because a selection change must be visible before the receiver joins the destination campaign.
 * The `storage` event is a fallback signal only: receivers reread durable storage instead of
 * trusting an event payload.
 */
export class HubActiveCampaignChannel {
	constructor ({
		writerId,
		fnCreateChannel = name => (typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(name)),
		target = globalThis.window || null,
	} = {}) {
		if (typeof writerId !== "string" || !writerId) throw new TypeError(`writerId is required.`);
		this._writerId = writerId;
		this._listeners = new Set();
		this._lastPostedKey = null;
		this._isClosed = false;

		this._channel = null;
		try {
			this._channel = fnCreateChannel(ACTIVE_CAMPAIGN_CHANNEL_NAME);
		} catch {
			this._channel = null;
		}
		this._onChannelMessage = event => this._handleMessage(event?.data);
		this._channel?.addEventListener?.("message", this._onChannelMessage);

		this._target = target;
		this._onStorage = event => {
			if (event?.key != null && event.key !== ACTIVE_CAMPAIGN_STORAGE_KEY) return;
			// Deliberately ignores `event.newValue`; the receiver rereads durable storage.
			this._emit({record: null, isStorageSignal: true});
		};
		this._target?.addEventListener?.("storage", this._onStorage);
	}

	get writerId () { return this._writerId; }
	get hasChannel () { return !!this._channel; }

	_handleMessage (data) {
		if (this._isClosed || !data || typeof data !== "object") return;
		if (data.schemaVersion !== ACTIVE_CAMPAIGN_SCHEMA_VERSION) return;
		if (data.type !== MESSAGE_SELECTION_CHANGED && data.type !== MESSAGE_SELECTION_CLEARED) return;
		// A tab never reacts to its own write.
		if (data.writerId === this._writerId) return;

		const record = parseActiveCampaignRecord(JSON.stringify({
			schemaVersion: data.schemaVersion,
			accountId: data.accountId,
			campaignId: data.type === MESSAGE_SELECTION_CLEARED ? null : data.campaignId,
			state: data.type === MESSAGE_SELECTION_CLEARED ? ACTIVE_CAMPAIGN_STATE_CLEARED : "selected",
			revision: data.revision,
			updatedAt: data.updatedAt,
			writerId: data.writerId,
		}));
		if (!record) return;
		this._emit({record, isStorageSignal: false, cause: CLEAR_CAUSES.has(data.cause) ? data.cause : null});
	}

	_emit (payload) {
		for (const listener of [...this._listeners]) {
			try {
				listener(payload);
			} catch { /* one bad subscriber must not stop the rest converging */ }
		}
	}

	/**
	 * Broadcast a record. Callers may only post when they authored a mutation or when a repair
	 * raised durable storage; combined with verbatim repair this makes the ordering value monotone
	 * and bounded, so tabs reach a fixed point instead of ping-ponging writes.
	 */
	post (record, {cause = null} = {}) {
		if (this._isClosed || !record || !this._channel?.postMessage) return false;
		const isCleared = record.state === ACTIVE_CAMPAIGN_STATE_CLEARED;
		const boundedCause = isCleared && CLEAR_CAUSES.has(cause) ? cause : null;
		const key = `${getActiveCampaignRecordKey(record)}|${boundedCause || ""}`;
		if (key && key === this._lastPostedKey) return false;
		this._lastPostedKey = key;
		try {
			this._channel.postMessage({
				type: isCleared ? MESSAGE_SELECTION_CLEARED : MESSAGE_SELECTION_CHANGED,
				schemaVersion: ACTIVE_CAMPAIGN_SCHEMA_VERSION,
				accountId: record.accountId,
				campaignId: isCleared ? null : record.campaignId,
				revision: record.revision,
				updatedAt: record.updatedAt,
				writerId: record.writerId,
				// Transient routing metadata, never persisted alongside the durable record.
				...(boundedCause ? {cause: boundedCause} : {}),
			});
			return true;
		} catch {
			return false;
		}
	}

	onMessage (listener) {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	close () {
		if (this._isClosed) return;
		this._isClosed = true;
		this._channel?.removeEventListener?.("message", this._onChannelMessage);
		try {
			this._channel?.close?.();
		} catch { /* already closed */ }
		this._channel = null;
		this._target?.removeEventListener?.("storage", this._onStorage);
		this._listeners.clear();
		this._lastPostedKey = null;
	}
}
