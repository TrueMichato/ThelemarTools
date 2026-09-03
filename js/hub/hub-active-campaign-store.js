import {
	ACTIVE_CAMPAIGN_STORAGE_KEY,
	ACTIVE_CAMPAIGN_WRITE_LOCK,
	CLEAR_CAUSE_LOGOUT,
	compareActiveCampaignRecords,
	isActiveCampaignUuid,
	isSameAccount,
	makeClearedRecord,
	makeSelectedRecord,
	parseActiveCampaignRecord,
	pickGreaterActiveCampaignRecord,
	serializeActiveCampaignRecord,
} from "./hub-active-campaign-record.js";

/**
 * Durable, device-local storage for the active campaign selection (ADR 0013).
 *
 * The store keeps the greatest valid same-account record it has observed and repairs physical
 * storage toward it. Repair copies a record verbatim — assigning a new revision during repair
 * would create an endless revision race between tabs.
 */
export class HubActiveCampaignStore {
	constructor ({
		storage = globalThis.localStorage,
		locks = globalThis.navigator?.locks || null,
		writerId = crypto.randomUUID(),
		fnNow = () => Date.now(),
		maxRepairAttempts = 5,
		fnDelay = ms => new Promise(resolve => setTimeout(resolve, ms)),
	} = {}) {
		this._storage = storage || null;
		this._locks = locks;
		this._writerId = writerId;
		this._fnNow = fnNow;
		this._maxRepairAttempts = maxRepairAttempts;
		this._fnDelay = fnDelay;
		this._winner = null;
	}

	get writerId () { return this._writerId; }
	get winner () { return this._winner ? {...this._winner} : null; }

	_readRaw () {
		if (!this._storage) return null;
		try {
			return this._storage.getItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
		} catch {
			return null;
		}
	}

	_writeRaw (serialized) {
		if (!this._storage) return false;
		try {
			this._storage.setItem(ACTIVE_CAMPAIGN_STORAGE_KEY, serialized);
			return true;
		} catch {
			return false;
		}
	}

	_evict () {
		if (!this._storage) return;
		try {
			this._storage.removeItem(ACTIVE_CAMPAIGN_STORAGE_KEY);
		} catch { /* storage unavailable; nothing durable to evict */ }
	}

	/**
	 * Read the durable record, evicting anything malformed, oversized, or of an unknown schema.
	 * A valid selection or tombstone is never removed here.
	 */
	read () {
		const raw = this._readRaw();
		if (raw == null) return null;
		const record = parseActiveCampaignRecord(raw);
		if (!record) {
			this._evict();
			return null;
		}
		return record;
	}

	/** Durable record for `accountId`, or `null` when the record belongs to a different account. */
	readForAccount (accountId) {
		if (!isActiveCampaignUuid(accountId)) return null;
		const record = this.read();
		return record && record.accountId === accountId ? record : null;
	}

	async _pWithLock (fn) {
		if (!this._locks?.request) return fn();
		return this._locks.request(ACTIVE_CAMPAIGN_WRITE_LOCK, fn);
	}

	_nextUpdatedAt (prior) {
		const now = Math.max(0, Math.trunc(this._fnNow()));
		// Strictly advance past the prior stamp so equal-revision ties stay decidable.
		return prior && prior.updatedAt >= now ? prior.updatedAt + 1 : now;
	}

	async _pMutate (accountId, fnBuild) {
		if (!isActiveCampaignUuid(accountId)) throw new TypeError(`accountId must be a UUID.`);
		return this._pWithLock(async () => {
			const stored = this.read();
			// A record for another account is not comparable, so the current account restarts at
			// revision 1 rather than inheriting a foreign ordering position.
			const prior = stored && stored.accountId === accountId ? stored : null;
			const record = fnBuild({
				accountId,
				revision: (prior?.revision ?? 0) + 1,
				updatedAt: this._nextUpdatedAt(prior),
				writerId: this._writerId,
			});
			this._writeRaw(serializeActiveCampaignRecord(record));
			// Reread before adopting: a concurrent writer without Web Locks may have won.
			const confirmed = this.read();
			const winner = confirmed && isSameAccount(confirmed, record) && compareActiveCampaignRecords(confirmed, record) > 0
				? confirmed
				: record;
			this._winner = winner;
			return winner;
		});
	}

	async pSelect ({accountId, campaignId}) {
		if (!isActiveCampaignUuid(campaignId)) throw new TypeError(`campaignId must be a UUID.`);
		return this._pMutate(accountId, args => makeSelectedRecord({...args, campaignId}));
	}

	async pClear ({accountId, cause = CLEAR_CAUSE_LOGOUT}) {
		return this._pMutate(accountId, args => makeClearedRecord({...args, cause}));
	}

	/**
	 * Merge an externally observed record into the in-memory winner and repair durable storage
	 * toward it. Returns the accepted winner plus whether storage was physically raised, which is
	 * the only condition under which a receiver is permitted to rebroadcast.
	 */
	async pAccept (record) {
		const stored = this.read();
		let winner = pickGreaterActiveCampaignRecord(this._winner, stored);
		winner = pickGreaterActiveCampaignRecord(winner, record);
		this._winner = winner || null;
		if (!winner) return {winner: null, didRepairStorage: false};

		let didRepairStorage = false;
		for (let attempt = 0; attempt < this._maxRepairAttempts; ++attempt) {
			const current = this.read();
			const isCurrentAuthoritative = current
				&& isSameAccount(current, winner)
				&& compareActiveCampaignRecords(current, winner) >= 0;
			if (isCurrentAuthoritative) {
				// Storage already holds an equal or greater record; adopt it and stop.
				if (compareActiveCampaignRecords(current, winner) > 0) this._winner = current;
				return {winner: this._winner, didRepairStorage};
			}
			const serialized = serializeActiveCampaignRecord(winner);
			// Verbatim copy — no revision bump — so repair converges instead of racing.
			if (this._writeRaw(serialized)) didRepairStorage = true;

			const confirmed = this.read();
			if (confirmed && isSameAccount(confirmed, winner) && compareActiveCampaignRecords(confirmed, winner) >= 0) {
				if (compareActiveCampaignRecords(confirmed, winner) > 0) this._winner = confirmed;
				return {winner: this._winner, didRepairStorage};
			}
			await this._fnDelay(2 ** attempt);
		}
		return {winner: this._winner, didRepairStorage};
	}

	/** Drop in-memory state. Durable records intentionally survive. */
	reset () {
		this._winner = null;
	}
}
